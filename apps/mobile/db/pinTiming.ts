// db/pinTiming.ts — response-time shaping for LOCAL PIN verification (H-4).
//
// The oracle this closes: verifyPin performed ZERO bcrypt comparisons when the
// Keystore-HMAC lookup tag matched nobody, and exactly one when it did. A wrong
// PIN therefore came back in single-digit milliseconds while the right one cost
// a full bcrypt — 319 ms measured on the low-end target device during H-3's
// sign-off. Anyone holding the phone could read the correct PIN straight off
// the response time without ever completing a login: 10,000 candidates, one
// stopwatch, no lockout in the way.
//
// db/auth.ts closes the structural half by always performing a FIXED number of
// comparisons. This file closes the residual half. Whatever work actually
// happened — a shorter candidate list, a warm SQLite page cache, a legacy row
// that needed tagging — the caller observes a duration rounded UP to the next
// quantum, so those differences collapse into one observable bucket.
//
// Quantising rather than sleeping to a fixed floor is deliberate. A fixed floor
// is inert the moment a device is slower than whatever number was picked on
// some other handset, and it is pure waste on a faster one. A quantum adapts to
// the device and still bounds what it can add to exactly one quantum.
//
// This is NOT the brute-force guard — db/pinAttemptLock.ts is. Shaping the
// response only removes the signal; bounding the attempts is what makes the
// remaining 10,000-guess space unusable.

/** Observable resolution of a local PIN answer. */
export const PIN_TIMING_QUANTUM_MS = 250;

/**
 * Floor, in quanta. Two puts the minimum observable answer at 500 ms — above
 * the 319 ms a real bcrypt costs on the low-end device, so the honest path
 * lands inside the floor rather than defining a bucket of its own, and far
 * under the §16 two-second gate for an enrolled PIN login.
 */
export const PIN_TIMING_MINIMUM_QUANTA = 2;

/**
 * The duration the caller is allowed to observe for work that really took
 * `elapsedMs`. Pure, so the timing contract is testable without sleeping.
 */
export function quantizedTargetMs(
  elapsedMs: number,
  quantumMs: number = PIN_TIMING_QUANTUM_MS,
  minimumQuanta: number = PIN_TIMING_MINIMUM_QUANTA,
): number {
  const floor = minimumQuanta * quantumMs;
  // A NaN or negative reading means the clock moved under us. Never let that
  // shorten the answer — the whole point is that nothing about the PIN, or the
  // device, can make a reply arrive early.
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return floor;
  }
  return Math.max(minimumQuanta, Math.ceil(elapsedMs / quantumMs)) * quantumMs;
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Runs `operation` and releases its result — or its error — only once the
 * quantised duration has elapsed.
 *
 * The delay is in `finally` on purpose: a throw must not be observably faster
 * than a return, or the exception path becomes the new oracle.
 */
export async function withQuantizedPinTiming<T>(operation: () => Promise<T>): Promise<T> {
  const startedAt = now();
  try {
    return await operation();
  } finally {
    const elapsedMs = now() - startedAt;
    await sleep(quantizedTargetMs(elapsedMs) - elapsedMs);
  }
}
