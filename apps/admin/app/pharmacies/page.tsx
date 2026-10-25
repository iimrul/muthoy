import Link from 'next/link';
import ErrorNotice from '../../components/ErrorNotice';
import { EmptyState, FilterForm, Pager } from '../../components/PageParts';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { parseListQuery } from '../../lib/adminFilters';
import {
  listShopDistricts,
  listShopsPage,
  type ShopListPage,
} from '../../lib/adminPlatformQueries';
import { formatDhakaDate, formatDhakaDateTime } from '../../lib/adminViews';
import { toDisplayMessage } from '../../lib/errors';

// Batch 3 §8.2 — Pharmacy Management.
//
// SEARCH, FILTERS, SORT AND PAGING ARE ALL PUSHED INTO THE QUERY. None of it
// happens in JavaScript after the rows arrive, and that is not a performance
// preference — a filter applied after a `.range()` would page over the wrong
// set, and the pager's total would describe a different list from the one on
// screen.
//
// THE COUNT IS EXACT, and it is taken with the SAME predicate as the rows
// (lib/adminPlatformQueries.ts). An operator reads "123 pharmacies" as a fact.
//
// EVERY FILTERED VIEW HAS A URL. The form is a GET form and the pager is a set
// of links, so a view can be bookmarked, sent to the founder, and re-read by a
// test. `parseListQuery` runs the SHARED schema over the search params, and a
// malformed one is reported rather than thrown — a stale bookmark is not a
// server fault.

export const dynamic = 'force-dynamic';

const PLAN_OPTIONS = [
  { value: '', label: 'Any plan' },
  { value: 'free', label: 'free' },
  { value: 'pro', label: 'pro' },
  { value: 'ultra', label: 'ultra' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'active', label: 'active' },
  { value: 'suspended', label: 'suspended' },
];

const SORT_OPTIONS = [
  { value: 'registered_desc', label: 'Newest registration' },
  { value: 'registered_asc', label: 'Oldest registration' },
  { value: 'activity_desc', label: 'Most recent change' },
  { value: 'activity_asc', label: 'Least recent change' },
];

type PharmaciesResult =
  | { ok: true; page: ShopListPage; districts: readonly string[] }
  | { ok: false; message: string };

async function loadPharmacies(
  query: Parameters<typeof listShopsPage>[0],
): Promise<PharmaciesResult> {
  try {
    const [page, districts] = await Promise.all([listShopsPage(query), listShopDistricts()]);
    return { ok: true, page, districts };
  } catch (error: unknown) {
    console.error('[admin] the pharmacy list failed to load:', error);
    return { ok: false, message: toDisplayMessage(error) };
  }
}

/** The params to carry forward in pager links, as plain strings. */
function carriedParams(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const carried: Record<string, string> = {};
  for (const key of ['search', 'district', 'plan', 'status', 'sort', 'pageSize', 'from', 'to']) {
    const value = raw[key];
    const first = typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
    if (first !== undefined && first.length > 0) carried[key] = first;
  }
  return carried;
}

