import 'server-only';

// Batch 3 §4.3 / §8.12 — the ONLY module that reads or writes
// `admin_role_assignments`.
//
// It holds no authorization of its own. lib/adminIdentityActions.ts is the
// authorized surface: it calls requireAdminPermission('admins.write') first,
// applies §4.3's escalation guards, audits, and then calls down to here. The
// split is not cosmetic — lib/adminAuthz.ts must read an assignment on EVERY
// request, so a store that imported adminAuthz would close an import cycle.
//
// WHAT THE TABLE CANNOT DO, by privilege rather than by convention
// (20261023000000:164-172):
//   - no DELETE grant at all: an account is DISABLED, never deleted, so its
//     history survives;
//   - UPDATE is COLUMN-LEVEL on (role, is_active, sessions_revoked_at,
//     updated_at). `username`, `assigned_by` and `assigned_at` are the
//     attribution, and attribution the panel can rewrite is not attribution.
//
// So this module never issues an upsert. PostgREST's upsert is INSERT ... ON
// CONFLICT DO UPDATE over the SAME column list, which would attempt to set
// `assigned_by` on the conflict path and be refused by the grant above. It
// reads, then inserts or updates — which is also the only shape that can tell
// an audit entry whether an assignment was created or narrowed.
//
// A MALFORMED ROW IS A FAILURE, NOT A NULL. Returning null for a row whose
// `role` is unrecognised or whose `sessions_revoked_at` will not parse would
// read, upstream, as "this account has no narrowing row" — the exact opposite
// of what an unreadable revocation record means. Every rejection throws.

import { isAdminRole, type AdminRole } from './adminRoles';
import { type AdminRoleAssignment } from './adminAssignments';
import { AdminDataError } from './errors';
import { getSupabaseAdmin } from './supabaseAdmin';

/** The exact column list, in one place, so a read and a test cannot disagree. */
export const ADMIN_ROLE_ASSIGNMENT_COLUMNS =
  'username,role,is_active,sessions_revoked_at,assigned_by,assigned_at,updated_at';

/** The service-role surface this module needs. Injected whole in tests. */
export type AdminIdentityClient = Pick<ReturnType<typeof getSupabaseAdmin>, 'from'>;

export interface AdminIdentityStoreDeps {
  client?: AdminIdentityClient;
  now?: () => Date;
}

function clientFor(deps: AdminIdentityStoreDeps | undefined): AdminIdentityClient {
  return deps?.client ?? getSupabaseAdmin();
}

function nowFor(deps: AdminIdentityStoreDeps | undefined): Date {
  return deps?.now?.() ?? new Date();
}

function requiredText(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AdminDataError('admin_role_assignments.' + column + ' is not readable');
  }
  return value;
}

/** Epoch milliseconds for a nullable timestamptz, or a throw. */
function optionalInstant(
  row: Record<string, unknown>,
  column: string,
): { iso: string | null; ms: number | null } {
  const value = row[column];
  if (value === null || value === undefined) return { iso: null, ms: null };
  if (typeof value !== 'string') {
    throw new AdminDataError('admin_role_assignments.' + column + ' is not readable');
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new AdminDataError('admin_role_assignments.' + column + ' is not a timestamp');
  }
  return { iso: value, ms };
}

export function parseRoleAssignmentRow(row: Record<string, unknown>): AdminRoleAssignment {
  const role = row.role;
  if (!isAdminRole(role)) {
    // The CHECK constraint makes this unreachable through the database, which
    // is exactly why it must not be silently tolerated: reaching it means the
    // row did not come from that table.
    throw new AdminDataError('admin_role_assignments.role is not a known role');
  }
  if (typeof row.is_active !== 'boolean') {
    throw new AdminDataError('admin_role_assignments.is_active is not readable');
  }
  const revoked = optionalInstant(row, 'sessions_revoked_at');

  return {
    username: requiredText(row, 'username'),
    role,
    isActive: row.is_active,
    sessionsRevokedAtMs: revoked.ms,
    sessionsRevokedAt: revoked.iso,
    assignedBy: requiredText(row, 'assigned_by'),
    assignedAt: requiredText(row, 'assigned_at'),
    updatedAt: requiredText(row, 'updated_at'),
  };
}

