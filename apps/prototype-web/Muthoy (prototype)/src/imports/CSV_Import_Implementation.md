# CSV Import for Inventory — Implementation Guide

---

## What to Build

A **CSV Import button** on the Inventory screen that lets the owner:
1. Download a template CSV
2. Fill it with medicines (in Excel/Google Sheets)
3. Upload it — all medicines get added to inventory instantly

---

## Step 1 — CSV Column Structure

The CSV must map to your existing `BatchedMedicine` + `MedicineBatch` schema.

**Template columns (in order):**
```
name, generic, manufacturer, type, batch_no, expiry_date, stock, purchase_price, sale_price, threshold
```

**Example CSV rows:**
```csv
name,generic,manufacturer,type,batch_no,expiry_date,stock,purchase_price,sale_price,threshold
Napa 500mg,Paracetamol,Beximco,tablet,A12345,2026-12-31,100,1.00,1.50,20
Ace 10mg,Amlodipine,Square,tablet,B67890,2027-06-30,50,6.00,8.00,10
Sergel 20mg,Omeprazole,Square,capsule,C11111,2026-09-15,30,4.50,6.00,15
```

**Rules:**
- `expiry_date` → `YYYY-MM-DD` format only
- `type` → `tablet` | `capsule` | `syrup` | `injection` | `cream` | `drop` — default `tablet` if blank
- `threshold` → optional, defaults to `10`
- `batch_no` → optional, defaults to `AUTO-[timestamp]` if blank

---

## Step 2 — New File: `src/app/utils/csvImport.ts`

```ts
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
  added: number;       // new medicines created
  updated: number;     // existing medicines got a new batch
  skipped: number;     // rows with validation errors
  errors: string[];    // human-readable error messages per row
}

/** Parse a raw CSV string into row objects */
export function parseCSV(text: string): CSVRow[] {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];

  // Normalize headers: lowercase, trim, replace spaces with underscores
  const headers = lines[0]
    .split(",")
    .map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));

  return lines.slice(1).map(line => {
    const values = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
    const row: any = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

/** Validate a single parsed row — returns an error string or null */
function validateRow(row: CSVRow, index: number): string | null {
  const n = index + 2; // human row number (1 = header, 2 = first data row)
  if (!row.name?.trim())           return `Row ${n}: name is required`;
  if (!row.generic?.trim())        return `Row ${n}: generic is required`;
  if (!row.manufacturer?.trim())   return `Row ${n}: manufacturer is required`;
  if (isNaN(Number(row.stock)) || Number(row.stock) < 0)
                                   return `Row ${n}: stock must be a non-negative number`;
  if (isNaN(Number(row.purchase_price)) || Number(row.purchase_price) <= 0)
                                   return `Row ${n}: purchase_price must be > 0`;
  if (isNaN(Number(row.sale_price)) || Number(row.sale_price) <= 0)
                                   return `Row ${n}: sale_price must be > 0`;
  if (row.expiry_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.expiry_date))
                                   return `Row ${n}: expiry_date must be YYYY-MM-DD`;
  return null;
}

/** Import parsed rows into localStorage medicines */
export function importMedicinesFromCSV(rows: CSVRow[]): ImportResult {
  const result: ImportResult = { added: 0, updated: 0, skipped: 0, errors: [] };
  const medicines = getMedicines();

  rows.forEach((row, i) => {
    const error = validateRow(row, i);
    if (error) {
      result.skipped++;
      result.errors.push(error);
      return;
    }

    const batchNo = row.batch_no?.trim() || `AUTO-${Date.now()}-${i}`;
    const expiryDate = row.expiry_date || "2099-12-31";
    const stock = Math.floor(Number(row.stock));
    const purchasePrice = parseFloat(Number(row.purchase_price).toFixed(2));
    const salePrice = parseFloat(Number(row.sale_price).toFixed(2));
    const threshold = parseInt(String(row.threshold)) || 10;
    const type = row.type?.trim() || "tablet";

    const newBatch: MedicineBatch = {
      batchNo,
      expiryDate,
      stock,
      purchasePrice,
      salePrice,
      receivedAt: new Date().toISOString(),
      legacy: false,
    };

    // Check if a medicine with the same name+generic already exists
    const existing = medicines.find(
      m =>
        m.name.toLowerCase() === row.name.trim().toLowerCase() &&
        m.generic.toLowerCase() === row.generic.trim().toLowerCase()
    );

    if (existing) {
      // Check for duplicate batch number
      const batchExists = existing.batches.some(b => b.batchNo === batchNo);
      if (!batchExists) {
        existing.batches.push(newBatch);
        // Recompute stock, salePrice, expiry fields
        Object.assign(existing, updateComputedFields(existing));
        result.updated++;
      } else {
        result.skipped++;
        result.errors.push(
          `Row ${i + 2}: batch "${batchNo}" already exists for "${row.name}" — skipped`
        );
      }
    } else {
      // Create a new medicine entry
      const newMedicine: BatchedMedicine = {
        id: Date.now() + i,
        name: row.name.trim(),
        generic: row.generic.trim(),
        manufacturer: row.manufacturer.trim(),
        type,
        threshold,
        batches: [newBatch],
      };
      const computed = updateComputedFields(newMedicine);
      medicines.push(computed);
      result.added++;
    }
  });

  saveMedicines(medicines);
  return result;
}

/** Generate the template CSV as a downloadable string */
export function generateTemplateCSV(): string {
  const header = "name,generic,manufacturer,type,batch_no,expiry_date,stock,purchase_price,sale_price,threshold";
  const example1 = "Napa 500mg,Paracetamol,Beximco Pharmaceuticals,tablet,A12345,2026-12-31,100,1.00,1.50,20";
  const example2 = "Ace 10mg,Amlodipine,Square Pharmaceuticals,tablet,B67890,2027-06-30,50,6.00,8.00,10";
  return [header, example1, example2].join("\n");
}
```

