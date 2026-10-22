import DataTable, { type DataColumn } from '../../components/DataTable';
import ErrorNotice from '../../components/ErrorNotice';
import { formatMoney } from '@muthoy/utils';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { hasPermission } from '../../lib/adminRoles';
import ActionButton from '../../components/ActionButton';
import { expireOrderAction } from '../adminFormActions';
import { listPaymentOrderSummaries } from '../../lib/adminQueries';
import {
  billingCycleLabel,
  formatDhakaDateTime,
  statusLabel,
  tierLabel,
  type PaymentOrderSummary,
} from '../../lib/adminViews';
import { toDisplayMessage } from '../../lib/errors';

export const dynamic = 'force-dynamic';

// "Order amount" is what the payment order was created for. Not revenue, not a
// settled total: an order can be created, expired or failed and still show here.
const BASE_COLUMNS: readonly DataColumn<PaymentOrderSummary>[] = [
  { heading: 'Account', cell: (row) => row.accountLabel },
  { heading: 'Plan', cell: (row) => tierLabel(row.tier) + ' ' + billingCycleLabel(row.billingCycle) },
  { heading: 'Order amount', cell: (row) => formatMoney(row.amountPaisa), isMoney: true, align: 'right' },
  { heading: 'Status', cell: (row) => statusLabel(row.status) },
  { heading: 'Provider', cell: (row) => row.provider },
  { heading: 'Failure code', cell: (row) => row.failureCode ?? '—' },
  { heading: 'Events', cell: (row) => String(row.eventCount), align: 'right' },
  { heading: 'Latest event', cell: (row) => (row.latestEventStatus === null ? '—' : statusLabel(row.latestEventStatus)) },
  { heading: 'Created', cell: (row) => formatDhakaDateTime(row.createdAt) },
];

interface PaymentsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PaymentsPage({ searchParams }: PaymentsPageProps) {
  let session;
  try {
    session = await requireAdminPermission('payments.read');
  } catch (error: unknown) {
    console.error('[admin] payments denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  let orders: PaymentOrderSummary[];
  try {
    orders = await listPaymentOrderSummaries();
  } catch (error: unknown) {
    console.error('[admin] payments failed to load:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  const params = await searchParams;
  const note = typeof params.done === 'string'
    ? 'Payment order marked expired.'
    : typeof params.failed === 'string'
      ? 'Nothing was changed: that order is not a stale open order, or the write failed. The audit log has the details.'
      : null;

  // isStaleOpen was decided in the query layer, with the instant the rows
  // were read at: a Server Component must be pure, so no clock is read during
  // render. The action re-checks staleness in its own UPDATE guard.
  const columns: readonly DataColumn<PaymentOrderSummary>[] = hasPermission(session.role, 'support.write')
    ? [
        ...BASE_COLUMNS,
        {
          heading: 'Stale order',
          cell: (row) =>
            row.isStaleOpen ? (
              <ActionButton
                action={expireOrderAction}
                fieldName="orderId"
                fieldValue={row.id}
                label="Mark expired"
              />
            ) : (
              '—'
            ),
        },
      ]
    : BASE_COLUMNS;

  return (
    <>
      <h1 className="text-xl font-semibold">Payment orders</h1>
      <p className="mt-1 text-sm text-midGray">
        Read-only, newest first. Every order ever created, including expired and failed
        ones — the amount is what the order was for, not a settled total.
      </p>
      <p className="mt-2 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4 text-sm text-[#92400E]">
        New subscription payments are retired (W4-10): no provider is active, so no new
        order can be created. These are historical records and any callback still in
        flight for them is still settled by the webhook.
      </p>
      {note === null ? null : (
        <p role="status" className="mt-4 rounded border border-black/10 px-3 py-2 text-sm text-midGray">
          {note}
        </p>
      )}
      <div className="mt-6">
        <DataTable
          columns={columns}
          rows={orders}
          rowKey={(row) => row.id}
          emptyMessage="No payment order has been created yet."
        />
      </div>
    </>
  );
}
