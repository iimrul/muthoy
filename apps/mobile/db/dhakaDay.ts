import { DHAKA_SQL_OFFSET } from "@muthoy/utils";

// db/dhakaDay.ts — "this row was written on Dhaka business day X", in a form
// SQLite can answer from a (shop_id, created_at) index.
//
// `date(created_at, '+6 hours') = $day` is the rule the whole app uses for
// "which business day" (packages/utils/businessDate.ts). SQLite cannot use an
// index through a function call, so on its own that rule reads every row the
// shop ever wrote — the dashboard got slower every day the shop traded. A plain
// range on the raw column is put IN FRONT of it. The range is a day wider than
// the Dhaka day on each side, so it can never drop a row the exact rule keeps;
// the exact rule is still applied to every row and still decides.
// Founder-approved (CLAUDE.md rule 10): docs/plans/perf-ux-round-2-2026-11-21.md.
//
// Relies on created_at being ISO-8601 TEXT starting "YYYY-MM-DD" (any UTC
// offset up to ±14h), which every table stores (db/schema.ts); the test pins it.

/**
 * SQL for "`column` falls on Dhaka business day `day`". `day` is SQL too: a
 * bound parameter such as `$businessDate`, or an expression such as
 * `date('now', '+6 hours')`.
 */
export function onDhakaDay(column: string, day: string): string {
  return (
    `${column} >= date(${day}, '-1 day') AND ${column} < date(${day}, '+2 days') ` +
    `AND date(${column}, '${DHAKA_SQL_OFFSET}') = ${day}`
  );
}
