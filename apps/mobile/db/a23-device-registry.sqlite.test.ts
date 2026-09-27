import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sqliteConnection } from './test/client';
import { createShopAndOwner, setOwnerPin, verifyPin } from './auth';
import { createStaff } from './staff';
import { ALWAYS_LIVE, DeviceAccessRevokedError } from './errors';
import { PIN_FREE_ATTEMPTS, pinAttemptScope, pinAttemptStatus } from './pinAttemptLock';
import {
  applyDeviceAuthority,
  forgetDeviceEnrolment,
  readDeviceAccessObjection,
  readDeviceSecret,
  readLocalDeviceBinding,
  readLocalDeviceRegistry,
} from './deviceRegistry';
import { readLastShopIdSync } from '../state/sessionStore';
import { __resetMMKVStores } from './test/react-native-mmkv';
import { handleDeviceRevocation } from '../sync/deviceRevocation';
import { readSessionAuthorityLease } from '../sync/sessionAuthorityStore';

// A2.3, local half. The pgtest proves the server's rules; this proves what the
// DEVICE does with the answers, on real SQLite.
//
// Two guarantees carry the batch, and most of this file is about them:
//
//   1. A revoked binding blocks that person's PIN login and spends NO H-4
//      attempt budget. The credential MATCHED — the refusal is commercial, not
//      a guess — and charging for it would let one revoked account burn the
//      shop-wide budget its colleagues still need on the same handset.
//
//   2. Once learned, a revocation cannot be talked back out of. Only a fresh
//      authoritative snapshot carrying a newer version lifts it; a replayed
//      older one, an "unknown device" answer, and a wiped MMKV store all leave
//      it exactly where it was.

const MIGRATIONS = resolve('apps/mobile/db/migrations');
const FIXTURE_TABLES = [
  'device_binding_state', 'device_registry_state',
  'user_permissions', 'audit_logs', 'sync_queue', 'users', 'roles', 'shops',
];

const DEVICE = 'installation-one';

interface Snapshot {
  known: boolean;
  status: string;
  registryVersion: number;
  enforced: boolean;
  bindings: { actorUserId: string; status: string; bindingVersion: number }[];
}

function migrate(name: string): void {
  sqliteConnection.execSync(readFileSync(resolve(MIGRATIONS, name), 'utf8'));
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    known: true,
    status: 'active',
    registryVersion: 1,
    enforced: true,
    bindings: [],
    ...overrides,
  };
}

beforeAll(() => {
  for (const name of [
    '0000_open_senator_kelly.sql',
    '0001_medicines_fts.sql',
    '0002_furry_celestials.sql',
    '0003_curious_wild_pack.sql',
    '0004_deep_boomer.sql',
    '0005_eminent_legion.sql',
    '0006_inventory_movement_ledger.sql',
    '0007_staff_device_login.sql',
    '0008_native_pin_lookup.sql',
    '0009_strong_gargoyle.sql',
    '0010_known_ares.sql',
    '0013_owner_dashboard_credit_period.sql',
    '0014_owner_dashboard_credit_period_guard.sql',
    '0015_b3_shop_settings.sql',
    '0027_h7_local_access_lock.sql',
    '0028_shop_scoped_pin_lookup.sql',
    '0029_pin_reserved_while_inactive.sql',
    '0030_a23_device_registry_mirror.sql',
  ]) migrate(name);
});

beforeEach(() => {
  sqliteConnection.execSync('PRAGMA foreign_keys = OFF');
  for (const table of FIXTURE_TABLES) {
    sqliteConnection.execSync(`DELETE FROM ${table}`);
  }
  sqliteConnection.execSync('PRAGMA foreign_keys = ON');
  // The H-4 budget is device state, not database state, so clearing the tables
  // above does not reach it.
  __resetMMKVStores();
});

