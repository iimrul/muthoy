// Pure, framework-free logic for the two Day-14 pages (DEVELOPMENT_RULES.md:
// business logic lives in pure functions, testable without rendering a screen).
// Nothing here imports Next, React, or Supabase — so nothing here can leak the
// service-role key, and all of it is unit-tested.

import { ZERO_PAISA, addPaisa, asPaisa, type Paisa } from '@muthoy/types';
import { type NetSales } from '@muthoy/utils';

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
  /** W4-07: 'active' or 'read_only' — the commercial gate the device enforces. */
  commercialStatus: string;
}

/**
 * The dashboard's figures, plus the day they were computed for.
 *
 * W4-04: the headline is now REFUND-NET. All three parts are carried rather
 * than just the net one, because a founder looking at a smaller number than
 * yesterday needs to see whether sales fell or refunds rose — and a single net
 * figure with no composition is the kind of number people stop trusting and
 * then stop reading.
 */
export interface PlatformStats {
  totalShops: number;
  grossSalesToday: Paisa;
  /**
   * ROUND 7 FINDING 1: NULL when the refunds were not read at all.
   *
   * Not zero. A zero would make `netSalesToday` equal the GROSS and leave it
   * looking like an ordinary net figure -- which is the defect class rounds 9
   * to 15 spent five rounds closing. `null` makes the absence a thing the type
   * system forces every reader to handle.
   */
  refundsToday: Paisa | null;
  /**
   * grossSalesToday − refundsToday, via the shared @muthoy/utils definition.
   *
   * §6i: an OPAQUE `NetSales`, not a `Paisa`. A plain number here is what let
   * Gate 5 round 9 render gross under the net caption -- both by assigning
   * over the field (`Object.assign` with a name built as `'net' + 'SalesToday'`)
   * and by laundering the value through an identity-shaped call. The renderer
   * verifies provenance before it formats, so neither substitution survives.
   */
  netSalesToday: NetSales | null;
  /**
   * The DISTINCT pharmacies that SOLD today, and separately those that
   * REFUNDED today.
   *
   * ROUND 11 FINDING 1 added a contributor set, because the Dashboard had none
   * and published a one-pharmacy figure that Analytics withheld. ROUND 12
   * FINDING 2 then showed I had made it a UNION, which is the per-value
   * mistake Gate 5 finding 4 already found once:
   *
   *   one pharmacy sells ৳100; four others refund ৳10 each
   *   -> five NET contributors, so the union cleared the floor
   *   -> published "Pharmacies active today: 1", gross ৳100.00 and
   *      refunds ৳40.00. One identifiable pharmacy's takings.
   *
   * Five contributors to the net figure are not five contributors to gross, to
   * refunds, or to today's activity. Each side therefore carries its own set,
   * and `app/page.tsx` releases nothing unless every NON-EMPTY side clears the
   * floor on its own — because gross less refunds is the net figure, and any
   * two of the three give the third.
   *
   * These ids are never rendered. They exist to be counted.
   */
  saleContributorShopIds: readonly string[];
  refundContributorShopIds: readonly string[];
  day: DhakaDayRange;
}

/** A `sales` row narrowed to the columns the dashboard total and its gate need. */
export interface SaleTotalRow {
  total: number;
  shop_id: string;
}

/** A `sale_refunds` row narrowed the same way. */
export interface SaleRefundTotalRow {
  total_amount: number;
  shop_id: string;
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
export function sumSaleTotals(rows: readonly { total: number }[]): Paisa {
  return rows.reduce<Paisa>((runningTotal, row) => addPaisa(runningTotal, asPaisa(row.total)), ZERO_PAISA);
}

/**
 * Sums `sale_refunds.total_amount` in integer paisa, the same way and with the
 * same guard.
 *
 * A SEPARATE function rather than a generic summer over a column name: the two
 * tables use different column names (`total` vs `total_amount`), and a helper
 * that took the column as a string would let a caller sum the wrong one without
 * the type system noticing. The duplication here is four tokens; the bug it
 * prevents is a revenue figure that is silently gross.
 */
export function sumRefundTotals(rows: readonly { total_amount: number }[]): Paisa {
  return rows.reduce<Paisa>(
    (runningTotal, row) => addPaisa(runningTotal, asPaisa(row.total_amount)),
    ZERO_PAISA,
  );
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
