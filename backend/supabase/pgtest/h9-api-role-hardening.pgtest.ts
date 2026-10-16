import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { model, CURRENT, R3, CHECK_NAMES, failures, state, installCanary, removeCanary, type SecurityHarness, type Profile } from './h9-api-role-model';
import { claimsFor, seedShops, STAFF_A, SHOP_B } from './harness';
import { evaluateHostedPreflight, sqlHash, ATTRIBUTES, main } from '../../../scripts/h9-f12-hosted-preflight.mjs';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });
const names = (...ids: number[]) => ids.map((i) => CHECK_NAMES[i - 1]).sort();
const exact = /not exactly the measured platform profile/;
const unsafe = /unsafe role attribute/;
type Case = [string, string, string, number[], RegExp?];
const defaults: Case[] = [
  ['dormant creator SELECT', 'create role h9_c; alter default privileges for role h9_c in schema public grant select on tables to authenticated',
    'alter default privileges for role h9_c in schema public revoke select on tables from authenticated; drop role h9_c', [3]],
  ['creator sequence USAGE', 'create role h9_c; grant create on schema public to h9_c; alter default privileges for role h9_c in schema public grant usage on sequences to anon',
    'alter default privileges for role h9_c in schema public revoke usage on sequences from anon; revoke create on schema public from h9_c; drop role h9_c', [3]],
  ['creator global SELECT', 'create role h9_c; alter default privileges for role h9_c grant select on tables to authenticated',
    'alter default privileges for role h9_c revoke select on tables from authenticated; drop role h9_c', [3]],
  ['superuser creator', 'create role h9_c superuser; alter default privileges for role h9_c in schema public grant insert on tables to anon',
    'alter default privileges for role h9_c in schema public revoke insert on tables from anon; drop role h9_c', [3]],
  ['creator inherits CREATE', 'create role h9_c; grant postgres to h9_c; alter default privileges for role h9_c in schema public grant update on tables to authenticated',
    'alter default privileges for role h9_c in schema public revoke update on tables from authenticated; revoke postgres from h9_c; drop role h9_c', [3]],
  ['dormant PUBLIC default: formerly allowed', 'create role h9_c; alter default privileges for role h9_c grant select on tables to public',
    'alter default privileges for role h9_c revoke select on tables from public; drop role h9_c', [9]],
  ['postgres global REFERENCES', 'alter default privileges for role postgres grant references on tables to anon',
    'alter default privileges for role postgres revoke references on tables from anon', [3]],
  ['postgres global EXECUTE', 'alter default privileges for role postgres grant execute on functions to anon',
    'alter default privileges for role postgres revoke execute on functions from anon', [3]],
  ['C11: postgres public EXECUTE grant option', 'alter default privileges for role postgres in schema public grant execute on functions to anon with grant option',
    'alter default privileges for role postgres in schema public revoke execute on functions from anon', [3, 10]],
  ['other creator EXECUTE after PUBLIC global revoke', 'create role h9_c; alter default privileges for role h9_c revoke execute on functions from public; alter default privileges for role h9_c in schema public grant execute on functions to anon',
    'alter default privileges for role h9_c in schema public revoke execute on functions from anon; alter default privileges for role h9_c grant execute on functions to public; drop role h9_c', [3]],
  ['function default to reachable role', 'create role h9_c; grant h9_c to authenticated; alter default privileges for role postgres in schema public grant execute on functions to h9_c',
    'alter default privileges for role postgres in schema public revoke execute on functions from h9_c; revoke h9_c from authenticated; drop role h9_c', [11]],
];
const x2: Case[] = [
  ['one item missing', 'alter default privileges in schema public revoke select on tables from anon',
    'alter default privileges in schema public grant select on tables to anon', [12], exact],
  ['functions missing', 'alter default privileges in schema public revoke all on functions from anon,authenticated,postgres,service_role',
    'alter default privileges in schema public grant all on functions to anon,authenticated,postgres,service_role', [12], exact],
  ['whole profile missing', 'alter default privileges in schema public revoke all on tables from anon,authenticated,postgres,service_role; alter default privileges in schema public revoke all on sequences from anon,authenticated,postgres,service_role; alter default privileges in schema public revoke all on functions from anon,authenticated,postgres,service_role',
    'alter default privileges in schema public grant all on tables to anon,authenticated,postgres,service_role; alter default privileges in schema public grant all on sequences to anon,authenticated,postgres,service_role; alter default privileges in schema public grant all on functions to anon,authenticated,postgres,service_role', [12], exact],
  ['substituted service_role grantee', 'create role h9_x; alter default privileges in schema public revoke all on tables from service_role; alter default privileges in schema public grant all on tables to h9_x',
    'alter default privileges in schema public revoke all on tables from h9_x; alter default privileges in schema public grant all on tables to service_role; drop role h9_x', [12], exact],
  ['substituted object type', 'alter default privileges in schema public revoke execute on functions from anon; alter default privileges in schema public grant usage on types to anon',
    'alter default privileges in schema public revoke usage on types from anon; alter default privileges in schema public grant execute on functions to anon', [12], exact],
  ['global rather than public', 'alter default privileges in schema public revoke all on tables from anon,authenticated,postgres,service_role; alter default privileges grant all on tables to anon,authenticated,postgres,service_role',
    'alter default privileges revoke all on tables from anon,authenticated,postgres,service_role; alter default privileges in schema public grant all on tables to anon,authenticated,postgres,service_role', [12], exact],
  ['extra grantee', 'create role h9_x; alter default privileges in schema public grant select on tables to h9_x',
    'alter default privileges in schema public revoke select on tables from h9_x; drop role h9_x', [12], exact],
  ['global types entry', 'alter default privileges grant usage on types to anon',
    'alter default privileges revoke usage on types from anon', [12], exact],
  ['additional public object type', 'alter default privileges in schema public grant usage on types to anon',
    'alter default privileges in schema public revoke usage on types from anon', [12], exact],
  ['grant option', 'alter default privileges in schema public grant select on tables to authenticated with grant option',
    'alter default privileges in schema public revoke grant option for select on tables from authenticated', [12], exact],
  ['PUBLIC EXECUTE cannot use E3', 'alter default privileges in schema public grant execute on functions to public',
    'alter default privileges in schema public revoke execute on functions from public', [12], exact],
  ['Reach grantee', 'create role h9_x; grant h9_x to authenticated; alter default privileges in schema public grant select on tables to h9_x',
    'alter default privileges in schema public revoke select on tables from h9_x; revoke h9_x from authenticated; drop role h9_x', [12], exact],
];
const capabilities: Case[] = [
  ['direct CREATE', 'grant create on schema public to authenticated', 'revoke create on schema public from authenticated', [13]],
  ['PUBLIC CREATE', 'grant create on schema public to public', 'revoke create on schema public from public', [13]],
  ['SET-only CREATE', 'create role h9_leaf; grant create on schema public to h9_leaf; grant h9_leaf to authenticated with inherit false,set true',
    'revoke h9_leaf from authenticated; revoke create on schema public from h9_leaf; drop role h9_leaf', [13]],
  ['two-hop CREATE', 'create role h9_mid noinherit; create role h9_leaf; grant create on schema public to h9_leaf; grant h9_leaf to h9_mid with inherit false,set true; grant h9_mid to authenticated with inherit false,set true',
    'revoke h9_mid from authenticated; revoke h9_leaf from h9_mid; revoke create on schema public from h9_leaf; drop role h9_mid; drop role h9_leaf', [13]],
  ['dead membership CREATE', 'create role h9_leaf; grant create on schema public to h9_leaf; grant h9_leaf to authenticated with admin false,inherit false,set false',
    'revoke h9_leaf from authenticated; revoke create on schema public from h9_leaf; drop role h9_leaf', [13]],
  ['SET-only BYPASSRLS', 'create role h9_leaf bypassrls; grant h9_leaf to authenticated with inherit false,set true',
    'revoke h9_leaf from authenticated; drop role h9_leaf', [15], unsafe],
  ['two-hop BYPASSRLS', 'create role h9_mid noinherit; create role h9_leaf bypassrls; grant h9_leaf to h9_mid with inherit false,set true; grant h9_mid to authenticated with inherit false,set true',
    'revoke h9_mid from authenticated; revoke h9_leaf from h9_mid; drop role h9_mid; drop role h9_leaf', [15], unsafe],
  ['dead membership LOGIN', 'create role h9_leaf login; grant h9_leaf to authenticated with admin false,inherit false,set false',
    'revoke h9_leaf from authenticated; drop role h9_leaf', [15], unsafe],
  ['reachable SUPERUSER', 'create role h9_leaf superuser; grant h9_leaf to authenticated with inherit false,set true',
    'revoke h9_leaf from authenticated; drop role h9_leaf', [11, 13, 15]],
];
const attrs = [
  ['superuser', 'nosuperuser', [1, 8, 10, 13, 15]],
  ['bypassrls', 'nobypassrls', [15]], ['replication', 'noreplication', [15]],
  ['createrole', 'nocreaterole', [15]], ['createdb', 'nocreatedb', [15]], ['login', 'nologin', [15]],
] as const;
for (const [enabled, disabled, checks] of attrs) capabilities.push([
  'authenticated ' + enabled, 'alter role authenticated ' + enabled,
  'alter role authenticated ' + disabled, [...checks],
]);
capabilities.push(['anon BYPASSRLS', 'alter role anon bypassrls', 'alter role anon nobypassrls', [15], unsafe]);
capabilities.push(
  ['INHERIT CREATE', 'create role h9_leaf; grant create on schema public to h9_leaf; grant h9_leaf to authenticated with inherit true,set false',
    'revoke h9_leaf from authenticated; revoke create on schema public from h9_leaf; drop role h9_leaf', [13]],
  ['schema ownership through SET ROLE', 'create role h9_leaf; alter schema public owner to h9_leaf; grant h9_leaf to authenticated with inherit false,set true',
    'alter schema public owner to pg_database_owner; revoke h9_leaf from authenticated; drop role h9_leaf', [13]],
  ['database ownership through SET ROLE', "create role h9_leaf; do $$ begin execute format('alter database %I owner to h9_leaf',current_database()); end $$; grant h9_leaf to authenticated with inherit false,set true",
    "do $$ begin execute format('alter database %I owner to postgres',current_database()); end $$; revoke h9_leaf from authenticated; drop role h9_leaf", [13]],
);
for (const [enabled] of attrs.filter(([attribute]) => !['superuser', 'bypassrls', 'login'].includes(attribute))) capabilities.push([
  'reachable ' + enabled, 'create role h9_leaf ' + enabled + '; grant h9_leaf to authenticated with inherit false,set true',
  'revoke h9_leaf from authenticated; drop role h9_leaf', [15], unsafe,
]);

