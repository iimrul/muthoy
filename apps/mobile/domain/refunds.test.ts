import { describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { allocateCustomerPayments, isWithinRefundWindow, refundBreakdown } from './refunds';

describe('refund contracts', () => {
  it('uses an inclusive business-date refund window', () => {
    expect(isWithinRefundWindow('2026-08-01', '2026-08-08', 7)).toBe(true);
    expect(isWithinRefundWindow('2026-08-01', '2026-08-09', 7)).toBe(false);
  });
  it('allocates payments FIFO with timestamp then id tie-break', () => {
    const { allocations, unallocatedPayment } = allocateCustomerPayments(
      [{ id: 'a', customerId: 'c', amount: asPaisa(300), createdAt: '2026-01-01T00:00:00Z' }, { id: 'b', customerId: 'c', amount: asPaisa(400), createdAt: '2026-01-01T00:00:00Z' }],
      [{ id: 'p', customerId: 'c', amount: asPaisa(500), method: 'cash', createdAt: '2026-01-02T00:00:00Z' }],
    );
    expect(allocations.map((value) => [value.creditId, value.amount])).toEqual([['a', 300], ['b', 200]]);
    expect(unallocatedPayment).toBe(0);
  });
  it('reverses outstanding credit and refunds collections by original method', () => {
    expect(refundBreakdown(asPaisa(1000), [{ paymentId: 'p', creditId: 'c1', method: 'mobile', amount: asPaisa(250) }], 'c1')).toEqual({ creditReversal: 750, cash: 0, bank: 0, mobile: 250 });
  });
});
