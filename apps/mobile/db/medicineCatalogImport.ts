// W2-02: importing the offline medicine reference catalogue.
//
// JSONL, streamed line by line — NOT CSV via @muthoy/utils' parseCsv.
// That was the plan's first choice and it is impossible: parseCsv enforces
// MAX_INVENTORY_CSV_ROWS = 1000 and MAX_INVENTORY_CSV_BYTES = 2 MiB
// (packages/utils/src/csv.ts:1-5), and a ~21,000-row national catalogue is 21x
// that row cap. Raising the cap would weaken a guard protecting the SHOP
// INVENTORY import path, which is not an acceptable trade for reference data.
// JSONL also needs no quote-aware buffering, so one line is one record and
// retained memory is bounded by the chunk rather than by the file.
//
// Lines arrive through an injected `readLines` async iterable. That keeps this
// module free of native imports (native/README.md: native/ is the ONLY code
// that touches the filesystem) and lets the tests feed 25,000 synthetic rows
// without writing a file.
//
// INVARIANT: this module writes `medicine_catalog` and
// `medicine_catalog_imports` and NOTHING else. It imports no shop table, so a
// shop's medicines, batches and stock cannot be touched even by mistake.

import { sql } from "drizzle-orm";
import { medicineSearchKeys } from "@muthoy/utils";
import { db } from "./client";
import { requireOwner } from "./auth";
import { medicineCatalog, medicineCatalogImports } from "./schema";
import { catalogRowId } from "./medicineCatalog";
import { uuidV5 } from "../domain/deterministicId";
import { generateId } from "../native/id";

/** Rows per transaction. Bounds both retained objects and transaction size. */
const CHUNK_SIZE = 500;

/** Namespace for row checksums — reuses uuidV5 rather than adding a hash. */
const CHECKSUM_NAMESPACE = "3d8f1b6c-2e47-5a90-b1c3-0f9e8d7a6b54";

/** One record as it appears in the JSONL file. Every field but the brand is optional. */
export interface MedicineCatalogRecord {
  brandName: string;
  brandNameBn?: string | null;
  genericName?: string | null;
  genericNameBn?: string | null;
  manufacturer?: string | null;
  manufacturerBn?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  packSize?: string | null;
}

export interface MedicineCatalogImportResult {
  importId: string;
  /** Rows written this run. Excludes rows skipped by a resume. */
  imported: number;
  /** Lines skipped because a previous run had already written them. */
  resumedFrom: number;
  /** Lines rejected as malformed. The import still completes. */
  rejected: number;
  status: "completed";
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** null for anything that is not a usable record — a brand name is mandatory. */
function toRecord(value: unknown): MedicineCatalogRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const brandName = text(raw.brandName);
  if (!brandName) return null;
  return {
    brandName,
    brandNameBn: text(raw.brandNameBn),
    genericName: text(raw.genericName),
    genericNameBn: text(raw.genericNameBn),
    manufacturer: text(raw.manufacturer),
    manufacturerBn: text(raw.manufacturerBn),
    strength: text(raw.strength),
    dosageForm: text(raw.dosageForm),
    packSize: text(raw.packSize),
  };
}

interface PreparedRow {
  id: string;
  brandName: string;
  brandNameBn: string | null;
  genericName: string | null;
  genericNameBn: string | null;
  manufacturer: string | null;
  manufacturerBn: string | null;
  strength: string | null;
  dosageForm: string | null;
  packSize: string | null;
  searchKey: string;
  source: string;
  sourceVersion: string;
  rowChecksum: string;
  createdAt: string;
  updatedAt: string;
}

