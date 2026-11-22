// domain/stripMatcher.ts — live strip scan: which of THIS shop's medicines is
// printed on the strip in front of the camera?
//
// The question is asked backwards on purpose. A strip carries twenty pieces of
// text (MA No, Mfg. Lic, batch, generic, the company) and the old scanner tried
// to guess which ONE of them was the name — it took the first plausible line,
// which on a Napa Extra strip is "MA No. 186-480-006". Here the shop's own
// inventory is the dictionary: a medicine matches when every word of its brand
// name is on the strip, so registration numbers and licence lines drop out by
// themselves — no medicine is called "MA No".
//
// Rules, in the order they apply:
//   1. Every brand word must be present (one OCR slip allowed on words of 5+
//      letters, two on 8+), or the whole brand read as one glued word.
//   2. A strength printed on the strip that contradicts the medicine's strength
//      removes it ("Progut MUPS 40" when the strip says 20 mg).
//   3. The most specific name wins: a Napa Extra strip also contains "Napa", but
//      Napa Extra matched more words, so plain Napa is dropped.
//   4. Strength, then the manufacturer, separate what is left.
//   5. Anything still ambiguous is offered as a choice, never guessed. So is a
//      winner with a more specific sibling the strip shows evidence of
//      (plain Napa while "Caffeine 65 mg" is visible — the "Extra" box was
//      probably missed).
//
// Pure: no React, native or DB imports (mirrors domain/fefo.ts). Bengali
// inventory names take part through the same fold W2-03 search uses
// (`medicineSearchKey`), which maps "নাপা" and "Napa" to one key. ML Kit's
// on-device model reads Latin script only, so the strip side is always Latin.

import { medicineSearchKey, normalizeBengali } from "@muthoy/utils";
import { levenshteinDistance } from "./medicineMatch";

export interface ScanVocabularyEntry {
  medicineId: string;
  name: string;
  generic: string | null;
  manufacturer: string | null;
  strength: string | null;
  requiresPrescription: boolean;
  /** At least one batch with stock that has not expired. */
  isSellable: boolean;
}

export interface OcrTextLine {
  text: string;
  /** Rendered line height in image pixels; 0 when unknown. */
  height: number;
}

export type StripMatchResult =
  | { kind: "none" }
  | { kind: "notFound" }
  | { kind: "match"; medicine: ScanVocabularyEntry; isStrong: boolean }
  | { kind: "choose"; options: ScanVocabularyEntry[] };

interface IndexedMedicine {
  entry: ScanVocabularyEntry;
  brandTokens: readonly string[];
  joinedBrand: string;
  strengths: readonly number[];
  genericTokens: readonly string[];
  makerTokens: readonly string[];
  /** False when every brand word is a variant word ("Forte", "Plus"...). */
  isDistinctive: boolean;
}

export interface StripIndex {
  medicines: readonly IndexedMedicine[];
}

const MAX_CHOICES = 3;
/** MA, licence and batch numbers are longer than any strength. */
const MAX_STRENGTH_VALUE = 9999;
const LARGE_TEXT_RATIO = 0.6;

const fold = (words: readonly string[]): ReadonlySet<string> =>
  new Set(words.map((word) => medicineSearchKey(word)));

/** Dosage forms, units and pharmacopoeia marks — never part of a brand. */
const FORM_AND_UNIT_WORDS = fold([
  "tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule", "capsules",
  "syrup", "syp", "syr", "susp", "suspension", "inj", "injection", "sachet",
  "sachets", "drop", "drops", "cream", "ointment", "oint", "gel", "lotion",
  "solution", "sol", "powder", "pdr", "spray", "inhaler", "strip", "strips",
  "pcs", "pc", "piece", "pieces", "mg", "ml", "mcg", "gm", "iu", "bp", "usp",
]);

/**
 * Words that name a DIFFERENT formulation of the same brand. Printed next to a
 * brand that does not carry them ("Napa® Extra" when only plain Napa matched),
 * they mean the strip is not that product — so the match is offered, not added.
 */
const FORMULATION_WORDS = fold([
  "forte", "plus", "extra", "extend", "rapid", "mups", "er", "sr", "xr", "xl",
  "cr", "mr", "ds", "dt", "od", "la", "max", "duo", "kids", "junior",
  "pediatric", "paediatric",
]);

