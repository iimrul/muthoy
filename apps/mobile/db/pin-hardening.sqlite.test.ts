import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sqliteConnection } from './test/client';
import { createShopAndOwner, setOwnerPin, verifyPin } from './auth';
import { createStaff } from './staff';
import { ALWAYS_LIVE, PinLockedOutError } from './errors';
import {
  PIN_FAILURE_DECAY_MS,
  PIN_FREE_ATTEMPTS,
  pinAttemptScope,
  pinAttemptStatus,
} from './pinAttemptLock';
import { PIN_TIMING_MINIMUM_QUANTA, PIN_TIMING_QUANTUM_MS } from './pinTiming';
import { __resetMMKVStores } from './test/react-native-mmkv';
import {
  getNativeCryptoTestCounters,
  resetNativeCryptoTestCounters,
} from './test/muthoy-pin-crypto';

// H-4, behavioural half. db/pin-attempt-lock.test.ts proves the counter and
// db/pin-timing.test.ts proves the quantiser; this proves the offline login
// path in db/auth.ts actually spends the one and is shaped by the other,
// against real SQLite rather than a mock of it.

const MIGRATIONS = resolve('apps/mobile/db/migrations');
const FLOOR_MS = PIN_TIMING_QUANTUM_MS * PIN_TIMING_MINIMUM_QUANTA;
// Timer granularity and event-loop scheduling both round against us on CI.
const FLOOR_TOLERANCE_MS = 25;
const FIXTURE_TABLES = ['user_permissions', 'audit_logs', 'sync_queue', 'users', 'roles', 'shops'];

function migrate(name: string): void {
  sqliteConnection.execSync(readFileSync(resolve(MIGRATIONS, name), 'utf8'));
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
  ]) migrate(name);
});

beforeEach(() => {
  sqliteConnection.execSync('PRAGMA foreign_keys = OFF');
  for (const table of FIXTURE_TABLES) {
    sqliteConnection.execSync(`DELETE FROM ${table}`);
  }
  sqliteConnection.execSync('PRAGMA foreign_keys = ON');
  // The attempt budget is device state, not database state, so clearing the
  // tables above does not reach it. Without this, one test's spent attempts
  // become the next test's starting point.
  __resetMMKVStores();
});

async function shopWithStaff() {
  const owner = await createShopAndOwner({ shopName: 'Hardening Shop', phone: '01712000001' });
  await setOwnerPin(owner.userId, '1234');
  await createStaff(
    owner.shopId,
    owner.userId,
    { name: 'Arif', phone: '01712000002', rawPin: '5678', permissions: {} },
    ALWAYS_LIVE,
  );
  return owner;
}

