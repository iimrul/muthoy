// db/inventory.ts — the ONLY file that will touch Drizzle/SQLite for
// Inventory (DEVELOPMENT_RULES.md).
//
// sync_queue: writes here do NOT yet enqueue an outbox row. Matches the
// existing db/auth.ts / db/staff.ts precedent — the shared enqueue helper is
// built once on Day 13 and every write site (including this one) is
// backfilled together (see db/README.md).

import { and, eq } from "drizzle-orm";
import type { Paisa } from "@muthoy/types";
import {
  assertIsoDate,
  businessDateDifference,
  daysUntilExpiry,
  dhakaBusinessDate,
} from "@muthoy/utils";
import { db } from "./client";
import {
  auditLogs,
  batchPromotions,
  batches,
  medicines,
  shopB2Settings,
} from "./schema";
import { generateId } from "../native/id";
import {
  activeSellableBatch,
  isBatchSellable,
  sortByExpiry,
  type Batch,
} from "../domain/fefo";
import type { ExpiryStatus } from "../domain/notificationRules";
import { requirePermission } from "./auth";
import {
  assertSessionLive,
  DuplicateBatchError,
  isUniqueConstraintViolation,
} from "./errors";
import { addStock, adjustStock } from "./stockLedger";
import { recordChange, stampUpdatedAt } from "./sync-helpers";
import {
  effectiveLowStockThreshold,
  expiryBand,
} from "../domain/inventoryRules";
import { effectiveUnitPrice } from "../domain/pricing";

const BATCH_UNIQUE_COLUMNS = ["shop_id", "medicine_id", "batch_no"];

export interface MedicineListRow {
  medicineId: string;
  name: string;
  generic: string | null;
  threshold: number;
  totalStock: number;
  sellableStock: number;
  batchCount: number;
  batchSearchText: string;
  hasExpiringStock: boolean;
  activePromotionBps: number | null;
  activeBatch: Batch | undefined;
}

