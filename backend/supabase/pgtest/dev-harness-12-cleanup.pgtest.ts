import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

const preflightSql = readFileSync(resolve('backend/supabase/checks/dev_harness_12_preflight.sql'), 'utf8');
const cleanupSql = readFileSync(resolve('backend/supabase/checks/dev_harness_12_cleanup.sql'), 'utf8');
const guardEnd = cleanupSql.indexOf('-- The only updated rows');

type Fixture = { authId: string; shopId: string; ownerId: string; accountId: string };
let h: Harness;
let targets: Fixture[];
let unrelated: Fixture;

beforeAll(async () => {
  h = await createHarness();
  targets = [];
  for (let index = 0; index < 14; index += 1) targets.push(await seedShop(true));
  unrelated = await seedShop(false);
  await h.db.query('update public.shops set name = $1 where id = $2',
    ['Repurposed Shop', targets[12].shopId]);
  await h.db.query('update public.users set phone = $1 where id = $2',
    ['+8801300000101', targets[12].ownerId]);
  await h.db.query('update public.shops set name = $1 where id = $2',
    ['Renamed Shop', targets[13].shopId]);
}, 180_000);
afterAll(async () => { await h?.close(); });

async function seedShop(stamped: boolean): Promise<Fixture> {
  const authId = randomUUID();
  const shopId = randomUUID();
  const ownerId = randomUUID();
  const roleId = randomUUID();
  await h.db.query(
    'insert into auth.users (id, email, phone, raw_app_meta_data, is_anonymous) values ($1,$2,$3,$4,false)',
    [authId, `${authId}@fixture.invalid`, stamped ? null : '+8801300000102',
      JSON.stringify(stamped ? { dev_harness: true } : {})],
  );
  await h.db.query('insert into public.shops (id, owner_id, name, phone) values ($1,$2,$3,$4)',
    [shopId, ownerId, stamped ? 'DEV Test Shop' : 'H-5 E2E Test Shop', 'fixture']);
  await h.db.query('insert into public.roles (id, shop_id, name) values ($1,$2,$3)',
    [roleId, shopId, 'owner']);
  await h.db.query('insert into public.users (id, shop_id, role_id, name, phone, pin_hash) values ($1,$2,$3,$4,$5,$6)',
    [ownerId, shopId, roleId, 'Fixture Owner', stamped ? null : '+8801300000102', 'fixture-only-hash']);
  const account = await h.one<{ id: string }>(
    'select id from public.billing_accounts where principal_owner_user_id = $1', [ownerId],
  );
  await h.db.query('insert into public.shop_claims (shop_id, claimed_by_user_id) values ($1,$2)',
    [shopId, authId]);
  await h.db.query('insert into public.auth_bindings (app_user_id, auth_user_id) values ($1,$2)',
    [ownerId, authId]);
  return { authId, shopId, ownerId, accountId: account.id };
}

async function report(): Promise<Map<string, number>> {
  const results = await h.db.exec(preflightSql);
  const rows = results.flatMap((result) => result.rows ?? []) as Array<{
    entity: string; row_count: number;
  }>;
  return new Map(rows.map((row) => [row.entity, Number(row.row_count)]));
}

async function runGuardOnly(): Promise<void> {
  expect(guardEnd).toBeGreaterThan(0);
  try {
    await h.db.exec(cleanupSql.slice(0, guardEnd));
  } finally {
    await h.db.exec('rollback;');
  }
}

