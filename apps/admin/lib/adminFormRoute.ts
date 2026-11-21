import 'server-only';

// The HTTP surface of the panel's eight write forms, as PLAIN FORM POSTS.
//
// WHY NOT SERVER ACTIONS ANY MORE. These used to be Next server actions that
// ended in `redirect('/page?done=...')`. The write always committed, but the
// browser frequently never followed the redirect: in the 2026-11-16 local
// acceptance run 10 of 12 clicks left the operator on the old page with no
// confirmation and a stale button. A stale "Enable" button invites a second
// click that flips the flag back; a stale note form invites a duplicate note
// that can never be deleted. The login form, a native POST answered with 303,
// never failed once in the same runs. So every write now works the same way:
// the browser posts the form, this handler runs the write, and a 303 sends the
// browser to a full page load of the outcome URL.
//
// THIN ON PURPOSE, as before. Permission, schema parsing, the guarded write
// and the audit entry all live in the lib/admin*Actions.ts modules, unchanged.
// This file only maps a URL to one of them and its answer to a redirect.
//
// What protects these endpoints:
//   - middleware.ts refuses any request without a valid session cookie;
//   - the session cookie is SameSite=Strict, so a cross-site POST has none;
//   - the Origin check below, the same one the login route uses;
//   - every write function calls requireAdminPermission before anything else.

import type { AdminWriteResult } from './adminAssignments';
import { recordAdminAction, type AdminAuditSink } from './adminAudit';
import { durableAuditSinks } from './adminAuditStore';
import { expireStalePaymentOrder, grantPlan, reconcilePlanLimits } from './adminActions';
import type { AdminEnvironment } from './adminAuthz';
import { ADMIN_FORM_ACTION_PREFIX } from './adminFormPaths';
import { assignAdminRole, revokeAdminSessions } from './adminIdentityActions';
import { clientSource, hasAllowedOrigin } from './adminOrigin';
import { outcomeFor, outcomeQuery, type AdminWriteOutcome } from './adminOutcomes';
import { setPlatformFeatureFlag } from './adminSettingsActions';
import { addSupportNote, openSupportCase, updateSupportCaseStatus } from './adminSupportActions';
import { AdminDataError, AdminForbiddenError, AdminUnauthenticatedError } from './errors';

/**
 * The largest form any of these writes can legitimately send: an 8,000
 * character note in Bengali is ~72 KB once URL-encoded.
 *
 * RESIDUAL, stated as the login route states it: a request that declares no
 * length (chunked transfer) is bounded only by the platform's own body limit.
 * Every form here is a native HTML POST, which always declares one, and the
 * route is behind a session and an Origin check, so only an authenticated
 * insider could send one.
 */
export const MAX_ACTION_BODY_BYTES = 128 * 1024;

/** The write functions, injectable so a test can see exactly what each form passes. */
export interface AdminFormWriters {
  reconcilePlanLimits: (accountId: string) => Promise<AdminWriteResult>;
  grantPlan: (payload: unknown) => Promise<AdminWriteResult>;
  expireStalePaymentOrder: (orderId: string) => Promise<AdminWriteResult>;
  setPlatformFeatureFlag: (payload: unknown) => Promise<AdminWriteResult>;
  openSupportCase: (payload: unknown) => Promise<AdminWriteResult>;
  updateSupportCaseStatus: (payload: unknown) => Promise<AdminWriteResult>;
  addSupportNote: (payload: unknown) => Promise<AdminWriteResult>;
  assignAdminRole: (payload: unknown) => Promise<AdminWriteResult>;
  revokeAdminSessions: (payload: unknown) => Promise<AdminWriteResult>;
}

