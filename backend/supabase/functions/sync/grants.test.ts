// Guards the failure fixed by 20260817000100_sync_roles_read_grant.sql.
//
// Almost every sync database access goes through a SECURITY DEFINER function, so
// it runs with the definer's privileges and needs no table GRANT. The handful of
// direct `.from(...)` reads do not: PostgREST executes those as service_role, and
// BYPASSRLS is not a substitute for a table GRANT. Miss the grant and the read
// dies at runtime with SQLSTATE 42501 — which is how public.roles shipped, and
// which push() reports as a *transient* failure that retries forever rather than
// surfacing. These assertions fail in CI instead.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const FUNCTIONS_DIR = join(import.meta.dirname, '..');
const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations');

const PUSH_SOURCE = readFileSync(join(import.meta.dirname, 'push.ts'), 'utf8');

/** Every edge-function source, so a new direct read anywhere is caught. */
const FUNCTIONS_SOURCE = readdirSync(FUNCTIONS_DIR, { recursive: true })
  .map(String)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => readFileSync(join(FUNCTIONS_DIR, name), 'utf8'))
  .join('\n');

const MIGRATIONS_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
  .join('\n');

/**
 * Comments are prose, not calls.
 *
 * Without this, a comment explaining why a direct write was REMOVED counts as
 * one — which is exactly what happened to multiShop.ts the moment its 42501
 * was fixed and the old call was described in the note above the new one.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Tables the edge functions hit through PostgREST rather than through an RPC. */
function directlyReadTables(source: string): string[] {
  const matches = stripComments(source).matchAll(/\.from\("([a-z_]+)"\)/g);
  return [...new Set([...matches].map((match) => match[1] ?? ''))].sort();
}

function grantPattern(privilege: string, table: string, role: string): RegExp {
  return new RegExp(
    String.raw`grant\s+[a-z,\s]*\b${privilege}\b[a-z,\s]*\s+on\s+table\s+(?:public\.)?\b${table}\b\s+to\s+[a-z_,\s]*\b${role}\b`,
    'i',
  );
}

/**
 * Same rule, the other direction: a WRITE is checked against the table ACL too.
 *
 * This half was missing, and a direct `.insert()` on shops shipped in the DEV
 * registration bootstrap and died on every physical attempt with 42501. It was
 * invisible three times over — its own suite mocks supabaseAdmin, the pgtest
 * harness grants service_role more than the real project does, and the check
 * above only ever looked at SELECT.
 *
 * `upsert` is normalised to `insert`: it is the privilege Postgres actually
 * demands first, and a table granted neither fails there.
 */
