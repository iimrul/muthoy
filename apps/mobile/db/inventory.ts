// db/inventory.ts — the ONLY file that will touch Drizzle/SQLite for
// Inventory (DEVELOPMENT_RULES.md).
//
// sync_queue: writes here do NOT yet enqueue an outbox row. Matches the
// existing db/auth.ts / db/staff.ts precedent — the shared enqueue helper is
// built once on Day 13 and every write site (including this one) is
// backfilled together (see db/README.md).

import { and, eq } from 'drizzle-orm';
import type { Paisa } from '@muthoy/types';
import { db } from './client';
import { batches, medicines } from './schema';
import { generateId } from '../native/id';
import { activeBatch, sortByExpiry, type Batch } from '../domain/fefo';
import { DuplicateBatchError, isUniqueConstraintViolation } from './errors';

const BATCH_UNIQUE_COLUMNS = ['shop_id', 'medicine_id', 'batch_no'];

export interface MedicineListRow {
  medicineId: string;
  name: string;
  generic: string | null;
  totalStock: number;
  batchCount: number;
  activeBatch: Batch | undefined;
}

// Lists a shop's medicines with current total stock, batch count, and the
// FEFO active batch (Volume 4 INVENTORY). Two queries, not N+1: all
// medicines, then all their batches, grouped in JS — mirrors db/staff.ts's
// query style. Never reads a soft-deleted medicine or batch.
export async function listMedicines(shopId: string): Promise<MedicineListRow[]> {
  const medicineRows = await db
    .select({ id: medicines.id, name: medicines.name, generic: medicines.generic })
    .from(medicines)
    .where(and(eq(medicines.shopId, shopId), eq(medicines.isDeleted, false)))
    .orderBy(medicines.name);

  const batchRows = await db
    .select({
      id: batches.id,
      medicineId: batches.medicineId,
      expiryDate: batches.expiryDate,
      stock: batches.stock,
      salePrice: batches.salePrice,
    })
    .from(batches)
    .where(and(eq(batches.shopId, shopId), eq(batches.isDeleted, false)));

  // domain/fefo.ts's Batch names the field quantityAvailable; the schema
  // column is stock — the rename is confined to this one mapping.
  const allBatches: Batch[] = batchRows.map((row) => ({
    id: row.id,
    medicineId: row.medicineId,
    expiryDate: row.expiryDate,
    quantityAvailable: row.stock,
    salePrice: row.salePrice,
  }));

  return medicineRows.map((medicine) => {
    const medicineBatches = allBatches.filter((b) => b.medicineId === medicine.id);
    return {
      medicineId: medicine.id,
      name: medicine.name,
      generic: medicine.generic,
      totalStock: medicineBatches.reduce((sum, b) => sum + b.quantityAvailable, 0),
      batchCount: medicineBatches.length,
      activeBatch: activeBatch(medicine.id, medicineBatches),
    };
  });
}

export interface CreateMedicineInput {
  shopId: string;
  name: string;
  generic?: string;
  manufacturer?: string;
  strength?: string;
  category?: string;
  unitOfMeasure: string;
  requiresPrescription: boolean;
  threshold: number;
  barcode?: string;
  firstBatch: { batchNo: string; expiryDate?: string; quantity: number; purchasePrice: Paisa; salePrice: Paisa };
}

// Creates a medicine + its first batch in one transaction. The first batch
// can never collide with the UNIQUE(shop_id, medicine_id, batch_no)
// constraint — medicineId is freshly generated below, so there is no
// existing row to duplicate against. Adding a SECOND batch to an existing
// medicine is addBatchToMedicine, which is where that constraint actually
// applies.
export async function createMedicineWithBatch(
  input: CreateMedicineInput,
): Promise<{ medicineId: string; batchId: string }> {
  const medicineId = generateId();
  const batchId = generateId();

  await db.transaction(async (tx) => {
    await tx.insert(medicines).values({
      id: medicineId,
      shopId: input.shopId,
      name: input.name,
      generic: input.generic ?? null,
      manufacturer: input.manufacturer ?? null,
      strength: input.strength ?? null,
      category: input.category ?? null,
      unitOfMeasure: input.unitOfMeasure,
      requiresPrescription: input.requiresPrescription,
      threshold: input.threshold,
      barcode: input.barcode ?? null,
    });

    await tx.insert(batches).values({
      id: batchId,
      shopId: input.shopId,
      medicineId,
      batchNo: input.firstBatch.batchNo,
      expiryDate: input.firstBatch.expiryDate ?? null,
      stock: input.firstBatch.quantity,
      purchasePrice: input.firstBatch.purchasePrice,
      salePrice: input.firstBatch.salePrice,
    });
  });

  return { medicineId, batchId };
}

