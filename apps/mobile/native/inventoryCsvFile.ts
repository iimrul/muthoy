// native/inventoryCsvFile.ts — the two file actions of the CSV import screen:
// pick a .csv from the phone (Downloads, WhatsApp, Drive) and hand the owner
// the template through the system share sheet. Reads and writes no app data.

import { File, Paths } from "expo-file-system";
import {
  buildInventoryCsvTemplate,
  INVENTORY_CSV_TEMPLATE_NAME,
} from "../domain/inventoryCsvTemplate";

/** Far above any real shop's stock list; stops a wrong pick from freezing the screen. */
export const MAX_CSV_BYTES = 2 * 1024 * 1024;

// A .csv arrives labelled differently by every app that saved it.
const CSV_MIME_TYPES = ["text/*", "application/csv", "text/comma-separated-values", "application/vnd.ms-excel"];

export type CsvPickProblem = "too_large" | "not_csv";

export class CsvPickError extends Error {
  readonly problem: CsvPickProblem;

  constructor(problem: CsvPickProblem) {
    super(problem === "too_large" ? "CSV file is too large" : "Only .csv files can be imported");
    this.name = "CsvPickError";
    this.problem = problem;
  }
}

export interface PickedCsv {
  name: string;
  text: string;
}

/** The picked file's text, or null when the owner backed out of the picker. */
export async function pickInventoryCsv(): Promise<PickedCsv | null> {
  const picked = await File.pickFileAsync({ mimeTypes: CSV_MIME_TYPES });
  if (picked.canceled) return null;
  const file = picked.result;
  // An Excel workbook is binary; reading it as text yields garbage columns.
  if (/\.xlsx?$/i.test(file.name)) throw new CsvPickError("not_csv");
  if (file.size > MAX_CSV_BYTES) throw new CsvPickError("too_large");
  return { name: file.name, text: await file.text() };
}

export async function shareInventoryCsvTemplate(dialogTitle: string): Promise<void> {
  const file = new File(Paths.cache, INVENTORY_CSV_TEMPLATE_NAME);
  if (file.exists) file.delete();
  file.create();
  file.write(buildInventoryCsvTemplate());
  const Sharing = await import("expo-sharing");
  if (!(await Sharing.isAvailableAsync())) throw new Error("File sharing is unavailable on this device");
  await Sharing.shareAsync(file.uri, {
    dialogTitle,
    mimeType: "text/csv",
    UTI: "public.comma-separated-values-text",
  });
}
