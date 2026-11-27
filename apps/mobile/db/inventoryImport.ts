import { and, eq } from "drizzle-orm";
import { parseCsv, parseTakaTextToPaisa, assertIsoDate } from "@muthoy/utils";
import type { Paisa } from "@muthoy/types";
import { requireOwner, requirePermission } from "./auth";
import { db } from "./client";
import { permissionForDataGate } from "./dataAccessGates";
import { assertSessionLive } from "./errors";
import { assertInventoryAddInTransaction } from "./inventoryAddGate";
import { auditLogs, batches, inventoryImports, medicines } from "./schema";
import { addStock } from "./stockLedger";
import { recordChange, type SyncOperationGroup } from "./sync-helpers";
import { generateId } from "../native/id";
import { searchKeyFor } from "./medicineSearchKeyBackfill";

const REQUIRED_HEADERS = [
  "name",
  "generic",
  "manufacturer",
  "batch_no",
  "stock",
  "purchase_price",
  "sale_price",
] as const;

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function fingerprintCsv(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

interface ParsedImportRow {
  rowNumber: number;
  name: string;
  generic: string;
  manufacturer: string;
  batchNo: string;
  stock: number;
  purchasePrice: Paisa;
  salePrice: Paisa;
  type: string | null;
  expiryDate: string | null;
  lowStockThresholdOverride: number | null;
  barcode: string | null;
  unitOfMeasure: string;
}

function parseInventoryCsv(text: string): ParsedImportRow[] {
  const rows = parseCsv(text);
  const header = rows[0]?.map(normalized) ?? [];
  if (rows.length < 2)
    throw new Error("CSV must contain at least one data row");
  if (new Set(header).size !== header.length)
    throw new Error("CSV contains duplicate column headers");
  for (const required of REQUIRED_HEADERS) {
    if (!header.includes(required))
      throw new Error(`CSV is missing required column: ${required}`);
  }
  const index = (name: string) => header.indexOf(name);
  const cell = (row: string[], name: string) =>
    index(name) < 0 ? "" : (row[index(name)]?.trim() ?? "");
  const seen = new Set<string>();
  return rows.slice(1).map((row, offset) => {
    const rowNumber = offset + 2;
    const name = cell(row, "name");
    const generic = cell(row, "generic");
    const manufacturer = cell(row, "manufacturer");
    const batchNo = cell(row, "batch_no");
    if (!name || !generic || !manufacturer || !batchNo)
      throw new Error(`Row ${rowNumber}: required text is missing`);
    const stockText = cell(row, "stock");
    if (!/^\d+$/.test(stockText))
      throw new Error(`Row ${rowNumber}: stock must be a non-negative integer`);
    const stock = Number(stockText);
    if (!Number.isSafeInteger(stock))
      throw new Error(`Row ${rowNumber}: stock is too large`);
    const expiryDate = cell(row, "expiry_date") || cell(row, "expiry") || null;
    if (expiryDate) assertIsoDate(expiryDate);
    const thresholdText =
      cell(row, "low_stock_threshold") || cell(row, "threshold");
    const lowStockThresholdOverride = thresholdText
      ? Number(thresholdText)
      : null;
    if (
      thresholdText &&
      (!/^\d+$/.test(thresholdText) ||
        !Number.isSafeInteger(lowStockThresholdOverride))
    ) {
      throw new Error(
        `Row ${rowNumber}: threshold must be a non-negative integer`,
      );
    }
    const identity = `${normalized(name)}|${normalized(generic)}|${normalized(manufacturer)}|${normalized(batchNo)}`;
    if (seen.has(identity))
      throw new Error(`Row ${rowNumber}: duplicate medicine/batch row`);
    seen.add(identity);
    return {
      rowNumber,
      name,
      generic,
      manufacturer,
      batchNo,
      stock,
      purchasePrice: parseTakaTextToPaisa(cell(row, "purchase_price")),
      salePrice: parseTakaTextToPaisa(cell(row, "sale_price")),
      type: cell(row, "type") || null,
      expiryDate,
      lowStockThresholdOverride,
      barcode: cell(row, "barcode") || null,
      unitOfMeasure:
        cell(row, "unit") || cell(row, "unit_of_measure") || "piece",
    };
  });
}

export interface InventoryImportPreviewRow extends ParsedImportRow {
  action: "create_medicine" | "add_batch";
  medicineId: string | null;
  medicineKey: string;
}

type ExistingMedicine = Pick<
  typeof medicines.$inferSelect,
  "id" | "name" | "generic" | "manufacturer"
>;
type ExistingBatch = Pick<
  typeof batches.$inferSelect,
  "medicineId" | "batchNo"
>;

function resolveRows(
  parsed: ParsedImportRow[],
  existingMedicines: ExistingMedicine[],
  existingBatches: ExistingBatch[],
): InventoryImportPreviewRow[] {
  const proposed = new Set<string>();
  return parsed.map((row) => {
    const matches = existingMedicines.filter(
      (medicine) =>
        normalized(medicine.name) === normalized(row.name) &&
        normalized(medicine.generic ?? "") === normalized(row.generic) &&
        normalized(medicine.manufacturer ?? "") ===
          normalized(row.manufacturer),
    );
    if (matches.length > 1)
      throw new Error(`Row ${row.rowNumber}: medicine match is ambiguous`);
    const match = matches[0];
    if (
      match &&
      existingBatches.some(
        (batch) =>
          batch.medicineId === match.id &&
          normalized(batch.batchNo) === normalized(row.batchNo),
      )
    ) {
      throw new Error(`Row ${row.rowNumber}: batch already exists`);
    }
    const medicineKey = `${normalized(row.name)}|${normalized(row.generic)}|${normalized(row.manufacturer)}`;
    const action =
      match || proposed.has(medicineKey)
        ? ("add_batch" as const)
        : ("create_medicine" as const);
    proposed.add(medicineKey);
    return { ...row, action, medicineId: match?.id ?? null, medicineKey };
  });
}

export async function previewInventoryCsv(
  shopId: string,
  actorUserId: string,
  text: string,
): Promise<{
  fingerprint: string;
  rows: InventoryImportPreviewRow[];
}> {
  await requireOwner(shopId, actorUserId);
  const existingMedicines = db
    .select({
      id: medicines.id,
      name: medicines.name,
      generic: medicines.generic,
      manufacturer: medicines.manufacturer,
    })
    .from(medicines)
    .where(and(eq(medicines.shopId, shopId), eq(medicines.isDeleted, false)))
    .all();
  const existingBatches = db
    .select({ medicineId: batches.medicineId, batchNo: batches.batchNo })
    .from(batches)
    .where(eq(batches.shopId, shopId))
    .all();
  return {
    fingerprint: fingerprintCsv(text),
    rows: resolveRows(
      parseInventoryCsv(text),
      existingMedicines,
      existingBatches,
    ),
  };
}

export async function importInventoryCsv(
  shopId: string,
  actorUserId: string,
  text: string,
  confirmedFingerprint: string,
  isStillActive: () => boolean,
): Promise<{ importId: string; rowCount: number }> {
  await requireOwner(shopId, actorUserId);
  const fingerprint = fingerprintCsv(text);
  if (fingerprint !== confirmedFingerprint)
    throw new Error("CSV changed after preview");
  const parsed = parseInventoryCsv(text);
  const importId = generateId();
  db.transaction((tx) => {
    assertSessionLive(isStillActive);
    const existingImport = tx
      .select({ id: inventoryImports.id })
      .from(inventoryImports)
      .where(
        and(
          eq(inventoryImports.shopId, shopId),
          eq(inventoryImports.fileFingerprint, fingerprint),
          eq(inventoryImports.isDeleted, false),
        ),
      )
      .get();
    if (existingImport) throw new Error("This CSV was already imported");
    const existingMedicines = tx
      .select({
        id: medicines.id,
        name: medicines.name,
        generic: medicines.generic,
        manufacturer: medicines.manufacturer,
      })
      .from(medicines)
      .where(and(eq(medicines.shopId, shopId), eq(medicines.isDeleted, false)))
      .all();
    const existingBatches = tx
      .select({ medicineId: batches.medicineId, batchNo: batches.batchNo })
      .from(batches)
      .where(eq(batches.shopId, shopId))
      .all();
    const resolved = resolveRows(parsed, existingMedicines, existingBatches);
    const expectedCount =
      2 +
      resolved.reduce(
        (sum, row) =>
          sum +
          (row.action === "create_medicine" ? 1 : 0) +
          1 +
          (row.stock > 0 ? 1 : 0),
        0,
      );
    let sequence = 0;
    const operation = (): SyncOperationGroup => ({
      id: importId,
      kind: "inventory_import",
      sequence: sequence++,
      expectedCount,
    });
    const now = new Date().toISOString();
    const importValues = {
      id: importId,
      shopId,
      fileFingerprint: fingerprint,
      rowCount: resolved.length,
      status: "committed" as const,
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(inventoryImports).values(importValues).run();
    recordChange(tx, {
      shopId,
      table: "inventory_imports",
      rowId: importId,
      op: "insert",
      payload: importValues,
      operation: operation(),
    });

    const createdMedicineIds = new Map<string, string>();
    for (const row of resolved) {
      const medicineId =
        row.medicineId ??
        createdMedicineIds.get(row.medicineKey) ??
        generateId();
      if (row.action === "create_medicine") {
        createdMedicineIds.set(row.medicineKey, medicineId);
        const medicineValues = {
          id: medicineId,
          shopId,
          name: row.name,
          generic: row.generic,
          // W2-03 (Gate 5 finding 3): an imported medicine is searchable in
          // every script immediately, through the one shared fold.
          searchKey: searchKeyFor({ name: row.name, generic: row.generic }),
          manufacturer: row.manufacturer,
          type: row.type,
          unitOfMeasure: row.unitOfMeasure,
          barcode: row.barcode,
          threshold: row.lowStockThresholdOverride ?? 10,
          lowStockThresholdOverride: row.lowStockThresholdOverride,
          createdAt: now,
          updatedAt: now,
        };
        tx.insert(medicines).values(medicineValues).run();
        recordChange(tx, {
          shopId,
          table: "medicines",
          rowId: medicineId,
          op: "insert",
          payload: medicineValues,
          operation: operation(),
        });
      }
      const batchId = generateId();
      const batchValues = {
        id: batchId,
        shopId,
        medicineId,
        batchNo: row.batchNo,
        expiryDate: row.expiryDate,
        stock: 0,
        purchasePrice: row.purchasePrice,
        salePrice: row.salePrice,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(batches).values(batchValues).run();
      recordChange(tx, {
        shopId,
        table: "batches",
        rowId: batchId,
        op: "insert",
        payload: batchValues,
        operation: operation(),
      });
      if (row.stock > 0) {
        addStock(tx, {
          shopId,
          batchId,
          quantity: row.stock,
          reason: "csv_import",
          refId: importId,
          createdBy: actorUserId,
          operation: operation(),
        });
      }
    }
    const auditId = generateId();
    const auditValues = {
      id: auditId,
      shopId,
      actorId: actorUserId,
      action: "inventory_csv_imported",
      target: importId,
      meta: JSON.stringify({ fingerprint, rowCount: resolved.length }),
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(auditLogs).values(auditValues).run();
    recordChange(tx, {
      shopId,
      table: "audit_logs",
      rowId: auditId,
      op: "insert",
      payload: auditValues,
      operation: operation(),
    });
    if (sequence !== expectedCount)
      throw new Error("Inventory import operation count mismatch");
  });
  return { importId, rowCount: parsed.length };
}

/**
 * Item 12 (founder, 2026-11-27): a supplier is OPTIONAL when adding a medicine.
 * Stock added without one is "opening stock" (আগের মজুদ) — stock the shop
 * already had: no purchase invoice, no supplier due, and NOTHING taken from
 * the cash drawer. It travels as a one-row `inventory_import` operation, the
 * exact graph the server already validates for the Owner's CSV import
 * (header + optional new medicine + batch + one bound `csv_import` movement +
 * one audit row). The Owner, or a staff member holding the explicit
 * inventory_add grant (decision B2): the server accepts exactly this one-row
 * graph from such a staff member from migration 45
 * (20261127000000_staff_opening_stock.sql) — never a CSV file.
 */
export interface OpeningStockInput {
  shopId: string;
  actorUserId: string;
  isStillActive: () => boolean;
  /** Restock an existing medicine; its identity fields are then ignored. */
  existingMedicineId?: string;
  /** Explicit acknowledgement after reviewing same-name shop medicines. */
  confirmDistinctMedicine?: boolean;
  medicine?: {
    name: string;
    generic?: string;
    manufacturer?: string;
    strength?: string;
    type?: string;
    unitOfMeasure: string;
    requiresPrescription: boolean;
    threshold?: number;
  };
  batch: {
    batchNo: string;
    expiryDate: string | null;
    quantity: number;
    purchasePrice: Paisa;
    salePrice: Paisa;
  };
}

export async function createOpeningStock(
  input: OpeningStockInput,
): Promise<{ importId: string; medicineId: string; batchId: string }> {
  await requirePermission(input.shopId, input.actorUserId, permissionForDataGate("inventoryAdd"));
  const { batch } = input;
  if (!Number.isSafeInteger(batch.quantity) || batch.quantity < 1)
    throw new Error("Opening stock quantity must be a positive whole number");
  if (!batch.batchNo.trim()) throw new Error("Batch number is required");
  if (batch.expiryDate) assertIsoDate(batch.expiryDate);
  if (!input.existingMedicineId && !input.medicine?.name.trim())
    throw new Error("Medicine name is required");

  const importId = generateId();
  const batchId = generateId();
  let medicineId = input.existingMedicineId ?? generateId();
  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    // A grant revoked since the guard above must not slip into the outbox.
    assertInventoryAddInTransaction(tx, input.shopId, input.actorUserId);
    if (input.existingMedicineId) {
      const existing = tx
        .select({ id: medicines.id })
        .from(medicines)
        .where(and(
          eq(medicines.id, input.existingMedicineId),
          eq(medicines.shopId, input.shopId),
          eq(medicines.isDeleted, false),
        ))
        .get();
      if (!existing) throw new Error("Medicine does not belong to this shop");
      medicineId = existing.id;
      const duplicate = tx
        .select({ id: batches.id })
        .from(batches)
        .where(and(
          eq(batches.shopId, input.shopId),
          eq(batches.medicineId, medicineId),
          eq(batches.batchNo, batch.batchNo.trim()),
        ))
        .get();
      if (duplicate) throw new Error("This batch already exists for the medicine");
    } else if (!input.confirmDistinctMedicine) {
      // A name is a warning, never proof of identity (same rule as a purchase).
      const sameName = tx
        .select({ id: medicines.id, name: medicines.name })
        .from(medicines)
        .where(and(eq(medicines.shopId, input.shopId), eq(medicines.isDeleted, false)))
        .all()
        .some((row) => normalized(row.name) === normalized(input.medicine!.name));
      if (sameName) throw new Error("Review existing medicines before creating a distinct product");
    }

    const expectedCount = 1 + (input.existingMedicineId ? 0 : 1) + 1 + 1 + 1;
    let sequence = 0;
    const operation = (): SyncOperationGroup => ({
      id: importId,
      kind: "inventory_import",
      sequence: sequence++,
      expectedCount,
    });
    const now = new Date().toISOString();
    const importValues = {
      id: importId,
      shopId: input.shopId,
      // unique(shop_id, file_fingerprint): one opening-stock entry, one key.
      fileFingerprint: `opening:${importId}`,
      rowCount: 1,
      status: "committed" as const,
      createdBy: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(inventoryImports).values(importValues).run();
    recordChange(tx, {
      shopId: input.shopId, table: "inventory_imports", rowId: importId,
      op: "insert", payload: importValues, operation: operation(),
    });

    if (!input.existingMedicineId && input.medicine) {
      const medicine = input.medicine;
      const medicineValues = {
        id: medicineId,
        shopId: input.shopId,
        name: medicine.name.trim(),
        generic: medicine.generic?.trim() || null,
        searchKey: searchKeyFor({ name: medicine.name.trim(), generic: medicine.generic?.trim() || null }),
        manufacturer: medicine.manufacturer?.trim() || null,
        type: medicine.type?.trim() || null,
        strength: medicine.strength?.trim() || null,
        unitOfMeasure: medicine.unitOfMeasure,
        requiresPrescription: medicine.requiresPrescription,
        threshold: medicine.threshold ?? 10,
        lowStockThresholdOverride: medicine.threshold ?? null,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(medicines).values(medicineValues).run();
      recordChange(tx, {
        shopId: input.shopId, table: "medicines", rowId: medicineId,
        op: "insert", payload: medicineValues, operation: operation(),
      });
    }

    const batchValues = {
      id: batchId,
      shopId: input.shopId,
      medicineId,
      batchNo: batch.batchNo.trim(),
      expiryDate: batch.expiryDate,
      stock: 0,
      purchasePrice: batch.purchasePrice,
      salePrice: batch.salePrice,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(batches).values(batchValues).run();
    recordChange(tx, {
      shopId: input.shopId, table: "batches", rowId: batchId,
      op: "insert", payload: batchValues, operation: operation(),
    });
    addStock(tx, {
      shopId: input.shopId,
      batchId,
      quantity: batch.quantity,
      reason: "csv_import",
      refId: importId,
      createdBy: input.actorUserId,
      operation: operation(),
    });

    const auditId = generateId();
    const auditValues = {
      id: auditId,
      shopId: input.shopId,
      actorId: input.actorUserId,
      action: "inventory_opening_stock_added",
      target: importId,
      meta: JSON.stringify({ medicineId, batchId, quantity: batch.quantity }),
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(auditLogs).values(auditValues).run();
    recordChange(tx, {
      shopId: input.shopId, table: "audit_logs", rowId: auditId,
      op: "insert", payload: auditValues, operation: operation(),
    });
    assertSessionLive(input.isStillActive);
    if (sequence !== expectedCount)
      throw new Error("Opening stock operation count mismatch");
  });
  return { importId, medicineId, batchId };
}
