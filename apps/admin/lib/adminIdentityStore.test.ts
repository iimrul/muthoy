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
//  - the update touches EXACTLY the four columns the grant permits, so
//    `username`, `assigned_by` and `assigned_at` cannot be rewritten by the
//    panel even if a future edit tried;
//  - revocation is forward-only, so it cannot revive sessions an earlier
//    revocation killed;
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
}

/**
 * A PostgREST-shaped fake, narrow on purpose: it answers exactly the three
 * shapes lib/adminIdentityStore.ts issues and records every one, so "no client
 * call happened" is a provable assertion rather than a belief.
 */
function createClient(options: ClientOptions = {}) {
  const calls: ClientCall[] = [];
  const rows = options.rows ?? [];

  function result(): { data: unknown[] | null; error: { message: string } | null } {
    return options.selectError === undefined
      ? { data: rows, error: null }
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
          return Promise.resolve(writeResult());
        },
        update(values: Record<string, unknown>) {
          const call: ClientCall = { op: 'update', table, values, filters: [] };
          calls.push(call);
          return {
            eq: (...args: unknown[]) => {
              call.filters.push({ method: 'eq', args });
              return Promise.resolve(writeResult());
            },
          };
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
      { username: 'ops', role: 'support', isActive: true, revokeSessionsAtMs: null, assignedBy: 'founder' },
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

  test('updates EXACTLY the four columns the grant permits', async () => {
    const { client, calls } = createClient({ rows: [row()] });

    const effect = await writeRoleAssignment(
      {
        username: 'ops',
        role: 'support',
        isActive: false,
        revokeSessionsAtMs: null,
        assignedBy: 'someone_else',
      },
      { client, now: () => NOW },
    );

    expect(effect).toBe('updated');
    const update = calls.find((call) => call.op === 'update');
    expect(Object.keys(update?.values ?? {}).sort()).toEqual([
      'is_active',
      'role',
      'sessions_revoked_at',
      'updated_at',
    ]);
    // The attribution is immutable BY PRIVILEGE; this proves the code never
    // even asks, so the column-level grant is not the only thing in the way.
    expect(update?.values).not.toHaveProperty('username');
    expect(update?.values).not.toHaveProperty('assigned_by');
    expect(update?.values).not.toHaveProperty('assigned_at');
    expect(update?.filters).toEqual([{ method: 'eq', args: ['username', 'ops'] }]);
  });

  test('never issues a delete or a truncate', async () => {
    const { client, calls } = createClient({ rows: [row()] });
    await writeRoleAssignment(
      { username: 'ops', role: 'support', isActive: false, revokeSessionsAtMs: null, assignedBy: 'founder' },
      { client, now: () => NOW },
    );
    expect(calls.map((call) => call.op).sort()).toEqual(['select', 'update']);
  });

  test('a null revocation point leaves the existing one alone', async () => {
    const existing = '2026-10-25T05:00:00.000Z';
    const { client, calls } = createClient({ rows: [row({ sessions_revoked_at: existing })] });

    await writeRoleAssignment(
      { username: 'ops', role: 'read_only', isActive: true, revokeSessionsAtMs: null, assignedBy: 'founder' },
      { client, now: () => NOW },
    );

    const update = calls.find((call) => call.op === 'update');
    expect(update?.values?.sessions_revoked_at).toBe(existing);
  });

  test('revocation is FORWARD-ONLY: an earlier instant cannot revive sessions', async () => {
    const existing = '2026-10-25T05:00:00.000Z';
    const { client, calls } = createClient({ rows: [row({ sessions_revoked_at: existing })] });

    await writeRoleAssignment(
      {
        username: 'ops',
        role: 'read_only',
        isActive: true,
        revokeSessionsAtMs: Date.parse('2026-10-24T00:00:00.000Z'),
        assignedBy: 'founder',
      },
      { client, now: () => NOW },
    );

    const update = calls.find((call) => call.op === 'update');
    expect(update?.values?.sessions_revoked_at).toBe(existing);
  });

  test('a later instant does move the revocation point', async () => {
    const { client, calls } = createClient({
      rows: [row({ sessions_revoked_at: '2026-10-24T00:00:00.000Z' })],
    });

    await writeRoleAssignment(
      {
        username: 'ops',
        role: 'read_only',
        isActive: true,
        revokeSessionsAtMs: NOW.getTime(),
        assignedBy: 'founder',
      },
      { client, now: () => NOW },
    );

    const update = calls.find((call) => call.op === 'update');
    expect(update?.values?.sessions_revoked_at).toBe(NOW.toISOString());
  });

  test('a failing write throws without leaking the driver message', async () => {
    const { client } = createClient({ rows: [], writeError: 'permission denied for table' });
    await expect(writeRoleAssignment(
      { username: 'ops', role: 'support', isActive: true, revokeSessionsAtMs: null, assignedBy: 'founder' },
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

  test('writes the ENVIRONMENT role, so a revocation narrows nothing', async () => {
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
