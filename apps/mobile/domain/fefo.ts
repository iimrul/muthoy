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
  expiryDate: string; // ISO date — the real date, never a precomputed day-count
  quantityAvailable: number;
  salePrice: Paisa;
}

export interface DeductionResult {
  batchId: string;
  quantityDeducted: number;
}

// TODO(Day 6): return the batch with the earliest expiryDate that still has
// quantityAvailable > 0, for Sale Entry's search-result price display
// (Volume 4 SALES: "each result showing the medicine's ACTIVE batch...").
export function activeBatch(_medicineId: string, _batches: Batch[]): Batch | undefined {
  throw new Error('TODO: implement FEFO active-batch resolution (Volume 0 Day 6)');
}

// TODO(Day 7): deduct `quantity` starting from the earliest-expiry batch,
// spilling over to the next batch once one empties (Volume 0 Day 7
// validation: "sell across a batch boundary — spill-over confirmed via
// inventory_movements"). Must have a passing unit test before Day 7 is done.
export function deduct(_medicineId: string, _quantity: number, _batches: Batch[]): DeductionResult[] {
  throw new Error('TODO: implement FEFO deduction with spill-over (Volume 0 Day 7)');
}
