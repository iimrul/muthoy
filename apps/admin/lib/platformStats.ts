// Pure, framework-free logic for the two Day-14 pages (DEVELOPMENT_RULES.md:
// business logic lives in pure functions, testable without rendering a screen).
// Nothing here imports Next, React, or Supabase — so nothing here can leak the
// service-role key, and all of it is unit-tested.

import { ZERO_PAISA, addPaisa, asPaisa, type Paisa } from '@muthoy/types';

// Bangladesh is a fixed UTC+06:00 offset with no DST (its only trial ended in
// 2009), so the platform's "today" is a fixed-offset calendar day. The admin
// server runs in UTC on Vercel, so a naive UTC day boundary would roll over at
// 6:00am Dhaka and report six hours of the wrong day's sales.
const DHAKA_UTC_OFFSET_MINUTES = 6 * 60;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const DHAKA_OFFSET_MS = DHAKA_UTC_OFFSET_MINUTES * MINUTE_MS;

export interface DhakaDayRange {
  /** The Dhaka calendar day as YYYY-MM-DD — same shape as the mobile business date. */
  businessDate: string;
  /** UTC instant of 00:00 Dhaka on that day, inclusive. */
  startInclusive: string;
  /** UTC instant of 00:00 Dhaka on the NEXT day, exclusive. */
  endExclusive: string;
}

/** One pharmacy row, exactly the four columns Volume 5's P0 list specifies. */
export interface PharmacyRow {
  id: string;
  name: string;
  phone: string;
  /** ISO-8601 UTC timestamp of `shops.created_at`. */
  registeredAt: string;
  plan: string;
}

/** The dashboard's two numbers, plus the day they were computed for. */
export interface PlatformStats {
  totalShops: number;
  totalSalesToday: Paisa;
  day: DhakaDayRange;
}

/** A `sales` row narrowed to the only column the dashboard total needs. */
export interface SaleTotalRow {
  total: number;
}

const EMPTY_VALUE = '—';

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

export function dhakaDayRange(now: Date = new Date()): DhakaDayRange {
  const shifted = new Date(now.getTime() + DHAKA_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const monthIndex = shifted.getUTCMonth();
  const dayOfMonth = shifted.getUTCDate();
  const startMs = Date.UTC(year, monthIndex, dayOfMonth) - DHAKA_OFFSET_MS;

  return {
    businessDate: `${year}-${padTwo(monthIndex + 1)}-${padTwo(dayOfMonth)}`,
    startInclusive: new Date(startMs).toISOString(),
    endExclusive: new Date(startMs + DAY_MS).toISOString(),
  };
}

/**
 * Sums `sales.total` in integer paisa. Goes through asPaisa/addPaisa so a
 * non-integer coming back from Postgres throws instead of silently seeding
 * float drift into a money figure (packages/types/money.ts).
 */
export function sumSaleTotals(rows: readonly SaleTotalRow[]): Paisa {
  return rows.reduce<Paisa>((runningTotal, row) => addPaisa(runningTotal, asPaisa(row.total)), ZERO_PAISA);
}

const REGISTRATION_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dhaka',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/** Renders `shops.created_at` in the shop owner's own timezone, not the server's. */
export function formatRegistrationDate(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return EMPTY_VALUE;
  }
  return REGISTRATION_DATE_FORMAT.format(parsed);
}

/** `shops.plan` is free text in the schema; display it without inventing plan names. */
export function formatPlan(plan: string): string {
  const trimmed = plan.trim();
  if (trimmed.length === 0) {
    return EMPTY_VALUE;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** `shops.phone` is NOT NULL in the schema, but guard against an empty string. */
export function formatPhone(phone: string): string {
  const trimmed = phone.trim();
  return trimmed.length === 0 ? EMPTY_VALUE : trimmed;
}
