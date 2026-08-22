import { asPaisa, type Paisa } from '@muthoy/types';
import { businessDateDifference } from '@muthoy/utils';

export function isWithinRefundWindow(saleBusinessDate: string, currentBusinessDate: string, maxDays: number): boolean {
  if (!Number.isInteger(maxDays) || maxDays < 0) throw new Error('Refund window must be non-negative days');
  const elapsed = businessDateDifference(currentBusinessDate, saleBusinessDate);
  return elapsed >= 0 && elapsed <= maxDays;
}

export interface CreditLedgerEntry { id: string; customerId: string; amount: Paisa; createdAt: string }
export interface CustomerPayment { id: string; customerId: string; amount: Paisa; method: 'cash' | 'bank' | 'mobile'; createdAt: string }
export interface PaymentAllocation { paymentId: string; creditId: string; method: CustomerPayment['method']; amount: Paisa }

/** Historical customer payments allocate FIFO by credit timestamp/id and payment timestamp/id. */
export function allocateCustomerPayments(credits: CreditLedgerEntry[], payments: CustomerPayment[]): {
  allocations: PaymentAllocation[];
  unallocatedPayment: Paisa;
} {
  const outstanding = new Map(credits.map((credit) => [credit.id, credit.amount]));
  const orderedCredits = [...credits].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const orderedPayments = [...payments].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const allocations: PaymentAllocation[] = [];
  let unallocated = 0;
  for (const payment of orderedPayments) {
    let remaining = payment.amount;
    for (const credit of orderedCredits) {
      if (remaining === 0) break;
      if (credit.customerId !== payment.customerId || credit.createdAt > payment.createdAt) continue;
      const available = outstanding.get(credit.id) ?? asPaisa(0);
      const amount = Math.min(remaining, available);
      if (amount > 0) allocations.push({ paymentId: payment.id, creditId: credit.id, method: payment.method, amount: asPaisa(amount) });
      outstanding.set(credit.id, asPaisa(available - amount));
      remaining = asPaisa(remaining - amount);
    }
    unallocated += remaining;
  }
  return { allocations, unallocatedPayment: asPaisa(unallocated) };
}

export function refundBreakdown(
  creditAmount: Paisa,
  allocations: PaymentAllocation[],
  creditId: string,
): { creditReversal: Paisa; cash: Paisa; bank: Paisa; mobile: Paisa } {
  const result = { creditReversal: creditAmount, cash: asPaisa(0), bank: asPaisa(0), mobile: asPaisa(0) };
  for (const allocation of allocations) {
    if (allocation.creditId !== creditId) continue;
    result[allocation.method] = asPaisa(result[allocation.method] + allocation.amount);
    result.creditReversal = asPaisa(result.creditReversal - allocation.amount);
  }
  if (result.creditReversal < 0) throw new Error('Credit allocation exceeds original credit');
  return result;
}