async function shopWithStaff() {
  const owner = await createShopAndOwner({ shopName: 'Registry Shop', phone: '01713000001' });
  await setOwnerPin(owner.userId, '1234');
  await createStaff(
    owner.shopId,
    owner.userId,
    { name: 'Arif', phone: '01713000002', rawPin: '5678', permissions: {} },
    ALWAYS_LIVE,
  );
  return owner;
}

/**
 * Attempts the H-4 counter has actually charged.
 *
 * Resolved through readLastShopIdSync exactly as db/auth.ts's verifyPin does.
 * Keying this on the shop id instead would read an empty, unrelated scope and
 * make every "spent nothing" assertion below pass for the wrong reason.
 */
function spentAttempts(): number {
  return pinAttemptStatus(pinAttemptScope(readLastShopIdSync())).failures;
}

describe('A2.3 the mirror refuses nothing it was never told about', () => {
  it('permits PIN login on an installation the registry has never seen', async () => {
    const owner = await shopWithStaff();
    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBeNull();
    await expect(verifyPin('1234')).resolves.toMatchObject({ userId: owner.userId });
  });

  it('permits PIN login on a KNOWN, active installation with no binding row yet', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot());
    // An absent binding is "unknown", never "revoked" — this is what lets an
    // actor sign in for the first time on an already-registered till.
    expect(await readLocalDeviceBinding(owner.shopId, owner.userId)).toBeNull();
    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBeNull();
    await expect(verifyPin('1234')).resolves.toMatchObject({ userId: owner.userId });
  });
});

describe('A2.3 a revoked binding blocks local PIN access', () => {
  it('refuses that actor by name, and spends NO H-4 attempt budget', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      registryVersion: 2,
      bindings: [{ actorUserId: owner.userId, status: 'revoked', bindingVersion: 2 }],
    }));

    expect(spentAttempts()).toBe(0);
    await expect(verifyPin('1234')).rejects.toBeInstanceOf(DeviceAccessRevokedError);
    await expect(verifyPin('1234')).rejects.toMatchObject({ objection: 'binding_revoked' });

    // THE guarantee. Two refusals, zero budget spent: the PIN was right, so
    // nothing was guessed.
    expect(spentAttempts()).toBe(0);
  });

  it('leaves the colleague on the same installation untouched', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      registryVersion: 2,
      bindings: [{ actorUserId: owner.userId, status: 'revoked', bindingVersion: 2 }],
    }));

    // Staff was never mentioned in that snapshot, so staff is unaffected.
    await expect(verifyPin('5678')).resolves.toMatchObject({ role: 'staff' });
  });

  it('still charges a genuinely WRONG PIN, so the H-4 guard is not weakened', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      registryVersion: 2,
      bindings: [{ actorUserId: owner.userId, status: 'revoked', bindingVersion: 2 }],
    }));

    expect(spentAttempts()).toBe(0);
    await expect(verifyPin('9999')).resolves.toBeNull();
    expect(spentAttempts()).toBe(1);
    // The budget is still the H-4 one, untouched by A2.3.
    expect(PIN_FREE_ATTEMPTS).toBe(5);
  });
});

describe('A2.3 a revoked device quarantines everyone on it', () => {
  it('refuses every actor of the shop, including ones with no binding row', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      status: 'revoked',
      registryVersion: 3,
      bindings: [{ actorUserId: owner.userId, status: 'revoked', bindingVersion: 3 }],
    }));

    await expect(verifyPin('1234')).rejects.toMatchObject({ objection: 'device_revoked' });
    // Staff has no binding row at all and is still refused — the device answer
    // is checked first, and answers for everybody.
    await expect(verifyPin('5678')).rejects.toMatchObject({ objection: 'device_revoked' });
  });

  it('reports device revocation ahead of a binding revocation', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      status: 'revoked',
      registryVersion: 3,
      bindings: [{ actorUserId: owner.userId, status: 'revoked', bindingVersion: 3 }],
    }));
    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBe('device_revoked');
  });
});

