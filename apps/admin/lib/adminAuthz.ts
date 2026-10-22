import 'server-only';

// W4-06 — the one authorization choke point.
//
// Every page and every server action calls requirePermission as its FIRST
// statement. Enforcement is server-side in all cases: a Server Component that
// throws renders the 403 notice, and a Server Action that throws never reaches
// a query. No permission is checked in the browser, and no page's visibility is
// the gate.
//
// ADMIN_ROLES is authoritative. currentAdminSession re-resolves the role from
// the environment on every call, so a demotion lands on the next request and
// the cookie's signed role claim grants nothing — it is only compared, and a
// mismatch is audited.
//
// Revision 3 said a mismatch should resolve to "the lower-privilege of the
// two". That was wrong: billing holds subscriptions.write and support does not,
// support holds support.write and billing does not, so the roles are not
// totally ordered and any ranking preserves authority the other role never had.
// If a future requirement really needs both consulted, the correct operation is
// the INTERSECTION of their permission sets, never a rank comparison.

import { cookies } from 'next/headers';
import { AdminForbiddenError, AdminUnauthenticatedError } from './errors';
import { recordAdminAction } from './adminAudit';
import { hasPermission, parseAdminRoles, type AdminPermission, type AdminRole } from './adminRoles';
import {
  ADMIN_SESSION_COOKIE,
  type SessionEnvironment,
  readSessionEpoch,
  readSessionSecret,
  verifyAdminSession,
} from './adminSession';

/** Any env-shaped bag: process.env in production, a literal in tests. */
export type AdminEnvironment = SessionEnvironment;

export interface AdminSessionContext {
  username: string;
  /** Resolved from ADMIN_ROLES at this request, not from the cookie. */
  role: AdminRole;
  /** What the cookie claimed, kept only so a mismatch can be audited. */
  claimedRole: AdminRole;
}

/**
 * The session for the current request, or a throw. The middleware has already
 * verified the cookie; this verifies it AGAIN rather than trusting a forwarded
 * header, because a header is only as trustworthy as every path that can set
 * one.
 */
export async function currentAdminSession(
  env: AdminEnvironment = process.env,
): Promise<AdminSessionContext> {
  const secret = readSessionSecret(env);
  const epoch = readSessionEpoch(env);
  const roles = parseAdminRoles(env.ADMIN_ROLES);

  const store = await cookies();
  const verified = await verifyAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value, {
    secret,
    epoch,
    now: Date.now(),
  });
  if (!verified.ok) {
    throw new AdminUnauthenticatedError(verified.reason);
  }

  const role = roles.get(verified.payload.sub);
  if (!role) {
    // Removed from ADMIN_ROLES while holding a valid cookie: the cookie stops
    // conferring anything, immediately.
    recordAdminAction({
      actor: verified.payload.sub,
      role: null,
      action: 'session.role_revoked',
      outcome: 'denied',
      meta: { claimedRole: verified.payload.role, reason: 'no ADMIN_ROLES entry' },
    });
    throw new AdminUnauthenticatedError('no_role');
  }

  if (role !== verified.payload.role) {
    recordAdminAction({
      actor: verified.payload.sub,
      role,
      action: 'session.role_mismatch',
      outcome: 'success',
      meta: { claimedRole: verified.payload.role, effectiveRole: role },
    });
  }

  return { username: verified.payload.sub, role, claimedRole: verified.payload.role };
}

/** Throws AdminForbiddenError and AUDITS the denial. Never returns false. */
export function requirePermission(
  session: Pick<AdminSessionContext, 'username' | 'role'>,
  permission: AdminPermission,
): void {
  if (hasPermission(session.role, permission)) return;

  recordAdminAction({
    actor: session.username,
    role: session.role,
    action: 'authz.denied',
    outcome: 'denied',
    meta: { permission },
  });
  throw new AdminForbiddenError(permission, session.role);
}

/** The page/action entry point: authenticate, then authorize, then return who. */
export async function requireAdminPermission(
  permission: AdminPermission,
  env: AdminEnvironment = process.env,
): Promise<AdminSessionContext> {
  const session = await currentAdminSession(env);
  requirePermission(session, permission);
  return session;
}
