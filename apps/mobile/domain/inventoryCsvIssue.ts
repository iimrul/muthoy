// domain/inventoryCsvIssue.ts — what can be wrong with an inventory CSV, as
// codes the import screen translates (db/inventoryImport.ts raises them).
//
// Pure: no React, native or DB imports.

export type InventoryCsvIssueCode =
  | "too_large"
  | "too_many_rows"
  | "unclosed_quote"
  | "uneven_columns"
  | "no_rows"
  | "duplicate_headers"
  | "missing_column"
  | "missing_text"
  | "example_row"
  | "bad_stock"
  | "bad_price"
  | "bad_expiry"
  | "bad_threshold"
  | "bad_barcode"
  | "duplicate_row"
  | "ambiguous_medicine"
  | "batch_exists";

export interface InventoryCsvIssue {
  /** The spreadsheet row (the header is row 1); null for the whole file. */
  rowNumber: number | null;
  code: InventoryCsvIssueCode;
  /** The column at fault, when there is one. */
  column?: string;
  /** What that cell actually held ("31/12/2027"), so it can be found in the sheet. */
  value?: string;
  /** The row's medicine name, so the list reads by medicine rather than by number. */
  medicineName?: string;
}

/**
 * Not a reason to refuse the file — something the owner should look at before
 * importing. similar_company: a new medicine whose company is spelled almost
 * like one already used for the same medicine ("Sqaure" beside "Square").
 */
export interface InventoryCsvWarning {
  rowNumber: number;
  code: "similar_company";
  medicineName: string;
  /** The company as this row spells it. */
  value: string;
  /** The spelling already in inventory (or earlier in the file). */
  existing: string;
}

/** A cell's text as the error list quotes it: trimmed, at most 60 characters. */
export function quotedCell(text: string): string | undefined {
  const value = text.trim();
  if (!value) return undefined;
  return value.length > 60 ? `${value.slice(0, 59)}…` : value;
}

const ISSUE_TEXT: Readonly<Record<InventoryCsvIssueCode, string>> = {
  too_large: "CSV exceeds 2 MiB",
  too_many_rows: "CSV exceeds the row limit",
  unclosed_quote: "a quoted field is never closed",
  uneven_columns: "more cells than columns (an unquoted comma?)",
  no_rows: "CSV must contain at least one data row",
  duplicate_headers: "CSV contains duplicate column headers",
  missing_column: "CSV is missing a required column",
  missing_text: "required text is missing",
  example_row: "the template's example row is still in the file",
  bad_stock: "stock must be a non-negative integer",
  bad_price: "price must be a taka amount",
  bad_expiry: "expiry must be a real date written YYYY-MM-DD",
  bad_threshold: "threshold must be a non-negative integer",
  bad_barcode: "the spreadsheet turned the barcode into a rounded number (e.g. 8.94E+12)",
  duplicate_row: "duplicate medicine/batch row",
  ambiguous_medicine: "medicine match is ambiguous",
  batch_exists: "batch already exists",
};

function describeIssue(issue: InventoryCsvIssue): string {
  const text = issue.column ? `${ISSUE_TEXT[issue.code]}: ${issue.column}` : ISSUE_TEXT[issue.code];
  return issue.rowNumber === null ? text : `Row ${issue.rowNumber}: ${text}`;
}

/**
 * Every problem in the file at once, row by row — the owner fixes the sheet
 * once instead of re-importing it for each mistake. Nothing is written.
 */
export class InventoryCsvError extends Error {
  readonly issues: readonly InventoryCsvIssue[];
  /** How many medicine rows the file had (0 when it could not be read at all). */
  readonly rowCount: number;

  constructor(issues: readonly InventoryCsvIssue[], rowCount = 0) {
    super(issues.map(describeIssue).join("; "));
    this.name = "InventoryCsvError";
    this.issues = issues;
    this.rowCount = rowCount;
  }
}