describe('A2.3 revocation persists and cannot be talked back out of', () => {
  it('survives a restart — it lives in the encrypted database, not in MMKV', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      status: 'revoked', registryVersion: 5,
    }));

    // Everything MMKV holds is gone; a force-stop, a sign-out and an H-4 reset
    // all look like this. The revocation is untouched.
    __resetMMKVStores();
    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBe('device_revoked');
  });

  it('discards a REPLAYED older snapshot instead of lifting the revocation', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      status: 'revoked', registryVersion: 5,
    }));

    const applied = await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      status: 'active', registryVersion: 4,
    }));
    expect(applied).toBe(false);
    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBe('device_revoked');
  });

  it('accepts an equal version, because a re-fetch is not a replay', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({ registryVersion: 5 }));
    expect(await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({ registryVersion: 5 })))
      .toBe(true);
  });

  it('lifts it only on a NEWER authoritative snapshot', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      status: 'revoked',
      registryVersion: 5,
      bindings: [{ actorUserId: owner.userId, status: 'revoked', bindingVersion: 5 }],
    }));

    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      status: 'active',
      registryVersion: 6,
      bindings: [{ actorUserId: owner.userId, status: 'active', bindingVersion: 6 }],
    }));
    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBeNull();
    await expect(verifyPin('1234')).resolves.toMatchObject({ userId: owner.userId });
  });

  it('never lets an "unknown device" answer clear an existing revocation', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      status: 'revoked', registryVersion: 5,
    }));

    // What the server returns for a device row it cannot find. Silence about a
    // device is not proof that its revocation was lifted.
    await applyDeviceAuthority(owner.shopId, DEVICE, {
      known: false, status: 'unknown', registryVersion: 9, enforced: true, bindings: [],
    });
    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBe('device_revoked');
  });

  it('never lets a stale binding version downgrade a newer one', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      registryVersion: 5,
      bindings: [{ actorUserId: owner.userId, status: 'revoked', bindingVersion: 5 }],
    }));
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      registryVersion: 6,
      bindings: [{ actorUserId: owner.userId, status: 'active', bindingVersion: 4 }],
    }));
    expect(await readLocalDeviceBinding(owner.shopId, owner.userId))
      .toEqual({ status: 'revoked', bindingVersion: 5 });
  });
});