/**
 * The narrowing row for one username, or null when none exists.
 *
 * `username` is a primary key and an exact match, so this is not a search and
 * no pattern metacharacter is in play. It is still passed as a bound value.
 */
export async function readRoleAssignment(
  username: string,
  deps?: AdminIdentityStoreDeps,
): Promise<AdminRoleAssignment | null> {
  if (username.length === 0) {
    throw new AdminDataError('admin role assignment lookup needs a username');
  }

  const { data, error } = await clientFor(deps)
    .from('admin_role_assignments')
    .select(ADMIN_ROLE_ASSIGNMENT_COLUMNS)
    .eq('username', username)
    .limit(1);

  if (error) {
    console.error('[admin] admin_role_assignments read failed:', error.message);
    throw new AdminDataError('admin role assignment read failed');
  }

  const rows = data ?? [];
  if (rows.length === 0) return null;
  return parseRoleAssignmentRow(rows[0] as Record<string, unknown>);
}

/**
 * Every assignment, for Page 8's directory. Bounded: the table holds one row
 * per admin account, and ADMIN_ROLES is a hand-maintained allowlist.
 */
export async function listRoleAssignments(
  deps?: AdminIdentityStoreDeps,
): Promise<AdminRoleAssignment[]> {
  const { data, error } = await clientFor(deps)
    .from('admin_role_assignments')
    .select(ADMIN_ROLE_ASSIGNMENT_COLUMNS)
    .order('username', { ascending: true })
    .range(0, 499);

  if (error) {
    console.error('[admin] admin_role_assignments list failed:', error.message);
    throw new AdminDataError('admin role assignment list failed');
  }
  return (data ?? []).map((row) => parseRoleAssignmentRow(row as Record<string, unknown>));
}

export interface RoleAssignmentWrite {
  username: string;
  role: AdminRole;
  isActive: boolean;
  /** Epoch milliseconds, or null to leave the existing revocation point alone. */
  revokeSessionsAtMs: number | null;
  /** The acting admin, recorded once at insert and immutable thereafter. */
  assignedBy: string;
}

export type RoleAssignmentWriteEffect = 'created' | 'updated';

/**
 * Creates the row, or narrows the existing one. Returns which happened, so the
 * caller's audit entry says the true thing.
 *
 * `revokeSessionsAtMs` is forward-only: a value lower than the row already
 * carries is ignored rather than applied, because moving a revocation point
 * BACKWARDS would revive sessions an earlier revocation had already killed.
 */
export async function writeRoleAssignment(
  input: RoleAssignmentWrite,
  deps?: AdminIdentityStoreDeps,
): Promise<RoleAssignmentWriteEffect> {
  const client = clientFor(deps);
  const nowIso = nowFor(deps).toISOString();
  const existing = await readRoleAssignment(input.username, deps);

  const existingRevokedMs = existing?.sessionsRevokedAtMs ?? null;
  const revokedAtMs = input.revokeSessionsAtMs === null
    ? existingRevokedMs
    : existingRevokedMs === null
      ? input.revokeSessionsAtMs
      : Math.max(existingRevokedMs, input.revokeSessionsAtMs);
  const revokedAtIso = revokedAtMs === null ? null : new Date(revokedAtMs).toISOString();

  if (existing === null) {
    const { error } = await client.from('admin_role_assignments').insert({
      username: input.username,
      role: input.role,
      is_active: input.isActive,
      sessions_revoked_at: revokedAtIso,
      assigned_by: input.assignedBy,
      assigned_at: nowIso,
      updated_at: nowIso,
    });
    if (error) {
      console.error('[admin] admin_role_assignments insert failed:', error.message);
      throw new AdminDataError('admin role assignment write failed');
    }
    return 'created';
  }

  // Exactly the four columns the grant permits, and no others.
  const { error } = await client
    .from('admin_role_assignments')
    .update({
      role: input.role,
      is_active: input.isActive,
      sessions_revoked_at: revokedAtIso,
      updated_at: nowIso,
    })
    .eq('username', input.username);
  if (error) {
    console.error('[admin] admin_role_assignments update failed:', error.message);
    throw new AdminDataError('admin role assignment write failed');
  }
  return 'updated';
}
