import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// backend/supabase/pgtest/harness.ts — a REAL Postgres, running the REAL
// migrations.
//
// Everything else that tests this backend reads SQL as a string and asserts it
// CONTAINS something. That was enough to let a migration ship that had never
// once been executed, and to let a security check ship that read the wrong
// field on every request while its test happily confirmed the call existed.
//
// PGlite is Postgres compiled to WebAssembly — same planner, same plpgsql, same
// RLS engine, no Docker and no network. What it does NOT bring is Supabase's
// platform bootstrap: the `auth` schema, the four roles, and the default
// privileges the hosted project sets up before any migration runs. Those are
// recreated below as faithfully as they can be, and nothing else is stubbed —
// in particular every policy, function and trigger under test is the real one
// from backend/supabase/migrations.

const MIGRATIONS_DIR = resolve('backend/supabase/migrations');

/**
 * The parts of a hosted Supabase project that exist BEFORE migration 1.
 *
 * - `auth.jwt()` is what every RLS policy reads. On the platform it returns the
 *   verified request's claims; here it reads a session GUC the tests set, which
 *   is the same mechanism PostgREST itself uses (`request.jwt.claims`).
 * - The four roles must exist because the migrations GRANT and REVOKE against
 *   them by name.
 * - service_role carries BYPASSRLS on the platform. Without it here, RLS would
 *   apply to the sync path too and the tests would prove the wrong thing.
 * - Supabase grants the API roles blanket table privileges via default
 *   privileges. The migrations' own REVOKEs run afterwards and still win, which
 *   is the real ordering — and is why `authenticated` can reach a table at all
 *   for the RLS tests to then deny it.
 */
