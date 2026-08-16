// domain/ocrDateNormalizer.ts — pure date-format normalization for OCR-scanned
// expiry dates. Zero React/native/DB imports (mirrors domain/fefo.ts).
//
// Format normalization ONLY — turns a raw scanned date token into a strict
// YYYY-MM-DD or null. The "must be today or later" business rule stays
// exclusively in packages/validation's isoDateSchema (docs/plans/ocr.md),
// never duplicated here: a normalizer deciding business rules would let the
// two drift out of sync.

const MAX_MONTH = 12;
const TWO_DIGIT_YEAR_BASE = 2000; // Bangladesh market: no plausible 1900s stock.

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > MAX_MONTH) {
    return false;
  }
  // Passing the 1-indexed month straight into day=0 rolls back to the last
  // day of that same month (JS Date's month is 0-indexed, so month=3 here
  // means "day 0 of April" = "last day of March" = last day of human month 3).
  const daysInMonth = new Date(year, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOfMonthIso(year: number, month: number): string | null {
  if (month < 1 || month > MAX_MONTH) {
    return null;
  }
  return toIsoDate(year, month, new Date(year, month, 0).getDate());
}

function resolveTwoDigitYear(twoDigit: number): number {
  return TWO_DIGIT_YEAR_BASE + twoDigit;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MONTH_YEAR_4 = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;
const DAY_MONTH_YEAR_2 = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/;
const MONTH_YEAR_4 = /^(\d{1,2})[/\-.](\d{4})$/;
const MONTH_YEAR_2 = /^(\d{1,2})[/\-.](\d{2})$/;

// Supported shapes (Bangladesh printing convention: day-first for ambiguous
// 3-part dates, never US MM/DD/YYYY; 2-digit years assumed 20YY):
//   YYYY-MM-DD            passthrough if a real calendar date
//   DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
//   DD/MM/YY               (2-digit year)
//   MM/YYYY, MM-YYYY       -> last day of that month (common strip format)
//   MM/YY, MM-YY            -> last day of that month, 2-digit year
// Anything else, or a calendar-invalid combination (Feb 31, month 13),
// returns null rather than guessing.
export function normalizeScannedExpiryDate(candidateText: string): string | null {
  const trimmed = candidateText.trim();

  const isoMatch = ISO_DATE.exec(trimmed);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    return isValidCalendarDate(year, month, day) ? toIsoDate(year, month, day) : null;
  }

  const dmy4 = DAY_MONTH_YEAR_4.exec(trimmed);
  if (dmy4) {
    const day = Number(dmy4[1]);
    const month = Number(dmy4[2]);
    const year = Number(dmy4[3]);
    return isValidCalendarDate(year, month, day) ? toIsoDate(year, month, day) : null;
  }

  const dmy2 = DAY_MONTH_YEAR_2.exec(trimmed);
  if (dmy2) {
    const day = Number(dmy2[1]);
    const month = Number(dmy2[2]);
    const year = resolveTwoDigitYear(Number(dmy2[3]));
    return isValidCalendarDate(year, month, day) ? toIsoDate(year, month, day) : null;
  }

  const my4 = MONTH_YEAR_4.exec(trimmed);
  if (my4) {
    return lastDayOfMonthIso(Number(my4[2]), Number(my4[1]));
  }

  const my2 = MONTH_YEAR_2.exec(trimmed);
  if (my2) {
    return lastDayOfMonthIso(resolveTwoDigitYear(Number(my2[2])), Number(my2[1]));
  }

  return null;
}