interface PharmaciesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PharmaciesPage({ searchParams }: PharmaciesPageProps) {
  // W4-06: authorization FIRST. The denial happens before the query, not after
  // it, so a forbidden role never reaches the service-role client.
  try {
    await requireAdminPermission('shops.read');
  } catch (error: unknown) {
    console.error('[admin] pharmacy list denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  const raw = await searchParams;
  const parsed = parseListQuery(raw);
  if (!parsed.ok) {
    // A filter that does not parse is reported WITH the reason, and the page
    // still renders its form so the operator can correct it.
    return (
      <>
        <h1 className="text-xl font-semibold">Pharmacies</h1>
        <p role="alert" className="mt-4 text-sm text-richBlack">
          {parsed.message}
        </p>
        <FilterForm
          search={{ value: '', label: 'Name or phone', placeholder: 'Banani, or 01712…' }}
          selects={[
            { name: 'plan', label: 'Plan', value: '', options: PLAN_OPTIONS },
            { name: 'status', label: 'Status', value: '', options: STATUS_OPTIONS },
            { name: 'sort', label: 'Sort', value: 'registered_desc', options: SORT_OPTIONS },
          ]}
        />
      </>
    );
  }

  const query = parsed.query;
  const result = await loadPharmacies(query);
  if (!result.ok) return <ErrorNotice message={result.message} />;

  const { rows, meta } = result.page;
  const hasFilter =
    (query.search ?? '').length > 0 ||
    (query.district ?? '').length > 0 ||
    (query.plan ?? '').length > 0 ||
    (query.status ?? '').length > 0;

  return (
    <>
      <h1 className="text-xl font-semibold">Pharmacies</h1>
      <p className="mt-1 text-sm text-midGray">
        Read-only. Search covers the pharmacy name, its Latin-script name and its phone number.
      </p>

      <FilterForm
        search={{
          value: query.search ?? '',
          label: 'Name or phone',
          placeholder: 'Banani, or 01712…',
        }}
        selects={[
          {
            name: 'district',
            label: 'District',
            value: query.district ?? '',
            options: [
              { value: '', label: 'Any district' },
              ...result.districts.map((district) => ({ value: district, label: district })),
            ],
          },
          { name: 'plan', label: 'Plan', value: query.plan ?? '', options: PLAN_OPTIONS },
          { name: 'status', label: 'Status', value: query.status ?? '', options: STATUS_OPTIONS },
          {
            name: 'sort',
            label: 'Sort',
            value: query.sort ?? 'registered_desc',
            options: SORT_OPTIONS,
          },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState
          message={
            meta.isPastEnd
              ? 'That page is past the end of the list. There are ' +
                meta.total +
                ' pharmacies in total.'
              : hasFilter
                ? 'No pharmacy matches these filters. The filters are applied in the query, so this is the real count.'
                : 'No pharmacy has registered yet. No demo data ships, so a fresh platform is empty.'
          }
        />
      ) : (
        <>
          <table className="mt-4 w-full text-sm">
            <caption className="sr-only">
              Pharmacies, {meta.total} in total, page {meta.page} of {Math.max(1, meta.pageCount)}.
            </caption>
            <thead>
              <tr className="border-b border-black/10 text-left">
                <th scope="col" className="py-1 font-medium">
                  Pharmacy
                </th>
                <th scope="col" className="py-1 font-medium">
                  Phone
                </th>
                <th scope="col" className="py-1 font-medium">
                  District
                </th>
                <th scope="col" className="py-1 font-medium">
                  Plan
                </th>
                <th scope="col" className="py-1 font-medium">
                  Status
                </th>
                <th scope="col" className="py-1 font-medium">
                  Registered
                </th>
                <th scope="col" className="py-1 font-medium">
                  Last change
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((shop) => (
                <tr key={shop.id} className="border-b border-black/5">
                  <th scope="row" className="py-1 text-left font-normal">
                    <Link href={'/shops/' + shop.id} className="underline">
                      {shop.name}
                    </Link>
                    {/* The Latin-script name, where one exists and differs —
                        it is what a search for "Banani" may have matched on. */}
                    {shop.nameEn !== null && shop.nameEn.length > 0 && shop.nameEn !== shop.name ? (
                      <span className="ml-1 text-xs text-midGray">{shop.nameEn}</span>
                    ) : null}
                  </th>
                  {/* Phone is a credential as well as contact detail, so it
                      renders in the mono variable, where its digits align. */}
                  <td className="py-1 font-mono text-xs">{shop.phone}</td>
                  <td className="py-1">{shop.district ?? '—'}</td>
                  <td className="py-1">{shop.plan}</td>
                  <td className="py-1">{shop.commercialStatus}</td>
                  <td className="py-1">{formatDhakaDate(shop.createdAt)}</td>
                  {/* "Last change", not "last seen": the initial schema has no
                      updated_at trigger and keeps the CLIENT's timestamp for
                      last-write-wins, so this is the last change that SYNCED,
                      not the last time somebody opened the app. */}
                  <td className="py-1">{formatDhakaDateTime(shop.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pager meta={meta} params={carriedParams(raw)} noun="pharmacies" />
        </>
      )}
    </>
  );
}
