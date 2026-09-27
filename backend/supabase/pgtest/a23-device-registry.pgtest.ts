import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  MANAGER_A,
  OWNER_A,
  OWNER_B,
  seedShops,
  SHOP_A,
  SHOP_B,
  STAFF_A,
  T0,
  type Harness,
} from './harness';

// A2.3 against a REAL Postgres.
//
// Everything here runs the actual migration's functions, triggers and grants
// through PGlite, for the reason harness.ts states: a security check that has
// never executed is a security check that does not exist.
//
// What is deliberately proven:
//
//   - an UNKNOWN installation is not refused (the rollout safety property —
//     deploying this migration must not lock a live shop out of its own till);
//   - enrolment binds only the actor who proved themselves;
//   - revoking one binding leaves the colleague on that device alone;
//   - revoking the device takes every binding with it;
//   - neither comes back by logging in again — only an explicit, audited
//     restore does;
//   - one shop cannot see or touch another's installations;
//   - Staff cannot administer devices, even holding staff_management;
//   - no secret hash ever leaves the registry through a read path.

const DEVICE_ONE = 'till-one';
const DEVICE_TWO = 'till-two';
const MANAGER_ROLE_A = 'a2300000-0000-4000-8000-000000000001';
const MANAGER_USER_A = 'a2300000-0000-4000-8000-000000000002';

let h: Harness;

/** The registry snapshot the Edge function would return to a device. */
async function authority(shopId: string, devicePublicId: string) {
  const row = await h.one<{ value: Record<string, unknown> }>(
    'select a23_device_authority($1, $2) as value',
    [shopId, devicePublicId],
  );
  return row.value;
}

/**
 * A session id, as GoTrue would mint one.
 *
 * Every login here gets its own, because that is the whole point of the
 * rework: the SESSION is the device identity. Two logins on one handset are
 * two bindings, and a session that was never bound is legacy.
 */
let sessionCounter = 0;
function newSession(): string {
  sessionCounter += 1;
  return `5e551000-0000-4000-8000-${String(sessionCounter).padStart(12, '0')}`;
}

/**
 * What a strong-auth flow does: register the installation and bind the session
 * it just minted, in one call.
 *
 * There is no enrolment entry point to call on its own any more — that route
 * was reachable by any live access token — so every test needing a registered
 * device goes through this, exactly as device-login does.
 */
async function bind(
  shopId: string,
  actorUserId: string,
  devicePublicId: string,
  options: { session?: string; secretHash?: string } = {},
) {
  const session = options.session ?? newSession();
  const row = await h.one<{ value: Record<string, unknown> }>(
    `select a23_bind_auth_session($1, $2, $3, $4, $5, '', 'android', 'Pixel 7a', '14') as value`,
    [
      session,
      shopId,
      actorUserId,
      devicePublicId,
      options.secretHash ?? `hash-of-${devicePublicId}`,
    ],
  );
  return { session, authority: row.value };
}

/** For the tests that only care about the registry half of a binding. */
async function enroll(shopId: string, actorUserId: string, devicePublicId: string) {
  return (await bind(shopId, actorUserId, devicePublicId)).authority;
}

async function deviceIdOf(shopId: string, devicePublicId: string): Promise<string> {
  const row = await h.one<{ id: string }>(
    'select id from shop_devices where shop_id = $1 and device_public_id = $2',
    [shopId, devicePublicId],
  );
  return row.id;
}

async function prepareEnrollment(
  shopId: string,
  actorUserId: string,
  devicePublicId: string | null,
) {
  const row = await h.one<{ value: Record<string, unknown> }>(
    'select a23_prepare_enrollment($1, $2, $3) as value',
    [shopId, actorUserId, devicePublicId],
  );
  return row.value;
}

async function approveEnrollment(
  shopId: string,
  callerUserId: string,
  callerSessionId: string,
  targetActorUserId: string,
  devicePublicId: string,
) {
  return await h.one<{ value: Record<string, unknown> }>(
    'select a23_approve_enrollment($1, $2, $3, $4, $5) as value',
    [shopId, callerUserId, callerSessionId, targetActorUserId, devicePublicId],
  );
}

/** Runs `run`, expecting a refusal, and reports the SQLSTATE it raised. */
async function refused(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code ?? String((error as Error).message ?? 'unknown');
  }
  throw new Error('expected a refusal, got success');
}

function bindingStatus(snapshot: Record<string, unknown>, actorUserId: string): string | null {
  const bindings = snapshot.bindings as { actorUserId: string; status: string }[];
  return bindings.find((entry) => entry.actorUserId === actorUserId)?.status ?? null;
}

beforeAll(async () => {
  h = await createHarness();
  await seedShops(h);
  // A real Manager, which seedShops does not provide: its MANAGER_A is a STAFF
  // row holding the staff_management permission, and this batch draws the line
  // at the ROLE, not the permission.
  await h.exec(`
    insert into roles (id, shop_id, name, is_system, created_at, updated_at)
    values ('${MANAGER_ROLE_A}', '${SHOP_A}', 'manager', true, '${T0}', '${T0}');
    insert into users (id, shop_id, name, phone, pin_hash, pin_set_at, role_id, is_active, created_at, updated_at)
    values ('${MANAGER_USER_A}', '${SHOP_A}', 'Real Manager', '+8801700000044', 'hash-manager', '${T0}', '${MANAGER_ROLE_A}', true, '${T0}', '${T0}');
  `);
}, 120_000);

afterAll(async () => h.close());

beforeEach(async () => {
  await h.exec(`
    delete from device_registry_events;
    delete from auth_session_devices;
    delete from device_enrollment_holds;
    delete from shop_device_bindings;
    delete from shop_devices;
    update shops set devices_enforced_at = null;
    update users set is_active = true, is_deleted = false
      where shop_id in ('${SHOP_A}', '${SHOP_B}');
  `);
});

describe('A2.3 rollout safety: deny by revocation, not allow by enrolment', () => {
  it('reports an installation the registry has never seen as unknown, not revoked', async () => {
    const snapshot = await authority(SHOP_A, 'never-seen');
    expect(snapshot).toMatchObject({ known: false, status: 'unknown', registryVersion: 0 });
    expect(snapshot.bindings).toEqual([]);
    // The property that makes deploying this migration safe: nothing becomes
    // illegal by default, so no live shop is locked out of its own till.
    expect(snapshot.enforced).toBe(false);
  });

  it('does NOT start enforcing just because a handset enrolled', async () => {
    // The blocker this replaced a test for. Enrolment used to stamp
    // devices_enforced_at, which reads as harmless and is not: in a
    // three-till pharmacy the first handset to update would enforce the whole
    // shop, and the two tills still on the previous build — which send no
    // proof because they have none — would stop syncing mid-trading.
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    await enroll(SHOP_A, STAFF_A, DEVICE_TWO);
    const row = await h.one<{ at: string | null }>(
      'select devices_enforced_at as at from shops where id = $1', [SHOP_A],
    );
    expect(row.at).toBeNull();
    expect((await authority(SHOP_A, DEVICE_ONE)).enforced).toBe(false);
  });
});

