import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PLATFORM_BOOTSTRAP, migrationFiles, migrationSql, API_ROLE_PRIVILEGES_MIGRATION, type Harness } from './harness';

export const M34 = API_ROLE_PRIVILEGES_MIGRATION;
export const R3 = readFileSync('backend/supabase/pgtest/fixtures/h9-migration34-r3.sql', 'utf8');
// Explicit opt-in negative-control run. Never changes production SQL or a hosted database.
export const CURRENT = () => process.env.H9_F12_REVIEW_RED === '1' ? R3 : migrationSql(M34);
export const CHECK_NAMES = [
  'api_roles_no_table_wide_dml', 'api_roles_no_sequence_rights', 'api_roles_no_default_privileges',
  'api_roles_keep_schema_usage', 'every_public_table_has_rls', 'no_public_grants',
  'api_role_column_grants_exact', 'api_roles_effective_column_access_exact',
  'no_public_default_privileges', 'api_roles_no_grant_options', 'memberships_reach_no_privileges',
  'supabase_admin_public_defaults_exact', 'api_roles_cannot_create_in_public',
  'public_relations_owned_by_postgres', 'api_roles_have_no_unsafe_attributes',
] as const;
export type Profile = 'fresh' | 'DEV' | 'synthetic';
export interface SecurityHarness extends Harness {
  superExec(sql: string): Promise<void>;
}
const profiles = JSON.parse(readFileSync('backend/supabase/pgtest/fixtures/h9-default-profiles.json', 'utf8')) as
  Record<'fresh' | 'DEV', Array<{ key: string; value: string }>>;
const identifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const rights: Record<string, Record<string, string>> = {
  r: { a: 'INSERT', r: 'SELECT', w: 'UPDATE', d: 'DELETE', D: 'TRUNCATE', x: 'REFERENCES', t: 'TRIGGER', m: 'MAINTAIN' },
  S: { r: 'SELECT', w: 'UPDATE', U: 'USAGE' }, f: { X: 'EXECUTE' },
};

/** Replays all 24/27 saved default rows, including grantors/options and non-public schemas. */
function profileSql(profile: 'fresh' | 'DEV'): string {
  return profiles[profile].map(({ key, value }) => {
    const [creator, schema, kind] = key.split(':');
    return `create schema if not exists ${identifier(schema)};\n` + value.split(',').map((item) => {
      const match = /^([^=]*)=([^/]+)\/(.+)$/.exec(item);
      if (!match || match[3] !== creator) throw new Error('unrecognized measured ACL');
      const grantee = match[1] ? identifier(match[1]) : 'public';
      return [...match[2].matchAll(/([A-Za-z])(\*)?/g)].map(([, right, option]) => {
        const privilege = rights[kind]?.[right];
        if (!privilege) throw new Error('unrecognized privilege');
        const type = kind === 'r' ? 'tables' : kind === 'S' ? 'sequences' : 'functions';
        return `alter default privileges for role ${identifier(creator)} in schema ${identifier(schema)} grant ${privilege} on ${type} to ${grantee}${option ? ' with grant option' : ''};`;
      }).join('\n');
    }).join('\n');
  }).join('\n');
}

async function assertMeasuredProfile(db: PGlite, profile: 'fresh' | 'DEV') {
  const expected = profiles[profile].flatMap(({key,value}) => {
    const [creator,schema,kind] = key.split(':');
    return value.split(',').flatMap((item) => {
      const [,grantee,privileges,grantor] = /^([^=]*)=([^/]+)\/(.+)$/.exec(item)!;
      return [...privileges.matchAll(/([A-Za-z])(\*)?/g)].map(([,right,option]) =>
        JSON.stringify([creator,schema,kind,grantor,grantee || 'PUBLIC',rights[kind][right],Boolean(option)]));
    });
  }).sort();
  const measured = (await db.query<{item: unknown}>(`select jsonb_build_array(
    pg_get_userbyid(d.defaclrole),n.nspname,d.defaclobjtype::text,pg_get_userbyid(a.grantor),
    case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable) item
    from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace,aclexplode(d.defaclacl) a`))
    .rows.map((row) => JSON.stringify(row.item)).sort();
  if (JSON.stringify(measured) !== JSON.stringify(expected)) throw new Error('fixture default ACL replay differs from saved semantic items');
}

