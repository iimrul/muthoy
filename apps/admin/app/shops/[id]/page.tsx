import Link from 'next/link';
import { notFound } from 'next/navigation';
import DataTable, { type DataColumn } from '../../../components/DataTable';
import DetailList from '../../../components/DetailList';
import ErrorNotice from '../../../components/ErrorNotice';
import { EmptyState } from '../../../components/PageParts';
import { formatMoney } from '@muthoy/utils';
import { requireAdminPermission } from '../../../lib/adminAuthz';
import {
  hasPlottableCoordinates,
  isPlottable,
  LOCATION_CONSENT_BLOCKED_REASON,
  markerColorForPlan,
  noLocationConsent,
  type ShopLocationRow,
} from '../../../lib/adminGeo';
import {
  listShopSupportNotes,
  listSupportCaseSummaries,
  shopLocationFor,
  type ShopSupportNote,
} from '../../../lib/adminPlatformQueries';
import { getShopDetail } from '../../../lib/adminQueries';
import type { SupportCaseSummary } from '../../../lib/adminSupport';
import {
  formatDhakaDate,
  formatDhakaDateTime,
  isUuid,
  statusLabel,
  tierLabel,
  type MembershipRow,
  type ShopDetailView,
} from '../../../lib/adminViews';
import { formatPhone } from '../../../lib/platformStats';
import { toDisplayMessage } from '../../../lib/errors';

// Batch 3 §8.2 — the pharmacy drill-down.
//
// ONE SHOP'S ROWS, AND NEVER ANOTHER'S. Every read below is keyed by the same
// validated id, and the support block filters on `shop_id` in the query rather
// than in JavaScript — a client-side filter over a wider read is one missing
// `continue` away from showing a neighbour's case.
//
// THE LOCATION BLOCK IS GATED TWICE, AND BOTH GATES ARE REAL.
//   1. `maps.read`, because a coordinate is not inside `shops.read`'s scope;
//   2. §8.6's consent rule, which lib/adminGeo.ts owns. `noLocationConsent` is
//      the shipped consent source and it returns null for every shop, so
//      `isPlottable` is false for every shop and no coordinate is rendered
//      until gate E13 lands a real, versioned, revocable consent record.
//
// THE BLOCK IS STILL BUILT, and that is the point: enabling it later is a data
// and policy change rather than new code. What it renders today is whether a
// coordinate EXISTS and why it is withheld — never the coordinate.

export const dynamic = 'force-dynamic';

const MEMBER_COLUMNS: readonly DataColumn<MembershipRow>[] = [
  { heading: 'Membership', cell: (row) => row.id },
  { heading: 'Role', cell: (row) => row.role },
  { heading: 'Active', cell: (row) => (row.isActive ? 'Yes' : 'No') },
  { heading: 'Since', cell: (row) => formatDhakaDate(row.createdAt) },
];

const SUPPORT_COLUMNS: readonly DataColumn<SupportCaseSummary>[] = [
  {
    heading: 'Case',
    cell: (row) => (
      <Link href={'/support?case=' + row.id} className="underline">
        {row.summary}
      </Link>
    ),
  },
  { heading: 'Status', cell: (row) => row.statusLabel },
  { heading: 'Priority', cell: (row) => row.priorityLabel },
  { heading: 'Category', cell: (row) => row.categoryLabel },
  { heading: 'Assignee', cell: (row) => row.assignee ?? '—' },
  { heading: 'Opened', cell: (row) => row.openedOn },
  { heading: 'Last updated', cell: (row) => row.lastUpdated },
];

interface ShopPageProps {
  params: Promise<{ id: string }>;
}

interface ShopBundle {
  detail: ShopDetailView;
  cases: readonly SupportCaseSummary[];
  /** The actual notes on those cases, newest first (Gate 5 finding 16). */
  notes: readonly ShopSupportNote[];
  casesFollowed: number;
  /** Round 14 finding 12: older notes exist inside a case this view followed. */
  olderNotesWithheld: boolean;
  location: ShopLocationRow | null;
}

