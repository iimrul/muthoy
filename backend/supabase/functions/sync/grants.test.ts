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

/** Tables the edge functions hit through PostgREST rather than through an RPC. */
function directlyReadTables(source: string): string[] {
  const matches = source.matchAll(/\.from\("([a-z_]+)"\)/g);
  return [...new Set([...matches].map((match) => match[1] ?? ''))].sort();
}

function grantPattern(privilege: string, table: string, role: string): RegExp {
  return new RegExp(
    String.raw`grant\s+[a-z,\s]*\b${privilege}\b[a-z,\s]*\s+on\s+table\s+(?:public\.)?\b${table}\b\s+to\s+[a-z_,\s]*\b${role}\b`,
    'i',
  );
}

const DIRECT_TABLES = directlyReadTables(FUNCTIONS_SOURCE);

describe('sync edge-function Postgres privileges', () => {
  // Pinned, not derived: adding a direct read is exactly the change that
  // reintroduces this bug, so it should force a deliberate update here.
  test('the edge functions read only the tables we have vetted directly', () => {
    // auth_bindings and users joined the list with the separate-device login
    // (20260819000000_staff_device_login.sql): deviceLogin/identity/recoverPin
    // resolve an account and a permission_version through PostgREST rather than
    // through an RPC, so each needs its own service_role grant.
    expect(DIRECT_TABLES).toEqual(['auth_bindings', 'roles', 'shop_claims', 'users']);
  });

  test.each(DIRECT_TABLES)('service_role is granted SELECT on %s', (table) => {
    expect(MIGRATIONS_SQL).toMatch(grantPattern('select', table, 'service_role'));
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
