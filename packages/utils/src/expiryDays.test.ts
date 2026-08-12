import { describe, expect, it } from 'vitest';
import { daysUntilExpiry } from './expiryDays';

describe('daysUntilExpiry', () => {
  it('returns null when the batch has no expiry date', () => {
    expect(daysUntilExpiry(null, new Date('2027-01-01'))).toBeNull();
  });

  it('returns 0 for today', () => {
    expect(daysUntilExpiry('2027-01-01', new Date('2027-01-01T09:00:00'))).toBe(0);
  });

  it('returns a positive count for a future date', () => {
    expect(daysUntilExpiry('2027-01-31', new Date('2027-01-01'))).toBe(30);
  });

  it('returns a negative count for a past (already expired) date', () => {
    expect(daysUntilExpiry('2026-12-01', new Date('2027-01-01'))).toBe(-31);
  });
});
