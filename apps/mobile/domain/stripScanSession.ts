// domain/stripScanSession.ts — turns a stream of per-frame matches into cart
// actions for the live strip scanner.
//
// The camera reads the same strip several times a second, so a match is not an
// action. This state machine decides when it becomes one:
//
//   - STABILITY. A weak match must repeat in consecutive frames before it adds;
//     a strong one (strength printed and matched, or the name printed twice)
//     adds on the first frame. Choices and "not found" always need two frames.
//   - ONE ADD PER APPEARANCE. Once a medicine is added it is locked until the
//     strip has left the camera — missed for SCAN_RELEASE_MISSED_FRAMES frames
//     AND for SCAN_RELEASE_MS. One misread frame while the strip is still there
//     therefore cannot re-add it; bringing the strip back after removing it
//     adds it again. Other medicines are never blocked by a lock.
//   - QUIET MISSES. "Not found" is rate-limited, and suppressed while a strip
//     that was just added is still in view (its partial reads are not a miss).
//
// Pure and immutable: every step returns a new state (mirrors domain/fefo.ts).

import type { ScanVocabularyEntry, StripMatchResult } from "./stripMatcher";

export const SCAN_STABLE_FRAMES = 2;
export const SCAN_RELEASE_MISSED_FRAMES = 2;
export const SCAN_RELEASE_MS = 900;
export const SCAN_NOT_FOUND_COOLDOWN_MS = 3_000;
export const SCAN_NOT_FOUND_GRACE_MS = 1_500;

interface MedicineLock {
  lastSeenAt: number;
  missedFrames: number;
}

export interface ScanSessionState {
  readonly lastKey: string | null;
  readonly streak: number;
  readonly locks: Readonly<Record<string, MedicineLock>>;
  readonly notFoundMutedUntil: number;
}

export type ScanSessionAction =
  | { kind: "idle" }
  | { kind: "add"; medicine: ScanVocabularyEntry }
  | { kind: "choose"; options: readonly ScanVocabularyEntry[] }
  | { kind: "notFound" };

export interface ScanSessionStep {
  state: ScanSessionState;
  action: ScanSessionAction;
}

export function createScanSession(): ScanSessionState {
  return { lastKey: null, streak: 0, locks: {}, notFoundMutedUntil: 0 };
}

function resultKey(result: StripMatchResult): string {
  switch (result.kind) {
    case "match":
      return `m:${result.medicine.medicineId}`;
    case "choose":
      return `c:${result.options.map((option) => option.medicineId).sort().join(",")}`;
    case "notFound":
      return "notFound";
    default:
      return "none";
  }
}

function seenIds(result: StripMatchResult): ReadonlySet<string> {
  if (result.kind === "match") return new Set([result.medicine.medicineId]);
  if (result.kind === "choose") return new Set(result.options.map((o) => o.medicineId));
  return new Set();
}

function advanceLocks(
  locks: Readonly<Record<string, MedicineLock>>,
  seen: ReadonlySet<string>,
  now: number,
): Record<string, MedicineLock> {
  const next: Record<string, MedicineLock> = {};
  for (const [id, lock] of Object.entries(locks)) {
    if (seen.has(id)) {
      next[id] = { lastSeenAt: now, missedFrames: 0 };
      continue;
    }
    const missedFrames = lock.missedFrames + 1;
    const isGone =
      missedFrames >= SCAN_RELEASE_MISSED_FRAMES && now - lock.lastSeenAt >= SCAN_RELEASE_MS;
    if (!isGone) next[id] = { lastSeenAt: lock.lastSeenAt, missedFrames };
  }
  return next;
}

/** Locks medicines the seller acted on by hand (a choice tapped or dismissed). */
export function lockScannedMedicines(
  state: ScanSessionState,
  medicineIds: readonly string[],
  now: number,
): ScanSessionState {
  const locks = { ...state.locks };
  for (const id of medicineIds) locks[id] = { lastSeenAt: now, missedFrames: 0 };
  return { ...state, locks };
}

const IDLE: ScanSessionAction = { kind: "idle" };

export function stepScanSession(
  state: ScanSessionState,
  result: StripMatchResult,
  now: number,
): ScanSessionStep {
  const key = resultKey(result);
  const locks = advanceLocks(state.locks, seenIds(result), now);
  const streak = key === state.lastKey ? state.streak + 1 : 1;
  const next: ScanSessionState = { ...state, lastKey: key, streak, locks };

  if (result.kind === "match") {
    const id = result.medicine.medicineId;
    if (locks[id] || (!result.isStrong && streak < SCAN_STABLE_FRAMES)) {
      return { state: next, action: IDLE };
    }
    return {
      state: lockScannedMedicines(next, [id], now),
      action: { kind: "add", medicine: result.medicine },
    };
  }

  if (result.kind === "choose") {
    const isHandled = result.options.some((option) => locks[option.medicineId]);
    if (isHandled || streak < SCAN_STABLE_FRAMES) return { state: next, action: IDLE };
    return { state: next, action: { kind: "choose", options: result.options } };
  }

  if (result.kind === "notFound") {
    const isJustAddedStillInView = Object.values(locks).some(
      (lock) => now - lock.lastSeenAt < SCAN_NOT_FOUND_GRACE_MS,
    );
    if (streak < SCAN_STABLE_FRAMES || now < state.notFoundMutedUntil || isJustAddedStillInView) {
      return { state: next, action: IDLE };
    }
    return {
      state: { ...next, notFoundMutedUntil: now + SCAN_NOT_FOUND_COOLDOWN_MS },
      action: { kind: "notFound" },
    };
  }

  return { state: next, action: IDLE };
}
