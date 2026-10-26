import DataTable, { type DataColumn } from '../../components/DataTable';
import ErrorNotice from '../../components/ErrorNotice';
import { EmptyState, FilterForm, Pager } from '../../components/PageParts';
import { recentAdminAudit, type AdminAuditEntry } from '../../lib/adminAudit';
import {
  auditActionNamespaces,
  auditActors,
  AUDIT_OUTCOMES,
  filterAuditEntries,
  formatAuditMeta,
  sliceAuditEntries,
} from '../../lib/adminAuditViews';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { pageMeta, parseListQuery, rangeSpec } from '../../lib/adminFilters';
import { shopAuditPage, type ShopAuditPage } from '../../lib/adminPlatformQueries';
import { formatCount, formatDhakaDateTime, isUuid } from '../../lib/adminViews';
import { toDisplayMessage } from '../../lib/errors';

// Batch 3 §8.9 — Audit Logs, in TWO views, because Volume 5 requires both and
// they have different subjects.
//
// (a) THE PLATFORM ADMIN AUDIT. Who did what in this panel: actor, action,
//     target, outcome, timestamp and the redacted context — with failed and
//     DENIED operations included, which is the half that matters most. Filters
//     on actor, action, outcome and date, plus free text and paging.
//
// (b) THE PER-SHOP `audit_logs` VIEW. One pharmacy's own internal history,
//     gated on `shop_audit.read` (super_admin and support only, per Volume 5's
//     "support/debugging use only"), scoped to one validated shop id,
//     read-only and newest first. §3.5 revokes every privilege on that table
//     from `service_role` and grants back SELECT alone, so read-only is
//     enforced by the database rather than by this page.
//
// THIS VIEW IS NOT THE DURABLE RECORD, AND SAYS SO. The Postgres audit table
// ships in migration 35 and is NOT applied to any hosted project, so (a) reads
// this instance's ring buffer. The record of account is the structured stderr
// line. Claiming otherwise would be the one thing an audit page must not do.

export const dynamic = 'force-dynamic';

const COLUMNS: readonly DataColumn<AdminAuditEntry>[] = [
  { heading: 'When', cell: (entry) => formatDhakaDateTime(entry.at) },
  { heading: 'Actor', cell: (entry) => entry.actor },
  {
    heading: 'Actor verified',
    // §8.9's `actor_verified`. A login ATTEMPT precedes a session by nature, so
    // its actor is a CLAIMED subject rather than a verified one, and the
    // distinction is shown rather than flattened.
    cell: (entry) => (entry.actorVerified ? 'verified session' : 'claimed, unverified'),
  },
  { heading: 'Role', cell: (entry) => entry.role ?? '—' },
  { heading: 'Action', cell: (entry) => entry.action },
  { heading: 'Target', cell: (entry) => entry.target ?? '—' },
  { heading: 'Outcome', cell: (entry) => entry.outcome },
  { heading: 'Detail', cell: (entry) => formatAuditMeta(entry) },
];

const SHOP_COLUMNS: readonly DataColumn<ShopAuditPage['rows'][number]>[] = [
  { heading: 'When', cell: (row) => formatDhakaDateTime(row.createdAt) },
  { heading: 'Action', cell: (row) => row.action },
  { heading: 'Target', cell: (row) => row.target ?? '—' },
  { heading: 'Actor', cell: (row) => row.actorId },
];

/** The params to carry forward in pager links, as plain strings. */
function carriedParams(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const carried: Record<string, string> = {};
  for (const key of ['search', 'district', 'status', 'action', 'from', 'to', 'pageSize', 'shop']) {
    const value = raw[key];
    const first = typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
    if (first !== undefined && first.length > 0) carried[key] = first;
  }
  return carried;
}

