// domain/dashboard.ts — pure Owner Dashboard maths. Zero React, zero DB
// imports (DEVELOPMENT_RULES.md): db/ownerDashboard.ts fetches the rows and
// hands them here.
//
// CLAUDE.md rule 4: nothing in this file re-derives the cash formula —
// domain/cashFormula.ts owns it and this module never touches its terms.
// Every money value stays branded integer paisa.

import { asPaisa, ZERO_PAISA, type Paisa } from "@muthoy/types";

/** Founder decision 1 (owner-dashboard-parity-recovery.md): 3 rows per alert. */
export const ALERT_PREVIEW_ROWS = 3;

/** Founder decision 2: synced credit period, mirrored by shop_b2_settings. */
export const DEFAULT_CREDIT_MAX_DAYS = 7;

/** Shared cap for every dashboard notification badge. */
export const UNREAD_BADGE_CAP = 10;

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

export type GreetingKey =
  | "goodMorning"
  | "goodAfternoon"
  | "goodEvening"
  | "goodNight";

export function formatUnreadBadge(
  unread: number,
  formatNumber: (value: number) => string,
): string {
  if (!Number.isInteger(unread) || unread < 0) {
    throw new Error("Unread count must be a non-negative integer");
  }
  if (unread === 0) return "";
  return unread >= UNREAD_BADGE_CAP
    ? `${formatNumber(UNREAD_BADGE_CAP)}+`
    : formatNumber(unread);
}

/**
 * The prototype MorningDashboard's exact bands: 5–12 morning, 12–17 afternoon,
 * 17–19 evening, everything else night. The previous production screen used
 * `<12 / <17 / <20`, which greeted 19:30 as evening instead of night.
 */
export function greetingKeyForHour(hour: number): GreetingKey {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("Greeting hour must be an integer between 0 and 23");
  }
  if (hour >= 5 && hour < 12) return "goodMorning";
  if (hour >= 12 && hour < 17) return "goodAfternoon";
  if (hour >= 17 && hour < 19) return "goodEvening";
  return "goodNight";
}

export type RelativeTimeUnit = "justNow" | "minutes" | "hours" | "days";

export interface RelativeTime {
  unit: RelativeTimeUnit;
  /** Whole units elapsed. Always 0 for `justNow`. */
  value: number;
}

/**
 * Recent Activity's age label. A clock-skewed future timestamp reads as
 * "just now" rather than a negative count.
 */
export function relativeTime(timestamp: string, now: Date): RelativeTime {
  const elapsed = now.getTime() - new Date(timestamp).getTime();
  if (!Number.isFinite(elapsed)) {
    throw new Error(
      `relativeTime received an unparseable timestamp: ${timestamp}`,
    );
  }
  if (elapsed < MS_PER_MINUTE) return { unit: "justNow", value: 0 };
  if (elapsed < MS_PER_HOUR) {
    return { unit: "minutes", value: Math.floor(elapsed / MS_PER_MINUTE) };
  }
  if (elapsed < MS_PER_DAY) {
    return { unit: "hours", value: Math.floor(elapsed / MS_PER_HOUR) };
  }
  return { unit: "days", value: Math.floor(elapsed / MS_PER_DAY) };
}

export interface AlertPreview<T> {
  rows: T[];
  /** Rows not shown. Counted against the TRUE total, not a capped page. */
  moreCount: number;
}

/**
 * Founder decision 1. The prototype capped its source list at 5 and then
 * rendered 2, so its "+N more" could never exceed +3 no matter how many
 * batches were expiring. `total` here is the unbounded COUNT from SQLite, so
 * 40 expiring batches read "+37 more".
 */
export function alertPreview<T>(
  items: readonly T[],
  total: number,
  max: number = ALERT_PREVIEW_ROWS,
): AlertPreview<T> {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error("Alert total must be a non-negative integer");
  }
  if (!Number.isInteger(max) || max < 1) {
    throw new Error("Alert preview size must be a positive integer");
  }
  const rows = items.slice(0, max);
  return { rows, moreCount: Math.max(0, total - rows.length) };
}

export interface Trend {
  /** Absolute whole-percent change. Direction lives in `isUp`. */
  percent: number;
  isUp: boolean;
}

/**
 * Day-over-day movement. Returns null when the comparison day sold nothing —
 * there is no meaningful percentage against a zero base, and the prototype
 * hides the line in exactly that case.
 */
export function trendPercent(current: Paisa, previous: Paisa): Trend | null {
  if (previous <= 0) return null;
  const difference = current - previous;
  return {
    percent: Math.abs(Math.round((difference / previous) * 100)),
    isUp: difference >= 0,
  };
}

/** Mean bill. Integer paisa in, integer paisa out — no float money escapes. */
export function averageSale(total: Paisa, count: number): Paisa {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("Transaction count must be a non-negative integer");
  }
  if (count === 0) return ZERO_PAISA;
  return asPaisa(Math.round(total / count));
}

/**
 * Shift a local business date (`YYYY-MM-DD`) by whole days. Uses UTC epoch
 * maths on the date parts only, so it cannot drift across a DST boundary the
 * way `new Date(...).setDate(...)` on a local timestamp can.
 */
export function shiftBusinessDate(businessDate: string, days: number): string {
  if (!BUSINESS_DATE_PATTERN.test(businessDate)) {
    throw new Error(
      `Business date must be YYYY-MM-DD, received: ${businessDate}`,
    );
  }
  if (!Number.isInteger(days)) {
    throw new Error("Business date shift must be a whole number of days");
  }
  const year = Number(businessDate.slice(0, 4));
  const month = Number(businessDate.slice(5, 7));
  const day = Number(businessDate.slice(8, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * MS_PER_DAY);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Exclusive boundary for overdue dues: a credit whose local creation date is
 * STRICTLY BEFORE the returned date is overdue. Inclusive through
 * `created + creditMaxDays`, matching how `max_refund_days` already reads.
 */
export function overdueBeforeDate(
  today: string,
  creditMaxDays: number,
): string {
  if (!Number.isInteger(creditMaxDays) || creditMaxDays < 0) {
    throw new Error(
      "Credit period must be a non-negative whole number of days",
    );
  }
  return shiftBusinessDate(today, -creditMaxDays);
}
