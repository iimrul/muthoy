import { beforeEach, describe, expect, it } from 'vitest';
import { __resetMMKVStores, createMMKV } from './test/react-native-mmkv';
import {
  PIN_ATTEMPT_STATE_VERSION,
  PIN_COOLDOWN_LADDER_MS,
  PIN_FAILURE_DECAY_MS,
  PIN_FREE_ATTEMPTS,
  clearPinAttemptsAfterOwnerRecovery,
  pinAttemptScope,
  pinAttemptStatus,
  recordPinAttemptFailure,
} from './pinAttemptLock';

const SHOP = 'shop-a';
const scope = pinAttemptScope(SHOP);
const store = createMMKV({ id: 'muthoy-pin-attempts' });
const KEY = `attempts:${scope}`;
const NOW = 1_700_000_000_000;
const FIRST_RUNG = PIN_COOLDOWN_LADDER_MS[0] ?? 0;
const CEILING = PIN_COOLDOWN_LADDER_MS[PIN_COOLDOWN_LADDER_MS.length - 1] ?? 0;

function fail(count: number, nowMs = NOW, targetScope = scope) {
  let status = pinAttemptStatus(targetScope, nowMs);
  for (let i = 0; i < count; i += 1) {
    status = recordPinAttemptFailure(targetScope, nowMs);
  }
  return status;
}

/** What is actually on disk, so persistence is asserted rather than assumed. */
function stored(): Record<string, unknown> {
  return JSON.parse(store.getString(KEY) ?? '{}') as Record<string, unknown>;
}

beforeEach(() => {
  __resetMMKVStores();
});

describe('offline PIN attempt budget', () => {
  it('allows the budgeted attempts, then locks on the last one', () => {
    expect(fail(PIN_FREE_ATTEMPTS - 1).isLocked).toBe(false);
    const locked = recordPinAttemptFailure(scope, NOW);
    expect(locked.isLocked).toBe(true);
    expect(locked.retryAfterMs).toBe(FIRST_RUNG);
  });

  it('escalates one rung per failure and stops at the ceiling', () => {
    fail(PIN_FREE_ATTEMPTS - 1);
    const observed = PIN_COOLDOWN_LADDER_MS.map(
      () => recordPinAttemptFailure(scope, NOW).retryAfterMs,
    );
    expect(observed).toEqual([...PIN_COOLDOWN_LADDER_MS]);
    // Past the last rung it stays at the ceiling rather than growing forever.
    // PIN Login is the ONLY offline way in; a cooldown that kept doubling
    // would take a shop off the air for a day over a forgotten PIN.
    expect(recordPinAttemptFailure(scope, NOW).retryAfterMs).toBe(CEILING);
  });

  it('reopens when the cooldown expires but keeps the failure count', () => {
    fail(PIN_FREE_ATTEMPTS);
    expect(pinAttemptStatus(scope, NOW + FIRST_RUNG).isLocked).toBe(false);
    // The next wrong PIN escalates instead of buying another five free
    // attempts every time the clock ticks past a cooldown.
    expect(recordPinAttemptFailure(scope, NOW + FIRST_RUNG).retryAfterMs)
      .toBe(PIN_COOLDOWN_LADDER_MS[1]);
  });
});

describe('the budget refills only by time or by owner recovery', () => {
  it('decays to a full budget after a quiet PIN_FAILURE_DECAY_MS', () => {
    fail(PIN_FREE_ATTEMPTS - 1);
    const after = pinAttemptStatus(scope, NOW + PIN_FAILURE_DECAY_MS);
    expect(after.failures).toBe(0);
    expect(fail(PIN_FREE_ATTEMPTS - 1, NOW + PIN_FAILURE_DECAY_MS).isLocked).toBe(false);
  });

  it('does not decay one millisecond early', () => {
    fail(PIN_FREE_ATTEMPTS - 1);
    expect(pinAttemptStatus(scope, NOW + PIN_FAILURE_DECAY_MS - 1).failures)
      .toBe(PIN_FREE_ATTEMPTS - 1);
  });

  it('is cleared by owner recovery, which proved a phone number', () => {
    fail(PIN_FREE_ATTEMPTS);
    clearPinAttemptsAfterOwnerRecovery(scope);
    expect(pinAttemptStatus(scope, NOW)).toEqual({
      isLocked: false, retryAfterMs: 0, failures: 0,
    });
  });
});

