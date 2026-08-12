import { describe, expect, it } from 'vitest';
import { ZERO_PAISA, asPaisa, subtractPaisa } from '@muthoy/types';
import { resolvePaymentEffect } from './purchases';

describe('resolvePaymentEffect', () => {
  it('resolves COD as immediate cash out with no payable', () => {
    expect(resolvePaymentEffect('cod', asPaisa(12_500))).toEqual({ cashDrawerDelta: -12_500, payableDelta: ZERO_PAISA });
  });
  it('resolves credit as payable with no cash movement', () => {
    expect(resolvePaymentEffect('credit', asPaisa(12_500))).toEqual({ cashDrawerDelta: ZERO_PAISA, payableDelta: 12_500 });
  });
  it.each(['cod', 'credit'] as const)('keeps zero unchanged for %s', (paymentType) => {
    expect(resolvePaymentEffect(paymentType, ZERO_PAISA)).toEqual({ cashDrawerDelta: ZERO_PAISA, payableDelta: ZERO_PAISA });
  });
  it.each(['cod', 'credit'] as const)('derives paid amount for %s', (paymentType) => {
    const total = asPaisa(23_450);
    const effect = resolvePaymentEffect(paymentType, total);
    expect(subtractPaisa(total, effect.payableDelta)).toBe(paymentType === 'cod' ? total : ZERO_PAISA);
  });
});