function firstParam(raw: Record<string, string | string[] | undefined>, key: string): string {
  const value = raw[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? '';
  return '';
}

type ShopAuditResult =
  | { state: 'absent' }
  | { state: 'forbidden' }
  | { state: 'invalid' }
  | { state: 'failed'; message: string }
  | { state: 'ok'; page: ShopAuditPage; shopId: string };

/**
 * The per-shop view, read only when a shop id was actually asked for.
 *
 * The permission is checked BEFORE the id is validated and before any read, so
 * a caller without `shop_audit.read` cannot learn whether a shop id is
 * well-formed — let alone whether it exists — from the shape of the refusal.
 */
async function loadShopAudit(
  shopParam: string,
  permissions: readonly string[],
  query: Parameters<typeof shopAuditPage>[1],
): Promise<ShopAuditResult> {
  if (shopParam.length === 0) return { state: 'absent' };
  if (!permissions.includes('shop_audit.read')) return { state: 'forbidden' };
  if (!isUuid(shopParam)) return { state: 'invalid' };

  try {
    return { state: 'ok', page: await shopAuditPage(shopParam, query), shopId: shopParam };
  } catch (error: unknown) {
    console.error('[admin] shop audit failed to load:', error);
    return { state: 'failed', message: toDisplayMessage(error) };
  }
}

interface AuditPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  let permissions: readonly string[];
  try {
    const session = await requireAdminPermission('audit.read');
    permissions = session.permissions;
  } catch (error: unknown) {
    console.error('[admin] audit denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  const raw = await searchParams;
  // The shared schema bounds `page`, `pageSize`, `search`, `action` and the
  // date range. `action` is its own field because action names are dotted
  // namespaces and the `plan` field this used to borrow rejects a dot — which
  // made every generated option except `login` unusable (Gate 5 finding 6).
  // The actor and outcome filters ride on the schema's spare bounded text
  // fields; both carry values that came from the entries themselves and are
  // matched EXACTLY, so neither reaches a query or a pattern — the platform
  // view is in memory.
  const parsed = parseListQuery(raw);
  if (!parsed.ok) {
    return (
      <>
        <h1 className="text-xl font-semibold">Admin audit</h1>
        <p role="alert" className="mt-4 text-sm text-richBlack">
          {parsed.message}
        </p>
        <FilterForm search={{ value: '', label: 'Search', placeholder: 'actor, action, target' }} />
      </>
    );
  }

  const query = parsed.query;
  const entries = recentAdminAudit.entries();
  const actorFilter = firstParam(raw, 'district');
  const outcomeFilter = firstParam(raw, 'status');
  // Its OWN schema field, because action names carry dots (finding 6).
  const actionFilter = query.action ?? '';

  const matched = filterAuditEntries(entries, {
    actor: actorFilter,
    action: actionFilter,
    outcome: outcomeFilter,
    from: query.from,
    to: query.to,
    search: query.search,
  });

  const range = rangeSpec(query);
  const slice = sliceAuditEntries(matched, range.from, range.to);
  const meta = pageMeta(range, slice.total);
  const hasFilter =
    actorFilter.length > 0
    || actionFilter.length > 0
    || outcomeFilter.length > 0
    || (query.search ?? '').length > 0
    || query.from !== undefined
    || query.to !== undefined;

  const shopParam = firstParam(raw, 'shop');
  const shopAudit = await loadShopAudit(shopParam, permissions, query);

  return (
    <>
      <h1 className="text-xl font-semibold">Admin audit</h1>
      <p className="mt-1 text-sm text-midGray">
        Logins, authorization denials and write actions, newest first. Failed and denied
        operations are included — a denial is the entry most worth keeping.
      </p>
      <p className="mt-2 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4 text-sm text-[#92400E]">
        <strong>This view is not the record.</strong> It holds the most recent entries from THIS
        server instance in memory only: a restart clears it, and another instance has its own. The
        durable record is the structured line written to stderr, kept by the host platform&apos;s
        log retention. The Postgres audit table ships in migration 35, which is not yet applied to
        any hosted project — so no durable audit persistence is claimed here.
      </p>

      <FilterForm
        search={{
          value: query.search ?? '',
          label: 'Search',
          placeholder: 'actor, action, target',
        }}
        selects={[
          {
            // Carried on `district` because that is the shared schema's spare
            // bounded text field. Labelled "Actor" for the operator; the
            // mapping is stated here rather than by adding a field to a schema
            // four other pages parse.
            name: 'district',
            label: 'Actor',
            value: actorFilter,
            options: [
              { value: '', label: 'Any actor' },
              ...auditActors(entries).map((actor) => ({ value: actor, label: actor })),
            ],
          },
          {
            name: 'action',
            label: 'Action',
            value: actionFilter,
            options: [
              { value: '', label: 'Any action' },
              ...auditActionNamespaces(entries).map((namespace) => ({
                value: namespace,
                label: namespace,
              })),
            ],
          },
          {
            name: 'status',
            label: 'Outcome',
            value: outcomeFilter,
            options: [
              { value: '', label: 'Any outcome' },
              ...AUDIT_OUTCOMES.map((outcome) => ({ value: outcome, label: outcome })),
            ],
          },
        ]}
        range={{ from: query.from ?? '', to: query.to ?? '' }}
      />

      {slice.entries.length === 0 ? (
        <EmptyState
          message={
            hasFilter
              ? 'No recorded action matches these filters. '
                + formatCount(entries.length)
                + ' entries are held by this instance in total.'
              : 'This instance has recorded no admin action yet.'
          }
        />
      ) : (
        <>
          <div className="mt-4">
            <DataTable
              columns={COLUMNS}
              rows={slice.entries}
              rowKey={(entry) => entry.at + entry.actor + entry.action}
              emptyMessage="This instance has recorded no admin action yet."
            />
          </div>
          <Pager meta={meta} params={carriedParams(raw)} noun="entries" />
        </>
      )}

      <section aria-labelledby="shop-audit" className="mt-10">
        <h2 id="shop-audit" className="text-base font-semibold">
          One pharmacy&rsquo;s own audit log
        </h2>
        <p className="mt-1 text-sm text-midGray">
          A pharmacy&rsquo;s internal history, for support and debugging only. Read-only: every
          privilege on that table is revoked from the panel&rsquo;s role and SELECT alone is
          granted back, so this view could not edit or delete a row even if it tried. Scoped to
          one pharmacy at a time, never all of them.
        </p>

        <form method="get" className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-midGray">Pharmacy id</span>
            <input
              type="text"
              name="shop"
              defaultValue={shopParam}
              placeholder="7b000000-0000-4000-8000-000000000001"
              maxLength={36}
              className="w-80 rounded border border-black/15 px-2 py-1 font-mono text-xs"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-brand-deepGreen px-3 py-1.5 text-sm font-medium text-white"
          >
            Open
          </button>
        </form>

        {shopAudit.state === 'absent' ? (
          <EmptyState message="No pharmacy is selected. Enter a pharmacy id, or reach this view from that pharmacy's page." />
        ) : shopAudit.state === 'forbidden' ? (
          <EmptyState message="This account does not hold the per-shop audit permission, so no pharmacy's log was read. Volume 5 scopes that view to support and debugging use." />
        ) : shopAudit.state === 'invalid' ? (
          <p role="alert" className="mt-3 text-sm text-richBlack">
            That is not a valid pharmacy id, so nothing was queried.
          </p>
        ) : shopAudit.state === 'failed' ? (
          <ErrorNotice message={shopAudit.message} />
        ) : shopAudit.page.rows.length === 0 ? (
          <EmptyState
            message={
              shopAudit.page.meta.isPastEnd
                ? 'That page is past the end of this pharmacy’s log, which holds '
                  + shopAudit.page.meta.total
                  + ' entries.'
                : 'This pharmacy has no audit entries. A fresh shop has none, and no demo data ships.'
            }
          />
        ) : (
          <>
            <div className="mt-3">
              <DataTable
                columns={SHOP_COLUMNS}
                rows={shopAudit.page.rows}
                rowKey={(row) => row.id}
                emptyMessage="This pharmacy has no audit entries."
              />
            </div>
            <Pager meta={shopAudit.page.meta} params={carriedParams(raw)} noun="pharmacy entries" />
          </>
        )}
      </section>
    </>
  );
}
