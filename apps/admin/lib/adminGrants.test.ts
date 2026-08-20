// Guards the failure fixed by 20260817000000_admin_read_grants.sql: PostgREST
// runs admin queries as service_role, and BYPASSRLS does NOT substitute for a
// table GRANT. Query a table with no grant and the page dies in production
// with SQLSTATE 42501 — which is exactly how this shipped the first time.
// These assertions fail in CI instead.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const ADMIN_ROOT = join(import.meta.dirname, '..');
const MIGRATIONS_DIR = join(ADMIN_ROOT, '..', '..', 'backend', 'supabase', 'migrations');

const QUERIES_SOURCE = readFileSync(join(ADMIN_ROOT, 'lib', 'queries.ts'), 'utf8');

const MIGRATIONS_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
  .join('\n');

/** Every table apps/admin reads, taken from the queries themselves. */
function queriedTables(source: string): string[] {
  const matches = source.matchAll(/\.from\('([a-z_]+)'\)/g);
  return [...new Set([...matches].map((match) => match[1] ?? ''))].sort();
}

function grantPattern(privilege: string, table: string, role: string): RegExp {
  return new RegExp(
    String.raw`grant\s+[a-z,\s]*\b${privilege}\b[a-z,\s]*\s+on\s+table\s+(?:public\.)?\b${table}\b\s+to\s+[a-z_,\s]*\b${role}\b`,
    'i',
  );
}

const QUERIED_TABLES = queriedTables(QUERIES_SOURCE);
const WRITE_PRIVILEGES = ['insert', 'update', 'delete', 'truncate'];

describe('Day 14 admin Postgres privileges', () => {
  test('the admin reads exactly the tables Volume 5 P0 specifies', () => {
    expect(QUERIED_TABLES).toEqual(['sales', 'shops']);
  });

  test.each(QUERIED_TABLES)('service_role is granted SELECT on %s', (table) => {
    expect(MIGRATIONS_SQL).toMatch(grantPattern('select', table, 'service_role'));
  });

  test.each(WRITE_PRIVILEGES)('no migration grants %s on an admin table — the panel is read-only', (privilege) => {
    for (const table of QUERIED_TABLES) {
      expect(MIGRATIONS_SQL).not.toMatch(grantPattern(privilege, table, 'service_role'));
    }
  });

  test.each(['anon', 'authenticated'])('no migration grants %s access to an admin table', (role) => {
    for (const table of QUERIED_TABLES) {
      expect(MIGRATIONS_SQL).not.toMatch(grantPattern('select', table, role));
    }
  });

  test('no migration weakens row level security', () => {
    expect(MIGRATIONS_SQL).not.toMatch(/disable\s+row\s+level\s+security/i);
    // An UNCONDITIONAL drop assumes a policy exists and leaves the table
    // unprotected if the rest of the migration then fails. `if exists` is the
    // only acceptable form, and it is how a policy gets REPLACED — which
    // 20260819000000 does throughout, to stay re-runnable.
    expect(MIGRATIONS_SQL).not.toMatch(/drop\s+policy\s+(?!if\s+exists)/i);
  });

  // Whether the policies that SURVIVE all this actually protect anything is not
  // a question text can answer — the previous blanket ban on `drop policy` was
  // this test trying to answer it anyway, and it would have failed any
  // re-runnable migration. It is now asserted against a real Postgres in
  // backend/supabase/pgtest/migration.pgtest.ts, which applies every migration
  // and checks the end state per table.

  test('the sync RPC lockdown is still in place', () => {
    for (const routine of ['sync_apply_row', 'sync_pull_changes']) {
      expect(MIGRATIONS_SQL).toMatch(
        new RegExp(String.raw`revoke\s+execute\s+on\s+function\s+${routine}[^;]*from[^;]*anon`, 'i'),
      );
    }
  });
});
