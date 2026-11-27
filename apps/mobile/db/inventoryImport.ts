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
import { readImportedBarcode, unwrapExcelText } from "../domain/importedBarcode";
import {
  InventoryCsvError,
  quotedCell,
  type InventoryCsvIssue,
  type InventoryCsvIssueCode,
  type InventoryCsvWarning,
} from "../domain/inventoryCsvIssue";
import {
  csvMedicineKey,
  matchCsvRows,
  type ExistingBatchForMatch,
  type ExistingMedicineForMatch,
  type MatchedRow,
} from "../domain/inventoryCsvMatch";

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
export type { InventoryCsvIssue, InventoryCsvIssueCode, InventoryCsvWarning } from "../domain/inventoryCsvIssue";

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
  // Every problem names its column AND quotes what the cell held, so the
  // owner can find it in the sheet without hunting.
  const flag = (code: InventoryCsvIssueCode, column?: string, text?: string) => {
    const value = text === undefined ? undefined : quotedCell(text);
    issues.push({ rowNumber, code, ...(column ? { column } : {}), ...(value ? { value } : {}) });
  };
  for (const column of TEXT_COLUMNS) if (!cell(column)) flag("missing_text", column);
  if (EXAMPLE_BATCH.test(cell("batch_no"))) flag("example_row", "batch_no", cell("batch_no"));
  const stock = wholeNumber(cell("stock"));
  if (stock === null) flag("bad_stock", "stock", cell("stock"));
  const purchasePrice = takaOrNull(cell("purchase_price"));
  if (purchasePrice === null) flag("bad_price", "purchase_price", cell("purchase_price"));
  const salePrice = takaOrNull(cell("sale_price"));
  if (salePrice === null) flag("bad_price", "sale_price", cell("sale_price"));
  const expiryDate = cell("expiry_date") || cell("expiry") || null;
  if (expiryDate && !isIsoDate(expiryDate)) flag("bad_expiry", "expiry_date", expiryDate);
  const thresholdText = cell("low_stock_threshold") || cell("threshold");
  const threshold = thresholdText ? wholeNumber(thresholdText) : null;
  if (thresholdText && threshold === null) flag("bad_threshold", "threshold", thresholdText);
  const barcode = readImportedBarcode(cell("barcode"));
  if (barcode.isLost) flag("bad_barcode", "barcode", cell("barcode"));
  if (issues.length > 0 || stock === null || purchasePrice === null || salePrice === null || barcode.isLost) {
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
      barcode: barcode.value,
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

function parseInventoryCsv(text: string): { rows: ParsedImportRow[]; issues: InventoryCsvIssue[]; rowCount: number } {
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
    // Excel's ="0123" (how a sheet keeps leading zeros) reads as 0123 everywhere.
    const cell: CellReader = (column) => {
      const at = header.indexOf(column);
      return at < 0 ? "" : unwrapExcelText(cells[at] ?? "");
    };
    const medicineName = quotedCell(cell("name"));
    const named = (issue: InventoryCsvIssue): InventoryCsvIssue =>
      medicineName ? { ...issue, medicineName } : issue;
    // A filled cell past the last header means a name's comma split the row;
    // every cell after it would land in the wrong column.
    if (cells.slice(header.length).some((value) => value.trim() !== "")) {
      issues.push(named({ rowNumber, code: "uneven_columns" }));
      continue;
    }
    const parsed = parseRow(rowNumber, cell);
    issues.push(...parsed.issues.map(named));
    if (!parsed.row) continue;
    const identity = `${csvMedicineKey(parsed.row)}|${normalized(parsed.row.batchNo)}`;
    if (seen.has(identity)) {
      issues.push(named({ rowNumber, code: "duplicate_row", column: "batch_no", value: parsed.row.batchNo }));
      continue;
    }
    seen.add(identity);
    rows.push(parsed.row);
  }
  return { rows, issues, rowCount: data.length };
}

export type InventoryImportPreviewRow = MatchedRow<ParsedImportRow>;

/**
 * Parse and match (domain/inventoryCsvMatch.ts); any problem anywhere refuses
 * the whole file, listing all of them, in sheet order. Warnings never refuse.
 */
function validatedRows(
  text: string,
  existingMedicines: readonly ExistingMedicineForMatch[],
  existingBatches: readonly ExistingBatchForMatch[],
): { rows: InventoryImportPreviewRow[]; warnings: InventoryCsvWarning[] } {
  const parsed = parseInventoryCsv(text);
  const matched = matchCsvRows(parsed.rows, existingMedicines, existingBatches);
  const issues = [...parsed.issues, ...matched.issues].sort(
    (a, b) => (a.rowNumber ?? 0) - (b.rowNumber ?? 0),
  );
  if (issues.length > 0) throw new InventoryCsvError(issues, parsed.rowCount);
  return { rows: matched.rows, warnings: matched.warnings };
}

const EXISTING_MEDICINE_COLUMNS = {
  id: medicines.id,
  name: medicines.name,
  generic: medicines.generic,
  manufacturer: medicines.manufacturer,
  type: medicines.type,
};

export async function previewInventoryCsv(
  shopId: string,
  actorUserId: string,
  text: string,
): Promise<{
  fingerprint: string;
  rows: InventoryImportPreviewRow[];
  warnings: InventoryCsvWarning[];
}> {
  await requireOwner(shopId, actorUserId);
  const existingMedicines = db
    .select(EXISTING_MEDICINE_COLUMNS)
    .from(medicines)
    .where(and(eq(medicines.shopId, shopId), eq(medicines.isDeleted, false)))
    .all();
  const existingBatches = db
    .select({ medicineId: batches.medicineId, batchNo: batches.batchNo })
    .from(batches)
    .where(eq(batches.shopId, shopId))
    .all();
  const { rows, warnings } = validatedRows(text, existingMedicines, existingBatches);
  return { fingerprint: fingerprintCsv(text), rows, warnings };
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
      .select(EXISTING_MEDICINE_COLUMNS)
      .from(medicines)
      .where(and(eq(medicines.shopId, shopId), eq(medicines.isDeleted, false)))
      .all();
    const existingBatches = tx
      .select({ medicineId: batches.medicineId, batchNo: batches.batchNo })
      .from(batches)
      .where(eq(batches.shopId, shopId))
      .all();
    const resolved = validatedRows(text, existingMedicines, existingBatches).rows;
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