/** Isolated model; the shared RLS harness and its restoration behavior remain untouched. */
export async function model(profile: Profile = 'fresh', nonsuper = false, apply = true): Promise<SecurityHarness> {
  const db = await PGlite.create();
  const platform = profile === 'synthetic' ? 'h9_platform' : 'supabase_admin';
  let stage = 'platform bootstrap';
  try {
    await db.exec(`create role ${platform} superuser; set session authorization ${platform};`);
    if (nonsuper) {
      await db.exec(`alter role postgres rename to h9_bootstrap;
        create role postgres nosuperuser login createrole createdb bypassrls;
        do $$ begin execute format('alter database %I owner to postgres', current_database()); end $$;`);
    }
    await db.exec(PLATFORM_BOOTSTRAP);
    await db.exec(`alter default privileges in schema public revoke all on tables from anon, authenticated;
      alter default privileges in schema public revoke all on sequences from anon, authenticated;
      grant usage on schema auth to postgres;
      create role h9_authenticator noinherit;
      grant anon, authenticated, service_role to h9_authenticator;`);
    if (profile !== 'synthetic') {
      const identities = new Set<string>();
      for (const row of profiles[profile]) {
        identities.add(row.key.split(':')[0]);
        for (const item of row.value.split(',')) {
          const grantee = item.slice(0, item.indexOf('='));
          if (grantee) identities.add(grantee);
        }
      }
      for (const role of identities) {
        const exists = await db.query<{ present: string | null }>('select to_regrole($1)::text present', [role]);
        if (!exists.rows[0].present) await db.exec(`create role ${identifier(role)} nologin`);
      }
      stage = 'measured defaults';
      await db.exec(profileSql(profile));
      // Historical migration 3 resolves storage.objects even in this empty storage model.
      // Schema USAGE permits name lookup; it grants no data or object-creation rights.
      await db.exec('grant usage on schema storage to postgres');
      await assertMeasuredProfile(db, profile);
    }
    await db.exec('set session authorization postgres');
    if (profile === 'synthetic') await db.exec(`
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
    for (const file of migrationFiles()) {
      if (file >= M34) break;
      stage = file;
      await db.exec(migrationSql(file));
    }
    stage = M34;
    if (apply) await db.exec(CURRENT());
  } catch (error) {
    await db.close();
    if (error instanceof Error) error.message = `${profile}/${nonsuper ? 'nonsuper' : 'super'}/${stage}: ${error.message}`;
    throw error;
  }
  return {
    db,
    exec: async (sql) => { await db.exec(sql); },
    one: async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0],
    all: async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows,
    close: () => db.close(),
    async superExec(sql) {
      await db.exec(`reset role; set session authorization ${platform}`);
      try { await db.exec(sql); }
      finally { await db.exec('reset role; set session authorization postgres'); }
    },
    async as<T>(role: string, claims: Record<string, unknown> | null, fn: () => Promise<T>): Promise<T> {
      await db.exec(`set session authorization h9_authenticator; set role ${identifier(role)}`);
      await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims ?? {})]);
      try { return await fn(); }
      finally { await db.exec('reset role; set session authorization postgres'); }
    },
  };
}

export function checkSql(preflight = false): string {
  const sections = readFileSync('backend/supabase/checks/h9_postmigration_checks.sql', 'utf8').split(/^-- section: /m);
  const section = sections.find((s) => s.split(/\r?\n/, 1)[0] === 'api_role_privileges');
  if (!section) throw new Error('missing privilege checks');
  const sql = section.slice(section.indexOf('\n') + 1);
  return preflight ? sql.replace('/* allow-x1 */ false', '/* allow-x1 */ true') : sql;
}
export async function failures(h: Harness): Promise<string[]> {
  const rows = await h.all<{ check_name: string; pass: boolean }>(checkSql());
  return rows.filter((r) => !r.pass).map((r) => r.check_name).sort();
}
export async function state(h: Harness): Promise<unknown> {
  return h.one(`select
    (select jsonb_agg(jsonb_build_array(oid,datdba,datacl) order by oid) from pg_database) databases,
    (select jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) order by c.oid)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname <> 'information_schema') relations,
    (select jsonb_agg(jsonb_build_array(attrelid,attname,attacl) order by attrelid,attnum)
      from pg_attribute where attacl is not null) columns,
    (select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d) defaults,
    (select jsonb_agg(jsonb_build_array(oid,proowner,proacl) order by oid) from pg_proc) functions,
    (select jsonb_agg(jsonb_build_array(oid,nspowner,nspacl) order by oid) from pg_namespace) namespaces,
    (select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m) memberships,
    (select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r) roles,
    (select jsonb_agg(to_jsonb(u) order by id) from public.users u) users,
    (select jsonb_agg(to_jsonb(s) order by id) from public.shops s) shops`);
}
export async function installCanary(h: SecurityHarness): Promise<void> {
  // Install only AFTER drift and a real revocable privilege have been constructed.
  const held = await h.one<{ held: boolean }>("select has_table_privilege('anon','public.shops','SELECT') held");
  if (!held.held) throw new Error('canary fixture has no revocable privilege');
  await h.superExec(`create function public.h9_order_canary() returns event_trigger language plpgsql as
    $$ begin raise exception 'H9_CANARY_FIRED: %', tg_tag; end $$;
    create event trigger h9_order_canary on ddl_command_start
      when tag in ('REVOKE','ALTER DEFAULT PRIVILEGES') execute function public.h9_order_canary();`);
}
export async function removeCanary(h: SecurityHarness): Promise<void> {
  await h.superExec('drop event trigger h9_order_canary; drop function public.h9_order_canary()');
}