---

## Step 3 — New Component: `src/app/components/CSVImportButton.tsx`

```tsx
import { useRef, useState } from "react";
import { Upload, Download, CheckCircle, AlertCircle, X, Loader2 } from "lucide-react";
import {
  parseCSV,
  importMedicinesFromCSV,
  generateTemplateCSV,
  type ImportResult,
} from "../utils/csvImport";
import { useLanguage } from "../contexts/LanguageContext";

export function CSVImportButton() {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showResult, setShowResult] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      alert(t("শুধুমাত্র CSV ফাইল গ্রহণযোগ্য", "Only .csv files are accepted"));
      return;
    }

    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const rows = parseCSV(text);
        const importResult = importMedicinesFromCSV(rows);
        setResult(importResult);
        setShowResult(true);
        // Notify other screens (SaleEntry, Inventory) via storage event
        window.dispatchEvent(new StorageEvent("storage", { key: "medicines" }));
      } catch (err) {
        alert(t("ফাইল পড়তে সমস্যা হয়েছে", "Error reading file"));
      } finally {
        setIsLoading(false);
        // Reset file input so the same file can be re-imported if needed
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  const downloadTemplate = () => {
    const csv = generateTemplateCSV();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "medicine_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* Buttons row */}
      <div className="flex gap-2">
        {/* Download template */}
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-1.5 h-9 px-3 border border-[#E5E7EB] rounded-lg text-sm text-[#6B7280] bg-white hover:bg-[#F9FAFB] transition-colors"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          <Download className="w-4 h-4" />
          {t("টেমপ্লেট", "Template")}
        </button>

        {/* Import CSV */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          className="flex items-center gap-1.5 h-9 px-3 bg-[#059669] text-white rounded-lg text-sm font-medium hover:bg-[#047857] active:scale-95 transition-all disabled:opacity-50"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          {isLoading
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Upload className="w-4 h-4" />
          }
          {t("CSV আমদানি", "Import CSV")}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Result bottom sheet */}
      {showResult && result && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end">
          <div className="bg-white w-full rounded-t-3xl p-5 shadow-2xl animate-slide-in-from-bottom">
            <div className="flex items-center justify-between mb-4">
              <h3
                className="text-base font-bold text-[#111827]"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("আমদানি সম্পন্ন", "Import Complete")}
              </h3>
              <button
                onClick={() => setShowResult(false)}
                className="w-7 h-7 rounded-full bg-[#F3F4F6] flex items-center justify-center"
              >
                <X className="w-4 h-4 text-[#6B7280]" />
              </button>
            </div>

            {/* Summary pills */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-[#ECFDF5] rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-[#059669]">{result.added}</div>
                <div className="text-xs text-[#6B7280] mt-0.5" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("নতুন যোগ", "Added")}
                </div>
              </div>
              <div className="bg-[#EFF6FF] rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-[#3B82F6]">{result.updated}</div>
                <div className="text-xs text-[#6B7280] mt-0.5" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("ব্যাচ আপডেট", "Updated")}
                </div>
              </div>
              <div className="bg-[#FEF3C7] rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-[#F59E0B]">{result.skipped}</div>
                <div className="text-xs text-[#6B7280] mt-0.5" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("বাদ দেওয়া", "Skipped")}
                </div>
              </div>
            </div>

            {/* Errors list (if any) */}
            {result.errors.length > 0 && (
              <div className="bg-[#FEE2E2] rounded-xl p-3 max-h-32 overflow-y-auto mb-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertCircle className="w-4 h-4 text-[#DC2626]" />
                  <span className="text-xs font-semibold text-[#DC2626]">
                    {t("ত্রুটি", "Errors")}
                  </span>
                </div>
                {result.errors.map((err, i) => (
                  <p key={i} className="text-xs text-[#DC2626] leading-5">{err}</p>
                ))}
              </div>
            )}

            {/* Success message */}
            {result.added + result.updated > 0 && (
              <div className="flex items-center gap-2 bg-[#ECFDF5] rounded-xl p-3 mb-4">
                <CheckCircle className="w-5 h-5 text-[#059669]" />
                <span className="text-sm text-[#059669]" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t(
                    `ইনভেন্টরি আপডেট হয়েছে`,
                    `Inventory updated successfully`
                  )}
                </span>
              </div>
            )}

            <button
              onClick={() => setShowResult(false)}
              className="w-full h-12 bg-[#059669] text-white rounded-xl font-bold text-sm"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("ঠিক আছে", "Done")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
```

