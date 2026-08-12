import { describe, expect, it } from 'vitest';
import { addBatchSchema, addMedicineSchema } from './inventory';

describe('addBatchSchema', () => {
  const validBatch = {
    batchNo: 'B-100',
    expiryDate: '2099-01-01',
    quantity: 10,
    purchasePrice: 5,
    salePrice: 8,
  };

  it('accepts a fully valid batch', () => {
    expect(addBatchSchema.safeParse(validBatch).success).toBe(true);
  });

  it('accepts an omitted expiry date (nullable column)', () => {
    const withoutExpiry = {
      batchNo: validBatch.batchNo,
      quantity: validBatch.quantity,
      purchasePrice: validBatch.purchasePrice,
      salePrice: validBatch.salePrice,
    };
    expect(addBatchSchema.safeParse(withoutExpiry).success).toBe(true);
  });

  it('treats a blank expiry date input the same as an omitted one', () => {
    const result = addBatchSchema.safeParse({ ...validBatch, expiryDate: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiryDate).toBeUndefined();
    }
  });

  it('rejects an empty batch number', () => {
    const result = addBatchSchema.safeParse({ ...validBatch, batchNo: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a negative quantity', () => {
    const result = addBatchSchema.safeParse({ ...validBatch, quantity: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects a past expiry date', () => {
    const result = addBatchSchema.safeParse({ ...validBatch, expiryDate: '2000-01-01' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed expiry date', () => {
    const result = addBatchSchema.safeParse({ ...validBatch, expiryDate: '01/01/2099' });
    expect(result.success).toBe(false);
  });
});

describe('addMedicineSchema', () => {
  const validMedicine = {
    name: 'Napa Extra',
    requiresPrescription: false,
    firstBatch: {
      batchNo: 'B-1',
      quantity: 1,
      purchasePrice: 1,
      salePrice: 2,
    },
  };

  it('accepts the minimum required fields, applying defaults', () => {
    const result = addMedicineSchema.safeParse(validMedicine);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.unitOfMeasure).toBe('piece');
      expect(result.data.threshold).toBe(20);
    }
  });

  it('rejects a too-short name', () => {
    const result = addMedicineSchema.safeParse({ ...validMedicine, name: 'A' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing firstBatch', () => {
    const withoutBatch = { name: validMedicine.name, requiresPrescription: validMedicine.requiresPrescription };
    const result = addMedicineSchema.safeParse(withoutBatch);
    expect(result.success).toBe(false);
  });
});