function prepare(
  record: MedicineCatalogRecord,
  source: string,
  sourceVersion: string,
  now: string,
): PreparedRow | null {
  // Every name field feeds the one folded key, so an English, Bangla or
  // Banglish query all reach this row. A record whose names fold to nothing is
  // unreachable by search and is rejected rather than stored unfindable.
  const searchKey = medicineSearchKeys([
    record.brandName,
    record.brandNameBn,
    record.genericName,
    record.genericNameBn,
    record.manufacturer,
    record.manufacturerBn,
    record.strength,
  ]);
  if (!searchKey) return null;

  const checksumInput = [
    record.brandName, record.brandNameBn, record.genericName, record.genericNameBn,
    record.manufacturer, record.manufacturerBn, record.strength, record.dosageForm,
    record.packSize,
  ].map((part) => part ?? "").join("\u0000");

  return {
    id: catalogRowId(record),
    brandName: record.brandName,
    brandNameBn: record.brandNameBn ?? null,
    genericName: record.genericName ?? null,
    genericNameBn: record.genericNameBn ?? null,
    manufacturer: record.manufacturer ?? null,
    manufacturerBn: record.manufacturerBn ?? null,
    strength: record.strength ?? null,
    dosageForm: record.dosageForm ?? null,
    packSize: record.packSize ?? null,
    searchKey,
    source,
    sourceVersion,
    rowChecksum: uuidV5(CHECKSUM_NAMESPACE, checksumInput),
    createdAt: now,
    updatedAt: now,
  };
}

/** One chunk, one transaction. Idempotent by deterministic id. */
function writeChunk(rows: readonly PreparedRow[]): void {
  if (rows.length === 0) return;
  db.transaction((tx) => {
    for (const row of rows) {
      tx.insert(medicineCatalog)
        .values(row)
        .onConflictDoUpdate({
          target: medicineCatalog.id,
          set: {
            brandName: row.brandName,
            brandNameBn: row.brandNameBn,
            genericName: row.genericName,
            genericNameBn: row.genericNameBn,
            manufacturer: row.manufacturer,
            manufacturerBn: row.manufacturerBn,
            strength: row.strength,
            dosageForm: row.dosageForm,
            packSize: row.packSize,
            searchKey: row.searchKey,
            source: row.source,
            sourceVersion: row.sourceVersion,
            rowChecksum: row.rowChecksum,
            updatedAt: row.updatedAt,
          },
        })
        .run();
    }
  });
}

interface PreviousProgress {
  /** Nonblank LINES the earlier run durably consumed. */
  lineCursor: number;
  /** Rows it durably wrote. Smaller than the cursor when lines were rejected. */
  importedRows: number;
}

/**
 * How far an earlier interrupted run of the SAME file got, so a re-run resumes
 * instead of restarting a 21k-row file from zero. Keyed on the file checksum, so
 * a different file sharing a source/version cannot resume onto a stale offset.
 *
 * Two things this gets right that an earlier version did not:
 *
 *  - it counts a `running` row as a resume point. A process KILLED mid-import
 *    leaves `running` forever, because nothing survives to mark it failed — and
 *    that is the whole case "resumable" is supposed to cover. Only an
 *    unfinished run of this exact file can match, and a live run would be this
 *    process itself, which has not written a cursor yet;
 *  - it reads `row_count` (lines consumed), not `imported_rows` (rows written).
 *    The loop below skips by LINE, so resuming on a row count would re-read
 *    every rejected line's worth of offset. Harmless but wrong, and it made the
 *    cursor drift further with every malformed line.
 */
function previousProgress(fileChecksum: string): PreviousProgress {
  // A COMPLETED run of this file supersedes every unfinished one before it.
  // Without this, an abandoned 'failed' or 'running' row outlived the
  // successful run that followed it, and a THIRD import of the same file
  // resumed from the stale cursor — skipping a prefix that a later run had
  // already imported, and would skip re-importing it if those rows had since
  // been removed. Found by the delta review.
  const completed = db
    .select({ id: medicineCatalogImports.id })
    .from(medicineCatalogImports)
    .where(sql`${medicineCatalogImports.fileChecksum} = ${fileChecksum}
               and ${medicineCatalogImports.status} = 'completed'`)
    .limit(1)
    .get();
  if (completed) return { lineCursor: 0, importedRows: 0 };

  const row = db
    .select({
      lineCursor: medicineCatalogImports.rowCount,
      importedRows: medicineCatalogImports.importedRows,
    })
    .from(medicineCatalogImports)
    .where(sql`${medicineCatalogImports.fileChecksum} = ${fileChecksum}
               and ${medicineCatalogImports.status} in ('failed','running')`)
    .orderBy(sql`${medicineCatalogImports.rowCount} desc`)
    .limit(1)
    .get();
  return { lineCursor: row?.lineCursor ?? 0, importedRows: row?.importedRows ?? 0 };
}

