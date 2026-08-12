import { describe, expect, it } from 'vitest';
import { DuplicateBatchError, isUniqueConstraintViolation } from './errors';

describe('DuplicateBatchError', () => {
  it('carries the medicineId and batchNo, and a friendly message', () => {
    const err = new DuplicateBatchError('med-1', 'B-100');
    expect(err.medicineId).toBe('med-1');
    expect(err.batchNo).toBe('B-100');
    expect(err.message).toContain('B-100');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('isUniqueConstraintViolation', () => {
  it('matches the real SQLite batches unique-constraint message', () => {
    const err = new Error('UNIQUE constraint failed: batches.shop_id, batches.medicine_id, batches.batch_no');
    expect(isUniqueConstraintViolation(err, 'batches', ['shop_id', 'medicine_id', 'batch_no'])).toBe(true);
  });

  it('rejects a constraint violation on a different table/columns', () => {
    const err = new Error('UNIQUE constraint failed: sales.shop_id, sales.invoice_no');
    expect(isUniqueConstraintViolation(err, 'batches', ['shop_id', 'medicine_id', 'batch_no'])).toBe(false);
  });

  it('rejects an unrelated error', () => {
    const err = new Error('FOREIGN KEY constraint failed');
    expect(isUniqueConstraintViolation(err, 'batches', ['shop_id', 'medicine_id', 'batch_no'])).toBe(false);
  });

  it('rejects a non-Error value', () => {
    expect(isUniqueConstraintViolation('not an error', 'batches', ['shop_id'])).toBe(false);
  });
});