---

## Step 4 — Add to Inventory Screen

In `src/app/screens/Inventory.tsx`, find the header row where the "Add Medicine" button lives and drop in the component:

```tsx
// Add this import at top
import { CSVImportButton } from "../components/CSVImportButton";

// In the JSX header area, next to "+ Add Medicine":
<div className="flex items-center gap-2">
  <CSVImportButton />
  <button onClick={() => navigate("/app/add-medicine")} ...>
    + {t("ওষুধ যোগ", "Add Medicine")}
  </button>
</div>
```

---

## Step 5 — Google Sheets Workflow (Tell Your Users)

Give this instruction to pharmacy owners:

```
1. Download template → opens medicine_import_template.csv
2. Open in Google Sheets or Excel
3. Fill in your medicines (one row per batch)
4. File → Download → CSV (.csv)
5. Come back to Inventory → Import CSV → select file
6. Done ✓
```

---

## What Each File Does

| File | Role |
|---|---|
| `utils/csvImport.ts` | Parse CSV text, validate rows, merge into existing medicines, generate template |
| `components/CSVImportButton.tsx` | UI: two buttons (template + import), file picker, result sheet |
| `screens/Inventory.tsx` | Add `<CSVImportButton />` next to the existing Add Medicine button |

**No new dependencies.** Uses native `FileReader` and `Blob` APIs — works in any browser including Android WebView.
