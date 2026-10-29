import 'server-only';

// W4-06 — the credential boundary. The ONE place a password is verified.
//
// NODE RUNTIME ONLY: PBKDF2 does not exist in the Edge runtime, and running a
// correctly expensive KDF on every page request would itself be a
// denial-of-service surface. So the split is deliberate — this file verifies
// passwords in Node, middleware.ts verifies only a cookie signature in Edge.
//
// CONSTANT WORK, OR IT IS A USERNAME ORACLE. An unknown username runs the SAME
// 600,000-iteration PBKDF2 against a fixed dummy salt and hash, and the result
// is discarded. A username under cooldown or lockout also runs it, because
// short-circuiting there would reintroduce exactly the timing difference the
// dummy exists to remove. Every failure returns the SAME response: same status,
// same Location, same headers, no cookie. The distinction is recorded
// server-side in the audit log only.
//
// Two independent throttles, because one keyed on the supplied username is
// bypassed by rotating usernames:
//   1. per-username: exponential backoff and a 15-minute lockout after 10
//      failures. Only KNOWN usernames get an entry, so an attacker cannot grow
//      this map with invented names;
//   2. per-source: a fixed budget per client IP per window, keyed on nothing
//      the caller supplies in the body, reusing the bucket shape
//      payment-webhook/handler.ts already uses. Rotating usernames consumes
//      this budget, so enumeration stays bounded when every name is unknown.
//
// DEVIATION from plan rev 7, deliberate: the backoff is a COOLDOWN WINDOW, not
// an awaited sleep. Sleeping up to 60s inside a serverless handler holds a
// worker and can exceed the platform function timeout, which makes the delay a
// self-inflicted denial of service rather than a defence. The attempt is
// refused until the window passes instead, bounding attempts identically
// without holding a request open.
//
// HONEST LIMIT: both throttles are per-instance module state, so a
// multi-instance deployment multiplies both allowances by the instance count.
// The real rate limit belongs at the edge/host layer and is an external gate.

import { pbkdf2Sync } from 'node:crypto';
import { constantTimeEquals } from './basicAuth';
import { recordAdminAction, type AdminAuditSink } from './adminAudit';
import { durableAuditSinks, recordAdminActionDurably } from './adminAuditStore';
import { loadAdminIdentity, type AdminAccount } from './adminIdentity';
import { parseAdminRoles } from './adminRoles';
import { revokeRoleAssignmentSessions, type AdminIdentityStoreDeps } from './adminIdentityStore';
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionForRevocation,
  EXPIRED_SESSION_COOKIE_OPTIONS,
  newSessionPayload,
  readSessionEpoch,
  readSessionSecret,
  sessionCookieOptions,
  signAdminSession,
  type AdminSessionPayload,
  type SessionCookieOptions,
} from './adminSession';
import { AdminConfigError } from './errors';
import type { AdminEnvironment } from './adminAuthz';

export const PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_KEY_BYTES = 32;
export const PBKDF2_DIGEST = 'sha256';

/** Fixed, public, and never a real account: the unknown-username branch pays the same cost. */
const DUMMY_ACCOUNT: AdminAccount = {
  username: '\u0000unknown',
  salt: '00000000000000000000000000000000',
  hash: '0000000000000000000000000000000000000000000000000000000000000000',
};

export const MAX_USERNAME_FAILURES = 10;
export const USERNAME_LOCKOUT_MS = 15 * 60 * 1_000;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 60 * 1_000;
export const SOURCE_WINDOW_MS = 15 * 60 * 1_000;
export const SOURCE_BUDGET = 30;
const MAX_FIELD_LENGTH = 256;
/**
 * Both forms on this route are a handful of short fields, so a body larger
 * than this is not a login attempt.
 *
 * WHY IT EXISTS. The source budget used to be the FIRST thing this handler
 * did, and its comment said why: "it runs before the KDF, so a flood cannot
 * spend CPU without spending budget." Round 1A moved it below the logout
 * branch, correctly -- an exhausted budget must not trap an operator in a
 * session they cannot end -- but the logout signal lives in the body, so
 * `readFields` became reachable by any unauthenticated request. The budget is
 * still ahead of the KDF, which was the expensive half; this ceiling covers
 * the half that moved.
 *
 * RESIDUAL, stated rather than implied: a request that declares no length
 * (chunked transfer) is bounded only by the platform's own body limit. Both
 * of this panel's forms are native HTML POSTs, which always declare one, so
 * refusing an undeclared length would cost more than it buys.
 */
