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
//
// BATCH 3 §4.3 — that requirement arrived, and the intersection is what shipped.
// `admin_role_assignments` is now read on every request and can do exactly
// three things, none of which can WIDEN authority:
//   - narrow it, to the intersection of the environment role and the row's;
//   - deny outright, when the row is disabled;
//   - deny this cookie, when it was minted at or before the row's
//     `sessions_revoked_at` — the per-user revocation the W4-06 comment in
//     lib/adminSession.ts said needed a table.
// The decision itself is pure and lives in lib/adminAssignments.ts; the row is
// read through lib/adminIdentityStore.ts. An unreadable store DENIES.

import { cookies } from 'next/headers';
import { AdminForbiddenError, AdminUnauthenticatedError } from './errors';
import { type AdminAuditInput, type AdminAuditSink } from './adminAudit';
import { recordAdminActionDurably } from './adminAuditStore';
import { parseAdminRoles, type AdminPermission, type AdminRole } from './adminRoles';
import {
  resolveEffectiveAuthority,
  type AdminRoleAssignment,
} from './adminAssignments';
import { readRoleAssignment } from './adminIdentityStore';
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
  /**
   * Batch 3 §4.3. The narrowing row's role, or null when no row exists. It is
   * NOT the authority — `permissions` is — and Page 8 shows it so the
   * difference between the two roles is visible rather than inferred.
   */
  assignedRole: AdminRole | null;
  /**
   * What this request may actually do: the INTERSECTION of the environment
   * role's permissions and the assignment row's, or the environment role's
   * alone when no row exists. Every gate reads this and nothing else.
   */
  permissions: readonly AdminPermission[];
}

/**
 * The one store read this module performs, injectable because every other case
 * in adminAuthz.test.ts runs with no database at all.
 */
export interface AdminAuthzDeps {
  readAssignment?: (username: string) => Promise<AdminRoleAssignment | null>;
  /** Injected in tests; production uses lib/adminAuditStore.ts's defaults. */
  sinks?: readonly AdminAuditSink[];
}

/**
 * The session for the current request, or a throw. The middleware has already
 * verified the cookie; this verifies it AGAIN rather than trusting a forwarded
 * header, because a header is only as trustworthy as every path that can set
 * one.
 */
/**
 * Batch 3 §8.9. One durable, AWAITED record, with the sinks a test injected.
 *
 * It returns void rather than the durability, because every caller here is on
 * a DENIAL path: the request is being refused either way, and there is no
 * third result shape to report an audit failure through. The failure is on
 * stderr, which is the record of account.
 */
async function audit(deps: AdminAuthzDeps, input: AdminAuditInput): Promise<void> {
  if (deps.sinks) {
    await recordAdminActionDurably(input, deps.sinks);
    return;
  }
  await recordAdminActionDurably(input);
}

export async function currentAdminSession(
  env: AdminEnvironment = process.env,
  deps: AdminAuthzDeps = {},
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

  const environmentRole = roles.get(verified.payload.sub) ?? null;

  // Batch 3 §4.3 failure posture. FAIL CLOSED: if the narrowing store cannot
  // be read, the request is denied with its own audited reason. The cost is
  // stated rather than hidden — a database outage takes the panel down instead
  // of silently widening authority back to ADMIN_ROLES alone, which is the
  // right trade for a revocation check and the wrong one for availability.
  let assignment: AdminRoleAssignment | null;
  try {
    const read = deps.readAssignment ?? readRoleAssignment;
    assignment = await read(verified.payload.sub);
  } catch (error: unknown) {
    console.error('[admin] admin role assignment unreadable:', error);
    await audit(deps, {
      actor: verified.payload.sub,
      actorVerified: true,
      role: environmentRole,
      action: 'session.role_store_unavailable',
      outcome: 'denied',
      meta: { claimedRole: verified.payload.role, reason: 'role store unreadable' },
    });
    throw new AdminUnauthenticatedError('role_store_unavailable');
  }

  const authority = resolveEffectiveAuthority({
    environmentRole,
    assignment,
    sessionIssuedAtMs: verified.payload.iat,
  });

  if (!authority.ok) {
    // One record per reason, each distinguishable in the log: removed from the
    // environment allowlist, disabled by a row, or revoked per user.
    const action = authority.reason === 'no_environment_role'
      ? 'session.role_revoked'
      : authority.reason === 'assignment_disabled'
        ? 'session.account_disabled'
        : 'session.sessions_revoked';
    await audit(deps, {
      actor: verified.payload.sub,
      actorVerified: true,
      role: environmentRole,
      action,
      outcome: 'denied',
      meta: { claimedRole: verified.payload.role, reason: authority.reason },
    });
    // 'no_role' is kept verbatim for the first case: it is what W4-06 recorded
    // and what the middleware's own removal path already means.
    throw new AdminUnauthenticatedError(
      authority.reason === 'no_environment_role' ? 'no_role' : authority.reason,
    );
  }

  if (authority.role !== verified.payload.role) {
    await audit(deps, {
      actor: verified.payload.sub,
      actorVerified: true,
      role: authority.role,
      action: 'session.role_mismatch',
      outcome: 'success',
      meta: { claimedRole: verified.payload.role, effectiveRole: authority.role },
    });
  }

  return {
    username: verified.payload.sub,
    role: authority.role,
    claimedRole: verified.payload.role,
    assignedRole: authority.assignedRole,
    permissions: authority.permissions,
  };
}

/**
 * Throws AdminForbiddenError. Never returns false, and NO LONGER AUDITS.
 *
 * It tests the session's EFFECTIVE permission set, not `hasPermission(role)`.
 * Asking the role would read straight past the §4.3 intersection and hand a
 * narrowed account its environment role's full authority.
 *
 * Batch 3 §8.9c moved the denial record OUT of here. This function is
 * synchronous and it throws, so control never returns to the caller that could
 * await the record — making the audit `await`-able required it to live on the
 * async path. It is recorded exactly once, by requireAdminPermission below.
 */
export function requirePermission(
  session: Pick<AdminSessionContext, 'username' | 'role' | 'permissions'>,
  permission: AdminPermission,
): void {
  if ((session.permissions as readonly string[]).includes(permission)) return;
  throw new AdminForbiddenError(permission, session.role);
}

/**
 * The page/action entry point: authenticate, then authorize, then return who.
 *
 * Batch 3 §8.9c: the denial is PERSISTED BEFORE the caller sees the throw. A
 * denial that is recorded after the rejection propagates is a denial the
 * request can outrun.
 */
export async function requireAdminPermission(
  permission: AdminPermission,
  env: AdminEnvironment = process.env,
  deps: AdminAuthzDeps = {},
): Promise<AdminSessionContext> {
  const session = await currentAdminSession(env, deps);
  try {
    requirePermission(session, permission);
  } catch (error: unknown) {
    if (error instanceof AdminForbiddenError) {
      await audit(deps, {
        actor: session.username,
        actorVerified: true,
        role: session.role,
        action: 'authz.denied',
        outcome: 'denied',
        meta: { permission },
      });
    }
    throw error;
  }
  return session;
}
