import 'server-only';

// Batch 3 §4.3 — Page 8's authorized writes: narrow a role, disable an
// account, revoke one account's sessions.
//
// WHAT THE PANEL CANNOT DO, and says so rather than pretending: it cannot
// CREATE an admin account. A new account needs a PBKDF2 salt and hash in
// ADMIN_ACCOUNTS and a role in ADMIN_ROLES, both environment variables, so
// provisioning completes outside the panel by design
// (scripts/admin-hash-password.mjs). Nothing here reads, writes, logs or
// accepts a password, and no plaintext password exists on this path at all.
//
// THE ESCALATION GUARDS, each with a negative test:
//   1. requireAdminPermission('admins.write') runs FIRST, so only super_admin
//      reaches any of this — and only with an EFFECTIVE admins.write, so a
//      narrowed super_admin cannot use it either;
//   2. an admin may not change their OWN role and may not revoke their OWN
//      sessions. Self-service de-escalation looks harmless and is the standard
//      way an attacker holding one session keeps it while locking everyone
//      else out;
//   3. the target must already exist in ADMIN_ROLES. A row for a username the
//      environment does not know is dead weight that silently becomes
//      authority the day someone adds that name;
//   4. the role must be one of the four — enforced by the shared schema, by
//      ADMIN_ROLE_NAMES, and by the table's own CHECK constraint;
//   5. a row naming a WIDER role than the environment's grants nothing extra.
//      That is not a check here; it is the §4.3 intersection in
//      lib/adminAssignments.ts, which is why this module does not try to
//      second-guess the role being written.
//
// Every attempt is audited, on success AND on failure.
//
// NO DIRECT TABLE WRITE HAPPENS IN THIS FILE, deliberately: §8.12's write
// manifest names lib/adminIdentityStore.ts as the only module permitted to
// write `admin_role_assignments`, and this one calls down to it.

import {
  adminRoleAssignmentUpdateSchema,
  adminSessionRevocationSchema,
} from '@muthoy/validation';
import { type AdminAuditSink } from './adminAudit';
import { recordAdminActionDurably, type AdminAuditDurability } from './adminAuditStore';
import { resultForDurability, type AdminWriteResult } from './adminAssignments';
import { requireAdminPermission, type AdminAuthzDeps, type AdminEnvironment } from './adminAuthz';
import { parseAdminRoles } from './adminRoles';
import {
  readRoleAssignment,
  writeRoleAssignment,
  type AdminIdentityStoreDeps,
} from './adminIdentityStore';

export interface AdminIdentityActionDeps extends AdminIdentityStoreDeps, AdminAuthzDeps {
  env?: AdminEnvironment;
  sinks?: readonly AdminAuditSink[];
}

/**
 * Batch 3 §8.9. ASYNC and AWAITED on every return path, success and failure.
 *
 * `actorVerified` is TRUE for every call here: requireAdminPermission ran
 * first, so the actor came from a verified session cookie. `targetUsername`,
 * `fromRole` and `toRole` are the §8.9 allowlist keys that make a role change
 * readable; each is dropped by lib/adminAudit.ts unless it matches its own
 * value space, so a malformed one is absent rather than half-recorded.
 */
async function audit(
  input: {
    actor: string;
    role: string | null;
    action: string;
    target: string;
    outcome: 'success' | 'failure' | 'denied';
    reason?: string;
    targetUsername?: string;
    fromRole?: string;
    toRole?: string;
  },
  sinks: readonly AdminAuditSink[] | undefined,
): Promise<AdminAuditDurability> {
  const entry = {
    actor: input.actor,
    actorVerified: true,
    role: input.role,
    action: input.action,
    target: input.target,
    outcome: input.outcome,
    meta: {
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.targetUsername === undefined ? {} : { targetUsername: input.targetUsername }),
      ...(input.fromRole === undefined ? {} : { fromRole: input.fromRole }),
      ...(input.toRole === undefined ? {} : { toRole: input.toRole }),
    },
  };
  const result = sinks
    ? await recordAdminActionDurably(entry, sinks)
    : await recordAdminActionDurably(entry);
  return result.durability;
}

/** Whether ADMIN_ROLES knows this username at all. */
function environmentRoleFor(env: AdminEnvironment, username: string): string | undefined {
  return parseAdminRoles(env.ADMIN_ROLES).get(username);
}

function storeDeps(deps: AdminIdentityActionDeps | undefined): AdminIdentityStoreDeps {
  return { client: deps?.client, now: deps?.now };
}

/**
 * Narrows `username` to `role` and sets whether the account is enabled.
 *
 * Disabling is the panel's delete: §3.4 grants no DELETE on the table at all,
 * so the row and its history survive a disable.
 */
