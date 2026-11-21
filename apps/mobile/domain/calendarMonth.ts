// domain/calendarMonth.ts — the date arithmetic behind the in-app calendar
// (components/ui/DateField.tsx). Dates stay the "YYYY-MM-DD" strings every date
// field already stores; this file only turns them into a month grid and back.
// All arithmetic is done in UTC so the device time zone can never shift a day.

export interface CalendarMonth {
  year: number;
  /** 0 = January … 11 = December. */
  month: number;
}

export interface CalendarDay {
  iso: string;
  day: number;
  isInMonth: boolean;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Six weeks always: the sheet keeps one height whatever the month. */
const GRID_WEEKS = 6;

const pad = (value: number) => String(value).padStart(2, "0");

export function toIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${pad(month + 1)}-${pad(day)}`;
}

/** A real calendar date only — "2026-02-30" and "2026-13-01" are null. */
export function parseIsoDate(value: string): (CalendarMonth & { day: number }) | null {
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function shiftMonth({ year, month }: CalendarMonth, delta: number): CalendarMonth {
  const date = new Date(Date.UTC(year, month + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

/**
 * The month as 6 weeks of 7 days, starting on `weekStartsOn` (0 = Sunday,
 * 6 = Saturday). Days from the neighbouring months fill the first and last
 * weeks and are marked isInMonth = false.
 */
export function monthGrid({ year, month }: CalendarMonth, weekStartsOn = 0): CalendarDay[][] {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const leading = (firstWeekday - weekStartsOn + 7) % 7;
  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < GRID_WEEKS; week += 1) {
    const days: CalendarDay[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = new Date(Date.UTC(year, month, 1 - leading + week * 7 + weekday));
      days.push({
        iso: toIsoDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
        day: date.getUTCDate(),
        isInMonth: date.getUTCMonth() === month,
      });
    }
    weeks.push(days);
  }
  return weeks;
}

/** Inclusive bounds; an absent bound does not limit. ISO strings compare in date order. */
export function isDateInRange(iso: string, minDate?: string, maxDate?: string): boolean {
  if (minDate && iso < minDate) return false;
  if (maxDate && iso > maxDate) return false;
  return true;
}