describe('A2.3 enrolment', () => {
  it('binds only the actor who proved themselves, never the whole shop', async () => {
    const snapshot = await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    expect(snapshot).toMatchObject({ known: true, status: 'active' });
    expect(snapshot.bindings).toEqual([
      { actorUserId: OWNER_A, status: 'active', bindingVersion: 1 },
    ]);
    // STAFF_A is a live member of this shop and is deliberately NOT bound.
    expect(bindingStatus(snapshot, STAFF_A)).toBeNull();
  });

  it('adopts a second actor onto the same installation and rotates the secret', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const before = await h.one<{ hash: string }>(
      'select device_secret_hash as hash from shop_devices where device_public_id = $1',
      [DEVICE_ONE],
    );

    const adopted = await bind(SHOP_A, STAFF_A, DEVICE_ONE, { secretHash: 'rotated-hash' });
    expect(bindingStatus(adopted.authority, OWNER_A)).toBe('active');
    expect(bindingStatus(adopted.authority, STAFF_A)).toBe('active');

    const after = await h.one<{ hash: string }>(
      'select device_secret_hash as hash from shop_devices where device_public_id = $1',
      [DEVICE_ONE],
    );
    expect(after.hash).toBe('rotated-hash');
    expect(after.hash).not.toBe(before.hash);
  });

  it('refuses an actor who is not a live member of the shop', async () => {
    await h.exec(`update users set is_active = false where id = '${STAFF_A}'`);
    expect(await refused(() => enroll(SHOP_A, STAFF_A, DEVICE_ONE))).toBe('MU063');
    // And an actor from another shop entirely.
    expect(await refused(() => enroll(SHOP_A, OWNER_B, DEVICE_ONE))).toBe('MU063');
  });

  it('keeps one physical installation separate per shop', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    await enroll(SHOP_B, OWNER_B, DEVICE_ONE);
    const rows = await h.all<{ shop_id: string }>(
      'select shop_id from shop_devices where device_public_id = $1', [DEVICE_ONE],
    );
    expect(rows).toHaveLength(2);
    // Shop A's view of that public id names only Shop A's actors.
    expect(bindingStatus(await authority(SHOP_A, DEVICE_ONE), OWNER_B)).toBeNull();
  });
});

describe('A2.3 the PIN-only actor switch', () => {
  it('authorizes an actor with an active binding and records the event', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const snapshot = await h.one<{ value: Record<string, unknown> }>(
      'select a23_authorize_actor_switch($1, $2, $3, $4) as value',
      [SHOP_A, DEVICE_ONE, OWNER_A, newSession()],
    );
    expect(snapshot.value).toMatchObject({ status: 'active' });
    const events = await h.all<{ event: string }>(
      `select event from device_registry_events where event = 'actor_switch'`,
    );
    expect(events).toHaveLength(1);
  });

  it('never creates a binding — an actor must enrol through phone + PIN first', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    expect(await refused(() => h.one(
      'select a23_authorize_actor_switch($1, $2, $3, $4)',
      [SHOP_A, DEVICE_ONE, STAFF_A, newSession()],
    ))).toBe('MU067');
    expect(bindingStatus(await authority(SHOP_A, DEVICE_ONE), STAFF_A)).toBeNull();
  });

  it('refuses an unregistered installation', async () => {
    expect(await refused(() => h.one(
      'select a23_authorize_actor_switch($1, $2, $3, $4)',
      [SHOP_A, 'ghost', OWNER_A, newSession()],
    ))).toBe('MU066');
  });

  it('refuses an actor who has since been deactivated, on a healthy device', async () => {
    await enroll(SHOP_A, STAFF_A, DEVICE_ONE);
    await h.exec(`update users set is_active = false where id = '${STAFF_A}'`);
    expect(await refused(() => h.one(
      'select a23_authorize_actor_switch($1, $2, $3, $4)',
      [SHOP_A, DEVICE_ONE, STAFF_A, newSession()],
    ))).toBe('MU063');
  });
});

describe('A2.3 revocation', () => {
  it('revokes ONE binding without disturbing the colleague on the same device', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    await h.one(
      `select a23_enroll_device($1, $2, $3, 'h', '', '', '', '')`,
      [SHOP_A, STAFF_A, DEVICE_ONE],
    );
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);

    const snapshot = await h.one<{ value: Record<string, unknown> }>(
      `select a23_revoke_binding($1, $2, $3, $4, 'left the shop') as value`,
      [SHOP_A, OWNER_A, deviceId, STAFF_A],
    );
    expect(bindingStatus(snapshot.value, STAFF_A)).toBe('revoked');
    expect(bindingStatus(snapshot.value, OWNER_A)).toBe('active');
    expect(snapshot.value.status).toBe('active');

    // The revoked actor can no longer take the device; the other still can.
    expect(await refused(() => h.one(
      'select a23_authorize_actor_switch($1, $2, $3, $4)',
      [SHOP_A, DEVICE_ONE, STAFF_A, newSession()],
    ))).toBe('MU065');
    await expect(h.one(
      'select a23_authorize_actor_switch($1, $2, $3, $4)',
      [SHOP_A, DEVICE_ONE, OWNER_A, newSession()],
    )).resolves.toBeTruthy();
  });

  it('revoking the device takes every binding with it', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    await h.one(
      `select a23_enroll_device($1, $2, $3, 'h', '', '', '', '')`,
      [SHOP_A, STAFF_A, DEVICE_ONE],
    );
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);

    const snapshot = await h.one<{ value: Record<string, unknown> }>(
      `select a23_revoke_device($1, $2, $3, 'lost') as value`, [SHOP_A, OWNER_A, deviceId],
    );
    expect(snapshot.value.status).toBe('revoked');
    expect(bindingStatus(snapshot.value, OWNER_A)).toBe('revoked');
    expect(bindingStatus(snapshot.value, STAFF_A)).toBe('revoked');
  });

  it('bumps the registry version on every change, so a client can order them', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    const initial = (await authority(SHOP_A, DEVICE_ONE)).registryVersion as number;

    await h.one(`select a23_revoke_binding($1, $2, $3, $4, '')`,
      [SHOP_A, OWNER_A, deviceId, OWNER_A]);
    const afterBinding = (await authority(SHOP_A, DEVICE_ONE)).registryVersion as number;
    expect(afterBinding).toBeGreaterThan(initial);

    await h.one(`select a23_revoke_device($1, $2, $3, '')`, [SHOP_A, OWNER_A, deviceId]);
    expect((await authority(SHOP_A, DEVICE_ONE)).registryVersion as number)
      .toBeGreaterThan(afterBinding);
  });

  it('is idempotent — revoking twice changes nothing the second time', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one(`select a23_revoke_device($1, $2, $3, '')`, [SHOP_A, OWNER_A, deviceId]);
    const once = await authority(SHOP_A, DEVICE_ONE);
    await h.one(`select a23_revoke_device($1, $2, $3, '')`, [SHOP_A, OWNER_A, deviceId]);
    expect(await authority(SHOP_A, DEVICE_ONE)).toEqual(once);
  });
});

