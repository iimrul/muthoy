import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyRow,
  claimsFor,
  createHarness,
  type Harness,
  MANAGER_A,
  OWNER_A,
  OWNER_B,
  ROLE_OWNER_A,
  ROLE_STAFF_A,
  ROLE_STAFF_B,
  seedShops,
  SHOP_A,
  SHOP_B,
  STAFF_A,
  T0,
} from './harness';

// The security properties, EXECUTED rather than asserted about.
//
// Every defect these cover was previously "tested" by a regex over the source
// text, and every one of them shipped anyway: a check that reads the wrong
// field still contains the right words. Each test below drives real SQL and
// asserts on what the database actually did.

const AUTH_OWNER_A = '9f1c0000-0000-4000-8000-000000000001';
const AUTH_STRANGER = '9f1c0000-0000-4000-8000-0000000000ff';

const base = { created_at: T0, updated_at: T0, is_deleted: false };
const LATER = '2026-08-19T12:00:00.000Z';

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await seedShops(h);
}, 60_000);

afterEach(async () => {
  await h.close();
});

async function permissionVersion(userId: string): Promise<number> {
  const row = await h.one<{ v: number }>(`select permission_version as v from users where id = $1`, [
    userId,
  ]);
  return Number(row.v);
}

describe('claims round-trip through the access token hook', () => {
  it('injects app_user_id, role and permission_version for a bound account', async () => {
    // This is the claim set _shared/auth.ts decodes off the verified JWT. It
    // exists ONLY in the token — the hook never writes auth.users, which is why
    // reading it off the user ROW returned undefined on every request.
    await h.exec(
      `insert into auth_bindings (app_user_id, auth_user_id) values ('${OWNER_A}', '${AUTH_OWNER_A}')`,
    );

    const result = await h.one<{ out: Record<string, unknown> }>(
      `select custom_access_token_hook($1::jsonb) as out`,
      [JSON.stringify({ user_id: AUTH_OWNER_A, claims: { app_metadata: {} } })],
    );
    const metadata = (result.out as { claims: { app_metadata: Record<string, unknown> } }).claims
      .app_metadata;

    expect(metadata).toMatchObject({
      shop_id: SHOP_A,
      app_user_id: OWNER_A,
      role: 'owner',
      permission_version: 0,
      is_active: true,
    });
  });

  it('carries the CURRENT permission_version, so a refresh picks up a revocation', async () => {
    await h.exec(
      `insert into auth_bindings (app_user_id, auth_user_id) values ('${STAFF_A}', '${AUTH_OWNER_A}')`,
    );
    await h.exec(`update users set is_active = false where id = '${STAFF_A}'`);

    const result = await h.one<{ out: Record<string, unknown> }>(
      `select custom_access_token_hook($1::jsonb) as out`,
      [JSON.stringify({ user_id: AUTH_OWNER_A, claims: { app_metadata: {} } })],
    );
    const metadata = (result.out as { claims: { app_metadata: Record<string, unknown> } }).claims
      .app_metadata;

    expect(metadata.permission_version).toBe(1);
    expect(metadata.is_active).toBe(false);
  });

  it('leaves an UNBOUND account untouched, so registration keeps working', async () => {
    // Mid-registration the OTP session exists before the shop does. Stripping
    // linkDevice's own shop_id here would break every RLS policy in the flow.
    const event = { user_id: AUTH_STRANGER, claims: { app_metadata: { shop_id: SHOP_A } } };
    const result = await h.one<{ out: Record<string, unknown> }>(
      `select custom_access_token_hook($1::jsonb) as out`,
      [JSON.stringify(event)],
    );
    expect(result.out).toEqual(event);
  });
});

