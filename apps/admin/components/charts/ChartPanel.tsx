// Batch 3 §8 — a chart and the SAME NUMBERS as a table, in one region.
//
// A Server Component: it renders the heading, the figures and the suppression
// note in the initial HTML, and only the drawn chart arrives with JavaScript.
//
// WHY THE TABLE IS NOT OPTIONAL. The founder cannot read code and reads
// figures; a chart is a shape, and a shape is not a number. The table is also
// what makes the region usable by a screen reader and legible before any
// JavaScript runs, so the chart is an addition to the page rather than the
// page's only content. `aria-hidden` on the chart keeps a reader from meeting
// the same series twice.
//
// A SUPPRESSED BUCKET IS AN EM DASH IN THE TABLE AND ABSENT FROM THE CHART.
// Those are the two right answers for the two media: a table cell can say
// "withheld", and a line cannot, so plotting a gap as zero would draw a cliff
// that is not in the data.

import { moneyWithholdingReason } from '../../lib/adminSuppression';
import { EMPTY_VALUE } from '../../lib/adminViews';

/**
 * ROUND 5 FINDINGS 2 AND 3 — THE MONEY REASON BELONGS TO MONEY ONLY.
 *
 * Round 4 gave this panel the shared money explanation and I applied it to
 * every chart, so a COUNT chart gated by k said "immutable snapshots" -- the
 * revision policy does not govern counts, and a five-shop control publishes
 * its count under that same policy. Meanwhile the money TABLE CELL below kept
 * the floor sentence, so this file managed to be wrong in both directions at
 * once.
 *
 * `isMoney` already distinguishes them, for CLAUDE.md rule 6's font. It is the
 * same distinction.
 */
const withheldExplanationFor = (isMoney: boolean) => (floorReason: string) =>
  isMoney ? moneyWithholdingReason(floorReason) : floorReason;
import ChartLoader, { type ChartKind } from './ChartLoader';
import type { ChartPoint } from './PlatformCharts';

interface ChartPanelProps {
  heading: string;
  /** What the series is, in words. Rendered under the heading. */
  description: string;
  kind: ChartKind;
  points: readonly ChartPoint[];
  /** The column heading for the value, and the chart's series name. */
  valueLabel: string;
  /** True when the values are money, so they render in DM Mono (rule 6). */
  isMoney?: boolean;
  /** What the empty state says when there is nothing to plot at all. */
  emptyMessage: string;
  /** How many buckets k-anonymity withheld. Stated, never hidden. */
  withheld?: number;
  /** Renders the value cell. Defaults to the plain number. */
  format?: (value: number) => string;
}

export default function ChartPanel({
  heading,
  description,
  kind,
  points,
  valueLabel,
  isMoney = false,
  emptyMessage,
  withheld = 0,
  format,
}: ChartPanelProps) {
  const headingId = 'chart-' + heading.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const withheldExplanation = withheldExplanationFor(isMoney);
  const hasPlottable = points.some((point) => point.value !== null);
  const render = format ?? ((value: number) => String(value));

  return (
    <section aria-labelledby={headingId} className="rounded border border-black/10 bg-white p-4">
      <h2 id={headingId} className="text-base font-semibold">
        {heading}
      </h2>
      <p className="mt-1 text-sm text-midGray">{description}</p>

      {points.length === 0 ? (
        <p role="status" className="mt-4 text-sm text-midGray">
          {emptyMessage}
        </p>
      ) : (
        <>
          {hasPlottable ? (
            // Hidden from assistive technology: the table below carries the
            // same series, and announcing both reads every figure twice.
            <div className="mt-4" aria-hidden="true">
              <ChartLoader kind={kind} points={points} valueLabel={valueLabel} />
            </div>
          ) : (
            <p role="status" className="mt-4 text-sm text-midGray">
              Every bucket in this range was withheld, so there is nothing to plot.
            </p>
          )}

          {withheld > 0 ? (
            <p className="mt-2 text-xs text-midGray">
              {withheld} {withheld === 1 ? 'bucket was' : 'buckets were'} withheld.{' '}
              {withheldExplanation(
                'Fewer than five pharmacies contributed to '
                + (withheld === 1 ? 'it' : 'them')
                + '.',
              )}
            </p>
          ) : null}

          <table className="mt-4 w-full text-sm">
            <caption className="sr-only">
              {heading}. {description}
            </caption>
            <thead>
              <tr className="border-b border-black/10 text-left">
                <th scope="col" className="py-1 font-medium">
                  Period
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {valueLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.label} className="border-b border-black/5">
                  <th scope="row" className="py-1 text-left font-normal">
                    {point.label}
                  </th>
                  <td
                    // CLAUDE.md rule 6: money in the DM Mono variable, every
                    // other number in Plus Jakarta Sans. Never a font string.
                    className={
                      'py-1 text-right ' + (isMoney ? 'font-mono tabular-nums' : 'tabular-nums')
                    }
                  >
                    {point.value === null ? (
                      <span
                        title={withheldExplanation(
                          'Withheld: fewer than five pharmacies contributed.',
                        )}
                      >
                        {EMPTY_VALUE}
                      </span>
                    ) : (
                      render(point.value)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
