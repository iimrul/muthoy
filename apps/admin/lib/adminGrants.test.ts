// Guards the failure fixed by 20260817000000_admin_read_grants.sql: PostgREST
// runs admin queries as service_role, and BYPASSRLS does NOT substitute for a
// table GRANT. Query a table with no grant and the page dies in production
// with SQLSTATE 42501 — which is exactly how this shipped the first time.
// These assertions fail in CI instead.
//
// W4-07 restructured it, and the restructure is deliberately NOT a relaxation:
//
//  - the table list is now derived from BOTH query modules, so a read added in
//    lib/adminQueries.ts is covered exactly as one in lib/queries.ts is. A read
//    the manifest does not declare still fails the build, which is the
//    protection the old `['sales','shops']` assertion was really providing;
//  - the original no-DML and no-anon assertions for shops and sales are kept
//    VERBATIM. Those are the tables that guard was written for, the panel still
//    only reads them, and nothing in this batch changes that;
//  - the seven commercial tables are recorded in a separate, explicitly
//    labelled group as PRE-EXISTING privileges this batch neither introduces
//    nor relies on. b4_commercial_platform.sql:194 already grants
//    insert,update on all seven. Blessing that in a single "exactly what is
//    granted" manifest would have made the test look stronger while permitting
//    far more, which is review finding 6.
//
// What text matching cannot answer — effective privilege after ordered GRANTs,
// REVOKEs and role memberships — is W4-08's effective-ACL pgtest, not this
// file. This one answers "is the grant present in the chain at all".

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

const ADMIN_ROOT = join(import.meta.dirname, '..');
const MIGRATIONS_DIR = join(ADMIN_ROOT, '..', '..', 'backend', 'supabase', 'migrations');

const QUERY_MODULES = ['queries.ts', 'adminQueries.ts'] as const;
const QUERY_SOURCES = QUERY_MODULES.map((name) => readFileSync(join(ADMIN_ROOT, 'lib', name), 'utf8'));

const MIGRATIONS_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
  .join('\n');

/** Every table apps/admin reads, taken from the queries themselves. */
function queriedTables(sources: readonly string[]): string[] {
  const tables = sources.flatMap((source) =>
    [...source.matchAll(/\.from\('([a-z_]+)'\)/g)].map((match) => match[1] ?? ''),
  );
  return [...new Set(tables)].sort();
}

/**
 * The tables the panel is DECLARED to read. Adding a read without adding it
 * here fails the first test below — on purpose.
 */
const DECLARED_READ_TABLES = [
  'billing_accounts',
  'billing_subscriptions',
  'entitlement_snapshots',
  'payment_orders',
  'payment_provider_events',
  'plan_offerings',
  'sales',
  // W4-04. The read that was held back for a whole batch because BYPASSRLS does
  // not substitute for a table GRANT — migration 35 adds the SELECT, and the
  // assertion below pins it to SELECT and nothing else.
  'sale_refunds',
  'shop_memberships',
  'shops',
  'users',
].sort();

/** The two tables the original Day-14 guard was written for. */
const READ_ONLY_TABLES = ['sales', 'shops'] as const;

/**
 * Pre-existing privileges, recorded as an inherited FACT and not as a
 * permission the panel may use: b4_commercial_platform.sql:194 grants
 * select,insert,update on these seven in one statement. W4-08's source-level
 * test is what bounds admin write power; this list exists so the grant chain
 * is not silently re-blessed here.
 */
const COMMERCIAL_TABLES_WITH_INHERITED_DML = [
  'plan_offerings',
  'billing_accounts',
  'shop_memberships',
  'billing_subscriptions',
  'entitlement_snapshots',
  'payment_orders',
  'payment_provider_events',
] as const;

function grantPattern(privilege: string, table: string, role: string): RegExp {
  return new RegExp(
    String.raw`grant\s+[a-z,\s]*\b${privilege}\b[a-z,\s]*\s+on\s+table\s+(?:public\.)?\b${table}\b\s+to\s+[a-z_,\s]*\b${role}\b`,
    'i',
  );
}

