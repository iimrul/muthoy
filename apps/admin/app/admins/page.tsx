import DataTable, { type DataColumn } from '../../components/DataTable';
import ErrorNotice from '../../components/ErrorNotice';
import { EmptyState } from '../../components/PageParts';
import { recentAdminAudit, type AdminAuditEntry } from '../../lib/adminAudit';
import { filterAuditEntries, formatAuditMeta } from '../../lib/adminAuditViews';
import {
  resolveEffectiveAuthority,
  type AdminRoleAssignment,
  type EffectiveAuthority,
} from '../../lib/adminAssignments';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { ACCOUNTS_ENV_NAMES } from '../../lib/adminIdentity';
import { listRoleAssignments } from '../../lib/adminIdentityStore';
import { outcomeNote } from '../../lib/adminOutcomes';
import { ADMIN_ROLE_NAMES, parseAdminRoles, permissionMatrix } from '../../lib/adminRoles';
import { formatDhakaDateTime } from '../../lib/adminViews';
import { toDisplayMessage } from '../../lib/errors';
import { assignAdminRoleAction, revokeAdminSessionsAction } from '../adminFormActions';

// Batch 3 §8.8 — Admin Users & Roles.
//
// THE MATRIX IS RENDERED FROM `ROLE_PERMISSIONS` ITSELF, so it cannot drift
// from the thing that decides. A hand-written table of the same information
// would be a second source of truth, and the one a reader trusts is whichever
// is on screen.
//
// THE EFFECTIVE SET IS THE INTERSECTION, and it is shown. §4.3: an assignment
// row can narrow a role or deny it outright; it can never widen one. A row
// naming super_admin against an environment role of read_only grants read_only
// and no more, so this page shows all three columns — environment role,
// assignment role, effective permissions — and the narrowing is legible rather
// than inferred.
//
// WHAT THE PANEL CANNOT DO, and says so. It cannot CREATE an admin account: a
// new account needs a PBKDF2 salt and hash in ADMIN_ACCOUNTS and a role in
// ADMIN_ROLES, both environment variables, so provisioning completes outside
// the panel by design. Nothing on this page reads, writes, logs or accepts a
// password.

export const dynamic = 'force-dynamic';

/**
 * §8.8's three families: role management, logins and session events.
 *
 * GATE 5 FINDING 15: this history was specified and absent. Matched by PREFIX
 * against the recorded action name, so a new `admins.*` or `session.*` action
 * appears the day it is added rather than the day somebody remembers to list
 * it here. `login` is dotless and is matched whole.
 */
const SECURITY_ACTION_PREFIXES = ['admins.', 'login', 'session.'] as const;

const SECURITY_COLUMNS: readonly DataColumn<AdminAuditEntry>[] = [
  { heading: 'When', cell: (entry) => formatDhakaDateTime(entry.at) },
  { heading: 'Actor', cell: (entry) => entry.actor },
  {
    heading: 'Actor verified',
    cell: (entry) => (entry.actorVerified ? 'verified session' : 'claimed, unverified'),
  },
  { heading: 'Role', cell: (entry) => entry.role ?? '—' },
  { heading: 'Action', cell: (entry) => entry.action },
  { heading: 'Target', cell: (entry) => entry.target ?? '—' },
  { heading: 'Outcome', cell: (entry) => entry.outcome },
  { heading: 'Detail', cell: (entry) => formatAuditMeta(entry) },
];

type AdminsResult =
  | { ok: true; assignments: readonly AdminRoleAssignment[]; nowMs: number }
  | { ok: false; message: string };

/**
 * The rows, and the instant they were read at.
 *
 * The clock is read HERE rather than in the render body. React's purity rule is
 * right to refuse `Date.now()` during render — a component that reads the clock
 * produces a different answer every time it happens to re-render — and reading
 * it beside the query is also more honest: the authority column describes the
 * moment the rows were fetched.
 */