const MAX_SESSION_BODY_BYTES = 4_096;
const MAX_SOURCE_BUCKETS = 10_000;

interface UsernameThrottle {
  failures: number;
  nextAttemptAt: number;
  lockedUntil: number;
}

interface SourceThrottle {
  startedAt: number;
  count: number;
}

export interface LoginThrottles {
  byUsername: Map<string, UsernameThrottle>;
  bySource: Map<string, SourceThrottle>;
}

export function createLoginThrottles(): LoginThrottles {
  return { byUsername: new Map(), bySource: new Map() };
}

const moduleThrottles = createLoginThrottles();

export interface LoginDeps {
  env?: AdminEnvironment;
  now?: () => number;
  /** Injectable so control-flow tests need not pay 600k iterations each; one test pins the real one. */
  derive?: (password: string, saltHex: string) => string;
  throttles?: LoginThrottles;
  sinks?: readonly AdminAuditSink[];
  /** Logout uses the same monotonic cutoff store as administrator revocation. */
  identityStore?: AdminIdentityStoreDeps;
}

export function derivePasswordHash(password: string, saltHex: string): string {
  return pbkdf2Sync(
    password,
    Buffer.from(saltHex, 'hex'),
    PBKDF2_ITERATIONS,
    PBKDF2_KEY_BYTES,
    PBKDF2_DIGEST,
  ).toString('hex');
}

export function clientSource(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const firstHop = forwarded?.split(',')[0]?.trim();
  if (firstHop) return firstHop;
  return request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

/** The origins a browser may legitimately post this form from. */
function allowedOrigins(request: Request, env: AdminEnvironment): Set<string> {
  const configured = env.ADMIN_ORIGIN?.trim();
  if (configured) return new Set([configured.replace(/\/$/, '')]);

  const origins = new Set<string>();
  try {
    origins.add(new URL(request.url).origin);
  } catch {
    // An unparseable request URL leaves the forwarded host as the only source.
  }
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedHost) {
    const scheme = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
    origins.add(scheme + '://' + forwardedHost);
  }
  return origins;
}

function consumeSourceBudget(throttles: LoginThrottles, source: string, now: number): boolean {
  const bucket = throttles.bySource.get(source);
  if (!bucket || now - bucket.startedAt >= SOURCE_WINDOW_MS) {
    // Sweep expired buckets before adding one, so a rotating-IP flood cannot
    // grow this map without bound.
    if (throttles.bySource.size > MAX_SOURCE_BUCKETS) {
      for (const [key, value] of throttles.bySource) {
        if (now - value.startedAt >= SOURCE_WINDOW_MS) throttles.bySource.delete(key);
      }
    }
    throttles.bySource.set(source, { startedAt: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= SOURCE_BUDGET;
}

function usernameAttemptAllowed(throttles: LoginThrottles, username: string, now: number): boolean {
  const state = throttles.byUsername.get(username);
  if (!state) return true;
  if (now < state.lockedUntil) return false;
  return now >= state.nextAttemptAt;
}

function recordUsernameFailure(throttles: LoginThrottles, username: string, now: number): void {
  const state = throttles.byUsername.get(username)
    ?? { failures: 0, nextAttemptAt: 0, lockedUntil: 0 };
  const failures = state.failures + 1;
  const backoff = Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_CAP_MS);
  throttles.byUsername.set(username, {
    failures,
    nextAttemptAt: now + backoff,
    lockedUntil: failures >= MAX_USERNAME_FAILURES ? now + USERNAME_LOCKOUT_MS : 0,
  });
}

function serializeCookie(name: string, value: string, options: SessionCookieOptions): string {
  return [
    name + '=' + value,
    'Path=' + options.path,
    'Max-Age=' + String(options.maxAge),
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ].join('; ');
}

/** Every failure answers with these exact bytes. No field distinguishes the cause. */
export const LOGIN_FAILURE_LOCATION = '/login?error=invalid';

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({
    location,
    'cache-control': 'no-store',
    'content-length': '0',
  });
  if (cookie) headers.set('set-cookie', cookie);
  // 303 so the browser follows with GET: a form POST must not be replayable by
  // a reload.
  return new Response(null, { status: 303, headers });
}

function plain(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

interface AuditCall {
  actor: string;
  role?: string | null;
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  now: number;
  meta?: Record<string, unknown>;
}

/**
 * Batch 3 §8.9. Credential attempts use `actorVerified: false`. Logout has
 * its own awaited record because it verifies a cookie and writes a cutoff.
 *
 * A login attempt by nature PRECEDES a session, so `call.actor` is either
 * 'unknown' or the username the request CLAIMED — never a value proven by a
 * verified cookie. A successful login is still an unverified actor here: the
 * password was checked, but the cookie it mints has not been presented yet.
 * So an unauthenticated caller cannot produce a row with actor_verified = true
 * no matter what it sends.
 *
 * IT STAYS SYNCHRONOUS, deliberately. The entry reaches the durable sink —
 * `durableAuditSinks()` includes it, so a failed-login row does land in
 * `admin_audit_log` — but this path does NOT await the insert. Awaiting a
 * database round-trip inside credential verification would add a timing signal
 * to the one place that is deliberately constant-work, and would make the login
 * route fail when the audit table is unreachable. stderr runs first and remains
 * the record of account.
 */
function audit(call: AuditCall, sinks: readonly AdminAuditSink[] | undefined): void {
  const entry = {
    actor: call.actor,
    actorVerified: false,
    role: call.role ?? null,
    action: call.action,
    outcome: call.outcome,
    now: call.now,
    meta: call.meta,
  };
  recordAdminAction(entry, sinks ?? durableAuditSinks());
}

async function readFields(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const parsed: unknown = await request.json().catch(() => null);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  }
  const form = await request.formData().catch(() => null);
  if (!form) return {};
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') fields[key] = value;
  }
  return fields;
}

