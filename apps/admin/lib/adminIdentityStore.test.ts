// Batch 3 §4.3 — the assignment store and Page 8's authorized writes, executed.
//
// What has to be true, and is asserted one by one:
//
//  - the PERMISSION is checked before anything else, so a denied role never
//    reaches a client: the fake client records every call, and a denied
//    attempt records none;
//  - a NARROWED super_admin is denied too — the intersection is not advisory;
//  - an admin cannot change their own role or revoke their own sessions;
//  - the target must already exist in ADMIN_ROLES;
//  - a role change touches EXACTLY `role`, `is_active` and `updated_at`, so
//    `username`, `assigned_by` and `assigned_at` cannot be rewritten by the
//    panel even if a future edit tried -- and NEITHER can the revocation
//    point, which belongs to the other writer;
//  - a revocation touches EXACTLY `sessions_revoked_at` and `updated_at`, so
//    a concurrent disable or narrowing cannot be lost;
//  - revocation is forward-only, enforced in the WHERE clause rather than
//    from a read, so it cannot revive sessions an earlier revocation killed;
//  - a malformed row THROWS rather than reading as "no narrowing row";
//  - success and failure are both audited.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const cookieStore = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'muthoy_admin_session' && cookieStore.value !== undefined
        ? { name, value: cookieStore.value }
        : undefined,
  }),
}));

const { recentAdminAudit } = await import('./adminAudit');
const { newSessionPayload, signAdminSession } = await import('./adminSession');
const { AdminDataError } = await import('./errors');
const {
  ADMIN_ROLE_ASSIGNMENT_COLUMNS,
  listRoleAssignments,
  parseRoleAssignmentRow,
  readRoleAssignment,
  revokeRoleAssignmentSessions,
  writeRoleAssignment,
} = await import('./adminIdentityStore');
const { assignAdminRole, revokeAdminSessions } = await import('./adminIdentityActions');

type Role = 'super_admin' | 'billing' | 'support' | 'read_only';

const SECRET = 'a'.repeat(32);
const NOW = new Date('2026-10-25T06:00:00.000Z');

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    username: 'ops',
    role: 'read_only',
    is_active: true,
    sessions_revoked_at: null,
    assigned_by: 'founder',
    assigned_at: '2026-10-25T00:00:00.000Z',
    updated_at: '2026-10-25T00:00:00.000Z',
    ...overrides,
  };
}

function envFor(roles: Record<string, Role>): Record<string, string> {
  return { ADMIN_SESSION_SECRET: SECRET, ADMIN_ROLES: JSON.stringify(roles) };
}

async function signInAs(username: string, role: Role): Promise<void> {
  cookieStore.value = await signAdminSession(
    newSessionPayload({ sub: username, role, epoch: 0, now: Date.now() }),
    SECRET,
  );
}

interface ClientCall {
  op: 'select' | 'insert' | 'update';
  table: string;
  columns?: string;
  values?: Record<string, unknown>;
  filters: { method: string; args: unknown[] }[];
}

interface ClientOptions {
  rows?: Record<string, unknown>[];
  selectError?: string;
  writeError?: string;
  /**
   * The rows an UPDATE ... RETURNING answers with. Defaults to `rows`, which
   * is the ordinary case: the row exists and the filter matches it. Set it to
   * [] to model the two zero-row cases -- no such row, or a revocation point
   * already at or past the one being written.
   */
  updated?: Record<string, unknown>[];
  /**
   * One `updated` answer PER UPDATE, consumed in order, so a retry can be
   * given a different outcome from the attempt before it. Without this a
   * concurrency test can only describe one round trip, and the defect being
   * regressed here only appears across two.
   */
  updatedSequence?: Record<string, unknown>[][];
  /** One `rows` answer PER SELECT, consumed in order, for the same reason. */
  rowsSequence?: Record<string, unknown>[][];
  /** An error for the FIRST insert only, modelling a lost insert race. */
  firstInsertError?: string;
}

/**
 * A PostgREST-shaped fake, narrow on purpose: it answers exactly the three
 * shapes lib/adminIdentityStore.ts issues and records every one, so "no client
 * call happened" is a provable assertion rather than a belief.
 */
