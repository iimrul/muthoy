import { and, eq } from "drizzle-orm";
import {
  MAX_INVENTORY_CSV_ROWS,
  parseCsv,
  parseTakaTextToPaisa,
  assertIsoDate,
} from "@muthoy/utils";
import type { Paisa } from "@muthoy/types";
import { requireOwner } from "./auth";
import { db } from "./client";
import { assertSessionLive } from "./errors";
import { auditLogs, batches, inventoryImports, medicines } from "./schema";
import { addStock } from "./stockLedger";
import { recordChange, type SyncOperationGroup } from "./sync-helpers";
import { generateId } from "../native/id";
import { searchKeyFor } from "./medicineSearchKeyBackfill";
import { normalizeDosageForm } from "../domain/dosageForm";
import {
  InventoryCsvError,
  type InventoryCsvIssue,
  type InventoryCsvIssueCode,
} from "../domain/inventoryCsvIssue";

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

/** "Batch No", "batch-no" and "expiry_date (YYYY-MM-DD)" all name one column. */
function normalizedHeader(value: string): string {
  return normalized(value)
    .replace(/\s*\(.*?\)\s*/g, "")
    .replace(/[\s-]+/g, "_");
}

export { InventoryCsvError } from "../domain/inventoryCsvIssue";
export type { InventoryCsvIssue, InventoryCsvIssueCode } from "../domain/inventoryCsvIssue";

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

/** The template ships example rows with batch "EXAMPLE-…": never stock. */
const EXAMPLE_BATCH = /^example/i;
const TEXT_COLUMNS = ["name", "generic", "manufacturer", "batch_no"] as const;

type CellReader = (column: string) => string;

function wholeNumber(text: string): number | null {
  const value = Number(text);
  return /^\d+$/.test(text) && Number.isSafeInteger(value) ? value : null;
}

function takaOrNull(text: string): Paisa | null {
  try {
    return parseTakaTextToPaisa(text);
  } catch {
    return null;
  }
}

function isIsoDate(text: string): boolean {
  try {
    assertIsoDate(text);
    return true;
  } catch {
    return false;
  }
}

/** One data row: the row, or every problem with it. */
function parseRow(
  rowNumber: number,
  cell: CellReader,
): { row: ParsedImportRow | null; issues: InventoryCsvIssue[] } {
  const issues: InventoryCsvIssue[] = [];
  const flag = (code: InventoryCsvIssueCode, column?: string) =>
    issues.push(column ? { rowNumber, code, column } : { rowNumber, code });
  for (const column of TEXT_COLUMNS) if (!cell(column)) flag("missing_text", column);
  if (EXAMPLE_BATCH.test(cell("batch_no"))) flag("example_row");
  const stock = wholeNumber(cell("stock"));
  if (stock === null) flag("bad_stock", "stock");
  const purchasePrice = takaOrNull(cell("purchase_price"));
  if (purchasePrice === null) flag("bad_price", "purchase_price");
  const salePrice = takaOrNull(cell("sale_price"));
  if (salePrice === null) flag("bad_price", "sale_price");
  const expiryDate = cell("expiry_date") || cell("expiry") || null;
  if (expiryDate && !isIsoDate(expiryDate)) flag("bad_expiry", "expiry_date");
  const thresholdText = cell("low_stock_threshold") || cell("threshold");
  const threshold = thresholdText ? wholeNumber(thresholdText) : null;
  if (thresholdText && threshold === null) flag("bad_threshold", "threshold");
  if (issues.length > 0 || stock === null || purchasePrice === null || salePrice === null) {
    return { row: null, issues };
  }
  return {
    row: {
      rowNumber,
      name: cell("name"),
      generic: cell("generic"),
      manufacturer: cell("manufacturer"),
      batchNo: cell("batch_no"),
      stock,
      purchasePrice,
      salePrice,
      // Stored as the canonical key the picker writes ("Tab" -> "tablet").
      type: normalizeDosageForm(cell("type")),
      expiryDate,
      lowStockThresholdOverride: threshold,
      barcode: cell("barcode") || null,
      unitOfMeasure: cell("unit") || cell("unit_of_measure") || "piece",
    },
    issues,
  };
}

/**
 * Every valid row plus every row problem. Only a file that cannot be read as
 * an inventory sheet at all (no rows, missing columns) throws straight away.
 * Blank lines — Excel leaves them — are skipped without shifting row numbers.
 */
/** The shared parser's refusals, as issues the screen can explain. */
function readCsvRows(text: string): string[][] {
  try {
    return parseCsv(text, MAX_INVENTORY_CSV_ROWS, { keepBlankRows: true, allowRaggedRows: true });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    const code: InventoryCsvIssueCode = message.includes("MiB")
      ? "too_large"
      : message.includes("data rows")
        ? "too_many_rows"
        : "unclosed_quote";
    throw new InventoryCsvError([{ rowNumber: null, code }]);
  }
}