describe('A2.3 the enrolment secret', () => {
  it('is stored only when issued, and re-issued only when the server says so', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot(), { deviceSecret: 'secret-one' });
    expect(await readDeviceSecret(owner.shopId)).toBe('secret-one');

    // A routine snapshot carries no secret, and must not erase the stored one.
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({ registryVersion: 2 }));
    expect(await readDeviceSecret(owner.shopId)).toBe('secret-one');

    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({ registryVersion: 3 }), {
      deviceSecret: 'secret-two',
    });
    expect(await readDeviceSecret(owner.shopId)).toBe('secret-two');
  });

  it('never lets a STRICTLY OLDER authority replace a newer valid secret', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({ registryVersion: 5 }), {
      deviceSecret: 'newest-valid-secret',
    });

    await expect(applyDeviceAuthority(
      owner.shopId,
      DEVICE,
      snapshot({ registryVersion: 4 }),
      { deviceSecret: 'older-secret' },
    )).resolves.toBe(false);

    expect(await readDeviceSecret(owner.shopId)).toBe('newest-valid-secret');
    expect(await readLocalDeviceRegistry(owner.shopId)).toMatchObject({
      devicePublicId: DEVICE,
      registryVersion: 5,
    });
  });

  // This test used to assert the opposite of both cases below, and it was
  // wrong — see a23-staff-first-login.sqlite.test.ts for the hardware failure
  // that proved it. Refusing an equal version whose secret differed treated the
  // ordinary shape of a login as a replay, because hydration records the
  // version from a SECRETLESS pull snapshot before the response's secret
  // arrives for that same version. Two credential responses can never share a
  // version — the server increments it on every bind, revoke and restore — so
  // there was never a replay for this branch to catch, and a genuinely stale
  // response is strictly lower and still refused above.
  it('accepts a rotated secret at an equal version, and after an id change', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({ registryVersion: 5 }), {
      deviceSecret: 'pull-recorded-this-version',
    });

    await expect(applyDeviceAuthority(
      owner.shopId,
      DEVICE,
      snapshot({ registryVersion: 5 }),
      { deviceSecret: 'rotated-equal-version-secret' },
    )).resolves.toBe(true);
    expect(await readDeviceSecret(owner.shopId)).toBe('rotated-equal-version-secret');

    // A reinstall gives this handset a new installation id while the stored row
    // still names the old one. That is precisely when re-enrolment has to land.
    await expect(applyDeviceAuthority(
      owner.shopId,
      'reinstalled-installation',
      snapshot({ registryVersion: 6 }),
      { deviceSecret: 'reinstalled-secret' },
    )).resolves.toBe(true);
    expect(await readLocalDeviceRegistry(owner.shopId)).toMatchObject({
      devicePublicId: 'reinstalled-installation',
      registryVersion: 6,
    });
  });

  it('accepts an idempotent equal-version retry carrying the same secret', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({ registryVersion: 5 }), {
      deviceSecret: 'same-secret',
    });
    await expect(applyDeviceAuthority(
      owner.shopId,
      DEVICE,
      snapshot({ registryVersion: 5 }),
      { deviceSecret: 'same-secret' },
    )).resolves.toBe(true);
    expect(await readDeviceSecret(owner.shopId)).toBe('same-secret');
  });

  it('keeps the installation secret in encrypted SQLite when MMKV state is wiped', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({ registryVersion: 5 }), {
      deviceSecret: 'sqlcipher-only-secret',
    });

    __resetMMKVStores();

    expect(await readDeviceSecret(owner.shopId)).toBe('sqlcipher-only-secret');
  });

  it('is dropped without disturbing status, because forgetting is not evidence', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      status: 'revoked', registryVersion: 4,
    }), { deviceSecret: 'secret-one' });

    await forgetDeviceEnrolment(owner.shopId);

    expect(await readDeviceSecret(owner.shopId)).toBeNull();
    expect(await readLocalDeviceRegistry(owner.shopId))
      .toMatchObject({ status: 'revoked', registryVersion: 4, isEnrolled: false });
    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBe('device_revoked');
  });

  it('is never written to the sync outbox', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot(), { deviceSecret: 'secret-one' });
    expect(sqliteConnection.getAllSync(
      `SELECT payload FROM sync_queue WHERE payload LIKE '%secret-one%'`,
    )).toEqual([]);
  });
});

// -- Blocker 6: the snapshot lands atomically ------------------------------

