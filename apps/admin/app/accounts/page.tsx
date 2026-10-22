import Link from 'next/link';
import DataTable, { type DataColumn } from '../../components/DataTable';
import ErrorNotice from '../../components/ErrorNotice';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { listAccountSummaries } from '../../lib/adminQueries';
import { formatDhakaDate, statusLabel, tierLabel, type AccountSummary } from '../../lib/adminViews';
import { toDisplayMessage } from '../../lib/errors';

// Read on every request: a newly registered account must appear without a
// redeploy.
export const dynamic = 'force-dynamic';

const COLUMNS: readonly DataColumn<AccountSummary>[] = [
  {
    heading: 'Primary shop',
    cell: (account) => (
      <Link href={`/accounts/${account.id}`} className="font-medium underline">
        {account.primaryShopName}
      </Link>
    ),
  },
  { heading: 'Plan', cell: (account) => tierLabel(account.tier) },
  { heading: 'Status', cell: (account) => statusLabel(account.status) },
  { heading: 'Shops', cell: (account) => String(account.shopCount), align: 'right' },
  { heading: 'Active members', cell: (account) => String(account.activeMemberCount), align: 'right' },
  { heading: 'Access ends', cell: (account) => formatDhakaDate(account.accessEndsAt) },
  { heading: 'Created', cell: (account) => formatDhakaDate(account.createdAt) },
];

export default async function AccountsPage() {
  // Authorization FIRST, server-side, before any query runs.
  try {
    await requireAdminPermission('accounts.read');
  } catch (error: unknown) {
    console.error('[admin] accounts denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  let accounts: AccountSummary[];
  try {
    accounts = await listAccountSummaries();
  } catch (error: unknown) {
    console.error('[admin] accounts failed to load:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Billing accounts</h1>
      <p className="mt-1 text-sm text-midGray">
        Read-only. One account per owner, newest first. Plan and status come from the
        entitlement snapshot the device also reads.
      </p>
      <div className="mt-6">
        <DataTable
          columns={COLUMNS}
          rows={accounts}
          rowKey={(account) => account.id}
          emptyMessage="No billing accounts exist yet."
        />
      </div>
    </>
  );
}
