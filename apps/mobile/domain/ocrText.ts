// domain/ocrText.ts — pure heuristics extracting medicine-strip fields from
// raw ML Kit OCR text. Zero React/native/DB imports (mirrors domain/fefo.ts).
// native/scanner.ts hands this file a raw recognized-text blob; this file
// only decides what to do with it once given it.
//
// Every extractor prefers null over a guess: an unlabeled/ambiguous token is
// left for the user to fill in manually rather than risking a wrong prefill
// (docs/plans/ocr.md — Add Medicine "never auto-commit a scanned value").

import { normalizeScannedExpiryDate } from './ocrDateNormalizer';

const MIN_NAME_LINE_LENGTH = 3;
const NON_NAME_LINE_KEYWORDS =
  /\b(MFG|MFD|EXP|EXPIRY|B\.?\s?NO|BATCH|LOT|MRP|RS\.?|PRICE|SCHEDULE|CAUTION|WARNING|STORE|KEEP)\b/i;
// Require at least one Latin letter rather than deny-listing punctuation —
// a positive "looks like a word" check catches noise (`###`, `...`, stray
// symbols) that an enumerated punctuation class would otherwise miss.
const HAS_LETTER = /[A-Za-z]/;

// First plausible line, top-to-bottom (ML Kit's .text generally preserves
// reading order, and strips print the brand/product name first/largest) —
// a heuristic assumption to tune against real strips, not a guarantee.
export function extractMedicineNameCandidate(rawText: string): string | null {
  const candidateLines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= MIN_NAME_LINE_LENGTH)
    .filter((line) => !NON_NAME_LINE_KEYWORDS.test(line))
    .filter((line) => HAS_LETTER.test(line));

  return candidateLines[0] ?? null;
}

// Case/whitespace-insensitive identity, not fuzzy matching — collapses
// incidental OCR/print differences (extra spaces, casing) while still
// requiring every character to line up. A prefix or partial read (e.g. a
// truncated "Napa" against a DB row named "Napa Extra") must NOT normalize
// equal (docs/plans/ocr.md — Sale Entry auto-add safety).
export function normalizeMedicineName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface NameMatchCandidate {
  name: string;
}

// The one safe condition for an unattended cart auto-add: exactly one search
// result, AND that result's own name is identical (not merely a prefix/FTS
// match) to what was scanned. searchMedicinesForSale does prefix matching
// (db/sales.ts's toFtsPrefixQuery), so "exactly one FTS result" alone is not
// enough evidence — a short or truncated OCR read can still prefix-match
// exactly one real product without actually being that product.
export function findExactNameMatch<T extends NameMatchCandidate>(candidateName: string, matches: T[]): T | null {
  if (matches.length !== 1) {
    return null;
  }
  const [match] = matches;
  if (!match || normalizeMedicineName(match.name) !== normalizeMedicineName(candidateName)) {
    return null;
  }
  return match;
}

const BATCH_LABEL_PATTERN =
  /\b(?:B\.?\s?No\.?|Batch\s?No\.?|Batch|Lot\s?No\.?|Lot)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-/]*)/i;

// Only ever matches a labeled batch/lot token — never guesses a bare
// alphanumeric string as a batch number without a label (too high a
// false-positive risk against random strip text).
export function extractBatchNoCandidate(rawText: string): string | null {
  const match = BATCH_LABEL_PATTERN.exec(rawText);
  return match ? (match[1]?.trim() ?? null) : null;
}

const EXPIRY_LABEL_PATTERN = /\bEXP(?:IRY)?(?:\s?DATE)?\s*[:\-]?\s*([0-9][0-9./\-]{2,9}[0-9])/i;

// Only ever matches an EXP/EXPIRY-labeled date — no unlabeled-token
// fallback. An unlabeled date-like token can't be safely told apart from a
// MFG/MFD date, a promotional date, or a batch-adjacent number that merely
// looks like one, and guessing risks silently turning a manufacture date
// into an expiry date. That risk isn't fully caught downstream either:
// isoDateSchema only rejects a *past* date, so an OCR digit misread that
// turns a past MFG date into an apparently-future one would sail through as
// if it were a real EXP date. An unlabeled date is left for the user to type
// manually instead (docs/plans/ocr.md).
export function extractExpiryCandidateText(rawText: string): string | null {
  const labeledExpiry = EXPIRY_LABEL_PATTERN.exec(rawText);
  return labeledExpiry ? (labeledExpiry[1]?.trim() ?? null) : null;
}

export interface ScannedMedicineFields {
  name: string | null;
  batchNo: string | null;
  expiryDate: string | null;
}

// Composes the three extractors, running the expiry candidate through the
// date normalizer (format only — the "must be today or later" business rule
// stays in packages/validation's isoDateSchema, applied by the caller).
export function parseScannedMedicineStrip(rawText: string): ScannedMedicineFields {
  const expiryCandidate = extractExpiryCandidateText(rawText);
  return {
    name: extractMedicineNameCandidate(rawText),
    batchNo: extractBatchNoCandidate(rawText),
    expiryDate: expiryCandidate ? normalizeScannedExpiryDate(expiryCandidate) : null,
  };
}
