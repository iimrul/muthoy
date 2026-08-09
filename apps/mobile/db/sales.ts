// db/sales.ts — the ONLY file that will touch Drizzle/SQLite for Sales
// (DEVELOPMENT_RULES.md: "db/ — the ONLY code that imports Drizzle or
// touches SQLite directly"). The Drizzle schema doesn't exist yet (Day 2),
// so these are signature-only stubs — no Drizzle import until then.

import type { Paisa } from '@muthoy/types';
import type { Batch } from '../domain/fefo';

export interface MedicineSearchResult {
  medicineId: string;
  name: string;
  generic: string;
  activeBatch: Batch;
}

// TODO(Day 3 + Day 6): FTS5 search over medicines(name, generic), capped at
// 50 results (Volume 4 SALES). Delegates to Day 3's shared FTS5 search
// infrastructure once built — not reimplemented here.
export async function searchMedicinesForSale(_query: string): Promise<MedicineSearchResult[]> {
  throw new Error('TODO: implement FTS5 medicine search for Sale Entry (Volume 0 Day 3 + Day 6)');
}

// TODO(Day 6): return the FEFO active batch (earliest real expiryDate,
// quantityAvailable > 0) for a medicine — see domain/fefo.activeBatch, which
// this function's implementation will call once given the candidate batches.
export async function getActiveBatchForMedicine(_medicineId: string): Promise<Batch | undefined> {
  throw new Error('TODO: implement active-batch lookup (Volume 0 Day 6, CLAUDE.md rule 3)');
}

export interface SaleTransactionInput {
  shopId: string;
  paymentType: 'cash' | 'credit';
  lines: {
    medicineId: string;
    // Pre-resolved by domain/fefo.deduct() — this function persists the
    // plan, it does not decide which batches to use.
    deductions: { batchId: string; quantityDeducted: number }[];
    unitPrice: Paisa;
    discount?: { type: 'percentage' | 'flat'; value: number };
  }[];
}

// TODO(Day 7): single Drizzle transaction writing `sales` + `sale_items` +
// `inventory_movements` (Volume 2's sequence diagram: "Screen -> db: write
// sales, sale_items, inventory_movements (one transaction)"). Volume 0 Day 7
// is the HIGHEST RISK day — flag anything ambiguous before implementing.
export async function createSaleTransaction(_input: SaleTransactionInput): Promise<{ saleId: string }> {
  throw new Error('TODO: implement sale transaction write (Volume 0 Day 7)');
}