describe('persistence across a restart', () => {
  it('writes the whole state to the store, not to memory', () => {
    fail(PIN_FREE_ATTEMPTS);
    // A restart drops every module-level variable. Whatever survives has to
    // be on disk, so assert the disk contents directly.
    expect(stored()).toMatchObject({
      v: PIN_ATTEMPT_STATE_VERSION,
      failures: PIN_FREE_ATTEMPTS,
      lastFailureAt: NOW,
      lockedAt: NOW,
      lockedUntil: NOW + FIRST_RUNG,
    });
  });

  it('still refuses an attempt when the state is read back cold', () => {
    fail(PIN_FREE_ATTEMPTS);
    const persisted = store.getString(KEY);
    __resetMMKVStores();
    // Simulates a force-stop: nothing in memory, only what was written.
    store.set(KEY, persisted ?? '');
    expect(pinAttemptStatus(scope, NOW + 1_000).isLocked).toBe(true);
  });
});

describe('scoping', () => {
  it('counts each shop separately', () => {
    fail(PIN_FREE_ATTEMPTS);
    // A two-shop owner mistyping in one must not be locked out of the other:
    // verifyPin resolves within one shop, so the budget does too.
    expect(pinAttemptStatus(pinAttemptScope('shop-b'), NOW).isLocked).toBe(false);
  });

  it('carries a spent budget back across a shop switch and return', () => {
    fail(PIN_FREE_ATTEMPTS);
    expect(pinAttemptStatus(pinAttemptScope('shop-b'), NOW).isLocked).toBe(false);
    // Switching away and back is not a way to clear the lock.
    expect(pinAttemptStatus(scope, NOW).isLocked).toBe(true);
  });

  it('gives a device with no shop its own counter', () => {
    const deviceScope = pinAttemptScope(null);
    expect(deviceScope).toBe('device');
    expect(fail(PIN_FREE_ATTEMPTS, NOW, deviceScope).isLocked).toBe(true);
    expect(store.getString('attempts:device')).toBeTruthy();
    // Its state remains independent from the normal shop scope.
    expect(pinAttemptStatus(scope, NOW).isLocked).toBe(false);
  });
});

describe('clock rollback', () => {
  it('stays locked when the clock is wound behind the cooldown', () => {
    fail(PIN_FREE_ATTEMPTS);
    const rolledBack = pinAttemptStatus(scope, NOW - 60 * 60_000);
    expect(rolledBack.isLocked).toBe(true);
    expect(rolledBack.retryAfterMs).toBe(FIRST_RUNG);
  });

  it('locks a merely-counting pad that is wound backwards', () => {
    // Failures below the budget carry a lastFailureAt too. Winding back past
    // it is tampering, not a timezone change, and must not buy free decay.
    fail(2);
    expect(pinAttemptStatus(scope, NOW - 10_000).isLocked).toBe(true);
  });

  it('cannot be used to walk the decay window backwards', () => {
    fail(PIN_FREE_ATTEMPTS - 1);
    pinAttemptStatus(scope, NOW - 5 * PIN_FAILURE_DECAY_MS);
    // Re-anchoring moved the clock forward with the device, so the budget is
    // not refilled by the rollback — it is spent.
    expect(pinAttemptStatus(scope, NOW - 5 * PIN_FAILURE_DECAY_MS).isLocked).toBe(true);
  });
});