describe('A2.3 one snapshot, one transaction', () => {
  it('commits the device row and every binding together', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      registryVersion: 4,
      bindings: [
        { actorUserId: owner.userId, status: 'revoked', bindingVersion: 2 },
        { actorUserId: 'colleague', status: 'active', bindingVersion: 3 },
      ],
    }));

    const registry = await readLocalDeviceRegistry(owner.shopId);
    expect(registry?.registryVersion).toBe(4);
    expect((await readLocalDeviceBinding(owner.shopId, owner.userId))?.status).toBe('revoked');
    expect((await readLocalDeviceBinding(owner.shopId, 'colleague'))?.status).toBe('active');
  });

  it('writes NOTHING when a binding in the same snapshot cannot be stored', async () => {
    // The crash case, forced. A snapshot used to be written as a device row
    // followed by N separate binding writes, so a kill — or a dying battery,
    // which a shop phone does — between them left registry_version ALREADY
    // ADVANCED while a binding the same snapshot revoked was still stored as
    // active. The monotonic guard would then reject the re-sent snapshot as
    // stale, and the device would sit there holding a revoked account as live
    // with nothing able to correct it.
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      registryVersion: 1,
      bindings: [{ actorUserId: owner.userId, status: 'active', bindingVersion: 1 }],
    }));

    // Make the binding write fail partway through the transaction.
    sqliteConnection.execSync(`
      CREATE TRIGGER a23_fail_binding BEFORE UPDATE ON device_binding_state
      BEGIN SELECT RAISE(ABORT, 'simulated crash'); END;
    `);
    let threw = false;
    try {
      await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
        registryVersion: 9,
        bindings: [{ actorUserId: owner.userId, status: 'revoked', bindingVersion: 5 }],
      }));
    } catch {
      threw = true;
    } finally {
      sqliteConnection.execSync('DROP TRIGGER a23_fail_binding');
    }
    expect(threw).toBe(true);

    // The device version must NOT have moved on its own. Both halves rolled
    // back, so the next delivery of the same snapshot is still newer and
    // still applies.
    const registry = await readLocalDeviceRegistry(owner.shopId);
    expect(registry?.registryVersion).toBe(1);
    expect((await readLocalDeviceBinding(owner.shopId, owner.userId))?.status).toBe('active');

    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      registryVersion: 9,
      bindings: [{ actorUserId: owner.userId, status: 'revoked', bindingVersion: 5 }],
    }));
    expect((await readLocalDeviceBinding(owner.shopId, owner.userId))?.status).toBe('revoked');
    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBe('binding_revoked');
  });
});

// -- Blocker 7: an unreadable mirror fails closed --------------------------

describe('A2.3 a mirror that will not answer', () => {
  it('reports read_failed rather than "no objection"', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      bindings: [{ actorUserId: owner.userId, status: 'active', bindingVersion: 1 }],
    }));
    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBeNull();

    // Corruption, as the reader experiences it: the table is there (so the
    // pre-0030 compatibility path does not apply) but reading it raises.
    sqliteConnection.execSync('ALTER TABLE device_binding_state RENAME TO device_binding_state_x');
    try {
      // Returning null here would have made `DELETE FROM device_binding_state`
      // — or any corruption resembling it — the way to undo a revocation.
      expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBe('read_failed');
    } finally {
      sqliteConnection.execSync(
        'ALTER TABLE device_binding_state_x RENAME TO device_binding_state',
      );
    }
  });

  it('refuses the PIN login, and still spends no H-4 budget', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      bindings: [{ actorUserId: owner.userId, status: 'active', bindingVersion: 1 }],
    }));
    expect(await verifyPin('1234')).not.toBeNull();
    const before = spentAttempts();

    sqliteConnection.execSync('ALTER TABLE device_binding_state RENAME TO device_binding_state_x');
    try {
      await expect(verifyPin('1234')).rejects.toBeInstanceOf(DeviceAccessRevokedError);
      await expect(verifyPin('1234')).rejects.toMatchObject({ objection: 'read_failed' });
    } finally {
      sqliteConnection.execSync(
        'ALTER TABLE device_binding_state_x RENAME TO device_binding_state',
      );
    }
    // The PIN was correct. Charging for a fault in our own storage would
    // spend the shop-wide budget its colleagues need.
    expect(spentAttempts()).toBe(before);

    // And it is a fault, not a verdict: nothing was persisted, so the login
    // works again the moment the table is readable.
    expect(await verifyPin('1234')).not.toBeNull();
  });

  it('still says nothing at all on a database that predates migration 0030', async () => {
    // The compatibility case, kept strictly apart from corruption: a missing
    // table is the ordinary pre-A2.3 state and must stay "no objection", or
    // upgrading shops would be locked out by their own history.
    const owner = await shopWithStaff();
    sqliteConnection.execSync('ALTER TABLE device_registry_state RENAME TO device_registry_state_x');
    try {
      expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBeNull();
      expect(await verifyPin('1234')).not.toBeNull();
    } finally {
      sqliteConnection.execSync(
        'ALTER TABLE device_registry_state_x RENAME TO device_registry_state',
      );
    }
  });
});