describe('A2.3 revocation does not heal itself', () => {
  it('refuses to re-enrol a revoked installation, even with valid credentials', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one(`select a23_revoke_device($1, $2, $3, 'stolen')`, [SHOP_A, OWNER_A, deviceId]);

    // The whole point of device revocation: whoever holds the lost phone
    // usually also knows a PIN.
    expect(await refused(() => enroll(SHOP_A, OWNER_A, DEVICE_ONE))).toBe('MU070');
  });

  it('refuses to re-enrol a revoked BINDING on a healthy installation', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    await h.one(`select a23_enroll_device($1, $2, $3, 'h', '', '', '', '')`,
      [SHOP_A, STAFF_A, DEVICE_ONE]);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one(`select a23_revoke_binding($1, $2, $3, $4, '')`,
      [SHOP_A, OWNER_A, deviceId, STAFF_A]);

    expect(await refused(() => enroll(SHOP_A, STAFF_A, DEVICE_ONE))).toBe('MU070');
  });

  it('restores the installation without silently restoring everyone on it', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    await h.one(`select a23_enroll_device($1, $2, $3, 'h', '', '', '', '')`,
      [SHOP_A, STAFF_A, DEVICE_ONE]);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one(`select a23_revoke_device($1, $2, $3, '')`, [SHOP_A, OWNER_A, deviceId]);

    const snapshot = await h.one<{ value: Record<string, unknown> }>(
      'select a23_restore_device($1, $2, $3) as value', [SHOP_A, OWNER_A, deviceId],
    );
    expect(snapshot.value.status).toBe('active');
    // Trusting the hardware again is not the same as re-granting every person.
    expect(bindingStatus(snapshot.value, OWNER_A)).toBe('revoked');
    expect(bindingStatus(snapshot.value, STAFF_A)).toBe('revoked');

    const restored = await h.one<{ value: Record<string, unknown> }>(
      'select a23_restore_binding($1, $2, $3, $4) as value',
      [SHOP_A, OWNER_A, deviceId, OWNER_A],
    );
    expect(bindingStatus(restored.value, OWNER_A)).toBe('active');
    expect(bindingStatus(restored.value, STAFF_A)).toBe('revoked');
  });

  it('refuses to restore an account onto a still-revoked installation', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one(`select a23_revoke_device($1, $2, $3, '')`, [SHOP_A, OWNER_A, deviceId]);
    expect(await refused(() => h.one(
      'select a23_restore_binding($1, $2, $3, $4)', [SHOP_A, OWNER_A, deviceId, OWNER_A],
    ))).toBe('MU064');
  });
});

