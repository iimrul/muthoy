import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API_ROLE_PRIVILEGES_MIGRATION,
  claimsFor,
  createBareHarness,
  createHarness,
  migrationFiles,
  migrationSql,
  OWNER_A,
  OWNER_B,
  ROLE_STAFF_A,
  ROLE_STAFF_B,
  SHOP_A,
  SHOP_B,
  STAFF_A,
  seedShops,
  type Harness,
} from './harness';

// H-9 migration 34 (F12). The Phase 3 rehearsal (2026-10-15) showed the reviewed chain leaves
// anon/authenticated with SELECT on 32 public tables and INSERT/UPDATE on 9 on a project created
// with the platform's default privileges, while DEV — whose defaults give the API roles only
// REFERENCES, TRIGGER and MAINTAIN on new public tables — holds none. RLS refused every row; this
// closes the layer underneath it.
//
// Two bootstrap models stand in for the two kinds of project, both measured, never assumed:
// FRESH_PROJECT_DEFAULTS (the rehearsal's pg_default_acl) and DEV_PROJECT_DEFAULTS (DEV's, read
// 2026-09-07 and again 2026-10-15). PLATFORM_BOOTSTRAP already grants anon/authenticated all on
// tables and sequences, which is the part both platforms' fresh state shares.
//
// The model 34 enforces, in public: no principal an API session can act as — PUBLIC, anon,
// authenticated, or any role those two reach by membership (inheritance or SET ROLE, directly or
// through other roles) — holds a data privilege, a grant option, or a default privilege handing
// over future tables or sequences, apart from 20260819000000's reviewed column grants to
// authenticated. Codex's review findings (2026-10-16, two rounds) are each reproduced below.

const M34 = API_ROLE_PRIVILEGES_MIGRATION;
const TABLE_RIGHTS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] as const;
const KEPT_RIGHTS = ['REFERENCES', 'TRIGGER', 'MAINTAIN'] as const;

/** A project created on 2026-10-15: postgres's default ACL in public also covers service_role and functions. */
const FRESH_PROJECT_DEFAULTS = `
  alter default privileges in schema public grant all on tables to service_role;
  alter default privileges in schema public grant all on sequences to service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

/** DEV: tables anon/authenticated/service_role = Dxtm; sequences and functions postgres only. */
const DEV_PROJECT_DEFAULTS = `
  alter default privileges in schema public revoke select, insert, update, delete on tables from anon, authenticated;
  alter default privileges in schema public revoke all on sequences from anon, authenticated;
  alter default privileges in schema public grant truncate, references, trigger, maintain on tables to service_role;
