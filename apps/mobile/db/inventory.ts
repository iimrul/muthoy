// db/inventory.ts — the ONLY file that will touch Drizzle/SQLite for
// Inventory (DEVELOPMENT_RULES.md).
//
// sync_queue: writes here do NOT yet enqueue an outbox row. Matches the
// existing db/auth.ts / db/staff.ts precedent — the shared enqueue helper is
// built once on Day 13 and every write site (including this one) is
// backfilled together (see db/README.md).

import { and, eq } from 'drizzle-orm';
import type { Paisa } from '@muthoy/types';
import { daysUntilExpiry } from '@muthoy/utils';
import { db } from './client';
import { batches, medicines } from './schema';
import { generateId } from '../native/id';
import { activeBatch, sortByExpiry, type Batch } from '../domain/fefo';
import { expiryStatus, type ExpiryStatus } from '../domain/notificationRules';
import { requirePermission } from './auth';
import { DuplicateBatchError, isUniqueConstraintViolation } from './errors';
import { recordChange } from './sync-helpers';

const BATCH_UNIQUE_COLUMNS = ['shop_id', 'medicine_id', 'batch_no'];

export interface MedicineListRow {
  medicineId: string;
  name: string;
  generic: string | null;
  threshold: number;
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
    .select({ id: medicines.id, name: medicines.name, generic: medicines.generic, threshold: medicines.threshold })
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
      threshold: medicine.threshold,
      totalStock: medicineBatches.reduce((sum, b) => sum + b.quantityAvailable, 0),
      batchCount: medicineBatches.length,
      activeBatch: activeBatch(medicine.id, medicineBatches),
    };
  });
}

export interface CreateMedicineInput {
  shopId: string;
  /** Logged-in user performing the write — checked against `inventory_write`. */
  actorUserId: string;
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
  // Volume 0 Day 11: Staff is inventory-VIEW only. Reads below stay open to
  // both roles; every stock-changing write is gated here, before the
  // transaction, so a denial writes nothing.
  await requirePermission(input.shopId, input.actorUserId, 'inventory_write');

  const medicineId = generateId();
  const batchId = generateId();

  await db.transaction(async (tx) => {
    const now = new Date().toISOString();
    const medicineValues = {
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
      createdAt: now, updatedAt: now,
    };
    await tx.insert(medicines).values(medicineValues);
    recordChange(tx, { shopId: input.shopId, table: 'medicines', rowId: medicineId, op: 'insert', payload: medicineValues });

    const batchValues = {
      id: batchId,
      shopId: input.shopId,
      medicineId,
      batchNo: input.firstBatch.batchNo,
      expiryDate: input.firstBatch.expiryDate ?? null,
      stock: input.firstBatch.quantity,
      purchasePrice: input.firstBatch.purchasePrice,
      salePrice: input.firstBatch.salePrice,
      createdAt: now, updatedAt: now,
    };
    await tx.insert(batches).values(batchValues);
    recordChange(tx, { shopId: input.shopId, table: 'batches', rowId: batchId, op: 'insert', payload: batchValues });
  });

  return { medicineId, batchId };
}

export interface AddBatchInput {
  shopId: string;
  /** Logged-in user performing the write — checked against `inventory_write`. */
  actorUserId: string;
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
  await requirePermission(input.shopId, input.actorUserId, 'inventory_write');

  const batchId = generateId();
  try {
    await db.transaction(async (tx) => {
      const existing = await tx.select({ id: batches.id }).from(batches).where(and(
        eq(batches.shopId, input.shopId), eq(batches.medicineId, input.medicineId), eq(batches.batchNo, input.batchNo),
      )).get();
      if (existing) throw new DuplicateBatchError(input.medicineId, input.batchNo);
      const now = new Date().toISOString();
      const values = {
        id: batchId, shopId: input.shopId, medicineId: input.medicineId,
        batchNo: input.batchNo, expiryDate: input.expiryDate ?? null,
        stock: input.quantity, purchasePrice: input.purchasePrice, salePrice: input.salePrice,
        createdAt: now, updatedAt: now,
      };
      await tx.insert(batches).values(values);
      recordChange(tx, { shopId: input.shopId, table: 'batches', rowId: batchId, op: 'insert', payload: values });
    });
  } catch (err) {
    if (err instanceof DuplicateBatchError || isUniqueConstraintViolation(err, 'batches', BATCH_UNIQUE_COLUMNS)) {
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

// domain/fefo.ts's Batch plus the medicine's display name and the derived
// (never stored — CLAUDE.md rule 3) days-to-expiry/status for one row of the
// Expiry Management screen (Volume 0 Day 9).
export interface ExpiryListRow extends Batch {
  medicineName: string;
  batchNo: string;
  daysUntilExpiry: number | null;
  status: ExpiryStatus;
}

// Every non-deleted batch across the whole shop, nearest-real-expiry-first
// (null-expiry last), for the Expiry Management screen. Sort order comes
// from domain/fefo.ts's sortByExpiry — the same function the FEFO deduction
// path uses — never a second hand-rolled sort. `now` defaults to the current
// time but is overridable so callers (tests) can pin it; the days/status are
// always recomputed from the real expiryDate, never persisted.
//
// Shop isolation (CLAUDE.md rule 7) is enforced on BOTH sides of the join:
// the ON clause requires the medicine to belong to the same shop, so a batch
// row whose medicine_id points at another shop's medicine — a corrupted or
// hostile sync payload — matches nothing and is dropped, rather than
// rendering that other shop's medicine name. Filtering only batches.shop_id
// would leak it.
//
// TODO(settings): the expiry window is the shared repo-wide default
// (domain/notificationRules.ts's EXPIRY_WINDOW_DAYS_DEFAULT, also used by
// the Notifications expiry job). There is no per-shop persisted threshold in
// the schema yet — making it configurable needs a real Settings slice
// (Volume 4 SETTINGS) and is deliberately NOT invented here. `expiryStatus`
// already takes a windowDays argument, so wiring a stored value later is a
// one-line change at this call site.
export async function listBatchesByExpiry(shopId: string, now: Date = new Date()): Promise<ExpiryListRow[]> {
  const rows = await db
    .select({
      id: batches.id,
      medicineId: batches.medicineId,
      medicineName: medicines.name,
      batchNo: batches.batchNo,
      expiryDate: batches.expiryDate,
      stock: batches.stock,
      salePrice: batches.salePrice,
    })
    .from(batches)
    .innerJoin(medicines, and(eq(batches.medicineId, medicines.id), eq(medicines.shopId, shopId)))
    .where(and(eq(batches.shopId, shopId), eq(batches.isDeleted, false), eq(medicines.isDeleted, false)));

  const mapped = rows.map((row) => ({
    id: row.id,
    medicineId: row.medicineId,
    medicineName: row.medicineName,
    batchNo: row.batchNo,
    expiryDate: row.expiryDate,
    quantityAvailable: row.stock,
    salePrice: row.salePrice,
  }));

  return sortByExpiry(mapped).map((batch) => {
    const days = daysUntilExpiry(batch.expiryDate, now);
    return { ...batch, daysUntilExpiry: days, status: expiryStatus(days) };
  });
}
