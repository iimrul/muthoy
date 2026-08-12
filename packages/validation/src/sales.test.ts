import { describe, expect, it } from 'vitest';
import { checkoutCustomerSchema, tenderedAmountSchema } from './sales';

describe('sales checkout validation', () => {
  it('accepts a tendered amount with at most two decimal places', () => {
    expect(tenderedAmountSchema.parse('125.50')).toBe(125.5);
    expect(tenderedAmountSchema.safeParse('12.345').success).toBe(false);
  });

  it('requires a customer name and accepts an optional phone', () => {
    expect(checkoutCustomerSchema.parse({ name: 'Ruhin', phone: '' })).toEqual({ name: 'Ruhin', phone: undefined });
    expect(checkoutCustomerSchema.safeParse({ name: '', phone: '' }).success).toBe(false);
    expect(checkoutCustomerSchema.safeParse({ name: 'Ruhin', phone: '01712345678' }).success).toBe(true);
  });
});