describe('strict parsing — anything unreadable fails closed', () => {
  const LOCKED_AT = NOW;
  const valid = {
    v: PIN_ATTEMPT_STATE_VERSION,
    failures: PIN_FREE_ATTEMPTS,
    lastFailureAt: LOCKED_AT,
    lockedAt: LOCKED_AT,
    lockedUntil: LOCKED_AT + FIRST_RUNG,
  };

  it('accepts the record it writes itself', () => {
    store.set(KEY, JSON.stringify(valid));
    expect(pinAttemptStatus(scope, NOW).failures).toBe(PIN_FREE_ATTEMPTS);
  });

  it('accepts every exact cooldown rung the writer can produce', () => {
    for (let index = 0; index < PIN_COOLDOWN_LADDER_MS.length; index += 1) {
      const failures = PIN_FREE_ATTEMPTS + index;
      store.set(KEY, JSON.stringify({
        v: PIN_ATTEMPT_STATE_VERSION,
        failures,
        lastFailureAt: LOCKED_AT,
        lockedAt: LOCKED_AT,
        lockedUntil: LOCKED_AT + (PIN_COOLDOWN_LADDER_MS[index] ?? 0),
      }));
      expect(pinAttemptStatus(scope, NOW).failures).toBe(failures);
    }
  });

  it('accepts the unlocked state written when a cooldown expires', () => {
    store.set(KEY, JSON.stringify({
      v: PIN_ATTEMPT_STATE_VERSION,
      failures: PIN_FREE_ATTEMPTS,
      lastFailureAt: LOCKED_AT,
      lockedAt: null,
      lockedUntil: null,
    }));
    expect(pinAttemptStatus(scope, NOW)).toEqual({
      isLocked: false,
      retryAfterMs: 0,
      failures: PIN_FREE_ATTEMPTS,
    });
  });

  const rejected: [string, unknown][] = [
    ['not JSON at all', 'not json at all'],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a JSON null', null],
    ['a JSON array', []],
    ['a bare number', 7],
    ['an unknown schema version', { ...valid, v: PIN_ATTEMPT_STATE_VERSION + 1 }],
    ['a missing version', { ...valid, v: undefined }],
    ['a negative failure count', { ...valid, failures: -1 }],
    ['a fractional failure count', { ...valid, failures: 2.5 }],
    ['a non-finite failure count', { ...valid, failures: Number.POSITIVE_INFINITY }],
    ['a string failure count', { ...valid, failures: '5' }],
    ['an absurd failure count', { ...valid, failures: 10_001 }],
    ['a negative timestamp', { ...valid, lastFailureAt: -1 }],
    ['a fractional timestamp', { ...valid, lockedAt: LOCKED_AT + 0.5 }],
    ['a half-open lock', { ...valid, lockedUntil: null }],
    ['a lock with no start', { ...valid, lockedAt: null }],
    ['a lock that ends before it starts', { ...valid, lockedUntil: LOCKED_AT - 1 }],
    ['a lock longer than the ceiling', { ...valid, lockedUntil: LOCKED_AT + CEILING + 1 }],
    ['a shortened one-millisecond lock', { ...valid, lockedUntil: LOCKED_AT + 1 }],
    ['a lock anchored after its last failure', { ...valid, lockedAt: LOCKED_AT + 1, lockedUntil: LOCKED_AT + 1 + FIRST_RUNG }],
    ['a lock anchored before its last failure', { ...valid, lockedAt: LOCKED_AT - FIRST_RUNG, lockedUntil: LOCKED_AT }],
    ['the wrong rung for its failure count', { ...valid, failures: PIN_FREE_ATTEMPTS + 1 }],
    ['a lock with no failures behind it', { ...valid, failures: 1, lockedUntil: LOCKED_AT + FIRST_RUNG }],
    ['failures with no timestamp to decay from', { v: PIN_ATTEMPT_STATE_VERSION, failures: 3, lastFailureAt: null, lockedAt: null, lockedUntil: null }],
    ['a timestamp with nothing to decay', { v: PIN_ATTEMPT_STATE_VERSION, failures: 0, lastFailureAt: LOCKED_AT, lockedAt: null, lockedUntil: null }],
    ['an unknown extra field', { ...valid, surprise: true }],
    ['an unsafe timestamp integer', { ...valid, lastFailureAt: Number.MAX_SAFE_INTEGER + 1, lockedAt: Number.MAX_SAFE_INTEGER + 1, lockedUntil: Number.MAX_SAFE_INTEGER + 1 + FIRST_RUNG }],
  ];

  it.each(rejected)('fails closed on %s', (_name, payload) => {
    store.set(KEY, typeof payload === 'string' ? payload : JSON.stringify(payload));
    const status = pinAttemptStatus(scope, NOW);
    expect(status.isLocked).toBe(true);
    // Rebuilt at the first rung, never silently reset to zero — a zeroed
    // counter is exactly what tampering would be aiming for.
    expect(status.retryAfterMs).toBe(FIRST_RUNG);
  });

  it('rewrites a corrupt record as a valid one', () => {
    store.set(KEY, '{');
    pinAttemptStatus(scope, NOW);
    expect(stored()).toMatchObject({ v: PIN_ATTEMPT_STATE_VERSION, failures: PIN_FREE_ATTEMPTS });
    // And the rebuilt record must itself survive validation, or every read
    // would re-trip the corrupt path and the lock would never end.
    expect(pinAttemptStatus(scope, NOW + FIRST_RUNG).isLocked).toBe(false);
  });

  it('treats a device that has never been used as fresh, not as corrupt', () => {
    // Absent is a NEW handset. Reading it as locked would mean nobody could
    // ever sign in for the first time.
    expect(pinAttemptStatus(pinAttemptScope('never-used'), NOW)).toEqual({
      isLocked: false, retryAfterMs: 0, failures: 0,
    });
  });
});