`;

/** Bootstrap, a project model's defaults, then every migration before 34. */
async function chainBefore34(defaults: string): Promise<Harness> {
  const h = await createBareHarness();
  await h.exec(defaults);
  for (const name of migrationFiles()) {
    if (name >= M34) break;
    await h.exec(migrationSql(name));
  }
  return h;
}

type Rights = Record<string, Record<string, number>>;

/** How many public tables each API role holds each table privilege on (effective, PUBLIC included). */
async function apiRoleRights(h: Harness): Promise<Rights> {
  const rows = await h.all<{ role: string; privilege: string; tables: number }>(`
    select r.role, p.privilege, count(c.oid)::int as tables
      from unnest(array['anon', 'authenticated']) r(role)
     cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(privilege)
      left join pg_class c on c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
                          and has_table_privilege(r.role, c.oid, p.privilege)
     group by r.role, p.privilege`);
  const out: Rights = {};
  for (const row of rows) (out[row.role] ??= {})[row.privilege] = row.tables;
  return out;
}

/**
 * Every ACL entry and default-ACL entry in public, plus function ACLs, RLS flags and the schema ACL,
 * exactly as stored. With `apiRoles: false` the anon/authenticated entries are left out — what 34
 * must not change.
 */
async function aclSnapshot(h: Harness, apiRoles: boolean): Promise<Record<string, unknown>> {
  const filter = apiRoles ? 'true' : `a.grantee not in ('anon'::regrole, 'authenticated'::regrole)`;
  const row = await h.one<{ snapshot: Record<string, unknown> }>(`
    select jsonb_build_object(
      'relations', (select coalesce(jsonb_agg(x order by x::text), '[]') from (
          select jsonb_build_array(c.oid::regclass::text, a.grantee::regrole::text, a.privilege_type) as x
            from pg_class c, aclexplode(c.relacl) a
           where c.relnamespace = 'public'::regnamespace and ${filter}) s),
      'columns', (select coalesce(jsonb_agg(x order by x::text), '[]') from (
          select jsonb_build_array(att.attrelid::regclass::text, att.attname, a.grantee::regrole::text, a.privilege_type) as x
            from pg_attribute att join pg_class c on c.oid = att.attrelid, aclexplode(att.attacl) a
           where c.relnamespace = 'public'::regnamespace and ${filter}) s),
      'defaults', (select coalesce(jsonb_agg(x order by x::text), '[]') from (
          select jsonb_build_array(d.defaclrole::regrole::text, d.defaclnamespace, d.defaclobjtype::text,
                                   a.grantee::regrole::text, a.privilege_type) as x
            from pg_default_acl d, aclexplode(d.defaclacl) a where ${filter}) s),
      'functions', (select coalesce(jsonb_object_agg(p.oid::regprocedure::text, coalesce(p.proacl::text, '<default>')), '{}')
                      from pg_proc p where p.pronamespace = 'public'::regnamespace),
      'rls', (select coalesce(jsonb_object_agg(c.oid::regclass::text, array[c.relrowsecurity, c.relforcerowsecurity]), '{}')
                from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')),
      'schema', (select nspacl::text from pg_namespace where nspname = 'public')
    ) as snapshot`);
  return row.snapshot;
}

/** A relation's ACL exactly as stored; null is PostgreSQL's built-in owner-only default. */
async function storedAcl(h: Harness, relation: string): Promise<string | null> {
  return (await h.one<{ acl: string | null }>('select relacl::text as acl from pg_class where oid = $1::regclass', [relation])).acl;
}

/** The API roles' column-level grants in public, sorted — 20260819000000's users grants on DEV. */
async function apiRoleColumns(h: Harness): Promise<string[]> {
  const rows = await h.all<{ entry: string }>(`
    select att.attrelid::regclass::text || '.' || att.attname || ' ' || a.grantee::regrole::text || ' ' || a.privilege_type as entry
      from pg_attribute att join pg_class c on c.oid = att.attrelid, aclexplode(att.attacl) a
     where c.relnamespace = 'public'::regnamespace and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
     order by 1`);
  return rows.map((row) => row.entry);
}

/** Every h9_* test role, and what the API roles and those roles are members of. */
async function rolesAndMemberships(h: Harness): Promise<unknown[]> {
  return h.all(`
    select r.rolname, coalesce(string_agg(m.roleid::regrole::text, ',' order by m.roleid::regrole::text), '') as member_of
      from pg_roles r left join pg_auth_members m on m.member = r.oid
     where r.rolname in ('anon', 'authenticated') or r.rolname like 'h9\\_%'
     group by r.rolname order by 1`);
}

/**
 * The column-level grants to anon/authenticated that the reviewed history writes, read from the
 * SQL of every migration before 34 — the baseline 34 and the read-only checks must hold exactly.
 */
function historicalApiRoleColumnGrants(): string[] {
  const entries: string[] = [];
  for (const name of migrationFiles().filter((file) => file < M34)) {
    const sql = migrationSql(name).replace(/--[^\n]*/g, '');
    if (/\brevoke\s+\w+\s*\([^)]*\)\s*on\b/i.test(sql)) throw new Error(`${name} revokes a column privilege; derive the baseline by hand`);
    for (const [, privilege, columns, table, grantees] of sql.matchAll(/\bgrant\s+(insert|update|select|references)\s*\(([^)]*)\)\s*on\s+(?:table\s+)?(?:public\.)?(\w+)\s+to\s+([^;]+);/gi)) {
      for (const grantee of grantees.split(',').map((role) => role.trim().toLowerCase())) {
        if (grantee !== 'anon' && grantee !== 'authenticated') continue;
        for (const column of columns.split(',').map((col) => col.trim())) {
          entries.push(`${table}.${column} ${grantee} ${privilege.toUpperCase()}`);
        }
      }
    }
  }
  return entries.sort();
}

const PRIVILEGE_CHECKS = [
  'api_roles_no_table_wide_dml', 'api_roles_no_sequence_rights', 'api_roles_no_default_privileges',
  'api_roles_keep_schema_usage', 'every_public_table_has_rls', 'no_public_grants',
  'api_role_column_grants_exact', 'api_roles_effective_column_access_exact',
  'no_public_default_privileges', 'api_roles_no_grant_options', 'memberships_reach_no_privileges',
  'supabase_admin_public_defaults_exact', 'api_roles_cannot_create_in_public',
  'public_relations_owned_by_postgres', 'api_roles_have_no_unsafe_attributes',
] as const;
const ALL_PRIVILEGE_CHECKS_PASS = Object.fromEntries(PRIVILEGE_CHECKS.map((name) => [name, true]));
const failing = (...names: string[]) => ({ ...ALL_PRIVILEGE_CHECKS_PASS, ...Object.fromEntries(names.map((name) => [name, false])) });

/** The runbook's read-only api_role_privileges section, run in a READ ONLY transaction. */
async function privilegeChecks(h: Harness): Promise<Record<string, boolean>> {
  const text = readFileSync(resolve('backend/supabase/checks/h9_postmigration_checks.sql'), 'utf8');
  const body = text.split(/^-- section: /m).find((part) => part.split(/\r?\n/, 1)[0] === 'api_role_privileges');
  if (!body) throw new Error('missing check section api_role_privileges');
  await h.exec('begin transaction read only');
  try {
    const rows = await h.all<{ check_name: string; pass: boolean }>(body.slice(body.indexOf('\n') + 1));
    return Object.fromEntries(rows.map((row) => [row.check_name, row.pass]));
  } finally {
    await h.exec('rollback');
  }
}

/** The API roles' default-ACL privileges in public, per object type. */
async function apiRoleDefaults(h: Harness): Promise<Record<string, string[]>> {
  const rows = await h.all<{ objtype: string; privileges: string[] }>(`
    select d.defaclobjtype::text as objtype, array_agg(distinct a.privilege_type order by a.privilege_type) as privileges
      from pg_default_acl d, aclexplode(d.defaclacl) a
     where d.defaclnamespace = 'public'::regnamespace and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
     group by 1`);
  return Object.fromEntries(rows.map((row) => [row.objtype, row.privileges]));
}

/**
 * A session as PostgREST opens one: session user h9_authenticator (a member of authenticated, like
 * the platform's authenticator), SET ROLE authenticated with the caller's claims, then SET ROLE
 * `target` — which PostgreSQL allows only through a membership chain.
 */
async function viaAuthenticator<T>(h: Harness, claims: Record<string, unknown>, target: string, sql: string): Promise<T[]> {
  await h.exec('set session authorization h9_authenticator');
  try {
    await h.exec('set role authenticated');
    await h.one(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
    await h.exec(`set role ${target}`);
    return await h.all<T>(sql);
  } finally {
    await h.exec('reset role');
    // PGlite's RESET SESSION AUTHORIZATION does not return to postgres; naming it does.
    await h.exec('set session authorization postgres');
    await h.one(`select set_config('request.jwt.claims', '', false)`);
  }
}

// Unsafe configurations, each with its exact undo. The API roles are NOINHERIT, as hosted, so a
// plain membership passes nothing on by inheritance — but SET ROLE can still take the role up.
const SETROLE_PIN_HASH = `create role h9_setrole;
  grant select (pin_hash) on public.users to h9_setrole;
  grant h9_setrole to authenticated`;
const SETROLE_UNDO = 'revoke h9_setrole from authenticated; revoke select (pin_hash) on public.users from h9_setrole; drop role h9_setrole';
const INHERITED_PIN_HASH = `create role h9_inherited;
  grant select (pin_hash) on public.users to h9_inherited;
  grant h9_inherited to authenticated with inherit true`;
const INHERITED_UNDO = 'revoke h9_inherited from authenticated; revoke select (pin_hash) on public.users from h9_inherited; drop role h9_inherited';
// Two hops through a NOINHERIT middle role: h9_middle holds nothing, even by inheritance, yet SET
// ROLE can still go authenticated → h9_middle → h9_leaf. Only following memberships finds it.
const TRANSITIVE_PIN_HASH = `create role h9_leaf; grant select (pin_hash) on public.users to h9_leaf;
  create role h9_middle noinherit; grant h9_leaf to h9_middle; grant h9_middle to authenticated`;
const TRANSITIVE_UNDO = `revoke h9_middle from authenticated; revoke h9_leaf from h9_middle;
  revoke select (pin_hash) on public.users from h9_leaf; drop role h9_middle; drop role h9_leaf`;
const INHERITED_GRANT_OPTION = `create role h9_grantor;
  grant update (phone) on public.users to h9_grantor with grant option;
  grant h9_grantor to authenticated with inherit true`;
const SETROLE_GRANT_OPTION = INHERITED_GRANT_OPTION.replace(' with inherit true', '');
const GRANTOR_UNDO = 'revoke h9_grantor from authenticated; revoke update (phone) on public.users from h9_grantor cascade; drop role h9_grantor';
const FUTURE_FOR_REACHED_ROLE = `create role h9_future; grant h9_future to authenticated;
  alter default privileges in schema public grant select on tables to h9_future`;
const FUTURE_FOR_REACHED_ROLE_UNDO = `alter default privileges in schema public revoke select on tables from h9_future;
  revoke h9_future from authenticated; drop role h9_future`;
const PUBLIC_FUTURE_TABLES = 'alter default privileges in schema public grant select on tables to public';
const PUBLIC_FUTURE_TABLES_UNDO = 'alter default privileges in schema public revoke select on tables from public';
const PUBLIC_FUTURE_SEQUENCES = 'alter default privileges grant usage on sequences to public';
const PUBLIC_FUTURE_SEQUENCES_UNDO = 'alter default privileges revoke usage on sequences from public';
const OTHER_CREATOR_PUBLIC_DEFAULT = `create role h9_creator; grant create on schema public to h9_creator;
  alter default privileges for role h9_creator in schema public grant select on tables to public`;
const OTHER_CREATOR_PUBLIC_DEFAULT_UNDO = `alter default privileges for role h9_creator in schema public revoke select on tables from public;
  revoke create on schema public from h9_creator; drop role h9_creator`;

// Configurations the model allows: nothing in public reachable, or a policy deliberately deferred.
const ALLOWED: Array<[string, string, string]> = [
  ['a membership into a role holding nothing in public',
    'create role h9_empty; grant h9_empty to authenticated', 'revoke h9_empty from authenticated; drop role h9_empty'],
  ['a PUBLIC EXECUTE default on future functions — the deferred function policy',
    'alter default privileges in schema public grant execute on functions to public',
    'alter default privileges in schema public revoke execute on functions from public'],
];

describe('a project created with the platform defaults (F12)', () => {
  let h: Harness;
  let before: Rights;
  let othersBefore: unknown;
  let columnsBefore: string[];
  let checksBefore: Record<string, boolean>;

  beforeAll(async () => {
    h = await chainBefore34(FRESH_PROJECT_DEFAULTS);
    // A sequence made under the platform defaults: the API roles get rwU on it, as they would.
    await h.exec('create sequence public.h9_platform_sequence');
    before = await apiRoleRights(h);
    othersBefore = await aclSnapshot(h, false);
    columnsBefore = await apiRoleColumns(h);
    checksBefore = await privilegeChecks(h);
    await h.exec(migrationSql(M34));
    await seedShops(h);
  }, 180_000);
  afterAll(async () => { await h?.close(); });

  it('reproduces F12 before migration 34: SELECT on 32 tables, INSERT and UPDATE on 9', () => {
    for (const role of ['anon', 'authenticated']) {
      expect(before[role]).toMatchObject({ SELECT: 32, INSERT: 9, UPDATE: 9, DELETE: 0, TRUNCATE: 0 });
    }
  });

  it('fails the runbook\'s read-only api_role_privileges checks before 34 and passes all of them after', async () => {
    expect(checksBefore).toEqual(failing(
      'api_roles_no_table_wide_dml', 'api_roles_no_sequence_rights',
      'api_roles_no_default_privileges', 'api_roles_effective_column_access_exact',
    ));
    expect(await privilegeChecks(h)).toEqual(ALL_PRIVILEGE_CHECKS_PASS);
  });

  it('leaves anon and authenticated no SELECT, INSERT, UPDATE, DELETE or TRUNCATE on any table', async () => {
    const after = await apiRoleRights(h);
    for (const role of ['anon', 'authenticated']) {
      for (const right of TABLE_RIGHTS) expect(after[role][right], `${role} ${right}`).toBe(0);
      // REFERENCES, TRIGGER and MAINTAIN stay exactly as they were — DEV's `xtm`.
      for (const right of KEPT_RIGHTS) expect(after[role][right], `${role} ${right}`).toBe(before[role][right]);
    }
  });

  it('takes the API roles off a platform-default sequence and keeps the owner and service_role on it', async () => {
    const acl = await storedAcl(h, 'public.h9_platform_sequence');
    expect(acl).not.toMatch(/(^|[{,])(anon|authenticated)=/);
    expect(acl).toMatch(/[{,]postgres=rwU\/postgres[,}]/);
    expect(acl).toMatch(/[{,]service_role=rwU\/postgres[,}]/);
  });

  it('keeps 20260819000000\'s column-level users grants for authenticated exactly, as on DEV', async () => {
    // 13 INSERT and 12 UPDATE columns: every users column but permission_version (id is insert-only).
    expect(columnsBefore).toHaveLength(25);
    expect(columnsBefore.every((entry) => entry.startsWith('users.') && / authenticated (INSERT|UPDATE)$/.test(entry))).toBe(true);
    expect(columnsBefore.some((entry) => entry.startsWith('users.permission_version '))).toBe(false);
    expect(await apiRoleColumns(h)).toEqual(columnsBefore);
  });

  it('takes that baseline from the reviewed history: exactly the column grants migrations 1–33 write', () => {
    expect(historicalApiRoleColumnGrants()).toEqual([...columnsBefore].sort());
  });

  it('changes nothing else: service_role, supabase_auth_admin and postgres grants, function ACLs, RLS, schema usage', async () => {
    expect(await aclSnapshot(h, false)).toEqual(othersBefore);
    expect(await h.one(`select has_schema_privilege('anon', 'public', 'usage') as anon,
                               has_schema_privilege('authenticated', 'public', 'usage') as authenticated`))
      .toEqual({ anon: true, authenticated: true });
  });

  it('narrows the defaults to DEV\'s: future tables, sequences and functions give the API roles nothing', async () => {
    expect(await apiRoleDefaults(h)).toEqual({ r: ['MAINTAIN', 'REFERENCES', 'TRIGGER'] });
    await h.exec('begin');
    try {
      await h.exec(`
        create table public.h9_future_table (id integer primary key);
        alter table public.h9_future_table enable row level security;
        create sequence public.h9_future_sequence;
        create function public.h9_future_function() returns integer language sql as 'select 1';`);
      const row = await h.one<Record<string, boolean>>(`
        select has_table_privilege('anon', 'public.h9_future_table', 'select') as anon_select,
               has_table_privilege('authenticated', 'public.h9_future_table', 'insert') as authenticated_insert,
               has_table_privilege('service_role', 'public.h9_future_table', 'select') as service_role_select,
               has_sequence_privilege('anon', 'public.h9_future_sequence', 'usage') as anon_sequence,
               has_sequence_privilege('service_role', 'public.h9_future_sequence', 'usage') as service_role_sequence,
               exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                        where p.oid = 'public.h9_future_function()'::regprocedure
                          and a.grantee in ('anon'::regrole, 'authenticated'::regrole)) as api_role_execute_entry`);
      expect(row).toEqual({
        anon_select: false, authenticated_insert: false, service_role_select: true,
        anon_sequence: false, service_role_sequence: true, api_role_execute_entry: false,
      });
    } finally {
      await h.exec('rollback');
    }
  });

  it('keeps every routine the API roles rely on working', async () => {
    const owner = await claimsFor(h, OWNER_A);
    const authenticated = await h.as('authenticated', owner, () => h.one<Record<string, unknown>>(`
      select public.auth_is_live_user() as live, public.auth_is_owner() as owner,
             public.auth_has_permission('staff_management') as permission,
             public.b4_auth_shop_write_permitted() as write_permitted,
             public.auth_can_access_sale_attachment_path('${SHOP_A}/rehearsal.jpg') as attachment`));
    expect(authenticated).toMatchObject({ live: true, owner: true });
    for (const value of Object.values(authenticated)) expect(typeof value).toBe('boolean');

    const event = { user_id: '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a', claims: { app_metadata: { shop_id: SHOP_A } } };
    const hook = await h.as('supabase_auth_admin', null, () =>
      h.one<{ out: unknown }>('select public.custom_access_token_hook($1::jsonb) as out', [JSON.stringify(event)]));
    expect(hook.out).toEqual(event);

    const service = await h.as('service_role', null, () => h.one<Record<string, number>>(`
      select (select count(*)::int from public.shops) as shops, (select count(*)::int from public.users) as users,
             (select count(*)::int from public.roles) as roles, (select count(*)::int from public.sales) as sales`));
    expect(service).toEqual({ shops: 2, users: 4, roles: 4, sales: 0 });
    expect(await h.one(`
      select has_function_privilege('service_role', 'public.sync_cleanup_incomplete_operations()', 'execute') as cleanup,
             has_function_privilege('service_role', 'public.sync_apply_row(text,text,jsonb,uuid,uuid)', 'execute') as apply`))
      .toEqual({ cleanup: true, apply: true });
  });

  it('refuses direct table access by anon and authenticated with 42501', async () => {
    const owner = await claimsFor(h, OWNER_A);
    const attempts: Array<[string, Record<string, unknown> | null, string]> = [
      ['anon', null, 'select * from public.shops'],
      ['anon', null, `insert into public.shops (id, owner_id, name, phone) values (gen_random_uuid(), gen_random_uuid(), 'x', '+8801700000099')`],
      ['authenticated', owner, 'select * from public.users'],
      ['authenticated', owner, 'select pin_hash from public.users'],
      ['authenticated', owner, 'update public.batches set updated_at = now()'],
      ['authenticated', owner, `delete from public.shops where id = '${SHOP_A}'`],
    ];
    for (const [role, claims, sql] of attempts) {
      await expect(h.as(role, claims, () => h.all(sql)), `${role}: ${sql}`).rejects.toMatchObject({ code: '42501' });
    }
    expect(await h.one('select count(*)::int as shops from public.shops')).toEqual({ shops: 2 });
  });

  it('keeps the reviewed users column grants narrow: no other column, no other shop, no Staff write', async () => {
    const owner = await claimsFor(h, OWNER_A);
    const staff = await claimsFor(h, STAFF_A);
    const usersOf = (shop: string) => h.all<{ name: string }>(
      'select id, name, phone, permission_version from public.users where shop_id = $1 order by id', [shop]);
    const shopA = await usersOf(SHOP_A);
    const shopB = await usersOf(SHOP_B);
    // permission_version is the column 20260819000000 keeps from authenticated; a targeted write
    // needs SELECT on its WHERE columns, which the API roles no longer hold; and no insert crosses
    // into another shop.
    for (const sql of [
      'update public.users set permission_version = 99',
      `insert into public.users (id, shop_id, name, phone, role_id, permission_version)
         values (gen_random_uuid(), '${SHOP_A}', 'unreviewed column', '+8801700000098', '${ROLE_STAFF_A}', 5)`,
      `update public.users set name = 'targeted' where id = '${OWNER_B}'`,
      `insert into public.users (id, shop_id, name, phone, role_id, is_active)
         values (gen_random_uuid(), '${SHOP_B}', 'cross-shop', '+8801700000097', '${ROLE_STAFF_B}', true)`,
    ]) {
      await expect(h.as('authenticated', owner, () => h.all(sql)), sql).rejects.toMatchObject({ code: '42501' });
    }
    expect(await usersOf(SHOP_A)).toEqual(shopA);
    expect(await usersOf(SHOP_B)).toEqual(shopB);

    await h.exec('begin');
    try {
      // Only an Owner may update users (RLS): Staff's untargeted write reaches no row.
      await h.as('authenticated', staff, () => h.all(`update public.users set name = 'staff-write'`));
      expect(await usersOf(SHOP_A)).toEqual(shopA);
      // The Owner's untargeted write stays inside the Owner's shop.
      await h.as('authenticated', owner, () => h.all(`update public.users set name = 'owner-write'`));
      expect((await usersOf(SHOP_A)).map((row) => row.name)).toEqual(shopA.map(() => 'owner-write'));
      expect(await usersOf(SHOP_B)).toEqual(shopB);
    } finally {
      await h.exec('rollback');
    }
  });

  it('is idempotent: running it again changes nothing at all', async () => {
    const snapshot = await aclSnapshot(h, true);
    await h.exec(migrationSql(M34));
    expect(await aclSnapshot(h, true)).toEqual(snapshot);
  });
});

describe('a project created like DEV (narrow defaults)', () => {
  let h: Harness;
  let before: unknown;

  beforeAll(async () => {
    h = await chainBefore34(DEV_PROJECT_DEFAULTS);
    // Under DEV's defaults a new sequence is owner-only: its ACL is NULL, the built-in default.
    await h.exec('create sequence public.h9_owner_only_sequence');
    before = await aclSnapshot(h, true);
    await h.exec(migrationSql(M34));
    await seedShops(h);
    // The platform's authenticator, as far as membership goes: the session user PostgREST opens.
    await h.exec('create role h9_authenticator noinherit; grant authenticated to h9_authenticator');
  }, 180_000);
  afterAll(async () => { await h?.close(); });

  it('is a no-op: every ACL, default and RLS flag is unchanged', async () => {
    expect(await aclSnapshot(h, true)).toEqual(before);
  });

  it('leaves an owner-only sequence exactly as it is — no false abort, no ACL written out', async () => {
    expect(await storedAcl(h, 'public.h9_owner_only_sequence')).toBeNull();
    await h.exec(migrationSql(M34));
    expect(await storedAcl(h, 'public.h9_owner_only_sequence')).toBeNull();
    expect(await aclSnapshot(h, true)).toEqual(before);
  });

  it('already holds DEV\'s baseline: no SELECT, INSERT, UPDATE, DELETE or TRUNCATE for the API roles', async () => {
    const rights = await apiRoleRights(h);
    for (const role of ['anon', 'authenticated']) {
      for (const right of TABLE_RIGHTS) expect(rights[role][right], `${role} ${right}`).toBe(0);
    }
  });

  it('passes every read-only api_role_privileges check', async () => {
    expect(await privilegeChecks(h)).toEqual(ALL_PRIVILEGE_CHECKS_PASS);
  });

  it('Codex reproduction: SELECT(pin_hash) granted to PUBLIC after 34 lets Staff read the Owner\'s PIN hash — the checks catch it', async () => {
    const staff = await claimsFor(h, STAFF_A);
    const readHashes = () => h.as('authenticated', staff, () =>
      h.all<{ pin_hash: string }>('select pin_hash from public.users order by pin_hash'));
    await expect(readHashes()).rejects.toMatchObject({ code: '42501' });
    await h.exec('grant select (pin_hash) on public.users to public');
    try {
      expect((await readHashes()).map((row) => row.pin_hash)).toContain('hash-owner-a');
      expect(await privilegeChecks(h)).toEqual(failing('no_public_grants', 'api_roles_effective_column_access_exact'));
    } finally {
      await h.exec('revoke select (pin_hash) on public.users from public');
    }
    await expect(readHashes()).rejects.toMatchObject({ code: '42501' });
  });

  it('Codex reproduction: a plain membership lets an API session SET ROLE into a PIN-hash reader — the checks catch it', async () => {
    const staff = await claimsFor(h, STAFF_A);
    const read = () => viaAuthenticator<{ pin_hash: string }>(h, staff, 'h9_setrole', 'select pin_hash from public.users order by pin_hash');
    await h.exec(SETROLE_PIN_HASH);
    try {
      expect((await read()).map((row) => row.pin_hash)).toContain('hash-owner-a');
      expect(await privilegeChecks(h)).toEqual(failing('memberships_reach_no_privileges'));
    } finally {
      await h.exec(SETROLE_UNDO);
    }
    // The same role without the membership: nothing reaches it, and the session cannot take it up.
    await h.exec('create role h9_setrole; grant select (pin_hash) on public.users to h9_setrole');
    try {
      await expect(read()).rejects.toThrow(/permission denied to set role/);
      expect(await privilegeChecks(h)).toEqual(ALL_PRIVILEGE_CHECKS_PASS);
    } finally {
      await h.exec('revoke select (pin_hash) on public.users from h9_setrole; drop role h9_setrole');
    }
  });

  it('follows memberships through a role that holds nothing: SET ROLE two hops away still reads PIN hashes — the checks catch it', async () => {
    const staff = await claimsFor(h, STAFF_A);
    await h.exec(TRANSITIVE_PIN_HASH);
    try {
      expect(await h.one(`select has_column_privilege('h9_middle', 'public.users', 'pin_hash', 'SELECT') as held`))
        .toEqual({ held: false });
      const rows = await viaAuthenticator<{ pin_hash: string }>(h, staff, 'h9_leaf', 'select pin_hash from public.users order by pin_hash');
      expect(rows.map((row) => row.pin_hash)).toContain('hash-owner-a');
      expect(await privilegeChecks(h)).toEqual(failing('memberships_reach_no_privileges'));
    } finally {
      await h.exec(TRANSITIVE_UNDO);
    }
  });

  it('Codex reproduction: UPDATE(phone) WITH GRANT OPTION inherited by authenticated lets it grant onward — the checks catch it', async () => {
    const grantOnward = () => h.as('authenticated', null, () => h.exec('grant update (phone) on public.users to anon'));
    const anonUpdatesPhone = async () =>
      (await h.one<{ held: boolean }>(`select has_column_privilege('anon', 'public.users', 'phone', 'UPDATE') as held`)).held;
    // The reviewed grant carries no grant option: PostgreSQL grants nothing onward.
    await grantOnward();
    expect(await anonUpdatesPhone()).toBe(false);
    await h.exec(INHERITED_GRANT_OPTION);
    try {
      expect(await privilegeChecks(h)).toEqual(failing('api_roles_no_grant_options', 'memberships_reach_no_privileges'));
      await grantOnward();
      expect(await anonUpdatesPhone()).toBe(true);
    } finally {
      await h.exec(GRANTOR_UNDO); // CASCADE takes the onward grant with it
    }
    expect(await anonUpdatesPhone()).toBe(false);
    expect(await privilegeChecks(h)).toEqual(ALL_PRIVILEGE_CHECKS_PASS);
  });

  it('Codex reproduction: a PUBLIC default gives anon SELECT on the next table postgres creates — the checks catch it', async () => {
    await h.exec(PUBLIC_FUTURE_TABLES);
    try {
      expect(await privilegeChecks(h)).toEqual(failing('no_public_default_privileges'));
      await h.exec('begin');
      try {
        await h.exec('create table public.h9_next (id integer); alter table public.h9_next enable row level security');
        expect(await h.one(`select has_table_privilege('anon', 'public.h9_next', 'select') as held`)).toEqual({ held: true });
      } finally {
        await h.exec('rollback');
      }
    } finally {
      await h.exec(PUBLIC_FUTURE_TABLES_UNDO);
    }
    expect(await privilegeChecks(h)).toEqual(ALL_PRIVILEGE_CHECKS_PASS);
  });

  // Each drift is caught by exactly the checks that describe it, and undone before the next.
  it.each([
    ['a table-wide grant', 'grant select on public.batches to authenticated',
      'revoke select on public.batches from authenticated',
      ['api_roles_no_table_wide_dml', 'api_roles_effective_column_access_exact']],
    ['a sequence grant',
      'create sequence public.h9_check_sequence; grant usage on sequence public.h9_check_sequence to anon',
      'drop sequence public.h9_check_sequence', ['api_roles_no_sequence_rights']],
    ['a default-privilege grant to anon', 'alter default privileges in schema public grant select on tables to anon',
      'alter default privileges in schema public revoke select on tables from anon', ['api_roles_no_default_privileges']],
    ['lost schema usage', 'revoke usage on schema public from public, authenticated',
      'grant usage on schema public to public, authenticated', ['api_roles_keep_schema_usage']],
    ['a table without RLS', 'alter table public.shops disable row level security',
      'alter table public.shops enable row level security', ['every_public_table_has_rls']],
    ['a relation granted to PUBLIC', 'grant references on public.shops to public',
      'revoke references on public.shops from public', ['no_public_grants']],
    ['a column granted to PUBLIC', 'grant select (pin_hash) on public.users to public',
      'revoke select (pin_hash) on public.users from public',
      ['no_public_grants', 'api_roles_effective_column_access_exact']],
    ['UPDATE(phone) swapped for UPDATE(permission_version)',
      'revoke update (phone) on public.users from authenticated; grant update (permission_version) on public.users to authenticated',
      'revoke update (permission_version) on public.users from authenticated; grant update (phone) on public.users to authenticated',
      ['api_role_column_grants_exact', 'api_roles_effective_column_access_exact']],
    ['an approved column grant made grantable',
      'revoke update (phone) on public.users from authenticated; grant update (phone) on public.users to authenticated with grant option',
      'revoke update (phone) on public.users from authenticated cascade; grant update (phone) on public.users to authenticated',
      ['api_role_column_grants_exact', 'api_roles_no_grant_options']],
    ['an approved column grant removed', 'revoke insert (id) on public.users from authenticated',
      'grant insert (id) on public.users to authenticated',
      ['api_role_column_grants_exact', 'api_roles_effective_column_access_exact']],
    ['an unreviewed column grant added', 'grant select (id) on public.shops to authenticated',
      'revoke select (id) on public.shops from authenticated',
      ['api_role_column_grants_exact', 'api_roles_effective_column_access_exact']],
    ['a membership authenticated can SET ROLE into a PIN-hash reader', SETROLE_PIN_HASH, SETROLE_UNDO,
      ['memberships_reach_no_privileges']],
    ['a column privilege inherited through a role', INHERITED_PIN_HASH, INHERITED_UNDO,
      ['api_roles_effective_column_access_exact', 'memberships_reach_no_privileges']],
    ['a transitive membership', TRANSITIVE_PIN_HASH, TRANSITIVE_UNDO, ['memberships_reach_no_privileges']],
    ['anon able to SET ROLE to authenticated', 'grant authenticated to anon', 'revoke authenticated from anon',
      ['memberships_reach_no_privileges']],
    ['UPDATE(phone) WITH GRANT OPTION inherited by authenticated', INHERITED_GRANT_OPTION, GRANTOR_UNDO,
      ['api_roles_no_grant_options', 'memberships_reach_no_privileges']],
    ['a grant option on a kept privilege held directly', 'grant trigger on public.shops to anon with grant option',
      'revoke grant option for trigger on public.shops from anon', ['api_roles_no_grant_options']],
    ['the same grant option reachable by SET ROLE only', SETROLE_GRANT_OPTION, GRANTOR_UNDO,
      ['memberships_reach_no_privileges']],
    ['a future-table default for a role authenticated reaches', FUTURE_FOR_REACHED_ROLE, FUTURE_FOR_REACHED_ROLE_UNDO,
      ['memberships_reach_no_privileges']],
    ['a PUBLIC default on future tables', PUBLIC_FUTURE_TABLES, PUBLIC_FUTURE_TABLES_UNDO, ['no_public_default_privileges']],
    ['a global PUBLIC default on future sequences', PUBLIC_FUTURE_SEQUENCES, PUBLIC_FUTURE_SEQUENCES_UNDO,
      ['no_public_default_privileges']],
    ['a PUBLIC default of another role that can create in public', OTHER_CREATOR_PUBLIC_DEFAULT,
      OTHER_CREATOR_PUBLIC_DEFAULT_UNDO, ['no_public_default_privileges']],
  ])('catches %s with exactly the checks that describe it', async (_label, drift, undo, names) => {
    expect(await privilegeChecks(h)).toEqual(ALL_PRIVILEGE_CHECKS_PASS);
    await h.exec(drift);
    try {
      expect(await privilegeChecks(h)).toEqual(failing(...names));
    } finally {
      await h.exec(undo);
    }
  });

  it.each(ALLOWED)('flags nothing for %s', async (_label, setup, undo) => {
    await h.exec(setup);
    try {
      expect(await privilegeChecks(h)).toEqual(ALL_PRIVILEGE_CHECKS_PASS);
    } finally {
      await h.exec(undo);
    }
  });
});

describe('every unsafe configuration aborts 34 with nothing changed — no transaction around it', () => {
  let h: Harness;
  let pristine: unknown;
  const UPDATE_COLUMNS = 'created_at, updated_at, is_deleted, deleted_at, deleted_by, shop_id, name, phone, pin_hash, pin_set_at, role_id, is_active';
  const NOT_REVIEWED = /not exactly 20260819000000's reviewed set/;
  const PUBLIC_DEFAULT = /a default privilege gives PUBLIC access to future tables or sequences in public/;
  const GRANT_OPTION = /hold a grant option in public, directly or through a role/;
  const REACH = /reach by membership \(SET ROLE or inheritance\) holds privileges in public/;

  const state = async () => ({
    acl: await aclSnapshot(h, true), rights: await apiRoleRights(h),
    columns: await apiRoleColumns(h), roles: await rolesAndMemberships(h),
  });

  beforeAll(async () => {
    h = await chainBefore34(FRESH_PROJECT_DEFAULTS);
    pristine = await state();
  }, 180_000);
  afterAll(async () => { await h?.close(); });

  it.each([
    ['it runs as another role', 'set role service_role', 'reset role', /must run as the postgres migration role/],
    ['a public table belongs to another role',
      `create role h9_other_owner; create table public.h9_foreign (id integer);
       alter table public.h9_foreign enable row level security; alter table public.h9_foreign owner to h9_other_owner`,
      'drop table public.h9_foreign; drop role h9_other_owner', /must be owned by postgres/],
    ['a public table has no row level security', 'create table public.h9_open (id integer)', 'drop table public.h9_open',
      /row level security/],
    ['a public table is granted to PUBLIC', 'grant select on public.shops to public', 'revoke select on public.shops from public',
      /a relation in public grants a privilege to PUBLIC/],
    ['a column is granted to PUBLIC', 'grant select (pin_hash) on public.users to public',
      'revoke select (pin_hash) on public.users from public', /a column in public grants a privilege to PUBLIC/],
    ['a PUBLIC default on future tables — Codex', PUBLIC_FUTURE_TABLES, PUBLIC_FUTURE_TABLES_UNDO, PUBLIC_DEFAULT],
    ['a global PUBLIC default on future sequences — Codex', PUBLIC_FUTURE_SEQUENCES, PUBLIC_FUTURE_SEQUENCES_UNDO, PUBLIC_DEFAULT],
    ['a PUBLIC default of another role that can create in public', OTHER_CREATOR_PUBLIC_DEFAULT,
      OTHER_CREATOR_PUBLIC_DEFAULT_UNDO, PUBLIC_DEFAULT],
    ['UPDATE(phone) is swapped for UPDATE(permission_version)',
      'revoke update (phone) on public.users from authenticated; grant update (permission_version) on public.users to authenticated',
      'revoke update (permission_version) on public.users from authenticated; grant update (phone) on public.users to authenticated',
      NOT_REVIEWED],
    ['an approved column grant carries grant option',
      'revoke update (phone) on public.users from authenticated; grant update (phone) on public.users to authenticated with grant option',
      'revoke update (phone) on public.users from authenticated cascade; grant update (phone) on public.users to authenticated',
      NOT_REVIEWED],
    ['an approved column grant is missing', 'revoke insert (id) on public.users from authenticated',
      'grant insert (id) on public.users to authenticated', NOT_REVIEWED],
    ['an API role holds an unreviewed column grant', 'grant select (id) on public.shops to authenticated',
      'revoke select (id) on public.shops from authenticated', NOT_REVIEWED],
    ['a reviewed column grant would be stripped by the table-wide revoke', 'grant update on public.users to authenticated',
      `revoke update on public.users from authenticated; grant update (${UPDATE_COLUMNS}) on public.users to authenticated`,
      /would be stripped by the table-wide revoke/],
    ['UPDATE(phone) WITH GRANT OPTION is inherited by authenticated — Codex', INHERITED_GRANT_OPTION, GRANTOR_UNDO, GRANT_OPTION],
    ['anon holds a grant option on a kept privilege', 'grant trigger on public.shops to anon with grant option',
      'revoke grant option for trigger on public.shops from anon', GRANT_OPTION],
    ['authenticated can SET ROLE into a PIN-hash reader — Codex', SETROLE_PIN_HASH, SETROLE_UNDO, REACH],
    ['a column privilege is inherited through a role', INHERITED_PIN_HASH, INHERITED_UNDO, REACH],
    ['a PIN-hash reader is reached through two memberships', TRANSITIVE_PIN_HASH, TRANSITIVE_UNDO, REACH],
    ['anon can SET ROLE to authenticated', 'grant authenticated to anon', 'revoke authenticated from anon', REACH],
    ['a grant option is reachable by SET ROLE only', SETROLE_GRANT_OPTION, GRANTOR_UNDO, REACH],
    ['a role authenticated reaches gets future tables by default', FUTURE_FOR_REACHED_ROLE, FUTURE_FOR_REACHED_ROLE_UNDO, REACH],
    ['a privilege granted to anon by another grantor survives the revoke — so 34 fails after acting',
      `create role h9_delegate; grant select on public.shops to h9_delegate with grant option;
       set role h9_delegate; grant select on public.shops to anon; reset role`,
      'revoke select on public.shops from h9_delegate cascade; drop role h9_delegate',
      /still hold a table privilege in public/],
  ])('%s', async (_label, setup, undo, message) => {
    expect(await state()).toEqual(pristine);
    await h.exec(setup);
    try {
      const before = await state();
      // First inside a transaction that is always rolled back, so a 34 that wrongly applies
      // cannot leak into the next case.
      await h.exec('begin');
      try {
        await expect(h.exec(migrationSql(M34))).rejects.toThrow(message);
      } finally {
        await h.exec('rollback');
      }
      // Then as a runner would run it, with no transaction around it: the DO block alone must
      // leave nothing changed.
      await expect(h.exec(migrationSql(M34))).rejects.toThrow(message);
      expect(await state()).toEqual(before);
    } finally {
      await h.exec(undo);
    }
  });

  it.each(ALLOWED)('still applies with %s', async (_label, setup) => {
    expect(await state()).toEqual(pristine);
    await h.exec('begin');
    try {
      await h.exec(setup);
      await expect(h.exec(migrationSql(M34))).resolves.toBeUndefined();
      expect((await apiRoleRights(h)).authenticated.SELECT).toBe(0);
    } finally {
      await h.exec('rollback');
    }
  });

  it('is left exactly as it was after every refusal, and 34 then applies', async () => {
    expect(await state()).toEqual(pristine);
    await h.exec('begin');
    try {
      await expect(h.exec(migrationSql(M34))).resolves.toBeUndefined();
    } finally {
      await h.exec('rollback');
    }
  });
});

describe('the shared harness keeps the RLS suites testing policies', () => {
  it('createHarness runs migration 34 and restores exactly the API roles\' pre-34 privileges', async () => {
    const shared = await createHarness();
    const reference = await chainBefore34('select 1');
    try {
      const apiOnly = async (target: Harness) => {
        const snapshot = await aclSnapshot(target, true);
        const api = (rows: unknown) => (rows as string[][]).filter((row) => /^(anon|authenticated)$/.test(String(row.at(-2))));
        return { relations: api(snapshot.relations), columns: api(snapshot.columns), defaults: api(snapshot.defaults) };
      };
      expect(await apiOnly(shared)).toEqual(await apiOnly(reference));
    } finally {
      await shared.close();
      await reference.close();
    }
  }, 300_000);
});