describe('A2.3 actor+shop re-enrolment holds', () => {
  it('blocks a revoked actor reinstalling under a fresh public id', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const source = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_device($1, $2, $3, $4)',
      [SHOP_A, OWNER_A, source, 'lost']);

    expect(await prepareEnrollment(SHOP_A, OWNER_A, 'replacement-one')).toMatchObject({
      allowed: false,
      held: true,
      approved: false,
    });
    expect(await refused(() => bind(SHOP_A, OWNER_A, 'replacement-one'))).toBe('MU070');
  });

  it('checks a revoke hold before the unenforced legacy-unbound fallback', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const source = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_device($1, $2, $3, $4)',
      [SHOP_A, OWNER_A, source, 'lost']);

    expect(await prepareEnrollment(SHOP_A, OWNER_A, null)).toMatchObject({
      allowed: false,
      held: true,
      legacyUnbound: true,
      enforced: false,
    });
  });

  it('allows the exact replacement after another active bound Manager approves it', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const manager = await bind(SHOP_A, MANAGER_USER_A, DEVICE_TWO);
    const source = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_device($1, $2, $3, $4)',
      [SHOP_A, MANAGER_USER_A, source, 'lost']);
    await prepareEnrollment(SHOP_A, OWNER_A, 'replacement-approved');

    await approveEnrollment(
      SHOP_A,
      MANAGER_USER_A,
      manager.session,
      OWNER_A,
      'replacement-approved',
    );
    await expect(bind(SHOP_A, OWNER_A, 'replacement-approved')).resolves.toBeTruthy();

    const hold = await h.one<{ consumed_at: string | null; consumed_device_id: string | null }>(
      `select consumed_at, consumed_device_id from device_enrollment_holds
       where shop_id = $1 and actor_user_id = $2`,
      [SHOP_A, OWNER_A],
    );
    expect(hold.consumed_at).not.toBeNull();
    expect(hold.consumed_device_id).toBe(await deviceIdOf(SHOP_A, 'replacement-approved'));
  });

  it('keeps the hold after A2 and requires a fresh exact approval for A3', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const manager = await bind(SHOP_A, MANAGER_USER_A, DEVICE_TWO);
    const source = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_device($1, $2, $3, $4)',
      [SHOP_A, MANAGER_USER_A, source, 'lost']);

    await prepareEnrollment(SHOP_A, OWNER_A, 'replacement-a2');
    await approveEnrollment(
      SHOP_A, MANAGER_USER_A, manager.session, OWNER_A, 'replacement-a2',
    );
    await bind(SHOP_A, OWNER_A, 'replacement-a2');

    const consumedA2 = await h.one<{ consumed_at: string | null }>(
      `select consumed_at from device_enrollment_holds
       where shop_id = $1 and actor_user_id = $2`,
      [SHOP_A, OWNER_A],
    );
    expect(consumedA2.consumed_at).not.toBeNull();

    expect(await prepareEnrollment(SHOP_A, OWNER_A, 'replacement-a3')).toMatchObject({
      allowed: false,
      held: true,
      approved: false,
    });
    expect(await refused(() => bind(SHOP_A, OWNER_A, 'replacement-a3'))).toBe('MU070');

    await approveEnrollment(
      SHOP_A, MANAGER_USER_A, manager.session, OWNER_A, 'replacement-a3',
    );
    await expect(bind(SHOP_A, OWNER_A, 'replacement-a3')).resolves.toBeTruthy();
    const consumedA3 = await h.one<{ consumed_device_id: string | null }>(
      `select consumed_device_id from device_enrollment_holds
       where shop_id = $1 and actor_user_id = $2`,
      [SHOP_A, OWNER_A],
    );
    expect(consumedA3.consumed_device_id).toBe(await deviceIdOf(SHOP_A, 'replacement-a3'));
  });

  it('does not reuse a consumed approval for the same replacement id', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const manager = await bind(SHOP_A, MANAGER_USER_A, DEVICE_TWO);
    const source = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_device($1, $2, $3, $4)',
      [SHOP_A, MANAGER_USER_A, source, 'lost']);
    await prepareEnrollment(SHOP_A, OWNER_A, 'replacement-once');
    await approveEnrollment(
      SHOP_A, MANAGER_USER_A, manager.session, OWNER_A, 'replacement-once',
    );

    await bind(SHOP_A, OWNER_A, 'replacement-once');
    expect(await refused(() => bind(SHOP_A, OWNER_A, 'replacement-once'))).toBe('MU070');
  });

  it('admits at most one concurrent consumer of an exact approval', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const manager = await bind(SHOP_A, MANAGER_USER_A, DEVICE_TWO);
    const source = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_device($1, $2, $3, $4)',
      [SHOP_A, MANAGER_USER_A, source, 'lost']);
    await prepareEnrollment(SHOP_A, OWNER_A, 'replacement-race');
    await approveEnrollment(
      SHOP_A, MANAGER_USER_A, manager.session, OWNER_A, 'replacement-race',
    );

    const attempts = await Promise.allSettled([
      bind(SHOP_A, OWNER_A, 'replacement-race'),
      bind(SHOP_A, OWNER_A, 'replacement-race'),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((attempts.find((result) => result.status === 'rejected') as PromiseRejectedResult)
      .reason).toMatchObject({ code: 'MU070' });
  });

  it('blocks Staff credential enrolment under a hold with enforcement OFF and ON', async () => {
    const staff = await bind(SHOP_A, STAFF_A, DEVICE_ONE);
    const manager = await bind(SHOP_A, MANAGER_USER_A, DEVICE_TWO);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_binding($1, $2, $3, $4, $5)',
      [SHOP_A, MANAGER_USER_A, deviceId, STAFF_A, 'removed']);

    expect((await gate(staff.session, SHOP_A, STAFF_A)).enforced).toBe(false);
    await prepareEnrollment(SHOP_A, STAFF_A, 'staff-replacement-off');
    expect(await refused(() => bind(SHOP_A, STAFF_A, 'staff-replacement-off'))).toBe('MU070');

    await setEnforcement(SHOP_A, MANAGER_USER_A, manager.session, true);
    await prepareEnrollment(SHOP_A, STAFF_A, 'staff-replacement-on');
    expect(await refused(() => bind(SHOP_A, STAFF_A, 'staff-replacement-on'))).toBe('MU070');
    expect(await prepareEnrollment(SHOP_A, STAFF_A, null)).toMatchObject({
      allowed: false,
      held: true,
      legacyUnbound: true,
      enforced: true,
    });
  });

  it('does not let approval for one public id authorize another', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const manager = await bind(SHOP_A, MANAGER_USER_A, DEVICE_TWO);
    const source = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_device($1, $2, $3, $4)',
      [SHOP_A, MANAGER_USER_A, source, 'lost']);
    await prepareEnrollment(SHOP_A, OWNER_A, 'replacement-approved');
    await approveEnrollment(
      SHOP_A, MANAGER_USER_A, manager.session, OWNER_A, 'replacement-approved',
    );

    expect(await refused(() => bind(SHOP_A, OWNER_A, 'attacker-chosen'))).toBe('MU070');
  });

  it('leaves a sole-admin revoked-device case blocked pending manual recovery', async () => {
    const owner = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    const source = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_device($1, $2, $3, $4)',
      [SHOP_A, OWNER_A, source, 'lost']);
    await prepareEnrollment(SHOP_A, OWNER_A, 'sole-admin-replacement');

    expect(await refused(() => approveEnrollment(
      SHOP_A, OWNER_A, owner.session, OWNER_A, 'sole-admin-replacement',
    ))).toBe('MU071');
    expect(await refused(() => bind(SHOP_A, OWNER_A, 'sole-admin-replacement')))
      .toBe('MU070');
  });

  it('keeps normal non-revoked strong-auth enrolment available', async () => {
    expect(await prepareEnrollment(SHOP_A, OWNER_A, 'ordinary-new-device')).toMatchObject({
      allowed: true,
      held: false,
    });
    await expect(bind(SHOP_A, OWNER_A, 'ordinary-new-device')).resolves.toBeTruthy();
  });

  it('allows missing installation identity only as unenforced legacy', async () => {
    expect(await prepareEnrollment(SHOP_A, OWNER_A, null)).toMatchObject({
      allowed: true,
      legacyUnbound: true,
      enforced: false,
    });
    await h.exec(`update shops set devices_enforced_at = clock_timestamp() where id = '${SHOP_A}'`);
    expect(await prepareEnrollment(SHOP_A, OWNER_A, null)).toMatchObject({
      allowed: false,
      legacyUnbound: true,
      enforced: true,
    });
  });
});

describe('A2.3 authorization', () => {
  it('admits a real Manager and refuses Staff, even with staff_management granted', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);

    await expect(h.one('select a23_list_devices($1, $2)', [SHOP_A, MANAGER_USER_A]))
      .resolves.toBeTruthy();

    // MANAGER_A here is the seeded STAFF row that holds staff_management. The
    // client route gate keys on that permission; device administration does
    // not, and the server is the side that decides.
    expect(await refused(() => h.one(
      'select a23_list_devices($1, $2)', [SHOP_A, MANAGER_A],
    ))).toBe('MU061');
    expect(await refused(() => h.one(
      `select a23_revoke_device($1, $2, $3, '')`, [SHOP_A, STAFF_A, deviceId],
    ))).toBe('MU061');
  });

  it("refuses an Owner acting on another shop's installation", async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    // Owner B is not a live actor of Shop A at all, so the admin check fails
    // before the device is ever looked up.
    expect(await refused(() => h.one(
      `select a23_revoke_device($1, $2, $3, '')`, [SHOP_A, OWNER_B, deviceId],
    ))).toBe('MU061');
    // And Shop B's own Owner cannot reach Shop A's device row.
    expect(await refused(() => h.one(
      `select a23_revoke_device($1, $2, $3, '')`, [SHOP_B, OWNER_B, deviceId],
    ))).toBe('MU066');
  });

  it("lists only this shop's installations", async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    await enroll(SHOP_B, OWNER_B, DEVICE_TWO);
    const listed = await h.one<{ value: { devicePublicId: string }[] }>(
      'select a23_list_devices($1, $2) as value', [SHOP_A, OWNER_A],
    );
    expect((listed.value.devices as { devicePublicId: string }[])
      .map((entry) => entry.devicePublicId)).toEqual([DEVICE_ONE]);
  });
});

