// Batch 3 §6i — the ONLY component that renders a refund-net pharmacy figure.
//
// WHY A SEPARATE COMPONENT, rather than a flag on StatCard or MetricTile.
//
// Gate 5 round 9 put the wrong money under a pharmacy-net caption three ways,
// through the real pages, confirmed by SSR. Two of them worked because the
// CALLER owned the pairing:
//
//   - `StatCard` took a free-form `label` and an already-formatted `value`, so
//     `((_: string) => formatMoney(stats.grossSalesToday))(formatMoney(stats.netSalesToday))`
//     handed it a gross string under a net label and nothing noticed;
//   - `Object.assign(stats, { ['net' + 'SalesToday']: stats.grossSalesToday })`
//     replaced the field itself, so even a correct call site rendered gross.
//
// A guard over the source could not see either: the first launders the value
// across a call boundary, and the second builds the property name from two
// string literals, which no name-based scan can match. Nine review rounds
// established that empirically.
//
// So the pairing is owned HERE. This component takes the amount and the metric
// and does the rest itself:
//
//   - the CAPTION comes from the §5.2 manifest entry, never from a prop. A
//     caller cannot relabel the figure, and cannot caption a different figure
//     as net;
//   - the FORMATTING happens inside, after verification. A caller cannot pass
//     a formatted string at all, which is what closes reproduction C
//     structurally rather than by inspection;
//   - the METRIC is restricted to the `pharmacy_sales` family by its type, so
//     this card cannot be pointed at a subscription or count metric;
//   - the AMOUNT must be an authentic `NetSales`. The type rejects a number or
//     a string at compile time, and `isNetSales` rejects a substituted value at
//     runtime, which is what closes reproduction A — the only one no static
//     check can reach.
//
// FAIL CLOSED. An unauthenticated amount renders a visible, role="alert"
// provenance failure and NO figure. It does not fall back to zero, to an em
// dash, or to the caller's value: each of those would put a plausible number
// under the caption, which is the outcome this whole exercise exists to stop.

import { formatMoney, isNetSales, netSalesAmount, type NetSales } from '@muthoy/utils';
import { requirePharmacySalesMetric, type NetSalesMetricId } from '../lib/adminMetrics';

interface NetSalesCardProps {
  /**
   * WHICH §5.2 entry to render — an ID, not the entry itself.
   *
   * GATE 5 ROUND 10. This used to take the `Metric` OBJECT, which made it an
   * indirect caption prop: a spread was enough to keep the family and replace
   * the words, and the reviewer rendered an authentic net figure under the
   * subscription caption with
   *
   *   metric={{ ...requirePharmacySalesMetric('pharmacy_sales_net_today'),
   *             label: 'Monthly recurring run rate' }}
   *
   * which compiled cleanly and passed the amount check. Assigning a different
   * family's entry over a props object did the same.
   *
   * So the card now takes one of two literal IDs and RESOLVES the canonical
   * entry itself. A caller cannot supply a label, cannot edit one, and cannot
   * name a metric outside the pharmacy-takings family — the union rejects it
   * at compile time and the resolver re-checks the family at runtime.
   */
  metricId: NetSalesMetricId;
  /**
   * The amount, as produced by `netSalesPaisa` or `sumNetSales`.
   *
   * Typed `NetSales` so a gross `Paisa`, a collected total or a formatted
   * string is a COMPILE error, and verified at runtime so a value assigned
   * over the field is a RENDER failure.
   */
  amount: NetSales;
  /**
   * Composition, for the reader who needs to know why the number moved: the
   * gross and refund sides, already formatted, plus the business date. It is
   * deliberately NOT the figure itself — nothing here can become the headline.
   */
  composition?: string;
  /** Rendered instead of the amount when k-anonymity withheld it. */
  withheld?: boolean;
}

/**
 * The provenance failure state.
 *
 * Visible rather than silent, and `role="alert"` so it reaches a screen reader
 * too. An operator seeing this is seeing a real defect: some code path put a
 * value into a net field that the refund-net calculation did not produce.
 */
function ProvenanceFailure({ label }: { label: string }) {
  return (
    <section className="rounded-xl border border-red-300 bg-red-50 p-5">
      <h2 className="text-sm font-medium text-richBlack">{label}</h2>
      <p role="alert" className="mt-2 text-sm text-richBlack">
        This figure is unavailable: the value reaching this card was not produced by the
        refund-net calculation, so it is not shown. This is a defect, not an empty state —
        please report it.
      </p>
    </section>
  );
}

export default function NetSalesCard({
  metricId,
  amount,
  composition,
  withheld = false,
}: NetSalesCardProps) {
  // Resolved HERE, from the manifest, so the caption cannot be supplied or
  // edited by a caller. `requirePharmacySalesMetric` throws if the id is not
  // in the manifest or is not in the pharmacy-takings family.
  const metric = requirePharmacySalesMetric(metricId);

  // The runtime half. Reproduction A reaches exactly here: the field was
  // overwritten with a gross number, the types never saw it, and this is what
  // refuses it.
  if (!isNetSales(amount)) return <ProvenanceFailure label={metric.label} />;

  // CLAUDE.md rule 6: money in the DM Mono variable. Decided here from the
  // metric's own unit, not from a caller's flag.
  const isMoney = metric.unit === 'paisa';

  return (
    <section className="rounded-xl border border-black/10 p-5">
      <h2 className="text-sm font-medium text-midGray">{metric.label}</h2>
      <p
        className={
          'mt-2 text-3xl text-richBlack '
          + (isMoney ? 'font-mono' : 'font-sans font-semibold')
        }
      >
        {withheld ? '—' : formatMoney(netSalesAmount(amount))}
      </p>
      {composition === undefined ? null : (
        <p className="mt-1 text-xs text-midGray">{composition}</p>
      )}
    </section>
  );
}