async function rejected(h: SecurityHarness, sql: string, expected: number[], message = /h9_privileges:/) {
  expect(await failures(h)).toEqual(names(...expected));
  const before = await state(h);
  await h.exec('begin');
  try { await expect(h.exec(sql)).rejects.toThrow(message); }
  finally { await h.exec('rollback'); }
  expect(await state(h)).toEqual(before);
  await expect(h.exec(sql)).rejects.toThrow(message);
  expect(await state(h)).toEqual(before);
}
for (const nonsuper of [false, true]) for (const profile of ['fresh', 'DEV'] as const) {
  describe(`R4 ${profile} ${nonsuper ? 'nonsuperuser' : 'superuser'}`, () => {
    let h: SecurityHarness;
    beforeAll(async () => { h = await model(profile, nonsuper); });
    afterAll(async () => { await h?.close(); });
    it('has all 15 checks passing and preserves exact platform ACL bytes on a second run', async () => {
      const before = await state(h);
      await h.exec(CURRENT());
      expect(await failures(h)).toEqual([]);
      expect(await state(h)).toEqual(before);
      expect(await h.one("select rolsuper from pg_roles where rolname='postgres'")).toEqual({ rolsuper: !nonsuper });
    });
    it.each(defaults)('rejects %s in wrapped and autocommit execution', async (_label, setup, undo, expected, message) => {
      await h.superExec(setup);
      try { await rejected(h, CURRENT(), expected, message); }
      finally { await h.superExec(undo); }
      expect(await failures(h)).toEqual([]);
    });
    it.each(x2)('X2 rejects %s before mutation', async (_label, setup, undo, expected, message) => {
      // superExec runs as supabase_admin, so the fixture targets its defaults; 34 never does.
      await h.superExec(setup);
      try { await rejected(h, CURRENT(), expected, message); }
      finally { await h.superExec(undo); }
      expect(await failures(h)).toEqual([]);
    });
    it.each(capabilities)('refuses %s without altering attributes or memberships', async (_label, setup, undo, expected, message) => {
      await h.superExec(setup);
      try { await rejected(h, CURRENT(), expected, message); }
      finally { await h.superExec(undo); }
      expect(await failures(h)).toEqual([]);
    });
    it.each([
      ['global PUBLIC EXECUTE revoked', 'alter default privileges for role postgres revoke execute on functions from public',
        'alter default privileges for role postgres grant execute on functions to public'],
      ['global service_role EXECUTE, retaining builtin PUBLIC', 'alter default privileges for role postgres grant execute on functions to service_role',
        'alter default privileges for role postgres revoke execute on functions from service_role'],
      ['PUBLIC EXECUTE re-added after global revoke', 'create role h9_c; alter default privileges for role h9_c revoke execute on functions from public; alter default privileges for role h9_c in schema public grant execute on functions to public',
        'alter default privileges for role h9_c in schema public revoke execute on functions from public; alter default privileges for role h9_c grant execute on functions to public; drop role h9_c'],
      ['harmless membership', 'create role h9_c; grant h9_c to authenticated', 'revoke h9_c from authenticated; drop role h9_c'],
    ])('permits %s without normalizing another creator or global defaults', async (_label, setup, undo) => {
      await h.superExec(setup);
      try {
        const before = await state(h);
        expect(await failures(h)).toEqual([]);
        await h.exec(CURRENT());
        expect(await state(h)).toEqual(before);
      } finally { await h.superExec(undo); }
    });
    it.each(['X2', 'attributes'])('%s canary kills removal of only the pre-guard', async (kind) => {
      // Explicit target repairs the DEV no-op witness. Drift exists before the trigger is enabled.
      await h.superExec("grant select on public.shops to anon");
      if (kind === 'X2') await h.superExec('alter default privileges in schema public revoke select on tables from anon');
      else await h.superExec('alter role authenticated bypassrls');
      await installCanary(h);
      try {
        const sql = CURRENT();
        const needle = kind === 'X2' ? 'if not v_policy_state.x2_ok then' : 'if v_policy_state.unsafe_roles is not null then';
        const mutant = sql.replace(needle, needle.replace('if ', 'if v_phase = 2 and '));
        expect(mutant).not.toBe(sql);
        // Both variants still contain the postcondition; only first-iteration rejection changes.
        expect(mutant).toContain('exit when v_phase = 2');
        const before = await state(h);
        await expect(h.exec(sql)).rejects.toThrow(kind === 'X2' ? exact : unsafe);
        await expect(h.exec(mutant)).rejects.toThrow('H9_CANARY_FIRED: REVOKE');
        expect(await state(h)).toEqual(before);
      } finally {
        await removeCanary(h);
        await h.superExec(kind === 'X2' ? 'alter default privileges in schema public grant select on tables to anon' : 'alter role authenticated nobypassrls');
        await h.exec('revoke select on public.shops from anon');
      }
      expect(await failures(h)).toEqual([]);
    });
  });
}