// -- Blocker 4: revocation persists with no session at all -----------------

describe('A2.3 a revocation learned without a session', () => {
  it('writes the SQLite snapshot before immediately writing H-10 quarantine', async () => {
    const owner = await shopWithStaff();
    await handleDeviceRevocation(
      owner.shopId,
      owner.userId,
      'device_revoked',
      snapshot({ status: 'revoked', registryVersion: 8 }),
    );

    expect(await readLocalDeviceRegistry(owner.shopId)).toMatchObject({
      status: 'revoked', registryVersion: 8,
    });
    expect(readSessionAuthorityLease(owner.shopId, owner.userId)).toMatchObject({
      status: 'valid',
      record: { quarantineReason: 'device_revoked' },
    });
  });

  it('does not write H-10 quarantine if the SQLite snapshot cannot commit', async () => {
    const owner = await shopWithStaff();
    sqliteConnection.execSync(`
      CREATE TRIGGER a23_test_abort_snapshot
      BEFORE INSERT ON device_registry_state
      BEGIN
        SELECT RAISE(ABORT, 'forced snapshot failure');
      END;
    `);
    try {
      await expect(handleDeviceRevocation(
        owner.shopId,
        owner.userId,
        'device_revoked',
        snapshot({ status: 'revoked', registryVersion: 8 }),
      )).rejects.toThrow(/forced snapshot failure/);
      expect(readSessionAuthorityLease(owner.shopId, owner.userId).status).toBe('absent');
    } finally {
      sqliteConnection.execSync('DROP TRIGGER a23_test_abort_snapshot');
    }
  });

  it('does not quarantine a pre-0030 database that cannot persist the snapshot', async () => {
    const owner = await shopWithStaff();
    sqliteConnection.execSync('ALTER TABLE device_registry_state RENAME TO device_registry_state_x');
    try {
      await expect(handleDeviceRevocation(
        owner.shopId,
        owner.userId,
        'device_revoked',
        snapshot({ status: 'revoked', registryVersion: 8 }),
      )).rejects.toThrow(/was not persisted/);
      expect(readSessionAuthorityLease(owner.shopId, owner.userId).status).toBe('absent');
    } finally {
      sqliteConnection.execSync(
        'ALTER TABLE device_registry_state_x RENAME TO device_registry_state',
      );
    }
  });

  it('fails closed without inventing quarantine from a malformed snapshot', async () => {
    const owner = await shopWithStaff();
    await expect(handleDeviceRevocation(
      owner.shopId,
      owner.userId,
      'device_revoked',
      { status: 'revoked' },
    )).rejects.toThrow(/omitted a valid snapshot/);
    expect(await readLocalDeviceRegistry(owner.shopId)).toBeNull();
    expect(readSessionAuthorityLease(owner.shopId, owner.userId).status).toBe('absent');
  });

  it('survives once written, with no authenticated refresh anywhere', async () => {
    // What switchActorOnDevice now does with the snapshot the server attaches
    // to its 403. The actor switch is unauthenticated by necessity — the
    // outgoing session is expired or gone — so this write is the ONLY chance
    // to record the quarantine. It used to depend on a follow-up
    // authenticated refresh that a device in this state cannot make, which
    // made the refusal last exactly as long as the screen did.
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      status: 'revoked',
      registryVersion: 7,
      bindings: [{ actorUserId: owner.userId, status: 'revoked', bindingVersion: 3 }],
    }));

    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBe('device_revoked');
    // Reopening the app: MMKV is gone, the mirror is not.
    __resetMMKVStores();
    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBe('device_revoked');
    await expect(verifyPin('1234')).rejects.toMatchObject({ objection: 'device_revoked' });
  });

  it('cannot be talked out of by replaying the older, healthy snapshot', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      status: 'revoked', registryVersion: 7,
    }));
    // A cached proxy response, a retry, or a hostile network replaying the
    // page that came before the revocation.
    expect(await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      status: 'active', registryVersion: 6,
    }))).toBe(false);
    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBe('device_revoked');
  });
});

