import Link from 'next/link';
import {
  ADMIN_SUPPORT_CATEGORY_VALUES,
  ADMIN_SUPPORT_PRIORITY_VALUES,
  ADMIN_SUPPORT_STATUS_VALUES,
} from '@muthoy/validation';
import AuditSourceNotice from '../../components/AuditSourceNotice';
import ErrorNotice from '../../components/ErrorNotice';
import { EmptyState, FilterForm } from '../../components/PageParts';
import { auditHistory } from '../../lib/adminAuditStore';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { outcomeNote } from '../../lib/adminOutcomes';
import {
  getSupportCaseDetail,
  listSupportCaseSummaries,
  supportCaseContext,
  type SupportCaseContext,
} from '../../lib/adminPlatformQueries';
import {
  SUPPORT_EMPTY_REASON,
  supportQueueCounts,
  type SupportCaseDetail,
  type SupportCaseSummary,
} from '../../lib/adminSupport';
import { formatDhakaDateTime, isUuid } from '../../lib/adminViews';
import { toDisplayMessage } from '../../lib/errors';
import {
  addSupportNoteAction,
  openSupportCaseAction,
  updateSupportCaseAction,
} from '../adminFormActions';

// Batch 3 §8.7 — Support Management.
//
// THE TABLES SHIP EMPTY, so the first honest state is an empty one that says so
// rather than a blank table a reader would take for a broken query. No case and
// no note is fabricated.
//
// ONE PAGE, and the selected case is `?case=<id>` — so a case detail has a URL
// that can be bookmarked, sent to the founder, and re-read by a test. The id is
// UUID-validated before it reaches a query.
//
// WHAT A SUPPORT ADMIN STILL CANNOT DO. The role holds support.read and
// support.write and nothing else: no subscriptions.write, no shop access beyond
// reading. Every write reachable from this page lands in an admin table — a
// note is a row in admin_support_notes, not a write to a pharmacy's data.
//
// NOTES ARE APPEND-ONLY BY PRIVILEGE. The table grants insert and nothing else,
// so there is no edit control to render and no endpoint one could call. The page
// says so, because an absent button is not an explanation.

export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  ...ADMIN_SUPPORT_STATUS_VALUES.map((value) => ({ value, label: value })),
];

interface SupportResult {
  cases: readonly SupportCaseSummary[];
  detail: SupportCaseDetail | null;
  /** §8.7's account and shop context for the open case (Gate 5 finding 14). */
  context: SupportCaseContext | null;
  /** Set when a `?case=` id was given but matched nothing. */
  missingCase: boolean;
}

type LoadResult = { ok: true; data: SupportResult } | { ok: false; message: string };

async function loadSupport(
  status: string,
  search: string,
  caseId: string | null,
): Promise<LoadResult> {
  try {
    // §8.7's search and status filters, BOTH pushed into the query (Gate 5
    // finding 14). The escaping lives in lib/adminFilters.ts; this page never
    // builds a pattern.
    const cases = await listSupportCaseSummaries({
      ...(status.length > 0 ? { status } : {}),
      ...(search.length > 0 ? { search } : {}),
    });
    if (caseId === null) {
      return { ok: true, data: { cases, detail: null, context: null, missingCase: false } };
    }

    const detail = await getSupportCaseDetail(caseId);
    // The context is read only once a case is actually open, and only for that
    // case's own shop.
    const context = detail === null ? null : await supportCaseContext(detail.case.shopId);
    return { ok: true, data: { cases, detail, context, missingCase: detail === null } };
  } catch (error: unknown) {
    console.error('[admin] the support queue failed to load:', error);
    return { ok: false, message: toDisplayMessage(error) };
  }
}

