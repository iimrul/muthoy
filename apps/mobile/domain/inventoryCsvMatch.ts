// domain/inventoryCsvMatch.ts — which inventory medicine a CSV row belongs to
// (founder, 2026-11-28: "দুটোই করো").
//
// A row joins an existing medicine only when the name and generic match, the
// company is the same company (domain/manufacturerName.ts: "Square" ==
// "Square Pharmaceuticals Ltd."), and the dosage form does not contradict:
//   - a row that names a form never lands on a medicine of ANOTHER form —
//     Telmepress 20 capsule is never added as a batch of Telmepress 20 tablet;
//     it prefers a medicine of the same form, else one with no form recorded;
//   - a row with no form joins the one same-name medicine; when the shop has
//     several (tablet AND capsule) it is refused and asked to name its form.
// Anything else becomes a new medicine. A new medicine whose company is
// spelled almost like one already used for that medicine is reported as a
// warning — never merged, never refused.
//
// Pure: no React, native or DB imports.

import { normalizeDosageForm } from "./dosageForm";
import type { InventoryCsvIssue, InventoryCsvWarning } from "./inventoryCsvIssue";
import { isSimilarManufacturer, manufacturerKey } from "./manufacturerName";

export interface CsvMatchRow {
  rowNumber: number;
  name: string;
  generic: string;
  manufacturer: string;
  batchNo: string;
  /** Canonical dosage form, or null when the row gave none. */
  type: string | null;
}

export interface ExistingMedicineForMatch {
  id: string;
  name: string;
  generic: string | null;
  manufacturer: string | null;
  type: string | null;
}

export interface ExistingBatchForMatch {
  medicineId: string;
  batchNo: string;
}

export type MatchedRow<R extends CsvMatchRow> = R & {
  action: "create_medicine" | "add_batch";
  medicineId: string | null;
  medicineKey: string;
};

const fold = (value: string | null | undefined) => (value ?? "").trim().toLocaleLowerCase();

const formOf = (value: string | null | undefined) => normalizeDosageForm(value);

/** Same name and generic — the medicine, regardless of company or form. */
function isSameMedicineName(medicine: { name: string; generic: string | null }, row: CsvMatchRow): boolean {
  return fold(medicine.name) === fold(row.name) && fold(medicine.generic) === fold(row.generic);
}

/** One key per product in the file: name, generic, company core and form. */
export function csvMedicineKey(row: Pick<CsvMatchRow, "name" | "generic" | "manufacturer" | "type">): string {
  return [fold(row.name), fold(row.generic), manufacturerKey(row.manufacturer), row.type ?? ""].join("|");
}

/** The inventory medicines this row may join, by the rules in the header. */
function candidatesFor(row: CsvMatchRow, existing: readonly ExistingMedicineForMatch[]): ExistingMedicineForMatch[] {
  const sameCompany = existing.filter(
    (medicine) => isSameMedicineName(medicine, row) && manufacturerKey(medicine.manufacturer) === manufacturerKey(row.manufacturer),
  );
  if (row.type === null) return sameCompany;
  const sameForm = sameCompany.filter((medicine) => formOf(medicine.type) === row.type);
  return sameForm.length > 0 ? sameForm : sameCompany.filter((medicine) => formOf(medicine.type) === null);
}

function similarCompany(
  row: CsvMatchRow,
  known: readonly { name: string; generic: string | null; manufacturer: string | null; type: string | null }[],
): string | null {
  const twin = known.find(
    (medicine) =>
      isSameMedicineName(medicine, row)
      && (row.type === null || formOf(medicine.type) === null || formOf(medicine.type) === row.type)
      && isSimilarManufacturer(medicine.manufacturer, row.manufacturer),
  );
  return twin?.manufacturer ?? null;
}

export function matchCsvRows<R extends CsvMatchRow>(
  parsed: readonly R[],
  existingMedicines: readonly ExistingMedicineForMatch[],
  existingBatches: readonly ExistingBatchForMatch[],
): { rows: MatchedRow<R>[]; issues: InventoryCsvIssue[]; warnings: InventoryCsvWarning[] } {
  const proposed = new Map<string, R>();
  const issues: InventoryCsvIssue[] = [];
  const warnings: InventoryCsvWarning[] = [];
  const rows = parsed.flatMap((row): MatchedRow<R>[] => {
    const at = { rowNumber: row.rowNumber, medicineName: row.name };
    const matches = candidatesFor(row, existingMedicines);
    if (matches.length > 1) {
      const forms = [...new Set(matches.map((medicine) => formOf(medicine.type) ?? "?"))].join(", ");
      issues.push({ ...at, code: "ambiguous_medicine", column: "type", value: forms });
      return [];
    }
    const match = matches[0];
    if (match && existingBatches.some(
      (batch) => batch.medicineId === match.id && fold(batch.batchNo) === fold(row.batchNo),
    )) {
      issues.push({ ...at, code: "batch_exists", column: "batch_no", value: row.batchNo });
      return [];
    }
    const medicineKey = csvMedicineKey(row);
    const isNewMedicine = !match && !proposed.has(medicineKey);
    if (isNewMedicine) {
      const existing = similarCompany(row, [...existingMedicines, ...proposed.values()]);
      if (existing !== null) {
        warnings.push({ ...at, code: "similar_company", value: row.manufacturer, existing });
      }
      proposed.set(medicineKey, row);
    }
    return [{ ...row, action: isNewMedicine ? "create_medicine" : "add_batch", medicineId: match?.id ?? null, medicineKey }];
  });
  return { rows, issues, warnings };
}