// -- Blocker 8: the monotonic comparison happens INSIDE the transaction ------

describe('A2.3 concurrent snapshots cannot commit out of order', () => {
  it('discards an older snapshot started before a newer one committed', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({ registryVersion: 1 }));

    // Both in flight at once, which is the ordinary case rather than an exotic
    // one: a pull page and an explicit refresh overlap constantly, and a 403's
    // attached authority can arrive while a cycle is running.
    //
    // The comparison used to sit OUTSIDE the transaction, so the stale
    // snapshot could read version 1, lose the thread at an await while the
    // revocation committed version 9, and then write ACTIVE back over it. The
    // read and the write are now one atomic step.
    const [stale, fresh] = await Promise.all([
      applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
        status: 'active',
        registryVersion: 2,
        bindings: [{ actorUserId: owner.userId, status: 'active', bindingVersion: 1 }],
      })),
      applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
        status: 'revoked',
        registryVersion: 9,
        bindings: [{ actorUserId: owner.userId, status: 'revoked', bindingVersion: 5 }],
      })),
    ]);

    // Whichever order they interleaved in, the NEWER state is what survives.
    expect(fresh).toBe(true);
    const registry = await readLocalDeviceRegistry(owner.shopId);
    expect(registry?.registryVersion).toBe(9);
    expect(registry?.status).toBe('revoked');
    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBe('device_revoked');
    // And if the stale one reported success, that can only be because it
    // committed FIRST — never after.
    expect(stale === false || registry?.registryVersion === 9).toBe(true);
  });

  it('survives a burst of interleaved snapshots, newest always winning', async () => {
    const owner = await shopWithStaff();
    // Deliberately submitted newest-first, so a naive implementation that
    // simply applies in completion order ends on the OLDEST.
    const versions = [12, 3, 11, 1, 7, 12, 2];
    await Promise.all(versions.map((registryVersion) => applyDeviceAuthority(
      owner.shopId,
      DEVICE,
      snapshot({
        registryVersion,
        status: registryVersion === 12 ? 'revoked' : 'active',
        bindings: [{
          actorUserId: owner.userId,
          status: registryVersion === 12 ? 'revoked' : 'active',
          bindingVersion: registryVersion,
        }],
      }),
    )));

    const registry = await readLocalDeviceRegistry(owner.shopId);
    expect(registry?.registryVersion).toBe(12);
    expect(registry?.status).toBe('revoked');
    expect((await readLocalDeviceBinding(owner.shopId, owner.userId))?.bindingVersion).toBe(12);
    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBe('device_revoked');
  });

  it('guards each BINDING version independently, inside the same transaction', async () => {
    const owner = await shopWithStaff();
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      registryVersion: 5,
      bindings: [{ actorUserId: owner.userId, status: 'revoked', bindingVersion: 9 }],
    }));

    // A NEWER device version carrying an OLDER binding version. The device row
    // moves; the binding must not, or a revocation could be undone by any
    // later snapshot that happened to mention it staler.
    await applyDeviceAuthority(owner.shopId, DEVICE, snapshot({
      registryVersion: 6,
      bindings: [{ actorUserId: owner.userId, status: 'active', bindingVersion: 4 }],
    }));

    expect((await readLocalDeviceRegistry(owner.shopId))?.registryVersion).toBe(6);
    expect(await readLocalDeviceBinding(owner.shopId, owner.userId))
      .toEqual({ status: 'revoked', bindingVersion: 9 });
    expect(await readDeviceAccessObjection(owner.shopId, owner.userId)).toBe('binding_revoked');
  });
});