/** Brand words that tell variants apart but never identify a product alone. */
const VARIANT_WORDS = new Set([
  ...FORMULATION_WORDS,
  ...fold(["baby", "gold", "fast", "retard", "sugar", "free", "chewable"]),
]);

const MAKER_NOISE_WORDS = fold([
  "pharma", "pharmaceutical", "pharmaceuticals", "ltd", "limited", "plc",
  "laboratories", "laboratory", "labs", "lab", "company", "co", "inc",
  "industries", "industry", "bangladesh", "bd", "healthcare", "health", "care",
  "the", "and", "of", "group", "enterprise", "enterprises", "chemical",
  "chemicals", "drug", "drugs", "international", "intl",
]);

const GENERIC_NOISE_WORDS = fold(["and", "with", "plus", "usp", "bp"]);

/** Lines whose numbers are registrations, dates or prices — never strengths. */
const REGISTRATION_LINE =
  /\b(ma\.?\s*no|reg|dar|lic|licen[cs]e|b\.?\s?no|batch|lot|mfg|mfd|exp|mrp|tk)\b/;

const UNIT_STRENGTH = /(\d+(?:\.\d+)?)\s*(?:mg|mcg|µg|ug|gm|g|ml|iu|%)(?![a-z])/g;

const MEDICINE_WORDS =
  /\b(tablet|tab|capsule|cap|syrup|suspension|injection|usp|bp|mfg|lic|ma\.?\s*no|batch|exp|saline|ors|cream|ointment|drops|sachet|chewable|paracetamol)\b/;

// ── tokenising ──────────────────────────────────────────────────────────────

function foldedWords(value: string): string[] {
  return medicineSearchKey(value)
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .split(" ")
    .filter((word) => /^[a-z]+$/.test(word));
}

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function numbersIn(value: string): number[] {
  return (normalizeBengali(value).match(/\d+(?:\.\d+)?/g) ?? [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0 && n <= MAX_STRENGTH_VALUE);
}

/** O->0 and I/l->1, but only where the letter touches a digit ("5OO mg"). */
function fixOcrDigits(line: string): string {
  let fixed = line;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = fixed
      .replace(/(\d)[Oo]/g, (_m, digit: string) => `${digit}0`)
      .replace(/[Oo](\d)/g, (_m, digit: string) => `0${digit}`)
      .replace(/(\d)[Il|]/g, (_m, digit: string) => `${digit}1`)
      .replace(/[Il|](\d)/g, (_m, digit: string) => `1${digit}`);
    if (next === fixed) break;
    fixed = next;
  }
  return fixed;
}

function maxEditsFor(length: number): number {
  if (length <= 4) return 0;
  return length <= 7 ? 1 : 2;
}

// ── index ───────────────────────────────────────────────────────────────────

function indexMedicine(entry: ScanVocabularyEntry): IndexedMedicine {
  const brandTokens = distinct(
    foldedWords(entry.name).filter(
      (word) => word.length >= 2 && !FORM_AND_UNIT_WORDS.has(word),
    ),
  );
  return {
    entry,
    brandTokens,
    joinedBrand: brandTokens.join(""),
    strengths: distinct([...numbersIn(entry.strength ?? ""), ...numbersIn(entry.name)]),
    genericTokens: distinct(
      foldedWords(entry.generic ?? "").filter(
        (word) => word.length >= 4 && !GENERIC_NOISE_WORDS.has(word),
      ),
    ),
    makerTokens: distinct(
      foldedWords(entry.manufacturer ?? "").filter(
        (word) => word.length >= 3 && !MAKER_NOISE_WORDS.has(word),
      ),
    ),
    isDistinctive: brandTokens.some(
      (word) => word.length >= 3 && !VARIANT_WORDS.has(word),
    ),
  };
}

/** Built once when the scanner opens; matching a frame never touches SQLite. */
export function buildStripIndex(entries: readonly ScanVocabularyEntry[]): StripIndex {
  return {
    medicines: entries
      .map(indexMedicine)
      .filter((medicine) => medicine.brandTokens.length > 0 || medicine.genericTokens.length > 0),
  };
}

// ── what the camera read ────────────────────────────────────────────────────

interface EvidenceLine {
  words: readonly string[];
  numbers: readonly number[];
  isRegistration: boolean;
  height: number;
}