/** The comma-separated multi-table form, which omits the `table` keyword. */
function multiTableGrantPattern(privilege: string, table: string, role: string): RegExp {
  return new RegExp(
    String.raw`grant\s+[a-z,\s]*\b${privilege}\b[a-z,\s]*\s+on\s+[a-z_,.\s]*\b${table}\b[a-z_,.\s]*\s+to\s+[a-z_,\s]*\b${role}\b`,
    'i',
  );
}

function isGranted(privilege: string, table: string, role: string): boolean {
  return grantPattern(privilege, table, role).test(MIGRATIONS_SQL)
    || multiTableGrantPattern(privilege, table, role).test(MIGRATIONS_SQL);
}

const QUERIED_TABLES = queriedTables(QUERY_SOURCES);
const WRITE_PRIVILEGES = ['insert', 'update', 'delete', 'truncate'];

describe('admin Postgres privileges', () => {
  test('the panel reads exactly the tables the manifest declares', () => {
    expect(QUERIED_TABLES).toEqual(DECLARED_READ_TABLES);
  });

  test('both query modules are scanned, so neither can hide a read', () => {
    expect(QUERY_SOURCES).toHaveLength(2);
    for (const source of QUERY_SOURCES) expect(source).toMatch(/\.from\('/);
  });

  test.each(DECLARED_READ_TABLES)('service_role is granted SELECT on %s', (table) => {
    expect(isGranted('select', table, 'service_role')).toBe(true);
  });

  // ------------------------------------------------ the original Day-14 guard

  test.each(WRITE_PRIVILEGES)('no migration grants %s on shops or sales — the panel only reads them', (privilege) => {
    for (const table of READ_ONLY_TABLES) {
      expect(MIGRATIONS_SQL).not.toMatch(grantPattern(privilege, table, 'service_role'));
    }
  });

  test.each(['anon', 'authenticated'])('no migration grants %s access to shops or sales', (role) => {
    for (const table of READ_ONLY_TABLES) {
      expect(MIGRATIONS_SQL).not.toMatch(grantPattern('select', table, role));
    }
  });

  // W4-04. sale_refunds is a MONEY table the panel only reads. The subtlety is
  // that 20260821010000:299's `do` block granted service_role
  // select+insert+update+delete over a table list that INCLUDES sale_refunds,
  // so asserting "no insert grant appears in the chain" would be false — the
  // grant is there. Migration 35 revokes it and re-grants SELECT, so the
  // assertion is about the REVOKE being present, and the effective privilege is
  // measured on a real Postgres by backend/supabase/pgtest/e4-admin-platform.pgtest.ts.
  test('sale_refunds is revoked from service_role and re-granted SELECT only', () => {
    expect(MIGRATIONS_SQL).toMatch(
      /revoke\s+all\s+on\s+table\s+public\.sale_refunds\s+from\s+service_role/i,
    );
    expect(MIGRATIONS_SQL).toMatch(
      /grant\s+select\s+on\s+table\s+public\.sale_refunds\s+to\s+service_role/i,
    );
    // And the revoke comes AFTER the wide grant, or it would not undo it.
    const wideGrant = MIGRATIONS_SQL.search(/grant select, insert, update, delete on table %I to service_role/i);
    const revoke = MIGRATIONS_SQL.search(/revoke\s+all\s+on\s+table\s+public\.sale_refunds\s+from\s+service_role/i);
    expect(wideGrant).toBeGreaterThan(-1);
    expect(revoke).toBeGreaterThan(wideGrant);
  });

  test('shops has no UPDATE grant for service_role — W4-05 keeps it that way', () => {
    // A shop write from the panel would need this grant, which would be a
    // migration, which is sealed. plan §5.4: location/map stays BLOCKED.
    expect(isGranted('update', 'shops', 'service_role')).toBe(false);
  });

  test.each(['anon', 'authenticated'])('no migration grants %s access to a commercial table', (role) => {
    for (const table of COMMERCIAL_TABLES_WITH_INHERITED_DML) {
      expect(MIGRATIONS_SQL).not.toMatch(grantPattern('select', table, role));
    }
  });

  // ------------------------------------- inherited privileges, recorded not used

  test('the seven commercial tables carry PRE-EXISTING insert/update for service_role', () => {
    // Recorded so the fact is visible rather than discovered later. The panel
    // does not use it: the only direct write W4-08 permits is one guarded
    // payment_orders status update, and that is enforced at source level there.
    const withInheritedDml = COMMERCIAL_TABLES_WITH_INHERITED_DML.filter(
      (table) => isGranted('insert', table, 'service_role') && isGranted('update', table, 'service_role'),
    );

    expect([...withInheritedDml].sort()).toEqual([...COMMERCIAL_TABLES_WITH_INHERITED_DML].sort());
  });

  test('no migration grants DELETE or TRUNCATE on a commercial table', () => {
    for (const table of COMMERCIAL_TABLES_WITH_INHERITED_DML) {
      for (const privilege of ['delete', 'truncate']) {
        expect(isGranted(privilege, table, 'service_role')).toBe(false);
      }
    }
  });

  // ------------------------------------------------------- unchanged absolutes

  test('no migration weakens row level security', () => {
    expect(MIGRATIONS_SQL).not.toMatch(/disable\s+row\s+level\s+security/i);
    // An UNCONDITIONAL drop assumes a policy exists and leaves the table
    // unprotected if the rest of the migration then fails. `if exists` is the
    // only acceptable form, and it is how a policy gets REPLACED — which
    // 20260819000000 does throughout, to stay re-runnable.
    expect(MIGRATIONS_SQL).not.toMatch(/drop\s+policy\s+(?!if\s+exists)/i);
  });

  test('the sync RPC lockdown is still in place', () => {
    for (const routine of ['sync_apply_row', 'sync_pull_changes']) {
      expect(MIGRATIONS_SQL).toMatch(
        new RegExp(String.raw`revoke\s+execute\s+on\s+function\s+${routine}[^;]*from[^;]*anon`, 'i'),
      );
    }
  });

  test('every commercial table has row level security enabled', () => {
    for (const table of COMMERCIAL_TABLES_WITH_INHERITED_DML) {
      expect(MIGRATIONS_SQL).toMatch(
        new RegExp(String.raw`alter\s+table\s+(?:public\.)?${table}\s+enable\s+row\s+level\s+security`, 'i'),
      );
    }
  });
});

// W4-08 — what actually bounds admin write power.
//
// The GRANT text above cannot: b4_commercial_platform.sql:194 already gives
// service_role insert and update on all seven commercial tables, so the chain
// permits far more than the panel may do. What bounds it is the SOURCE: the
// only direct table write allowed anywhere in apps/admin is the one guarded
// payment_orders status update, and everything else must go through an
// existing SECURITY DEFINER RPC.
//
// Two negative controls, because one proves too little. A synthetic migration
// granting DELETE must be rejected by the grant assertions, and a synthetic
// admin source containing a second .update( must be rejected by the source
// assertions — each targets a different one of the two mechanisms.
describe('admin write power is bounded at the source', () => {
  const ADMIN_SOURCES = (function collect(directory: string): { path: string; code: string }[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        return ['node_modules', '.next', '.turbo', 'test'].includes(entry.name)
          ? []
          : collect(absolute);
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
      const contents = readFileSync(absolute, 'utf8');
      return [{
        path: relative(ADMIN_ROOT, absolute).split(sep).join('/'),
        code: contents.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'),
      }];
    });
  })(ADMIN_ROOT);

  /**
   * Batch 3 §8.12 — the write manifest: every direct table write in the panel,
   * enumerated by (module, table, operation) and compared against the parsed
   * sources.
   *
   * W4-08 had exactly one approved write site, so a single constant was enough.
   * Batch 3 adds the modules that own the new admin tables, and a list of
   * permitted FILES would say nothing about WHICH table each may write — which
   * is the part that matters, because `shops`, `sales`, `sale_refunds`,
   * `users`, `audit_logs`, `entitlement_snapshots`, `billing_subscriptions`,
   * `billing_accounts` and `plan_offerings` must appear in no entry at all.
   * That absence is also how §8.3's no-paid-access-without-payment rule is
   * enforced at the source.
   *
   * `delete` and `truncate` appear in no entry, deliberately.
   */
  const ADMIN_WRITE_MANIFEST: readonly {
    module: string;
    table: string;
    operations: readonly string[];
  }[] = [
    // The existing guarded stale-order transition, unchanged.
    { module: 'lib/adminActions.ts', table: 'payment_orders', operations: ['update'] },
    // §4.3's role narrowing, account disable and per-user session revocation.
    {
      module: 'lib/adminIdentityStore.ts',
      table: 'admin_role_assignments',
      operations: ['insert', 'update'],
    },
    // §8.9's durable audit sink. INSERT ONLY — an audit row the panel can edit
    // or erase is not evidence, and the grant says so too.
    { module: 'lib/adminAuditStore.ts', table: 'admin_audit_log', operations: ['insert'] },
    // §8.7's support tables. The case update is column-level on (status,
    // priority, assignee, summary, updated_at), so `shop_id`, `opened_by` and
    // `opened_at` cannot be rewritten.
    {
      module: 'lib/adminSupportStore.ts',
      table: 'admin_support_cases',
      operations: ['insert', 'update'],
    },
    // INSERT ONLY, and append-only by PRIVILEGE: the grant carries no update,
    // no delete and no column-level update. A note is a record of what somebody
    // said at a time.
    { module: 'lib/adminSupportStore.ts', table: 'admin_support_notes', operations: ['insert'] },
    // §8.11's three feature flags. `key` is excluded from the update grant, so
    // a setting cannot be renamed into a different setting.
    {
      module: 'lib/adminSettings.ts',
      table: 'admin_platform_settings',
      operations: ['insert', 'update'],
    },
  ];

  /** The one module whose single update carries the stale-order guards. */
  const APPROVED_WRITE_SITE = 'lib/adminActions.ts';

  const MANIFEST_MODULES = new Set(ADMIN_WRITE_MANIFEST.map((entry) => entry.module));

  /** Tables that must never appear in a write entry, named rather than implied. */
  const READ_ONLY_TABLES: readonly string[] = [
    'shops',
    'sales',
    'sale_refunds',
    'users',
    'audit_logs',
    'entitlement_snapshots',
    'billing_subscriptions',
    'billing_accounts',
    'plan_offerings',
  ];

  /**
   * Each write, paired with the table it targets.
   *
   * It searches BACKWARDS from the operation for the nearest preceding
   * `.from('table')` rather than forwards from `.from(` over a fixed window: a
   * module that reads one table and writes another would otherwise have its
   * write attributed to whichever `.from(` happened to be within the window,
   * and lib/adminIdentityStore.ts is exactly that shape.
   */
  function writeOperations(source: { path: string; code: string }): { table: string; operation: string }[] {
    const writes: { table: string; operation: string }[] = [];
    const pattern = /\.(insert|update|upsert|delete)\s*\(/g;
    for (const match of source.code.matchAll(pattern)) {
      const operation = match[1] ?? '';
      const before = source.code.slice(0, match.index ?? 0);
      const froms = [...before.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)];
      const nearest = froms[froms.length - 1];
      // A `.delete(` with no `.from(` before it is Map.prototype.delete —
      // lib/adminLogin.ts prunes its throttle maps with it, and counting that
      // as a table write made this assertion fire on code that touches no
      // table at all.
      if (nearest === undefined) {
        if (operation === 'delete') continue;
        writes.push({ table: '(none)', operation });
        continue;
      }
      writes.push({ table: nearest[1] ?? '(none)', operation });
    }
    return writes;
  }

  /** Just the operation names, for the single-site assertions below. */
  function writeCallSites(source: { path: string; code: string }): string[] {
    return writeOperations(source).map((write) => write.operation);
  }

  test('finds the admin source tree', () => {
    expect(ADMIN_SOURCES.length).toBeGreaterThan(10);
  });

  test('only the manifest modules perform a direct table write', () => {
    const offenders = ADMIN_SOURCES
      .filter((source) => !MANIFEST_MODULES.has(source.path))
      .filter((source) => writeOperations(source).length > 0);

    expect(offenders.map((source) => source.path)).toEqual([]);
  });

  test('every write matches a manifest entry, table and operation together', () => {
    const undeclared: string[] = [];
    for (const source of ADMIN_SOURCES) {
      for (const write of writeOperations(source)) {
        const entry = ADMIN_WRITE_MANIFEST.find(
          (candidate) => candidate.module === source.path && candidate.table === write.table,
        );
        if (entry === undefined || !entry.operations.includes(write.operation)) {
          undeclared.push(source.path + ' ' + write.operation + ' ' + write.table);
        }
      }
    }

    expect(undeclared).toEqual([]);
  });

  test('every manifest entry is REAL — a stale entry is a hole, not a comment', () => {
    const unused = ADMIN_WRITE_MANIFEST.filter((entry) => {
      const source = ADMIN_SOURCES.find((candidate) => candidate.path === entry.module);
      if (source === undefined) return true;
      const writes = writeOperations(source);
      return !entry.operations.every(
        (operation) => writes.some(
          (write) => write.table === entry.table && write.operation === operation,
        ),
      );
    });

    expect(unused.map((entry) => entry.module + ' ' + entry.table)).toEqual([]);
  });

  test('no manifest entry writes a table the panel may only read', () => {
    const forbidden = ADMIN_WRITE_MANIFEST
      .filter((entry) => READ_ONLY_TABLES.includes(entry.table));

    expect(forbidden.map((entry) => entry.module + ' ' + entry.table)).toEqual([]);
  });

  test('delete and truncate appear in no manifest entry at all', () => {
    const destructive = ADMIN_WRITE_MANIFEST
      .filter((entry) => entry.operations.some(
        (operation) => operation === 'delete' || operation === 'truncate',
      ));

    expect(destructive.map((entry) => entry.module)).toEqual([]);
  });

  test('negative control C: a synthetic module writing shops is rejected', () => {
    const synthetic = {
      path: 'lib/adminIdentityStore.ts',
      code: "await client.from('shops').update({ name: 'nope' }).eq('id', id);",
    };

    // Same module as a real manifest entry, different table: the PAIR is what
    // is checked, so declaring a module is not a licence to write anything.
    expect(writeOperations(synthetic)).toEqual([{ table: 'shops', operation: 'update' }]);
    expect(ADMIN_WRITE_MANIFEST.some(
      (entry) => entry.module === synthetic.path && entry.table === 'shops',
    )).toBe(false);
  });

  test('negative control D: a synthetic adminAuditStore UPDATE is rejected', () => {
    // The audit table is INSERT-only by grant; this proves the source-level
    // guard would catch an update even before Postgres refused it.
    const synthetic = {
      path: 'lib/adminAuditStore.ts',
      code: "await client.from('admin_audit_log').update({ outcome: 'success' }).eq('id', id);",
    };

    const writes = writeOperations(synthetic);
    expect(writes).toEqual([{ table: 'admin_audit_log', operation: 'update' }]);
    // The module IS in the manifest, and that is the point: the operation is
    // what fails. `insert` is declared; `update` is not, so an update would be
    // reported as undeclared even though the module and the table are both
    // legitimate.
    const entry = ADMIN_WRITE_MANIFEST.find(
      (candidate) => candidate.module === synthetic.path && candidate.table === 'admin_audit_log',
    );
    expect(entry?.operations).toEqual(['insert']);
    expect(entry?.operations).not.toContain('update');
  });

  test('the real audit store performs an insert and nothing else', () => {
    const store = ADMIN_SOURCES.find((source) => source.path === 'lib/adminAuditStore.ts');

    expect(store).toBeDefined();
    expect(writeOperations(store ?? { path: '', code: '' }))
      .toEqual([{ table: 'admin_audit_log', operation: 'insert' }]);
  });

  test('a Map delete is not a table write', () => {
    // lib/adminLogin.ts prunes its throttle maps with `.delete(`, and counting
    // that as a table write made this assertion fire on code that touches no
    // table at all.
    const synthetic = { path: 'lib/pretend.ts', code: 'throttle.delete(key);' };
    expect(writeOperations(synthetic)).toEqual([]);
  });

  test('the approved call site performs exactly ONE update and no other write', () => {
    const approved = ADMIN_SOURCES.find((source) => source.path === APPROVED_WRITE_SITE);

    expect(approved).toBeDefined();
    expect(writeCallSites(approved ?? { path: '', code: '' })).toEqual(['update']);
  });

  test('that one update targets payment_orders and carries both guards', () => {
    const approved = ADMIN_SOURCES.find((source) => source.path === APPROVED_WRITE_SITE);

    expect(approved?.code).toContain(".from('payment_orders')");
    expect(approved?.code).toContain(".in('status', ['created', 'pending'])");
    expect(approved?.code).toContain(".lte('expires_at', now)");
  });

  test('every other write goes through an existing SECURITY DEFINER RPC', () => {
    const approved = ADMIN_SOURCES.find((source) => source.path === APPROVED_WRITE_SITE);
    const rpcNames = [...(approved?.code.matchAll(/\.rpc\('([a-z0-9_]+)'/g) ?? [])].map((match) => match[1]);

    // E11: b4_refresh_entitlement_snapshot is GONE from this list, and that is
    // the assertion. It stamps entitlement_snapshots.verified_at, which anchors a
    // device's offline grace window — legitimate for the device's own online
    // billing check (functions/sync/billing.ts:60), never for an admin asserting
    // a verification that did not happen.
    expect(rpcNames.sort()).toEqual(['b4_reconcile_plan_limits']);
    for (const name of rpcNames) {
      expect(MIGRATIONS_SQL).toMatch(
        new RegExp(String.raw`create or replace function ${name}\(`, 'i'),
      );
      expect(MIGRATIONS_SQL).toMatch(
        new RegExp(String.raw`grant execute on function ${name}\([^)]*\) to [a-z_,\s]*service_role`, 'i'),
      );
    }
  });

  // E11. The predicate is the INVOCATION, not the mention: lib/adminActions.ts
  // names this RPC in FORBIDDEN_ADMIN_RPCS, and a denylist naming a thing is the
  // opposite of calling it. Matching the bare name flagged the denylist itself,
  // which is how a guard ends up being weakened to make it pass.
  const callsForbiddenRpc = (code: string) =>
    /\.rpc\(\s*['"]b4_refresh_entitlement_snapshot['"]/.test(code);

  test('E11: no admin source invokes the forbidden entitlement-refresh RPC', () => {
    const offenders = ADMIN_SOURCES.filter((source) => callsForbiddenRpc(source.code));
    expect(offenders.map((source) => source.path)).toEqual([]);
  });

  test('E11: the denylist itself still names it, so the ban is discoverable', () => {
    const actions = ADMIN_SOURCES.find((source) => source.path === 'lib/adminActions.ts');
    expect(actions?.code).toContain('FORBIDDEN_ADMIN_RPCS');
    expect(actions?.code).toContain('b4_refresh_entitlement_snapshot');
    expect(callsForbiddenRpc(actions?.code ?? '')).toBe(false);
  });

  test('E11 negative control: the scan catches a reintroduced call', () => {
    // Non-vacuity, and it exercises the real predicate rather than a substring.
    expect(callsForbiddenRpc("await client.rpc('b4_refresh_entitlement_snapshot', { p: id });")).toBe(true);
    expect(callsForbiddenRpc('const FORBIDDEN = ["b4_refresh_entitlement_snapshot"];')).toBe(false);
  });
  test('negative control A: a synthetic DELETE grant on shops would be rejected', () => {
    const synthetic = 'grant delete on table public.shops to service_role;';

    expect(grantPattern('delete', 'shops', 'service_role').test(synthetic)).toBe(true);
    // And the real chain does not contain it.
    expect(MIGRATIONS_SQL).not.toMatch(grantPattern('delete', 'shops', 'service_role'));
  });

  test('negative control B: a synthetic second .update( would be rejected', () => {
    const synthetic = {
      path: 'lib/pretendQueries.ts',
      code: "const x = await client.from('shops').update({ name: 'nope' }).eq('id', id);",
    };

    expect(writeCallSites(synthetic)).toEqual(['update']);
    // The real assertion would therefore fail for this file, because it is not
    // the approved call site.
    expect(synthetic.path).not.toBe(APPROVED_WRITE_SITE);
  });
});