describe('A2.3 the tables themselves', () => {
  it('denies every API role direct access, in both directions', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    for (const table of [
      'shop_devices', 'shop_device_bindings', 'device_registry_events',
      'auth_session_devices', 'device_enrollment_holds',
    ]) {
      const readCode = await h.as('authenticated', { sub: OWNER_A }, () =>
        refused(() => h.all(`select * from ${table}`)));
      expect(readCode, `${table} must not be readable by authenticated`).toBe('42501');
      const writeCode = await h.as('anon', null, () =>
        refused(() => h.all(`delete from ${table}`)));
      expect(writeCode, `${table} must not be writable by anon`).toBe('42501');
    }
  });

  it('keeps the internal predicates unreachable from any API role', async () => {
    for (const role of ['anon', 'authenticated']) {
      const code = await h.as(role, null, () => refused(() => h.one(
        'select a23_assert_device_admin($1, $2)', [SHOP_A, OWNER_A],
      )));
      expect(code, `a23_assert_device_admin must be unreachable from ${role}`).toBe('42501');
    }
  });

  it('will not let a binding claim a device belonging to another shop', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    const code = await refused(() => h.one(
      `insert into shop_device_bindings (device_id, shop_id, actor_user_id, status)
       values ($1, $2, $3, 'active')`,
      [deviceId, SHOP_B, OWNER_B],
    ));
    expect(code).toBe('MU060');
  });

  it('never orphans an audit trail by letting a bound actor be deleted', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    // 23001 restrict_violation, NOT 23503 foreign_key_violation: the
    // difference is the point. ON DELETE RESTRICT refuses immediately and is
    // what CLAUDE.md rule 2 asks every foreign key to state explicitly; a
    // defaulted NO ACTION would surface as 23503 at constraint-check time.
    // Asserting the exact code is what proves the policy is the declared one.
    expect(await refused(() => h.one('delete from users where id = $1', [OWNER_A])))
      .toBe('23001');
  });

  it('cannot hard-delete a device and reclassify its revoked sessions as unbound', async () => {
    const owner = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_device($1, $2, $3, $4)',
      [SHOP_A, OWNER_A, deviceId, 'lost']);

    expect(await refused(() => h.one('delete from shop_devices where id = $1', [deviceId])))
      .toBe('23001');
    expect(await gate(owner.session, SHOP_A, OWNER_A)).toMatchObject({
      bound: true,
      deviceStatus: 'revoked',
    });
  });
});

describe('A2.3 the audit trail', () => {
  it('records who did what, with the reason, for every transition', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one(`select a23_revoke_device($1, $2, $3, 'left in a rickshaw')`,
      [SHOP_A, OWNER_A, deviceId]);
    await h.one('select a23_restore_device($1, $2, $3)', [SHOP_A, OWNER_A, deviceId]);

    const events = await h.all<{ event: string; actor_user_id: string; reason: string | null }>(
      `select event, actor_user_id, reason from device_registry_events
        where shop_id = $1 order by created_at, event`,
      [SHOP_A],
    );
    expect(events.map((row) => row.event).sort()).toEqual(
      [
        'binding_created', 'device_enrolled', 'device_restored',
        'device_revoked', 'enrollment_hold_created',
      ],
    );
    expect(events.every((row) => row.actor_user_id === OWNER_A)).toBe(true);
    expect(events.find((row) => row.event === 'device_revoked')?.reason)
      .toBe('left in a rickshaw');
  });

  it('never stores a secret in the events table', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    const rows = await h.all<{ value: string }>(
      'select to_jsonb(e.*)::text as value from device_registry_events e',
    );
    for (const row of rows) {
      expect(row.value).not.toContain('hash-of-');
    }
  });

  it('never returns the secret hash in an authority snapshot or the device list', async () => {
    await enroll(SHOP_A, OWNER_A, DEVICE_ONE);
    expect(JSON.stringify(await authority(SHOP_A, DEVICE_ONE))).not.toContain('hash-of-');
    const listed = await h.one<{ value: unknown }>(
      'select a23_list_devices($1, $2) as value', [SHOP_A, OWNER_A],
    );
    expect(JSON.stringify(listed.value)).not.toContain('hash-of-');
  });
});

// -- Blocker 1/2: server-side enforcement ----------------------------------

/** What deviceGuard.ts reads on every protected request. */
async function gate(
  authSessionId: string | null,
  shopId: string,
  actorUserId: string,
) {
  const row = await h.one<{ value: Record<string, unknown> }>(
    'select a23_session_gate($1, $2, $3) as value',
    [authSessionId, shopId, actorUserId],
  );
  return row.value;
}

async function setEnforcement(
  shopId: string,
  callerUserId: string,
  authSessionId: string | null,
  enabled: boolean,
) {
  const row = await h.one<{ value: Record<string, unknown> }>(
    'select a23_set_device_enforcement($1, $2, $3, $4) as value',
    [shopId, callerUserId, authSessionId, enabled],
  );
  return row.value;
}

