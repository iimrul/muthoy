// Batch 3 §6i round 11 — the ONLY component that plots a refund-net series.
//
// WHY THIS EXISTS, and why `netChartPoints` alone was not enough.
//
// Round 10 moved the chart's paisa-to-taka conversion into a sink that takes
// opaque amounts, which closed the substitution the reviewer had used. Round
// 11 then showed the sink stopped one step short of the output: it returned a
// PLAIN ARRAY, and the page owned everything after that.
//
//   points: netChartPoints(salesBuckets).map((point) => ({
//     ...point,
//     value: point.value === null ? null : 230,
//   })),
//
// compiled and plotted 230.00 under the canonical net heading. Two more of the
// same shape worked for the same reason: `format={(_value) => "230.00"}`
// falsified the table beside the chart, and swapping the heading for
// `requireMetric('mrr').label` put authentic net money under "Monthly
// recurring run rate".
//
// All three worked because the PAGE held the points, the formatter and the
// caption. So this component holds all three instead, in exactly the shape of
// `NetSalesCard`, which the same review confirmed holds:
//
//   - the only way IN is a list of opaque `NetSales` amounts with labels.
//     There is no points prop, no value prop, no number anywhere in the
//     surface, so there is nothing for an identity-shaped call to substitute;
//   - the CAPTION, the series name and the description come from the §5.2
//     manifest entry this component resolves itself from a restricted ID;
//   - the FORMATTER is internal and runs after verification;
//   - a SUPPRESSED bucket is `null`, which the panel renders as an em dash in
//     the table and a gap in the line — never a zero, which would draw a
//     cliff that is not in the data.
//
// WHAT IT DOES NOT ENFORCE. No type stops a page from rendering some other
// chart and typing a net caption into it by hand. What is enforced is that
// these two metric ids resolve to their canonical words in exactly one place,
// and that a `NetSales` cannot become a number anywhere else. The scan in
// lib/adminLabels.test.ts covers the remainder and is a review aid, not a
// proof — §6i's whole history is that a scan cannot be the guarantee.

import { netChartPoints, type NetSales } from '@muthoy/utils';
import ChartPanel from './charts/ChartPanel';
import { requirePharmacySalesMetric, type NetSalesMetricId } from '../lib/adminMetrics';

/** One bucket: a period label, its opaque net amount, and its k-anonymity verdict. */
export interface NetSalesBucket {
  label: string;
  amount: NetSales;
  /** True when fewer than k pharmacies contributed, so the value is withheld. */
  suppressed: boolean;
}

interface NetSalesTrendProps {
  /**
   * WHICH §5.2 entry this series is — an ID, not the entry and not a caption.
   *
   * Same reasoning as `NetSalesCard`: an object prop is an indirect caption
   * prop, and a string caption prop is a direct one. The union rejects a
   * foreign metric at compile time and the resolver re-checks the family at
   * runtime.
   */
  metricId: NetSalesMetricId;
  /** The buckets, in the order they should be plotted. */
  buckets: readonly NetSalesBucket[];
  /** The period noun for the heading. */
  grain: 'day' | 'month';
  /** What the empty state says when there is no bucket at all. */
  emptyMessage: string;
}

export default function NetSalesTrend({
  metricId,
  buckets,
  grain,
  emptyMessage,
}: NetSalesTrendProps) {
  // Resolved HERE, from the manifest, so neither the heading nor the series
  // name can be supplied or edited by a caller.
  const metric = requirePharmacySalesMetric(metricId);

  // Verifies every bucket and owns the division. An amount that did not come
  // from the refund-net calculation throws rather than plotting.
  const points = netChartPoints(buckets);

  return (
    <ChartPanel
      heading={metric.label + ', by ' + grain}
      // The family is named in the description as well as the label: this is a
      // PHARMACY's takings, not Muthoy's money, and the two are never added
      // together.
      description={
        'Refund-subtracted takings across pharmacies, in taka. This is the pharmacies’ own '
        + 'money, not Muthoy’s — Muthoy’s own figures are on the billing page.'
      }
      kind="trend"
      points={points}
      valueLabel="Taka"
      // CLAUDE.md rule 6: decided from the metric's own unit, not a caller's flag.
      isMoney={metric.unit === 'paisa'}
      withheld={buckets.filter((bucket) => bucket.suppressed).length}
      emptyMessage={emptyMessage}
      // Internal, and applied only to values this component converted itself.
      format={(value) => value.toFixed(2)}
    />
  );
}