function createClient(options: ClientOptions = {}) {
  const calls: ClientCall[] = [];
  const rows = options.rows ?? [];
  // Sequenced answers are consumed per call; the last one repeats, so a test
  // only has to describe the rounds that differ.
  let selectIndex = 0;
  let updateIndex = 0;
  let insertCount = 0;

  function nextFrom<T>(
    sequence: readonly T[] | undefined,
    index: number,
    fallback: T,
  ): T {
    if (sequence === undefined || sequence.length === 0) return fallback;
    return sequence[Math.min(index, sequence.length - 1)] ?? fallback;
  }

  function result(): { data: unknown[] | null; error: { message: string } | null } {
    const answer = nextFrom(options.rowsSequence, selectIndex, rows);
    selectIndex += 1;
    return options.selectError === undefined
      ? { data: answer, error: null }
      : { data: null, error: { message: options.selectError } };
  }

  function writeResult(): { data: null; error: { message: string } | null } {
    return options.writeError === undefined
      ? { data: null, error: null }
      : { data: null, error: { message: options.writeError } };
  }

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const call: ClientCall = { op: 'select', table, columns, filters: [] };
          calls.push(call);
          const chain: Record<string, unknown> = {
            limit: (...args: unknown[]) => {
              call.filters.push({ method: 'limit', args });
              return Promise.resolve(result());
            },
            range: (...args: unknown[]) => {
              call.filters.push({ method: 'range', args });
              return Promise.resolve(result());
            },
          };
          for (const method of ['eq', 'order']) {
            chain[method] = (...args: unknown[]) => {
              call.filters.push({ method, args });
              return chain;
            };
          }
          return chain;
        },
        insert(values: Record<string, unknown>) {
          calls.push({ op: 'insert', table, values, filters: [] });
          insertCount += 1;
          if (insertCount === 1 && options.firstInsertError !== undefined) {
            return Promise.resolve({
              data: null,
              error: { message: options.firstInsertError },
            });
          }
          return Promise.resolve(writeResult());
        },
        update(values: Record<string, unknown>) {
          const call: ClientCall = { op: 'update', table, values, filters: [] };
          calls.push(call);
          // Filters chain and the builder is awaitable at any point, like
          // PostgREST's: `.eq(...)` alone is a write, `.select(...)` makes it
          // an UPDATE ... RETURNING.
          const chain: Record<string, unknown> = {
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve(writeResult()).then(resolve),
            select: (...args: unknown[]) => {
              call.filters.push({ method: 'select', args });
              const answer = nextFrom(
                options.updatedSequence,
                updateIndex,
                options.updated ?? rows,
              );
              updateIndex += 1;
              return Promise.resolve(
                options.writeError === undefined
                  ? { data: answer, error: null }
                  : { data: null, error: { message: options.writeError } },
              );
            },
          };
          for (const method of ['eq', 'or']) {
            chain[method] = (...args: unknown[]) => {
              call.filters.push({ method, args });
              return chain;
            };
          }
          return chain;
        },
      };
    },
  };

  return { client: client as never, calls };
}

beforeEach(() => {
  cookieStore.value = undefined;
  recentAdminAudit.clear();
});

describe('parseRoleAssignmentRow refuses what it cannot read', () => {
  test('parses a well-formed row', () => {
    const parsed = parseRoleAssignmentRow(row({ sessions_revoked_at: '2026-10-25T05:00:00.000Z' }));
    expect(parsed).toEqual({
      username: 'ops',
      role: 'read_only',
      isActive: true,
      sessionsRevokedAtMs: Date.parse('2026-10-25T05:00:00.000Z'),
      sessionsRevokedAt: '2026-10-25T05:00:00.000Z',
      assignedBy: 'founder',
      assignedAt: '2026-10-25T00:00:00.000Z',
      updatedAt: '2026-10-25T00:00:00.000Z',
    });
  });

  test('a null revocation point is null, not zero', () => {
    const parsed = parseRoleAssignmentRow(row());
    expect(parsed.sessionsRevokedAtMs).toBeNull();
    expect(parsed.sessionsRevokedAt).toBeNull();
  });

  test.each([
    ['an unknown role', row({ role: 'owner' })],
    ['a prototype role name', row({ role: 'constructor' })],
    ['a missing role', row({ role: null })],
    ['a non-boolean is_active', row({ is_active: 'true' })],
    ['an unparseable revocation timestamp', row({ sessions_revoked_at: 'yesterday' })],
    ['a non-string revocation timestamp', row({ sessions_revoked_at: 17 })],
    ['an empty username', row({ username: '' })],
    ['a missing assigned_by', row({ assigned_by: null })],
    ['a missing updated_at', row({ updated_at: undefined })],
  ])('throws on %s', (_label, candidate) => {
    expect(() => parseRoleAssignmentRow(candidate)).toThrow(AdminDataError);
  });
});

