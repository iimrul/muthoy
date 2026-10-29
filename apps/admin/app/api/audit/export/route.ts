import { CSV_CONTENT_TYPE, contentDisposition, toCsv } from '../../../../lib/adminCsv';
import {
  AdminAuditExportTooLargeError,
  AdminAuditReadError,
  AUDIT_EXPORT_MAX,
  readAdminAuditLogForExport,
  recordAdminActionDurably,
} from '../../../../lib/adminAuditStore';
import { dhakaDayEndIso, dhakaDayStartIso } from '../../../../lib/adminFilters';
import {
  auditDhakaDay,
  filterAuditEntries,
  formatAuditMeta,
} from '../../../../lib/adminAuditViews';
import { currentAdminSession, requireAdminPermission } from '../../../../lib/adminAuthz';
import { AdminForbiddenError, AdminUnauthenticatedError } from '../../../../lib/errors';

// Batch 3 §4.4 / §8.9 — the AUDIT export endpoint.
//
// ROUND 11 FINDING 6. `audit.export` was declared in lib/adminRoles.ts, held by
// super_admin alone, documented in §4.4 — and checked by nothing. There was no
// handler and no download. A permission with no enforcement point is not an
// access control; it is a line in a document, and it made the role matrix
// claim a capability the panel did not have.
//
// IT RE-CHECKS `audit.export` ITSELF, for the reason the report export does:
// the middleware establishes that there IS a session, not which permission
// this route needs, and this one returns a file of security history.
//
// `audit.export` IS NOT `audit.read`. Reading denials and logins on screen is
// one thing; carrying a file of them out of the building is another, so only
// super_admin holds it. The split is the same one `reports.export` makes.
//
// THE EXPORT IS ITSELF AUDITED, and awaited. Downloading the security log is
// exactly the action an audit trail exists to record, and an export that left
// no trace would be the one action invisible to the thing it copied. The write
// is awaited rather than fired and forgotten: if it cannot be recorded, the
// file is not sent.
//
// IT REFUSES RATHER THAN TRUNCATING, and ROUND 12 FINDING 6 is why that
// sentence needed to become true. It used to read the PAGE's bounded 500 and
// filter that sample: with 501 stored events — one older `admins.disabled`
// denial followed by 500 logins — the unfiltered export returned 200 with 500
// events, and `?action=admins.` returned 200 with headers only. A successful
// CSV omitted the event it was asked for and said nothing about it.
//
// So the filters run SERVER-SIDE, before pagination, and the read pages all
// the way through. Beyond AUDIT_EXPORT_MAX it answers 413 and sends nothing.
// If the durable table cannot be read at all it answers 503. The /audit PAGE
// may fall back to the in-process ring behind a visible notice, because a
// partial view that says so is still useful; a FILE cannot say it once
// detached from the screen.

export const dynamic = 'force-dynamic';

/** Fixed sentences. A raw error here would reach a browser. */
const MESSAGES = {
  unauthenticated: 'Sign in to export the audit log.',
  forbidden: 'Your admin role may view the audit log but may not export it.',
  unavailable:
    'The durable audit log could not be read, so no export was produced. An export that '
    + 'silently omitted entries would be worse than none. Gate E4-H (migration 35 applied to '
    + 'the hosted project) is what this endpoint needs.',
  unrecorded:
    'The export was not produced because it could not itself be recorded in the audit log.',
  tooLarge:
    'That range matches more than ' + AUDIT_EXPORT_MAX + ' audit entries, so no file was '
    + 'produced. A truncated export that looked complete would be worse than none. Narrow '
    + 'the dates, the actor or the action and try again.',
  failed: 'The audit export could not be produced. The server log has the details.',
} as const;