export interface AddBatchInput {
  shopId: string;
  medicineId: string;
  batchNo: string;
  expiryDate?: string;
  quantity: number;
  purchasePrice: Paisa;
  salePrice: Paisa;
}

// Adds a batch to an EXISTING medicine — the path that can actually hit the
// UNIQUE(shop_id, medicine_id, batch_no) constraint (Volume 3). Volume 0 Day
// 8: "Duplicate batch number for the same medicine shows a friendly error" —
// never a raw crash.
export async function addBatchToMedicine(input: AddBatchInput): Promise<{ batchId: string }> {
  // Pre-check deliberately ignores is_deleted: the unique index does NOT
  // include is_deleted, so a soft-deleted batch still occupies the
  // (shop, medicine, batch_no) slot and would otherwise crash past this
  // check straight into the raw SQLite constraint.
  const [existing] = await db
    .select({ id: batches.id })
    .from(batches)
    .where(
      and(eq(batches.shopId, input.shopId), eq(batches.medicineId, input.medicineId), eq(batches.batchNo, input.batchNo)),
    );

  if (existing) {
    throw new DuplicateBatchError(input.medicineId, input.batchNo);
  }

  const batchId = generateId();

  try {
    await db.insert(batches).values({
      id: batchId,
      shopId: input.shopId,
      medicineId: input.medicineId,
      batchNo: input.batchNo,
      expiryDate: input.expiryDate ?? null,
      stock: input.quantity,
      purchasePrice: input.purchasePrice,
      salePrice: input.salePrice,
    });
  } catch (err) {
    // Backstop for the race between the SELECT above and this INSERT — the
    // pre-check is not atomic with the write.
    if (isUniqueConstraintViolation(err, 'batches', BATCH_UNIQUE_COLUMNS)) {
      throw new DuplicateBatchError(input.medicineId, input.batchNo);
    }
    throw err;
  }

  return { batchId };
}

export interface MedicineDetail {
  id: string;
  name: string;
  generic: string | null;
  manufacturer: string | null;
  strength: string | null;
  category: string | null;
  unitOfMeasure: string;
  requiresPrescription: boolean;
  threshold: number;
  barcode: string | null;
}

export async function getMedicine(shopId: string, medicineId: string): Promise<MedicineDetail | null> {
  const [row] = await db
    .select({
      id: medicines.id,
      name: medicines.name,
      generic: medicines.generic,
      manufacturer: medicines.manufacturer,
      strength: medicines.strength,
      category: medicines.category,
      unitOfMeasure: medicines.unitOfMeasure,
      requiresPrescription: medicines.requiresPrescription,
      threshold: medicines.threshold,
      barcode: medicines.barcode,
    })
    .from(medicines)
    .where(and(eq(medicines.shopId, shopId), eq(medicines.id, medicineId), eq(medicines.isDeleted, false)));

  return row ?? null;
}

// domain/fefo.ts's Batch deliberately omits batchNo (FEFO logic never needs
// it); the batch-detail screen does, since it's the field the UNIQUE
// constraint is fought over — this row type adds it back for display only.
export interface BatchDetailRow extends Batch {
  batchNo: string;
}

// Returns a medicine's batches in FEFO order (earliest real expiry first,
// null-expiry last) for the batch-detail screen. Sort logic lives once, in
// domain/fefo.ts's sortByExpiry — never duplicated here.
export async function listBatchesForMedicine(shopId: string, medicineId: string): Promise<BatchDetailRow[]> {
  const rows = await db
    .select({
      id: batches.id,
      medicineId: batches.medicineId,
      batchNo: batches.batchNo,
      expiryDate: batches.expiryDate,
      stock: batches.stock,
      salePrice: batches.salePrice,
    })
    .from(batches)
    .where(and(eq(batches.shopId, shopId), eq(batches.medicineId, medicineId), eq(batches.isDeleted, false)));

  const mapped: BatchDetailRow[] = rows.map((row) => ({
    id: row.id,
    medicineId: row.medicineId,
    batchNo: row.batchNo,
    expiryDate: row.expiryDate,
    quantityAvailable: row.stock,
    salePrice: row.salePrice,
  }));

  return sortByExpiry(mapped);
}