describe('preserved behavior and platform feasibility', () => {
  it.each([false, true])('supports a synthetic project without supabase_admin (nonsuper=%s)', async (nonsuper) => {
    const h = await model('synthetic', nonsuper);
    try {
      expect(await h.one("select to_regrole('supabase_admin') present")).toEqual({ present: null });
      expect(await failures(h)).toEqual([]);
      const before = await state(h); await h.exec(CURRENT()); expect(await state(h)).toEqual(before);
    } finally { await h.close(); }
  });
  it('reproduces BYPASSRLS cross-shop UPDATE on R3; the R4 guard refuses it unchanged', async () => {
    const h = await model('DEV', true, false);
    try {
      await seedShops(h);
      const claims = await claimsFor(h, STAFF_A);
      const original = await h.all('select id,name from users order by id');
      await h.as('authenticated', claims, () => h.exec("update users set name='normal-staff'"));
      expect(await h.all('select id,name from users order by id')).toEqual(original);
      await h.superExec('alter role authenticated bypassrls');
      await h.exec(R3);
      expect(await failures(h)).toEqual(names(15));
      await h.as('authenticated', claims, () => h.exec("update users set name='cross-shop-marker'"));
      expect(await h.one<{ name: string }>('select name from users where shop_id=$1', [SHOP_B])).toEqual({ name: 'cross-shop-marker' });
      const before = await state(h);
      await expect(h.exec(CURRENT())).rejects.toThrow(unsafe);
      expect(await state(h)).toEqual(before);
      await h.superExec('alter role authenticated nobypassrls');
      await h.exec(CURRENT());
      const safe = await h.all('select id,name from users order by id');
      await h.as('authenticated', claims, () => h.exec("update users set name='blocked-staff'"));
      expect(await h.all('select id,name from users order by id')).toEqual(safe);
    } finally { await h.close(); }
  });
  it('proves explicit EXECUTE adds access after a creator globally revokes PUBLIC EXECUTE', async () => {
    const h = await model('DEV');
    try {
      await h.superExec(`create role h9_c; grant create,usage on schema public to h9_c;
        alter default privileges for role h9_c revoke execute on functions from public;
        alter default privileges for role h9_c in schema public grant execute on functions to anon;
        set role h9_c; create function public.h9_future_rpc() returns text language sql as $$select 'private-value'::text$$; reset role;`);
      expect(await h.as('anon', null, () => h.one('select h9_future_rpc() value'))).toEqual({ value: 'private-value' });
      await expect(h.as('authenticated', null, () => h.one('select h9_future_rpc()'))).rejects.toMatchObject({ code: '42501' });
      await expect(h.exec(CURRENT())).rejects.toThrow(/default privilege/);
    } finally { await h.close(); }
  });
  it('R3 accepts another creator data defaults; R4 refuses before future table/sequence exposure', async () => {
    const h = await model('DEV', true);
    try {
      await h.superExec(`create role h9_future_creator; grant create,usage on schema public to h9_future_creator;
        alter default privileges for role h9_future_creator in schema public grant select on tables to anon;
        alter default privileges for role h9_future_creator in schema public grant usage on sequences to authenticated;`);
      await h.exec(R3);
      await rejected(h, CURRENT(), [3], /default privilege/);
      await h.superExec(`set role h9_future_creator;
        create table h9_future_data(id int); insert into h9_future_data values(739);
        create sequence h9_future_sequence; reset role;`);
      expect(await h.as('anon', null, () => h.one('select id from h9_future_data'))).toEqual({ id:739 });
      expect(await h.as('authenticated', null, () => h.one("select nextval('h9_future_sequence') value"))).toEqual({ value:1 });
    } finally { await h.close(); }
  });
  it.each([false,true])('preserves actual auth/storage/extensions/cron ACLs, defaults and data (nonsuper=%s)', async (nonsuper) => {
    const h = await model('fresh', nonsuper);
    try {
      for (const schema of ['auth','storage','extensions','cron']) await h.superExec(`
        create schema if not exists ${schema}; grant usage on schema ${schema} to postgres;
        create table ${schema}.h9_canary(id int); insert into ${schema}.h9_canary values(83);
        grant select on ${schema}.h9_canary to postgres;
        grant select on ${schema}.h9_canary to anon with grant option;
        create function ${schema}.h9_canary_rpc() returns int language sql as $$select 83$$;`);
      const before = await state(h);
      await h.exec(CURRENT()); expect(await state(h)).toEqual(before);
      for (const schema of ['auth','storage','extensions','cron']) {
        expect(await h.one(`select id from ${schema}.h9_canary`)).toEqual({id:83});
      }
      expect(await failures(h)).toEqual([]);
    } finally { await h.close(); }
  });
  it('reads safe attributes and observational rolconfig without pg_authid privileges', async () => {
    const h = await model('DEV', true);
    try {
      await expect(h.all('select rolsuper from pg_authid')).rejects.toMatchObject({ code: '42501' });
      await h.superExec('create role h9_reader; alter role authenticated set search_path=public');
      await h.exec('set session authorization h9_reader');
      expect(await h.one("select rolconfig from pg_roles where rolname='authenticated'")).toEqual({ rolconfig: ['search_path=public'] });
      await expect(h.all('select rolsuper from pg_authid')).rejects.toMatchObject({ code: '42501' });
      await h.exec('set session authorization postgres');
      expect(await failures(h)).toEqual([]);
    } finally { await h.close(); }
  });
  it.each([
    'grant select on public.shops to public with grant option',
    'alter default privileges in schema public grant execute on functions to public with grant option',
    'alter default privileges in schema public grant select on tables to public with grant option',
  ])('PostgreSQL rejects impossible PUBLIC grant options: %s', async (sql) => {
    const h = await model('DEV');
    try {
      const before = await state(h);
      await expect(h.superExec(sql)).rejects.toMatchObject({ code: '0LP01' });
      expect(await state(h)).toEqual(before);
    } finally { await h.close(); }
  });
  it.each(['r','p','v','m','f','S'])('checks ownership of relkind %s while preserving supported RLS rules', async (kind) => {
    const h = await model('DEV', true);
    try {
      if (kind === 'f') await h.superExec('create foreign data wrapper h9_fdw; create server h9_server foreign data wrapper h9_fdw; grant usage on foreign server h9_server to postgres');
      const create: Record<string,string> = {
        r: 'create table public.h9_kind(id int); alter table public.h9_kind enable row level security',
        p: 'create table public.h9_kind(id int) partition by range(id); alter table public.h9_kind enable row level security',
        v: 'create view public.h9_kind as select 1 id', m: 'create materialized view public.h9_kind as select 1 id',
        f: 'create foreign table public.h9_kind(id int) server h9_server', S: 'create sequence public.h9_kind',
      };
      await h.exec(create[kind]); await h.exec(CURRENT());
      expect(await failures(h)).toEqual([]);
      if (kind === 'S') expect(await h.one("select relacl from pg_class where oid='h9_kind'::regclass")).toEqual({ relacl: null });
      await h.superExec(`create role h9_owner; alter ${kind === 'S' ? 'sequence' : kind === 'v' ? 'view' : kind === 'm' ? 'materialized view' : kind === 'f' ? 'foreign table' : 'table'} public.h9_kind owner to h9_owner`);
      await rejected(h, CURRENT(), [14], /must be owned by postgres/);
    } finally { await h.close(); }
  });
  it('requires RLS on partitioned tables and revokes privileges on every supported kind', async () => {
    const h = await model('fresh', true);
    try {
      await h.exec('create table h9_p(id int) partition by range(id)');
      await rejected(h, CURRENT(), [5], /row level security/);
      await h.exec('alter table h9_p enable row level security; create view h9_v as select 1 id; create materialized view h9_m as select 1 id; create sequence h9_s');
      await h.superExec('create foreign data wrapper h9_fdw; create server h9_server foreign data wrapper h9_fdw; grant usage on foreign server h9_server to postgres');
      await h.exec('create foreign table h9_f(id int) server h9_server');
      await h.exec('grant select on h9_p,h9_v,h9_m,h9_f to anon; grant all on sequence h9_s to anon');
      await h.exec(CURRENT());
      expect(await failures(h)).toEqual([]);
    } finally { await h.close(); }
  });
  it('proves global defaults add to schema defaults and do not come from creator memberships', async () => {
    const h = await model('DEV', true);
    try {
      await h.superExec(`create role h9_creator; create role h9_member;
        grant create,usage on schema public to h9_creator,h9_member;
        grant h9_creator to h9_member;
        alter default privileges for role h9_creator grant select on tables to anon;
        alter default privileges for role h9_creator in schema public revoke select on tables from anon;
        alter default privileges for role h9_creator in schema public grant usage on sequences to public;
        set role h9_creator; create table public.h9_future(id int); insert into public.h9_future values(42);
        create sequence public.h9_future_seq; reset role;
        set role h9_member; create table public.h9_member_table(id int); reset role;`);
      expect(await h.as('anon', null, () => h.one('select id from h9_future'))).toEqual({ id: 42 });
      expect(await h.as('authenticated', null, () => h.one("select nextval('h9_future_seq') value"))).toEqual({ value: 1 });
      await expect(h.as('anon', null, () => h.one('select id from h9_member_table'))).rejects.toMatchObject({ code: '42501' });
      // Existing-object guards also reject these unsafe objects; the new defaults alone reject R4.
      await h.superExec('drop table h9_future,h9_member_table; drop sequence h9_future_seq');
      await rejected(h, CURRENT(), [3,9], /default privilege/);
    } finally { await h.close(); }
  });
});