const PLATFORM_BOOTSTRAP = `
create schema if not exists auth;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub',
    ''
  )::uuid
$$;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end
$roles$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export interface Harness {
  db: PGlite;
  /** Runs `fn` as the given Postgres role with the given JWT claims. */
  as<T>(role: string, claims: Record<string, unknown> | null, fn: () => Promise<T>): Promise<T>;
  /** A single-row query, as the current role. */
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T>;
  /** All rows, as the current role. */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

export function migrationSql(name: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
}

function wrap(db: PGlite): Harness {
  return {
    db,
    async as<T>(role, claims, fn) {
      await db.exec(`set role ${role}`);
      await db.query(`select set_config('request.jwt.claims', $1, false)`, [
        claims ? JSON.stringify(claims) : '',
      ]);
      try {
        return await fn();
      } finally {
        // Reset in a finally so one test cannot leak a role or a set of claims
        // into the next and quietly change what the next one proves.
        await db.exec('reset role');
        await db.query(`select set_config('request.jwt.claims', $1, false)`, ['']);
      }
    },
    async one<T>(sql: string, params: unknown[] = []) {
      const result = await db.query<T>(sql, params);
      return result.rows[0] as T;
    },
    async all<T>(sql: string, params: unknown[] = []) {
      const result = await db.query<T>(sql, params);
      return result.rows as T[];
    },
    exec: (sql: string) => db.exec(sql).then(() => undefined),
    close: () => db.close(),
  };
}

/**
 * A database with the platform bootstrap and every migration applied, in
 * filename order — the same order the Supabase CLI uses.
 */
export async function createHarness(): Promise<Harness> {
  const db = await PGlite.create();
  await db.exec(PLATFORM_BOOTSTRAP);
  for (const name of migrationFiles()) {
    await db.exec(migrationSql(name));
  }
  return wrap(db);
}

/** Bootstrap only, for the tests that apply migrations themselves. */
export async function createBareHarness(): Promise<Harness> {
  const db = await PGlite.create();
  await db.exec(PLATFORM_BOOTSTRAP);
  return wrap(db);
}

// ── Fixtures ──────────────────────────────────────────────────────────────
//
// Ids are fixed and readable so a failing assertion names something
// recognisable rather than a random uuid. Two shops, because half of what is
// under test is that one shop cannot reach the other.

export const SHOP_A = '11111111-1111-4111-8111-111111111111';
export const SHOP_B = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';

export const OWNER_A = '22222222-2222-4222-8222-222222222222';
export const STAFF_A = '33333333-3333-4333-8333-333333333333';
/** Staff who have been granted staff_management — the escalation test subject. */
export const MANAGER_A = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
export const OWNER_B = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';

export const ROLE_OWNER_A = '44444444-4444-4444-8444-444444444444';
export const ROLE_STAFF_A = '55555555-5555-4555-8555-555555555555';
export const ROLE_OWNER_B = '4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b';
export const ROLE_STAFF_B = '5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b';

export const T0 = '2026-08-19T09:00:00.000Z';

/**
 * Two complete shops, seeded directly rather than through the sync path.
 *
 * Direct inserts on purpose: these rows are the PRECONDITION for the tests, so
 * creating them through the very function under test would make a failure
 * ambiguous between "the guard is wrong" and "the fixture never existed".
 */
export async function seedShops(h: Harness): Promise<void> {
  await h.exec(`
    insert into shops (id, owner_id, name, phone, created_at, updated_at) values
      ('${SHOP_A}', '${OWNER_A}', 'Shop A', '+8801700000001', '${T0}', '${T0}'),
      ('${SHOP_B}', '${OWNER_B}', 'Shop B', '+8801700000009', '${T0}', '${T0}');

    insert into roles (id, shop_id, name, is_system, created_at, updated_at) values
      ('${ROLE_OWNER_A}', '${SHOP_A}', 'owner', true, '${T0}', '${T0}'),
      ('${ROLE_STAFF_A}', '${SHOP_A}', 'staff', true, '${T0}', '${T0}'),
      ('${ROLE_OWNER_B}', '${SHOP_B}', 'owner', true, '${T0}', '${T0}'),
      ('${ROLE_STAFF_B}', '${SHOP_B}', 'staff', true, '${T0}', '${T0}');

    insert into users (id, shop_id, name, phone, pin_hash, pin_set_at, role_id, is_active, created_at, updated_at) values
      ('${OWNER_A}', '${SHOP_A}', 'Owner A', '+8801700000001', 'hash-owner-a', '${T0}', '${ROLE_OWNER_A}', true, '${T0}', '${T0}'),
      ('${STAFF_A}', '${SHOP_A}', 'Staff A', '+8801700000002', 'hash-staff-a', '${T0}', '${ROLE_STAFF_A}', true, '${T0}', '${T0}'),
      ('${MANAGER_A}', '${SHOP_A}', 'Manager A', '+8801700000003', 'hash-manager-a', '${T0}', '${ROLE_STAFF_A}', true, '${T0}', '${T0}'),
      ('${OWNER_B}', '${SHOP_B}', 'Owner B', '+8801700000009', 'hash-owner-b', '${T0}', '${ROLE_OWNER_B}', true, '${T0}', '${T0}');

    insert into user_permissions (id, shop_id, user_id, key, allowed, created_at, updated_at) values
      ('66666666-6666-4666-8666-666666666666', '${SHOP_A}', '${MANAGER_A}', 'staff_management', true, '${T0}', '${T0}');
  `);
}

/** The claims the access-token hook would put in a token for this user. */
export async function claimsFor(h: Harness, appUserId: string): Promise<Record<string, unknown>> {
  const row = await h.one<{ shop_id: string; role_name: string; permission_version: number }>(
    `select u.shop_id, r.name as role_name, u.permission_version
       from users u join roles r on r.id = u.role_id
      where u.id = $1`,
    [appUserId],
  );
  return {
    sub: appUserId,
    app_metadata: {
      shop_id: row.shop_id,
      app_user_id: appUserId,
      role: row.role_name,
      permission_version: row.permission_version,
    },
  };
}

export interface ApplyResult {
  ok: boolean;
  value: string | null;
  error: string | null;
  code: string | null;
}

/**
 * One sync_apply_row call, as service_role, reporting failure as data.
 *
 * The guards under test raise rather than return, and a test that has to
 * try/catch around every call reads as though throwing were incidental. Here it
 * is the assertion.
 */
export async function applyRow(
  h: Harness,
  params: {
    table: string;
    op?: 'insert' | 'update' | 'delete';
    row: Record<string, unknown>;
    shopId: string;
    callerUserId: string;
  },
): Promise<ApplyResult> {
  try {
    const row = await h.one<{ result: string }>(
      `select sync_apply_row($1, $2, $3::jsonb, $4::uuid, $5::uuid) as result`,
      [
        params.table,
        params.op ?? 'insert',
        JSON.stringify(params.row),
        params.shopId,
        params.callerUserId,
      ],
    );
    return { ok: row.result === 'applied', value: row.result, error: null, code: null };
  } catch (error) {
    const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : null;
    return {
      ok: false,
      value: null,
      error: error instanceof Error ? error.message : String(error),
      code,
    };
  }
}
