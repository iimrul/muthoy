const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * SQLite `date()`/`strftime()` modifier equivalent to `dhakaBusinessDate`'s
 * offset — pure UTC arithmetic, unlike `'localtime'` which converts through
 * the device's OS timezone. Use this (never `'localtime'`) whenever raw SQL
 * derives a business date from `created_at`, so a query matches exactly what
 * `dhakaBusinessDate`/`dhakaHour` computed in JS for the same instant,
 * regardless of the device's configured timezone.
 */
export const DHAKA_SQL_OFFSET = '+6 hours';

export function assertIsoDate(value: string): void {
  const match = ISO_DATE.exec(value);
  if (!match) throw new Error(`Invalid ISO date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
}

/** Bangladesh has used UTC+06:00 without DST since 2010. */
export function dhakaBusinessDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid date');
  return new Date(now.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Current wall-clock hour in Asia/Dhaka, independent of device timezone. */
export function dhakaHour(now: Date): number {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid date');
  return new Date(now.getTime() + DHAKA_OFFSET_MS).getUTCHours();
}

export function isBeforeDhakaClosing(now: Date, closingHour: number): boolean {
  assertClosingHour(closingHour);
  return dhakaHour(now) < closingHour;
}

/** Next absolute instant at which the Asia/Dhaka shop clock reaches closing. */
export function nextDhakaClosingInstant(now: Date, closingHour: number): Date {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid date');
  assertClosingHour(closingHour);
  const dhakaNow = new Date(now.getTime() + DHAKA_OFFSET_MS);
  let candidate =
    Date.UTC(
      dhakaNow.getUTCFullYear(),
      dhakaNow.getUTCMonth(),
      dhakaNow.getUTCDate(),
      closingHour,
    ) - DHAKA_OFFSET_MS;
  if (candidate <= now.getTime()) candidate += DAY_MS;
  return new Date(candidate);
}

/** Convert the next Dhaka closing instant for Expo's device-local DAILY trigger. */
export function deviceDailyTriggerForDhakaClosing(
  now: Date,
  closingHour: number,
): { hour: number; minute: number } {
  const next = nextDhakaClosingInstant(now, closingHour);
  return { hour: next.getHours(), minute: next.getMinutes() };
}

function assertClosingHour(closingHour: number): void {
  if (!Number.isInteger(closingHour) || closingHour < 0 || closingHour > 23) {
    throw new Error('Closing hour must be between 0 and 23');
  }
}

export function businessDateDifference(later: string, earlier: string): number {
  assertIsoDate(later);
  assertIsoDate(earlier);
  return (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000;
}