describe('mutations exercise their branches and retained postconditions', () => {
  let h: SecurityHarness;
  beforeAll(async () => { h = await model('fresh'); });
  afterAll(async () => { await h?.close(); });
  async function witness(setup: string, undo: string, mutate: (s: string) => string) {
    await h.superExec(setup);
    try {
      const original = CURRENT(), changed = mutate(original);
      expect(changed).not.toBe(original);
      await expect(h.exec(original)).rejects.toThrow(/h9_privileges:/);
      const before = await state(h);
      await h.exec('begin');
      try { await expect(h.exec(changed)).resolves.toBeUndefined(); }
      finally { await h.exec('rollback'); }
      expect(await state(h)).toEqual(before);
    } finally { await h.superExec(undo); }
    expect(await failures(h)).toEqual([]);
  }
  it('M2: a subset exception would accept a missing approved item', () => witness(x2[0][1], x2[0][2],
    (s) => s.replace('(not exists(select 1 from platform_missing) and not exists(select 1 from platform_extra))', '(not exists(select 1 from platform_extra))')));
  it('M3: ignoring grantability would accept platform onward grants', () => witness(x2[9][1], x2[9][2],
    (s) => s.replace('a.privilege_type, a.is_grantable\n    from pg_default_acl d left', 'a.privilege_type, false\n    from pg_default_acl d left')));
  it('M4: ignoring global platform rows would accept a changed profile', () => witness(x2[7][1], x2[7][2],
    (s) => s.replace("and d.defaclnamespace in (0::oid, 'public'::regnamespace::oid)", "and d.defaclnamespace = 'public'::regnamespace")));
  it('M5: omitting X2 would let PUBLIC EXECUTE use E3', () => witness(x2[10][1], x2[10][2],
    (s) => s.replace('if not v_policy_state.x2_ok then', 'if false then')));
  it('M6: dropping strict globals admits REFERENCES', () => witness(defaults[6][1], defaults[6][2],
    (s) => s.replace("d.source = 'global' and d.kind in ('r','S','f')", "false and d.kind in ('r','S','f')")));
  it('M7: broadening E3 admits explicit API EXECUTE', () => witness(defaults[9][1], defaults[9][2],
    (s) => s.replace("d.kind = 'f' and d.grantee = 0 and d.privilege", "d.kind = 'f' and d.grantee in (0,'anon'::regrole) and d.privilege")));
  it('M8: filtering current CREATE admits a dormant unsafe default', () => witness(defaults[0][1], defaults[0][2],
    (s) => s.replace("where d.creator is distinct", "where has_schema_privilege(d.creator,'public','CREATE') and d.creator is distinct")));
  it('M9: omitting Reach from CREATE admits SET-only creation', () => witness(capabilities[2][1], capabilities[2][2],
    (s) => s.replace("where has_schema_privilege(p.role_oid, 'public', 'CREATE')", "where p.role_oid in ('anon'::regrole,'authenticated'::regrole) and has_schema_privilege(p.role_oid, 'public', 'CREATE')")));
  it('M10: postgres-only default checks admit another creator', () => witness(defaults[0][1], defaults[0][2],
    (s) => s.replace("where d.creator is distinct", "where d.creator='postgres'::regrole and d.creator is distinct")));
  it('M16: root-only attributes admit reachable BYPASSRLS', () => witness(capabilities[5][1], capabilities[5][2],
    (s) => s.replace('where a.held', "where a.held and p.role_oid in ('anon'::regrole,'authenticated'::regrole)")));
  it('M11: r-only ownership admits a view owned by another creator', () => witness(
    'create role h9_owner; create view h9_other_view as select 1 id; alter view h9_other_view owner to h9_owner',
    'drop view h9_other_view; drop role h9_owner',
    (s) => s.replace("c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')", "c.relkind = 'r'")));
  it('M12: r-only RLS admits an unprotected partitioned table', () => witness(
    'set role postgres; create table h9_unprotected(id int) partition by range(id); reset role', 'drop table h9_unprotected',
    (s) => s.replace("c.relkind in ('r', 'p') and not c.relrowsecurity", "c.relkind = 'r' and not c.relrowsecurity")));
  it('M14: non-superuser postgres cannot alter the platform defaults, and the attempt rolls back', async () => {
    const n = await model('fresh', true);
    try {
      await n.exec('grant select on shops to anon');
      const before = await state(n);
      const sql = CURRENT().replace('  end loop;\n  if not has_schema_privilege',
        '  alter default privileges for role supabase_admin in schema public revoke select on tables from anon;\n  end loop;\n  if not has_schema_privilege');
      expect(sql).not.toBe(CURRENT());
      await expect(n.exec(sql)).rejects.toMatchObject({ code: '42501' });
      expect(await state(n)).toEqual(before);
    } finally { await n.close(); }
  });
  it.each(['storage', 'platform', 'role'])('snapshot/postcondition catches injected %s change, with atomic rollback', async (target) => {
    await h.exec('grant select on shops to anon');
    const statement = target === 'storage' ? 'alter default privileges in schema storage revoke select on tables from anon;'
      : target === 'platform' ? 'alter default privileges for role supabase_admin in schema public revoke select on tables from anon;'
      : 'alter role service_role login;';
    const sql = CURRENT().replace('  end loop;\n  if not has_schema_privilege', `  ${statement}\n  end loop;\n  if not has_schema_privilege`);
    expect(sql).not.toBe(CURRENT());
    const before = await state(h);
    await expect(h.exec(sql)).rejects.toThrow(/h9_privileges:/);
    expect(await state(h)).toEqual(before);
    if (target !== 'platform') {
      const mutant = target === 'storage'
        ? sql.replace("where not (d.defaclrole='postgres'", "where d.defaclnamespace='public'::regnamespace and not (d.defaclrole='postgres'")
        : sql.replace("from pg_roles)\n", "from pg_roles where false)\n");
      expect(mutant).not.toBe(sql);
      await h.exec('begin');
      try { await expect(h.exec(mutant)).resolves.toBeUndefined(); }
      finally { await h.exec('rollback'); }
      expect(await state(h)).toEqual(before);
    }
    await h.exec('revoke select on shops from anon');
  });
  it('the production migration never changes role attributes or another creator defaults', () => {
    const source = CURRENT().replace(/--[^\n]*/g, '');
    expect(source).not.toMatch(/\balter\s+role\b|\bfor\s+role\b/i);
  });
  it('shares the same catalog predicates across migration, postchecks and hosted preflight', () => {
    const migration = CURRENT().replaceAll('\r\n', '\n');
    const core = migration.split('$policy$;')[0].split('$policy$')[1].split('\nselect (to_regrole')[0].trim();
    for (const file of ['h9_postmigration_checks.sql','h9_hosted_preflight.sql']) {
      const text = readFileSync('backend/supabase/checks/' + file, 'utf8').replaceAll('\r\n', '\n');
      const start = text.indexOf('with recursive reachable(role_oid)');
      const end = text.indexOf('), approved (', start);
      expect(end).toBeGreaterThan(start);
      const measured = (text.slice(start, end) + ')').replace(/\/\* allow-x1 \*\/ (true|false)/, () => '/* allow-x1 */ $1').trim();
      expect(measured).toBe(core);
    }
  });
});

