import DataTable, { type DataColumn } from '../../components/DataTable';
import ErrorNotice from '../../components/ErrorNotice';
import { formatMoney } from '@muthoy/utils';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { listSubscriptionSummaries } from '../../lib/adminQueries';
import {
  billingCycleLabel,
  formatDhakaDate,
  statusLabel,
  tierLabel,
  type SubscriptionSummary,
} from '../../lib/adminViews';
import { toDisplayMessage } from '../../lib/errors';

export const dynamic = 'force-dynamic';

// "Billed amount" is the plan_offerings price for the tier and cycle. It is NOT
// revenue, MRR or a charged total, and must not be described as any of those
// (the ledger's interim safety boundary 1). lib/adminLabels.test.ts enforces it.
const COLUMNS: readonly DataColumn<SubscriptionSummary>[] = [
  { heading: 'Account', cell: (row) => row.accountLabel },
  { heading: 'Plan', cell: (row) => tierLabel(row.tier) },
  { heading: 'Cycle', cell: (row) => billingCycleLabel(row.billingCycle) },
  { heading: 'Subscription status', cell: (row) => statusLabel(row.status) },
  { heading: 'Entitlement status', cell: (row) => statusLabel(row.entitlementStatus) },
  {
    heading: 'Billed amount',
    cell: (row) => formatMoney(row.billedAmountPaisa),
    isMoney: true,
    align: 'right',
  },
  { heading: 'Paid through', cell: (row) => formatDhakaDate(row.paidThrough) },
  { heading: 'Grace ends', cell: (row) => formatDhakaDate(row.graceEndsAt) },
];

export default async function SubscriptionsPage() {
  try {
    await requireAdminPermission('subscriptions.read');
  } catch (error: unknown) {
    console.error('[admin] subscriptions denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  let subscriptions: SubscriptionSummary[];
  try {
    subscriptions = await listSubscriptionSummaries();
  } catch (error: unknown) {
    console.error('[admin] subscriptions failed to load:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Subscriptions</h1>
      <p className="mt-1 text-sm text-midGray">
        Read-only. The billed amount is the plan price for that tier and cycle. It is
        not a charged total, not a collected sum, and not a figure to read as income.
      </p>
      <div className="mt-6">
        <DataTable
          columns={COLUMNS}
          rows={subscriptions}
          rowKey={(row) => row.id}
          emptyMessage="No subscription has been created yet."
        />
      </div>
    </>
  );
}