/**
 * Import a catalogue. Owner-only, chunked, idempotent and resumable.
 *
 * Re-running the same file is safe: ids are deterministic, so rows are updated
 * in place and the row count does not grow.
 */
export async function importMedicineCatalog(input: {
  shopId: string;
  actorUserId: string;
  source: string;
  sourceVersion: string;
  /** Stable checksum of the whole file, computed by the caller. */
  fileChecksum: string;
  readLines: AsyncIterable<string>;
  onProgress?: (imported: number) => void;
}): Promise<MedicineCatalogImportResult> {
  // Same gate db/inventoryImport.ts uses. A catalogue replaces national
  // reference data for the whole installation; staff must not trigger it.
  await requireOwner(input.shopId, input.actorUserId);

  const resumed = previousProgress(input.fileChecksum);
  const importId = generateId();

  db.insert(medicineCatalogImports)
    .values({
      id: importId,
      source: input.source,
      sourceVersion: input.sourceVersion,
      fileChecksum: input.fileChecksum,
      rowCount: resumed.lineCursor,
      importedRows: resumed.importedRows,
      status: "running",
      startedAt: new Date().toISOString(),
    })
    .run();

  let seen = 0;
  let imported = resumed.importedRows;
  // The last line that is DURABLY written, which is not the same as the last
  // line read: the lines after it sit in the pending chunk. Recording `seen`
  // as the cursor on failure would skip them on resume — 20 rows silently lost
  // in the 600-row crash test, which is how this was found.
  let flushedLines = resumed.lineCursor;
  let rejected = 0;
  let chunk: PreparedRow[] = [];

  const flush = (): void => {
    writeChunk(chunk);
    imported += chunk.length;
    // Only the chunk is ever retained: 21k rows never coexist in memory.
    chunk = [];
    flushedLines = seen;
    db.update(medicineCatalogImports)
      .set({ importedRows: imported, rowCount: flushedLines })
      .where(sql`${medicineCatalogImports.id} = ${importId}`)
      .run();
    input.onProgress?.(imported);
  };

  try {
    for await (const line of input.readLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      seen += 1;
      if (seen <= resumed.lineCursor) continue; // already consumed by the earlier run

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        rejected += 1;
        continue;
      }
      const record = toRecord(parsed);
      if (!record) {
        rejected += 1;
        continue;
      }
      const row = prepare(record, input.source, input.sourceVersion, new Date().toISOString());
      if (!row) {
        rejected += 1;
        continue;
      }
      chunk.push(row);
      if (chunk.length >= CHUNK_SIZE) flush();
    }
    flush();

    db.update(medicineCatalogImports)
      .set({
        status: "completed",
        rowCount: flushedLines,
        importedRows: imported,
        finishedAt: new Date().toISOString(),
      })
      .where(sql`${medicineCatalogImports.id} = ${importId}`)
      .run();

    return {
      importId,
      imported: imported - resumed.importedRows,
      resumedFrom: resumed.lineCursor,
      rejected,
      status: "completed",
    };
  } catch (error: unknown) {
    // A failure keeps `imported_rows` so the next run resumes from here rather
    // than re-reading everything.
    db.update(medicineCatalogImports)
      .set({
        status: "failed",
        rowCount: flushedLines,
        importedRows: imported,
        error: error instanceof Error ? error.message.slice(0, 500) : "import failed",
        finishedAt: new Date().toISOString(),
      })
      .where(sql`${medicineCatalogImports.id} = ${importId}`)
      .run();
    throw error;
  }
}
