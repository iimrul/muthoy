// The eight write forms' HTTP surface, executed. The write functions are fakes
// here on purpose: their own suites (adminActions, adminSettings, adminSupport,
// adminIdentityStore) execute permission, schema and audit. What this file
// pins is the part that moved — which form reaches which writer with which
// fields, where the browser lands, and what is refused before any write runs.

import { describe, expect, test, vi } from 'vitest';
import type { AdminWriteResult } from './adminAssignments';
import type { AdminAuditEntry, AdminAuditSink } from './adminAudit';
import { ADMIN_FORM_ACTION_PREFIX, ADMIN_FORM_PATHS } from './adminFormPaths';
import {
  ADMIN_FORM_ACTIONS,
  MAX_ACTION_BODY_BYTES,
  handleAdminFormAction,
  type AdminFormWriters,
} from './adminFormRoute';
import { AdminDataError, AdminForbiddenError, AdminUnauthenticatedError } from './errors';

const ORIGIN = 'https://admin.muthoy.test';
const ENV = {};
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CASE = '22222222-2222-4222-8222-222222222222';

const DONE: AdminWriteResult = { ok: true, message: 'ok' };
const FAILED: AdminWriteResult = { ok: false, message: 'no' };
const UNRECORDED: AdminWriteResult = {
  ok: false,
  committed: true,
  code: 'audit_write_failed',
  message: 'applied, not recorded',
};

function writers(result: AdminWriteResult = DONE): AdminFormWriters {
  return {
    reconcilePlanLimits: vi.fn(async () => result),
    expireStalePaymentOrder: vi.fn(async () => result),
    setPlatformFeatureFlag: vi.fn(async () => result),
    openSupportCase: vi.fn(async () => result),
    updateSupportCaseStatus: vi.fn(async () => result),
    addSupportNote: vi.fn(async () => result),
    assignAdminRole: vi.fn(async () => result),
    revokeAdminSessions: vi.fn(async () => result),
  };
}

