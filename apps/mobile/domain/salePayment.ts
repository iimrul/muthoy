import { asPaisa, type Paisa } from '@muthoy/types';

export type SalePaymentRequest =
  | { type: 'cash'; tendered: Paisa }
  | { type: 'credit' }
  | { type: 'split'; cashApplied: Paisa }
  | { type: 'free' };

export interface ResolvedSalePayment {
  type: 'cash' | 'credit' | 'split' | 'free';
  cashApplied: Paisa;
  creditAmount: Paisa;
  tendered: Paisa;
  change: Paisa;
}

export function resolveSalePayment(total: Paisa, request: SalePaymentRequest): ResolvedSalePayment {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Total must be a non-negative integer paisa amount');
  if (total === 0) {
    if (request.type !== 'free') throw new Error('Zero-total sale must use free payment');
    return { type: 'free', cashApplied: asPaisa(0), creditAmount: asPaisa(0), tendered: asPaisa(0), change: asPaisa(0) };
  }
  if (request.type === 'free') throw new Error('Free payment requires a zero total');
  if (request.type === 'credit') {
    return { type: 'credit', cashApplied: asPaisa(0), creditAmount: total, tendered: asPaisa(0), change: asPaisa(0) };
  }
  if (request.type === 'split') {
    if (!Number.isSafeInteger(request.cashApplied) || request.cashApplied <= 0 || request.cashApplied >= total) {
      throw new Error('Split cash must be greater than zero and less than total');
    }
    return { type: 'split', cashApplied: request.cashApplied, creditAmount: asPaisa(total - request.cashApplied), tendered: request.cashApplied, change: asPaisa(0) };
  }
  if (!Number.isSafeInteger(request.tendered) || request.tendered < total) throw new Error('Cash tendered cannot be less than total');
  return { type: 'cash', cashApplied: total, creditAmount: asPaisa(0), tendered: request.tendered, change: asPaisa(request.tendered - total) };
}
