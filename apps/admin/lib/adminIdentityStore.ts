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
  /** The acting admin, recorded once at insert and immutable thereafter. */
  assignedBy: string;
}

export type RoleAssignmentWriteEffect = 'created' | 'updated';

/**
 * Creates the row, or narrows the existing one. Returns which happened, so the
 * caller's audit entry says the true thing.
 *
 * This function owns `role` and `is_active` and NOTHING else. It deliberately
 * does not write `sessions_revoked_at`: a role change that carried the
 * revocation point forward from an earlier read would silently lose a
 * revocation committed in between. `revokeRoleAssignmentSessions` owns that
 * column, and the two never write the same column as each other.
 */
export async function writeRoleAssignment(
  input: RoleAssignmentWrite,
  deps?: AdminIdentityStoreDeps,
): Promise<RoleAssignmentWriteEffect> {
  const client = clientFor(deps);
  const nowIso = nowFor(deps).toISOString();
  const existing = await readRoleAssignment(input.username, deps);

  if (existing === null) {
    const { error } = await client.from('admin_role_assignments').insert({
      username: input.username,
      role: input.role,
      is_active: input.isActive,
      sessions_revoked_at: null,
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

  // Three of the four columns the grant permits. `sessions_revoked_at` is
  // deliberately absent -- see the note above the signature.
  const { error } = await client
    .from('admin_role_assignments')
    .update({
      role: input.role,
      is_active: input.isActive,
      updated_at: nowIso,
    })
    .eq('username', input.username);
  if (error) {
    console.error('[admin] admin_role_assignments update failed:', error.message);
    throw new AdminDataError('admin role assignment write failed');
  }
  return 'updated';
}

export interface SessionRevocationWrite {
  username: string;
  /** Epoch milliseconds. Every session issued at or before this is refused. */
  revokeAtMs: number;
  /**
   * The account's standing authority, used ONLY when there is no row to
   * update. It is never applied to an existing row.
   */
  standingRole: AdminRole;
  /** The acting admin, recorded once at insert and immutable thereafter. */
  assignedBy: string;
}

export type SessionRevocationEffect = 'created' | 'advanced' | 'already_later';

/**
 * Moves an account's revocation point forward.
 *
 * GATE 5 DELTA FINDING 1 -- the fix the first attempt got wrong.
 *
 * That attempt READ the row, then wrote `role` and `is_active` back from the
 * read. That is a lost update: a disable or a narrowing committed between the
 * read and the write is overwritten by stale values, so revoking sessions
 * could re-enable a disabled account or restore a role that had just been
 * narrowed. Preserving values read a moment ago is not the same as not
 * touching them.
 *
 * So this issues an UPDATE over exactly two columns -- the revocation point
 * and `updated_at` -- and NEVER names `role` or `is_active`. A concurrent
 * disable or narrowing cannot be lost, because nothing here can write it.
 *
 * Forward-only is enforced in the WHERE clause rather than from a read, for
 * the same reason: a point computed with Math.max over a stale read can move
 * BACKWARDS under concurrency and revive sessions an earlier revocation had
 * already killed. `sessions_revoked_at IS NULL OR < new` is evaluated by the
 * database against the committed row.
 *
 * Zero rows updated means the row does not exist, or it already carries a
 * revocation at or past this point. Those are distinguished by a read -- but
 * the read's answer is CHECKED rather than assumed:
 *
 * GATE 5 SECOND-DELTA FINDING 1. This previously returned `already_later` for
 * any row it found after a zero-row update. A concurrent FIRST INSERT lands a
 * row whose cutoff is null or earlier, so the function reported success, the
 * caller audited success, and every existing session stayed valid. A
 * revocation that reports success without revoking is the worst possible
 * outcome for this operation.
 *
 * So the loop below only returns a success effect when it has either moved the
 * cutoff itself, inserted the row itself, or READ a cutoff at or past the one
 * requested. Anything else is retried, and exhausting the attempts THROWS.
 * Failing closed is right here: the caller turns a throw into an audited
 * failure and an error message, which is a true statement, where
 * `already_later` would have been a false one.
 */
const REVOCATION_ATTEMPTS = 3;

export async function revokeRoleAssignmentSessions(
  input: SessionRevocationWrite,
  deps?: AdminIdentityStoreDeps,
): Promise<SessionRevocationEffect> {
  const client = clientFor(deps);
  const revokeAtIso = new Date(input.revokeAtMs).toISOString();

  for (let attempt = 0; attempt < REVOCATION_ATTEMPTS; attempt += 1) {
    const nowIso = nowFor(deps).toISOString();

    const { data, error } = await client
      .from('admin_role_assignments')
      .update({ sessions_revoked_at: revokeAtIso, updated_at: nowIso })
      .eq('username', input.username)
      // Quoted so the timestamp's punctuation cannot be read as filter syntax.
      .or('sessions_revoked_at.is.null,sessions_revoked_at.lt."' + revokeAtIso + '"')
      .select('username');
    if (error) {
      console.error('[admin] admin_role_assignments revoke failed:', error.message);
      throw new AdminDataError('admin role assignment write failed');
    }
    if ((data ?? []).length > 0) return 'advanced';

    const existing = await readRoleAssignment(input.username, deps);

    if (existing === null) {
      const { error: insertError } = await client.from('admin_role_assignments').insert({
        username: input.username,
        role: input.standingRole,
        is_active: true,
        sessions_revoked_at: revokeAtIso,
        assigned_by: input.assignedBy,
        assigned_at: nowIso,
        updated_at: nowIso,
      });
      if (insertError === null) return 'created';
      // A concurrent insert won the race. The row now exists, so the next
      // attempt's UPDATE is the right move -- not an error.
      console.error(
        '[admin] admin_role_assignments revoke insert retried:',
        insertError.message,
      );
      continue;
    }

    // The ONLY read that justifies reporting success without a write.
    if (
      existing.sessionsRevokedAtMs !== null
      && existing.sessionsRevokedAtMs >= input.revokeAtMs
    ) {
      return 'already_later';
    }

    // A row exists whose cutoff is null or earlier, yet the UPDATE matched
    // nothing. Retry: either a concurrent writer is mid-flight, or the filter
    // did not do what it claims -- and in both cases reporting success here
    // would be a lie.
  }

  console.error('[admin] admin_role_assignments revoke did not converge');
  throw new AdminDataError('admin role assignment write failed');
}
