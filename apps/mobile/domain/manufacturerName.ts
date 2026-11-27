// domain/manufacturerName.ts — one company, however a sheet spells it
// (founder, 2026-11-28: "দুটোই করো").
//
// "Square", "Square Pharmaceuticals" and "SQUARE PHARMACEUTICALS LTD." are one
// company: the words that only say "this is a drug company" are dropped before
// comparing. A near miss ("Sqaure") is NOT silently merged — it is reported, so
// the owner decides; merging two real companies would put one company's stock
// under another's medicine.
//
// Pure: no React, native or DB imports.

import { levenshteinDistance } from "./medicineMatch";

const NOISE_WORDS = new Set([
  "pharma", "pharmaceutical", "pharmaceuticals", "ltd", "limited", "plc",
  "laboratories", "laboratory", "labs", "lab", "company", "co", "inc",
  "industries", "industry", "bangladesh", "bd", "healthcare", "health",
  "the", "and", "of", "group", "drug", "drugs", "international", "intl",
]);

/** The comparable core of a company name; "" when there is none. */
export function manufacturerKey(value: string | null | undefined): string {
  const words = (value ?? "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const core = words.filter((word) => !NOISE_WORDS.has(word));
  return (core.length > 0 ? core : words).join(" ");
}

/** Different companies on paper, but probably one company typed two ways. */
export function isSimilarManufacturer(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = manufacturerKey(a);
  const right = manufacturerKey(b);
  if (!left || !right || left === right) return false;
  if (left.replace(/ /g, "") === right.replace(/ /g, "")) return true;
  const longest = Math.max(left.length, right.length);
  return levenshteinDistance(left, right) <= (longest >= 5 ? 2 : 1);
}