describe('offline PIN login hardening', () => {
  it('refuses further attempts once the budget is spent', { timeout: 30_000 }, async () => {
    await shopWithStaff();

    for (let attempt = 0; attempt < PIN_FREE_ATTEMPTS; attempt += 1) {
      await expect(verifyPin('9999')).resolves.toBeNull();
    }

    // The refusal is a distinct outcome, not another null: only waiting fixes
    // it, and the screen has to be able to say so. It still crosses the same
    // observable timing floor, while doing zero bcrypt work.
    resetNativeCryptoTestCounters();
    const lockedStartedAt = Date.now();
    await expect(verifyPin('9999')).rejects.toBeInstanceOf(PinLockedOutError);
    expect(Date.now() - lockedStartedAt).toBeGreaterThanOrEqual(
      FLOOR_MS - FLOOR_TOLERANCE_MS,
    );
    expect(getNativeCryptoTestCounters().verify).toBe(0);
  });

  it('refuses the CORRECT PIN while the cooldown is running', { timeout: 30_000 }, async () => {
    await shopWithStaff();
    for (let attempt = 0; attempt < PIN_FREE_ATTEMPTS + 1; attempt += 1) {
      await verifyPin('9999').catch(() => null);
    }

    // The whole point: guessing cannot be resumed by happening to guess right.
    await expect(verifyPin('5678')).rejects.toBeInstanceOf(PinLockedOutError);
  });

  it('does NOT clear the budget after a PIN that verified', { timeout: 30_000 }, async () => {
    await shopWithStaff();
    for (let attempt = 0; attempt < PIN_FREE_ATTEMPTS - 2; attempt += 1) {
      await expect(verifyPin('9999')).resolves.toBeNull();
    }

    await expect(verifyPin('5678')).resolves.toMatchObject({ role: 'staff' });

    // The counter is shop-wide and the pad has no "who are you" step, so a
    // successful login is not evidence about the person who spent the
    // failures. It refills nothing: the two remaining attempts are still the
    // only two remaining attempts. Time (PIN_FAILURE_DECAY_MS) and owner
    // recovery are the only ways back — see the cross-role block below.
    await expect(verifyPin('9999')).resolves.toBeNull();
    await expect(verifyPin('9999')).resolves.toBeNull();
    await expect(verifyPin('9999')).rejects.toBeInstanceOf(PinLockedOutError);
  });

  it('takes at least the floor for a hit AND for a miss', { timeout: 30_000 }, async () => {
    await shopWithStaff();

    const hitStartedAt = Date.now();
    await expect(verifyPin('5678')).resolves.toMatchObject({ role: 'staff' });
    const hitMs = Date.now() - hitStartedAt;

    const missStartedAt = Date.now();
    await expect(verifyPin('9999')).resolves.toBeNull();
    const missMs = Date.now() - missStartedAt;

    // Not "they are equal" - scheduling noise makes that flaky. The invariant
    // that matters is that neither can come back inside the floor, which is
    // what removes the difference an attacker was reading.
    expect(hitMs).toBeGreaterThanOrEqual(FLOOR_MS - FLOOR_TOLERANCE_MS);
    expect(missMs).toBeGreaterThanOrEqual(FLOOR_MS - FLOOR_TOLERANCE_MS);
  });
});

describe('cross-role lockout reset (the H-4 review bypass)', () => {
  it('a valid Staff PIN does not refill the budget spent guessing the Owner PIN', {
    timeout: 60_000,
  }, async () => {
    await shopWithStaff();

    // Four guesses at the owner's PIN. One short of the lock.
    for (let attempt = 0; attempt < PIN_FREE_ATTEMPTS - 1; attempt += 1) {
      await expect(verifyPin('9999')).resolves.toBeNull();
    }

    // The staff member signs in with their OWN, entirely valid, PIN.
    await expect(verifyPin('5678')).resolves.toMatchObject({ role: 'staff' });

    // Before the fix this reset the shop-wide counter, so the loop above could
    // be repeated forever — four guesses, one login, four guesses — walking
    // the whole 10,000-value space at no cost.
    //
    // The budget must still be spent: exactly ONE guess remains, not five.
    await expect(verifyPin('9999')).resolves.toBeNull();
    await expect(verifyPin('9999')).rejects.toBeInstanceOf(PinLockedOutError);
  });

  it('keeps the owner locked out even after several staff logins', {
    timeout: 60_000,
  }, async () => {
    await shopWithStaff();
    for (let attempt = 0; attempt < PIN_FREE_ATTEMPTS; attempt += 1) {
      await verifyPin('9999').catch(() => null);
    }

    // A correct PIN cannot be used to reopen the pad, whoever it belongs to.
    await expect(verifyPin('5678')).rejects.toBeInstanceOf(PinLockedOutError);
    await expect(verifyPin('1234')).rejects.toBeInstanceOf(PinLockedOutError);
  });

  it('lets the budget decay on its own so a shop is never bricked', {
    timeout: 60_000,
  }, async () => {
    await shopWithStaff();
    for (let attempt = 0; attempt < PIN_FREE_ATTEMPTS; attempt += 1) {
      await verifyPin('9999').catch(() => null);
    }

    // The counter is device state and reads Date.now(), so a quiet half hour
    // is simulated by asking it about a later instant. First read retires the
    // cooldown; the second applies the decay that follows it.
    const scope = pinAttemptScope(null);
    const later = Date.now() + PIN_FAILURE_DECAY_MS + 60_000;
    expect(pinAttemptStatus(scope, later).isLocked).toBe(false);
    // A full budget, not one attempt away from locking again: waiting is the
    // automatic way back, and it has to actually work or a forgotten PIN
    // takes the shop off the air for the day.
    expect(pinAttemptStatus(scope, later).failures).toBe(0);
  });
});