describe('A2.3 the session gate', () => {
  it('allows a bound session whose installation and binding are active', async () => {
    const { session } = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    expect(await gate(session, SHOP_A, OWNER_A)).toMatchObject({
      bound: true, enforced: false, deviceStatus: 'active', bindingStatus: 'active',
    });
  });

  it('refuses a bound session the moment its BINDING is revoked, unenforced', async () => {
    // The property the whole rework exists for. Revocation does not wait for
    // the shop to throw the enforcement switch, and it does not depend on the
    // device sending anything: the session id is inside the token.
    const { session } = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_binding($1, $2, $3, $4, $5)',
      [SHOP_A, OWNER_A, deviceId, OWNER_A, 'left']);

    expect(await gate(session, SHOP_A, OWNER_A))
      .toMatchObject({ bound: true, enforced: false, bindingStatus: 'revoked' });
  });

  it('refuses a bound session the moment its DEVICE is revoked, unenforced', async () => {
    const { session } = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_device($1, $2, $3, $4)',
      [SHOP_A, OWNER_A, deviceId, 'lost']);

    expect(await gate(session, SHOP_A, OWNER_A))
      .toMatchObject({ bound: true, deviceStatus: 'revoked' });
  });

  it('cannot be dodged by a revoked session naming a different device', async () => {
    // There is no device id to send: the gate takes a session id and nothing
    // else. A revoked handset naming a colleague's healthy installation is not
    // a request this function can express, which is the point of the rework.
    const revoked = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    await bind(SHOP_A, STAFF_A, DEVICE_TWO);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_device($1, $2, $3, $4)',
      [SHOP_A, OWNER_A, deviceId, 'lost']);

    expect(await gate(revoked.session, SHOP_A, OWNER_A))
      .toMatchObject({ deviceStatus: 'revoked' });
  });

  it('treats a LEGACY unbound session as allowed before enforcement', async () => {
    // A session minted before this shipped, or by a flow that proved nothing.
    // It must keep working, or deploying locks out everyone already signed in.
    expect(await gate(newSession(), SHOP_A, OWNER_A))
      .toMatchObject({ bound: false, enforced: false });
    // A token with no session_id claim at all is the same case.
    expect(await gate(null, SHOP_A, OWNER_A)).toMatchObject({ bound: false });
  });

  it('reports an unbound session as unbound once the shop enforces', async () => {
    const { session } = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    await setEnforcement(SHOP_A, OWNER_A, session, true);
    // The bound session continues.
    expect(await gate(session, SHOP_A, OWNER_A))
      .toMatchObject({ bound: true, enforced: true, deviceStatus: 'active' });
    // The unbound one is now refused — the ONLY thing the flag decides.
    expect(await gate(newSession(), SHOP_A, OWNER_A))
      .toMatchObject({ bound: false, enforced: true });
  });

  it('refuses a session bound in a DIFFERENT shop or to a different actor', async () => {
    const { session } = await bind(SHOP_B, OWNER_B, DEVICE_ONE);
    expect(await gate(session, SHOP_A, OWNER_A))
      .toMatchObject({ bound: true, deviceStatus: 'mismatched' });

    const mine = await bind(SHOP_A, OWNER_A, DEVICE_TWO);
    expect(await gate(mine.session, SHOP_A, STAFF_A))
      .toMatchObject({ bound: true, deviceStatus: 'mismatched' });
  });

  it('carries the snapshot a refused device needs, and never the credential', async () => {
    const { session } = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    const answer = await gate(session, SHOP_A, OWNER_A);
    expect(answer.authority as Record<string, unknown>)
      .toMatchObject({ known: true, status: 'active' });
    expect(JSON.stringify(answer)).not.toContain('hash-of-');
  });
});

describe('A2.3 enrolment requires a proof, not a token', () => {
  it('has no reachable enrolment entry point of its own', async () => {
    // The bypass this batch removed. a23_enroll_device still exists as an
    // internal step, but it is granted to NOBODY — so there is no way for a
    // live access token to register a brand-new trusted installation without
    // going through a flow that proved a credential first.
    const grants = await h.all<{ grantee: string }>(
      `select pg_get_userbyid(a.grantee) as grantee
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where n.nspname = 'public' and p.proname = 'a23_enroll_device'
         and a.privilege_type = 'EXECUTE'
         and pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role', 'public')`,
    );
    expect(grants).toEqual([]);
  });

  it('refuses to register an installation with no session to bind it to', async () => {
    expect(await refused(() => h.one(
      `select a23_bind_auth_session(null, $1, $2, $3, 'h', '', '', '', '')`,
      [SHOP_A, OWNER_A, DEVICE_ONE],
    ))).toBe('MU062');
    // And nothing was created by the attempt.
    expect((await authority(SHOP_A, DEVICE_ONE)).known).toBe(false);
  });

  it('lets a fresh handset recover into an ENFORCED shop by proving a PIN', async () => {
    // Enforcement must not be a trap. A replacement phone, or one whose
    // session was cut, gets back in by proving a credential — which is what
    // binds it. No guarded request has to succeed first.
    const first = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    await setEnforcement(SHOP_A, OWNER_A, first.session, true);

    const fresh = newSession();
    expect(await gate(fresh, SHOP_A, OWNER_A)).toMatchObject({ bound: false, enforced: true });

    await bind(SHOP_A, OWNER_A, 'replacement-handset', { session: fresh });
    expect(await gate(fresh, SHOP_A, OWNER_A))
      .toMatchObject({ bound: true, deviceStatus: 'active', bindingStatus: 'active' });
  });

  it('re-binds a session that signs in again, without duplicating it', async () => {
    const { session } = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    await bind(SHOP_A, OWNER_A, DEVICE_ONE, { session });
    const rows = await h.all(
      'select 1 from auth_session_devices where auth_session_id = $1', [session],
    );
    expect(rows).toHaveLength(1);
  });
});

describe('A2.3 cross-shop access', () => {
  async function blocked(session: string | null, principal: string, shops: string[]) {
    const row = await h.one<{ value: string[] | null }>(
      'select a23_blocked_shops($1, $2, $3) as value', [session, principal, shops],
    );
    return row.value ?? [];
  }

  it('allows only unknown/unbound target standing while enforcement is off', async () => {
    const { session } = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    expect(await blocked(session, OWNER_A, [SHOP_A, SHOP_B])).toEqual([]);
  });

  it('blocks a known revoked target device while enforcement is OFF', async () => {
    const active = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_device($1, $2, $3, $4)',
      [SHOP_A, OWNER_A, deviceId, 'lost']);

    expect((await gate(active.session, SHOP_A, OWNER_A)).enforced).toBe(false);
    expect(await blocked(active.session, OWNER_A, [SHOP_A])).toEqual([SHOP_A]);
  });

  it('blocks a known revoked target binding while enforcement is OFF', async () => {
    const active = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_binding($1, $2, $3, $4, $5)',
      [SHOP_A, OWNER_A, deviceId, OWNER_A, 'removed']);

    expect((await gate(active.session, SHOP_A, OWNER_A)).enforced).toBe(false);
    expect(await blocked(active.session, OWNER_A, [SHOP_A])).toEqual([SHOP_A]);
  });

  it('blocks an enforced shop this installation is not registered in', async () => {
    // shop-summaries returns every shop's takings, so validating it against
    // the caller's CURRENT shop checks the wrong thing entirely — a handset
    // with no standing in shop B would pass while standing in shop A.
    const { session } = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    const other = await bind(SHOP_B, OWNER_B, DEVICE_TWO);
    await setEnforcement(SHOP_B, OWNER_B, other.session, true);

    expect(await blocked(session, OWNER_A, [SHOP_A, SHOP_B])).toEqual([SHOP_B]);
  });

  it('blocks an enforced shop where this principal has no membership', async () => {
    const { session } = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    const other = await bind(SHOP_B, OWNER_B, DEVICE_ONE);
    await setEnforcement(SHOP_B, OWNER_B, other.session, true);
    // The same installation IS registered in shop B — but under OWNER_B, and
    // this principal holds no membership there.
    expect(await blocked(session, OWNER_A, [SHOP_B])).toEqual([SHOP_B]);
  });

  it('blocks an enforced shop whose registration of this handset is revoked', async () => {
    const a = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    await setEnforcement(SHOP_A, OWNER_A, a.session, true);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_device($1, $2, $3, $4)',
      [SHOP_A, OWNER_A, deviceId, 'lost']);
    expect(await blocked(a.session, OWNER_A, [SHOP_A])).toEqual([SHOP_A]);
  });

  it('blocks every enforced shop for an unbound legacy session', async () => {
    const other = await bind(SHOP_B, OWNER_B, DEVICE_TWO);
    await setEnforcement(SHOP_B, OWNER_B, other.session, true);
    expect(await blocked(newSession(), OWNER_A, [SHOP_B])).toEqual([SHOP_B]);
    expect(await blocked(null, OWNER_A, [SHOP_B])).toEqual([SHOP_B]);
  });
});

