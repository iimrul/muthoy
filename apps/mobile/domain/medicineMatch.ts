// domain/medicineMatch.ts — hand-rolled fuzzy name matching for OCR-scanned
// invoice lines against existing inventory. Deliberately separate from
// domain/ocrText.ts's findExactNameMatch (which requires an exact
// normalized match, by design, for the unattended-cart-add safety case):
// this is a human-reviewed match PICKER, where surfacing close-but-imperfect
// candidates for the operator to confirm or reject is the whole point.
// No external dependency — a small in-repo normalized-Levenshtein ratio,
// matching the existing OCR module's build-vs-install posture.

export interface FuzzyMatchable {
  medicineId: string;
  name: string;
}

export interface FuzzyMatch<T extends FuzzyMatchable> {
  medicine: T;
  /** 0-100, higher is closer. Deterministic string distance, never ML-inferred. */
  score: number;
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = [];
  for (let i = 0; i < rows; i += 1) {
    matrix.push(new Array<number>(cols).fill(0));
    matrix[i]![0] = i;
  }
  for (let j = 0; j < cols; j += 1) matrix[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }
  return matrix[rows - 1]![cols - 1]!;
}

function similarityScore(a: string, b: string): number {
  const normalizedA = a.trim().toLowerCase();
  const normalizedB = b.trim().toLowerCase();
  if (!normalizedA || !normalizedB) return 0;
  const distance = levenshteinDistance(normalizedA, normalizedB);
  const maxLength = Math.max(normalizedA.length, normalizedB.length);
  return Math.round((1 - distance / maxLength) * 100);
}

const TOP_MATCH_COUNT = 3;
const MIN_SCORE = 40;

/** Top-N closest existing medicines by name, for a human to pick from — never auto-applied. */
export function fuzzyMatchMedicines<T extends FuzzyMatchable>(
  candidateName: string,
  medicines: readonly T[],
): FuzzyMatch<T>[] {
  return medicines
    .map((medicine) => ({ medicine, score: similarityScore(candidateName, medicine.name) }))
    .filter((match) => match.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_MATCH_COUNT);
}
