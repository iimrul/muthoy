import { describe, expect, it } from 'vitest';
import { canArchiveMedicine, effectiveLowStockThreshold, expiryBand } from './inventoryRules';

describe('B2 inventory rules', () => {
  it('uses medicine override or shop fallback 10', () => {
    expect(effectiveLowStockThreshold(null)).toBe(10);
    expect(effectiveLowStockThreshold(3)).toBe(3);
  });
  it.each([[-1, 'expired'], [0, 'near'], [30, 'near'], [31, 'far'], [60, 'far'], [61, 'later'], [null, 'unknown']] as const)('bands %s as %s', (days, expected) => expect(expiryBand(days)).toBe(expected));
  it('archives only zero, non-oversold, non-promoted medicines', () => {
    expect(canArchiveMedicine({ totalStock: 0, oversoldAt: null, hasActivePromotion: false })).toBe(true);
    expect(canArchiveMedicine({ totalStock: 1, oversoldAt: null, hasActivePromotion: false })).toBe(false);
    expect(canArchiveMedicine({ totalStock: 0, oversoldAt: 'now', hasActivePromotion: false })).toBe(false);
    expect(canArchiveMedicine({ totalStock: 0, oversoldAt: null, hasActivePromotion: true })).toBe(false);
  });
});
