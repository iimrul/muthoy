import { getMedicines, saveMedicines } from "./medicineData";
import { updateComputedFields } from "./batchUtils";
import type { BatchedMedicine, MedicineBatch } from "./batchUtils";

export interface CSVRow {
  name: string;
  generic: string;
  manufacturer: string;
  type: string;
  batch_no: string;
  expiry_date: string;
  stock: number;
  purchase_price: number;
  sale_price: number;
  threshold: number;
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// Accepts: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, YYYY/MM/DD, MM/DD/YYYY, Excel serial
function normalizeExpiryDate(raw: string): string | null {
  const s = String(raw).trim();
  if (!s) return null;

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // YYYY/MM/DD
  const isoSlash = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (isoSlash) {
    const [, y, m, d] = isoSlash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY or MM/DD/YYYY (default: DD/MM per Bangladesh convention)
  const dmyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    let [, a, b, year] = dmyMatch;
    // If first part > 12 it must be the day; otherwise assume DD/MM
    const day = (parseInt(a) > 12 ? a : a).padStart(2, "0");
    const month = (parseInt(a) > 12 ? b : b).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Excel serial date number (e.g. 46032)
  if (/^\d{4,6}$/.test(s)) {
    const n = parseInt(s);
    if (n > 40000 && n < 60000) {
      const excelEpoch = new Date(1899, 11, 30);
      const date = new Date(excelEpoch.getTime() + n * 86400000);
      if (!isNaN(date.getTime())) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      }
    }
  }

  return null;
}

function normalizeRow(row: CSVRow): CSVRow {
  const raw = String(row.expiry_date || "").trim();
  if (!raw) return row;
  const normalized = normalizeExpiryDate(raw);
  return normalized ? { ...row, expiry_date: normalized } : row;
}

function validateRow(row: CSVRow, index: number): string | null {
  const n = index + 2;
  if (!row.name?.toString().trim()) return `Row ${n}: name is required`;
  if (!row.generic?.toString().trim()) return `Row ${n}: generic is required`;
  if (!row.manufacturer?.toString().trim()) return `Row ${n}: manufacturer is required`;
  if (isNaN(Number(row.stock)) || Number(row.stock) < 0)
    return `Row ${n}: stock must be a non-negative number`;
  if (isNaN(Number(row.purchase_price)) || Number(row.purchase_price) <= 0)
    return `Row ${n}: purchase_price must be > 0`;
  if (isNaN(Number(row.sale_price)) || Number(row.sale_price) <= 0)
    return `Row ${n}: sale_price must be > 0`;
  // After normalization this should always pass; guard for truly unparseable values
  if (row.expiry_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(row.expiry_date)))
    return `Row ${n}: expiry_date "${row.expiry_date}" could not be parsed — use YYYY-MM-DD, DD/MM/YYYY, or DD-MM-YYYY`;
  return null;
}

export function parseCSV(text: string): CSVRow[] {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/\s*\(.*?\)/g, "").replace(/\s+/g, "_"));

  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: any = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });
}

export function importMedicinesFromCSV(rows: CSVRow[]): ImportResult {
  const result: ImportResult = { added: 0, updated: 0, skipped: 0, errors: [] };
  const medicines = getMedicines() as unknown as BatchedMedicine[];

  rows.forEach((row, i) => {
    const normalizedRow = normalizeRow(row);
    const error = validateRow(normalizedRow, i);
    if (error) {
      result.skipped++;
      result.errors.push(error);
      return;
    }

    const providedBatchNo = String(normalizedRow.batch_no || "").trim();
    const expiryDate = String(normalizedRow.expiry_date || "") || "2099-12-31";
    const stock = Math.floor(Number(normalizedRow.stock));
    const purchasePrice = parseFloat(Number(normalizedRow.purchase_price).toFixed(2));
    const salePrice = parseFloat(Number(normalizedRow.sale_price).toFixed(2));
    const threshold = parseInt(String(normalizedRow.threshold)) || 10;
    const type = String(normalizedRow.type || "").trim() || "tablet";

    const existing = medicines.find(
      (m) =>
        m.name.toLowerCase() === String(normalizedRow.name).trim().toLowerCase() &&
        m.generic.toLowerCase() === String(normalizedRow.generic).trim().toLowerCase(),
    );

    if (existing) {
      existing.batches = existing.batches || [];

      if (providedBatchNo) {
        // Named batch: check if it already exists
        const existingBatch = existing.batches.find((b) => b.batchNo === providedBatchNo);
        if (existingBatch) {
          // Merge: add stock and update prices to the latest import values
          existingBatch.stock += stock;
          existingBatch.purchasePrice = purchasePrice;
          existingBatch.salePrice = salePrice;
          existingBatch.expiryDate = expiryDate;
          Object.assign(existing, updateComputedFields(existing));
          result.updated++;
        } else {
          // New named batch for existing medicine
          existing.batches.push({
            batchNo: providedBatchNo,
            expiryDate,
            stock,
            purchasePrice,
            salePrice,
            receivedAt: new Date().toISOString(),
            legacy: false,
          });
          Object.assign(existing, updateComputedFields(existing));
          result.updated++;
        }
      } else {
        // No batch number: deduplicate by expiry date to avoid phantom duplicates on re-import
        const sameExpiry = existing.batches.find((b) => b.expiryDate === expiryDate);
        if (sameExpiry) {
          sameExpiry.stock += stock;
          sameExpiry.purchasePrice = purchasePrice;
          sameExpiry.salePrice = salePrice;
          Object.assign(existing, updateComputedFields(existing));
          result.updated++;
        } else {
          const autoBatchNo = `IMP-${expiryDate}-${i}`;
          existing.batches.push({
            batchNo: autoBatchNo,
            expiryDate,
            stock,
            purchasePrice,
            salePrice,
            receivedAt: new Date().toISOString(),
            legacy: false,
          });
          Object.assign(existing, updateComputedFields(existing));
          result.updated++;
        }
      }
    } else {
      // Brand new medicine
      const batchNo = providedBatchNo || `IMP-${expiryDate}-${i}`;
      const newMedicine: BatchedMedicine = {
        id: Date.now() + i,
        name: String(normalizedRow.name).trim(),
        generic: String(normalizedRow.generic).trim(),
        manufacturer: String(normalizedRow.manufacturer).trim(),
        type,
        threshold,
        batches: [
          {
            batchNo,
            expiryDate,
            stock,
            purchasePrice,
            salePrice,
            receivedAt: new Date().toISOString(),
            legacy: false,
          },
        ],
      } as BatchedMedicine;
      const computed = updateComputedFields(newMedicine);
      medicines.push(computed);
      result.added++;
    }
  });

  saveMedicines(medicines as any);
  return result;
}

export function generateTemplateCSV(): string {
  const header =
    "name,generic,manufacturer,type,batch_no,expiry_date (YYYY-MM-DD),stock,purchase_price,sale_price,threshold";
  const example1 =
    "Napa 500mg,Paracetamol,Beximco Pharmaceuticals,tablet,A12345,2026-12-31,100,1.00,1.50,20";
  const example2 =
    "Ace 10mg,Amlodipine,Square Pharmaceuticals,tablet,B67890,2027-06-30,50,6.00,8.00,10";
  return [header, example1, example2].join("\n");
}
