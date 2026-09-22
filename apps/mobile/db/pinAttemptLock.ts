import { createMMKV } from 'react-native-mmkv';

// db/pinAttemptLock.ts — the offline brute-force guard for PIN Login (H-4).
//
// sync/deviceLogin's server path has had a lockout since B4: five attempts per
// phone, twenty per IP, checked BEFORE any bcrypt work. The offline path had
// none. That is the path that matters on a stolen phone: PIN Login needs no
// network, the space is 10,000 values, and nothing counted a failure. Timing
// shaping (db/pinTiming.ts) removes the shortcut; this removes the budget.
//
// Deliberately NOT in SQLite. The database is the thing being protected, it is
// encrypted and may fail to open at all, and a counter living inside it would
// be absent exactly when the guard is most needed. MMKV survives app restart
// and force-stop, which is the threat model — someone with the handset, not
// someone with a factory reset (a wipe takes the shop's data with it).
const storage = createMMKV({ id: 'muthoy-pin-attempts' });

/**
 * Bumped whenever the stored shape changes. An unrecognised version is treated
 * as corrupt and FAILS CLOSED rather than being migrated on a guess: a counter
 * nobody can read is exactly what an attacker would try to produce.
 */
export const PIN_ATTEMPT_STATE_VERSION = 1;

/**
 * Attempts spent before the pad closes: the fifth consecutive wrong PIN starts
 * the first cooldown. Matches the server PHONE_ATTEMPT_BUDGET so a pharmacist
 * mistyping hits the same wall whether they are online or off.
 */
export const PIN_FREE_ATTEMPTS = 5;

/**
 * Escalating cooldown, one rung per failure past the budget, capped at the
 * last. Thirty minutes is the ceiling on purpose: PIN Login is the ONLY offline
 * way into the app, so a permanent lock would take a shop off the air for the
 * day over a forgotten PIN. Thirty minutes still reduces an attacker to roughly
 * forty guesses a day against 10,000 values, which is not a viable attack.
 */
export const PIN_COOLDOWN_LADDER_MS: readonly number[] = [
  30_000,
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
];

/**
 * How long the pad must go WITHOUT a failure before the budget refills.
 *
 * This is the only automatic way back, and replacing the old rule (a successful
 * login clears the counter) with it is the whole point of the H-4 review fix.
 * Clearing on success made the guard bypassable by anyone holding ONE valid
 * credential: the counter is shop-wide, so a staff member could spend four
 * guesses at the owner PIN, sign in with their own, and repeat forever —
 * 10,000 values at no cost. A budget only time can refill cannot be spent that
 * way.
 *
 * Matched to the ceiling cooldown so the worst case is symmetric: half an hour
 * of not touching the pad restores a full budget, and half an hour is also the
 * longest single lock.
 */
export const PIN_FAILURE_DECAY_MS = 30 * 60_000;

/** A counter beyond this is not a real user, and not a real attacker either. */
const MAX_TRACKED_FAILURES = 10_000;
const STORED_STATE_KEYS = [
  'failures',
  'lastFailureAt',
  'lockedAt',
  'lockedUntil',
  'v',
] as const;

export interface PinLockStatus {
  isLocked: boolean;
  /** Milliseconds until another attempt is accepted; 0 when not locked. */
  retryAfterMs: number;
  failures: number;
}

interface StoredState {
  v: number;
  failures: number;
  /** Absolute epoch ms of the most recent failure; null when there is none. */
  lastFailureAt: number | null;
  /** Absolute epoch ms the current cooldown began; null when not locked. */
  lockedAt: number | null;
  /** Absolute epoch ms the current cooldown ends; null when not locked. */
  lockedUntil: number | null;
}

const UNLOCKED: PinLockStatus = { isLocked: false, retryAfterMs: 0, failures: 0 };
/**
 * One counter per shop, so a two-shop owner mistyping in one does not lock the
 * other — and a device that has never held a shop still gets a counter.
 *
 * Within a shop it is deliberately NOT per user. PIN Login has no who-are-you
 * step (db/auth.ts verifyPin resolves identity FROM the PIN), so there is no
 * identity to attribute a failed attempt to. A per-user counter here would be
 * a counter keyed on the attacker own guess.
 */
export function pinAttemptScope(shopId: string | null): string {
  return shopId ?? 'device';
}

