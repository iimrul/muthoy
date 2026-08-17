import { formatMoney, formatNumber } from '@muthoy/utils';
import ErrorNotice from '../components/ErrorNotice';
import StatCard from '../components/StatCard';
import { toDisplayMessage } from '../lib/errors';
import type { PlatformStats } from '../lib/platformStats';
import { getPlatformStats } from '../lib/queries';

// Server component, read on every request: a cached build-time snapshot would
// show a stale shop count and yesterday's sales total.
export const dynamic = 'force-dynamic';

type StatsResult = { ok: true; stats: PlatformStats } | { ok: false; message: string };

// The fetch is what can throw, so only the fetch sits in try/catch. React
// renders JSX lazily, so a catch wrapped around JSX would never fire.
async function loadStats(): Promise<StatsResult> {
  try {
    return { ok: true, stats: await getPlatformStats() };
  } catch (error: unknown) {
    console.error('[admin] dashboard failed to load:', error);
    return { ok: false, message: toDisplayMessage(error) };
  }
}

export default async function DashboardPage() {
  const result = await loadStats();

  if (!result.ok) {
    return <ErrorNotice message={result.message} />;
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="mt-1 text-sm text-midGray">Platform totals across every registered shop.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Total shops"
          value={formatNumber(result.stats.totalShops)}
          hint="Registered pharmacies, excluding deleted shops"
        />
        <StatCard
          label="Total sales today"
          value={formatMoney(result.stats.totalSalesToday)}
          hint={`All shops · ${result.stats.day.businessDate} (Asia/Dhaka)`}
          isMoney
        />
      </div>
    </>
  );
}