describe('identity binding', () => {
  it('converges when two first-logins race, instead of one of them failing', async () => {
    // What _shared/identity.ts's claimBinding relies on. The previous version
    // was select-then-insert, so the loser of the race got a 500 and, if it had
    // already created the auth account, was locked out permanently.
    await h.exec(`
      insert into auth_bindings (app_user_id, auth_user_id) values ('${STAFF_A}', '${AUTH_OWNER_A}')
        on conflict (app_user_id) do nothing;
      insert into auth_bindings (app_user_id, auth_user_id) values ('${STAFF_A}', '${AUTH_STRANGER}')
        on conflict (app_user_id) do nothing;
    `);

    const rows = await h.all<{ auth_user_id: string }>(
      `select auth_user_id from auth_bindings where app_user_id = $1`,
      [STAFF_A],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].auth_user_id).toBe(AUTH_OWNER_A);
  });

  it('refuses to give one auth account to two app users', async () => {
    await h.exec(
      `insert into auth_bindings (app_user_id, auth_user_id) values ('${OWNER_A}', '${AUTH_OWNER_A}')`,
    );
    await expect(
      h.exec(
        `insert into auth_bindings (app_user_id, auth_user_id) values ('${STAFF_A}', '${AUTH_OWNER_A}')`,
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it('rejects a cross-shop binding target the way linkDevice must', async () => {
    // linkDevice takes ownerUserId from the REQUEST BODY. assertBindingTarget
    // runs exactly this predicate before binding anything; unvalidated, an
    // attacker completing their own registration could name a victim's user id
    // and inherit their shop on every token thereafter.
    const crossShop = await h.all(
      `select 1 from users u join roles r on r.id = u.role_id
        where u.id = $1 and u.shop_id = $2 and r.name = 'owner'
          and u.is_active and not u.is_deleted`,
      [OWNER_B, SHOP_A],
    );
    expect(crossShop).toEqual([]);

    const sameShop = await h.all(
      `select 1 from users u join roles r on r.id = u.role_id
        where u.id = $1 and u.shop_id = $2 and r.name = 'owner'
          and u.is_active and not u.is_deleted`,
      [OWNER_A, SHOP_A],
    );
    expect(sameShop).toHaveLength(1);
  });

  it('rebinds a LEGACY owner without leaving two rows', async () => {
    // The owner who registered before auth_bindings existed has an OTP account
    // and, after their first device-login, a synthetic-email account too.
    // Recovery must be able to move the binding, or they 403 forever.
    await h.exec(
      `insert into auth_bindings (app_user_id, auth_user_id) values ('${OWNER_A}', '${AUTH_OWNER_A}')`,
    );
    await h.exec(
      `update auth_bindings set auth_user_id = '${AUTH_STRANGER}' where app_user_id = '${OWNER_A}'`,
    );

    const rows = await h.all<{ auth_user_id: string }>(
      `select auth_user_id from auth_bindings where app_user_id = $1`,
      [OWNER_A],
    );
    expect(rows).toEqual([{ auth_user_id: AUTH_STRANGER }]);
  });
});

describe('staff escalation is refused', () => {
  // MANAGER_A is a STAFF-role user who has been granted staff_management —
  // the realistic worst case, because the owner's own UI offers that checkbox.
  const managerRow = (overrides: Record<string, unknown>) => ({
    ...base,
    id: MANAGER_A,
    shop_id: SHOP_A,
    name: 'Manager A',
    phone: '+8801700000003',
    pin_hash: 'hash-manager-a',
    pin_set_at: T0,
    role_id: ROLE_STAFF_A,
    is_active: true,
    updated_at: LATER,
    ...overrides,
  });

  it('cannot promote itself to owner by pushing its own role_id', async () => {
    const result = await applyRow(h, {
      table: 'users',
      op: 'update',
      row: managerRow({ role_id: ROLE_OWNER_A }),
      shopId: SHOP_A,
      callerUserId: MANAGER_A,
    });
    expect(result.ok).toBe(true); // the row applies…

    const after = await h.one<{ role_id: string }>(`select role_id from users where id = $1`, [
      MANAGER_A,
    ]);
    // …but the privilege column was taken from the server, not the payload.
    expect(after.role_id).toBe(ROLE_STAFF_A);
  });

  it('cannot change the owner PIN', async () => {
    const result = await applyRow(h, {
      table: 'users',
      op: 'update',
      row: {
        ...base,
        id: OWNER_A,
        shop_id: SHOP_A,
        name: 'Owner A',
        phone: '+8801700000001',
        pin_hash: 'hash-chosen-by-attacker',
        pin_set_at: T0,
        role_id: ROLE_OWNER_A,
        is_active: true,
        updated_at: LATER,
      },
      shopId: SHOP_A,
      callerUserId: MANAGER_A,
    });
    expect(result.error).toMatch(/only the owner may modify the owner account/);
    expect(result.code).toBe('MU013');

    const owner = await h.one<{ pin_hash: string }>(`select pin_hash from users where id = $1`, [
      OWNER_A,
    ]);
    expect(owner.pin_hash).toBe('hash-owner-a');
  });

  it('cannot deactivate the owner', async () => {
    const result = await applyRow(h, {
      table: 'users',
      op: 'update',
      row: {
        ...base,
        id: OWNER_A,
        shop_id: SHOP_A,
        name: 'Owner A',
        phone: '+8801700000001',
        pin_hash: 'hash-owner-a',
        pin_set_at: T0,
        role_id: ROLE_OWNER_A,
        is_active: false,
        updated_at: LATER,
      },
      shopId: SHOP_A,
      callerUserId: MANAGER_A,
    });
    expect(result.error).toMatch(/only the owner may modify the owner account/);
    const owner = await h.one<{ is_active: boolean }>(
      `select is_active from users where id = $1`,
      [OWNER_A],
    );
    expect(owner.is_active).toBe(true);
  });

  it('cannot deactivate another staff member', async () => {
    const result = await applyRow(h, {
      table: 'users',
      op: 'update',
      row: {
        ...base,
        id: STAFF_A,
        shop_id: SHOP_A,
        name: 'Staff A',
        phone: '+8801700000002',
        pin_hash: 'hash-staff-a',
        pin_set_at: T0,
        role_id: ROLE_STAFF_A,
        is_active: false,
        updated_at: LATER,
      },
      shopId: SHOP_A,
      callerUserId: MANAGER_A,
    });
    expect(result.ok).toBe(true);
    const staff = await h.one<{ is_active: boolean }>(
      `select is_active from users where id = $1`,
      [STAFF_A],
    );
    expect(staff.is_active).toBe(true);
  });

  it('cannot grant itself a permission', async () => {
    const result = await applyRow(h, {
      table: 'user_permissions',
      row: {
        ...base,
        id: '80000000-0000-4000-8000-000000000001',
        shop_id: SHOP_A,
        user_id: MANAGER_A,
        key: 'settings_manage',
        allowed: true,
      },
      shopId: SHOP_A,
      callerUserId: MANAGER_A,
    });
    expect(result.error).toMatch(/only an owner may change permissions/);
    expect(result.code).toBe('MU015');
  });

  it('cannot create a second owner account', async () => {
    const result = await applyRow(h, {
      table: 'users',
      row: {
        ...base,
        id: '80000000-0000-4000-8000-000000000002',
        shop_id: SHOP_A,
        name: 'Sneaky Owner',
        phone: '+8801700000077',
        pin_hash: 'hash-x',
        pin_set_at: T0,
        role_id: ROLE_OWNER_A,
        is_active: true,
      },
      shopId: SHOP_A,
      callerUserId: MANAGER_A,
    });
    expect(result.error).toMatch(/only an owner may create a non-staff account/);
    expect(result.code).toBe('MU014');
  });

  it('cannot soft-delete an account', async () => {
    const result = await applyRow(h, {
      table: 'users',
      op: 'delete',
      row: {
        ...base,
        id: STAFF_A,
        shop_id: SHOP_A,
        is_deleted: true,
        deleted_at: LATER,
        updated_at: LATER,
      },
      shopId: SHOP_A,
      callerUserId: MANAGER_A,
    });
    expect(result.error).toMatch(/only an owner may remove an account/);
  });

  it('but the OWNER can still do all of it', async () => {
    // The negative tests above are worthless without this: a guard that denies
    // everyone denies the owner too, and the shop becomes unadministrable.
    const deactivated = await applyRow(h, {
      table: 'users',
      op: 'update',
      row: managerRow({ is_active: false }),
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(deactivated).toMatchObject({ ok: true, error: null });
    const manager = await h.one<{ is_active: boolean }>(
      `select is_active from users where id = $1`,
      [MANAGER_A],
    );
    expect(manager.is_active).toBe(false);

    const granted = await applyRow(h, {
      table: 'user_permissions',
      row: {
        ...base,
        id: '80000000-0000-4000-8000-000000000003',
        shop_id: SHOP_A,
        user_id: STAFF_A,
        key: 'cash_management',
        allowed: true,
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(granted).toMatchObject({ ok: true, error: null });
  });
});

describe('permission_version is server-controlled', () => {
  it('cannot be inserted or updated by the authenticated role', async () => {
    const privileges = await h.one<{ can_insert: boolean; can_update: boolean; can_update_name: boolean }>(
      `select
         has_column_privilege('authenticated', 'users', 'permission_version', 'INSERT') as can_insert,
         has_column_privilege('authenticated', 'users', 'permission_version', 'UPDATE') as can_update,
         has_column_privilege('authenticated', 'users', 'name', 'UPDATE') as can_update_name`,
    );
    expect(privileges).toEqual({ can_insert: false, can_update: false, can_update_name: true });
  });

  it('ignores a client-chosen value on INSERT', async () => {
    // jsonb_populate_record fills EVERY column on the insert arm, so the UPDATE
    // column list omitting permission_version was not enough. A value near int
    // overflow here would make the next bump throw and leave the user
    // permanently unrevokable.
    const result = await applyRow(h, {
      table: 'users',
      row: {
        ...base,
        id: '80000000-0000-4000-8000-000000000010',
        shop_id: SHOP_A,
        name: 'Planted',
        phone: '+8801700000088',
        pin_hash: 'hash-p',
        pin_set_at: T0,
        role_id: ROLE_STAFF_A,
        is_active: true,
        permission_version: 2147483600,
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result).toMatchObject({ ok: true, error: null });
    expect(await permissionVersion('80000000-0000-4000-8000-000000000010')).toBe(0);
  });

  it('ignores a client-chosen value on UPDATE', async () => {
    await applyRow(h, {
      table: 'users',
      op: 'update',
      row: {
        ...base,
        id: STAFF_A,
        shop_id: SHOP_A,
        name: 'Staff A',
        phone: '+8801700000002',
        pin_hash: 'hash-rotated',
        pin_set_at: T0,
        role_id: ROLE_STAFF_A,
        is_active: true,
        permission_version: 0,
        updated_at: LATER,
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    // The pin_hash change trips the trigger; the client's 0 is discarded.
    expect(await permissionVersion(STAFF_A)).toBe(1);
  });

  it('bumps on deactivation, a PIN reset and a role change', async () => {
    const start = await permissionVersion(STAFF_A);
    await h.exec(`update users set is_active = false where id = '${STAFF_A}'`);
    expect(await permissionVersion(STAFF_A)).toBe(start + 1);
    await h.exec(`update users set pin_hash = 'hash-2' where id = '${STAFF_A}'`);
    expect(await permissionVersion(STAFF_A)).toBe(start + 2);
    await h.exec(`update users set role_id = '${ROLE_OWNER_A}' where id = '${STAFF_A}'`);
    expect(await permissionVersion(STAFF_A)).toBe(start + 3);
  });

  it('does NOT bump on a routine change like a name', async () => {
    const start = await permissionVersion(STAFF_A);
    await h.exec(`update users set name = 'Renamed' where id = '${STAFF_A}'`);
    expect(await permissionVersion(STAFF_A)).toBe(start);
  });
});

describe('user revocation flags are monotonic', () => {
  it('preserves ordinary LWW fields while forcing a deactivation', async () => {
    const result = await applyRow(h, {
      table: 'users',
      op: 'update',
      row: {
        ...base,
        id: STAFF_A,
        shop_id: SHOP_A,
        name: 'Renamed during deactivation',
        phone: '+8801700000002',
        pin_hash: 'hash-staff-a',
        pin_set_at: T0,
        role_id: ROLE_STAFF_A,
        is_active: false,
        updated_at: LATER,
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result).toMatchObject({ ok: true, error: null });
    const user = await h.one<{ is_active: boolean; name: string }>(
      `select is_active, name from users where id = $1`,
      [STAFF_A],
    );
    expect(user).toEqual({ is_active: false, name: 'Renamed during deactivation' });
  });

  it('does not touch another shop before ownership rejection', async () => {
    const staffB = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b20';
    await h.exec(
      `insert into users (id, shop_id, name, phone, pin_hash, pin_set_at, role_id, is_active, created_at, updated_at)
       values ('${staffB}', '${SHOP_B}', 'Staff B', '+8801700000019', 'hash-staff-b', '${T0}', '${ROLE_STAFF_B}', true, '${T0}', '${T0}')`,
    );

    const result = await applyRow(h, {
      table: 'users',
      op: 'update',
      row: {
        ...base,
        id: staffB,
        shop_id: SHOP_A,
        name: 'Cross-shop attempt',
        phone: '+8801700000019',
        pin_hash: 'hash-staff-b',
        pin_set_at: T0,
        role_id: ROLE_STAFF_A,
        is_active: false,
        updated_at: LATER,
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result).toMatchObject({ ok: false, value: 'rejected_not_owned', error: null });
    const user = await h.one<{ is_active: boolean; name: string }>(
      `select is_active, name from users where id = $1`,
      [staffB],
    );
    expect(user).toEqual({ is_active: true, name: 'Staff B' });
  });

  it('does not let a newer stale profile payload reactivate a deactivated user', async () => {
    const deactivated = await applyRow(h, {
      table: 'users',
      op: 'update',
      row: {
        ...base,
        id: STAFF_A,
        shop_id: SHOP_A,
        name: 'Staff A',
        phone: '+8801700000002',
        pin_hash: 'hash-staff-a',
        pin_set_at: T0,
        role_id: ROLE_STAFF_A,
        is_active: false,
        updated_at: '2026-08-19T10:00:00.000Z',
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(deactivated).toMatchObject({ ok: true, error: null });

    const staleProfile = await applyRow(h, {
      table: 'users',
      op: 'update',
      row: {
        ...base,
        id: STAFF_A,
        shop_id: SHOP_A,
        name: 'Newer offline profile',
        phone: '+8801700000002',
        pin_hash: 'hash-staff-a',
        pin_set_at: T0,
        role_id: ROLE_STAFF_A,
        is_active: true,
        updated_at: '2027-08-19T10:00:00.000Z',
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(staleProfile).toMatchObject({ ok: true, error: null });
    const user = await h.one<{ is_active: boolean; name: string }>(
      `select is_active, name from users where id = $1`,
      [STAFF_A],
    );
    expect(user).toEqual({ is_active: false, name: 'Newer offline profile' });
  });

  it('does not let a newer stale payload resurrect a deleted user', async () => {
    const deleted = await applyRow(h, {
      table: 'users',
      op: 'delete',
      row: {
        ...base,
        id: MANAGER_A,
        shop_id: SHOP_A,
        is_deleted: true,
        deleted_at: '2026-08-19T10:00:00.000Z',
        deleted_by: OWNER_A,
        updated_at: '2026-08-19T10:00:00.000Z',
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(deleted).toMatchObject({ ok: true, error: null });

    const staleProfile = await applyRow(h, {
      table: 'users',
      op: 'update',
      row: {
        ...base,
        id: MANAGER_A,
        shop_id: SHOP_A,
        name: 'Resurrection attempt',
        phone: '+8801700000003',
        pin_hash: 'hash-manager-a',
        pin_set_at: T0,
        role_id: ROLE_STAFF_A,
        is_active: true,
        is_deleted: false,
        updated_at: '2027-08-19T10:00:00.000Z',
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(staleProfile).toMatchObject({ ok: true, error: null });
    const user = await h.one<{ is_deleted: boolean; name: string }>(
      `select is_deleted, name from users where id = $1`,
      [MANAGER_A],
    );
    expect(user).toEqual({ is_deleted: true, name: 'Resurrection attempt' });
  });
});

describe('crafted payloads', () => {
  it('refuses a row attributed to somebody other than the caller', async () => {
    const result = await applyRow(h, {
      table: 'audit_logs',
      row: {
        ...base,
        id: '80000000-0000-4000-8000-000000000020',
        shop_id: SHOP_A,
        actor_id: OWNER_A,
        action: 'staff_deactivated',
      },
      shopId: SHOP_A,
      callerUserId: STAFF_A,
    });
    expect(result.error).toMatch(/row is attributed to another user/);
    expect(result.code).toBe('MU011');
  });

  it("accepts the same row in the caller's own name", async () => {
    const result = await applyRow(h, {
      table: 'audit_logs',
      row: {
        ...base,
        id: '80000000-0000-4000-8000-000000000021',
        shop_id: SHOP_A,
        actor_id: STAFF_A,
        action: 'pin_changed',
      },
      shopId: SHOP_A,
      callerUserId: STAFF_A,
    });
    expect(result).toMatchObject({ ok: true, error: null });
  });

  it('lets the OWNER attribute a sale to a staff member, for the shared handset', async () => {
    // The shop's own phone is enrolled by the owner, so the JWT is the owner's
    // while switchUser moves the LOCAL session between staff. Demanding
    // equality here would reject every sale rung up on the shared device.
    const result = await applyRow(h, {
      table: 'sales',
      row: {
        ...base,
        id: '80000000-0000-4000-8000-000000000031',
        shop_id: SHOP_A,
        invoice_no: 'INV-SHARED',
        total: 100,
        paid: 100,
        change: 0,
        payment_type: 'cash',
        staff_id: STAFF_A,
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result).toMatchObject({ ok: true, error: null });
  });

  it('refuses a positive stock movement disguised as a sale', async () => {
    // The reason split let 'sales'-only staff write inventory_movements at all.
    // reason is client-controlled, so without a sign check that branch was a
    // free +1000 to any batch.
    await applyRow(h, {
      table: 'medicines',
      row: {
        ...base,
        id: '80000000-0000-4000-8000-000000000040',
        shop_id: SHOP_A,
        name: 'Napa',
        unit_of_measure: 'piece',
        requires_prescription: false,
        threshold: 20,
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    await applyRow(h, {
      table: 'batches',
      row: {
        ...base,
        id: '80000000-0000-4000-8000-000000000041',
        shop_id: SHOP_A,
        medicine_id: '80000000-0000-4000-8000-000000000040',
        batch_no: 'B9',
        stock: 0,
        purchase_price: 1,
        sale_price: 2,
        is_discounted: false,
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });

    const result = await applyRow(h, {
      table: 'inventory_movements',
      row: {
        ...base,
        id: '80000000-0000-4000-8000-000000000042',
        shop_id: SHOP_A,
        batch_id: '80000000-0000-4000-8000-000000000041',
        change_qty: 1000,
        reason: 'sale',
        created_by: STAFF_A,
      },
      shopId: SHOP_A,
      callerUserId: STAFF_A,
    });
    expect(result.error).toMatch(/a sale movement must reduce stock/);
    expect(result.code).toBe('MU012');

    const batch = await h.one<{ stock: number }>(`select stock from batches where id = $1`, [
      '80000000-0000-4000-8000-000000000041',
    ]);
    expect(Number(batch.stock)).toBe(0);
  });
});

describe('direct PostgREST access is denied by RLS', () => {
  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return h.as('authenticated', await claimsFor(h, userId), fn);
  }

  beforeEach(async () => {
    await h.exec(`
      insert into medicines (id, shop_id, name, created_at, updated_at)
        values ('90000000-0000-4000-8000-000000000001', '${SHOP_A}', 'Napa', '${T0}', '${T0}');
      insert into expenses (id, shop_id, category, amount, created_by, created_at, updated_at)
        values ('90000000-0000-4000-8000-000000000002', '${SHOP_A}', 'rent', 500, '${OWNER_A}', '${T0}', '${T0}');
      insert into permissions (id, role_id, key, allowed, created_at, updated_at)
        values ('90000000-0000-4000-8000-000000000003', '${ROLE_STAFF_A}', 'sales', true, '${T0}', '${T0}');
      insert into batches (id, shop_id, medicine_id, batch_no, purchase_price, sale_price, created_at, updated_at)
        values ('90000000-0000-4000-8000-00000000000b', '${SHOP_A}', '90000000-0000-4000-8000-000000000001', 'B1', 1, 2, '${T0}', '${T0}');
    `);
  });

  it('lets a staff member read what inventory_view covers', async () => {
    const rows = await asUser(STAFF_A, () => h.all(`select id from medicines`));
    expect(rows).toHaveLength(1);
  });

  it('refuses a staff member the cash ledger', async () => {
    const rows = await asUser(STAFF_A, () => h.all(`select id from expenses`));
    expect(rows).toEqual([]);
  });

  it('refuses a staff member a stock write', async () => {
    await expect(
      asUser(STAFF_A, () =>
        h.exec(
          `insert into medicines (id, shop_id, name, created_at, updated_at)
             values ('90000000-0000-4000-8000-00000000000a', '${SHOP_A}', 'Sneak', '${T0}', '${T0}')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('refuses a staff member the ROLE DEFAULTS table', async () => {
    // The hole the first pass left: `roles` and `user_permissions` were
    // covered, `permissions` was not — so a staff token could rewrite what
    // every staff member in the shop is allowed to do.
    const updated = await asUser(STAFF_A, () =>
      h.all(
        `update permissions set allowed = false
          where id = '90000000-0000-4000-8000-000000000003' returning id`,
      ),
    );
    expect(updated).toEqual([]);
  });

  it('refuses a staff member a positive sale movement, directly', async () => {
    await expect(
      asUser(STAFF_A, () =>
        h.exec(
          `insert into inventory_movements (id, shop_id, batch_id, change_qty, reason, created_by, created_at, updated_at)
             values ('90000000-0000-4000-8000-00000000000c', '${SHOP_A}', '90000000-0000-4000-8000-00000000000b', 500, 'sale', '${STAFF_A}', '${T0}', '${T0}')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('refuses another shop entirely', async () => {
    const rows = await asUser(OWNER_B, () => h.all(`select id from medicines`));
    expect(rows).toEqual([]);
  });

  it('refuses a DEACTIVATED staff member everything, token or no token', async () => {
    // Their refresh token keeps minting syntactically valid JWTs. This is what
    // makes those tokens worthless.
    const claims = await claimsFor(h, STAFF_A);
    await h.exec(`update users set is_active = false where id = '${STAFF_A}'`);

    const medicines = await h.as('authenticated', claims, () => h.all(`select id from medicines`));
    expect(medicines).toEqual([]);
    const users = await h.as('authenticated', claims, () => h.all(`select id from users`));
    expect(users).toEqual([]);
    const audits = await h.as('authenticated', claims, () => h.all(`select id from audit_logs`));
    expect(audits).toEqual([]);
  });
});

describe('the login lockout', () => {
  it('locks a key after its budget and not before', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await h.one(`select register_login_failure($1, 5)`, ['phone:+8801712345678']);
      const locked = await h.one<{ until: string | null }>(
        `select login_attempt_locked_until($1) as until`,
        ['phone:+8801712345678'],
      );
      expect(locked.until).toBeNull();
    }
    await h.one(`select register_login_failure($1, 5)`, ['phone:+8801712345678']);
    const locked = await h.one<{ until: string | null }>(
      `select login_attempt_locked_until($1) as until`,
      ['phone:+8801712345678'],
    );
    expect(locked.until).not.toBeNull();
  });

  it('counts equivalent phone formats against ONE budget', async () => {
    // The whole point of canonicalising: the key is +8801712345678 whichever of
    // the three forms was typed. Keyed on the raw string, an attacker got three
    // independent budgets against one account. deviceLogin.ts derives this key
    // from normalizeBdPhone, whose agreement with the mobile copy is pinned in
    // functions/sync/device-login.test.ts.
    const key = 'phone:+8801712345678';
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await h.one(`select register_login_failure($1, 5)`, [key]);
    }
    const locked = await h.one<{ until: string | null }>(
      `select login_attempt_locked_until($1) as until`,
      [key],
    );
    expect(locked.until).not.toBeNull();

    const keys = await h.all<{ key: string }>(`select key from login_attempts`);
    expect(keys).toEqual([{ key }]);
  });

  it('keeps the IP budget separate and looser than the phone budget', async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await h.one(`select register_login_failure($1, 20)`, ['ip:203.0.113.9']);
    }
    // Six failures trips a phone but not an IP: one pharmacy behind one NAT may
    // legitimately hold several accounts.
    const ip = await h.one<{ until: string | null }>(
      `select login_attempt_locked_until($1) as until`,
      ['ip:203.0.113.9'],
    );
    expect(ip.until).toBeNull();

    for (let attempt = 0; attempt < 15; attempt += 1) {
      await h.one(`select register_login_failure($1, 20)`, ['ip:203.0.113.9']);
    }
    const locked = await h.one<{ until: string | null }>(
      `select login_attempt_locked_until($1) as until`,
      ['ip:203.0.113.9'],
    );
    expect(locked.until).not.toBeNull();
  });

  it('increments atomically, so parallel attempts cannot overspend', async () => {
    const key = 'phone:+8801799999999';
    await Promise.all(
      Array.from({ length: 12 }, () => h.one(`select register_login_failure($1, 5)`, [key])),
    );
    const row = await h.one<{ failed_count: number }>(
      `select failed_count from login_attempts where key = $1`,
      [key],
    );
    expect(Number(row.failed_count)).toBe(12);
  });

  it('clears on a successful login', async () => {
    await h.one(`select register_login_failure($1, 5)`, ['phone:+8801711111111']);
    await h.one(`select clear_login_failures($1)`, ['phone:+8801711111111']);
    const rows = await h.all(`select 1 from login_attempts where key = $1`, [
      'phone:+8801711111111',
    ]);
    expect(rows).toEqual([]);
  });
});

describe('phone canonicalisation in the database', () => {
  it('makes the unique index reject an equivalent form', async () => {
    // Stored as typed, '01712345678' and '+8801712345678' were two accounts for
    // one subscriber. Both now normalise to the same string, and the partial
    // unique index refuses the second.
    await expect(
      h.exec(
        `insert into users (id, shop_id, name, phone, pin_hash, role_id, is_active, created_at, updated_at)
           values ('a0000000-0000-4000-8000-000000000001', '${SHOP_A}', 'Clone', '+8801700000002',
                   'hash-clone', '${ROLE_STAFF_A}', true, '${T0}', '${T0}')`,
      ),
    ).rejects.toThrow(/users_phone_unique|duplicate/i);
  });

  it('releases the number when a row is soft-deleted', async () => {
    await h.exec(`update users set is_deleted = true where id = '${STAFF_A}'`);
    await expect(
      h.exec(
        `insert into users (id, shop_id, name, phone, pin_hash, role_id, is_active, created_at, updated_at)
           values ('a0000000-0000-4000-8000-000000000002', '${SHOP_A}', 'Successor', '+8801700000002',
                   'hash-succ', '${ROLE_STAFF_A}', true, '${T0}', '${T0}')`,
      ),
    ).resolves.toBeUndefined();
  });
});
