import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sqliteConnection } from './test/client';
import { createShopAndOwner, setOwnerPin, verifyPin } from './auth';
import { createStaff } from './staff';
import { ALWAYS_LIVE } from './errors';
import {
  applyDeviceAuthority,
  deviceEnrolmentMatches,
  readDeviceSecret,
  readLocalDeviceBinding,
  readLocalDeviceRegistry,
} from './deviceRegistry';
import { __resetMMKVStores } from './test/react-native-mmkv';

// A2.3 staff first-login completion, on real SQLite.
//
// a23-device-registry.sqlite.test.ts owns the mirror's revocation rules. This
// file owns one SEQUENCE that file never runs: a staff member's FIRST phone +
// PIN sign-in on a till the owner had already registered.
//
// On hardware, the server enrolled them, rotated the device secret and answered
// 200 — and the screen said "Something went wrong. Please try again."
//
// The cause was an ordering the mirror could not see. Hydration applies the
// authority snapshot the pull carries, which has no secret in it, and that
// advanced the stored registry_version. The login response then arrived for the
// SAME version with a NEW secret, and the credential guard read equal version +
// different secret as a replayed response and discarded it. The caller turned
// that discard into a hard failure, so every retry re-enrolled, rotated the
// secret again, and failed again.
//
// The server increments registry_version on every bind, revoke and restore, so
// two credential responses can never share a version — equal only ever means a
// secretless snapshot got there first. A genuinely stale response is strictly
// lower, and the monotonic guard still discards it. Both halves are asserted
// here.

const MIGRATIONS = resolve('apps/mobile/db/migrations');
const DEVICE = 'installation-one';
const OWNER_SECRET = 'a'.repeat(64);
const STAFF_SECRET = 'b'.repeat(64);
const FIXTURE_TABLES = [
  'device_binding_state', 'device_registry_state',
  'user_permissions', 'audit_logs', 'sync_queue', 'users', 'roles', 'shops',
];

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

beforeAll(() => {
  for (const name of [
    '0000_open_senator_kelly.sql', '0001_medicines_fts.sql', '0002_furry_celestials.sql',
    '0003_curious_wild_pack.sql', '0004_deep_boomer.sql', '0005_eminent_legion.sql',
    '0006_inventory_movement_ledger.sql', '0007_staff_device_login.sql',
    '0008_native_pin_lookup.sql', '0009_strong_gargoyle.sql', '0010_known_ares.sql',
    '0013_owner_dashboard_credit_period.sql', '0014_owner_dashboard_credit_period_guard.sql',
    '0015_b3_shop_settings.sql', '0027_h7_local_access_lock.sql',
    '0028_shop_scoped_pin_lookup.sql', '0029_pin_reserved_while_inactive.sql',
    '0030_a23_device_registry_mirror.sql',
  ]) migrate(name);
});

beforeEach(() => {
  sqliteConnection.execSync('PRAGMA foreign_keys = OFF');
  for (const table of FIXTURE_TABLES) {
    sqliteConnection.execSync('DELETE FROM ' + table);
  }
  sqliteConnection.execSync('PRAGMA foreign_keys = ON');
  __resetMMKVStores();
});

async function shopWithStaff() {
  const owner = await createShopAndOwner({ shopName: 'Handover Shop', phone: '01713000001' });
  await setOwnerPin(owner.userId, '1234');
  const staff = await createStaff(
    owner.shopId,
    owner.userId,
    { name: 'Arif', phone: '01713000002', rawPin: '5678', permissions: {} },
    ALWAYS_LIVE,
  );
  return { ...owner, staffId: staff.id };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    known: true,
    status: 'active',
    registryVersion: 1,
    enforced: false,
    bindings: [],
    ...overrides,
  };
}