describe('twelve-only DEV harness cleanup', () => {
  it('keeps preflight read-only and the destructive file rollback-only', () => {
    expect(preflightSql).toMatch(/begin transaction read only;/i);
    expect(preflightSql).not.toMatch(/\b(delete|update|insert|truncate|create|drop|alter)\s+(?:from|into|table|temporary|schema|function)/i);
    expect(cleanupSql.trimEnd()).toMatch(/rollback;$/i);
    expect(cleanupSql).not.toMatch(/\bcommit\s*;/i);
    expect(guardEnd).toBeGreaterThan(0);
    expect(cleanupSql).toMatch(/create temporary table h5_cleanup_auth on commit drop as\s+select auth_user_id as id from h5_cleanup_scope/i);
    expect(cleanupSql).toMatch(/delete from auth\.users\s+where id in \(select id from h5_cleanup_auth\)/i);
    expect(cleanupSql).toContain('h5_excluded_before');
  });

  it('selects twelve, excludes the two changed harness accounts and the OTP account', async () => {
    const rows = await report();
    expect(rows.get('stamped_auth_accounts')).toBe(14);
    expect(rows.get('stamped_shop_claims')).toBe(14);
    expect(rows.get('independently_proven_shops')).toBe(12);
    expect(rows.get('distinct_proven_billing_accounts')).toBe(12);
    expect(rows.get('excluded_stamped_auth_accounts')).toBe(2);
    expect(rows.get('excluded_stamped_claims')).toBe(2);
    expect(rows.get('excluded_stamped_bindings')).toBe(2);
    expect(rows.get('auth.users')).toBe(12);
    expect(rows.get('public.shops')).toBe(12);
    expect(rows.get('two_stamped_auth_accounts_preserved')).toBe(2);
    expect(rows.get('phone_OTP_auth_accounts_excluded')).toBe(1);
    expect(rows.get('phone_OTP_shops_excluded')).toBe(1);
    expect(rows.get('target_h5_e2e_or_test_number_BLOCK')).toBe(0);
    expect(rows.get('safe_to_delete_12')).toBe(1);
    expect(rows.get('expected_remaining_stamped_auth_accounts')).toBe(2);
    for (const [entity, count] of rows) {
      if (entity.endsWith('_BLOCK')) expect(count, entity).toBe(0);
    }
    await expect(runGuardOnly()).resolves.toBeUndefined();
    expect(await h.one<{ count: number }>('select count(*)::int as count from auth.users'))
      .toEqual({ count: 15 });
  });

  it('fails closed if a different shop shares one target billing account', async () => {
    try {
      await h.db.query('update public.shops set billing_account_id = $1 where id = $2',
        [targets[0].accountId, unrelated.shopId]);
      const rows = await report();
      expect(rows.get('nonharness_shops_on_target_accounts_BLOCK')).toBe(1);
      expect(rows.get('safe_to_delete_12')).toBe(0);
      await expect(runGuardOnly()).rejects.toThrow(/outside relationship/);
    } finally {
      await h.db.query('update public.shops set billing_account_id = $1 where id = $2',
        [unrelated.accountId, unrelated.shopId]);
    }
  });

  it('fails closed if a target shop membership gains another actor', async () => {
    try {
      await h.db.query('update public.shop_memberships set actor_user_id = $1 where shop_id = $2',
        [unrelated.ownerId, targets[0].shopId]);
      const rows = await report();
      expect(rows.get('structural_rows_reference_other_principal_BLOCK')).toBe(1);
      expect(rows.get('safe_to_delete_12')).toBe(0);
      await expect(runGuardOnly()).rejects.toThrow(/structural row references another principal/);
    } finally {
      await h.db.query('update public.shop_memberships set actor_user_id = $1 where shop_id = $2',
        [targets[0].ownerId, targets[0].shopId]);
    }
  });

  it('fails closed if a target auth account gains a phone', async () => {
    try {
      await h.db.query('update auth.users set phone = $1 where id = $2',
        ['8801700000001', targets[0].authId]);
      const rows = await report();
      expect(rows.get('target_phone_or_phone_identity_BLOCK')).toBe(1);
      expect(rows.get('safe_to_delete_12')).toBe(0);
      await expect(runGuardOnly()).rejects.toThrow(/target account has a phone/);
    } finally {
      await h.db.query('update auth.users set phone = null where id = $1',
        [targets[0].authId]);
    }
  });

  it('fails closed if a target entitlement becomes paid', async () => {
    try {
      await h.db.query('update public.entitlement_snapshots set tier = $1 where billing_account_id = $2',
        ['pro', targets[0].accountId]);
      const rows = await report();
      expect(rows.get('nonfree_entitlements_on_target_accounts_BLOCK')).toBe(1);
      expect(rows.get('safe_to_delete_12')).toBe(0);
      await expect(runGuardOnly()).rejects.toThrow(/paid entitlement activity/);
    } finally {
      await h.db.query('update public.entitlement_snapshots set tier = $1 where billing_account_id = $2',
        ['free', targets[0].accountId]);
    }
  });
});