function parseInventoryCsv(text: string): { rows: ParsedImportRow[]; issues: InventoryCsvIssue[] } {
  const lines = readCsvRows(text);
  // The header is the first non-blank line; every row keeps its sheet number.
  const headerAt = lines.findIndex((cells) => cells.length > 0);
  const header = (lines[headerAt] ?? []).map(normalizedHeader);
  const data = lines
    .map((cells, index) => ({ cells, rowNumber: index + 1 }))
    .slice(headerAt + 1)
    .filter(({ cells }) => cells.some((value) => value.trim() !== ""));
  if (data.length === 0) throw new InventoryCsvError([{ rowNumber: null, code: "no_rows" }]);
  const named = header.filter(Boolean);
  const fileIssues: InventoryCsvIssue[] =
    new Set(named).size === named.length ? [] : [{ rowNumber: null, code: "duplicate_headers" }];
  for (const column of REQUIRED_HEADERS) {
    if (!header.includes(column)) fileIssues.push({ rowNumber: null, code: "missing_column", column });
  }
  if (fileIssues.length > 0) throw new InventoryCsvError(fileIssues);

  const rows: ParsedImportRow[] = [];
  const issues: InventoryCsvIssue[] = [];
  const seen = new Set<string>();
  for (const { cells, rowNumber } of data) {
    // A filled cell past the last header means a name's comma split the row;
    // every cell after it would land in the wrong column.
    if (cells.slice(header.length).some((value) => value.trim() !== "")) {
      issues.push({ rowNumber, code: "uneven_columns" });
      continue;
    }
    const cell: CellReader = (column) => {
      const at = header.indexOf(column);
      return at < 0 ? "" : (cells[at]?.trim() ?? "");
    };
    const parsed = parseRow(rowNumber, cell);
    issues.push(...parsed.issues);
    if (!parsed.row) continue;
    const { name, generic, manufacturer, batchNo } = parsed.row;
    const identity = [name, generic, manufacturer, batchNo].map(normalized).join("|");
    if (seen.has(identity)) {
      issues.push({ rowNumber, code: "duplicate_row" });
      continue;
    }
    seen.add(identity);
    rows.push(parsed.row);
  }
  return { rows, issues };
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
): { rows: InventoryImportPreviewRow[]; issues: InventoryCsvIssue[] } {
  const proposed = new Set<string>();
  const issues: InventoryCsvIssue[] = [];
  const rows = parsed.flatMap((row) => {
    const matches = existingMedicines.filter(
      (medicine) =>
        normalized(medicine.name) === normalized(row.name) &&
        normalized(medicine.generic ?? "") === normalized(row.generic) &&
        normalized(medicine.manufacturer ?? "") ===
          normalized(row.manufacturer),
    );
    if (matches.length > 1) {
      issues.push({ rowNumber: row.rowNumber, code: "ambiguous_medicine" });
      return [];
    }
    const match = matches[0];
    if (
      match &&
      existingBatches.some(
        (batch) =>
          batch.medicineId === match.id &&
          normalized(batch.batchNo) === normalized(row.batchNo),
      )
    ) {
      issues.push({ rowNumber: row.rowNumber, code: "batch_exists", column: "batch_no" });
      return [];
    }
    const medicineKey = `${normalized(row.name)}|${normalized(row.generic)}|${normalized(row.manufacturer)}`;
    const action =
      match || proposed.has(medicineKey)
        ? ("add_batch" as const)
        : ("create_medicine" as const);
    proposed.add(medicineKey);
    return [{ ...row, action, medicineId: match?.id ?? null, medicineKey }];
  });
  return { rows, issues };
}

/** Parse and resolve; any problem anywhere refuses the whole file, listing all of them. */
function validatedRows(
  text: string,
  existingMedicines: ExistingMedicine[],
  existingBatches: ExistingBatch[],
): InventoryImportPreviewRow[] {
  const parsed = parseInventoryCsv(text);
  const resolved = resolveRows(parsed.rows, existingMedicines, existingBatches);
  const issues = [...parsed.issues, ...resolved.issues].sort(
    (a, b) => (a.rowNumber ?? 0) - (b.rowNumber ?? 0),
  );
  if (issues.length > 0) throw new InventoryCsvError(issues);
  return resolved.rows;
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
    rows: validatedRows(text, existingMedicines, existingBatches),
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
  const importId = generateId();
  let rowCount = 0;
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
    const resolved = validatedRows(text, existingMedicines, existingBatches);
    rowCount = resolved.length;
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
  return { importId, rowCount };
}
