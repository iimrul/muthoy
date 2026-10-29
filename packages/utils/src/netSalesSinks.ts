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
//
// ===========================================================================
// ROUND 11. I had applied the lesson one step short of the output AGAIN, in
// both remaining sinks, and the reviewer walked straight past both.
//
//   CHART  `netChartPoints(buckets).map((p) => ({ ...p, value: 230 }))`
//          -> the sink returned a PLAIN ARRAY and the page owned it from
//             there. A caller could also hand the panel a lying `format`, or
//             a different metric's caption. 230.00 under the net heading.
//   EXPORT `((_: string) => exportTaka(sumPaisaOf(monthSales)))(netExportTaka(total))`
//          -> the sink returned a PLAIN STRING into `values: string[]`, and
//             any string fits a string. 500.00 instead of 400.00, in the CSV
//             and the PDF, with zero TypeScript diagnostics.
//
// So "the output" is the bytes and the pixels, not the data structure handed
// to whatever writes them:
//
//   - the EXPORT cell is now OPAQUE. `netExportCell` mints a registered,
//     frozen cell; `netCellText` is the only way to read its text and it
//     verifies first. A report column declared as refund-net money is
//     resolved through that function, so a plain string standing in that
//     column is a thrown error rather than a published figure. This half is
//     enforced by the type and the register together.
//   - the CHART is closed in the admin layer, by a component shaped exactly
//     like the card that Round 11 confirmed holds: it takes opaque amounts
//     and a metric ID, and there is no prop through which a number, a
//     formatter or a caption can enter. See components/NetSalesTrend.tsx.
//     `netChartPoints` stays here, because the arithmetic belongs here, but
//     the page no longer calls it.
//
// WHAT THIS STILL DOES NOT ENFORCE, stated plainly rather than implied away:
// no type can stop a page from rendering some OTHER component and captioning
// it by hand. What IS enforced is that the canonical net caption has exactly
// one source — the §5.2 manifest, reachable for these ids only through the
// net components — and that a net AMOUNT cannot become a number or a string
// anywhere else. The source scan in apps/admin/lib/adminLabels.test.ts covers
// the remainder, and it is a review aid, not a proof.
// ===========================================================================

import {
  isNetSales,
  netSalesAmount,
  NetSalesProvenanceError,
  type NetSales,
} from './netSales';

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

declare const netExportCellBrand: unique symbol;

/**
 * A cell that may stand in an export column captioned as refund-net money.
 *
 * ROUND 11. This replaces `netExportTaka`, which returned a `string`. The
 * report row's cells are strings, and any string satisfies a string, so the
 * reviewer put an identity-shaped call between the sink and the row and
 * exported a GROSS monthly sum under the net column heading, in both the CSV
 * and the PDF, with no type error anywhere.
 *
 * Opaque for the same reason `NetSales` is: the brand does not exist at
 * runtime, so it cannot be written by hand, and authenticity is set membership
 * rather than a property a spread could copy.
 */
export interface NetExportCell {
  readonly [netExportCellBrand]: true;
}

/** The carrier. Never exported, frozen on construction. */
class NetExportCellBox {
  readonly text: string;

  constructor(text: string) {
    this.text = text;
    Object.freeze(this);
  }
}

const AUTHENTIC_CELLS = new WeakSet<NetExportCellBox>();

function mintCell(text: string): NetExportCell {
  const box = new NetExportCellBox(text);
  AUTHENTIC_CELLS.add(box);
  return box as unknown as NetExportCell;
}

/**
 * The export cell for a net amount: a PLAIN decimal, so a spreadsheet reads it
 * as a number rather than as text.
 *
 * No thousands separator and no currency symbol, deliberately: both turn the
 * cell into text. The column HEADING carries the unit, and the report
 * definition owns that heading.
 */
export function netExportCell(amount: NetSales): NetExportCell {
  const paisa = netSalesAmount(amount);
  return mintCell((Number(paisa) / 100).toFixed(2));
}

/**
 * The cell for a bucket k-anonymity withheld: EMPTY, and still authentic.
 *
 * Suppression has to be able to blank a net cell, and the alternative — letting
 * a plain `''` stand in a net column — would reopen the column to any string
 * by making the verifier accept one. So the withheld cell is minted here too,
 * and every cell in a net column is authentic without exception.
 *
 * Empty rather than a dash or a zero: a zero is a figure, and a dash in a CSV
 * is text in a numeric column.
 */
export function withheldNetCell(): NetExportCell {
  return mintCell('');
}

/** Whether a value was minted here as an export cell. */
export function isNetExportCell(value: unknown): value is NetExportCell {
  return (
    typeof value === 'object'
    && value !== null
    && AUTHENTIC_CELLS.has(value as NetExportCellBox)
  );
}

/**
 * The text inside an authentic export cell.
 *
 * THROWS for anything else, including a plain string that happens to look
 * like a figure. This is the function a report calls for every cell in a
 * column it declared as refund-net money, so the check happens at the point
 * the bytes are assembled rather than one step before it.
 */
export function netCellText(value: unknown): string {
  if (!isNetExportCell(value)) {
    throw new NetSalesProvenanceError(
      'a cell in a refund-net column was not produced by the refund-net export sink',
    );
  }
  return (value as unknown as NetExportCellBox).text;
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
