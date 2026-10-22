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
import { join } from 'node:path';
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

  test('shops has no UPDATE grant for service_role — W4-05 is still a blocker', () => {
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