/** The owner's registration: this installation already holds a secret. */
async function ownerAlreadyEnrolled(shopId: string, ownerUserId: string): Promise<void> {
  const applied = await applyDeviceAuthority(shopId, DEVICE, snapshot({
    registryVersion: 1,
    bindings: [{ actorUserId: ownerUserId, status: 'active', bindingVersion: 1 }],
  }), { deviceSecret: OWNER_SECRET });
  expect(applied).toBe(true);
}

describe('A2.3 a staff first login completes on an installation the owner registered', () => {
  it('stores the rotated secret even though the pull recorded the version first', async () => {
    const shop = await shopWithStaff();
    await ownerAlreadyEnrolled(shop.shopId, shop.userId);

    // Hydration's attached snapshot: the same version the login response
    // carries, and deliberately NO secret. This is the write that used to
    // poison the one after it.
    const pulled = snapshot({
      registryVersion: 2,
      bindings: [
        { actorUserId: shop.userId, status: 'active', bindingVersion: 1 },
        { actorUserId: shop.staffId, status: 'active', bindingVersion: 1 },
      ],
    });
    expect(await applyDeviceAuthority(shop.shopId, DEVICE, pulled)).toBe(true);
    expect(await readDeviceSecret(shop.shopId)).toBe(OWNER_SECRET);

    // The login response, for the SAME version, carrying the new secret.
    expect(
      await applyDeviceAuthority(shop.shopId, DEVICE, pulled, { deviceSecret: STAFF_SECRET }),
    ).toBe(true);
    expect(await readDeviceSecret(shop.shopId)).toBe(STAFF_SECRET);
    expect(await deviceEnrolmentMatches(shop.shopId, DEVICE, STAFF_SECRET)).toBe(true);
  });

  it('lets the staff member sign in with the PIN alone straight afterwards', async () => {
    const shop = await shopWithStaff();
    await ownerAlreadyEnrolled(shop.shopId, shop.userId);
    await applyDeviceAuthority(shop.shopId, DEVICE, snapshot({
      registryVersion: 2,
      bindings: [{ actorUserId: shop.staffId, status: 'active', bindingVersion: 1 }],
    }), { deviceSecret: STAFF_SECRET });

    expect(await readLocalDeviceBinding(shop.shopId, shop.staffId))
      .toMatchObject({ status: 'active' });
    await expect(verifyPin('5678')).resolves.toMatchObject({ userId: shop.staffId });
  });

  it('keeps the enrolment across a force-stop, so PIN login still needs no phone', async () => {
    const shop = await shopWithStaff();
    await ownerAlreadyEnrolled(shop.shopId, shop.userId);
    await applyDeviceAuthority(shop.shopId, DEVICE, snapshot({
      registryVersion: 2,
      bindings: [{ actorUserId: shop.staffId, status: 'active', bindingVersion: 1 }],
    }), { deviceSecret: STAFF_SECRET });

    // A force-stop loses MMKV-held process state. The sibling suite proves the
    // secret itself survives that; what matters here is the whole enrolment
    // still being usable afterwards — PIN only, no phone number.
    __resetMMKVStores();

    expect(await deviceEnrolmentMatches(shop.shopId, DEVICE, STAFF_SECRET)).toBe(true);
    expect(await readLocalDeviceRegistry(shop.shopId)).toMatchObject({
      devicePublicId: DEVICE,
      status: 'active',
      isEnrolled: true,
    });
    await expect(verifyPin('5678')).resolves.toMatchObject({ userId: shop.staffId });
  });

  it('accepts a credential after a reinstall, when the row names the previous id', async () => {
    const shop = await shopWithStaff();
    await ownerAlreadyEnrolled(shop.shopId, shop.userId);
    sqliteConnection.execSync(
      "UPDATE device_registry_state SET device_public_id = 'installation-previous'",
    );

    // Re-enrolment after a reinstall is the one moment a credential MUST be
    // able to land. Refusing it left the handset unable to store any secret.
    expect(await applyDeviceAuthority(shop.shopId, DEVICE, snapshot({
      registryVersion: 9,
      bindings: [{ actorUserId: shop.staffId, status: 'active', bindingVersion: 1 }],
    }), { deviceSecret: STAFF_SECRET })).toBe(true);
    expect(await deviceEnrolmentMatches(shop.shopId, DEVICE, STAFF_SECRET)).toBe(true);
  });

  it('is idempotent, so a repeated response neither fails nor rotates anything', async () => {
    const shop = await shopWithStaff();
    await ownerAlreadyEnrolled(shop.shopId, shop.userId);
    const login = snapshot({
      registryVersion: 2,
      bindings: [{ actorUserId: shop.staffId, status: 'active', bindingVersion: 1 }],
    });

    expect(await applyDeviceAuthority(shop.shopId, DEVICE, login, { deviceSecret: STAFF_SECRET }))
      .toBe(true);
    expect(await applyDeviceAuthority(shop.shopId, DEVICE, login, { deviceSecret: STAFF_SECRET }))
      .toBe(true);
    expect(await readDeviceSecret(shop.shopId)).toBe(STAFF_SECRET);
  });
});

