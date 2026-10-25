'use client';

// Batch 3 §8 — the chart loader. The same treatment as the map's, for the same
// reason the map's exists: `ssr: false` is rejected inside a Server Component
// in Next 15, so the option lives in a client file that contains nothing else.
//
// Recharts does not NEED this — it renders to SVG and pre-renders cleanly — but
// it gets it anyway, so both visual regions on a page share one loading state
// and a reader does not meet two different kinds of blank.

import dynamic from 'next/dynamic';
import type { ChartPoint } from './PlatformCharts';

export type ChartKind = 'trend' | 'distribution';

interface ChartLoaderProps {
  kind: ChartKind;
  points: readonly ChartPoint[];
  valueLabel: string;
}

/** A labelled placeholder, not a spinner: it says what is loading. */
function ChartPlaceholder({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-[260px] w-full items-center justify-center rounded bg-offWhite text-sm text-midGray"
    >
      Loading {label}…
    </div>
  );
}

const TrendChart = dynamic(
  () => import('./PlatformCharts').then((module) => ({ default: module.TrendChart })),
  { ssr: false, loading: () => <ChartPlaceholder label="the trend" /> },
);

const DistributionChart = dynamic(
  () => import('./PlatformCharts').then((module) => ({ default: module.DistributionChart })),
  { ssr: false, loading: () => <ChartPlaceholder label="the distribution" /> },
);

export default function ChartLoader({ kind, points, valueLabel }: ChartLoaderProps) {
  if (kind === 'trend') return <TrendChart points={points} valueLabel={valueLabel} />;
  return <DistributionChart points={points} valueLabel={valueLabel} />;
}
