// Bengali / Banglish text folding for medicine search (W2-03).
//
// THE ONE INVARIANT: the index and the query are folded by the SAME function.
// `medicineSearchKey()` is applied to every catalogue field at import time and
// to the user's query at search time, so all three input scripts collapse into
// one comparison space:
//
//   "Napa"  -> "napa"        (ASCII, lowercased)
//   "নাপা"   -> "napa"        (Bengali, transliterated)
//   "napa"  -> "napa"        (Banglish, already ASCII)
//
// Folding to ASCII rather than to Bengali is deliberate: FTS5 tokenises ASCII
// predictably, the existing `toFtsPrefixQuery` shape in db/sales.ts keeps
// working unchanged, and a Banglish typist never has to produce a Bengali
// codepoint. Nothing here scores or ranks — `domain/medicineMatch.ts` already
// owns similarity, and duplicating it is the mistake DECISIONS.md records at
// "D10 — one error-to-text map, not two".

/** Zero-width joiner / non-joiner. Invisible, and they break naive matching. */
const ZERO_WIDTH = /[‌‍]/g;

/** Bengali digits ০-৯ (U+09E6..U+09EF) in codepoint order. */
const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';

/**
 * Bengali -> Latin, longest match first.
 *
 * Two-codepoint sequences (nukta forms) MUST out-rank their single-codepoint
 * prefixes, which `banglishFromBengali()` guarantees by sorting keys on length.
 * Values are the spellings a Bangladeshi typist actually uses in Banglish, not a
 * scholarly scheme: ব is "b" (never "v"), and the inherent vowel is never
 * inserted. FUZZY_FOLDS then collapses the remaining variation.
 */
const BENGALI_TO_LATIN: Readonly<Record<string, string>> = {
  // Independent vowels
  'অ': 'a', 'আ': 'a', 'ই': 'i', 'ঈ': 'i',
  'উ': 'u', 'ঊ': 'u', 'ঋ': 'ri', 'এ': 'e',
  'ঐ': 'oi', 'ও': 'o', 'ঔ': 'ou',
  // Dependent vowel signs
  'া': 'a', 'ি': 'i', 'ী': 'i', 'ু': 'u',
  'ূ': 'u', 'ৃ': 'ri', 'ে': 'e', 'ৈ': 'oi',
  'ো': 'o', 'ৌ': 'ou',
  // Nukta forms — two codepoints, so they must out-rank their bases
  'ড়': 'r', 'ঢ়': 'rh', 'য়': 'y',
  // Precomposed equivalents of the above
  'ড়': 'r', 'ঢ়': 'rh', 'য়': 'y',
  // Consonants
  'ক': 'k', 'খ': 'kh', 'গ': 'g', 'ঘ': 'gh', 'ঙ': 'ng',
  'চ': 'ch', 'ছ': 'chh', 'জ': 'j', 'ঝ': 'jh', 'ঞ': 'n',
  'ট': 't', 'ঠ': 'th', 'ড': 'd', 'ঢ': 'dh', 'ণ': 'n',
  'ত': 't', 'থ': 'th', 'দ': 'd', 'ধ': 'dh', 'ন': 'n',
  'প': 'p', 'ফ': 'ph', 'ব': 'b', 'ভ': 'bh', 'ম': 'm',
  'য': 'j', 'র': 'r', 'ল': 'l',
  'শ': 'sh', 'ষ': 'sh', 'স': 's', 'হ': 'h',
  'ৎ': 't',
  // Signs
  'ং': 'ng', // anusvara
  'ঃ': 'h',  // visarga
  'ঁ': '',   // chandrabindu — nasalisation, carries no Banglish letter
  '়': '',   // bare nukta, when it survives NFC on its own
  '্': '',   // hasanta/virama — joins consonants, emits nothing itself
};

/** Keys sorted longest-first so two-codepoint sequences win. Built once. */
const TRANSLITERATION_KEYS: readonly string[] = Object.keys(BENGALI_TO_LATIN).sort(
  (a, b) => b.length - a.length,
);

/**
 * Spelling tolerance, applied to BOTH sides so it can never cause a mismatch.
 *
 * These are the substitutions Bangladeshi Banglish actually varies on. Order
 * matters: multi-character rules run before single-character ones, and the
 * doubled-letter collapse runs last so "ph"->"f" cannot resurrect a double.
 */
const FUZZY_FOLDS: readonly (readonly [RegExp, string])[] = [
  [/chh/g, 'ch'], // ছ vs চ — indistinguishable in practice
  [/ph/g, 'f'],   // paracetamol spellings, and ফ
  [/bh/g, 'v'],   // ভ
  [/sh/g, 's'],   // শ/ষ/স all collapse
  [/kh/g, 'k'],
  [/gh/g, 'g'],
  [/th/g, 't'],
  [/dh/g, 'd'],
  [/jh/g, 'j'],
  [/ks/g, 'x'],
  [/z/g, 'j'],    // জ is written both ways
  [/q/g, 'k'],
  [/w/g, 'v'],
  [/y/g, 'i'],
  [/([a-z])\1+/g, '$1'], // collapse doubled letters LAST
];

function foldBengaliDigits(value: string): string {
  let out = '';
  for (const char of value) {
    const index = BENGALI_DIGITS.indexOf(char);
    out += index >= 0 ? String(index) : char;
  }
  return out;
}

/**
 * Script-preserving clean-up: NFC, zero-width removal, Bengali digits folded to
 * ASCII, whitespace collapsed, lowercased. Bengali letters are left as Bengali —
 * use `medicineSearchKey` when a comparison key is wanted.
 */
export function normalizeBengali(value: string): string {
  return foldBengaliDigits(value.normalize('NFC').replace(ZERO_WIDTH, ''))
    .toLocaleLowerCase('bn')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Bengali -> Latin. Characters with no mapping (ASCII, digits) pass through. */
export function banglishFromBengali(value: string): string {
  let out = '';
  let index = 0;
  outer: while (index < value.length) {
    for (const key of TRANSLITERATION_KEYS) {
      if (value.startsWith(key, index)) {
        out += BENGALI_TO_LATIN[key];
        index += key.length;
        continue outer;
      }
    }
    out += value[index];
    index += 1;
  }
  return out;
}

/** True when the string carries at least one Bengali-block codepoint. */
export function hasBengaliScript(value: string): boolean {
  return /[ঀ-৿]/.test(value);
}

/**
 * The canonical comparison key. Applied identically to indexed fields and to
 * the user's query — that symmetry is what makes English, Bangla and Banglish
 * interchangeable. Returns '' for input with no alphanumeric content, which
 * callers treat as "no searchable text" rather than as a match-everything key.
 */
export function medicineSearchKey(value: string): string {
  const latin = banglishFromBengali(normalizeBengali(value)).toLowerCase();
  let folded = latin.replace(/[^a-z0-9 ]+/g, ' ');
  for (const [pattern, replacement] of FUZZY_FOLDS) {
    folded = folded.replace(pattern, replacement);
  }
  return folded.replace(/\s+/g, ' ').trim();
}

/**
 * Every distinct key a catalogue row should be findable by, de-duplicated and
 * joined for a single FTS5 column. Empty and duplicate folds are dropped so a
 * row with no Bangla name does not carry a blank token.
 */
export function medicineSearchKeys(values: readonly (string | null | undefined)[]): string {
  const keys: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const key = medicineSearchKey(value);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys.join(' ');
}