async function loadAssignments(): Promise<AdminsResult> {
  try {
    return { ok: true, assignments: await listRoleAssignments(), nowMs: Date.now() };
  } catch (error: unknown) {
    console.error('[admin] the admin directory failed to load:', error);
    return { ok: false, message: toDisplayMessage(error) };
  }
}

/**
 * The effective-permissions cell.
 *
 * A denial is rendered with ITS REASON rather than as an empty list. "Disabled"
 * and "no ADMIN_ROLES entry" are different problems with different fixes, and a
 * blank cell would send an operator looking for the wrong one.
 */
function describeAuthority(authority: EffectiveAuthority) {
  if (!authority.ok) {
    const reason =
      authority.reason === 'assignment_disabled'
        ? 'denied — the account is disabled'
        : authority.reason === 'sessions_revoked'
          ? 'denied — sessions revoked'
          : 'denied — no ADMIN_ROLES entry';
    return <span className="text-midGray">{reason}</span>;
  }
  if (authority.permissions.length === 0) {
    return <span className="text-midGray">none — every request is denied</span>;
  }
  return <span className="text-xs">{authority.permissions.join(', ')}</span>;
}

interface AdminsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminsPage({ searchParams }: AdminsPageProps) {
  let actor = '';
  let canWrite = false;
  try {
    const session = await requireAdminPermission('admins.read');
    actor = session.username;
    canWrite = session.permissions.includes('admins.write');
  } catch (error: unknown) {
    console.error('[admin] admin directory denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  const notice = outcomeNote(await searchParams, {
    assign_role: 'Saved. The new limit applies on that account’s next request.',
    revoke_sessions: 'Saved. Every session that account held is refused from now on.',
  });

  const result = await loadAssignments();
  if (!result.ok) return <ErrorNotice message={result.message} />;

  // The environment allowlist is the set of accounts that EXIST. An assignment
  // row for a name the environment does not know is dead weight that becomes
  // authority the day somebody adds that name, so the directory is keyed on the
  // environment and the rows are joined onto it.
  const environmentRoles = parseAdminRoles(process.env.ADMIN_ROLES);
  const byUsername = new Map(result.assignments.map((row) => [row.username, row]));
  const matrix = permissionMatrix();

  // §8.8's security history. The filter lives in lib/adminAuditViews.ts, so
  // this page and the Audit page cannot disagree about what an entry is.
  const securityHistory = SECURITY_ACTION_PREFIXES.flatMap((prefix) =>
    filterAuditEntries(recentAdminAudit.entries(), { action: prefix }),
  ).filter(
    // One entry can match only one prefix, but a de-duplication costs nothing
    // and makes the flatMap safe if a prefix is ever widened.
    (entry, index, all) =>
      all.findIndex(
        (other) =>
          other.at === entry.at && other.actor === entry.actor && other.action === entry.action,
      ) === index,
  );

  // `sessionIssuedAtMs` is the instant the rows were read, deliberately: the
  // question this column answers is what a session minted now would be allowed
  // to do. Using some other account's old cookie time would be meaningless
  // here, and it would also conflate two different facts — a revoked account
  // can still sign in again, which is why revocation has its own column rather
  // than being folded into this one.
  const nowMs = result.nowMs;

  const directory = [...environmentRoles.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([username, environmentRole]) => {
      const assignment = byUsername.get(username) ?? null;
      return {
        username,
        environmentRole,
        assignment,
        authority: resolveEffectiveAuthority({
          environmentRole,
          assignment,
          sessionIssuedAtMs: nowMs,
        }),
      };
    });