function post(
  action: string,
  fields: Record<string, string>,
  options: { origin?: string | null; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded', ...options.headers });
  if (options.origin !== null) headers.set('origin', options.origin ?? ORIGIN);
  return new Request(ORIGIN + ADMIN_FORM_ACTION_PREFIX + action, {
    method: 'POST',
    headers,
    body: new URLSearchParams(fields).toString(),
  });
}

/** A sink that keeps what it is given, so no test reaches the durable store. */
function captureSink(): { sink: AdminAuditSink; entries: AdminAuditEntry[] } {
  const entries: AdminAuditEntry[] = [];
  return { sink: { write: (entry) => { entries.push(entry); } }, entries };
}

function calledWith(fn: unknown): unknown {
  return (fn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
}

function noneCalled(w: AdminFormWriters): boolean {
  return Object.values(w).every((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls.length === 0);
}

describe('the form paths and the handlers are the same set', () => {
  test('every path a page can post to has a handler, and no handler is unreachable', () => {
    const fromPaths = Object.values(ADMIN_FORM_PATHS)
      .map((path) => path.slice(ADMIN_FORM_ACTION_PREFIX.length))
      .sort();
    expect(fromPaths).toEqual(Object.keys(ADMIN_FORM_ACTIONS).sort());
    expect(fromPaths).toHaveLength(8);
  });
});

describe('refused before any write runs', () => {
  test('no Origin header is a 403, and the refusal is audited', async () => {
    const w = writers();
    const audit = captureSink();
    const response = await handleAdminFormAction(post('set-feature-flag', { key: 'k', value: 'true' }, { origin: null, headers: { 'x-forwarded-for': '203.0.113.9' } }), 'set-feature-flag', { env: ENV, writers: w, sinks: [audit.sink] });
    expect(response.status).toBe(403);
    expect(noneCalled(w)).toBe(true);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({ actor: 'unknown', actorVerified: false, action: 'admin_form.bad_origin', outcome: 'failure' });
    expect(audit.entries[0]?.meta).toMatchObject({ source: '203.0.113.9', path: ADMIN_FORM_PATHS.setFeatureFlag });
  });

  test('a foreign Origin is a 403', async () => {
    const w = writers();
    const audit = captureSink();
    const response = await handleAdminFormAction(post('set-feature-flag', { key: 'k', value: 'true' }, { origin: 'https://evil.test' }), 'set-feature-flag', { env: ENV, writers: w, sinks: [audit.sink] });
    expect(response.status).toBe(403);
    expect(audit.entries.map((e) => e.action)).toEqual(['admin_form.bad_origin']);
    expect(noneCalled(w)).toBe(true);
  });

  test('ADMIN_ORIGIN pins the origin: the request host alone is no longer enough', async () => {
    const w = writers();
    const env = { ADMIN_ORIGIN: 'https://admin.muthoy.app' };
    const refused = await handleAdminFormAction(post('expire-order', { orderId: ACCOUNT }), 'expire-order', { env, writers: w, sinks: [captureSink().sink] });
    expect(refused.status).toBe(403);
    expect(noneCalled(w)).toBe(true);
    const accepted = await handleAdminFormAction(post('expire-order', { orderId: ACCOUNT }, { origin: 'https://admin.muthoy.app' }), 'expire-order', { env, writers: w });
    expect(accepted.status).toBe(303);
  });

  test.each(['nope', 'constructor', '__proto__', 'toString', ''])('an unknown action %j is a 404', async (name) => {
    const w = writers();
    const response = await handleAdminFormAction(post(name, {}), name, { env: ENV, writers: w });
    expect(response.status).toBe(404);
    expect(noneCalled(w)).toBe(true);
  });

  test('a declared body over the ceiling is a 413', async () => {
    const w = writers();
    const request = post('add-support-note', { caseId: CASE, body: 'x' }, {
      headers: { 'content-length': String(MAX_ACTION_BODY_BYTES + 1) },
    });
    const audit = captureSink();
    const response = await handleAdminFormAction(request, 'add-support-note', { env: ENV, writers: w, sinks: [audit.sink] });
    expect(response.status).toBe(413);
    expect(audit.entries.map((e) => e.action)).toEqual(['admin_form.oversized']);
    expect(noneCalled(w)).toBe(true);
  });

  test('a body that is not a form is a 400', async () => {
    const w = writers();
    const request = new Request(ORIGIN + ADMIN_FORM_PATHS.setFeatureFlag, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'text/plain' },
      body: 'key=k&value=true',
    });
    const response = await handleAdminFormAction(request, 'set-feature-flag', { env: ENV, writers: w });
    expect(response.status).toBe(400);
    expect(noneCalled(w)).toBe(true);
  });
});

describe('each form reaches its writer with its fields', () => {
  test('reconcile-limits', async () => {
    const w = writers();
    await handleAdminFormAction(post('reconcile-limits', { accountId: ACCOUNT }), 'reconcile-limits', { env: ENV, writers: w });
    expect(calledWith(w.reconcilePlanLimits)).toBe(ACCOUNT);
  });

  test('expire-order', async () => {
    const w = writers();
    await handleAdminFormAction(post('expire-order', { orderId: ACCOUNT }), 'expire-order', { env: ENV, writers: w });
    expect(calledWith(w.expireStalePaymentOrder)).toBe(ACCOUNT);
  });

  test.each([
    ['true', true],
    ['false', false],
    // Anything else reaches the shared schema as the raw string, which
    // `z.boolean()` refuses. An absent field must not quietly mean "off".
    ['TRUE', 'TRUE'],
    ['', ''],
  ])('set-feature-flag value %j is sent as %j', async (value, expected) => {
    const w = writers();
    await handleAdminFormAction(post('set-feature-flag', { key: 'flag.analytics_enabled', value }), 'set-feature-flag', { env: ENV, writers: w });
    expect(calledWith(w.setPlatformFeatureFlag)).toEqual({ key: 'flag.analytics_enabled', value: expected });
  });

  test('open-support-case', async () => {
    const w = writers();
    const fields = { requestId: 'r1', shopId: ACCOUNT, category: 'billing', priority: 'high', summary: 'সারাংশ' };
    await handleAdminFormAction(post('open-support-case', fields), 'open-support-case', { env: ENV, writers: w });
    expect(calledWith(w.openSupportCase)).toEqual(fields);
  });

  test('update-support-case', async () => {
    const w = writers();
    const fields = { caseId: CASE, status: 'resolved', priority: 'low', assignee: 'ops', summary: 's' };
    await handleAdminFormAction(post('update-support-case', fields), 'update-support-case', { env: ENV, writers: w });
    expect(calledWith(w.updateSupportCaseStatus)).toEqual(fields);
  });

  test('add-support-note', async () => {
    const w = writers();
    const fields = { requestId: 'r2', caseId: CASE, body: 'একটি নোট' };
    await handleAdminFormAction(post('add-support-note', fields), 'add-support-note', { env: ENV, writers: w });
    expect(calledWith(w.addSupportNote)).toEqual(fields);
  });

  test('assign-admin-role', async () => {
    const w = writers();
    await handleAdminFormAction(post('assign-admin-role', { username: 'ops', role: 'support', isActive: 'false' }), 'assign-admin-role', { env: ENV, writers: w });
    expect(calledWith(w.assignAdminRole)).toEqual({ username: 'ops', role: 'support', isActive: false });
  });

  test('assign-admin-role without isActive does NOT quietly disable the account', async () => {
    const w = writers();
    await handleAdminFormAction(post('assign-admin-role', { username: 'ops', role: 'support' }), 'assign-admin-role', { env: ENV, writers: w });
    expect(calledWith(w.assignAdminRole)).toEqual({ username: 'ops', role: 'support', isActive: '' });
  });

  test('revoke-admin-sessions', async () => {
    const w = writers();
    await handleAdminFormAction(post('revoke-admin-sessions', { username: 'ops' }), 'revoke-admin-sessions', { env: ENV, writers: w });
    expect(calledWith(w.revokeAdminSessions)).toEqual({ username: 'ops' });
  });

  test('a missing field reaches the writer as an empty string, for its schema to refuse', async () => {
    const w = writers();
    await handleAdminFormAction(post('revoke-admin-sessions', {}), 'revoke-admin-sessions', { env: ENV, writers: w });
    expect(calledWith(w.revokeAdminSessions)).toEqual({ username: '' });
  });
});

describe('where the browser lands: a 303 to the outcome URL', () => {
  const cases: ReadonlyArray<[string, Record<string, string>, string]> = [
    ['reconcile-limits', { accountId: ACCOUNT }, '/accounts/' + ACCOUNT + '?{k}=reconcile'],
    ['expire-order', { orderId: ACCOUNT }, '/payments?{k}=expire'],
    ['set-feature-flag', { key: 'k', value: 'true' }, '/settings?{k}=setting'],
    ['open-support-case', { shopId: ACCOUNT }, '/support?{k}=case_open'],
    ['update-support-case', { caseId: CASE }, '/support?{k}=case_update&case=' + CASE],
    ['add-support-note', { caseId: CASE }, '/support?{k}=note_add&case=' + CASE],
    ['assign-admin-role', { username: 'ops' }, '/admins?{k}=assign_role'],
    ['revoke-admin-sessions', { username: 'ops' }, '/admins?{k}=revoke_sessions'],
  ];

  test.each(cases)('%s', async (name, fields, template) => {
    for (const [result, key] of [[DONE, 'done'], [FAILED, 'failed'], [UNRECORDED, 'applied_unrecorded']] as const) {
      const response = await handleAdminFormAction(post(name, fields), name, { env: ENV, writers: writers(result) });
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(template.replace('{k}', key));
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  test('an id is encoded, so it cannot add a path segment or a query', async () => {
    const response = await handleAdminFormAction(post('reconcile-limits', { accountId: '../x?done=evil#y' }), 'reconcile-limits', { env: ENV, writers: writers(FAILED) });
    expect(response.headers.get('location')).toBe('/accounts/..%2Fx%3Fdone%3Devil%23y?failed=reconcile');
  });
});

describe('errors a write throws on the way in', () => {
  test('no permission is a plain failure, not a crash', async () => {
    const w = writers();
    w.setPlatformFeatureFlag = vi.fn(async () => { throw new AdminForbiddenError('settings.write', 'read_only'); });
    const response = await handleAdminFormAction(post('set-feature-flag', { key: 'k', value: 'true' }), 'set-feature-flag', { env: ENV, writers: w });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/settings?failed=setting');
  });

  test('an id that fails the shared schema is a plain failure', async () => {
    const w = writers();
    w.expireStalePaymentOrder = vi.fn(async () => { throw new AdminDataError('payment order is not a valid id'); });
    const response = await handleAdminFormAction(post('expire-order', { orderId: 'bad' }), 'expire-order', { env: ENV, writers: w });
    expect(response.headers.get('location')).toBe('/payments?failed=expire');
  });

  test('no session sends the browser to sign in', async () => {
    const w = writers();
    w.revokeAdminSessions = vi.fn(async () => { throw new AdminUnauthenticatedError('idle'); });
    const response = await handleAdminFormAction(post('revoke-admin-sessions', { username: 'ops' }), 'revoke-admin-sessions', { env: ENV, writers: w });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  test('anything else is logged and lands on the hedged "could not be confirmed" outcome, not a bare 500', async () => {
    const w = writers();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    w.addSupportNote = vi.fn(async () => { throw new Error('socket closed after commit?'); });
    const response = await handleAdminFormAction(post('add-support-note', { caseId: CASE, body: 'b' }), 'add-support-note', { env: ENV, writers: w });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/support?failed=note_add&case=' + CASE);
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  test('a pre-write refusal is not logged as unexpected', async () => {
    const w = writers();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    w.expireStalePaymentOrder = vi.fn(async () => { throw new AdminDataError('payment order is not a valid id'); });
    await handleAdminFormAction(post('expire-order', { orderId: 'bad' }), 'expire-order', { env: ENV, writers: w });
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