describe('readRoleAssignment', () => {
  test('returns null when the account has no row', async () => {
    const { client, calls } = createClient({ rows: [] });
    await expect(readRoleAssignment('ops', { client })).resolves.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ op: 'select', table: 'admin_role_assignments' });
  });

  test('selects the exact column list and filters on the username', async () => {
    const { client, calls } = createClient({ rows: [row()] });
    await readRoleAssignment('ops', { client });

    expect(calls[0]?.columns).toBe(ADMIN_ROLE_ASSIGNMENT_COLUMNS);
    expect(calls[0]?.filters).toEqual([
      { method: 'eq', args: ['username', 'ops'] },
      { method: 'limit', args: [1] },
    ]);
  });

  test('a query error THROWS — it does not read as "no row"', async () => {
    const { client } = createClient({ selectError: 'permission denied' });
    await expect(readRoleAssignment('ops', { client })).rejects.toBeInstanceOf(AdminDataError);
  });

  test('the driver message never reaches the thrown error', async () => {
    const { client } = createClient({ selectError: 'FATAL: password authentication failed' });
    await expect(readRoleAssignment('ops', { client }))
      .rejects.toThrow('admin role assignment read failed');
  });

  test('an empty username is refused before any query', async () => {
    const { client, calls } = createClient();
    await expect(readRoleAssignment('', { client })).rejects.toBeInstanceOf(AdminDataError);
    expect(calls).toEqual([]);
  });
});

describe('listRoleAssignments', () => {
  test('orders by username and bounds the read', async () => {
    const { client, calls } = createClient({ rows: [row(), row({ username: 'zed' })] });
    const listed = await listRoleAssignments({ client });

    expect(listed.map((entry) => entry.username)).toEqual(['ops', 'zed']);
    expect(calls[0]?.filters).toEqual([
      { method: 'order', args: ['username', { ascending: true }] },
      { method: 'range', args: [0, 499] },
    ]);
  });

  test('one malformed row fails the whole list rather than silently dropping it', async () => {
    const { client } = createClient({ rows: [row(), row({ role: 'owner' })] });
    await expect(listRoleAssignments({ client })).rejects.toBeInstanceOf(AdminDataError);
  });
});

