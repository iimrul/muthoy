import { describe, expect, it } from 'vitest';
import { addDays, dhakaUtcBounds, monthKey, monthRange, percentChangeBp, previousRange } from './reporting';

describe('report ranges', () => {
  it('builds an equal previous window across month boundaries', () => {
    expect(previousRange({ startDate: '2026-03-01', endDate: '2026-03-07' })).toEqual({
      startDate: '2026-02-22', endDate: '2026-02-28',
    });
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles month and Dhaka UTC boundaries deterministically', () => {
    expect(monthRange('2024-02')).toEqual({ startDate: '2024-02-01', endDate: '2024-02-29' });
    expect(monthKey('2026-01', -1)).toBe('2025-12');
    expect(dhakaUtcBounds({ startDate: '2026-01-01', endDate: '2026-01-01' })).toEqual({
      startUtc: '2025-12-31T18:00:00.000Z', endExclusiveUtc: '2026-01-01T18:00:00.000Z',
    });
  });

  it('computes integer basis-point change and handles a zero baseline', () => {
    expect(percentChangeBp(12_500, 10_000)).toBe(2_500);
    expect(percentChangeBp(7_500, 10_000)).toBe(-2_500);
    expect(percentChangeBp(1, 0)).toBeNull();
  });
});
