import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyRow,
  claimsFor,
  createBareHarness,
  createHarness,
  migrationFiles,
  migrationSql,
  type Harness,
  OWNER_A,
  seedShops,
  SHOP_A,
  T0,
} from './harness';

const B4_MIGRATION = '20260831000000_b4_commercial_platform.sql';

describe('B4 billing, entitlement, and multi-shop authority', () => {
  let h: Harness;
  let accountId: string;

  beforeAll(async () => {
    h = await createHarness();
    await seedShops(h);
    accountId = (await h.one<{ id: string }>(
      'select id::text from billing_accounts where principal_owner_user_id=$1::uuid',
      [OWNER_A],
    )).id;
  }, 60_000);
  afterAll(async () => h.close());

  it('grants a newly activated primary Owner exactly one 14-day Ultra-equivalent trial', async () => {
    const row = await h.one<{ status: string; tier: string; days: number; effective: string }>(`
      select status,tier,extract(day from trial_ends_at-launch_trial_granted_at)::integer as days,
        b4_effective_tier(b.id) as effective
      from billing_accounts b join entitlement_snapshots e on e.billing_account_id=b.id where b.id=$1
    `, [accountId]);
    expect(row).toEqual({ status: 'trialing', tier: 'free', days: 14, effective: 'ultra' });
    expect((await h.one<{ count: number }>('select count(*)::integer as count from billing_accounts where principal_owner_user_id=$1', [OWNER_A])).count).toBe(1);
    expect((await h.one<{ count: number }>('select count(*)::integer as count from entitlement_snapshots where billing_account_id=$1', [accountId])).count).toBe(1);
    expect(await h.one<{ grace: string | null }>('select grace_ends_at::text as grace from entitlement_snapshots where billing_account_id=$1', [accountId])).toEqual({ grace: null });
    expect(await h.one<{ tier: string; premium: boolean }>(`
      select b4_effective_tier(b.id,e.trial_ends_at) as tier,
        b4_user_has_premium($2::uuid,e.trial_ends_at) as premium
      from billing_accounts b join entitlement_snapshots e on e.billing_account_id=b.id
      where b.id=$1
    `, [accountId, OWNER_A])).toEqual({ tier: 'free', premium: false });
  });

  it('keeps duplicate activation, relogin, and reinstall retries from restarting the trial', async () => {
    const before = await h.one<{ granted: string; ends: string }>(`
      select launch_trial_granted_at::text as granted,trial_ends_at::text as ends
      from billing_accounts b join entitlement_snapshots e on e.billing_account_id=b.id
      where b.id=$1
    `, [accountId]);
    await h.one('select b4_ensure_owner_billing_account($1::uuid,$2::uuid)', [OWNER_A, SHOP_A]);
    await h.one('select b4_refresh_entitlement_snapshot($1::uuid)', [accountId]);
    await h.one('select b4_ensure_owner_billing_account($1::uuid,$2::uuid)', [OWNER_A, SHOP_A]);
    const after = await h.one<{ granted: string; ends: string; accounts: number; entitlements: number }>(`
      select b.launch_trial_granted_at::text as granted,e.trial_ends_at::text as ends,
        (select count(*)::integer from billing_accounts where principal_owner_user_id=$2) as accounts,
        (select count(*)::integer from entitlement_snapshots where billing_account_id=$1) as entitlements
      from billing_accounts b join entitlement_snapshots e on e.billing_account_id=b.id
      where b.id=$1
    `, [accountId, OWNER_A]);
    expect(after).toEqual({ ...before, accounts: 1, entitlements: 1 });
  });

  it('activates when the Owner becomes visible after the shop and retries safely', async () => {
    const shopId = '71111111-1111-4111-8111-111111111111';
    const ownerId = '72222222-2222-4222-8222-222222222222';
    const roleId = '74444444-4444-4444-8444-444444444444';
    await h.exec(`
      insert into shops(id,owner_id,name,phone,created_at,updated_at)
      values('${shopId}','${ownerId}','Delayed Owner','+8801700000011','${T0}','${T0}');
      insert into roles(id,shop_id,name,is_system,created_at,updated_at)
      values('${roleId}','${shopId}','owner',true,'${T0}','${T0}');
    `);
    expect((await h.one<{ count: number }>('select count(*)::integer as count from billing_accounts where principal_owner_user_id=$1', [ownerId])).count).toBe(0);
    await expect(h.one('select b4_ensure_owner_billing_account($1::uuid,$2::uuid)', [ownerId, shopId])).rejects.toThrow(/owner billing target is invalid/);

    await h.exec(`insert into users(
      id,shop_id,name,phone,pin_hash,pin_set_at,role_id,is_active,created_at,updated_at
    ) values(
      '${ownerId}','${shopId}','Delayed Owner','+8801700000011','hash','${T0}','${roleId}',true,'${T0}','${T0}'
    )`);
    const before = await h.one<{ account: string; granted: string; ends: string }>(`
      select b.id::text as account,b.launch_trial_granted_at::text as granted,e.trial_ends_at::text as ends
      from billing_accounts b join entitlement_snapshots e on e.billing_account_id=b.id
      where b.principal_owner_user_id=$1
    `, [ownerId]);
    await h.one('select b4_ensure_owner_billing_account($1::uuid,$2::uuid)', [ownerId, shopId]);
    const after = await h.one<{ account: string; granted: string; ends: string }>(`
      select b.id::text as account,b.launch_trial_granted_at::text as granted,e.trial_ends_at::text as ends
      from billing_accounts b join entitlement_snapshots e on e.billing_account_id=b.id
      where b.principal_owner_user_id=$1
    `, [ownerId]);
    expect(after).toEqual(before);
  });

  it('heals an Owner whose shop never got a billing account, then hydrates the SAME trial on relogin', async () => {
    // The physical B4 report: on that device billing-status kept answering
    // "Billing account not found", so no entitlement ever reached SQLite and
    // the app showed Free. billingStatus now runs
    // b4_ensure_owner_billing_account before giving up; this is that call.
    const shopId = '73333333-3333-4333-8333-333333333333';
    const ownerId = '73333333-3333-4333-8333-333333333334';
    const roleId = '73333333-3333-4333-8333-333333333335';
    // Owner row created without the activation trigger firing — the state a
    // pre-B4 shop, or any ordering regression, leaves behind.
    await h.exec(`
      insert into shops(id,owner_id,name,phone,created_at,updated_at)
      values('${shopId}','${ownerId}','Unbootstrapped','+8801700000021','${T0}','${T0}');
      insert into roles(id,shop_id,name,is_system,created_at,updated_at)
      values('${roleId}','${shopId}','owner',true,'${T0}','${T0}');
      alter table users disable trigger users_activate_primary_owner_trial;
      insert into users(id,shop_id,name,phone,pin_hash,pin_set_at,role_id,is_active,created_at,updated_at)
      values('${ownerId}','${shopId}','Unbootstrapped Owner','+8801700000021','hash','${T0}','${roleId}',true,'${T0}','${T0}');
      alter table users enable trigger users_activate_primary_owner_trial;
    `);
    expect(await h.one<{ account: string | null }>(
      'select billing_account_id::text as account from shops where id=$1', [shopId],
    )).toEqual({ account: null });

    const healed = await h.one<{ id: string }>(
      'select b4_ensure_owner_billing_account($1::uuid,$2::uuid)::text as id', [ownerId, shopId],
    );
    const first = await h.one<{ shopAccount: string; status: string; days: number; effective: string; ends: string }>(`
      select s.billing_account_id::text as "shopAccount",e.status,
        extract(day from e.trial_ends_at-b.launch_trial_granted_at)::integer as days,
        b4_effective_tier(b.id) as effective,e.trial_ends_at::text as ends
      from shops s join billing_accounts b on b.id=s.billing_account_id
      join entitlement_snapshots e on e.billing_account_id=b.id where s.id=$1
    `, [shopId]);
    expect(first).toMatchObject({ shopAccount: healed.id, status: 'trialing', days: 14, effective: 'ultra' });

    // Relogin/reinstall replays the same call. It must hydrate, never restart.
    await h.one('select b4_ensure_owner_billing_account($1::uuid,$2::uuid)', [ownerId, shopId]);
    const second = await h.one<{ shopAccount: string; ends: string; accounts: number }>(`
      select s.billing_account_id::text as "shopAccount",e.trial_ends_at::text as ends,
        (select count(*)::integer from billing_accounts where principal_owner_user_id=$2) as accounts
      from shops s join entitlement_snapshots e on e.billing_account_id=s.billing_account_id
      where s.id=$1
    `, [shopId, ownerId]);
    expect(second).toEqual({ shopAccount: first.shopAccount, ends: first.ends, accounts: 1 });
  });

  it('denies authenticated direct reads/writes of server commercial tables and commercial shop fields', async () => {
    const claims = await claimsFor(h, OWNER_A);
    await expect(h.as('authenticated', claims, () => h.all('select * from entitlement_snapshots'))).rejects.toThrow(/permission denied/);
    await expect(h.as('authenticated', claims, () => h.exec(`update shops set plan='ultra' where id='${SHOP_A}'`))).rejects.toThrow(/server-owned/);
    await expect(h.as('authenticated', claims, () => h.exec(`insert into shops(
      id,owner_id,name,phone,plan,billing_account_id
    ) values(
      '79999999-0000-4000-8000-000000000099','79999999-0000-4000-8000-000000000098',
      'Forged shop','01700000000','ultra','${accountId}'
    )`))).rejects.toThrow(/server-owned|row-level security/i);
  });

  it('rejects legacy client-written subscription rows even from an owner', async () => {
    const result = await applyRow(h, {
      table: 'subscriptions', shopId: SHOP_A, callerUserId: OWNER_A,
      row: { id: '79999999-0000-4000-8000-000000000001', shop_id: SHOP_A, plan: 'ultra', status: 'active', starts_at: T0, created_at: T0, updated_at: T0, is_deleted: false },
    });
    expect(result.error).toMatch(/server-owned|permission/i);
  });

  it('activates only a server-priced verified payment and is idempotent on replay', async () => {
    const orderId = '79999999-0000-4000-8000-000000000010';
    await h.exec(`insert into payment_orders(
      id,billing_account_id,requested_by_principal_user_id,client_request_id,tier,billing_cycle,
      amount_paisa,provider,status,provider_transaction_id,expires_at
    ) values(
      '${orderId}','${accountId}','${OWNER_A}','79999999-0000-4000-8000-000000000011',
      'pro','monthly',39900,'sslcommerz','pending','MTH-verified',now()+interval '30 minutes'
    )`);
    const apply = () => h.one<{ result: Record<string, unknown> }>(
      `select b4_apply_verified_payment($1::uuid,$2,$3,$4,$5::jsonb) as result`,
      [orderId,'MTH-verified','validation-1','verified:validation-1',JSON.stringify({ status: 'VALID' })],
    );
    const beforeVersion = (await h.one<{ version: number }>(
      'select version::integer from entitlement_snapshots where billing_account_id=$1', [accountId],
    )).version;
    await apply();
    const firstVersion = (await h.one<{ version: number }>(
      'select version::integer from entitlement_snapshots where billing_account_id=$1', [accountId],
    )).version;
    await apply();
    const entitlement = await h.one<{ tier: string; status: string; grace_days: number; version: number }>(`
      select tier,status,extract(day from grace_ends_at-paid_through)::integer as grace_days,version::integer
      from entitlement_snapshots where billing_account_id=$1
    `, [accountId]);
    expect(firstVersion).toBe(beforeVersion + 1);
    expect(entitlement).toEqual({ tier: 'pro', status: 'active', grace_days: 7, version: firstVersion });
    expect((await h.one<{ count: number }>('select count(*)::integer as count from payment_provider_events where payment_order_id=$1', [orderId])).count).toBe(1);
  });

  it('accepts a provider-verified late success and reconciles rejected then verified delivery once', async () => {
    const orderId = '79999999-0000-4000-8000-000000000020';
    const validationId = 'validation-late-1';
    await h.exec(`insert into payment_orders(
      id,billing_account_id,requested_by_principal_user_id,client_request_id,tier,billing_cycle,
      amount_paisa,provider,status,provider_transaction_id,expires_at,failure_code
    ) values(
      '${orderId}','${accountId}','${OWNER_A}','79999999-0000-4000-8000-000000000021',
      'pro','monthly',39900,'sslcommerz','expired','MTH-late',now()-interval '1 hour','checkout_expired'
    )`);
    await h.exec(`insert into payment_provider_events(
      provider,event_key,payment_order_id,validation_id,payload,processing_status,error_code,processed_at
    ) values(
      'sslcommerz','validation:${validationId}','${orderId}','${validationId}',
      '{"status":"INVALID"}'::jsonb,'rejected','verification_mismatch',now()
    )`);
    const apply = () => h.one<{ result: Record<string, unknown> }>(
      `select b4_apply_verified_payment($1::uuid,$2,$3,$4,$5::jsonb) as result`,
      [orderId,'MTH-late',validationId,`validation:${validationId}`,JSON.stringify({ status: 'VALID' })],
    );
    await apply();
    await apply();
    expect(await h.one<{ status: string }>('select status from payment_orders where id=$1', [orderId])).toEqual({ status: 'verified' });
    expect(await h.one<{ status: string; error: string | null }>(
      'select processing_status as status,error_code as error from payment_provider_events where validation_id=$1',
      [validationId],
    )).toEqual({ status: 'verified', error: null });
    expect((await h.one<{ count: number }>(
      'select count(*)::integer as count from payment_provider_events where validation_id=$1', [validationId],
    )).count).toBe(1);
  });

  it('keeps cancel/retry safe when a canceled checkout reports a later verified success', async () => {
    const canceledOrderId = '79999999-0000-4000-8000-000000000030';
    const retryOrderId = '79999999-0000-4000-8000-000000000032';
    await h.exec(`insert into payment_orders(
      id,billing_account_id,requested_by_principal_user_id,client_request_id,tier,billing_cycle,
      amount_paisa,provider,status,provider_transaction_id,expires_at,failure_code
    ) values(
      '${canceledOrderId}','${accountId}','${OWNER_A}','79999999-0000-4000-8000-000000000031',
      'pro','monthly',39900,'sslcommerz','canceled','MTH-canceled',now()-interval '5 minutes','client_canceled'
    ),(
      '${retryOrderId}','${accountId}','${OWNER_A}','79999999-0000-4000-8000-000000000033',
      'pro','monthly',39900,'sslcommerz','pending','MTH-retry',now()+interval '30 minutes',null
    )`);
    await h.one(
      `select b4_apply_verified_payment($1::uuid,$2,$3,$4,$5::jsonb) as result`,
      [canceledOrderId,'MTH-canceled','validation-canceled-late','validation:validation-canceled-late',JSON.stringify({ status: 'VALID' })],
    );
    expect(await h.one<{ status: string }>('select status from payment_orders where id=$1', [canceledOrderId])).toEqual({ status: 'verified' });
    expect(await h.one<{ status: string; code: string }>(
      'select status,failure_code as code from payment_orders where id=$1', [retryOrderId],
    )).toEqual({ status: 'canceled', code: 'superseded_by_verified_payment' });
  });

  it('enforces Pro at 3 active shops and deterministically makes excess shops read-only on downgrade', async () => {
    const create = (name: string) => h.one<{ result: { shopId: string } }>(
      'select b4_create_owned_shop($1::uuid,$2,$3,$4)::jsonb as result', [OWNER_A,name,`${name} EN`,'01700000001'],
    );
    await create('Second');
    await create('Third');
    await expect(create('Fourth')).rejects.toThrow(/shop plan limit reached/);
    expect((await h.one<{ count: number }>('select count(*)::integer as count from shops where billing_account_id=$1 and archived_at is null', [accountId])).count).toBe(3);
    const summaries = await h.all<{ shop_id: string; sales_paisa: string }>(
      'select shop_id::text,sales_paisa::text from b4_shop_summaries($1::uuid,$2::date)',
      [accountId,'2026-08-31'],
    );
    expect(summaries).toHaveLength(3);
    expect(summaries.every((row) => row.sales_paisa === '0')).toBe(true);

    await h.exec(`update entitlement_snapshots set tier='free',status='expired',paid_through=null,grace_ends_at=null,verified_at=now(),version=version+1 where billing_account_id='${accountId}'`);
    await h.one('select b4_reconcile_plan_limits($1::uuid)', [accountId]);
    const statuses = await h.all<{ commercial_status: string }>('select commercial_status from shops where billing_account_id=$1 order by created_at,id', [accountId]);
    expect(statuses.map((row) => row.commercial_status)).toEqual(['active','read_only','read_only']);
    expect((await h.one<{ allowed: boolean }>('select b4_user_within_current_staff_limit($1::uuid) as allowed', [OWNER_A])).allowed).toBe(true);
  });
});

describe('B4 existing Owner rollout trial', () => {
  it('backfills every eligible pre-B4 Owner once without duplicate rows', async () => {
    const legacy = await createBareHarness();
    try {
      for (const name of migrationFiles().filter((name) => name < B4_MIGRATION)) {
        await legacy.exec(migrationSql(name));
      }
      await seedShops(legacy);
      await legacy.exec(migrationSql(B4_MIGRATION));
      const rows = await legacy.all<{ owner: string; accounts: number; entitlements: number; days: number; effective: string }>(`
        select b.principal_owner_user_id::text as owner,
          count(distinct b.id)::integer as accounts,count(distinct e.billing_account_id)::integer as entitlements,
          extract(day from max(e.trial_ends_at)-max(b.launch_trial_granted_at))::integer as days,
          max(b4_effective_tier(b.id)) as effective
        from billing_accounts b join entitlement_snapshots e on e.billing_account_id=b.id
        group by b.principal_owner_user_id order by owner
      `);
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.accounts === 1 && row.entitlements === 1 && row.days === 14 && row.effective === 'ultra')).toBe(true);
    } finally {
      await legacy.close();
    }
  }, 60_000);
});