function directWrites(source: string): string[] {
  const found = new Set<string>();
  const pattern =
    /\.from\(\s*(?:"([a-z_]+)"|([A-Za-z_$][\w$]*))\s*\)\s*\.(insert|update|upsert|delete)\(/g;
  for (const match of stripComments(source).matchAll(pattern)) {
    const table = match[1] ?? `<variable:${match[2]}>`;
    const verb = match[3] === 'upsert' ? 'insert' : match[3];
    found.add(`${table}:${verb}`);
  }
  return [...found].sort();
}

/**
 * Tolerates the real shapes the migrations use — `grant a,b,c on t1,t2 to r`
 * with or without the `table` keyword, wrapped across lines. The stricter
 * grantPattern above misses those, which is why the B4 tables' insert/update
 * grants would otherwise read as absent.
 */
function hasGrant(privilege: string, table: string, role: string): boolean {
  return new RegExp(
    String.raw`grant\s+[a-z,\s]*\b${privilege}\b[a-z,\s]*\s+on\s+(?:table\s+)?[a-z_.,\s]*\b(?:public\.)?${table}\b[a-z_.,\s]*\s+to\s+[a-z_,\s]*\b${role}\b`,
    'i',
  ).test(MIGRATIONS_SQL);
}

const DIRECT_TABLES = directlyReadTables(FUNCTIONS_SOURCE);
const DIRECT_WRITES = directWrites(FUNCTIONS_SOURCE);

/**
 * Empty, and it should stay that way.
 *
 * It briefly held `shops:update` — multiShop.ts renamed and archived through
 * `.from("shops").update(...)` against a table granted only SELECT, answering
 * 42501 and surfacing to the device as a misleading `404 "Shop not found"`.
 * That write now goes through b4_mutate_owned_shop, so nothing is quarantined.
 * A new entry here means a direct write shipped without its grant.
 */
const KNOWN_UNGRANTED: string[] = [];

describe('sync edge-function Postgres privileges', () => {
  // Pinned, not derived: adding a direct read is exactly the change that
  // reintroduces this bug, so it should force a deliberate update here.
  test('the edge functions read only the tables we have vetted directly', () => {
    // auth_bindings and users joined the list with the separate-device login
    // (20260819000000_staff_device_login.sql): deviceLogin/identity/recoverPin
    // resolve an account and a permission_version through PostgREST rather than
    // through an RPC, so each needs its own service_role grant.
    expect(DIRECT_TABLES).toEqual([
      'auth_bindings', 'billing_accounts', 'entitlement_snapshots',
      'payment_orders', 'payment_provider_events', 'plan_offerings', 'roles',
      'shop_claims', 'shop_memberships', 'shops', 'users',
    ]);
  });

  test.each(DIRECT_TABLES)('service_role is granted SELECT on %s', (table) => {
    expect(MIGRATIONS_SQL).toMatch(grantPattern('select', table, 'service_role'));
  });

  // A variable table name is what made the DEV bootstrap's `.from(table)`
  // unreadable to this file: no static check can name the grant it needs.
  test('every direct write names its table literally, so its grant can be checked', () => {
    expect(DIRECT_WRITES.filter((entry) => entry.startsWith('<variable:'))).toEqual([]);
  });

  // Pinned like the read list: adding a write is exactly the change that
  // reintroduces this bug, so it should force a deliberate update here.
  test('the edge functions write only the tables we have vetted directly', () => {
    expect(DIRECT_WRITES).toEqual([
      'auth_bindings:insert', 'auth_bindings:update',
      'payment_orders:insert', 'payment_orders:update',
      'payment_provider_events:insert',
      'shop_claims:insert',
      'users:update',
    ]);
  });

  test.each(DIRECT_WRITES.filter((entry) => !KNOWN_UNGRANTED.includes(entry)))(
    'service_role is granted what it needs for %s',
    (entry) => {
      const [table, privilege] = entry.split(':');
      expect(hasGrant(privilege ?? '', table ?? '', 'service_role')).toBe(true);
    },
  );

  test('nothing is quarantined, and shops stays read-only for service_role', () => {
    expect(KNOWN_UNGRANTED).toEqual([]);
    // The fix was a SECURITY DEFINER function, NOT a wider grant. If a later
    // change "solves" a 42501 by granting the table instead, this fails.
    for (const privilege of ['insert', 'update', 'delete']) {
      expect(hasGrant(privilege, 'shops', 'service_role')).toBe(false);
      expect(hasGrant(privilege, 'roles', 'service_role')).toBe(false);
    }
    expect(hasGrant('insert', 'users', 'service_role')).toBe(false);
  });

  test.each(['anon', 'authenticated'])('no migration grants %s access to a directly-read table', (role) => {
    for (const table of DIRECT_TABLES) {
      expect(MIGRATIONS_SQL).not.toMatch(grantPattern('select', table, role));
    }
  });

  // shop_claims is deliberately excluded: linkDevice writes claims, so its
  // select+insert grant in the initial schema is correct. roles is read-only.
  test.each(['insert', 'update', 'delete', 'truncate'])('no migration grants %s on roles', (privilege) => {
    expect(MIGRATIONS_SQL).not.toMatch(grantPattern(privilege, 'roles', 'service_role'));
  });

  test('the shop_claims lockdown is still in place', () => {
    expect(MIGRATIONS_SQL).toMatch(
      /revoke\s+all\s+on\s+table\s+(?:public\.)?shop_claims\s+from[^;]*anon[^;]*authenticated/i,
    );
  });

  test('the sync RPC lockdown is still in place', () => {
    for (const routine of ['sync_apply_row', 'sync_pull_changes']) {
      expect(MIGRATIONS_SQL).toMatch(
        new RegExp(String.raw`revoke\s+execute\s+on\s+function\s+${routine}[^;]*from[^;]*anon`, 'i'),
      );
    }
  });

  // The grant restores the read; it must not become an excuse to drop the check
  // that the read exists to perform.
  test('push still rejects a permission row whose role belongs to another shop', () => {
    expect(PUSH_SOURCE).toMatch(/data\.shop_id\s*===\s*shopId/);
    expect(PUSH_SOURCE).toContain('Permission role does not belong to authenticated shop');
  });
});
