// Batch 3 §4.3 — what an `admin_role_assignments` row is allowed to do, as a
// pure function of the row, the environment role and the cookie's issue time.
//
// FRAMEWORK-FREE AND DATABASE-FREE ON PURPOSE. lib/adminIdentityStore.ts reads
// and writes the table; this file decides what a row MEANS, so every rule below
// is a unit test with no Supabase client and no Next request scope. It is also
// what breaks the import cycle: lib/adminAuthz.ts needs the meaning on every
// request, and the store needs it too.
//
// THE THREE RULES, in the order they are applied:
//   1. no entry in ADMIN_ROLES   -> denied. Unchanged from W4-06: the
//      environment is the bootstrap allowlist and a row here cannot create
//      authority out of nothing.
//   2. an is_active = false row  -> DENIED OUTRIGHT. It never falls back to
//      ADMIN_ROLES, because a disable that a missing row silently undoes is not
//      a disable.
//   3. iat at or before sessions_revoked_at -> denied, per user. The
//      ADMIN_SESSION_EPOCH break-glass stays as the all-or-nothing control.
//
// And then the one that matters most: permissions are the INTERSECTION, so a
// write to this table can only ever NARROW authority. A row naming
// super_admin against an environment role of read_only grants read_only's set
// and nothing more.

import {
  intersectPermissions,
  permissionsForRole,
  type AdminPermission,
  type AdminRole,
} from './adminRoles';

/**
 * One parsed `admin_role_assignments` row. Timestamps arrive already parsed, so
 * this module never has to decide what a malformed date means — the store does,
 * by refusing the row.
 */
export interface AdminRoleAssignment {
  username: string;
  role: AdminRole;
  isActive: boolean;
  /** Epoch milliseconds, or null when this account has never been revoked. */
  sessionsRevokedAtMs: number | null;
  /** The raw timestamp, kept for display only. */
  sessionsRevokedAt: string | null;
  assignedBy: string;
  assignedAt: string;
  updatedAt: string;
}

export type AuthorityDenialReason =
  | 'no_environment_role'
  | 'assignment_disabled'
  | 'sessions_revoked';

export type EffectiveAuthority =
  | {
      ok: true;
      /** The ADMIN_ROLES role. Still the role the audit log records. */
      role: AdminRole;
      /** The narrowing row's role, or null when no row exists. */
      assignedRole: AdminRole | null;
      /** What this request may actually do: the intersection. */
      permissions: readonly AdminPermission[];
    }
  | { ok: false; reason: AuthorityDenialReason };

export function resolveEffectiveAuthority(input: {
  environmentRole: AdminRole | null;
  assignment: AdminRoleAssignment | null;
  /** The session cookie's `iat`, in epoch milliseconds. */
  sessionIssuedAtMs: number;
}): EffectiveAuthority {
  if (input.environmentRole === null) {
    return { ok: false, reason: 'no_environment_role' };
  }

  const environmentPermissions = permissionsForRole(input.environmentRole);
  const assignment = input.assignment;
  if (assignment === null) {
    return {
      ok: true,
      role: input.environmentRole,
      assignedRole: null,
      permissions: environmentPermissions,
    };
  }

  if (!assignment.isActive) {
    return { ok: false, reason: 'assignment_disabled' };
  }

  // At or before: revoking at T must invalidate a cookie minted at exactly T,
  // or a session issued in the same millisecond as the revocation outlives it.
  if (
    assignment.sessionsRevokedAtMs !== null
    && input.sessionIssuedAtMs <= assignment.sessionsRevokedAtMs
  ) {
    return { ok: false, reason: 'sessions_revoked' };
  }

  return {
    ok: true,
    role: input.environmentRole,
    assignedRole: assignment.role,
    permissions: intersectPermissions(
      environmentPermissions,
      permissionsForRole(assignment.role),
    ),
  };
}

/**
 * The result shape every Batch 3 admin write returns.
 *
 * Lives here, in the framework-free module, so lib/adminActions.ts,
 * lib/adminIdentityStore.ts and the support and settings writers share ONE
 * definition rather than three structurally-equal unions.
 */
export type AdminWriteResult =
  | { ok: true; message: string }
  | { ok: false; message: string };
