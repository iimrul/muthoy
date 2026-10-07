import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

const preflightSql = readFileSync(resolve('backend/supabase/checks/dev_harness_preflight.sql'), 'utf8');
const cleanupSql = readFileSync(resolve('backend/supabase/checks/dev_harness_cleanup.sql'), 'utf8');

let h: Harness;

beforeAll(async () => { h = await createHarness(); }, 180_000);
afterAll(async () => { await h?.close(); });

describe('DEV harness cleanup stays count-only until separately approved', () => {
  async function report(): Promise<Map<string, number>> {
    const results = await h.db.exec(preflightSql);
    const rows = results.flatMap((result) => result.rows ?? []) as Array<{
      entity: string; row_count: number;
    }>;
    return new Map(rows.map((row) => [row.entity, Number(row.row_count)]));
  }

  async function seedShop(stamped: boolean): Promise<{ shopId: string; accountId: string }> {
    const authId = randomUUID();
    const shopId = randomUUID();
    const ownerId = randomUUID();
    const roleId = randomUUID();
    await h.db.query(
      'insert into auth.users (id, email, phone, raw_app_meta_data, is_anonymous) values ($1,$2,$3,$4,false)',
      [authId, `${authId}@fixture.invalid`, stamped ? null : '8801700000000',
        JSON.stringify(stamped ? { dev_harness: true } : {})],
    );
    await h.db.query(
      'insert into public.shops (id, owner_id, name, phone) values ($1,$2,$3,$4)',
      [shopId, ownerId, stamped ? 'DEV Test Shop' : 'OTP Shop', 'fixture'],
    );
    await h.db.query('insert into public.roles (id, shop_id, name) values ($1,$2,$3)',
      [roleId, shopId, 'owner']);
    await h.db.query(
      'insert into public.users (id, shop_id, role_id, name, pin_hash) values ($1,$2,$3,$4,$5)',
      [ownerId, shopId, roleId, 'Fixture Owner', 'fixture-only-hash'],
    );
    // The real Owner-insert trigger creates the billing account, membership,
    // entitlement snapshot, and shop link. Do not fake those relationships.
    const account = await h.one<{ id: string }>(
      'select id from public.billing_accounts where principal_owner_user_id = $1', [ownerId],
    );
    await h.db.query('insert into public.shop_claims (shop_id, claimed_by_user_id) values ($1,$2)',
      [shopId, authId]);
    await h.db.query('insert into public.auth_bindings (app_user_id, auth_user_id) values ($1,$2)',
      [ownerId, authId]);
    return { shopId, accountId: account.id };
  }

  it('has a read-only preflight and a rollback-by-default cleanup', () => {
    expect(preflightSql).toMatch(/begin transaction read only;/i);
    expect(preflightSql).not.toMatch(/\b(delete|update|insert|truncate|create|drop|alter)\s+(?:from|into|table|temporary|schema|function)/i);
    expect(cleanupSql.trimEnd()).toMatch(/rollback;$/i);
    expect(cleanupSql).not.toMatch(/\bcommit\s*;/i);
  });

  it('reports zero candidate rows and refuses cleanup with no stamped identities', async () => {
    const counts = await report();
    expect(counts.get('stamped_auth_accounts')).toBe(0);
    expect(counts.get('safe_to_delete_1_yes')).toBe(0);
    expect(await h.one<{ count: number }>('select count(*)::int as count from auth.users')).toEqual({ count: 0 });
    // Execute only the guard prefix, ending before its first UPDATE/DELETE.
    // This proves the PL/pgSQL safety block parses and rejects empty scope;
    // no destructive statement is sent even to this throwaway database.
    const guardOnly = cleanupSql.slice(0, cleanupSql.indexOf('-- The only updated rows'));
    try {
      await expect(h.db.exec(guardOnly)).rejects.toThrow(/expected exactly 14 proven accounts/);
    } finally {
      await h.db.exec('rollback;');
    }
  });

  it('includes only fourteen independently claimed shops and excludes a phone-OTP shop', async () => {
    for (let index = 0; index < 14; index += 1) await seedShop(true);
    const otp = await seedShop(false);
    const counts = await report();
    expect(counts.get('stamped_auth_accounts')).toBe(14);
    expect(counts.get('independently_proven_shops')).toBe(14);
    expect(counts.get('distinct_proven_billing_accounts')).toBe(14);
    expect(counts.get('public.shops')).toBe(14);
    expect(counts.get('unreviewed_account_linked_rows_BLOCK')).toBe(0);
    expect(counts.get('other_DEV_app_users_excluded')).toBe(1);
    expect(counts.get('phone_OTP_auth_accounts_excluded')).toBe(1);
    expect(counts.get('phone_OTP_shops_excluded')).toBe(1);
    expect(counts.get('other_DEV_auth_accounts_excluded')).toBe(1);
    expect(counts.get('safe_to_delete_1_yes')).toBe(1);
    const guardOnly = cleanupSql.slice(0, cleanupSql.indexOf('-- The only updated rows'));
    try {
      await expect(h.db.exec(guardOnly)).resolves.toBeDefined();
    } finally {
      await h.db.exec('rollback;');
    }
    expect(await h.one<{ count: number }>('select count(*)::int as count from public.shops where id = $1', [otp.shopId]))
      .toEqual({ count: 1 });
  });

  it('blocks deletion if an unmarked shop shares a marked shop billing account', async () => {
    const target = await h.one<{ account_id: string }>(
      "select s.billing_account_id as account_id from public.shops s where s.name = 'DEV Test Shop' limit 1",
    );
    const outside = await h.one<{ id: string; billing_account_id: string }>(
      "select id, billing_account_id from public.shops where name = 'OTP Shop' limit 1",
    );
    await h.db.query('update public.shops set billing_account_id = $1 where id = $2',
      [target.account_id, outside.id]);
    const counts = await report();
    expect(counts.get('nonharness_shops_on_target_accounts_BLOCK')).toBe(1);
    expect(counts.get('same_account_nonharness_shops_excluded')).toBe(1);
    expect(counts.get('safe_to_delete_1_yes')).toBe(0);
    const guardOnly = cleanupSql.slice(0, cleanupSql.indexOf('-- The only updated rows'));
    try {
      await expect(h.db.exec(guardOnly)).rejects.toThrow(/outside relationship/);
    } finally {
      await h.db.exec('rollback;');
    }
    await h.db.query('update public.shops set billing_account_id = $1 where id = $2',
      [outside.billing_account_id, outside.id]);
    const marked = await h.one<{ id: string }>(
      "select id from auth.users where raw_app_meta_data->>'dev_harness' = 'true' limit 1",
    );
    await h.db.query('update auth.users set phone = $1 where id = $2',
      ['8801700000001', marked.id]);
    const phoneCounts = await report();
    expect(phoneCounts.get('marked_phone_or_phone_identity_BLOCK')).toBe(1);
    expect(phoneCounts.get('safe_to_delete_1_yes')).toBe(0);
  });
});