// Lists a shop's medicines with current total stock, batch count, and the
// FEFO active batch (Volume 4 INVENTORY). Two queries, not N+1: all
// medicines, then all their batches, grouped in JS — mirrors db/staff.ts's
// query style. Never reads a soft-deleted medicine or batch.
export async function listMedicines(
  shopId: string,
): Promise<MedicineListRow[]> {
  const medicineRows = await db
    .select({
      id: medicines.id,
      name: medicines.name,
      generic: medicines.generic,
      threshold: medicines.threshold,
      override: medicines.lowStockThresholdOverride,
    })
    .from(medicines)
    .where(and(eq(medicines.shopId, shopId), eq(medicines.isDeleted, false)))
    .orderBy(medicines.name);

  const batchRows = await db
    .select({
      id: batches.id,
      medicineId: batches.medicineId,
      expiryDate: batches.expiryDate,
      batchNo: batches.batchNo,
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

  const settings = db
    .select({
      lowStockDefault: shopB2Settings.lowStockDefault,
      farDays: shopB2Settings.expiryFarDays,
    })
    .from(shopB2Settings)
    .where(
      and(
        eq(shopB2Settings.shopId, shopId),
        eq(shopB2Settings.isDeleted, false),
      ),
    )
    .get();
  const promotions = db
    .select({
      batchId: batchPromotions.batchId,
      discountBps: batchPromotions.discountBps,
    })
    .from(batchPromotions)
    .where(
      and(
        eq(batchPromotions.shopId, shopId),
        eq(batchPromotions.isActive, true),
        eq(batchPromotions.isDeleted, false),
      ),
    )
    .all();
  const promotionByBatch = new Map(
    promotions.map((row) => [row.batchId, row.discountBps]),
  );
  const businessDate = dhakaBusinessDate(new Date());
  return medicineRows.map((medicine) => {
    const medicineBatches = allBatches.filter(
      (b) => b.medicineId === medicine.id,
    );
    const sellableBatches = medicineBatches.filter((batch) =>
      isBatchSellable(batch, businessDate),
    );
    const activeBatch = activeSellableBatch(
      medicine.id,
      medicineBatches,
      businessDate,
    );
    return {
      medicineId: medicine.id,
      name: medicine.name,
      generic: medicine.generic,
      threshold: effectiveLowStockThreshold(
        medicine.override,
        settings?.lowStockDefault,
      ),
      totalStock: medicineBatches.reduce(
        (sum, b) => sum + b.quantityAvailable,
        0,
      ),
      sellableStock: sellableBatches.reduce(
        (sum, b) => sum + b.quantityAvailable,
        0,
      ),
      batchCount: medicineBatches.length,
      batchSearchText: batchRows
        .filter((row) => row.medicineId === medicine.id)
        .map((row) => row.batchNo)
        .join(" "),
      hasExpiringStock: sellableBatches.some(
        (batch) =>
          batch.expiryDate !== null &&
          businessDateDifference(batch.expiryDate, businessDate) <=
            (settings?.farDays ?? 60),
      ),
      activePromotionBps: activeBatch
        ? (promotionByBatch.get(activeBatch.id) ?? null)
        : null,
      activeBatch,
    };
  });
}

export interface CreateMedicineInput {
  shopId: string;
  /** Logged-in user performing the write — checked against `inventory_write`. */
  actorUserId: string;
  /** Liveness of the login this write belongs to (state/sessionGuard.ts). */
  isStillActive: () => boolean;
  name: string;
  generic?: string;
  manufacturer?: string;
  strength?: string;
  category?: string;
  unitOfMeasure: string;
  requiresPrescription: boolean;
  threshold?: number;
  barcode?: string;
  firstBatch: {
    batchNo: string;
    expiryDate?: string;
    quantity: number;
    purchasePrice: Paisa;
    salePrice: Paisa;
  };
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
  await requirePermission(input.shopId, input.actorUserId, "inventory_write");

  const medicineId = generateId();
  const batchId = generateId();

  await db.transaction(async (tx) => {
    // This callback AWAITS between writes, so unlike the synchronous ones in
    // cash/customers/purchases/sales a handover can land mid-transaction.
    // Checked at both ends: the trailing check turns a mid-flight switch into
    // a throw, which rolls the whole transaction back.
    assertSessionLive(input.isStillActive);
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
      threshold: input.threshold ?? 10,
      lowStockThresholdOverride: input.threshold ?? null,
      barcode: input.barcode ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await tx.insert(medicines).values(medicineValues);
    recordChange(tx, {
      shopId: input.shopId,
      table: "medicines",
      rowId: medicineId,
      op: "insert",
      payload: medicineValues,
    });

    const batchValues = {
      id: batchId,
      shopId: input.shopId,
      medicineId,
      batchNo: input.firstBatch.batchNo,
      expiryDate: input.firstBatch.expiryDate ?? null,
      // Opening quantity arrives as a movement, never as a seeded absolute —
      // `batches.stock` is the ledger's projection everywhere (schema.ts).
      stock: 0,
      purchasePrice: input.firstBatch.purchasePrice,
      salePrice: input.firstBatch.salePrice,
      createdAt: now,
      updatedAt: now,
    };
    await tx.insert(batches).values(batchValues);
    recordChange(tx, {
      shopId: input.shopId,
      table: "batches",
      rowId: batchId,
      op: "insert",
      payload: batchValues,
    });
    addStock(tx, {
      shopId: input.shopId,
      batchId,
      quantity: input.firstBatch.quantity,
      reason: "purchase",
      createdBy: input.actorUserId,
    });
    assertSessionLive(input.isStillActive);
  });

  return { medicineId, batchId };
}

export interface AddBatchInput {
  shopId: string;
  /** Logged-in user performing the write — checked against `inventory_write`. */
  actorUserId: string;
  /** Liveness of the login this write belongs to (state/sessionGuard.ts). */
  isStillActive: () => boolean;
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
export async function addBatchToMedicine(
  input: AddBatchInput,
): Promise<{ batchId: string }> {
  await requirePermission(input.shopId, input.actorUserId, "inventory_write");

  const batchId = generateId();
  try {
    await db.transaction(async (tx) => {
      // Async callback — checked at both ends. See createMedicineWithBatch.
      assertSessionLive(input.isStillActive);
      const existing = await tx
        .select({ id: batches.id })
        .from(batches)
        .where(
          and(
            eq(batches.shopId, input.shopId),
            eq(batches.medicineId, input.medicineId),
            eq(batches.batchNo, input.batchNo),
          ),
        )
        .get();
      if (existing)
        throw new DuplicateBatchError(input.medicineId, input.batchNo);
      const now = new Date().toISOString();
      const values = {
        id: batchId,
        shopId: input.shopId,
        medicineId: input.medicineId,
        batchNo: input.batchNo,
        expiryDate: input.expiryDate ?? null,
        // See createMedicineWithBatch: the movement below is the only source
        // of this batch's opening quantity.
        stock: 0,
        purchasePrice: input.purchasePrice,
        salePrice: input.salePrice,
        createdAt: now,
        updatedAt: now,
      };
      await tx.insert(batches).values(values);
      recordChange(tx, {
        shopId: input.shopId,
        table: "batches",
        rowId: batchId,
        op: "insert",
        payload: values,
      });
      addStock(tx, {
        shopId: input.shopId,
        batchId,
        quantity: input.quantity,
        reason: "purchase",
        createdBy: input.actorUserId,
      });
      assertSessionLive(input.isStillActive);
    });
  } catch (err) {
    if (
      err instanceof DuplicateBatchError ||
      isUniqueConstraintViolation(err, "batches", BATCH_UNIQUE_COLUMNS)
    ) {
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

export async function getMedicine(
  shopId: string,
  medicineId: string,
): Promise<MedicineDetail | null> {
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
    .where(
      and(
        eq(medicines.shopId, shopId),
        eq(medicines.id, medicineId),
        eq(medicines.isDeleted, false),
      ),
    );

  return row ?? null;
}

// domain/fefo.ts's Batch deliberately omits batchNo (FEFO logic never needs
// it); the batch-detail screen does, since it's the field the UNIQUE
// constraint is fought over — this row type adds it back for display only.
export interface BatchDetailRow extends Batch {
  batchNo: string;
  purchasePrice: Paisa;
}

// Returns a medicine's batches in FEFO order (earliest real expiry first,
// null-expiry last) for the batch-detail screen. Sort logic lives once, in
// domain/fefo.ts's sortByExpiry — never duplicated here.
export async function listBatchesForMedicine(
  shopId: string,
  medicineId: string,
): Promise<BatchDetailRow[]> {
  const rows = await db
    .select({
      id: batches.id,
      medicineId: batches.medicineId,
      batchNo: batches.batchNo,
      expiryDate: batches.expiryDate,
      stock: batches.stock,
      purchasePrice: batches.purchasePrice,
      salePrice: batches.salePrice,
    })
    .from(batches)
    .where(
      and(
        eq(batches.shopId, shopId),
        eq(batches.medicineId, medicineId),
        eq(batches.isDeleted, false),
      ),
    );

  const mapped: BatchDetailRow[] = rows.map((row) => ({
    id: row.id,
    medicineId: row.medicineId,
    batchNo: row.batchNo,
    expiryDate: row.expiryDate,
    quantityAvailable: row.stock,
    purchasePrice: row.purchasePrice,
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
// Expiry status uses the shared notification default for legacy callers.
// The B2 Expiry Management screen separately applies persisted Near/Far bands.
export async function listBatchesByExpiry(
  shopId: string,
  now: Date = new Date(),
): Promise<ExpiryListRow[]> {
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
    .innerJoin(
      medicines,
      and(eq(batches.medicineId, medicines.id), eq(medicines.shopId, shopId)),
    )
    .where(
      and(
        eq(batches.shopId, shopId),
        eq(batches.isDeleted, false),
        eq(medicines.isDeleted, false),
      ),
    );

  const mapped = rows.map((row) => ({
    id: row.id,
    medicineId: row.medicineId,
    medicineName: row.medicineName,
    batchNo: row.batchNo,
    expiryDate: row.expiryDate,
    quantityAvailable: row.stock,
    salePrice: row.salePrice,
  }));

  const settings = db
    .select({
      near: shopB2Settings.expiryNearDays,
      far: shopB2Settings.expiryFarDays,
    })
    .from(shopB2Settings)
    .where(
      and(
        eq(shopB2Settings.shopId, shopId),
        eq(shopB2Settings.isDeleted, false),
      ),
    )
    .get();
  return sortByExpiry(mapped).map((batch) => {
    const days = daysUntilExpiry(batch.expiryDate, now);
    const band = expiryBand(days, settings?.near, settings?.far);
    const status: ExpiryStatus =
      band === "expired"
        ? "expired"
        : band === "near"
          ? "critical"
          : band === "far"
            ? "warning"
            : band === "unknown"
              ? "unknown"
              : "ok";
    return { ...batch, daysUntilExpiry: days, status };
  });
}

export async function listManufacturerSuggestions(
  shopId: string,
  query = "",
): Promise<string[]> {
  const needle = query.trim().toLocaleLowerCase();
  const rows = db
    .select({ manufacturer: medicines.manufacturer })
    .from(medicines)
    .where(and(eq(medicines.shopId, shopId), eq(medicines.isDeleted, false)))
    .all();
  return [
    ...new Set(
      rows
        .map((row) => row.manufacturer?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ]
    .filter((value) => !needle || value.toLocaleLowerCase().includes(needle))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 20);
}

export interface BarcodeCandidate {
  medicineId: string;
  name: string;
  barcode: string;
  sellableStock: number;
  activeBatchId: string | null;
  effectiveUnitPrice: Paisa | null;
  disabledReason: string | null;
}

export async function searchBarcodeCandidates(
  shopId: string,
  barcode: string,
  now: Date = new Date(),
): Promise<BarcodeCandidate[]> {
  const normalized = barcode.trim();
  if (!normalized) return [];
  const medicineRows = db
    .select({
      id: medicines.id,
      name: medicines.name,
      barcode: medicines.barcode,
      isDeleted: medicines.isDeleted,
    })
    .from(medicines)
    .where(and(eq(medicines.shopId, shopId), eq(medicines.barcode, normalized)))
    .all();
  const batchRows = db
    .select({
      id: batches.id,
      medicineId: batches.medicineId,
      expiryDate: batches.expiryDate,
      quantityAvailable: batches.stock,
      salePrice: batches.salePrice,
      isDeleted: batches.isDeleted,
    })
    .from(batches)
    .where(eq(batches.shopId, shopId))
    .all();
  const promotions = db
    .select({
      batchId: batchPromotions.batchId,
      discountBps: batchPromotions.discountBps,
    })
    .from(batchPromotions)
    .where(
      and(
        eq(batchPromotions.shopId, shopId),
        eq(batchPromotions.isActive, true),
        eq(batchPromotions.isDeleted, false),
      ),
    )
    .all();
  const promotionByBatch = new Map(
    promotions.map((row) => [row.batchId, row.discountBps]),
  );
  const businessDate = dhakaBusinessDate(now);
  const farDays =
    db
      .select({ far: shopB2Settings.expiryFarDays })
      .from(shopB2Settings)
      .where(
        and(
          eq(shopB2Settings.shopId, shopId),
          eq(shopB2Settings.isDeleted, false),
        ),
      )
      .get()?.far ?? 60;
  return medicineRows
    .map((medicine) => {
      const owned = batchRows.filter(
        (batch) => batch.medicineId === medicine.id && !batch.isDeleted,
      );
      const active = activeSellableBatch(medicine.id, owned, businessDate);
      const sellableStock = owned
        .filter((batch) => isBatchSellable(batch, businessDate))
        .reduce((sum, batch) => sum + batch.quantityAvailable, 0);
      const hasPhysical = owned.some((batch) => batch.quantityAvailable > 0);
      const disabledReason = medicine.isDeleted
        ? "Medicine is archived"
        : !hasPhysical
          ? "Out of stock"
          : !active
            ? "Only expired stock available"
            : null;
      return {
        medicineId: medicine.id,
        name: medicine.name,
        barcode: medicine.barcode ?? normalized,
        sellableStock,
        activeBatchId: active?.id ?? null,
        effectiveUnitPrice: active
          ? effectiveUnitPrice(
              active.salePrice,
              active.expiryDate !== null &&
                businessDateDifference(active.expiryDate, businessDate) <=
                  farDays
                ? (promotionByBatch.get(active.id) ?? 0)
                : 0,
            )
          : null,
        disabledReason,
      };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.medicineId.localeCompare(b.medicineId),
    );
}

export interface UpdateMedicineInput {
  shopId: string;
  actorUserId: string;
  medicineId: string;
  isStillActive: () => boolean;
  values: Partial<
    Pick<
      CreateMedicineInput,
      | "name"
      | "generic"
      | "manufacturer"
      | "strength"
      | "category"
      | "unitOfMeasure"
      | "requiresPrescription"
      | "barcode"
    >
  > & {
    lowStockThresholdOverride?: number | null;
  };
}

export async function updateMedicine(
  input: UpdateMedicineInput,
): Promise<void> {
  await requirePermission(input.shopId, input.actorUserId, "inventory_edit");
  if (input.values.name !== undefined && input.values.name.trim().length < 2) {
    throw new Error("Medicine name is too short");
  }
  if (
    input.values.lowStockThresholdOverride !== undefined &&
    input.values.lowStockThresholdOverride !== null &&
    (!Number.isInteger(input.values.lowStockThresholdOverride) ||
      input.values.lowStockThresholdOverride < 0)
  ) {
    throw new Error("Low-stock override must be a non-negative integer");
  }
  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    const values = stampUpdatedAt({ ...input.values, isDirty: true });
    const result = tx
      .update(medicines)
      .set(values)
      .where(
        and(
          eq(medicines.id, input.medicineId),
          eq(medicines.shopId, input.shopId),
          eq(medicines.isDeleted, false),
        ),
      )
      .run();
    if (result.changes !== 1) throw new Error("Medicine not found");
    recordChange(tx, {
      shopId: input.shopId,
      table: "medicines",
      rowId: input.medicineId,
      op: "update",
      payload: values,
    });
  });
}

export interface UpdateBatchInput {
  shopId: string;
  actorUserId: string;
  batchId: string;
  isStillActive: () => boolean;
  values: Partial<{
    batchNo: string;
    expiryDate: string | null;
    purchasePrice: Paisa;
    salePrice: Paisa;
  }>;
}

export async function updateBatch(input: UpdateBatchInput): Promise<void> {
  await requirePermission(input.shopId, input.actorUserId, "inventory_edit");
  if (input.values.batchNo !== undefined && !input.values.batchNo.trim())
    throw new Error("Batch number is required");
  if (input.values.expiryDate) assertIsoDate(input.values.expiryDate);
  if (
    input.values.purchasePrice !== undefined &&
    (!Number.isSafeInteger(input.values.purchasePrice) ||
      input.values.purchasePrice < 0)
  ) {
    throw new Error(
      "Purchase price must be a non-negative integer paisa amount",
    );
  }
  if (
    input.values.salePrice !== undefined &&
    (!Number.isSafeInteger(input.values.salePrice) ||
      input.values.salePrice < 0)
  ) {
    throw new Error("Sale price must be a non-negative integer paisa amount");
  }
  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    const values = stampUpdatedAt({ ...input.values, isDirty: true });
    const result = tx
      .update(batches)
      .set(values)
      .where(
        and(
          eq(batches.id, input.batchId),
          eq(batches.shopId, input.shopId),
          eq(batches.isDeleted, false),
        ),
      )
      .run();
    if (result.changes !== 1) throw new Error("Batch not found");
    recordChange(tx, {
      shopId: input.shopId,
      table: "batches",
      rowId: input.batchId,
      op: "update",
      payload: values,
    });
  });
}

export async function adjustBatchStock(input: {
  shopId: string;
  actorUserId: string;
  batchId: string;
  changeQty: number;
  reason: string;
  kind?: "adjustment" | "expiry_disposal" | "reconciliation";
  isStillActive: () => boolean;
}): Promise<void> {
  await requirePermission(input.shopId, input.actorUserId, "inventory_edit");
  if (input.kind === "expiry_disposal")
    await requirePermission(input.shopId, input.actorUserId, "expiry_manage");
  if (!input.reason.trim())
    throw new Error("Stock adjustment reason is required");
  if (!Number.isInteger(input.changeQty) || input.changeQty === 0)
    throw new Error("Stock adjustment must be a non-zero integer");
  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    const batch = tx
      .select({ stock: batches.stock, oversoldAt: batches.oversoldAt })
      .from(batches)
      .where(
        and(
          eq(batches.id, input.batchId),
          eq(batches.shopId, input.shopId),
          eq(batches.isDeleted, false),
        ),
      )
      .get();
    if (!batch) throw new Error("Batch not found");
    if (batch.stock + input.changeQty < 0)
      throw new Error("Adjustment cannot make local stock negative");
    const movementId = adjustStock(tx, {
      shopId: input.shopId,
      batchId: input.batchId,
      changeQty: input.changeQty,
      reason: input.kind ?? "adjustment",
      createdBy: input.actorUserId,
    });
    if (
      input.kind === "reconciliation" &&
      batch.stock + input.changeQty >= 0 &&
      batch.oversoldAt
    ) {
      const values = stampUpdatedAt({ oversoldAt: null, isDirty: true });
      tx.update(batches).set(values).where(eq(batches.id, input.batchId)).run();
      recordChange(tx, {
        shopId: input.shopId,
        table: "batches",
        rowId: input.batchId,
        op: "update",
        payload: values,
      });
    }
    const auditId = generateId();
    const now = new Date().toISOString();
    const values = {
      id: auditId,
      shopId: input.shopId,
      actorId: input.actorUserId,
      action: "stock_adjusted",
      target: input.batchId,
      meta: JSON.stringify({
        movementId,
        changeQty: input.changeQty,
        reason: input.reason,
      }),
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(auditLogs).values(values).run();
    recordChange(tx, {
      shopId: input.shopId,
      table: "audit_logs",
      rowId: auditId,
      op: "insert",
      payload: values,
    });
  });
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertBatchArchivable(
  tx: DbTransaction,
  shopId: string,
  batchId: string,
): void {
  const batch = tx
    .select({ stock: batches.stock, oversoldAt: batches.oversoldAt })
    .from(batches)
    .where(and(eq(batches.id, batchId), eq(batches.shopId, shopId)))
    .get();
  if (!batch) throw new Error("Batch not found");
  const promotion = tx
    .select({ id: batchPromotions.id })
    .from(batchPromotions)
    .where(
      and(
        eq(batchPromotions.shopId, shopId),
        eq(batchPromotions.batchId, batchId),
        eq(batchPromotions.isActive, true),
        eq(batchPromotions.isDeleted, false),
      ),
    )
    .get();
  if (batch.stock !== 0 || batch.oversoldAt || promotion)
    throw new Error(
      "Batch must have zero stock, no oversell, and no active promotion",
    );
}

export async function archiveBatch(
  shopId: string,
  actorUserId: string,
  batchId: string,
  isStillActive: () => boolean,
): Promise<void> {
  await requirePermission(shopId, actorUserId, "inventory_edit");
  db.transaction((tx) => {
    assertSessionLive(isStillActive);
    assertBatchArchivable(tx, shopId, batchId);
    const values = stampUpdatedAt({
      isDeleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy: actorUserId,
      isDirty: true,
    });
    tx.update(batches)
      .set(values)
      .where(and(eq(batches.id, batchId), eq(batches.shopId, shopId)))
      .run();
    recordChange(tx, {
      shopId,
      table: "batches",
      rowId: batchId,
      op: "delete",
      payload: values,
    });
  });
}

export async function archiveMedicine(
  shopId: string,
  actorUserId: string,
  medicineId: string,
  isStillActive: () => boolean,
): Promise<void> {
  await requirePermission(shopId, actorUserId, "inventory_edit");
  db.transaction((tx) => {
    assertSessionLive(isStillActive);
    const children = tx
      .select({ id: batches.id })
      .from(batches)
      .where(
        and(eq(batches.shopId, shopId), eq(batches.medicineId, medicineId)),
      )
      .all();
    children.forEach((child) => assertBatchArchivable(tx, shopId, child.id));
    const values = stampUpdatedAt({
      isDeleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy: actorUserId,
      isDirty: true,
    });
    const result = tx
      .update(medicines)
      .set(values)
      .where(
        and(
          eq(medicines.id, medicineId),
          eq(medicines.shopId, shopId),
          eq(medicines.isDeleted, false),
        ),
      )
      .run();
    if (result.changes !== 1) throw new Error("Medicine not found");
    recordChange(tx, {
      shopId,
      table: "medicines",
      rowId: medicineId,
      op: "delete",
      payload: values,
    });
  });
}

export async function setBatchPromotion(input: {
  shopId: string;
  actorUserId: string;
  batchId: string;
  discountBps: number;
  isStillActive: () => boolean;
  now?: Date;
}): Promise<{ promotionId: string }> {
  await requirePermission(input.shopId, input.actorUserId, "expiry_manage");
  await requirePermission(input.shopId, input.actorUserId, "sale_discount");
  if (
    !Number.isInteger(input.discountBps) ||
    input.discountBps <= 0 ||
    input.discountBps > 10_000
  )
    throw new Error("Promotion must be 1–10000 basis points");
  const row = db
    .select({ expiryDate: batches.expiryDate })
    .from(batches)
    .where(
      and(
        eq(batches.id, input.batchId),
        eq(batches.shopId, input.shopId),
        eq(batches.isDeleted, false),
      ),
    )
    .get();
  if (!row?.expiryDate) throw new Error("Promotion requires a dated batch");
  const settings = db
    .select({
      near: shopB2Settings.expiryNearDays,
      far: shopB2Settings.expiryFarDays,
    })
    .from(shopB2Settings)
    .where(
      and(
        eq(shopB2Settings.shopId, input.shopId),
        eq(shopB2Settings.isDeleted, false),
      ),
    )
    .get();
  const band = expiryBand(
    businessDateDifference(
      row.expiryDate,
      dhakaBusinessDate(input.now ?? new Date()),
    ),
    settings?.near,
    settings?.far,
  );
  if (band !== "near" && band !== "far")
    throw new Error(
      "Promotion is allowed only for non-expired Near/Far batches",
    );
  const promotionId = generateId();
  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    const existing = tx
      .select({ id: batchPromotions.id })
      .from(batchPromotions)
      .where(
        and(
          eq(batchPromotions.shopId, input.shopId),
          eq(batchPromotions.batchId, input.batchId),
          eq(batchPromotions.isActive, true),
          eq(batchPromotions.isDeleted, false),
        ),
      )
      .get();
    const now = new Date().toISOString();
    if (existing) {
      const values = stampUpdatedAt({
        isActive: false,
        reversedAt: now,
        reversedBy: input.actorUserId,
        isDirty: true,
      });
      tx.update(batchPromotions)
        .set(values)
        .where(eq(batchPromotions.id, existing.id))
        .run();
      recordChange(tx, {
        shopId: input.shopId,
        table: "batch_promotions",
        rowId: existing.id,
        op: "update",
        payload: values,
      });
    }
    const values = {
      id: promotionId,
      shopId: input.shopId,
      batchId: input.batchId,
      discountBps: input.discountBps,
      isActive: true,
      createdBy: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(batchPromotions).values(values).run();
    recordChange(tx, {
      shopId: input.shopId,
      table: "batch_promotions",
      rowId: promotionId,
      op: "insert",
      payload: values,
    });
  });
  return { promotionId };
}

export async function reverseBatchPromotion(
  shopId: string,
  actorUserId: string,
  batchId: string,
  isStillActive: () => boolean,
): Promise<void> {
  await requirePermission(shopId, actorUserId, "expiry_manage");
  await requirePermission(shopId, actorUserId, "sale_discount");
  db.transaction((tx) => {
    assertSessionLive(isStillActive);
    const promotion = tx
      .select({ id: batchPromotions.id })
      .from(batchPromotions)
      .where(
        and(
          eq(batchPromotions.shopId, shopId),
          eq(batchPromotions.batchId, batchId),
          eq(batchPromotions.isActive, true),
          eq(batchPromotions.isDeleted, false),
        ),
      )
      .get();
    if (!promotion) throw new Error("Active promotion not found");
    const values = stampUpdatedAt({
      isActive: false,
      reversedAt: new Date().toISOString(),
      reversedBy: actorUserId,
      isDirty: true,
    });
    tx.update(batchPromotions)
      .set(values)
      .where(eq(batchPromotions.id, promotion.id))
      .run();
    recordChange(tx, {
      shopId,
      table: "batch_promotions",
      rowId: promotion.id,
      op: "update",
      payload: values,
    });
  });
}

export async function setBulkBatchPromotion(input: {
  shopId: string;
  actorUserId: string;
  batchIds: string[];
  discountBps: number;
  isStillActive: () => boolean;
  now?: Date;
}): Promise<number> {
  await requirePermission(input.shopId, input.actorUserId, "expiry_manage");
  await requirePermission(input.shopId, input.actorUserId, "sale_discount");
  if (
    !Number.isInteger(input.discountBps) ||
    input.discountBps <= 0 ||
    input.discountBps > 10_000
  )
    throw new Error("Promotion must be 1–10000 basis points");
  const uniqueIds = [...new Set(input.batchIds)];
  if (!uniqueIds.length) throw new Error("No eligible batches selected");
  const settings = db
    .select({
      near: shopB2Settings.expiryNearDays,
      far: shopB2Settings.expiryFarDays,
    })
    .from(shopB2Settings)
    .where(
      and(
        eq(shopB2Settings.shopId, input.shopId),
        eq(shopB2Settings.isDeleted, false),
      ),
    )
    .get();
  const businessDate = dhakaBusinessDate(input.now ?? new Date());
  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    for (const batchId of uniqueIds) {
      const row = tx
        .select({ expiryDate: batches.expiryDate })
        .from(batches)
        .where(
          and(
            eq(batches.id, batchId),
            eq(batches.shopId, input.shopId),
            eq(batches.isDeleted, false),
          ),
        )
        .get();
      const band = row?.expiryDate
        ? expiryBand(
            businessDateDifference(row.expiryDate, businessDate),
            settings?.near,
            settings?.far,
          )
        : "unknown";
      if (band !== "near" && band !== "far")
        throw new Error("Bulk promotion contains an ineligible batch");
      const existing = tx
        .select({ id: batchPromotions.id })
        .from(batchPromotions)
        .where(
          and(
            eq(batchPromotions.shopId, input.shopId),
            eq(batchPromotions.batchId, batchId),
            eq(batchPromotions.isActive, true),
            eq(batchPromotions.isDeleted, false),
          ),
        )
        .get();
      const timestamp = new Date().toISOString();
      if (existing) {
        const reversed = stampUpdatedAt({
          isActive: false,
          reversedAt: timestamp,
          reversedBy: input.actorUserId,
          isDirty: true,
        });
        tx.update(batchPromotions)
          .set(reversed)
          .where(eq(batchPromotions.id, existing.id))
          .run();
        recordChange(tx, {
          shopId: input.shopId,
          table: "batch_promotions",
          rowId: existing.id,
          op: "update",
          payload: reversed,
        });
      }
      const id = generateId();
      const values = {
        id,
        shopId: input.shopId,
        batchId,
        discountBps: input.discountBps,
        isActive: true,
        createdBy: input.actorUserId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      tx.insert(batchPromotions).values(values).run();
      recordChange(tx, {
        shopId: input.shopId,
        table: "batch_promotions",
        rowId: id,
        op: "insert",
        payload: values,
      });
    }
  });
  return uniqueIds.length;
}