describe('A2.3 the enforcement switch', () => {
  it('is off until somebody deliberately turns it on', async () => {
    const { session } = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    expect((await gate(session, SHOP_A, OWNER_A)).enforced).toBe(false);
    await setEnforcement(SHOP_A, OWNER_A, session, true);
    expect((await gate(session, SHOP_A, OWNER_A)).enforced).toBe(true);
  });

  it('refuses to arm from a session that is not bound at all', async () => {
    // The foot-gun that would otherwise fire reliably: enable it from a
    // handset with no binding, and the screen holding the switch is now behind
    // the rule it just enabled.
    await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    expect(await refused(() => setEnforcement(SHOP_A, OWNER_A, newSession(), true)))
      .toBe('MU068');
    expect(await refused(() => setEnforcement(SHOP_A, OWNER_A, null, true))).toBe('MU068');
  });

  it('refuses to arm from a session holding a STALE secret', async () => {
    // A colleague signing in on the same handset rotates the secret. The
    // device is fine and the older session still works for everything else —
    // but it holds a stale view, and letting it throw the switch is how an
    // Owner would strand themselves.
    const owner = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    await bind(SHOP_A, STAFF_A, DEVICE_ONE, { secretHash: 'rotated-by-colleague' });
    expect(await refused(() => setEnforcement(SHOP_A, OWNER_A, owner.session, true)))
      .toBe('MU069');
  });

  it('refuses to arm from a session whose binding was revoked', async () => {
    const owner = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    const deviceId = await deviceIdOf(SHOP_A, DEVICE_ONE);
    await h.one('select a23_revoke_binding($1, $2, $3, $4, $5)',
      [SHOP_A, MANAGER_USER_A, deviceId, OWNER_A, 'left']);
    expect(await refused(() => setEnforcement(SHOP_A, OWNER_A, owner.session, true)))
      .toBe('MU065');
  });

  it('can always be turned back off, from any admin session', async () => {
    // Deliberately NOT symmetric. Disabling is how somebody undoes a mistake,
    // and requiring a bound session to do it would make the mistake permanent
    // for whoever is holding the unbound phone.
    const { session } = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    await setEnforcement(SHOP_A, OWNER_A, session, true);
    expect((await setEnforcement(SHOP_A, OWNER_A, null, false)).enforced).toBe(false);
  });

  it('is Owner and Manager only, and audited either way', async () => {
    const staff = await bind(SHOP_A, STAFF_A, DEVICE_TWO);
    expect(await refused(() => setEnforcement(SHOP_A, STAFF_A, staff.session, true)))
      .toBe('MU061');

    const manager = await bind(SHOP_A, MANAGER_USER_A, DEVICE_ONE);
    await setEnforcement(SHOP_A, MANAGER_USER_A, manager.session, true);
    await setEnforcement(SHOP_A, MANAGER_USER_A, null, false);
    const events = await h.all<{ event: string }>(
      `select event from device_registry_events
       where event like 'device_enforcement%' order by created_at`,
    );
    expect(events.map((row) => row.event))
      .toEqual(['device_enforcement_enabled', 'device_enforcement_disabled']);
  });

  it('does not move the timestamp when enabled twice', async () => {
    const { session } = await bind(SHOP_A, OWNER_A, DEVICE_ONE);
    await setEnforcement(SHOP_A, OWNER_A, session, true);
    const first = await h.one<{ at: string }>(
      'select devices_enforced_at as at from shops where id = $1', [SHOP_A],
    );
    await setEnforcement(SHOP_A, OWNER_A, session, true);
    const second = await h.one<{ at: string }>(
      'select devices_enforced_at as at from shops where id = $1', [SHOP_A],
    );
    expect(second.at).toEqual(first.at);
  });
});

// -- Blocker 5: the attempt limiter ----------------------------------------

async function reserve(keys: string[], limits: number[]) {
  const row = await h.one<{ value: { allowed: boolean; scope: string | null } }>(
    'select a23_reserve_attempts($1, $2) as value', [keys, limits],
  );
  return row.value;
}

describe('A2.3 attempt reservation', () => {
  beforeEach(async () => {
    await h.exec('delete from login_attempts;');
  });

  it('locks on exactly the configured failure, not one request later', async () => {
    // The off-by-one. register_login_failure armed the lock only once the
    // count EXCEEDED the budget, so a budget of five bought six guesses.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await reserve(['k:off-by-one'], [5])).allowed, `attempt ${attempt}`).toBe(true);
    }
    expect((await reserve(['k:off-by-one'], [5])).allowed).toBe(false);

    const row = await h.one<{ failed_count: number; locked_until: string | null }>(
      `select failed_count, locked_until from login_attempts where key = 'k:off-by-one'`,
    );
    expect(row.failed_count).toBe(5);
    expect(row.locked_until).not.toBeNull();
  });

  it('charges the attempt BEFORE the caller does any work', async () => {
    // Reserve-then-refund. The counter moves on the way in, so "passed the
    // gate without having been counted" is not a state that exists — which is
    // what made the old check-then-increment pair racy.
    await reserve(['k:charged'], [5]);
    const row = await h.one<{ failed_count: number }>(
      `select failed_count from login_attempts where key = 'k:charged'`,
    );
    expect(row.failed_count).toBe(1);
  });

  it('cannot let concurrent guesses all through on the same pre-increment count', async () => {
    // Twenty at once against a budget of five. Under the old shape every one
    // of them read failed_count = 0 and every one of them went on to spend
    // ~300ms of server bcrypt.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserve(['k:concurrent'], [5])),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.filter((result) => !result.allowed)).toHaveLength(15);
  });

  it('counts a dimension the caller cannot rotate', async () => {
    // Alternate device and actor ids are free to invent; the IP key is not.
    // Ten requests, every one with fresh per-request keys, still exhaust the
    // shared abuse budget — which is what stops unlimited bcrypt CPU.
    const outcomes: boolean[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const fresh = await reserve(
        [`a23-device:${attempt}`, `a23-actor:${attempt}`, 'a23-abuse:198.51.100.7'],
        [20, 5, 6],
      );
      outcomes.push(fresh.allowed);
    }
    expect(outcomes.slice(0, 6).every(Boolean)).toBe(true);
    expect(outcomes.slice(6).some(Boolean)).toBe(false);
  });

  it('refuses the whole request when ANY one budget is spent', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await reserve(['k:actor-only'], [5]);
    }
    const mixed = await reserve(['k:fresh-device', 'k:actor-only'], [20, 5]);
    expect(mixed.allowed).toBe(false);
  });

  it('takes its keys in a fixed order regardless of how they were passed', async () => {
    // Two callers sharing two keys must not acquire them in opposite orders.
    // Both orderings succeed here; a deadlock would hang this test instead.
    const [first, second] = await Promise.all([
      reserve(['k:aaa', 'k:bbb'], [5, 5]),
      reserve(['k:bbb', 'k:aaa'], [5, 5]),
    ]);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
  });

  it('lets a cleared key start over', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await reserve(['k:refund'], [5]);
    expect((await reserve(['k:refund'], [5])).allowed).toBe(false);
    // What the Edge function does the moment both credentials verify.
    await h.exec(`select clear_login_failures('k:refund')`);
    expect((await reserve(['k:refund'], [5])).allowed).toBe(true);
  });

  it('refuses a malformed call rather than guessing a budget', async () => {
    expect(await refused(() => reserve(['k:one', 'k:two'], [5]))).toBe('MU062');
  });
});

