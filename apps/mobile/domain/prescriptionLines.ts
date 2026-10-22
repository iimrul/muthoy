// domain/prescriptionLines.ts — W2-01 section 6.2.4.
//
// Turning the text read off a prescription into a reviewable list of this
// shop's medicines. Pure apart from the lookup it is handed: zero React,
// zero native, zero DB imports (mirrors domain/fefo.ts), so the matching can
// be tested without rendering checkout or opening a database — and so
// app/sale/checkout.tsx, already over the file-size limit, does not grow a
// matching loop of its own.
//
// It reuses the two extractors that already exist rather than inventing a
// third: `parseScannedInvoiceLines` (a prescription is a multi-item list, the
// same shape as an invoice — the extractor app/suppliers/purchase-create.tsx
// is built on) and `findExactNameMatch` (the same prefix-match-is-not-enough
// rule the sale scan uses).
//
// Nothing here adds anything to anything. Every line comes back unadded.

import type { Paisa } from "@muthoy/types";
import { findExactNameMatch, parseScannedInvoiceLines } from "./ocrText";

/** The shape `db/sales.ts`'s `searchMedicinesForSale` already returns. */
export interface PrescriptionLookupResult {
  medicineId: string;
  name: string;
  activeBatch: {
    id: string;
    expiryDate: string | null;
    salePrice: Paisa;
    quantityAvailable: number;
  };
  activeBatchNo: string | null;
}

export interface PrescriptionLineMatch {
  medicineId: string;
  name: string;
  batchId: string;
  batchNo: string | null;
  expiryDate: string | null;
  unitPrice: Paisa;
  availableQuantity: number;
}

export interface PrescriptionLine {
  /** Stable for a given build: the line's position in the recognised text. */
  id: string;
  /** Exactly what was read for this line, so a misread stays visible. */
  rawText: string;
  /** Null when nothing in this shop's stock matched it exactly. */
  match: PrescriptionLineMatch | null;
  isAdded: boolean;
}

/**
 * Builds the review list.
 *
 * `lookup` is injected so this module needs no database: the caller passes a
 * shop-scoped search. A line whose name cannot be extracted, or which matches
 * nothing exactly, comes back with `match: null` — kept in the list rather than
 * dropped, because the shopkeeper still has to deal with it, and silently
 * losing a prescribed medicine is worse than showing one that needs a search.
 *
 * Lookups run in sequence, not in parallel: this is a handful of lines against
 * a local FTS index, and a prescription with twenty lines should not open twenty
 * concurrent SQLite reads on a 2 GB phone.
 */
export async function buildPrescriptionLines(
  recognizedText: string,
  lookup: (name: string) => Promise<PrescriptionLookupResult[]>,
): Promise<PrescriptionLine[]> {
  const candidates = parseScannedInvoiceLines(recognizedText);
  const lines: PrescriptionLine[] = [];

  for (const [index, candidate] of candidates.entries()) {
    const name = candidate.name?.trim();
    const line: PrescriptionLine = {
      id: `rx-${index}`,
      rawText: candidate.rawText.replace(/\s+/g, " ").trim(),
      match: null,
      isAdded: false,
    };
    if (name) {
      const exact = findExactNameMatch(name, await lookup(name));
      if (exact) {
        line.match = {
          medicineId: exact.medicineId,
          name: exact.name,
          batchId: exact.activeBatch.id,
          batchNo: exact.activeBatchNo,
          expiryDate: exact.activeBatch.expiryDate,
          unitPrice: exact.activeBatch.salePrice,
          availableQuantity: exact.activeBatch.quantityAvailable,
        };
      }
    }
    lines.push(line);
  }

  return lines;
}
