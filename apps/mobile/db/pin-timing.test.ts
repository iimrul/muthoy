import { describe, expect, it } from 'vitest';
import {
  PIN_TIMING_MINIMUM_QUANTA,
  PIN_TIMING_QUANTUM_MS,
  quantizedTargetMs,
  withQuantizedPinTiming,
} from './pinTiming';

const FLOOR_MS = PIN_TIMING_QUANTUM_MS * PIN_TIMING_MINIMUM_QUANTA;

// H-4. The quantiser is tested as a pure function rather than by sampling wall
// clock times two hundred times: a distribution test of a 250 ms quantum is
// slow, machine-dependent and flaky in CI, and it proves less. What matters is
// that no real duration can map to an observable one below the floor, and that
// two different real durations inside the same quantum are indistinguishable.
describe('quantizedTargetMs', () => {
  it('never reports anything below the floor', () => {
    for (const elapsed of [0, 1, 40, 120, FLOOR_MS - 1]) {
      expect(quantizedTargetMs(elapsed)).toBe(FLOOR_MS);
    }
  });

  it('collapses every duration inside one quantum onto the same answer', () => {
    // The gap this closes: a Keystore miss (a few ms) and a full bcrypt
    // (~320 ms on the low-end device) must not be tellable apart.
    expect(quantizedTargetMs(3)).toBe(quantizedTargetMs(320));
    expect(quantizedTargetMs(FLOOR_MS + 1)).toBe(quantizedTargetMs(FLOOR_MS + PIN_TIMING_QUANTUM_MS));
  });

  it('rounds up, so a slow device is never cut short', () => {
    expect(quantizedTargetMs(FLOOR_MS + 1)).toBe(FLOOR_MS + PIN_TIMING_QUANTUM_MS);
    expect(quantizedTargetMs(FLOOR_MS + PIN_TIMING_QUANTUM_MS)).toBe(FLOOR_MS + PIN_TIMING_QUANTUM_MS);
  });

  it('treats an unusable clock reading as the floor rather than as zero', () => {
    // A backwards clock must not become a way to make answers arrive early.
    expect(quantizedTargetMs(Number.NaN)).toBe(FLOOR_MS);
    expect(quantizedTargetMs(-5_000)).toBe(FLOOR_MS);
    expect(quantizedTargetMs(Number.POSITIVE_INFINITY)).toBe(FLOOR_MS);
  });
});

describe('withQuantizedPinTiming', () => {
  it('holds a fast answer back to the floor', async () => {
    const startedAt = Date.now();
    await expect(withQuantizedPinTiming(async () => 'done')).resolves.toBe('done');
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(FLOOR_MS - 20);
  });

  it('holds a THROWN answer back too', async () => {
    // Without this, the exception path becomes the new oracle: refuse fast,
    // succeed slowly, and the timing tells the attacker which happened.
    const startedAt = Date.now();
    await expect(
      withQuantizedPinTiming(async () => {
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(FLOOR_MS - 20);
  });
});