interface WordSighting {
  lineIndexes: Set<number>;
  /** True when the word only exists as two adjacent OCR words glued together. */
  isJoined: boolean;
}

interface OcrEvidence {
  words: ReadonlyMap<string, WordSighting>;
  wordsByLength: ReadonlyMap<number, readonly string[]>;
  lines: readonly EvidenceLine[];
  explicitStrengths: ReadonlySet<number>;
  maxHeight: number;
  isMedicineLike: boolean;
}

function addSighting(
  words: Map<string, WordSighting>,
  word: string,
  lineIndex: number,
  isJoined: boolean,
): void {
  const existing = words.get(word);
  if (existing) {
    existing.lineIndexes.add(lineIndex);
    existing.isJoined = existing.isJoined && isJoined;
    return;
  }
  words.set(word, { lineIndexes: new Set([lineIndex]), isJoined });
}

function readEvidence(rawLines: readonly OcrTextLine[]): OcrEvidence {
  const words = new Map<string, WordSighting>();
  const explicitStrengths = new Set<number>();
  let isMedicineLike = false;
  const lines = rawLines.map((raw, lineIndex): EvidenceLine => {
    const text = normalizeBengali(fixOcrDigits(raw.text));
    const isRegistration = REGISTRATION_LINE.test(text);
    const lineWords = foldedWords(text);
    lineWords.forEach((word, position) => {
      addSighting(words, word, lineIndex, false);
      const next = lineWords[position + 1];
      if (next) addSighting(words, word + next, lineIndex, true);
    });
    if (!isRegistration) {
      for (const match of text.matchAll(UNIT_STRENGTH)) {
        const value = Number(match[1]);
        if (value > 0 && value <= MAX_STRENGTH_VALUE) explicitStrengths.add(value);
      }
    }
    if (MEDICINE_WORDS.test(text)) isMedicineLike = true;
    return { words: lineWords, numbers: numbersIn(text), isRegistration, height: raw.height };
  });
  const wordsByLength = new Map<number, string[]>();
  for (const word of words.keys()) {
    wordsByLength.set(word.length, [...(wordsByLength.get(word.length) ?? []), word]);
  }
  return {
    words,
    wordsByLength,
    lines,
    explicitStrengths,
    maxHeight: Math.max(0, ...rawLines.map((line) => line.height)),
    isMedicineLike: isMedicineLike || explicitStrengths.size > 0,
  };
}

// ── finding a token in what was read ────────────────────────────────────────

interface TokenHit {
  lineIndexes: ReadonlySet<number>;
  isExact: boolean;
}

type TokenFinder = (token: string, extraEdits?: number) => TokenHit | null;

function createTokenFinder(evidence: OcrEvidence): TokenFinder {
  const memo = new Map<string, TokenHit | null>();
  return (token, extraEdits = 0) => {
    const key = `${token}|${extraEdits}`;
    if (memo.has(key)) return memo.get(key) ?? null;
    const exact = evidence.words.get(token);
    let hit: TokenHit | null =
      exact && !exact.isJoined ? { lineIndexes: exact.lineIndexes, isExact: true } : null;
    if (!hit) {
      const allowed = maxEditsFor(token.length) + extraEdits;
      const lineIndexes = new Set<number>(exact?.lineIndexes ?? []);
      for (let length = token.length - allowed; allowed > 0 && length <= token.length + allowed; length += 1) {
        for (const word of evidence.wordsByLength.get(length) ?? []) {
          if (levenshteinDistance(token, word) <= allowed) {
            evidence.words.get(word)?.lineIndexes.forEach((index) => lineIndexes.add(index));
          }
        }
      }
      hit = lineIndexes.size > 0 ? { lineIndexes, isExact: false } : null;
    }
    memo.set(key, hit);
    return hit;
  };
}

// ── scoring one medicine ────────────────────────────────────────────────────

type StrengthStatus = "match" | "conflict" | "unknown";

interface Candidate {
  medicine: IndexedMedicine;
  brandLines: ReadonlySet<number>;
  /** How many times the WHOLE brand appears — strips repeat the name. */
  occurrences: number;
  exactCount: number;
  strength: StrengthStatus;
  hasMakerHit: boolean;
  score: number;
}