/**
 * The session a REQUEST can prove, or null. Reads the cookie off the request
 * header and verifies its signature and expiries; a request that proves nothing
 * gets null rather than whatever it claimed.
 */
async function verifiedActor(
  request: Request,
  env: AdminEnvironment,
  now: number,
): Promise<AdminSessionPayload | null> {
  const header = request.headers.get('cookie');
  if (!header) return null;
  const pair = header.split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(ADMIN_SESSION_COOKIE + '='));
  if (!pair) return null;

  try {
    const verified = await verifyAdminSessionForRevocation(pair.slice(ADMIN_SESSION_COOKIE.length + 1), {
      secret: readSessionSecret(env),
      epoch: readSessionEpoch(env),
      now,
    });
    return verified.ok ? verified.payload : null;
  } catch {
    // An unconfigured panel cannot prove an actor either.
    return null;
  }
}

export async function handleAdminSessionRequest(
  request: Request,
  deps: LoginDeps = {},
): Promise<Response> {
  const env = deps.env ?? process.env;
  const now = (deps.now ?? Date.now)();
  const derive = deps.derive ?? derivePasswordHash;
  const throttles = deps.throttles ?? moduleThrottles;
  const sinks = deps.sinks;
  const source = clientSource(request);

  // CSRF: this route cannot rely on a session cookie it has not issued yet,
  //    so the Origin header is the check. A missing Origin is a rejection.
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins(request, env).has(origin.replace(/\/$/, ''))) {
    audit({ actor: 'unknown', action: 'login.bad_origin', outcome: 'failure', now, meta: { source } }, sinks);
    return plain(403, 'Request origin is not allowed.\n');
  }

  const declaredLength = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SESSION_BODY_BYTES) {
    audit({ actor: 'unknown', action: 'login.oversized', outcome: 'failure', now, meta: { source } }, sinks);
    return plain(413, 'That request is too large.\n');
  }

  const fields = await readFields(request);
  if (fields.intent === 'logout') {
    // The actor comes from the VERIFIED cookie, never from the body. Taking it
    // from a form field let any unauthenticated caller with an accepted Origin
    // write "founder logged out, success" into the audit log — a log that can
    // be written by a stranger is worse than no log, because it is believed.
    // Clearing the cookie still happens either way: a logout must work even
    // when the session it is clearing is already invalid.
    const session = await verifiedActor(request, env, now);
    const actor = session?.sub ?? null;
    let confirmed = true;
    if (session) {
      try {
        const standingRole = parseAdminRoles(env.ADMIN_ROLES).get(session.sub);
        if (!standingRole) throw new AdminConfigError('Logout subject has no environment role');
        // Revoke this cookie and older ones, including copies refreshed by Edge.
        // A newer login survives. The store never widens or re-enables a row.
        await revokeRoleAssignmentSessions({
          username: session.sub,
          standingRole,
          assignedBy: session.sub,
          revokeAtMs: session.iat,
        }, { ...deps.identityStore, now: deps.identityStore?.now ?? (() => new Date(now)) });
      } catch {
        confirmed = false;
        console.error('[admin] logout session revocation could not be confirmed');
      }
    }
    const recorded = await recordAdminActionDurably({
      actor: actor ?? 'unknown',
      actorVerified: session !== null,
      action: 'logout',
      outcome: actor === null || !confirmed ? 'failure' : 'success',
      now,
      meta: { source, ...(actor === null ? { reason: 'no_valid_session' } : !confirmed ? { reason: 'revocation_unconfirmed' } : {}) },
    }, sinks);
    return redirect(
      !confirmed ? '/login?signOutUnconfirmed=1'
        : recorded.durability === 'failed' ? '/login?signOutUnrecorded=1'
          : '/login?signedOut=1',
      serializeCookie(ADMIN_SESSION_COOKIE, '', EXPIRED_SESSION_COOKIE_OPTIONS),
    );
  }

  // Login budget precedes the KDF. Logout must remain possible after a burst
  // of failed credentials and does not consume the credential budget itself.
  if (!consumeSourceBudget(throttles, source, now)) {
    audit({ actor: 'unknown', action: 'login.throttled', outcome: 'failure', now, meta: { source, reason: 'source_budget' } }, sinks);
    return plain(429, 'Too many attempts. Try again later.\n');
  }

  // 3. Configuration. Fails closed exactly as the panel does with no
  //    credentials configured at all.
  let identity;
  let secret: string;
  let epoch: number;
  try {
    identity = loadAdminIdentity(env);
    secret = readSessionSecret(env);
    epoch = readSessionEpoch(env);
  } catch (error) {
    if (error instanceof AdminConfigError) {
      console.error('[admin] session route is not configured:', error.message);
      return plain(503, 'Admin panel is not configured.\n');
    }
    throw error;
  }

  const username = fields.username ?? '';
  const suppliedPassword = fields.password ?? '';
  const fieldsValid = username.length <= MAX_FIELD_LENGTH && suppliedPassword.length <= MAX_FIELD_LENGTH;
  // Bound KDF work without authenticating a truncated credential as the full
  // submitted password. Invalid lengths still pay exactly one KDF.
  const password = suppliedPassword.slice(0, MAX_FIELD_LENGTH);
  const account = username.length > 0 ? identity.accounts.get(username) ?? null : null;
  const record = account ?? DUMMY_ACCOUNT;

  // 4. ALWAYS exactly one KDF run, whatever happens next.
  const derived = derive(password, record.salt);
  const passwordMatches = constantTimeEquals(derived, record.hash);
  const attemptAllowed = account === null
    ? true
    : usernameAttemptAllowed(throttles, account.username, now);

  if (!fieldsValid || account === null || !passwordMatches || !attemptAllowed) {
    if (account !== null) recordUsernameFailure(throttles, account.username, now);
    audit({
      actor: account?.username ?? 'unknown',
      action: 'login',
      outcome: 'failure',
      now,
      meta: {
        source,
        reason: account === null
          ? 'unknown_username'
          : !attemptAllowed ? 'throttled' : 'bad_password',
      },
    }, sinks);
    return redirect(LOGIN_FAILURE_LOCATION);
  }

  const role = identity.roles.get(account.username);
  if (!role) {
    // loadAdminIdentity cross-validates, so this is unreachable. It stays
    // because a login that proceeded without a role would be a session with
    // undefined authority.
    audit({ actor: account.username, action: 'login', outcome: 'failure', now, meta: { source, reason: 'no_role' } }, sinks);
    return redirect(LOGIN_FAILURE_LOCATION);
  }

  throttles.byUsername.delete(account.username);
  const payload = newSessionPayload({ sub: account.username, role, epoch, now });
  const token = await signAdminSession(payload, secret);
  audit({ actor: account.username, role, action: 'login', outcome: 'success', now, meta: { source } }, sinks);
  return redirect('/', serializeCookie(ADMIN_SESSION_COOKIE, token, sessionCookieOptions(payload, now)));
}