// Wrapped so a caller can never slip a second (deps) argument through.
const REAL_WRITERS: AdminFormWriters = {
  reconcilePlanLimits: (accountId) => reconcilePlanLimits(accountId),
  grantPlan: (payload) => grantPlan(payload),
  expireStalePaymentOrder: (orderId) => expireStalePaymentOrder(orderId),
  setPlatformFeatureFlag: (payload) => setPlatformFeatureFlag(payload),
  openSupportCase: (payload) => openSupportCase(payload),
  updateSupportCaseStatus: (payload) => updateSupportCaseStatus(payload),
  addSupportNote: (payload) => addSupportNote(payload),
  assignAdminRole: (payload) => assignAdminRole(payload),
  revokeAdminSessions: (payload) => revokeAdminSessions(payload),
};

type Field = (name: string) => string;

/**
 * `'true'` and `'false'` only. Anything else — including an ABSENT field — is
 * passed through as the raw string, so the shared schema (`z.boolean()`)
 * refuses it with an audited failure. An absent field must never quietly mean
 * "off": that would disable a flag or an admin account by omission.
 */
function booleanField(raw: string): boolean | string {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

interface AdminFormAction {
  run: (field: Field, writers: AdminFormWriters) => Promise<AdminWriteResult>;
  /** A fixed path plus the outcome. Any id that goes into it is encoded. */
  destination: (field: Field, outcome: AdminWriteOutcome) => string;
}

function supportCaseDestination(action: string): AdminFormAction['destination'] {
  // The case detail lives at /support?case=<id>, so the operator lands back on
  // what they were editing.
  return (field, outcome) =>
    '/support' + outcomeQuery(action, outcome) + '&case=' + encodeURIComponent(field('caseId'));
}

/** Keyed by the last path segment of each entry in lib/adminFormPaths.ts. */
export const ADMIN_FORM_ACTIONS: Readonly<Record<string, AdminFormAction>> = Object.freeze({
  'reconcile-limits': {
    run: (field, w) => w.reconcilePlanLimits(field('accountId')),
    destination: (field, outcome) =>
      '/accounts/' + encodeURIComponent(field('accountId')) + outcomeQuery('reconcile', outcome),
  },
  // Founder-approved 2026-11-21. The shared schema validates every field.
  'grant-plan': {
    run: (field, w) => w.grantPlan({
      accountId: field('accountId'),
      tier: field('tier'),
      days: field('days'),
      reason: field('reason'),
    }),
    destination: (field, outcome) =>
      '/accounts/' + encodeURIComponent(field('accountId')) + outcomeQuery('grant', outcome),
  },
  'expire-order': {
    run: (field, w) => w.expireStalePaymentOrder(field('orderId')),
    destination: (_field, outcome) => '/payments' + outcomeQuery('expire', outcome),
  },
  'set-feature-flag': {
    run: (field, w) => w.setPlatformFeatureFlag({
      key: field('key'),
      // The form sends the NEW value explicitly; see app/settings/page.tsx.
      value: booleanField(field('value')),
    }),
    destination: (_field, outcome) => '/settings' + outcomeQuery('setting', outcome),
  },
  'open-support-case': {
    run: (field, w) => w.openSupportCase({
      requestId: field('requestId'),
      shopId: field('shopId'),
      category: field('category'),
      priority: field('priority'),
      summary: field('summary'),
    }),
    destination: (_field, outcome) => '/support' + outcomeQuery('case_open', outcome),
  },
  'update-support-case': {
    run: (field, w) => w.updateSupportCaseStatus({
      caseId: field('caseId'),
      status: field('status'),
      priority: field('priority'),
      assignee: field('assignee'),
      summary: field('summary'),
    }),
    destination: supportCaseDestination('case_update'),
  },
  'add-support-note': {
    run: (field, w) => w.addSupportNote({
      requestId: field('requestId'),
      caseId: field('caseId'),
      body: field('body'),
    }),
    destination: supportCaseDestination('note_add'),
  },
  'assign-admin-role': {
    run: (field, w) => w.assignAdminRole({
      username: field('username'),
      role: field('role'),
      isActive: booleanField(field('isActive')),
    }),
    destination: (_field, outcome) => '/admins' + outcomeQuery('assign_role', outcome),
  },
  'revoke-admin-sessions': {
    run: (field, w) => w.revokeAdminSessions({ username: field('username') }),
    destination: (_field, outcome) => '/admins' + outcomeQuery('revoke_sessions', outcome),
  },
});

export interface AdminFormRouteDeps {
  env?: AdminEnvironment;
  writers?: AdminFormWriters;
  /** Where refusals are recorded. Defaults to the durable sinks, as login does. */
  sinks?: readonly AdminAuditSink[];
}

/**
 * A refused request is recorded, as the login route records `login.bad_origin`.
 * With a SameSite=Strict cookie, a POST that carries a session but a foreign
 * Origin can only come from a sibling origin on the same site, which is worth
 * seeing. Unverified actor: nothing about the request has been proven yet.
 */
function auditRefusal(
  request: Request,
  actionName: string,
  reason: 'bad_origin' | 'oversized',
  sinks: readonly AdminAuditSink[] | undefined,
): void {
  recordAdminAction({
    actor: 'unknown',
    actorVerified: false,
    action: 'admin_form.' + reason,
    outcome: 'failure',
    // `path` is on the audit allowlist; an unlisted key would be dropped.
    meta: { source: clientSource(request), path: ADMIN_FORM_ACTION_PREFIX + actionName.slice(0, 64) },
  }, sinks ?? durableAuditSinks());
}

function plain(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function seeOther(location: string): Response {
  // 303 so the browser follows with GET: reloading the result page must never
  // resubmit the write.
  return new Response(null, {
    status: 303,
    headers: { location, 'cache-control': 'no-store', 'content-length': '0' },
  });
}

/**
 * What a THROWN error stands for.
 *
 * The write functions RETURN a result for everything at or after the write —
 * including "committed but not audited" — and throw only on the way in: no
 * session, no permission, or an id that fails the shared schema. Those are
 * plain failures.
 *
 * Anything else is unexpected, and the write may or may not have committed.
 * It still lands on `failed`, because that outcome's sentence is the honest
 * one for an unknown state — "could not be confirmed, check its current state
 * before retrying" — and it beats a bare 500 page, whose only next step is
 * Back and a resubmit. The error itself goes to the server log.
 */
function thrownOutcome(error: unknown): 'login' | 'failed' {
  if (error instanceof AdminUnauthenticatedError) return 'login';
  if (!(error instanceof AdminForbiddenError) && !(error instanceof AdminDataError)) {
    console.error('[admin] a form action threw an unexpected error:', error);
  }
  return 'failed';
}

export async function handleAdminFormAction(
  request: Request,
  actionName: string,
  deps: AdminFormRouteDeps = {},
): Promise<Response> {
  const env = deps.env ?? process.env;
  const writers = deps.writers ?? REAL_WRITERS;

  if (!hasAllowedOrigin(request, env)) {
    auditRefusal(request, actionName, 'bad_origin', deps.sinks);
    return plain(403, 'Request origin is not allowed.\n');
  }

  // Own-property lookup: a name such as `constructor` must not resolve to an
  // inherited member.
  const action = Object.prototype.hasOwnProperty.call(ADMIN_FORM_ACTIONS, actionName)
    ? ADMIN_FORM_ACTIONS[actionName]
    : undefined;
  if (!action) return plain(404, 'Unknown action.\n');

  const declaredLength = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ACTION_BODY_BYTES) {
    auditRefusal(request, actionName, 'oversized', deps.sinks);
    return plain(413, 'That request is too large.\n');
  }

  const form = await request.formData().catch(() => null);
  if (!form) return plain(400, 'That request is not a form submission.\n');
  const field: Field = (name) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };

  let outcome: AdminWriteOutcome;
  try {
    outcome = outcomeFor(await action.run(field, writers));
  } catch (error: unknown) {
    const thrown = thrownOutcome(error);
    if (thrown === 'login') return seeOther('/login');
    outcome = thrown;
  }
  return seeOther(action.destination(field, outcome));
}
