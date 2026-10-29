import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { cookies } from 'next/headers';
import { currentAdminSession } from './adminAuthz';
import { recentAdminAudit } from './adminAudit';
import { parseRoleAssignmentRow, type AdminIdentityClient } from './adminIdentityStore';
import { createLoginThrottles, handleAdminSessionRequest, SOURCE_BUDGET } from './adminLogin';
import { ADMIN_SESSION_COOKIE, ABSOLUTE_TTL_MS, IDLE_TTL_MS, newSessionPayload, signAdminSession, touchedSessionPayload } from './adminSession';

const SECRET = 's'.repeat(40);
const ORIGIN = 'https://admin.test';
const ENV = { ADMIN_SESSION_SECRET: SECRET, ADMIN_ROLES: '{"founder":"billing"}' };

function store(options: { disabled?: boolean; cutoff?: number; fails?: boolean; absent?: boolean } = {}) {
  let row: Record<string, unknown> | null = options.absent ? null : {
    username: 'founder', role: 'read_only', is_active: !options.disabled,
    sessions_revoked_at: options.cutoff === undefined ? null : new Date(options.cutoff).toISOString(),
    assigned_by: 'another_admin', assigned_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(),
  };
  const writes: Record<string, unknown>[] = [];
  const client = {
    from: () => ({
      update: (values: Record<string, unknown>) => {
        writes.push(values);
        const query = {
          eq: () => query,
          or: () => query,
          select: async () => {
            if (options.fails) return { data: null, error: { message: 'unavailable' } };
            if (!row || (row.sessions_revoked_at !== null
              && Date.parse(String(row.sessions_revoked_at)) >= Date.parse(String(values.sessions_revoked_at)))) {
              return { data: [], error: null };
            }
            row = { ...row, ...values };
            return { data: [{ username: 'founder' }], error: null };
          },
        };
        return query;
      },
      select: () => ({ eq: () => ({ limit: async () => ({ data: row ? [row] : [], error: null }) }) }),
      insert: async (values: Record<string, unknown>) => {
        row = values;
        return { error: null };
      },
    }),
  } as unknown as AdminIdentityClient;
  return { client, writes, assignment: async () => row ? parseRoleAssignmentRow(row) : null };
}

function request(fields: Record<string, string>, token?: string, origin = ORIGIN) {
  return new Request(ORIGIN + '/api/admin/session', {
    method: 'POST',
    headers: {
      origin, 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '203.0.113.1',
      ...(token ? { cookie: ADMIN_SESSION_COOKIE + '=' + token } : {}),
    },
    body: new URLSearchParams(fields),
  });
}

async function tokenAt(now: number) {
  return signAdminSession(newSessionPayload({ sub: 'founder', role: 'billing', epoch: 0, now }), SECRET);
}

async function present(token: string) {
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: token }) } as unknown as Awaited<ReturnType<typeof cookies>>);
}

beforeEach(() => recentAdminAudit.clear());

