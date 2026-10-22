// W4-06 — the authorization choke point, executed.
//
// The decisive property is that ADMIN_ROLES is AUTHORITATIVE: a correctly
// signed cookie claiming super_admin confers exactly what the environment says
// that username has right now, and nothing if it says nothing. A demotion
// therefore lands on the next request rather than at next login, and the stale
// claim is only audited.

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
const { AdminForbiddenError, AdminUnauthenticatedError } = await import('./errors');
const { currentAdminSession, requireAdminPermission, requirePermission } = await import('./adminAuthz');

const SECRET = 'a'.repeat(32);
const BASE_ENV = {
  ADMIN_SESSION_SECRET: SECRET,
  ADMIN_ROLES: '{"founder":"super_admin","ops":"read_only"}',
};

async function cookieFor(
  sub: string,
  role: 'super_admin' | 'billing' | 'support' | 'read_only',
  options: { epoch?: number; now?: number } = {},
): Promise<string> {
  const now = options.now ?? Date.now();
  return signAdminSession(
    newSessionPayload({ sub, role, epoch: options.epoch ?? 0, now }),
    SECRET,
  );
}

beforeEach(() => {
  cookieStore.value = undefined;
  recentAdminAudit.clear();
});

describe('requirePermission', () => {
  test('allows a role that holds the permission, and audits nothing', () => {
    expect(() => requirePermission({ username: 'founder', role: 'billing' }, 'subscriptions.write')).not.toThrow();
    expect(recentAdminAudit.entries()).toEqual([]);
  });

  test('throws AND audits the denial', () => {
    expect(() => requirePermission({ username: 'ops', role: 'read_only' }, 'subscriptions.write'))
      .toThrow(AdminForbiddenError);

    expect(recentAdminAudit.entries()).toMatchObject([{
      actor: 'ops',
      role: 'read_only',
      action: 'authz.denied',
      outcome: 'denied',
      meta: { permission: 'subscriptions.write' },
    }]);
  });

  test('the thrown error names the permission and the role, not the data', () => {
    try {
      requirePermission({ username: 'ops', role: 'support' }, 'subscriptions.write');
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AdminForbiddenError);
      expect((error as InstanceType<typeof AdminForbiddenError>).permission).toBe('subscriptions.write');
      expect((error as InstanceType<typeof AdminForbiddenError>).role).toBe('support');
    }
  });
});

describe('currentAdminSession', () => {
  test('returns the role ADMIN_ROLES grants, not the one the cookie claims', async () => {
    cookieStore.value = await cookieFor('ops', 'super_admin');

    const session = await currentAdminSession(BASE_ENV);

    expect(session).toEqual({ username: 'ops', role: 'read_only', claimedRole: 'super_admin' });
  });

  test('a stale role claim is AUDITED, and the environment still wins', async () => {
    cookieStore.value = await cookieFor('ops', 'super_admin');

    await currentAdminSession(BASE_ENV);

    expect(recentAdminAudit.entries()).toMatchObject([{
      actor: 'ops',
      role: 'read_only',
      action: 'session.role_mismatch',
      meta: { claimedRole: 'super_admin', effectiveRole: 'read_only' },
    }]);
  });

  test('a username removed from ADMIN_ROLES is denied immediately, cookie and all', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin');

    await expect(currentAdminSession({ ...BASE_ENV, ADMIN_ROLES: '{"ops":"read_only"}' }))
      .rejects.toBeInstanceOf(AdminUnauthenticatedError);

    expect(recentAdminAudit.entries()).toMatchObject([{
      actor: 'founder',
      role: null,
      action: 'session.role_revoked',
      outcome: 'denied',
    }]);
  });

  test('no cookie at all is a rejection', async () => {
    await expect(currentAdminSession(BASE_ENV)).rejects.toBeInstanceOf(AdminUnauthenticatedError);
  });

  test('an expired cookie is a rejection', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin', { now: Date.now() - 9 * 60 * 60 * 1_000 });
    await expect(currentAdminSession(BASE_ENV)).rejects.toBeInstanceOf(AdminUnauthenticatedError);
  });

  test('a cookie from a revoked epoch is a rejection', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin', { epoch: 1 });
    await expect(currentAdminSession({ ...BASE_ENV, ADMIN_SESSION_EPOCH: '2' }))
      .rejects.toBeInstanceOf(AdminUnauthenticatedError);
  });

  test('an unconfigured panel throws rather than admitting anyone', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin');
    await expect(currentAdminSession({ ADMIN_ROLES: BASE_ENV.ADMIN_ROLES })).rejects.toThrow();
    await expect(currentAdminSession({ ADMIN_SESSION_SECRET: SECRET })).rejects.toThrow();
  });
});

describe('requireAdminPermission', () => {
  test('authenticates then authorizes, and returns who', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin');

    const session = await requireAdminPermission('subscriptions.write', BASE_ENV);

    expect(session.username).toBe('founder');
  });

  test('a demoted account loses the write permission on the very next request', async () => {
    cookieStore.value = await cookieFor('founder', 'billing');

    await expect(
      requireAdminPermission('subscriptions.write', { ...BASE_ENV, ADMIN_ROLES: '{"founder":"support"}' }),
    ).rejects.toBeInstanceOf(AdminForbiddenError);
  });

  test('a demotion from billing to support is not a RANKING question', async () => {
    // support holds support.write, which billing never had; billing held
    // subscriptions.write, which support never had. Whatever ADMIN_ROLES says
    // now is the whole answer.
    cookieStore.value = await cookieFor('founder', 'billing');
    const env = { ...BASE_ENV, ADMIN_ROLES: '{"founder":"support"}' };

    await expect(requireAdminPermission('support.write', env)).resolves.toMatchObject({ role: 'support' });
    await expect(requireAdminPermission('subscriptions.write', env)).rejects.toBeInstanceOf(AdminForbiddenError);
  });
});