  return (
    <>
      <h1 className="text-xl font-semibold">Admins &amp; roles</h1>
      <p className="mt-1 text-sm text-midGray">
        {directory.length} {directory.length === 1 ? 'account' : 'accounts'} in ADMIN_ROLES. An
        assignment row can narrow a role or disable an account; it can never widen one.
      </p>

      {notice === null ? null : (
        <p
          role="status"
          className="mt-4 rounded border border-black/10 bg-offWhite p-3 text-sm text-richBlack"
        >
          {notice}
        </p>
      )}

      {directory.length === 0 ? (
        <EmptyState message="ADMIN_ROLES names no account, so this panel has no admin users. Accounts are provisioned in the server environment, not here." />
      ) : (
        <table className="mt-4 w-full text-sm">
          <caption className="sr-only">
            Admin accounts, their environment role, any narrowing row, and the effective
            permissions.
          </caption>
          <thead>
            <tr className="border-b border-black/10 text-left">
              <th scope="col" className="py-1 font-medium">
                Username
              </th>
              <th scope="col" className="py-1 font-medium">
                Environment role
              </th>
              <th scope="col" className="py-1 font-medium">
                Assignment
              </th>
              <th scope="col" className="py-1 font-medium">
                Effective permissions
              </th>
              <th scope="col" className="py-1 font-medium">
                Sessions revoked
              </th>
            </tr>
          </thead>
          <tbody>
            {directory.map((entry) => (
              <tr key={entry.username} className="border-b border-black/5 align-top">
                <th scope="row" className="py-2 text-left font-normal">
                  {entry.username}
                  {entry.username === actor ? (
                    <span className="ml-1 text-xs text-midGray">(you)</span>
                  ) : null}
                </th>
                <td className="py-2">{entry.environmentRole}</td>
                <td className="py-2">
                  {entry.assignment === null ? (
                    <span className="text-midGray">none — the environment role applies</span>
                  ) : (
                    <>
                      {entry.assignment.role}
                      {entry.assignment.isActive ? '' : ' · DISABLED'}
                    </>
                  )}
                </td>
                <td className="py-2">{describeAuthority(entry.authority)}</td>
                <td className="py-2">
                  {entry.assignment === null || entry.assignment.sessionsRevokedAt === null
                    ? '—'
                    : formatDhakaDateTime(entry.assignment.sessionsRevokedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canWrite ? (
        <section
          aria-labelledby="narrow-role"
          className="mt-8 rounded border border-black/10 bg-white p-4"
        >
          <h2 id="narrow-role" className="text-base font-semibold">
            Narrow a role, or disable an account
          </h2>
          <p className="mt-1 text-sm text-midGray">
            The result is the INTERSECTION of the environment role and the role chosen here, so
            naming a wider role grants nothing extra. You cannot change your own role.
          </p>
          <form action={assignAdminRoleAction} className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-midGray">Username</span>
              <select name="username" className="rounded border border-black/15 px-2 py-1">
                {directory
                  // The actor's own name is absent from the control as well as
                  // refused by the action: offering it would be offering a
                  // button whose only outcome is a denial.
                  .filter((entry) => entry.username !== actor)
                  .map((entry) => (
                    <option key={entry.username} value={entry.username}>
                      {entry.username}
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-midGray">Role</span>
              <select
                name="role"
                defaultValue="read_only"
                className="rounded border border-black/15 px-2 py-1"
              >
                {ADMIN_ROLE_NAMES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-midGray">Enabled</span>
              <select
                name="isActive"
                defaultValue="true"
                className="rounded border border-black/15 px-2 py-1"
              >
                <option value="true">enabled</option>
                <option value="false">disabled</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded bg-brand-deepGreen px-3 py-1.5 text-sm font-medium text-white"
            >
              Save
            </button>
          </form>
          <p className="mt-2 text-xs text-midGray">
            Disabling is this panel&rsquo;s delete: the table grants no DELETE at all, so the row and
            its history survive.
          </p>

          <h3 className="mt-6 text-sm font-semibold">Revoke one account&rsquo;s sessions</h3>
          <p className="mt-1 text-xs text-midGray">
            Forward-only: it cannot revive sessions an earlier revocation already killed. You cannot
            revoke your own.
          </p>
          <form action={revokeAdminSessionsAction} className="mt-2 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-midGray">Username</span>
              <select name="username" className="rounded border border-black/15 px-2 py-1">
                {directory
                  .filter((entry) => entry.username !== actor)
                  .map((entry) => (
                    <option key={entry.username} value={entry.username}>
                      {entry.username}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded border border-brand-deepGreen px-3 py-1.5 text-sm font-medium text-brand-deepGreen hover:bg-brand-softGreen"
            >
              Revoke sessions
            </button>
          </form>
        </section>
      ) : (
        <p className="mt-6 text-sm text-midGray">Read-only: this role does not hold admins.write.</p>
      )}

      <section aria-labelledby="matrix" className="mt-8">
        <h2 id="matrix" className="text-base font-semibold">
          The role matrix
        </h2>
        <p className="mt-1 text-sm text-midGray">
          Rendered from ROLE_PERMISSIONS itself, so it cannot drift from the code that decides.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Which permission each of the four roles holds.</caption>
            <thead>
              <tr className="border-b border-black/10 text-left">
                <th scope="col" className="py-1 font-medium">
                  Permission
                </th>
                {ADMIN_ROLE_NAMES.map((role) => (
                  <th key={role} scope="col" className="py-1 font-medium">
                    {role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.permission} className="border-b border-black/5">
                  <th scope="row" className="py-1 text-left font-normal">
                    {row.permission}
                  </th>
                  {/* The row's own cells, in the order the matrix produced
                      them — not re-derived by looking each role up again. */}
                  {row.roles.map((cell) => (
                    <td key={cell.role} className="py-1">
                      {cell.granted ? (
                        <span aria-label="held">yes</span>
                      ) : (
                        <span aria-label="not held" className="text-black/30">
                          —
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* §8.8's SECURITY AUDIT HISTORY (Gate 5 finding 15), filtered to the
          three families this page is responsible for. It reuses
          lib/adminAuditViews.ts rather than re-implementing a filter, so the
          Audit page and this one cannot disagree about what an entry is. */}
      <section aria-labelledby="security-history" className="mt-8">
        <h2 id="security-history" className="text-base font-semibold">
          Security history
        </h2>
        <p className="mt-1 text-sm text-midGray">
          Role changes, logins and session events recorded by THIS server instance, newest first.
          Failed and denied attempts are included — a denial is the entry most worth keeping. It
          is not the durable record: that is the structured line written to stderr, and the
          Postgres audit table ships in migration 35, which is not yet applied.
        </p>
        {securityHistory.length === 0 ? (
          <EmptyState message="This instance has recorded no role change, login or session event yet." />
        ) : (
          <div className="mt-3">
            <DataTable
              columns={SECURITY_COLUMNS}
              rows={securityHistory}
              rowKey={(entry) => entry.at + entry.actor + entry.action}
              emptyMessage="This instance has recorded no role change, login or session event yet."
            />
          </div>
        )}
      </section>

      <section aria-labelledby="provisioning" className="mt-8">
        <h2 id="provisioning" className="text-base font-semibold">
          Creating an account
        </h2>
        <p className="mt-1 text-sm text-midGray">
          Not available here, by design. A new account needs a PBKDF2 salt and hash, plus a role,
          in these two server environment variables:{' '}
          {/* The NAMES come from lib/adminIdentity.ts, the one module permitted
              to hold them. serviceRoleExposure.test.ts asserts that exactly one
              module's source contains ADMIN_ACCOUNTS, and naming it here as a
              literal would make this page a second place that does — for no
              better reason than rendering a sentence. */}
          <code className="font-mono text-xs">{ACCOUNTS_ENV_NAMES.join(' and ')}</code>. Generate
          them with <code className="font-mono text-xs">scripts/admin-hash-password.mjs</code> and
          set them in the deployment. Nothing on this page reads, writes or accepts a password.
        </p>
      </section>
    </>
  );
}