describe('A2.3 the replay and revocation guarantees are unchanged', () => {
  it('still discards a credential response carrying an OLDER version', async () => {
    const shop = await shopWithStaff();
    await applyDeviceAuthority(shop.shopId, DEVICE, snapshot({
      registryVersion: 5,
      bindings: [{ actorUserId: shop.userId, status: 'active', bindingVersion: 1 }],
    }), { deviceSecret: OWNER_SECRET });

    expect(await applyDeviceAuthority(shop.shopId, DEVICE, snapshot({
      registryVersion: 4,
      bindings: [{ actorUserId: shop.userId, status: 'active', bindingVersion: 1 }],
    }), { deviceSecret: STAFF_SECRET })).toBe(false);
    expect(await readDeviceSecret(shop.shopId)).toBe(OWNER_SECRET);
    expect(await deviceEnrolmentMatches(shop.shopId, DEVICE, STAFF_SECRET)).toBe(false);
  });

  it('cannot be talked out of a revocation by a replayed credential response', async () => {
    const shop = await shopWithStaff();
    await applyDeviceAuthority(shop.shopId, DEVICE, snapshot({
      registryVersion: 5,
      bindings: [{ actorUserId: shop.userId, status: 'active', bindingVersion: 1 }],
    }), { deviceSecret: OWNER_SECRET });
    // A revoke advances the version server-side, which is what puts a replay
    // strictly behind it.
    await applyDeviceAuthority(shop.shopId, DEVICE, snapshot({
      status: 'revoked',
      registryVersion: 6,
      bindings: [{ actorUserId: shop.userId, status: 'active', bindingVersion: 1 }],
    }));

    expect(await applyDeviceAuthority(shop.shopId, DEVICE, snapshot({
      registryVersion: 5,
      bindings: [{ actorUserId: shop.userId, status: 'active', bindingVersion: 1 }],
    }), { deviceSecret: STAFF_SECRET })).toBe(false);
    expect(await readLocalDeviceRegistry(shop.shopId)).toMatchObject({ status: 'revoked' });
    expect(await deviceEnrolmentMatches(shop.shopId, DEVICE, STAFF_SECRET)).toBe(false);
  });

  it('never reports a revoked installation as an enrolment, even holding its secret', async () => {
    const shop = await shopWithStaff();
    await applyDeviceAuthority(shop.shopId, DEVICE, snapshot({
      registryVersion: 1,
      bindings: [{ actorUserId: shop.userId, status: 'active', bindingVersion: 1 }],
    }), { deviceSecret: OWNER_SECRET });
    await applyDeviceAuthority(shop.shopId, DEVICE, snapshot({
      status: 'revoked', registryVersion: 2,
    }));

    expect(await readDeviceSecret(shop.shopId)).toBe(OWNER_SECRET);
    expect(await deviceEnrolmentMatches(shop.shopId, DEVICE, OWNER_SECRET)).toBe(false);
  });
});