describe('mandatory hosted preflight, evaluated offline from real local catalogs', () => {
  let h: SecurityHarness;
  let evidence: Record<string, unknown>;
  const expected = { projectRef: 'abcdefghijklmnopqrst', region: 'ap-southeast-1' };
  const clone = () => structuredClone(evidence) as {
    project: Record<string, unknown>; capture: Record<string, unknown>;
    snapshot: { platformRolePresent: boolean; checks: Array<{check_name: string; pass: boolean; detail: string}>;
      roles: Array<Record<string, unknown>>; memberships: unknown[]; publications: unknown[]; database: Record<string, unknown> };
  };
  beforeAll(async () => {
    h = await model('fresh', true, false);
    await h.exec('begin transaction read only');
    let snapshot;
    try { snapshot = (await h.one<{snapshot: unknown}>(readFileSync('backend/supabase/checks/h9_hosted_preflight.sql', 'utf8'))).snapshot; }
    finally { await h.exec('rollback'); }
    evidence = { project: { id: expected.projectRef, region: expected.region, status: 'ACTIVE_HEALTHY' },
      capture: { projectRef: expected.projectRef, sqlSha256: sqlHash(), readOnly: true }, snapshot };
  });
  afterAll(async () => { await h?.close(); });
  it('accepts fresh repairable grants, preserving the distinction from post-migration checks', () => {
    const e = clone();
    expect(e.snapshot.checks.find((c) => c.check_name === CHECK_NAMES[0])?.pass).toBe(false);
    expect(evaluateHostedPreflight(expected, e).pass).toBe(true);
  });
  it.each([
    ['wrong ref', (e: ReturnType<typeof clone>) => { e.project.id = 'zyxwvutsrqponmlkjihg'; }],
    ['wrong region', (e: ReturnType<typeof clone>) => { e.project.region = 'other'; }],
    ['wrong query pin', (e: ReturnType<typeof clone>) => { e.capture.sqlSha256 = '0'.repeat(64); }],
    ['unknown read-only mode', (e: ReturnType<typeof clone>) => { e.capture.readOnly = undefined; }],
    ['hosted role absent', (e: ReturnType<typeof clone>) => { e.snapshot.platformRolePresent = false; }],
    ['missing exact profile', (e: ReturnType<typeof clone>) => { e.snapshot.checks.find((c) => c.check_name === CHECK_NAMES[11])!.detail = 'role=absent'; }],
    ['profile drift', (e: ReturnType<typeof clone>) => { e.snapshot.checks.find((c) => c.check_name === CHECK_NAMES[11])!.pass = false; }],
    ['missing mandatory check', (e: ReturnType<typeof clone>) => { e.snapshot.checks.pop(); }],
    ['missing rolconfig inventory', (e: ReturnType<typeof clone>) => { delete e.snapshot.roles[0].rolconfig; }],
    ['missing role', (e: ReturnType<typeof clone>) => { e.snapshot.roles.pop(); }],
    ['missing publications', (e: ReturnType<typeof clone>) => { e.snapshot.publications = undefined as unknown as unknown[]; }],
    ['duplicate check', (e: ReturnType<typeof clone>) => { e.snapshot.checks.push(e.snapshot.checks[0]); }],
    ['null role attributes', (e: ReturnType<typeof clone>) => { e.snapshot.roles[0].bypassrls = null; }],
    ['malformed membership', (e: ReturnType<typeof clone>) => { e.snapshot.memberships.push(null); }],
    ['missing transitive role', (e: ReturnType<typeof clone>) => {
      e.snapshot.memberships.push({ member:'authenticated', role:'h9_leaf', grantor:'postgres', admin:false,inherit:false,set:true });
    }],
    ['malformed publication', (e: ReturnType<typeof clone>) => { e.snapshot.publications.push({ name:'missing-shape' }); }],
    ['missing database owner', (e: ReturnType<typeof clone>) => { delete e.snapshot.database.owner; }],
  ])('fails closed: %s', (_label, mutate) => {
    const e = clone(); mutate(e); expect(evaluateHostedPreflight(expected, e).pass).toBe(false);
  });
  it.each(ATTRIBUTES)('independently rejects unsafe %s even if a check row falsely says pass', (attribute: string) => {
    const e = clone(); e.snapshot.roles[0][attribute] = true;
    expect(evaluateHostedPreflight(expected, e).pass).toBe(false);
  });
  it('inventories rolconfig, ownership and broad publications without inventing new F12 policy', () => {
    const e = clone(); e.snapshot.roles[0].rolconfig = ['search_path=public'];
    e.snapshot.database.owner = 'review_required_owner';
    e.snapshot.publications = [{ name: 'review_required_publication', allTables: true, schemas: ['public'], tables: [] }];
    const result = evaluateHostedPreflight(expected, e);
    expect(result.pass).toBe(true); expect(result.observations?.reviewRequired).toBe(true);
    expect(result.observations?.roles[0].rolconfig).toEqual(['search_path=public']);
  });
  it('makes no hosted request', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    evaluateHostedPreflight(expected, clone());
    expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });
  it.each([null, [], {}, { project:{} }])('fails closed on incomplete evidence %s', (value) => {
    expect(evaluateHostedPreflight(expected, value).pass).toBe(false);
  });
  it('inventories conservative multi-hop membership, even when neither SET nor INHERIT is allowed', () => {
    const e = clone(), role = e.snapshot.roles[0];
    e.snapshot.roles.push({ ...role, name:'h9_mid' }, { ...role, name:'h9_leaf' });
    e.snapshot.memberships.push(
      { member:'authenticated', role:'h9_mid', grantor:'postgres',admin:false,inherit:false,set:false },
      { member:'h9_mid', role:'h9_leaf',grantor:'postgres',admin:false,inherit:false,set:false },
    );
    expect(evaluateHostedPreflight(expected, e).pass).toBe(true);
    e.snapshot.roles.find((r) => r.name === 'h9_leaf')!.bypassrls = true;
    expect(evaluateHostedPreflight(expected, e).pass).toBe(false);
  });
  it('CLI has real success/failure exits and does not print observational values', () => {
    const directory = mkdtempSync(join(tmpdir(), 'h9-r4-offline-'));
    const file = join(directory, 'capture.json'), lines: string[] = [];
    const argv = ['--expected-project-ref',expected.projectRef,'--expected-region',expected.region,'--evidence',file];
    try {
      const e = clone(); e.snapshot.roles[0].rolconfig = ['search_path=private-inventory-marker'];
      writeFileSync(file, JSON.stringify(e));
      expect(main(argv, (line: string) => lines.push(line))).toBe(0);
      expect(lines.join('')).not.toContain('private-inventory-marker');
      e.snapshot.platformRolePresent = false; writeFileSync(file, JSON.stringify(e));
      expect(main(argv, () => {})).toBe(1);
      writeFileSync(file, '{broken'); expect(main(argv, () => {})).toBe(1);
      expect(main(['--remote','forbidden'], () => {})).toBe(1);
      expect(main(['--evidence',file,'--evidence',file], () => {})).toBe(1);
      expect(main([], () => {})).toBe(1);
    } finally { unlinkSync(file); rmdirSync(directory); }
  });
});

