import { describe, expect, it } from 'vitest';
import { computeBackoffMs } from './backoff';

describe('computeBackoffMs', () => {
  it('starts at five seconds and doubles per attempt', () => {
    expect(computeBackoffMs(1)).toBe(5_000);
    expect(computeBackoffMs(2)).toBe(10_000);
    expect(computeBackoffMs(6)).toBe(160_000);
  });

  it('caps retry delay at five minutes', () => {
    expect(computeBackoffMs(7)).toBe(300_000);
    expect(computeBackoffMs(20)).toBe(300_000);
  });

  it('normalizes invalid low attempt counts', () => {
    expect(computeBackoffMs(0)).toBe(5_000);
    expect(computeBackoffMs(-2)).toBe(5_000);
  });
});
