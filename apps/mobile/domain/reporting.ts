export interface DateRange {
  startDate: string;
  endDate: string;
}

export function reportHasActivity(totals: {
  transactions: number;
  refundsCount: number;
  expenses: number;
}): boolean {
  return totals.transactions > 0 || totals.refundsCount > 0 || totals.expenses !== 0;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function utcDate(value: string): Date {
  if (!ISO_DATE.test(value)) throw new Error('Date must use YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date');
  return date;
}

export function assertDateRange(range: DateRange): void {
  const start = utcDate(range.startDate);
  const end = utcDate(range.endDate);
  if (start > end) throw new Error('Start date must not be after end date');
}

export function addDays(value: string, days: number): string {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysInclusive(range: DateRange): number {
  assertDateRange(range);
  return Math.round((utcDate(range.endDate).getTime() - utcDate(range.startDate).getTime()) / 86_400_000) + 1;
}

export function previousRange(range: DateRange): DateRange {
  const count = daysInclusive(range);
  return { startDate: addDays(range.startDate, -count), endDate: addDays(range.startDate, -1) };
}

/** UTC ISO bounds for indexed created_at reads that belong to Dhaka business dates. */
export function dhakaUtcBounds(range: DateRange): { startUtc: string; endExclusiveUtc: string } {
  assertDateRange(range);
  return {
    startUtc: new Date(`${range.startDate}T00:00:00+06:00`).toISOString(),
    endExclusiveUtc: new Date(`${addDays(range.endDate, 1)}T00:00:00+06:00`).toISOString(),
  };
}

export function monthRange(yearMonth: string): DateRange {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new Error('Month must use YYYY-MM');
  const startDate = `${yearMonth}-01`;
  utcDate(startDate);
  const next = new Date(`${startDate}T00:00:00.000Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { startDate, endDate: addDays(next.toISOString().slice(0, 10), -1) };
}

export function monthKey(value: string, offset: number): string {
  const date = utcDate(`${value.slice(0, 7)}-01`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

/** Basis points; null means the previous period was zero and no ratio exists. */
export function percentChangeBp(current: number, previous: number): number | null {
  if (!Number.isInteger(current) || !Number.isInteger(previous)) throw new Error('Report totals must be integer paisa');
  if (previous === 0) return null;
  const numerator = BigInt(current - previous) * 10_000n;
  const denominator = BigInt(Math.abs(previous));
  const magnitude = (numerator < 0n ? -numerator : numerator) + denominator / 2n;
  const rounded = magnitude / denominator;
  return Number(numerator < 0n ? -rounded : rounded);
}