// -- Blocker 10: the complete grant matrix ---------------------------------

describe('A2.3 the API-role / table / function grant matrix', () => {
  const TABLES = [
    'shop_devices', 'shop_device_bindings', 'device_registry_events',
    // The session→installation mapping is the trust anchor, so it is locked
    // down exactly as hard as the rest.
    'auth_session_devices',
    'device_enrollment_holds',
  ];
  const API_ROLES = ['anon', 'authenticated', 'service_role'];

  it('grants NO api role any privilege on any registry table', async () => {
    // Every read and every write goes through a SECURITY DEFINER function, so
    // each one can assert its own authorization rather than hoping a policy
    // covers the case. service_role is included deliberately: BYPASSRLS is
    // not a substitute for a grant, and a table it cannot reach is a table no
    // Edge-function bug can reach either.
    const granted = await h.all<{ grantee: string; table_name: string; privilege_type: string }>(
      `select grantee, table_name, privilege_type
       from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = any($1)
         and grantee = any($2)
       order by grantee, table_name, privilege_type`,
      [TABLES, API_ROLES],
    );
    expect(granted).toEqual([]);
  });

  it('keeps RLS on, with no permissive policy to fall back to', async () => {
    const rows = await h.all<{ relname: string; relrowsecurity: boolean; policies: number }>(
      `select c.relname, c.relrowsecurity,
              (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1)`,
      [TABLES],
    );
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} RLS`).toBe(true);
      // A future accidental GRANT still denies rather than opening the table.
      expect(row.policies, `${row.relname} policies`).toBe(0);
    }
  });

  it('grants every A2.3 function to service_role and to nobody else', async () => {
    const rows = await h.all<{ routine: string; grantee: string }>(
      `select p.proname as routine,
              case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end as grantee
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where n.nspname = 'public' and p.proname like 'a23\_%'
         and a.privilege_type = 'EXECUTE'
         and (case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end) = any($1)
       order by p.proname, grantee`,
      [['anon', 'authenticated', 'service_role', 'public']],
    );
    const byRoutine = new Map<string, string[]>();
    for (const row of rows) {
      byRoutine.set(row.routine, [...(byRoutine.get(row.routine) ?? []), row.grantee]);
    }

    // The twelve reachable from the Edge function.
    for (const routine of [
      'a23_device_authority', 'a23_device_secret_hash', 'a23_session_gate',
      'a23_session_authority', 'a23_blocked_shops', 'a23_set_device_enforcement',
      'a23_reserve_attempts', 'a23_prepare_enrollment', 'a23_bind_auth_session',
      'a23_authorize_actor_switch', 'a23_revoke_binding', 'a23_restore_binding',
      'a23_revoke_device', 'a23_restore_device', 'a23_approve_enrollment',
      'a23_list_devices',
    ]) {
      expect(byRoutine.get(routine), routine).toEqual(['service_role']);
    }

    // And the FOUR internal functions, reachable by NOBODY but the ones
    // above them. anon/authenticated appear nowhere in the whole listing.
    //
    // a23_enroll_device is on this list for a security reason rather than a
    // tidiness one: granting it would restore the bypass this batch removed,
    // a route on which any live access token registers itself a brand-new
    // trusted installation.
    expect(byRoutine.get('a23_live_actor_role')).toBeUndefined();
    expect(byRoutine.get('a23_assert_device_admin')).toBeUndefined();
    expect(byRoutine.get('a23_enroll_device')).toBeUndefined();
    expect(byRoutine.get('a23_binding_shop_matches_device')).toBeUndefined();
    expect(rows.filter((row) => row.grantee !== 'service_role')).toEqual([]);
  });

  it('enumerates the complete A2.3 routine surface so new functions cannot escape the matrix', async () => {
    const rows = await h.all<{ proname: string }>(
      `select p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'a23\_%'
       order by p.proname`,
    );
    expect(rows.map((row) => row.proname)).toEqual([
      'a23_approve_enrollment',
      'a23_assert_device_admin',
      'a23_authorize_actor_switch',
      'a23_bind_auth_session',
      'a23_binding_shop_matches_device',
      'a23_blocked_shops',
      'a23_device_authority',
      'a23_device_secret_hash',
      'a23_enroll_device',
      'a23_list_devices',
      'a23_live_actor_role',
      'a23_prepare_enrollment',
      'a23_reserve_attempts',
      'a23_restore_binding',
      'a23_restore_device',
      'a23_revoke_binding',
      'a23_revoke_device',
      'a23_session_authority',
      'a23_session_gate',
      'a23_set_device_enforcement',
    ]);
  });

  it('runs every A2.3 function as a definer that owns the tables', async () => {
    const rows = await h.all<{ proname: string; prosecdef: boolean; owner: string }>(
      `select p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'a23\_%'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(14);
    for (const row of rows) {
      expect(row.prosecdef, `${row.proname} SECURITY DEFINER`).toBe(true);
      expect(row.owner, `${row.proname} owner`).toBe('postgres');
    }
  });

  it('pins every A2.3 function search_path so it cannot be shadowed', async () => {
    const rows = await h.all<{ proname: string; config: string[] | null }>(
      `select p.proname, p.proconfig as config
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'a23\_%'`,
    );
    for (const row of rows) {
      expect(row.config ?? [], `${row.proname} search_path`).toContain('search_path=public');
    }
  });
});