export async function assignAdminRole(
  payload: unknown,
  deps?: AdminIdentityActionDeps,
): Promise<AdminWriteResult> {
  const env = deps?.env ?? process.env;
  const session = await requireAdminPermission('admins.write', env, {
    readAssignment: deps?.readAssignment,
  });

  const parsed = adminRoleAssignmentUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'admins.assign_role',
        target: 'invalid',
        outcome: 'failure',
        reason: 'invalid payload',
      },
      deps?.sinks,
    );
    return { ok: false, message: 'That role change is not a valid request.' };
  }
  const { username, role, isActive } = parsed.data;

  if (username === session.username) {
    await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'admins.assign_role',
        target: username,
        outcome: 'denied',
        reason: 'self role change',
      },
      deps?.sinks,
    );
    return { ok: false, message: 'You cannot change your own role.' };
  }

  if (environmentRoleFor(env, username) === undefined) {
    await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'admins.assign_role',
        target: username,
        outcome: 'denied',
        reason: 'no ADMIN_ROLES entry',
      },
      deps?.sinks,
    );
    return { ok: false, message: 'That admin username is not in ADMIN_ROLES.' };
  }

  try {
    const existingRole = (await readRoleAssignment(username, storeDeps(deps)))?.role;
    const effect = await writeRoleAssignment(
      { username, role, isActive, revokeSessionsAtMs: null, assignedBy: session.username },
      storeDeps(deps),
    );
    const durability = await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'admins.assign_role',
        target: username,
        outcome: 'success',
        reason: effect + (isActive ? ' enabled' : ' disabled'),
        targetUsername: username,
        // Absent on a create, because there was no previous role to name.
        ...(existingRole === undefined ? {} : { fromRole: existingRole }),
        toRole: role,
      },
      deps?.sinks,
    );
    // §8.9d. The row is already written, so a failed audit reports
    // applied-but-unrecorded rather than a failure that invites a retry.
    return resultForDurability(
      durability,
      isActive
        ? 'Saved. ' + username + ' now holds at most the ' + role + ' permissions.'
        : 'Saved. ' + username + ' is disabled and is denied on the next request.',
    );
  } catch (error: unknown) {
    console.error('[admin] assignAdminRole failed:', error);
    await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'admins.assign_role',
        target: username,
        outcome: 'failure',
        reason: 'store write failed',
      },
      deps?.sinks,
    );
    return { ok: false, message: 'That role change could not be saved.' };
  }
}

/**
 * Revokes every live session of one account.
 *
 * It needs a row, which is why it writes `role` too: a username that has never
 * been narrowed has no row, and revocation has to be able to reach it. The role
 * written is the ENVIRONMENT's own, so the intersection is unchanged and a
 * revocation narrows nothing it did not mean to.
 */
export async function revokeAdminSessions(
  payload: unknown,
  deps?: AdminIdentityActionDeps,
): Promise<AdminWriteResult> {
  const env = deps?.env ?? process.env;
  const session = await requireAdminPermission('admins.write', env, {
    readAssignment: deps?.readAssignment,
  });

  const parsed = adminSessionRevocationSchema.safeParse(payload);
  if (!parsed.success) {
    await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'admins.revoke_sessions',
        target: 'invalid',
        outcome: 'failure',
        reason: 'invalid payload',
      },
      deps?.sinks,
    );
    return { ok: false, message: 'That revocation is not a valid request.' };
  }
  const username = parsed.data.username;

  if (username === session.username) {
    await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'admins.revoke_sessions',
        target: username,
        outcome: 'denied',
        reason: 'self revocation',
      },
      deps?.sinks,
    );
    return { ok: false, message: 'You cannot revoke your own sessions. Sign out instead.' };
  }

  const environmentRole = environmentRoleFor(env, username);
  if (environmentRole === undefined) {
    await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'admins.revoke_sessions',
        target: username,
        outcome: 'denied',
        reason: 'no ADMIN_ROLES entry',
      },
      deps?.sinks,
    );
    return { ok: false, message: 'That admin username is not in ADMIN_ROLES.' };
  }

  try {
    const revokeAt = (deps?.now?.() ?? new Date()).getTime();
    await writeRoleAssignment(
      {
        username,
        // Already proven to be one of the four by parseAdminRoles.
        role: environmentRole as Parameters<typeof writeRoleAssignment>[0]['role'],
        isActive: true,
        revokeSessionsAtMs: revokeAt,
        assignedBy: session.username,
      },
      storeDeps(deps),
    );
    const durability = await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'admins.revoke_sessions',
        target: username,
        outcome: 'success',
        targetUsername: username,
      },
      deps?.sinks,
    );
    return resultForDurability(
      durability,
      'Revoked. Every session ' + username + ' holds is refused from now on.',
    );
  } catch (error: unknown) {
    console.error('[admin] revokeAdminSessions failed:', error);
    await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'admins.revoke_sessions',
        target: username,
        outcome: 'failure',
        reason: 'store write failed',
      },
      deps?.sinks,
    );
    return { ok: false, message: 'Those sessions could not be revoked.' };
  }
}
