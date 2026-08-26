import { describe, expect, it } from 'vitest';
import { ZERO_PAISA, asPaisa } from '@muthoy/types';
import { resolvePaymentEffect } from './purchases';

describe('resolvePaymentEffect', () => {
  it('resolves COD with no available credit as immediate full cash out', () => {
    expect(resolvePaymentEffect('cod', asPaisa(12_500))).toEqual({
      cashDrawerDelta: asPaisa(-12_500),
      paidAmount: asPaisa(12_500),
      creditApplied: ZERO_PAISA,
    });
  });

  it('resolves credit as no cash movement and no paid amount', () => {
    expect(resolvePaymentEffect('credit', asPaisa(12_500))).toEqual({
      cashDrawerDelta: ZERO_PAISA,
      paidAmount: ZERO_PAISA,
      creditApplied: ZERO_PAISA,
    });
  });

  it.each(['cod', 'credit'] as const)('keeps zero unchanged for %s', (paymentType) => {
    expect(resolvePaymentEffect(paymentType, ZERO_PAISA)).toEqual({
      cashDrawerDelta: ZERO_PAISA,
      paidAmount: ZERO_PAISA,
      creditApplied: ZERO_PAISA,
    });
  });

  it('a credit-terms purchase never consumes Supplier Credit at creation, regardless of availability', () => {
    expect(resolvePaymentEffect('credit', asPaisa(5_000_00), asPaisa(2_000_00))).toEqual({
      cashDrawerDelta: ZERO_PAISA,
      paidAmount: ZERO_PAISA,
      creditApplied: ZERO_PAISA,
    });
  });

  describe('COD Supplier Credit application (B3 Group 7)', () => {
    it('consumes available credit before any cash, paying only the residual', () => {
      const effect = resolvePaymentEffect('cod', asPaisa(5_000_00), asPaisa(2_000_00));
      expect(effect.creditApplied).toBe(asPaisa(2_000_00));
      expect(effect.paidAmount).toBe(asPaisa(3_000_00));
      expect(effect.cashDrawerDelta).toBe(asPaisa(-3_000_00));
    });

    it('caps credit application at the invoice total — never pays negative cash, never over-consumes credit', () => {
      const effect = resolvePaymentEffect('cod', asPaisa(1_000_00), asPaisa(5_000_00));
      expect(effect.creditApplied).toBe(asPaisa(1_000_00));
      expect(effect.paidAmount).toBe(ZERO_PAISA);
      expect(effect.cashDrawerDelta).toBe(ZERO_PAISA);
    });

    it('falls back to full cash when no credit is available', () => {
      const effect = resolvePaymentEffect('cod', asPaisa(4_000_00), ZERO_PAISA);
      expect(effect.creditApplied).toBe(ZERO_PAISA);
      expect(effect.paidAmount).toBe(asPaisa(4_000_00));
      expect(effect.cashDrawerDelta).toBe(asPaisa(-4_000_00));
    });

    it('exact match — credit exactly covers the total, zero cash changes hands', () => {
      const effect = resolvePaymentEffect('cod', asPaisa(2_500_00), asPaisa(2_500_00));
      expect(effect.creditApplied).toBe(asPaisa(2_500_00));
      expect(effect.paidAmount).toBe(ZERO_PAISA);
      expect(effect.cashDrawerDelta).toBe(ZERO_PAISA);
    });
  });
});
