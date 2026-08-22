// domain/fefo.ts — pure, framework-free FEFO (First-Expiry-First-Out) logic.
// Volume 2's class diagram: FEFOResolver.activeBatch() / .deduct(). Zero
// React/DB imports (DEVELOPMENT_RULES.md) — db/ fetches the raw batch rows,
// this file only decides which batches to use once given them.
// CLAUDE.md rule 3: sorts by the REAL expiryDate, recomputed at read time —
// never a stored day-count.

import type { Paisa } from '@muthoy/types';

export interface Batch {
  id: string;
  medicineId: string;
  // ISO date — the real date, never a precomputed day-count. Null means no
  // expiry recorded (db/schema.ts's batches.expiry_date is nullable) and
  // sorts LAST, per Volume 7: "including a null-expiry batch (must sort last)".
  expiryDate: string | null;
  quantityAvailable: number;
  salePrice: Paisa;
}

export interface DeductionResult {
  batchId: string;
  quantityDeducted: number;
}

export class InsufficientStockError extends Error {
  readonly medicineId: string;
  readonly requested: number;
  readonly available: number;

  constructor(medicineId: string, requested: number, available: number) {
    super(`Insufficient stock for ${medicineId}: requested ${requested}, available ${available}`);
    this.name = 'InsufficientStockError';
    this.medicineId = medicineId;
    this.requested = requested;
    this.available = available;
  }
}

// Ascending FEFO order: earliest real expiryDate first, null last (Volume 7:
// "including a null-expiry batch, must sort last"). Recomputed from the real
// date every call (CLAUDE.md rule 3) — never a stored day-count. Shared by
// activeBatch() below and by db/inventory.ts's batch-detail listing, so the
// ordering rule lives in exactly one place. Generic over T so a caller can
// pass a richer row (e.g. one that also carries batchNo for display) without
// losing those extra fields through the return type.
export function sortByExpiry<T extends Batch>(batches: T[]): T[] {
  return [...batches].sort((a, b) => {
    if (a.expiryDate === null) {
      return b.expiryDate === null ? 0 : 1;
    }
    if (b.expiryDate === null) {
      return -1;
    }
    return a.expiryDate.localeCompare(b.expiryDate);
  });
}

// Returns the batch with the earliest expiryDate that still has
// quantityAvailable > 0, for Sale Entry's search-result price display
// (Volume 4 SALES: "each result showing the medicine's ACTIVE batch...").
export function activeBatch(medicineId: string, batches: Batch[]): Batch | undefined {
  const candidates = batches.filter((b) => b.medicineId === medicineId && b.quantityAvailable > 0);
  return sortByExpiry(candidates)[0];
}

/** Printed expiry date remains sellable for that full Asia/Dhaka business day. */
export function isBatchSellable(batch: Pick<Batch, 'expiryDate' | 'quantityAvailable'>, businessDate: string): boolean {
  return batch.quantityAvailable > 0 && (batch.expiryDate === null || batch.expiryDate >= businessDate);
}

export function activeSellableBatch(medicineId: string, batches: Batch[], businessDate: string): Batch | undefined {
  return sortByExpiry(batches.filter((batch) => batch.medicineId === medicineId && isBatchSellable(batch, businessDate)))[0];
}

export function deductSellable(
  medicineId: string,
  quantity: number,
  batches: Batch[],
  businessDate: string,
): DeductionResult[] {
  return deduct(medicineId, quantity, batches.filter((batch) => isBatchSellable(batch, businessDate)));
}

// Resolve `quantity` earliest-expiry-first, spilling into later batches.
export function deduct(medicineId: string, quantity: number, batches: Batch[]): DeductionResult[] {
  const candidates = sortByExpiry(
    batches.filter((batch) => batch.medicineId === medicineId && batch.quantityAvailable > 0),
  );
  const available = candidates.reduce((sum, batch) => sum + batch.quantityAvailable, 0);

  if (quantity > available) {
    throw new InsufficientStockError(medicineId, quantity, available);
  }

  let remaining = quantity;
  const result: DeductionResult[] = [];

  for (const batch of candidates) {
    if (remaining === 0) {
      break;
    }
    const quantityDeducted = Math.min(remaining, batch.quantityAvailable);
    result.push({ batchId: batch.id, quantityDeducted });
    remaining -= quantityDeducted;
  }

  return result;
}
