import { describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { resolveSalePayment } from './salePayment';

describe('sale payment invariants', () => {
  it('requires strict split endpoints and exact sum', () => {
    expect(resolveSalePayment(asPaisa(1000), { type: 'split', cashApplied: asPaisa(400) })).toMatchObject({ cashApplied: 400, creditAmount: 600, change: 0 });
    expect(() => resolveSalePayment(asPaisa(1000), { type: 'split', cashApplied: asPaisa(0) })).toThrow();
    expect(() => resolveSalePayment(asPaisa(1000), { type: 'split', cashApplied: asPaisa(1000) })).toThrow();
  });
  it('normalizes zero total to free only', () => {
    expect(resolveSalePayment(asPaisa(0), { type: 'free' })).toEqual({ type: 'free', cashApplied: 0, creditAmount: 0, tendered: 0, change: 0 });
    expect(() => resolveSalePayment(asPaisa(0), { type: 'credit' })).toThrow();
  });
  it('keeps cash over-tender as change, not applied cash', () => {
    expect(resolveSalePayment(asPaisa(800), { type: 'cash', tendered: asPaisa(1000) })).toMatchObject({ cashApplied: 800, change: 200 });
  });
});
