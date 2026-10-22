import Link from 'next/link';
import { notFound } from 'next/navigation';
import DataTable, { type DataColumn } from '../../../components/DataTable';
import DetailList from '../../../components/DetailList';
import ErrorNotice from '../../../components/ErrorNotice';
import { formatMoney } from '@muthoy/utils';
import { requireAdminPermission } from '../../../lib/adminAuthz';
import { getShopDetail } from '../../../lib/adminQueries';
import {
  formatDhakaDate,
  isUuid,
  statusLabel,
  tierLabel,
  type MembershipRow,
  type ShopDetailView,
} from '../../../lib/adminViews';
import { formatPhone } from '../../../lib/platformStats';
import { toDisplayMessage } from '../../../lib/errors';

export const dynamic = 'force-dynamic';

const MEMBER_COLUMNS: readonly DataColumn<MembershipRow>[] = [
  { heading: 'Membership', cell: (row) => row.id },
  { heading: 'Role', cell: (row) => row.role },
  { heading: 'Active', cell: (row) => (row.isActive ? 'Yes' : 'No') },
  { heading: 'Since', cell: (row) => formatDhakaDate(row.createdAt) },
];

interface ShopPageProps {
  params: Promise<{ id: string }>;
}

export default async function ShopDetailPage({ params }: ShopPageProps) {
  try {
    await requireAdminPermission('shops.read');
  } catch (error: unknown) {
    console.error('[admin] shop detail denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  // Validated before it reaches a query: this parameter chooses which shop a
  // service-role read returns.
  const { id } = await params;
  if (!isUuid(id)) notFound();

  let detail: ShopDetailView | null;
  try {
    detail = await getShopDetail(id);
  } catch (error: unknown) {
    console.error('[admin] shop detail failed to load:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }
  if (detail === null) notFound();

  const { shop } = detail;

  return (
    <>
      <h1 className="text-xl font-semibold">{shop.name}</h1>
      <p className="mt-1 text-sm text-midGray">Shop {shop.id}</p>

      <div className="mt-6">
        <DetailList
          items={[
            { label: 'Phone', value: formatPhone(shop.phone) },
            { label: 'Registered', value: formatDhakaDate(shop.createdAt) },
            { label: 'Plan', value: tierLabel(detail.tier) },
            { label: 'Entitlement status', value: statusLabel(detail.entitlementStatus) },
            { label: 'Access ends', value: formatDhakaDate(detail.accessEndsAt) },
            { label: 'Commercial status', value: statusLabel(shop.commercialStatus) },
            { label: 'Commercial reason', value: shop.commercialReason ?? '—' },
            { label: 'Archived', value: formatDhakaDate(shop.archivedAt) },
            { label: 'Active staff', value: String(detail.activeStaffCount) },
            { label: 'Sales today (count)', value: String(detail.saleCountToday) },
            {
              // GROSS, and labelled gross: the ledger's interim safety boundary
              // 1 binds this batch, so no figure here is called revenue or net.
              label: 'Gross sales today',
              value: formatMoney(detail.grossSalesTodayPaisa),
              isMoney: true,
            },
            {
              label: 'Billing account',
              value: detail.accountId === null
                ? '—'
                : <Link href={`/accounts/${detail.accountId}`} className="underline">{detail.accountId}</Link>,
            },
          ]}
        />
      </div>

      <h2 className="mt-8 text-lg font-semibold">Memberships</h2>
      <div className="mt-3">
        <DataTable
          columns={MEMBER_COLUMNS}
          rows={detail.memberships}
          rowKey={(row) => row.id}
          emptyMessage="This shop has no memberships."
        />
      </div>
    </>
  );
}