function problem(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

const COLUMNS = Object.freeze([
  'At (UTC)',
  'Dhaka day',
  'Actor',
  'Verified actor',
  'Role',
  'Action',
  'Target',
  'Outcome',
  'Details',
]);

export async function GET(request: Request): Promise<Response> {
  // FIRST, before the query string is even looked at.
  try {
    await requireAdminPermission('audit.export');
  } catch (error) {
    if (error instanceof AdminUnauthenticatedError) {
      return problem(401, MESSAGES.unauthenticated);
    }
    if (error instanceof AdminForbiddenError) {
      return problem(403, MESSAGES.forbidden);
    }
    console.error('[admin] audit export authorization failed:', error);
    return problem(500, MESSAGES.failed);
  }

  const url = new URL(request.url);
  // The same filters the page offers. Four of them are pushed into the QUERY
  // (round 12 finding 6) so the bound applies to the matches rather than the
  // matches to the bound; the free-text search is applied in memory, over the
  // complete matching set rather than over a truncated sample.
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  const filter = {
    actor: url.searchParams.get('actor') ?? undefined,
    action: url.searchParams.get('action') ?? undefined,
    outcome: url.searchParams.get('outcome') ?? undefined,
    from,
    to,
    search: url.searchParams.get('search') ?? undefined,
  };

  let entries;
  try {
    entries = await readAdminAuditLogForExport({
      actor: filter.actor,
      action: filter.action,
      outcome: filter.outcome,
      // The Dhaka day bounds, not the raw strings: `at` is a timestamptz, and
      // comparing it against a bare date would put six hours of every Dhaka
      // day on the wrong side of the bound.
      fromIso: from === undefined ? undefined : dhakaDayStartIso(from),
      toIso: to === undefined ? undefined : dhakaDayEndIso(to),
    });
  } catch (error) {
    if (error instanceof AdminAuditExportTooLargeError) {
      return problem(413, MESSAGES.tooLarge);
    }
    if (error instanceof AdminAuditReadError) {
      return problem(503, MESSAGES.unavailable);
    }
    console.error('[admin] audit export read failed:', error);
    return problem(500, MESSAGES.failed);
  }

  const matched = filterAuditEntries(entries, filter);
  const document = {
    headers: COLUMNS,
    rows: matched.map((entry) => [
      entry.at,
      auditDhakaDay(entry) ?? '',
      entry.actor,
      // Spelled out rather than 'true'/'false': this column is the difference
      // between an actor the server verified and a name a request claimed.
      entry.actorVerified ? 'verified session' : 'unverified (claimed)',
      entry.role ?? '',
      entry.action,
      entry.target ?? '',
      entry.outcome,
      formatAuditMeta(entry),
    ]),
  };

  // Recorded BEFORE the response is returned, and awaited. The row count is in
  // the meta so a later reader can tell how much was taken, not merely that
  // something was.
  try {
    const session = await currentAdminSession();
    const recorded = await recordAdminActionDurably({
      actor: session?.username ?? 'unknown',
      actorVerified: session !== null,
      role: session?.role ?? null,
      action: 'audit.export',
      target: null,
      outcome: 'success',
      // ROUND 12 FINDING 7: `rowCount` is the key §8.9's redactor ALLOWS.
      // `rows` and `scanned` are not in ALLOWED_META_KEYS, so both were
      // dropped and every export stored `meta: {}` — the one action whose
      // audit entry needs to say how much history left the building said
      // nothing at all.
      meta: { rowCount: matched.length },
    });
    if (recorded.durability === 'failed') {
      return problem(500, MESSAGES.unrecorded);
    }
  } catch (error) {
    console.error('[admin] audit export could not be audited:', error);
    return problem(500, MESSAGES.unrecorded);
  }

  return new Response(toCsv(document), {
    status: 200,
    headers: {
      'content-type': CSV_CONTENT_TYPE,
      'content-disposition': contentDisposition('muthoy-admin-audit.csv'),
      // Never cached: it is security history, and an intermediary holding a
      // copy would be a second place it exists.
      'cache-control': 'no-store',
    },
  });
}