type BundleResult =
  | { ok: true; bundle: ShopBundle | null; nowMs: number }
  | { ok: false; message: string };

/**
 * The three reads, in parallel, against one instant.
 *
 * The support read is issued without `support.read`, deliberately: a support
 * case is platform data ABOUT this shop, and §4.2 gives a `shops.read` holder
 * the drill-down in full. What `support.write` gates is CHANGING a case, which
 * happens on the Support page — this block is read-only and links there.
 */
async function loadShop(id: string, mayReadLocation: boolean): Promise<BundleResult> {
  try {
    const now = new Date();
    const [detail, cases, location] = await Promise.all([
      getShopDetail(id, now),
      listSupportCaseSummaries({ shopId: id }, now),
      // Not read at all without the permission. A figure nobody may see should
      // not be fetched either — the narrowest read is the one never issued.
      mayReadLocation ? shopLocationFor(id) : Promise.resolve(null),
    ]);
    if (detail === null) return { ok: true, bundle: null, nowMs: now.getTime() };
    // The notes come AFTER the cases, because a note is read per case id and
    // the case ids are what scope it to this shop. There is no path that reads
    // a note without a case that belongs here.
    const { notes, casesFollowed, olderNotesWithheld } = await listShopSupportNotes(cases);
    return {
      ok: true,
      bundle: { detail, cases, notes, casesFollowed, olderNotesWithheld, location },
      nowMs: now.getTime(),
    };
  } catch (error: unknown) {
    console.error('[admin] shop detail failed to load:', error);
    return { ok: false, message: toDisplayMessage(error) };
  }
}