function firstParam(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

interface SupportPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SupportPage({ searchParams }: SupportPageProps) {
  let canWrite = false;
  try {
    const session = await requireAdminPermission('support.read');
    canWrite = session.permissions.includes('support.write');
  } catch (error: unknown) {
    console.error('[admin] support denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  const params = await searchParams;
  const status = firstParam(params.status);
  const search = firstParam(params.search).slice(0, 120);
  const requestedCase = firstParam(params.case);
  // Validated BEFORE it reaches a query, and a malformed id is reported rather
  // than passed down to produce a database error.
  const caseId = isUuid(requestedCase) ? requestedCase : null;

  const notice = outcomeNote(params, {
    case_open: 'The case is open.',
    case_update: 'The case is saved.',
    note_add: 'The note is saved, and cannot be edited or deleted.',
  });

  const result = await loadSupport(status, search, caseId);
  if (!result.ok) return <ErrorNotice message={result.message} />;

  const { cases, detail, context, missingCase } = result.data;

  // §8.7's CASE HISTORY (Gate 5 finding 14). Every transition and note is
  // audited, so the history IS this case's audit trail — not a second record
  // that could disagree with it. There is no transition table, and inventing
  // one would be a schema change with no authority behind it. Matched on the
  // redacted `caseId` meta key, which lib/adminAudit.ts allows only as a UUID.
  // ROUND 11 FINDING 5: the DURABLE log, so a case's transition history
  // survives a restart and is the same on every instance.
  const history = await auditHistory({ actionPrefixes: ['support.'] });
  const caseHistory =
    detail === null
      ? []
      : history.entries.filter(
          (entry) => String(entry.meta.caseId ?? '') === detail.case.id,
        );
  const counts = supportQueueCounts(cases);

  return (
    <>
      <h1 className="text-xl font-semibold">Support</h1>
      <p className="mt-1 text-sm text-midGray">
        {counts.total} {counts.total === 1 ? 'case' : 'cases'}, {counts.open} still open
        {counts.oldestOpenAgeDays === null
          ? ''
          : ', the oldest open for ' +
            counts.oldestOpenAgeDays +
            (counts.oldestOpenAgeDays === 1 ? ' day' : ' days')}
        .
      </p>

      {notice === null ? null : (
        <p
          role="status"
          className="mt-4 rounded border border-black/10 bg-offWhite p-3 text-sm text-richBlack"
        >
          {notice}
        </p>
      )}

      {requestedCase.length > 0 && caseId === null ? (
        <p role="alert" className="mt-4 text-sm text-midGray">
          That is not a valid case id.
        </p>
      ) : null}
      {missingCase ? (
        <p role="alert" className="mt-4 text-sm text-midGray">
          No support case with that id exists.
        </p>
      ) : null}

      <FilterForm
        search={{ value: search, label: 'Search summaries', placeholder: 'sync, reinstall…' }}
        selects={[{ name: 'status', label: 'Status', value: status, options: STATUS_OPTIONS }]}
      />

      {cases.length === 0 ? (
        <EmptyState
          message={
            search.length > 0 || status.length > 0
              ? 'No case matches these filters. The filters are applied in the query, so this is the real count.'
              : SUPPORT_EMPTY_REASON
          }
        />
      ) : (
        <table className="mt-4 w-full text-sm">
          <caption className="sr-only">Support cases, most recently updated first.</caption>
          <thead>
            <tr className="border-b border-black/10 text-left">
              <th scope="col" className="py-1 font-medium">
                Pharmacy
              </th>
              <th scope="col" className="py-1 font-medium">
                Category
              </th>
              <th scope="col" className="py-1 font-medium">
                Status
              </th>
              <th scope="col" className="py-1 font-medium">
                Priority
              </th>
              <th scope="col" className="py-1 font-medium">
                Assignee
              </th>
              <th scope="col" className="py-1 font-medium">
                Opened
              </th>
              <th scope="col" className="py-1 font-medium">
                Updated
              </th>
            </tr>
          </thead>
          <tbody>
            {cases.map((entry) => (
              <tr key={entry.id} className="border-b border-black/5">
                <th scope="row" className="py-1 text-left font-normal">
                  <Link href={'?case=' + entry.id} className="underline">
                    {/* A case whose shop was soft-deleted is still a case, so
                        the id is shown rather than the row dropped. */}
                    {entry.shopName ?? 'Shop ' + entry.shopId.slice(0, 8)}
                  </Link>
                </th>
                <td className="py-1">{entry.categoryLabel}</td>
                <td className="py-1">{entry.statusLabel}</td>
                <td className="py-1">{entry.priorityLabel}</td>
                <td className="py-1">{entry.assignee ?? 'Unassigned'}</td>
                <td className="py-1">{entry.openedOn}</td>
                <td className="py-1">{entry.lastUpdated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detail === null ? null : (
        <section
          aria-labelledby="case-detail"
          className="mt-8 rounded border border-black/10 bg-white p-4"
        >
          <h2 id="case-detail" className="text-base font-semibold">
            {detail.case.shopName ?? 'Shop ' + detail.case.shopId.slice(0, 8)} ·{' '}
            {detail.case.categoryLabel}
          </h2>
          <p className="mt-1 text-sm text-midGray">
            Opened by {detail.case.openedBy} on {detail.case.openedOn} · {detail.case.statusLabel} ·{' '}
            {detail.case.priorityLabel} · {detail.case.ageDays}{' '}
            {detail.case.ageDays === 1 ? 'day' : 'days'} old
          </p>
          <p className="mt-2 text-sm">{detail.case.summary}</p>
          <p className="mt-1 text-xs text-midGray">
            <Link href={'/shops/' + detail.case.shopId} className="underline">
              Open this pharmacy
            </Link>
          </p>

          {/* §8.7's ACCOUNT AND SHOP CONTEXT (Gate 5 finding 14). Specified and
              absent. Deliberately thin: the plan and the commercial status are
              what a support conversation turns on, and the full billing picture
              is one click away on the pharmacy's own page rather than
              duplicated — and possibly contradicted — here. */}
          <dl className="mt-3 grid gap-2 rounded border border-black/10 bg-offWhite p-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-midGray">Plan</dt>
              <dd className="mt-0.5">{context?.plan ?? 'could not be read'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-midGray">Commercial status</dt>
              <dd className="mt-0.5">{context?.commercialStatus ?? 'could not be read'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-midGray">Billing account</dt>
              <dd className="mt-0.5">
                {context === null
                  ? 'could not be read'
                  : context.hasBillingAccount
                    ? 'linked'
                    : 'none'}
              </dd>
            </div>
          </dl>

          {/* §8.7's CASE HISTORY (Gate 5 finding 14). Every transition and note
              is audited, so the history IS the audit trail for this case id —
              not a second record that could disagree with it. There is no
              transition table, and inventing one would be a schema change with
              no authority behind it. */}
          <div className="mt-4">
            <h3 className="text-sm font-semibold">Case history</h3>
            <AuditSourceNotice unavailable={history.unavailable} />
            {caseHistory.length === 0 ? (
              <p role="status" className="mt-1 text-sm text-midGray">
                No change to this case has been recorded.
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {caseHistory.map((item) => (
                  <li key={item.at + item.action}>
                    {formatDhakaDateTime(item.at)} · {item.actor} · {item.action} ·{' '}
                    {item.outcome}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canWrite ? (
            <form action={updateSupportCaseAction} className="mt-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="caseId" value={detail.case.id} />
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-midGray">Status</span>
                <select
                  name="status"
                  defaultValue={detail.case.status}
                  className="rounded border border-black/15 px-2 py-1"
                >
                  {ADMIN_SUPPORT_STATUS_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-midGray">Priority</span>
                <select
                  name="priority"
                  defaultValue={detail.case.priority}
                  className="rounded border border-black/15 px-2 py-1"
                >
                  {ADMIN_SUPPORT_PRIORITY_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-midGray">Assignee</span>
                <input
                  type="text"
                  name="assignee"
                  defaultValue={detail.case.assignee ?? ''}
                  maxLength={64}
                  className="w-40 rounded border border-black/15 px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-midGray">Summary</span>
                <input
                  type="text"
                  name="summary"
                  defaultValue={detail.case.summary}
                  maxLength={2000}
                  required
                  className="w-72 rounded border border-black/15 px-2 py-1"
                />
              </label>
              <button
                type="submit"
                className="rounded bg-brand-deepGreen px-3 py-1.5 text-sm font-medium text-white"
              >
                Save case
              </button>
            </form>
          ) : (
            <p className="mt-4 text-xs text-midGray">
              Read-only: this role does not hold support.write.
            </p>
          )}

          <h3 className="mt-6 text-sm font-semibold">
            Notes ({detail.notes.length}) · append-only
          </h3>
          <p className="mt-1 text-xs text-midGray">
            A note cannot be edited or deleted. That is enforced by the table&rsquo;s privileges — it
            grants insert and nothing else — not by this page omitting a button.
          </p>

          {detail.notes.length === 0 ? (
            <p role="status" className="mt-2 text-sm text-midGray">
              No note has been written on this case.
            </p>
          ) : (
            <ol className="mt-2 space-y-2">
              {detail.notes.map((note) => (
                <li key={note.id} className="rounded border border-black/5 bg-offWhite p-2 text-sm">
                  <p className="text-xs text-midGray">
                    {note.author} · {note.writtenAt}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{note.body}</p>
                </li>
              ))}
            </ol>
          )}

          {canWrite ? (
            <form action={addSupportNoteAction} className="mt-4">
              <input type="hidden" name="caseId" value={detail.case.id} />
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-midGray">Add a note</span>
                <textarea
                  name="body"
                  rows={3}
                  maxLength={8000}
                  required
                  className="w-full rounded border border-black/15 p-2"
                />
              </label>
              <button
                type="submit"
                className="mt-2 rounded bg-brand-deepGreen px-3 py-1.5 text-sm font-medium text-white"
              >
                Append note
              </button>
            </form>
          ) : null}
        </section>
      )}

      {canWrite ? (
        <section
          aria-labelledby="open-case"
          className="mt-8 rounded border border-black/10 bg-white p-4"
        >
          <h2 id="open-case" className="text-base font-semibold">
            Open a case
          </h2>
          <p className="mt-1 text-sm text-midGray">
            Every case is about one pharmacy. Paste its id from the pharmacy list.
          </p>
          <form action={openSupportCaseAction} className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-midGray">Pharmacy id</span>
              <input
                type="text"
                name="shopId"
                required
                maxLength={36}
                className="w-80 rounded border border-black/15 px-2 py-1 font-mono text-xs"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-midGray">Category</span>
              <select
                name="category"
                defaultValue="other"
                className="rounded border border-black/15 px-2 py-1"
              >
                {ADMIN_SUPPORT_CATEGORY_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-midGray">Priority</span>
              <select
                name="priority"
                defaultValue="normal"
                className="rounded border border-black/15 px-2 py-1"
              >
                {ADMIN_SUPPORT_PRIORITY_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-midGray">Summary</span>
              <input
                type="text"
                name="summary"
                required
                maxLength={2000}
                className="w-72 rounded border border-black/15 px-2 py-1"
              />
            </label>
            <button
              type="submit"
              className="rounded bg-brand-deepGreen px-3 py-1.5 text-sm font-medium text-white"
            >
              Open case
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
