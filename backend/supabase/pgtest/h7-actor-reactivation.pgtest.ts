import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyRow,
  createHarness,
  OWNER_A,
  OWNER_B,
  ROLE_STAFF_A,
  seedShops,
  SHOP_A,
  STAFF_A,
  T0,
  type Harness,
} from './harness';

const OPERATION = '90900000-0000-4000-8000-000000000001';
const OPERATION_SELF = '90900000-0000-4000-8000-000000000002';
const OPERATION_FOREIGN = '90900000-0000-4000-8000-000000000003';
const SECOND_STAFF = '90900000-0000-4000-8000-000000000004';
const OPERATION_LIMIT = '90900000-0000-4000-8000-000000000005';
const OPERATION_DELETED = '90900000-0000-4000-8000-000000000006';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
  await seedShops(h);
}, 60_000);

afterAll(async () => h.close());

describe('H-7 Owner-only Staff reactivation', () => {
  it('reproduces the monotonic sync block, then reactivates safely and idempotently', async () => {
    await h.exec(`update users set is_active=false where id='${STAFF_A}'`);
    const before = await h.one<{ permission_version: number }>(
      'select permission_version from users where id=$1', [STAFF_A],
    );
    const payload = await h.one<Record<string, unknown>>(
      `select to_jsonb(u.*) || jsonb_build_object('is_active',true,'updated_at','2099-01-01T00:00:00Z') as row
       from users u where id=$1`,
      [STAFF_A],
    );
    const syncAttempt = await applyRow(h, {
      table: 'users', op: 'update', row: payload.row as Record<string, unknown>,
      shopId: SHOP_A, callerUserId: OWNER_A,
    });
    expect(syncAttempt.ok).toBe(true);
    expect(await h.one<{ is_active: boolean }>('select is_active from users where id=$1', [STAFF_A]))
      .toEqual({ is_active: false });

    const first = await h.as('service_role', null, () => h.one<{ result: {
      staffUserId: string; shopId: string; permissionVersion: number; replayed: boolean;
    } }>(
      'select h7_reactivate_staff($1,$2,$3,$4) as result',
      [OWNER_A, SHOP_A, STAFF_A, OPERATION],
    ));
    expect(first.result).toMatchObject({
      staffUserId: STAFF_A, shopId: SHOP_A, replayed: false,
      permissionVersion: before.permission_version + 1,
    });
    expect(await h.one<{ active: boolean; allowed: boolean }>(`
      select is_active as active,user_has_permission(id,'sales') as allowed
      from users where id=$1`, [STAFF_A])).toEqual({ active: true, allowed: true });
    expect(await h.one<{ count: number }>(`
      select count(*)::integer as count from audit_logs
      where id=$1 and actor_id=$2 and target=$3 and action='staff_activated'`,
      [OPERATION, OWNER_A, STAFF_A])).toEqual({ count: 1 });

    const replay = await h.as('service_role', null, () => h.one<{ result: {
      replayed: boolean; permissionVersion: number;
    } }>('select h7_reactivate_staff($1,$2,$3,$4) as result', [
      OWNER_A, SHOP_A, STAFF_A, OPERATION,
    ]));
    expect(replay.result).toEqual(expect.objectContaining({
      replayed: true, permissionVersion: first.result.permissionVersion,
    }));
    expect(await h.one<{ count: number }>(
      'select count(*)::integer as count from audit_logs where id=$1', [OPERATION],
    )).toEqual({ count: 1 });

    await expect(h.as('service_role', null, () => h.one(
      'select h7_reactivate_staff($1,$2,$3,$4)',
      [STAFF_A, SHOP_A, STAFF_A, OPERATION_SELF],
    ))).rejects.toMatchObject({ code: 'MU051' });
    await expect(h.as('service_role', null, () => h.one(
      'select h7_reactivate_staff($1,$2,$3,$4)',
      [OWNER_B, SHOP_A, STAFF_A, OPERATION_FOREIGN],
    ))).rejects.toMatchObject({ code: 'MU051' });

    await h.exec(`
      insert into users(id,shop_id,name,phone,pin_hash,pin_set_at,role_id,is_active,created_at,updated_at)
      values('${SECOND_STAFF}','${SHOP_A}','Second Staff','+8801700000099','hash','${T0}',
        '${ROLE_STAFF_A}',false,'${T0}','${T0}');
      update entitlement_snapshots set status='expired',trial_ends_at=now()-interval '1 day',
        paid_through=null,grace_ends_at=null
      where billing_account_id=(select billing_account_id from shops where id='${SHOP_A}');
    `);
    await expect(h.as('service_role', null, () => h.one(
      'select h7_reactivate_staff($1,$2,$3,$4)',
      [OWNER_A, SHOP_A, SECOND_STAFF, OPERATION_LIMIT],
    ))).rejects.toMatchObject({ code: 'MU057' });
    expect(await h.one<{ is_active: boolean }>(
      'select is_active from users where id=$1', [SECOND_STAFF],
    )).toEqual({ is_active: false });

    await h.exec(`update users set is_deleted=true where id='${SECOND_STAFF}'`);
    await expect(h.as('service_role', null, () => h.one(
      'select h7_reactivate_staff($1,$2,$3,$4)',
      [OWNER_A, SHOP_A, SECOND_STAFF, OPERATION_DELETED],
    ))).rejects.toMatchObject({ code: 'MU054' });
  });

  it('exposes only the narrow RPC to service_role', async () => {
    expect(await h.one<{ service: boolean; authenticated: boolean }>(`
      select
        has_function_privilege('service_role','h7_reactivate_staff(uuid,uuid,uuid,uuid)','execute') as service,
        has_function_privilege('authenticated','h7_reactivate_staff(uuid,uuid,uuid,uuid)','execute') as authenticated
    `)).toEqual({ service: true, authenticated: false });
  });
});
