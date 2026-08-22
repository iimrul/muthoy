// Days-until-expiry — Volume 2's date/expiry helpers live here, alongside
// formatMoney/formatNumber, so both apps compute it identically. Always
// recomputed from the real expiry date at call time (CLAUDE.md rule 3) —
// never persist the result.

/**
 * Whole days from `now` until `isoDate` (e.g. "2027-03-31"). Negative once
 * the date is in the past. `null` in (no expiry recorded, per db/schema.ts's
 * nullable batches.expiry_date) always yields `null` out.
 */
export function daysUntilExpiry(
  isoDate: string | null,
  now: Date,
): number | null {
  if (isoDate === null) {
    return null;
  }

  const dhakaToday = new Date(now.getTime() + 6 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return (
    (Date.parse(`${isoDate}T00:00:00Z`) -
      Date.parse(`${dhakaToday}T00:00:00Z`)) /
    86_400_000
  );
}
