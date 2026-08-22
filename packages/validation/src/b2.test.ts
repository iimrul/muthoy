import { describe, expect, it } from 'vitest';
import { basisPointsSchema, expirySettingsSchema, inventoryCsvRowSchema, refundReasonSchema } from './b2';

describe('B2 validation', () => {
  it('validates basis points and expiry settings', () => {
    expect(basisPointsSchema.safeParse(10000).success).toBe(true);
    expect(basisPointsSchema.safeParse(10001).success).toBe(false);
    expect(expirySettingsSchema.safeParse({ nearDays: 30, farDays: 60 }).success).toBe(true);
    expect(expirySettingsSchema.safeParse({ nearDays: 60, farDays: 30 }).success).toBe(false);
  });
  it('requires a nonblank refund reason', () => expect(refundReasonSchema.safeParse('  ').success).toBe(false));
  it('validates required CSV columns and defaults production unit', () => {
    const result = inventoryCsvRowSchema.parse({ name: 'A', generic: 'G', manufacturer: 'M', batch_no: 'B', stock: '2', purchase_price: '1.20', sale_price: '2' });
    expect(result.production_unit).toBe('piece');
  });
});
