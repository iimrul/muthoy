// Batch 3 §6i, round 10 — the SINKS that may turn a net amount into output.
//
// Round 9's redesign closed the CARD sink: a net figure reaches the Dashboard
// and Revenue tiles only as an opaque `NetSales`, verified before it is
// formatted. Round 10 then showed that was one sink out of three. The other
// two still took the shape the original defect had:
//
//   unwrap -> arbitrary number -> caption owned somewhere else
//
// and both were exploitable with the same identity-shaped call:
//
//   CHART  (bucket) => ((_: number) => 230)(Number(netSalesAmount(bucket.totalPaisa)) / 100)
//          -> the Analytics series published 230.00 under the pharmacy-net
//             caption, with zero TypeScript diagnostics;
//   EXPORT exportTaka(((_: Paisa) => sumPaisaOf(monthSales))(netSalesAmount(total)))
//          -> the CSV exported 500.00 instead of 400.00 under the column
//             heading "Pharmacy sales, net of refunds (BDT)".
//
// The lesson is the one the card already embodied, applied consistently:
// **provenance has to end at the OUTPUT, not at the unwrap.** `netSalesAmount`
// is a provenance boundary, and anything that happens after it is outside the
// guarantee. So every sink that converts a net amount for display or export
// takes the OPAQUE value and owns the conversion itself.
//
// These live in packages/utils, beside the producer, because the conversion
// they own is arithmetic rather than presentation: paisa to taka, and paisa to
// the plain decimal a spreadsheet reads as a number. The admin components wrap
// them for layout; see apps/admin/components/NetSalesCard.tsx.

import { isNetSales, netSalesAmount, type NetSales } from './netSales';

/**
 * A chart point whose value may be plotted under a net caption.
 *
 * `null` is a SUPPRESSED point, which is the k-anonymity case and distinct
 * from a provenance failure: the bucket exists and its value is withheld.
 */
export interface NetChartPoint {
  label: string;
  value: number | null;
}

/**
 * Converts net amounts into plottable taka, owning the division itself.
 *
 * The caller hands over labels and OPAQUE amounts. It cannot hand over
 * numbers, so there is nothing for an identity-shaped call to substitute: a
 * function returning 230 is not a `NetSales` and will not typecheck, and a
 * value that was never minted here fails verification and throws.
 *
 * `suppressed` marks the buckets k-anonymity withheld. They come back as
 * `null`, never as 0 — a zero would draw a cliff that is not in the data.
 */
export function netChartPoints(
  buckets: readonly { label: string; amount: NetSales; suppressed?: boolean }[],
): NetChartPoint[] {
  return buckets.map((bucket) => {
    if (bucket.suppressed === true) return { label: bucket.label, value: null };
    // Verifies, then converts. Both halves inside the sink.
    const paisa = netSalesAmount(bucket.amount);
    return { label: bucket.label, value: Number(paisa) / 100 };
  });
}

/**
 * The export cell for a net amount: a PLAIN decimal, so a spreadsheet reads it
 * as a number rather than as text.
 *
 * It owns the conversion for the same reason the chart sink does. The previous
 * shape — `exportTaka(netSalesAmount(total))` — let a caller put any `Paisa`
 * between the unwrap and the formatter, which is exactly what round 10's CSV
 * reproduction did.
 *
 * No thousands separator and no currency symbol, deliberately: both turn the
 * cell into text. The column HEADING carries the unit, and the report
 * definition owns that heading.
 */
export function netExportTaka(amount: NetSales): string {
  const paisa = netSalesAmount(amount);
  return (Number(paisa) / 100).toFixed(2);
}

/**
 * Whether a value may be handed to either sink.
 *
 * Re-exported here so a caller does not have to reach into the producer
 * module to ask, and so the sinks and the card answer the question the same
 * way.
 */
export function isRenderableNetSales(value: unknown): value is NetSales {
  return isNetSales(value);
}