function storageKey(scope: string): string {
  return 'attempts:' + scope;
}

function cooldownMsFor(failures: number): number {
  if (failures < PIN_FREE_ATTEMPTS) return 0;
  const rung = Math.min(failures - PIN_FREE_ATTEMPTS, PIN_COOLDOWN_LADDER_MS.length - 1);
  const last = PIN_COOLDOWN_LADDER_MS[PIN_COOLDOWN_LADDER_MS.length - 1] ?? 0;
  return PIN_COOLDOWN_LADDER_MS[rung] ?? last;
}

/** A timestamp this device could plausibly have written. */
function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || isTimestamp(value);
}

/**
 * Strict validation. Every field is checked for type, finiteness, sign and
 * integrality, and then the fields are checked AGAINST EACH OTHER — a record
 * that is individually well-typed but internally impossible (locked with no
 * end, an end before its start, a lock with no failures to justify it,
 * failures with no timestamp to decay from) is corrupt, and corrupt fails
 * closed.
 */
function isStoredState(value: unknown): value is StoredState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;

  const keys = Object.keys(candidate).sort();
  if (
    keys.length !== STORED_STATE_KEYS.length
    || keys.some((key, index) => key !== STORED_STATE_KEYS[index])
  ) {
    return false;
  }

  if (candidate.v !== PIN_ATTEMPT_STATE_VERSION) return false;

  const { failures, lastFailureAt, lockedAt, lockedUntil } = candidate;
  if (
    typeof failures !== 'number'
    || !Number.isSafeInteger(failures)
    || failures < 0
    || failures > MAX_TRACKED_FAILURES
  ) {
    return false;
  }
  if (!isNullableTimestamp(lastFailureAt)) return false;
  if (!isNullableTimestamp(lockedAt)) return false;
  if (!isNullableTimestamp(lockedUntil)) return false;

  // A lock has both ends, or neither.
  if ((lockedAt === null) !== (lockedUntil === null)) return false;
  if (lockedAt !== null && lockedUntil !== null) {
    // Nothing locks a pad that has not spent its budget.
    if (failures < PIN_FREE_ATTEMPTS) return false;
    // Every writer creates a lock at the instant of the failure. Accepting a
    // different anchor lets a syntactically valid but impossible record evade
    // rollback detection and expire early.
    if (lastFailureAt !== lockedAt) return false;
    const expectedLockedUntil = lockedAt + cooldownMsFor(failures);
    if (!Number.isSafeInteger(expectedLockedUntil)) return false;
    // The exact rung is canonical. Merely bounding the duration by the ceiling
    // accepted a one-millisecond lock for a state that should hold for minutes.
    if (lockedUntil !== expectedLockedUntil) return false;
  }
  // Failures with no timestamp could never decay, which would make them
  // permanent; a timestamp with no failures has nothing to decay.
  if (failures > 0 && lastFailureAt === null) return false;
  if (failures === 0 && lastFailureAt !== null) return false;

  return true;
}
function write(scope: string, state: StoredState): void {
  storage.set(storageKey(scope), JSON.stringify(state));
}

/**
 * Reads the counter.
 *
 * ABSENT is a fresh device and reads as zero failures — treating it as locked
 * would mean nobody could ever sign in for the first time, on any handset.
 * CORRUPT is the fail-closed case: the record exists but cannot be trusted, so
 * the attempt is refused and the counter is rebuilt at the first cooldown rung
 * rather than silently reset to zero, which is precisely what someone who
 * found a way to scribble on the store would be aiming for.
 */
function read(scope: string): StoredState | 'corrupt' | null {
  const serialized = storage.getString(storageKey(scope));
  if (serialized === undefined || serialized === null) return null;
  if (serialized.trim() === '') return 'corrupt';
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isStoredState(parsed) ? parsed : 'corrupt';
  } catch {
    return 'corrupt';
  }
}

function corruptState(nowMs: number): StoredState {
  const failures = PIN_FREE_ATTEMPTS;
  return {
    v: PIN_ATTEMPT_STATE_VERSION,
    failures,
    lastFailureAt: nowMs,
    lockedAt: nowMs,
    lockedUntil: nowMs + cooldownMsFor(failures),
  };
}

