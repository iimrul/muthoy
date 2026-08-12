import { describe, expect, it } from 'vitest';
import { purchaseLineItemFieldsSchema, supplierFieldsSchema } from './purchases';

describe('supplierFieldsSchema', () => {
  it('accepts supplier contact fields and normalizes blanks', () => {
    expect(supplierFieldsSchema.parse({
      name: 'Square Pharmaceuticals',
      phone: '',
      address: '',
      email: '',
      contactPerson: '',
    })).toEqual({
      name: 'Square Pharmaceuticals',
      phone: undefined,
      address: undefined,
      email: undefined,
      contactPerson: undefined,
    });
  });

  it('rejects an invalid email', () => {
    expect(supplierFieldsSchema.safeParse({ name: 'Square', email: 'invalid' }).success).toBe(false);
  });
});

describe('purchaseLineItemFieldsSchema', () => {
  const validLine = {
    batchNo: 'B-100',
    expiryDate: '2099-01-01',
    quantity: 10,
    purchasePrice: 5.5,
    salePrice: 8,
  };

  it('accepts a valid stock-in line', () => {
    expect(purchaseLineItemFieldsSchema.safeParse(validLine).success).toBe(true);
  });

  it('requires expiry for purchase stock-in', () => {
    expect(purchaseLineItemFieldsSchema.safeParse({ ...validLine, expiryDate: '' }).success).toBe(false);
  });

  it('rejects impossible calendar dates', () => {
    expect(purchaseLineItemFieldsSchema.safeParse({ ...validLine, expiryDate: '2099-02-30' }).success).toBe(false);
  });

  it('requires a positive whole quantity', () => {
    expect(purchaseLineItemFieldsSchema.safeParse({ ...validLine, quantity: 0 }).success).toBe(false);
    expect(purchaseLineItemFieldsSchema.safeParse({ ...validLine, quantity: 1.5 }).success).toBe(false);
  });
});
