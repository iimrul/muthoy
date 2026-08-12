import { describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { activeBatch, deduct, InsufficientStockError, sortByExpiry, type Batch } from './fefo';

// Volume 7 INVENTORY TESTING: "FEFO active-batch selection correct across 2,
// 1, and 5+ batch medicines, including a null-expiry batch (must sort last)."

function makeBatch(overrides: Partial<Batch>): Batch {
  return {
    id: 'batch-id',
    medicineId: 'med-1',
    expiryDate: '2027-01-01',
    quantityAvailable: 10,
    salePrice: asPaisa(1000),
    ...overrides,
  };
}

describe('activeBatch', () => {
  it('returns the only batch when there is exactly 1', () => {
    const batches = [makeBatch({ id: 'a' })];
    expect(activeBatch('med-1', batches)?.id).toBe('a');
  });

  it('returns the earlier-expiring of 2 batches', () => {
    const batches = [
      makeBatch({ id: 'later', expiryDate: '2027-06-01' }),
      makeBatch({ id: 'earlier', expiryDate: '2027-01-01' }),
    ];
    expect(activeBatch('med-1', batches)?.id).toBe('earlier');
  });

  it('returns the earliest-expiring across 5+ batches', () => {
    const batches = [
      makeBatch({ id: 'b5', expiryDate: '2030-01-01' }),
      makeBatch({ id: 'b2', expiryDate: '2027-03-01' }),
      makeBatch({ id: 'b1', expiryDate: '2027-01-01' }),
      makeBatch({ id: 'b4', expiryDate: '2029-01-01' }),
      makeBatch({ id: 'b3', expiryDate: '2028-01-01' }),
    ];
    expect(activeBatch('med-1', batches)?.id).toBe('b1');
  });

  it('sorts a null-expiry batch last, even if it would otherwise be earliest by insertion order', () => {
    const batches = [
      makeBatch({ id: 'no-expiry', expiryDate: null }),
      makeBatch({ id: 'has-expiry', expiryDate: '2030-01-01' }),
    ];
    expect(activeBatch('med-1', batches)?.id).toBe('has-expiry');
  });

  it('returns undefined when every batch for the medicine is out of stock', () => {
    const batches = [makeBatch({ id: 'a', quantityAvailable: 0 })];
    expect(activeBatch('med-1', batches)).toBeUndefined();
  });

  it('excludes batches belonging to a different medicine', () => {
    const batches = [makeBatch({ id: 'other', medicineId: 'med-2', expiryDate: '2027-01-01' })];
    expect(activeBatch('med-1', batches)).toBeUndefined();
  });

  it('picks the in-stock batch over an earlier-expiring but depleted one', () => {
    const batches = [
      makeBatch({ id: 'depleted', expiryDate: '2027-01-01', quantityAvailable: 0 }),
      makeBatch({ id: 'in-stock', expiryDate: '2027-06-01', quantityAvailable: 5 }),
    ];
    expect(activeBatch('med-1', batches)?.id).toBe('in-stock');
  });
});

describe('sortByExpiry', () => {
  it('orders ascending by expiry date with null-expiry batches last', () => {
    const batches = [
      makeBatch({ id: 'no-expiry', expiryDate: null }),
      makeBatch({ id: 'late', expiryDate: '2028-01-01' }),
      makeBatch({ id: 'early', expiryDate: '2027-01-01' }),
    ];
    expect(sortByExpiry(batches).map((b) => b.id)).toEqual(['early', 'late', 'no-expiry']);
  });

  it('does not mutate the input array', () => {
    const batches = [makeBatch({ id: 'b', expiryDate: '2028-01-01' }), makeBatch({ id: 'a', expiryDate: '2027-01-01' })];
    const original = [...batches];
    sortByExpiry(batches);
    expect(batches).toEqual(original);
  });
});

describe('deduct', () => {
  it('deducts from a single batch', () => {
    expect(deduct('med-1', 4, [makeBatch({ id: 'a', quantityAvailable: 10 })])).toEqual([
      { batchId: 'a', quantityDeducted: 4 },
    ]);
  });

  it('spills across two batches in FEFO order', () => {
    const batches = [
      makeBatch({ id: 'later', expiryDate: '2028-01-01', quantityAvailable: 5 }),
      makeBatch({ id: 'earlier', expiryDate: '2027-01-01', quantityAvailable: 2 }),
    ];
    expect(deduct('med-1', 5, batches)).toEqual([
      { batchId: 'earlier', quantityDeducted: 2 },
      { batchId: 'later', quantityDeducted: 3 },
    ]);
  });

  it('spills across three or more batches', () => {
    const batches = [
      makeBatch({ id: 'third', expiryDate: '2029-01-01', quantityAvailable: 4 }),
      makeBatch({ id: 'first', expiryDate: '2027-01-01', quantityAvailable: 1 }),
      makeBatch({ id: 'second', expiryDate: '2028-01-01', quantityAvailable: 2 }),
      makeBatch({ id: 'fourth', expiryDate: '2030-01-01', quantityAvailable: 8 }),
    ];
    expect(deduct('med-1', 10, batches)).toEqual([
      { batchId: 'first', quantityDeducted: 1 },
      { batchId: 'second', quantityDeducted: 2 },
      { batchId: 'third', quantityDeducted: 4 },
      { batchId: 'fourth', quantityDeducted: 3 },
    ]);
  });

  it('stops on an exact match without touching the next batch', () => {
    const batches = [
      makeBatch({ id: 'first', expiryDate: '2027-01-01', quantityAvailable: 3 }),
      makeBatch({ id: 'second', expiryDate: '2028-01-01', quantityAvailable: 9 }),
    ];
    expect(deduct('med-1', 3, batches)).toEqual([{ batchId: 'first', quantityDeducted: 3 }]);
  });

  it('uses a null-expiry batch last', () => {
    const batches = [
      makeBatch({ id: 'no-expiry', expiryDate: null, quantityAvailable: 4 }),
      makeBatch({ id: 'dated', expiryDate: '2027-01-01', quantityAvailable: 2 }),
    ];
    expect(deduct('med-1', 3, batches)).toEqual([
      { batchId: 'dated', quantityDeducted: 2 },
      { batchId: 'no-expiry', quantityDeducted: 1 },
    ]);
  });

  it('throws typed details when stock is insufficient', () => {
    expect.assertions(4);
    try {
      deduct('med-1', 8, [makeBatch({ quantityAvailable: 3 })]);
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientStockError);
      expect((error as InsufficientStockError).medicineId).toBe('med-1');
      expect((error as InsufficientStockError).requested).toBe(8);
      expect((error as InsufficientStockError).available).toBe(3);
    }
  });

  it('ignores other medicines and zero-stock batches', () => {
    const batches = [
      makeBatch({ id: 'zero', quantityAvailable: 0 }),
      makeBatch({ id: 'other', medicineId: 'med-2', quantityAvailable: 20 }),
      makeBatch({ id: 'valid', quantityAvailable: 2 }),
    ];
    expect(deduct('med-1', 2, batches)).toEqual([{ batchId: 'valid', quantityDeducted: 2 }]);
  });

  it('does not mutate the input batches', () => {
    const batches = [
      makeBatch({ id: 'later', expiryDate: '2028-01-01', quantityAvailable: 5 }),
      makeBatch({ id: 'earlier', expiryDate: '2027-01-01', quantityAvailable: 2 }),
    ];
    const snapshot = batches.map((batch) => ({ ...batch }));
    deduct('med-1', 6, batches);
    expect(batches).toEqual(snapshot);
  });
});