describe('logout cutoff at the real Node permission gate', () => {
  test('copied and older cookies are denied; newer login survives; narrowing is preserved', async () => {
    const now = Date.now();
    const identity = store();
    const token = await tokenAt(now - 1_000);
    const response = await handleAdminSessionRequest(request({ intent: 'logout', username: 'forged' }, token), {
      env: ENV, now: () => now, identityStore: identity, sinks: [recentAdminAudit],
    });
    expect(response.headers.get('location')).toBe('/login?signedOut=1');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    for (const issued of [now - 2_000, now - 1_000]) {
      await present(await tokenAt(issued));
      await expect(currentAdminSession(ENV, { readAssignment: identity.assignment, sinks: [recentAdminAudit] }))
        .rejects.toMatchObject({ reason: 'sessions_revoked' });
    }
    await present(await tokenAt(now));
    expect(await currentAdminSession(ENV, { readAssignment: identity.assignment, sinks: [recentAdminAudit] }))
      .toMatchObject({ assignedRole: 'read_only' });
    expect(identity.writes[0]).not.toHaveProperty('role');
    expect(identity.writes[0]).not.toHaveProperty('is_active');
  });

  test('a later cutoff and disabled account survive repeated logout', async () => {
    const now = Date.now();
    const identity = store({ disabled: true, cutoff: now });
    for (let i = 0; i < 2; i += 1) {
      await handleAdminSessionRequest(request({ intent: 'logout' }, await tokenAt(now - 1_000)), {
        env: ENV, now: () => now, identityStore: identity, sinks: [recentAdminAudit],
      });
    }
    expect(await identity.assignment()).toMatchObject({ isActive: false, sessionsRevokedAtMs: now });
  });

  test('an idle browser cookie revokes an attacker copy refreshed within the idle window', async () => {
    const now = Date.now();
    const issued = now - IDLE_TTL_MS - 1_000;
    const payload = newSessionPayload({ sub: 'founder', role: 'billing', epoch: 0, now: issued });
    const idle = await signAdminSession(payload, SECRET);
    const activeCopy = await signAdminSession(touchedSessionPayload(payload, now), SECRET);
    const identity = store();
    await present(idle);
    await expect(currentAdminSession(ENV, { readAssignment: identity.assignment, sinks: [recentAdminAudit] }))
      .rejects.toMatchObject({ reason: 'idle' });
    const response = await handleAdminSessionRequest(request({ intent: 'logout' }, idle), {
      env: ENV, now: () => now, identityStore: identity, sinks: [recentAdminAudit],
    });
    expect(response.headers.get('location')).toBe('/login?signedOut=1');
    await present(activeCopy);
    await expect(currentAdminSession(ENV, { readAssignment: identity.assignment, sinks: [recentAdminAudit] }))
      .rejects.toMatchObject({ reason: 'sessions_revoked' });
  });

  test('first logout creates a cutoff from the environment role', async () => {
    const now = Date.now();
    const identity = store({ absent: true });
    await handleAdminSessionRequest(request({ intent: 'logout' }, await tokenAt(now)), {
      env: ENV, now: () => now, identityStore: identity, sinks: [recentAdminAudit],
    });
    expect(await identity.assignment()).toMatchObject({ role: 'billing', sessionsRevokedAtMs: now });
  });

  test('exhausted login budget cannot prevent logout or its cutoff', async () => {
    const now = Date.now();
    const identity = store();
    const throttles = createLoginThrottles();
    throttles.bySource.set('203.0.113.1', { startedAt: now, count: SOURCE_BUDGET });
    const response = await handleAdminSessionRequest(request({ intent: 'logout' }, await tokenAt(now)), {
      env: ENV, now: () => now, throttles, identityStore: identity, sinks: [recentAdminAudit],
    });
    expect(response.headers.get('location')).toBe('/login?signedOut=1');
    expect(await identity.assignment()).toMatchObject({ sessionsRevokedAtMs: now });
  });

  test('store failure clears browser cookie and explicitly reports unconfirmed server logout', async () => {
    const now = Date.now();
    const identity = store({ fails: true });
    const response = await handleAdminSessionRequest(request({ intent: 'logout' }, await tokenAt(now)), {
      env: ENV, now: () => now, identityStore: identity, sinks: [recentAdminAudit],
    });
    expect(response.headers.get('location')).toBe('/login?signOutUnconfirmed=1');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(recentAdminAudit.entries()[0]).toMatchObject({ action: 'logout', outcome: 'failure' });
  });

  test('logout awaits its verified audit record and distinguishes audit failure after revocation', async () => {
    const now = Date.now();
    const identity = store();
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const flushed = vi.fn(async () => { await pending; throw new Error('audit unavailable'); });
    let settled = false;
    const result = handleAdminSessionRequest(request({ intent: 'logout' }, await tokenAt(now)), {
      env: ENV, now: () => now, identityStore: identity,
      sinks: [recentAdminAudit, { write() {}, flush: flushed }],
    }).then((response) => { settled = true; return response; });
    await vi.waitFor(() => expect(flushed).toHaveBeenCalled());
    expect(settled).toBe(false);
    expect(recentAdminAudit.entries()[0]).toMatchObject({ actor: 'founder', actorVerified: true, action: 'logout' });
    finish?.();
    const response = await result;
    expect(response.headers.get('location')).toBe('/login?signOutUnrecorded=1');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await identity.assignment()).toMatchObject({ sessionsRevokedAtMs: now });
  });

  test('forged cookies cannot revoke anyone; foreign-origin logout cannot mutate or clear', async () => {
    const now = Date.now();
    const identity = store();
    const deps = { env: ENV, now: () => now, identityStore: identity, sinks: [recentAdminAudit] };
    await handleAdminSessionRequest(request({ intent: 'logout', username: 'founder' }, 'forged'), deps);
    const foreign = await handleAdminSessionRequest(request({ intent: 'logout' }, await tokenAt(now), 'https://evil.test'), deps);
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('set-cookie')).toBeNull();
    expect(identity.writes).toEqual([]);
  });

  test('absolute-expired and previous-epoch cookies cannot change the cutoff', async () => {
    const now = Date.now();
    const identity = store();
    const expired = await tokenAt(now - ABSOLUTE_TTL_MS);
    const oldEpoch = await signAdminSession(newSessionPayload({ sub: 'founder', role: 'billing', epoch: 1, now }), SECRET);
    for (const token of [expired, oldEpoch]) {
      const response = await handleAdminSessionRequest(request({ intent: 'logout' }, token), {
        env: ENV, now: () => now, identityStore: identity, sinks: [recentAdminAudit],
      });
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    }
    expect(identity.writes).toEqual([]);
  });
});
