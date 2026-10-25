import Link from 'next/link';
import { notFound } from 'next/navigation';
import DataTable, { type DataColumn } from '../../../components/DataTable';
import DetailList from '../../../components/DetailList';
import ErrorNotice from '../../../components/ErrorNotice';
import { requireAdminPermission } from '../../../lib/adminAuthz';
import { outcomeNote } from '../../../lib/adminOutcomes';
import ActionButton from '../../../components/ActionButton';
import { reconcileLimitsAction } from '../../adminFormActions';
import { getAccountDetail, type AccountDetailView } from '../../../lib/adminQueries';
import {
  billingCycleLabel,
  formatDhakaDate,
  isUuid,
  statusLabel,
  tierLabel,
  type MembershipRow,
  type ShopRow,
  type SubscriptionRow,
} from '../../../lib/adminViews';
import { toDisplayMessage } from '../../../lib/errors';

export const dynamic = 'force-dynamic';

const SHOP_COLUMNS: readonly DataColumn<ShopRow>[] = [
  {
    heading: 'Shop',
    cell: (shop) => (
      <Link href={`/shops/${shop.id}`} className="font-medium underline">
        {shop.name}
      </Link>
    ),
  },
  { heading: 'Plan', cell: (shop) => tierLabel(shop.plan) },
  { heading: 'Commercial status', cell: (shop) => statusLabel(shop.commercialStatus) },
  { heading: 'Registered', cell: (shop) => formatDhakaDate(shop.createdAt) },
];

const SUBSCRIPTION_COLUMNS: readonly DataColumn<SubscriptionRow>[] = [
  { heading: 'Plan', cell: (row) => tierLabel(row.tier) + ' ' + billingCycleLabel(row.billingCycle) },
  { heading: 'Status', cell: (row) => statusLabel(row.status) },
  { heading: 'Starts', cell: (row) => formatDhakaDate(row.startsAt) },
  { heading: 'Paid through', cell: (row) => formatDhakaDate(row.paidThrough) },
  { heading: 'Grace ends', cell: (row) => formatDhakaDate(row.graceEndsAt) },
  { heading: 'Provider', cell: (row) => row.provider },
];

const MEMBER_COLUMNS: readonly DataColumn<MembershipRow>[] = [
  { heading: 'Membership', cell: (row) => row.id },
  { heading: 'Role', cell: (row) => row.role },
  { heading: 'Active', cell: (row) => (row.isActive ? 'Yes' : 'No') },
  { heading: 'Since', cell: (row) => formatDhakaDate(row.createdAt) },
];

interface AccountPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// E11: the `refresh` entry was HERE and is deliberately gone with the action
// it described. A success message for a withdrawn capability is a claim that
// something happened.
//
// The three-outcome reading itself moved to lib/adminOutcomes.ts (§8.9d): this
// page and /payments each had their own copy, and a third outcome spread across
// two private copies is how one page ends up telling the truth and the other
// one not.
const OUTCOME_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  reconcile: 'Plan limits reconciled.',
});

export default async function AccountDetailPage({ params, searchParams }: AccountPageProps) {
  let session;
  try {
    session = await requireAdminPermission('accounts.read');
  } catch (error: unknown) {
    console.error('[admin] account detail denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  // The route param is client input and it decides WHICH account a
  // service-role read returns, so it is validated before it reaches a query.
  const { id } = await params;
  if (!isUuid(id)) notFound();

  let detail: AccountDetailView | null;
  try {
    detail = await getAccountDetail(id);
  } catch (error: unknown) {
    console.error('[admin] account detail failed to load:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }
  if (detail === null) notFound();

  const { account, entitlement } = detail;
  const note = outcomeNote(await searchParams, OUTCOME_MESSAGES);
  // Batch 3 §4.3: the EFFECTIVE set, so an assignment row that narrowed this
  // account hides the control it has already taken away.
  const mayWrite = session.permissions.includes('subscriptions.write');

  return (
    <>
      <h1 className="text-xl font-semibold">{account.primaryShopName}</h1>
      <p className="mt-1 text-sm text-midGray">Billing account {account.id}</p>

      {note === null ? null : (
        <p role="status" className="mt-4 rounded border border-black/10 px-3 py-2 text-sm text-midGray">
          {note}
        </p>
      )}

      {/* E11. The "Refresh entitlement snapshot" button was here. It is gone,
          along with its server action and its POST endpoint — not disabled, which
          would have left the capability live behind a greyed-out control. */}
      <p className="mt-6 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4 text-sm text-[#92400E]">
        <strong>Entitlement refresh is not an admin action.</strong>{' '}
        It stamped <code>verified_at</code>, which is the anchor of a device&apos;s
        offline grace window — so pressing it asserted &ldquo;this account was
        verified just now&rdquo; when no verification had happened, and reset the
        window of a device that should have been made to check in. A device
        refreshes its own snapshot whenever it comes online. This never granted or
        extended paid access: the RPC does not touch tier, status, paid-through or
        trial dates.
      </p>

      {mayWrite ? (
        <div className="mt-6 flex flex-wrap items-start gap-4">
          <ActionButton
            action={reconcileLimitsAction}
            fieldName="accountId"
            fieldValue={account.id}
            label="Reconcile plan limits"
            hint="Re-applies the plan's shop and staff limits. Grants nothing."
          />
        </div>
      ) : null}

      <div className="mt-6">
        <DetailList
          items={[
            { label: 'Plan', value: tierLabel(account.tier) },
            { label: 'Entitlement status', value: statusLabel(account.status) },
            { label: 'Access ends', value: formatDhakaDate(account.accessEndsAt) },
            { label: 'Trial ends', value: formatDhakaDate(entitlement?.trialEndsAt ?? null) },
            { label: 'Shops', value: String(account.shopCount) },
            { label: 'Active members', value: String(account.activeMemberCount) },
            { label: 'Snapshot verified', value: formatDhakaDate(entitlement?.verifiedAt ?? null) },
          ]}
        />
      </div>

      <h2 className="mt-8 text-lg font-semibold">Shops</h2>
      <div className="mt-3">
        <DataTable
          columns={SHOP_COLUMNS}
          rows={detail.shops}
          rowKey={(shop) => shop.id}
          emptyMessage="This account has no shops."
        />
      </div>

      <h2 className="mt-8 text-lg font-semibold">Subscriptions</h2>
      <div className="mt-3">
        <DataTable
          columns={SUBSCRIPTION_COLUMNS}
          rows={detail.subscriptions}
          rowKey={(row) => row.id}
          emptyMessage="This account has never had a subscription."
        />
      </div>

      <h2 className="mt-8 text-lg font-semibold">Memberships</h2>
      <div className="mt-3">
        <DataTable
          columns={MEMBER_COLUMNS}
          rows={detail.memberships}
          rowKey={(row) => row.id}
          emptyMessage="This account has no memberships."
        />
      </div>
    </>
  );
}
