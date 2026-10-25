'use client';

// Batch 3 §8 — the Recharts components. The ONLY file in the panel that touches
// Recharts, reached solely through ChartLoader's dynamic import.
//
// WHAT THEY RECEIVE: a label and a number per point, already aggregated and
// already k-suppressed. A suppressed point arrives as `null` and is DROPPED
// from the series rather than plotted as zero — a gap drawn as zero is a cliff
// that is not in the data. How many were withheld is stated by the panel beside
// the chart, not inferred from the shape of the line.
//
// NEVER A ROW, NEVER A CLIENT, NEVER A CREDENTIAL. The props below are strings
// and numbers, and `serviceRoleExposure.test.ts` asserts that no client
// component's props type carries a raw row.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/** One point. `null` means the bucket was withheld for k-anonymity. */
export interface ChartPoint {
  label: string;
  value: number | null;
}

export interface ChartProps {
  points: readonly ChartPoint[];
  /** What the values are, for the tooltip and the series name. */
  valueLabel: string;
}

const AXIS_STYLE = { fontSize: 12 };
const BRAND_GREEN = '#0F766E';
const CHART_HEIGHT = 260;

/**
 * The tooltip's text for one value.
 *
 * Recharts types a formatter's value as `ValueType | undefined`, and undefined
 * is a real case — a hover between points. It reads as the em dash, the same
 * thing a withheld bucket shows in the table, rather than as a zero nobody
 * measured.
 */
function formatTooltipValue(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
}

/** Suppressed points are absent from the plotted series, never zeroed. */
function plottable(points: readonly ChartPoint[]): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = [];
  for (const point of points) {
    if (point.value === null) continue;
    out.push({ label: point.label, value: point.value });
  }
  return out;
}

export function TrendChart({ points, valueLabel }: ChartProps) {
  const data = plottable(points);

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
        <XAxis dataKey="label" tick={AXIS_STYLE} />
        <YAxis tick={AXIS_STYLE} />
        {/* Recharts hands the formatter `ValueType | undefined`, so the
            parameter is not typed as a number here. An absent value is
            rendered as the em dash rather than as 0. */}
        <Tooltip formatter={(value) => [formatTooltipValue(value), valueLabel]} />
        <Line
          type="monotone"
          dataKey="value"
          name={valueLabel}
          stroke={BRAND_GREEN}
          strokeWidth={2}
          dot={false}
          // No entry animation: the chart's job is to be read, and a line that
          // draws itself delays the first moment the figure is legible.
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DistributionChart({ points, valueLabel }: ChartProps) {
  const data = plottable(points);

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_STYLE} />
        <YAxis tick={AXIS_STYLE} allowDecimals={false} />
        {/* Recharts hands the formatter `ValueType | undefined`, so the
            parameter is not typed as a number here. An absent value is
            rendered as the em dash rather than as 0. */}
        <Tooltip formatter={(value) => [formatTooltipValue(value), valueLabel]} />
        <Bar dataKey="value" name={valueLabel} fill={BRAND_GREEN} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