function toStatus(state: StoredState, nowMs: number): PinLockStatus {
  if (state.lockedUntil === null) {
    return { isLocked: false, retryAfterMs: 0, failures: state.failures };
  }
  return {
    isLocked: true,
    retryAfterMs: Math.max(0, state.lockedUntil - nowMs),
    failures: state.failures,
  };
}
/**
 * Whether an attempt may be made right now, applying every time-based rule.
 *
 * Clock rollback is the interesting case. Timestamps are absolute epoch ms, so
 * winding the device clock back would otherwise leave a cooldown that has not
 * started yet and, on the next wind, one that has already passed. Whenever the
 * clock reads EARLIER than the last thing this counter is sure about, the
 * state is re-anchored to now and the caller stays locked — the same
 * fail-closed direction domain/entitlements.ts takes for offline verification.
 */
export function pinAttemptStatus(scope: string, nowMs: number = Date.now()): PinLockStatus {
  const state = read(scope);
  if (state === null) return UNLOCKED;
  if (state === 'corrupt') {
    const rebuilt = corruptState(nowMs);
    write(scope, rebuilt);
    return toStatus(rebuilt, nowMs);
  }

  const anchor = Math.max(state.lastFailureAt ?? 0, state.lockedAt ?? 0);
  if (anchor > 0 && nowMs < anchor) {
    const first = PIN_COOLDOWN_LADDER_MS[0] ?? 0;
    const reanchored: StoredState = {
      v: PIN_ATTEMPT_STATE_VERSION,
      failures: Math.max(state.failures, PIN_FREE_ATTEMPTS),
      lastFailureAt: nowMs,
      lockedAt: nowMs,
      lockedUntil: nowMs + Math.max(cooldownMsFor(state.failures), first),
    };
    write(scope, reanchored);
    return toStatus(reanchored, nowMs);
  }

  if (state.lockedUntil !== null && nowMs >= state.lockedUntil) {
    // The cooldown ran out. The FAILURE COUNT deliberately survives it, so the
    // next wrong PIN escalates to the following rung instead of buying another
    // five free attempts every time the clock ticks past.
    const expired: StoredState = {
      v: PIN_ATTEMPT_STATE_VERSION,
      failures: state.failures,
      lastFailureAt: state.lastFailureAt,
      lockedAt: null,
      lockedUntil: null,
    };
    write(scope, expired);
    return toStatus(expired, nowMs);
  }

  if (
    state.lockedUntil === null
    && state.failures > 0
    && state.lastFailureAt !== null
    && nowMs - state.lastFailureAt >= PIN_FAILURE_DECAY_MS
  ) {
    // The only automatic refill. See PIN_FAILURE_DECAY_MS.
    const decayed: StoredState = {
      v: PIN_ATTEMPT_STATE_VERSION,
      failures: 0,
      lastFailureAt: null,
      lockedAt: null,
      lockedUntil: null,
    };
    write(scope, decayed);
    return toStatus(decayed, nowMs);
  }

  return toStatus(state, nowMs);
}
/** Counts one rejected PIN and returns the resulting state. */
export function recordPinAttemptFailure(scope: string, nowMs: number = Date.now()): PinLockStatus {
  // Through pinAttemptStatus so decay, rollback and expiry are applied BEFORE
  // this failure is added, rather than on top of a stale record.
  const settled = pinAttemptStatus(scope, nowMs);
  const failures = Math.min(settled.failures + 1, MAX_TRACKED_FAILURES);
  const cooldownMs = cooldownMsFor(failures);
  const next: StoredState = {
    v: PIN_ATTEMPT_STATE_VERSION,
    failures,
    lastFailureAt: nowMs,
    lockedAt: cooldownMs > 0 ? nowMs : null,
    lockedUntil: cooldownMs > 0 ? nowMs + cooldownMs : null,
  };
  write(scope, next);
  return toStatus(next, nowMs);
}

/**
 * The ONLY way to clear the budget other than waiting.
 *
 * Reserved for owner PIN recovery, which has already proved possession of the
 * owner phone number through an OTP the SERVER verified — a far stronger claim
 * than some PIN on this device was correct. Called from sync/deviceAuth.ts
 * recoverOwnerPin once the server has accepted it.
 *
 * Named for the authority it requires rather than for what it does, because
 * the previous name invited exactly the call that created the bypass: clearing
 * on any successful login. A successful login now clears NOTHING.
 */
export function clearPinAttemptsAfterOwnerRecovery(scope: string): void {
  storage.remove(storageKey(scope));
}