export default async function ShopDetailPage({ params }: ShopPageProps) {
  let permissions: readonly string[];
  try {
    const session = await requireAdminPermission('shops.read');
    permissions = session.permissions;
  } catch (error: unknown) {
    console.error('[admin] shop detail denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  // Validated before it reaches a query: this parameter chooses which shop a
  // service-role read returns.
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const mayReadLocation = permissions.includes('maps.read');
  const result = await loadShop(id, mayReadLocation);
  if (!result.ok) return <ErrorNotice message={result.message} />;
  if (result.bundle === null) notFound();

  const { detail, cases, notes, casesFollowed, olderNotesWithheld, location } = result.bundle;
  const { shop } = detail;

  const openCases = cases.filter((entry) => entry.isOpen).length;
  const hasCoordinates = location !== null && hasPlottableCoordinates(location);
  const plottable = location !== null && isPlottable(location, noLocationConsent, result.nowMs);

  return (
    <>
      <h1 className="text-xl font-semibold">{shop.name}</h1>
      <p className="mt-1 text-sm text-midGray">Shop {shop.id}</p>

      <div className="mt-6">
        <DetailList
          items={[
            { label: 'Phone', value: formatPhone(shop.phone) },
            // §8.2's owner information (Gate 5 finding 16). A null name means
            // the row could not be read, which is not the same as no owner.
            { label: 'Owner', value: detail.ownerName ?? 'could not be read' },
            {
              label: 'Owner phone',
              value: detail.ownerPhone === null ? 'could not be read' : formatPhone(detail.ownerPhone),
            },
            { label: 'Registered', value: formatDhakaDate(shop.createdAt) },
            {
              // "Last synced change", not "last seen": the schema keeps the
              // CLIENT's timestamp for last-write-wins and has no updated_at
              // trigger, so this is the last change that SYNCED.
              label: 'Last synced change',
              value: formatDhakaDateTime(detail.lastSyncedChangeAt),
            },
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

      <section aria-labelledby="shop-support" className="mt-8">
        <h2 id="shop-support" className="text-lg font-semibold">
          Support notes
        </h2>
        <p className="mt-1 text-sm text-midGray">
          {cases.length === 0
            ? 'Read-only here. Cases are opened and annotated on the Support page, where every transition is audited.'
            : openCases
              + (openCases === 1 ? ' open case of ' : ' open cases of ')
              + cases.length
              + '. Read-only here — a case is changed on the Support page, where every transition is audited.'}
        </p>
        <div className="mt-3">
          <DataTable
            columns={SUPPORT_COLUMNS}
            rows={cases}
            rowKey={(row) => row.id}
            emptyMessage="No support case has been opened for this pharmacy. The support tables ship empty, and no history is fabricated."
          />
        </div>

        {/* THE NOTES THEMSELVES (Gate 5 finding 16). This block was called
            "Support notes" while reading no note at all — only case summaries.
            A note is what somebody actually wrote down about this pharmacy, and
            it is what a support conversation is reconstructed from. */}
        {cases.length === 0 ? null : (
          <div className="mt-4">
            <h3 className="text-sm font-semibold">Notes on those cases</h3>
            {notes.length === 0 ? (
              <EmptyState message="These cases carry no notes yet. A case can be opened without one, and none is invented here." />
            ) : (
              <>
                <ul className="mt-2 space-y-2">
                  {notes.map((note) => (
                    <li key={note.id} className="rounded border border-black/10 bg-white p-3">
                      <p className="text-sm text-richBlack">{note.body}</p>
                      <p className="mt-1 text-xs text-midGray">
                        {note.author} · {formatDhakaDateTime(note.createdAt)} · on{' '}
                        {note.caseSummary}
                      </p>
                    </li>
                  ))}
                </ul>
                {casesFollowed < cases.length ? (
                  <p className="mt-2 text-xs text-midGray">
                    Notes are shown for the {casesFollowed} most recently updated cases of{' '}
                    {cases.length}. The rest are on the Support page.
                  </p>
                ) : null}
                {/* ROUND 14 FINDING 12: a different omission from the one
                    above. That notice covers CASES this view did not follow;
                    this one covers NOTES inside a case it did. */}
                {olderNotesWithheld ? (
                  <p role="status" className="mt-2 text-xs text-midGray">
                    A case here has more notes than this view reads, so its oldest notes are not
                    shown. The full history is on the Support page.
                  </p>
                ) : null}
              </>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="shop-location" className="mt-8">
        <h2 id="shop-location" className="text-lg font-semibold">
          Location
        </h2>
        {!mayReadLocation ? (
          <EmptyState message="Location is not shown, because this account does not hold the maps permission. A coordinate is outside the scope of pharmacy read access, so it was not read at all." />
        ) : plottable ? (
          // Unreachable in the shipped build — `noLocationConsent` returns null
          // for every shop, so `isPlottable` is false. The branch exists so
          // that landing a real consent source is a data change rather than new
          // code, and so the plan-tier colour rule has somewhere to live.
          <DetailList
            items={[
              { label: 'District', value: location?.district ?? '—' },
              { label: 'Captured', value: formatDhakaDate(location?.locationCapturedAt ?? null) },
              { label: 'Plan marker colour', value: markerColorForPlan(shop.plan) },
            ]}
          />
        ) : (
          <EmptyState message={LOCATION_CONSENT_BLOCKED_REASON}>
            <p className="mt-2 text-xs text-midGray">
              {hasCoordinates
                ? 'This pharmacy does hold a coordinate pair and a capture timestamp. A capture '
                  + 'timestamp is not consent, so the coordinate is withheld rather than shown.'
                : 'This pharmacy holds no coordinate pair at all, so there is nothing to withhold. '
                  + 'Nothing in the mobile app writes a latitude or a longitude today.'}
            </p>
            <p className="mt-2 text-xs text-midGray">
              <Link href="/maps" className="underline">
                The platform map
              </Link>{' '}
              reports the same two gates for every pharmacy at once.
            </p>
          </EmptyState>
        )}
      </section>
    </>
  );
}