function strengthStatus(
  medicine: IndexedMedicine,
  evidence: OcrEvidence,
  nameLines: ReadonlySet<number>,
): StrengthStatus {
  if (medicine.strengths.length === 0) return "unknown";
  const seen = new Set(evidence.explicitStrengths);
  for (const index of nameLines) {
    const line = evidence.lines[index];
    if (line && !line.isRegistration) line.numbers.forEach((n) => seen.add(n));
  }
  if (seen.size === 0) return "unknown";
  const hits = medicine.strengths.filter((n) => seen.has(n)).length;
  if (hits === medicine.strengths.length) return "match";
  return hits === 0 ? "conflict" : "unknown";
}

function brandHits(medicine: IndexedMedicine, find: TokenFinder): TokenHit[] | null {
  if (medicine.brandTokens.length === 0) return null;
  const hits = medicine.brandTokens.map((token) => find(token));
  if (hits.every((hit): hit is TokenHit => hit !== null)) return hits;
  if (medicine.brandTokens.length < 2) return null;
  const glued = find(medicine.joinedBrand);
  return glued ? [{ lineIndexes: glued.lineIndexes, isExact: false }] : null;
}

function scoreCandidate(
  medicine: IndexedMedicine,
  hits: readonly TokenHit[],
  evidence: OcrEvidence,
  find: TokenFinder,
): Candidate {
  const brandLines = new Set<number>();
  hits.forEach((hit) => hit.lineIndexes.forEach((index) => brandLines.add(index)));
  const occurrences = Math.min(...hits.map((hit) => hit.lineIndexes.size));
  const exactCount = hits.filter((hit) => hit.isExact).length;
  const strength = strengthStatus(medicine, evidence, brandLines);
  const hasMakerHit = medicine.makerTokens.some((token) => find(token) !== null);
  const genericHits = medicine.genericTokens.filter((token) => find(token) !== null).length;
  const isLargeText = [...brandLines].some(
    (index) => (evidence.lines[index]?.height ?? 0) >= evidence.maxHeight * LARGE_TEXT_RATIO,
  );
  const score =
    medicine.brandTokens.length * 10 +
    exactCount * 3 +
    (strength === "match" ? 8 : 0) +
    (hasMakerHit ? 4 : 0) +
    genericHits * 2 +
    Math.min(occurrences, 4) +
    (isLargeText && evidence.maxHeight > 0 ? 2 : 0);
  return { medicine, brandLines, occurrences, exactCount, strength, hasMakerHit, score };
}

// ── deciding ────────────────────────────────────────────────────────────────

function isStrictSubset(small: readonly string[], large: readonly string[]): boolean {
  return small.length < large.length && small.every((token) => large.includes(token));
}

function byScore(a: Candidate, b: Candidate): number {
  return b.score - a.score || a.medicine.entry.name.localeCompare(b.medicine.entry.name);
}

function choose(entries: readonly ScanVocabularyEntry[]): StripMatchResult {
  return { kind: "choose", options: entries.slice(0, MAX_CHOICES) };
}

/**
 * A more specific product the strip shows evidence of, although its full name
 * was not read: plain Napa won, but "Caffeine" / "65 mg" (Napa Extra) is visible.
 */
function siblingsWithEvidence(
  winner: IndexedMedicine,
  index: StripIndex,
  evidence: OcrEvidence,
  find: TokenFinder,
): IndexedMedicine[] {
  return index.medicines.filter((sibling) => {
    if (!isStrictSubset(winner.brandTokens, sibling.brandTokens)) return false;
    const extraStrength = sibling.strengths.some(
      (n) => !winner.strengths.includes(n) && evidence.explicitStrengths.has(n),
    );
    const extraGeneric = sibling.genericTokens.some(
      (token) => !winner.genericTokens.includes(token) && find(token)?.isExact === true,
    );
    const extraBrand = sibling.brandTokens.some(
      (token) => !winner.brandTokens.includes(token) && token.length >= 4 && find(token, 1) !== null,
    );
    return extraStrength || extraGeneric || extraBrand;
  });
}

/**
 * The strip shows something the winner does not explain — a printed strength it
 * does not have ("65 mg" for plain Napa) or a formulation word beside its name
 * ("Napa® Extra"). The shop may simply not stock the product actually shown, so
 * the winner is offered, never added on its own.
 */