describe('writeRoleAssignment', () => {
  test('inserts the attribution when no row exists', async () => {
    const { client, calls } = createClient({ rows: [] });

    const effect = await writeRoleAssignment(
      { username: 'ops', role: 'support', isActive: true, assignedBy: 'founder' },
      { client, now: () => NOW },
    );

    expect(effect).toBe('created');
    const insert = calls.find((call) => call.op === 'insert');
    expect(insert?.values).toEqual({
      username: 'ops',
      role: 'support',
      is_active: true,
      sessions_revoked_at: null,
      assigned_by: 'founder',
      assigned_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
  });

  test('updates EXACTLY role, is_active and updated_at', async () => {
    const { client, calls } = createClient({ rows: [row()] });

    const effect = await writeRoleAssignment(
      {
        username: 'ops',
        role: 'support',
        isActive: false,
        assignedBy: 'someone_else',
      },
      { client, now: () => NOW },
    );

    expect(effect).toBe('updated');
    const update = calls.find((call) => call.op === 'update');
    expect(Object.keys(update?.values ?? {}).sort()).toEqual([
      'is_active',
      'role',
      'updated_at',
    ]);
    // The attribution is immutable BY PRIVILEGE; this proves the code never
    // even asks, so the column-level grant is not the only thing in the way.
    expect(update?.values).not.toHaveProperty('username');
    expect(update?.values).not.toHaveProperty('assigned_by');
    expect(update?.values).not.toHaveProperty('assigned_at');
    expect(update?.filters).toEqual([{ method: 'eq', args: ['username', 'ops'] }]);
  });

  test('a role change never names the revocation point, so it cannot carry a stale one forward', async () => {
    // The grant permits this column, so only the code keeps it out. A role
    // change that wrote back a revocation point it had read a moment earlier
    // would silently undo a revocation committed in between.
    const existing = '2026-10-25T05:00:00.000Z';
    const { client, calls } = createClient({ rows: [row({ sessions_revoked_at: existing })] });

    await writeRoleAssignment(
      { username: 'ops', role: 'read_only', isActive: true, assignedBy: 'founder' },
      { client, now: () => NOW },
    );

    const update = calls.find((call) => call.op === 'update');
    expect(update?.values).not.toHaveProperty('sessions_revoked_at');
  });

  test('never issues a delete or a truncate', async () => {
    const { client, calls } = createClient({ rows: [row()] });
    await writeRoleAssignment(
      { username: 'ops', role: 'support', isActive: false, assignedBy: 'founder' },
      { client, now: () => NOW },
    );
    expect(calls.map((call) => call.op).sort()).toEqual(['select', 'update']);
  });

  test('a failing write throws without leaking the driver message', async () => {
    const { client } = createClient({ rows: [], writeError: 'permission denied for table' });
    await expect(writeRoleAssignment(
      { username: 'ops', role: 'support', isActive: true, assignedBy: 'founder' },
      { client, now: () => NOW },
    )).rejects.toThrow('admin role assignment write failed');
  });
});

describe('revokeRoleAssignmentSessions — a security action must not widen authority', () => {
  const REVOKE_AT = Date.parse('2026-10-25T06:00:00.000Z');

  /**
   * Applies a recorded UPDATE to the row a CONCURRENT transaction committed,
   * which is the only way to show a lost update rather than assert around it.
   */
  function applyTo(
    committed: Record<string, unknown>,
    values: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    return { ...committed, ...(values ?? {}) };
  }

  test('writes EXACTLY the revocation point and updated_at', async () => {
    const { client, calls } = createClient({ rows: [row()] });

    const effect = await revokeRoleAssignmentSessions(
      { username: 'ops', revokeAtMs: REVOKE_AT, standingRole: 'super_admin', assignedBy: 'founder' },
      { client, now: () => NOW },
    );

    expect(effect).toBe('advanced');
    const update = calls.find((call) => call.op === 'update');
    expect(Object.keys(update?.values ?? {}).sort()).toEqual([
      'sessions_revoked_at',
      'updated_at',
    ]);
    expect(update?.values).not.toHaveProperty('role');
    expect(update?.values).not.toHaveProperty('is_active');
  });

  test('a disable committed concurrently is NOT overwritten', async () => {
    // GATE 5 DELTA FINDING 1, reproduced as the reviewer described it: a
    // disabled read_only account must not come back as an enabled
    // super_admin because its sessions were revoked.
    const { client, calls } = createClient({ rows: [row()] });

    await revokeRoleAssignmentSessions(
      { username: 'ops', revokeAtMs: REVOKE_AT, standingRole: 'super_admin', assignedBy: 'founder' },
      { client, now: () => NOW },
    );

    const concurrentlyDisabled = row({ role: 'read_only', is_active: false });
    const after = applyTo(
      concurrentlyDisabled,
      calls.find((call) => call.op === 'update')?.values,
    );

    expect(after.is_active).toBe(false);
    expect(after.role).toBe('read_only');
    expect(after.sessions_revoked_at).toBe(new Date(REVOKE_AT).toISOString());
  });

  test('the shape the first fix used WOULD have overwritten it', () => {
    // The negative control for the test above. Without it, that test passes
    // for any update whatsoever, including one that writes nothing at all.
    const concurrentlyDisabled = row({ role: 'read_only', is_active: false });
    const firstFixValues = {
      role: 'super_admin',
      is_active: true,
      sessions_revoked_at: new Date(REVOKE_AT).toISOString(),
      updated_at: NOW.toISOString(),
    };

    const after = applyTo(concurrentlyDisabled, firstFixValues);

    expect(after.is_active).toBe(true);
    expect(after.role).toBe('super_admin');
  });

  test('forward-only lives in the WHERE clause, not in a read', async () => {
    const { client, calls } = createClient({ rows: [row()] });

    await revokeRoleAssignmentSessions(
      { username: 'ops', revokeAtMs: REVOKE_AT, standingRole: 'support', assignedBy: 'founder' },
      { client, now: () => NOW },
    );

    const update = calls.find((call) => call.op === 'update');
    expect(update?.filters).toEqual([
      { method: 'eq', args: ['username', 'ops'] },
      {
        method: 'or',
        args: [
          'sessions_revoked_at.is.null,sessions_revoked_at.lt."'
          + new Date(REVOKE_AT).toISOString() + '"',
        ],
      },
      { method: 'select', args: ['username'] },
    ]);
  });

  test('matching a row needs NO read, so there is no read-then-write window', async () => {
    const { client, calls } = createClient({ rows: [row()] });

    await revokeRoleAssignmentSessions(
      { username: 'ops', revokeAtMs: REVOKE_AT, standingRole: 'support', assignedBy: 'founder' },
      { client, now: () => NOW },
    );

    expect(calls.map((call) => call.op)).toEqual(['update']);
  });

  test('a row already revoked at or past this point is left alone', async () => {
    // Zero rows matched, but the row exists: nothing to do, and NO insert.
    const { client, calls } = createClient({
      rows: [row({ sessions_revoked_at: '2026-10-26T00:00:00.000Z' })],
      updated: [],
    });

    const effect = await revokeRoleAssignmentSessions(
      { username: 'ops', revokeAtMs: REVOKE_AT, standingRole: 'super_admin', assignedBy: 'founder' },
      { client, now: () => NOW },
    );

    expect(effect).toBe('already_later');
    expect(calls.map((call) => call.op)).toEqual(['update', 'select']);
    expect(calls.some((call) => call.op === 'insert')).toBe(false);
  });

  test('no row at all inserts the standing authority, enabled', async () => {
    const { client, calls } = createClient({ rows: [], updated: [] });

    const effect = await revokeRoleAssignmentSessions(
      { username: 'ops', revokeAtMs: REVOKE_AT, standingRole: 'support', assignedBy: 'founder' },
      { client, now: () => NOW },
    );

    expect(effect).toBe('created');
    expect(calls.find((call) => call.op === 'insert')?.values).toEqual({
      username: 'ops',
      role: 'support',
      is_active: true,
      sessions_revoked_at: new Date(REVOKE_AT).toISOString(),
      assigned_by: 'founder',
      assigned_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
  });

  test('never issues a delete or a truncate', async () => {
    const { client, calls } = createClient({ rows: [row()] });
    await revokeRoleAssignmentSessions(
      { username: 'ops', revokeAtMs: REVOKE_AT, standingRole: 'support', assignedBy: 'founder' },
      { client, now: () => NOW },
    );
    expect(calls.every((call) => call.op === 'update' || call.op === 'select')).toBe(true);
  });

  test('a row found with a NULL cutoff is not reported as already revoked', async () => {
    // GATE 5 SECOND-DELTA FINDING 1. The update matched nothing and the read
    // found a row -- which the previous version took as "already revoked at or
    // past this point" and reported SUCCESS for. A concurrent first insert
    // lands exactly that row with a null cutoff, so the caller audited a
    // successful revocation while every existing session stayed valid.
    //
    // There is no outcome here that can honestly be called success, so the
    // function fails closed.
    const { client, calls } = createClient({
      rows: [row({ sessions_revoked_at: null })],
      updated: [],
    });

    await expect(revokeRoleAssignmentSessions(
      { username: 'ops', revokeAtMs: REVOKE_AT, standingRole: 'support', assignedBy: 'founder' },
      { client, now: () => NOW },
    )).rejects.toThrow('admin role assignment write failed');

    // It did not quietly give up after one look: the attempts are real.
    expect(calls.filter((call) => call.op === 'update').length).toBeGreaterThan(1);
    // And it never invented a row on top of the one that exists.
    expect(calls.some((call) => call.op === 'insert')).toBe(false);
  });

  test('a row found with an EARLIER cutoff is not reported as already revoked either', async () => {
    // The second case the reviewer reproduced. An earlier cutoff means the
    // sessions this call was asked to kill are still valid.
    const { client } = createClient({
      rows: [row({ sessions_revoked_at: '2026-10-24T00:00:00.000Z' })],
      updated: [],
    });

    await expect(revokeRoleAssignmentSessions(
      { username: 'ops', revokeAtMs: REVOKE_AT, standingRole: 'support', assignedBy: 'founder' },
      { client, now: () => NOW },
    )).rejects.toThrow('admin role assignment write failed');
  });

  test('a cutoff at EXACTLY the requested instant IS already revoked', async () => {
    // The boundary. `>=` is the right comparison: a session refused from this
    // instant onwards is what was asked for, so there is nothing to do.
    const { client, calls } = createClient({
      rows: [row({ sessions_revoked_at: new Date(REVOKE_AT).toISOString() })],
      updated: [],
    });

    const effect = await revokeRoleAssignmentSessions(
      { username: 'ops', revokeAtMs: REVOKE_AT, standingRole: 'support', assignedBy: 'founder' },
      { client, now: () => NOW },
    );

    expect(effect).toBe('already_later');
    expect(calls.some((call) => call.op === 'insert')).toBe(false);
  });

  test('a retry CONVERGES when the concurrent writer is done', async () => {
    // Failing closed must not mean failing on any contention at all. The
    // first update matches nothing and the row has a null cutoff; by the
    // second attempt the concurrent transaction has committed and the update
    // lands.
    const { client, calls } = createClient({
      rows: [row({ sessions_revoked_at: null })],
      updatedSequence: [[], [row()]],
    });

    const effect = await revokeRoleAssignmentSessions(
      { username: 'ops', revokeAtMs: REVOKE_AT, standingRole: 'support', assignedBy: 'founder' },
      { client, now: () => NOW },
    );

    expect(effect).toBe('advanced');
    expect(calls.filter((call) => call.op === 'update')).toHaveLength(2);
  });

  test('a LOST INSERT race retries the update rather than throwing', async () => {
    // No row, so this attempt inserts -- and loses to a concurrent insert.
    // The row now exists, so the right next move is the UPDATE, not an error.
    const { client, calls } = createClient({
      rows: [],
      rowsSequence: [[], [row({ sessions_revoked_at: null })]],
      updatedSequence: [[], [row()]],
      firstInsertError: 'duplicate key value violates unique constraint',
    });

    const effect = await revokeRoleAssignmentSessions(
      { username: 'ops', revokeAtMs: REVOKE_AT, standingRole: 'support', assignedBy: 'founder' },
      { client, now: () => NOW },
    );

    expect(effect).toBe('advanced');
    expect(calls.filter((call) => call.op === 'insert')).toHaveLength(1);
    expect(calls.filter((call) => call.op === 'update')).toHaveLength(2);
  });

  test('a failing revoke throws without leaking the driver message', async () => {
    const { client } = createClient({ rows: [row()], writeError: 'permission denied for table' });
    await expect(revokeRoleAssignmentSessions(
      { username: 'ops', revokeAtMs: REVOKE_AT, standingRole: 'support', assignedBy: 'founder' },
      { client, now: () => NOW },
    )).rejects.toThrow('admin role assignment write failed');
  });
});

describe('assignAdminRole — permission comes first', () => {
  test.each(['billing', 'support', 'read_only'] as const)(
    '%s is denied and reaches no client at all',
    async (role) => {
      await signInAs('actor', role);
      const { client, calls } = createClient({ rows: [] });

      await expect(assignAdminRole(
        { username: 'ops', role: 'read_only', isActive: true },
        {
          client,
          env: envFor({ actor: role, ops: 'read_only' }),
          now: () => NOW,
          sinks: [recentAdminAudit],
          readAssignment: async () => null,
        },
      )).rejects.toThrow();

      expect(calls).toEqual([]);
    },
  );

  test('a NARROWED super_admin is denied too', async () => {
    await signInAs('actor', 'super_admin');
    const { client, calls } = createClient({ rows: [] });

    await expect(assignAdminRole(
      { username: 'ops', role: 'read_only', isActive: true },
      {
        client,
        env: envFor({ actor: 'super_admin', ops: 'read_only' }),
        now: () => NOW,
        sinks: [recentAdminAudit],
        // The row narrows the actor to read_only, which holds no admins.write.
        readAssignment: async () => ({
          username: 'actor',
          role: 'read_only' as const,
          isActive: true,
          sessionsRevokedAtMs: null,
          sessionsRevokedAt: null,
          assignedBy: 'founder',
          assignedAt: '2026-10-25T00:00:00.000Z',
          updatedAt: '2026-10-25T00:00:00.000Z',
        }),
      },
    )).rejects.toThrow();

    expect(calls).toEqual([]);
  });
});

describe('assignAdminRole — the escalation guards', () => {
  function deps(client: never, roles: Record<string, Role>) {
    return {
      client,
      env: envFor(roles),
      now: () => NOW,
      sinks: [recentAdminAudit],
      readAssignment: async () => null,
    };
  }

  test('narrows the target and audits the success', async () => {
    await signInAs('founder', 'super_admin');
    const { client, calls } = createClient({ rows: [] });

    const result = await assignAdminRole(
      { username: 'ops', role: 'support', isActive: true },
      deps(client, { founder: 'super_admin', ops: 'super_admin' }),
    );

    expect(result.ok).toBe(true);
    expect(calls.some((call) => call.op === 'insert')).toBe(true);
    expect(recentAdminAudit.entries()).toMatchObject([{
      actor: 'founder',
      role: 'super_admin',
      action: 'admins.assign_role',
      target: 'ops',
      outcome: 'success',
    }]);
  });

  test('an admin cannot change their OWN role', async () => {
    await signInAs('founder', 'super_admin');
    const { client, calls } = createClient({ rows: [] });

    const result = await assignAdminRole(
      { username: 'founder', role: 'read_only', isActive: true },
      deps(client, { founder: 'super_admin' }),
    );

    expect(result).toEqual({ ok: false, message: 'You cannot change your own role.' });
    expect(calls).toEqual([]);
    expect(recentAdminAudit.entries()).toMatchObject([{
      action: 'admins.assign_role',
      target: 'founder',
      outcome: 'denied',
      meta: { reason: 'self role change' },
    }]);
  });

  test('a target absent from ADMIN_ROLES is refused', async () => {
    await signInAs('founder', 'super_admin');
    const { client, calls } = createClient({ rows: [] });

    const result = await assignAdminRole(
      { username: 'ghost', role: 'support', isActive: true },
      deps(client, { founder: 'super_admin' }),
    );

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(recentAdminAudit.entries()).toMatchObject([{
      outcome: 'denied',
      meta: { reason: 'no ADMIN_ROLES entry' },
    }]);
  });

  test.each([
    ['an unknown role', { username: 'ops', role: 'owner', isActive: true }],
    ['a missing role', { username: 'ops', isActive: true }],
    ['a non-boolean isActive', { username: 'ops', role: 'support', isActive: 'yes' }],
    ['a reserved username', { username: '__proto__', role: 'support', isActive: true }],
    ['an over-long username', { username: 'o'.repeat(65), role: 'support', isActive: true }],
    ['a nested payload', { username: { name: 'ops' }, role: 'support', isActive: true }],
    ['no payload at all', null],
  ])('refuses %s before any query', async (_label, payload) => {
    await signInAs('founder', 'super_admin');
    const { client, calls } = createClient({ rows: [] });

    const result = await assignAdminRole(
      payload,
      deps(client, { founder: 'super_admin', ops: 'support' }),
    );

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  test('disabling writes is_active=false', async () => {
    await signInAs('founder', 'super_admin');
    const { client, calls } = createClient({ rows: [row()] });

    const result = await assignAdminRole(
      { username: 'ops', role: 'read_only', isActive: false },
      deps(client, { founder: 'super_admin', ops: 'read_only' }),
    );

    expect(result.ok).toBe(true);
    expect(calls.find((call) => call.op === 'update')?.values?.is_active).toBe(false);
  });

  test('a store failure is audited as a failure and reported safely', async () => {
    await signInAs('founder', 'super_admin');
    const { client } = createClient({ rows: [], writeError: 'permission denied' });

    const result = await assignAdminRole(
      { username: 'ops', role: 'support', isActive: true },
      deps(client, { founder: 'super_admin', ops: 'support' }),
    );

    expect(result).toEqual({ ok: false, message: 'That role change could not be saved.' });
    expect(recentAdminAudit.entries()).toMatchObject([{
      action: 'admins.assign_role',
      outcome: 'failure',
      meta: { reason: 'store write failed' },
    }]);
  });
});

describe('revokeAdminSessions', () => {
  function deps(client: never, roles: Record<string, Role>) {
    return {
      client,
      env: envFor(roles),
      now: () => NOW,
      sinks: [recentAdminAudit],
      readAssignment: async () => null,
    };
  }

  test('stamps the revocation point and audits it', async () => {
    await signInAs('founder', 'super_admin');
    const { client, calls } = createClient({ rows: [row()] });

    const result = await revokeAdminSessions(
      { username: 'ops' },
      deps(client, { founder: 'super_admin', ops: 'read_only' }),
    );

    expect(result.ok).toBe(true);
    expect(calls.find((call) => call.op === 'update')?.values?.sessions_revoked_at)
      .toBe(NOW.toISOString());
    expect(recentAdminAudit.entries()).toMatchObject([{
      action: 'admins.revoke_sessions',
      target: 'ops',
      outcome: 'success',
    }]);
  });

  test('with NO existing row, writes the environment role and enabled', async () => {
    // A FIRST revocation of an un-narrowed account must not invent a narrowing
    // nobody asked for: the environment role IS this account's standing
    // authority.
    await signInAs('founder', 'super_admin');
    const { client, calls } = createClient({ rows: [] });

    await revokeAdminSessions(
      { username: 'ops' },
      deps(client, { founder: 'super_admin', ops: 'billing' }),
    );

    const insert = calls.find((call) => call.op === 'insert');
    expect(insert?.values?.role).toBe('billing');
    expect(insert?.values?.is_active).toBe(true);
  });

  test.each([
    ['a DISABLED, NARROWED account', { role: 'read_only', is_active: false }],
    ['an ENABLED, narrowed account', { role: 'support', is_active: true }],
  ])('%s keeps its role and enabled state through a revocation', async (_label, stored) => {
    // GATE 5 FINDING 1 and its DELTA, as one regression test.
    //
    // The original defect wrote `role: environmentRole, isActive: true`
    // unconditionally, so revoking the sessions of a disabled `read_only`
    // account whose environment role is `super_admin` RE-ENABLED it and
    // restored full authority. A security action that widens authority is
    // worse than no action at all.
    //
    // The first fix read the row and wrote those two values BACK, which the
    // delta review correctly rejected: a disable committed between the read
    // and the write would be lost. So the assertion is no longer "the right
    // values were written" but the stronger "those columns are not written at
    // all" — the environment role here is super_admin, so if either column
    // were in the update, it could only widen.
    await signInAs('founder', 'super_admin');
    const { client, calls } = createClient({ rows: [row(stored)] });

    const result = await revokeAdminSessions(
      { username: 'ops' },
      deps(client, { founder: 'super_admin', ops: 'super_admin' }),
    );

    expect(result.ok).toBe(true);
    const update = calls.find((call) => call.op === 'update');
    expect(update?.values, 'a revocation must not name the role').not.toHaveProperty('role');
    expect(update?.values, 'a revocation must not name the enabled state')
      .not.toHaveProperty('is_active');
    // And the revocation itself still happened — the fix must not make the
    // action a no-op.
    expect(update?.values?.sessions_revoked_at).toBe(NOW.toISOString());
    // No insert: the row exists, so the standing authority is never applied.
    expect(calls.some((call) => call.op === 'insert')).toBe(false);
  });

  test('an admin cannot revoke their OWN sessions', async () => {
    await signInAs('founder', 'super_admin');
    const { client, calls } = createClient({ rows: [] });

    const result = await revokeAdminSessions(
      { username: 'founder' },
      deps(client, { founder: 'super_admin' }),
    );

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(recentAdminAudit.entries()).toMatchObject([{
      action: 'admins.revoke_sessions',
      outcome: 'denied',
      meta: { reason: 'self revocation' },
    }]);
  });

  test('a target absent from ADMIN_ROLES is refused', async () => {
    await signInAs('founder', 'super_admin');
    const { client, calls } = createClient({ rows: [] });

    const result = await revokeAdminSessions(
      { username: 'ghost' },
      deps(client, { founder: 'super_admin' }),
    );

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  test.each(['billing', 'support', 'read_only'] as const)(
    '%s cannot revoke anyone, and reaches no client',
    async (role) => {
      await signInAs('actor', role);
      const { client, calls } = createClient({ rows: [] });

      await expect(revokeAdminSessions(
        { username: 'ops' },
        deps(client, { actor: role, ops: 'read_only' }),
      )).rejects.toThrow();

      expect(calls).toEqual([]);
    },
  );

  test.each([
    ['an empty username', { username: '' }],
    ['a reserved username', { username: 'constructor' }],
    ['a numeric username', { username: 7 }],
    ['no payload', undefined],
  ])('refuses %s before any query', async (_label, payload) => {
    await signInAs('founder', 'super_admin');
    const { client, calls } = createClient({ rows: [] });

    const result = await revokeAdminSessions(
      payload,
      deps(client, { founder: 'super_admin', ops: 'read_only' }),
    );

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
