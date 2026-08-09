// db/inventory.ts — the ONLY file that will touch Drizzle/SQLite for
// Inventory (DEVELOPMENT_RULES.md). The Drizzle schema doesn't exist yet
// (Day 2), so these are signature-only stubs — no Drizzle import until then.

import type { Paisa } from '@muthoy/types';
import type { Batch } from '../domain/fefo';

export interface MedicineListRow {
  medicineId: string;
  name: string;
  totalStock: number;
  batchCount: number;
  activeBatch: Batch | undefined;
}

// TODO(Day 8): list medicines with current total stock, batch count, and
// active-batch expiry (Volume 4 INVENTORY) — resolves each medicine's
// active batch via domain/fefo.activeBatch once given its candidate batches.
export async function listMedicines(_shopId: string): Promise<MedicineListRow[]> {
  throw new Error('TODO: implement inventory list query (Volume 0 Day 8)');
}

export interface CreateMedicineInput {
  shopId: string;
  name: string;
  generic: string;
  manufacturer: string;
  strength: string;
  category: string;
  unitOfMeasure: string;
  requiresPrescription: boolean;
  threshold: number;
  barcode?: string;
  firstBatch: { batchNo: string; expiryDate: string; quantity: number; purchasePrice: Paisa; salePrice: Paisa };
}

// TODO(Day 8): create a medicine + its first batch in one transaction.
// Enforce UNIQUE(shop_id, medicine_id, batch_no) (Volume 3) with a friendly,
// typed error the screen can render inline — never let this throw a raw
// constraint-violation crash.
export async function createMedicineWithBatch(_input: CreateMedicineInput): Promise<{ medicineId: string; batchId: string }> {
  throw new Error('TODO: implement medicine + batch creation (Volume 0 Day 8)');
}

// TODO(Day 9): list batches for a shop sorted by nearest real expiryDate
// (CLAUDE.md rule 3 — recomputed at read time, never a stored day-count).
export async function listBatchesByExpiry(_shopId: string): Promise<Batch[]> {
  throw new Error('TODO: implement expiry-sorted batch query (Volume 0 Day 9)');
}