function hasUnexplainedEvidence(winner: Candidate, evidence: OcrEvidence): boolean {
  const { strengths, brandTokens } = winner.medicine;
  const isStrengthUnexplained =
    strengths.length > 0 && [...evidence.explicitStrengths].some((n) => !strengths.includes(n));
  const isFormulationUnexplained = [...winner.brandLines].some((index) =>
    (evidence.lines[index]?.words ?? []).some(
      (word) => FORMULATION_WORDS.has(word) && !brandTokens.includes(word),
    ),
  );
  return isStrengthUnexplained || isFormulationUnexplained;
}

function decideSingle(
  winner: Candidate,
  index: StripIndex,
  evidence: OcrEvidence,
  find: TokenFinder,
): StripMatchResult {
  const siblings = siblingsWithEvidence(winner.medicine, index, evidence, find);
  if (siblings.length > 0) {
    return choose([winner.medicine.entry, ...siblings.map((sibling) => sibling.entry)]);
  }
  if (!winner.medicine.isDistinctive || hasUnexplainedEvidence(winner, evidence)) {
    return choose([winner.medicine.entry]);
  }
  return {
    kind: "match",
    medicine: winner.medicine.entry,
    isStrong: winner.strength === "match" || winner.occurrences >= 2,
  };
}

function decideMany(
  candidates: readonly Candidate[],
  index: StripIndex,
  evidence: OcrEvidence,
  find: TokenFinder,
): StripMatchResult {
  const strengthMatched = candidates.filter((c) => c.strength === "match");
  const pool = strengthMatched.length > 0 ? strengthMatched : candidates;
  if (pool.length === 1 && pool[0]) return decideSingle(pool[0], index, evidence, find);
  const makerHits = pool.filter((c) => c.hasMakerHit);
  const othersNameAMaker = pool.every((c) => c.hasMakerHit || c.medicine.makerTokens.length > 0);
  if (makerHits.length === 1 && makerHits[0] && othersNameAMaker) {
    return decideSingle(makerHits[0], index, evidence, find);
  }
  return choose([...pool].sort(byScore).map((c) => c.medicine.entry));
}

/**
 * Brand PARTLY unreadable (Napa's script-font "Extend"): at least one brand word
 * read, plus the generic and printed strength — offered, never added. A brand
 * with NO word read is a different product (Maxpro is not Progut, though both
 * are esomeprazole 20 mg), and substituting a brand is the seller's call.
 */
function genericFallback(
  index: StripIndex,
  evidence: OcrEvidence,
  find: TokenFinder,
): ScanVocabularyEntry[] {
  return index.medicines
    .filter((medicine) => medicine.genericTokens.length > 0 && medicine.strengths.length > 0)
    .filter((medicine) => medicine.brandTokens.some((token) => find(token) !== null))
    .flatMap((medicine) => {
      // Exact only: a one-letter slip turns esomeprazole into omeprazole.
      const hits = medicine.genericTokens.map((token) => find(token));
      if (!hits.every((hit): hit is TokenHit => hit?.isExact === true)) return [];
      const lines = new Set<number>();
      hits.forEach((hit) => hit.lineIndexes.forEach((i) => lines.add(i)));
      return strengthStatus(medicine, evidence, lines) === "match" ? [medicine.entry] : [];
    })
    .slice(0, MAX_CHOICES + 1);
}

export function matchStrip(index: StripIndex, lines: readonly OcrTextLine[]): StripMatchResult {
  const evidence = readEvidence(lines);
  if (evidence.words.size === 0) return { kind: "none" };
  const find = createTokenFinder(evidence);

  const matched = index.medicines.flatMap((medicine) => {
    const hits = brandHits(medicine, find);
    return hits ? [scoreCandidate(medicine, hits, evidence, find)] : [];
  });
  const consistent = matched.filter((c) => c.strength !== "conflict");
  const candidates = consistent.filter(
    (c) => !consistent.some((other) => isStrictSubset(c.medicine.brandTokens, other.medicine.brandTokens)),
  );

  if (candidates.length === 1 && candidates[0]) {
    return decideSingle(candidates[0], index, evidence, find);
  }
  if (candidates.length > 1) return decideMany(candidates, index, evidence, find);

  const fallback = genericFallback(index, evidence, find);
  // More than MAX_CHOICES generic matches is not a choice, it is a list.
  if (fallback.length > 0 && fallback.length <= MAX_CHOICES) return choose(fallback);
  return evidence.isMedicineLike ? { kind: "notFound" } : { kind: "none" };
}
