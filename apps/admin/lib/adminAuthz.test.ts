// W4-06 — the authorization choke point, executed.
//
// The decisive property is that ADMIN_ROLES is AUTHORITATIVE: a correctly
// signed cookie claiming super_admin confers exactly what the environment says
// that username has right now, and nothing if it says nothing. A demotion
// therefore lands on the next request rather than at next login, and the stale
// claim is only audited.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AdminRoleAssignment } from './adminAssignments';

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
const { permissionsForRole } = await import('./adminRoles');
const { currentAdminSession, requireAdminPermission, requirePermission } = await import('./adminAuthz');

const SECRET = 'a'.repeat(32);
const BASE_ENV = {
  ADMIN_SESSION_SECRET: SECRET,
  ADMIN_ROLES: '{"founder":"super_admin","ops":"read_only"}',
};

// Batch 3 §4.3. Every pre-Batch-3 case is the NO-ROW case, so it is spelled out
// once rather than repeated: with no assignment, authority is exactly what
// ADMIN_ROLES grants, which is the W4-06 behaviour these tests were written for.
// It is INJECTED rather than defaulted because the real reader opens a Supabase
// connection, and a unit test that silently needs one is a unit test that
// passes for the wrong reason.
const NO_ASSIGNMENT = { readAssignment: async () => null };

function assignment(overrides: Partial<AdminRoleAssignment> = {}): AdminRoleAssignment {
  return {
    username: 'ops',
    role: 'read_only',
    isActive: true,
    sessionsRevokedAtMs: null,
    sessionsRevokedAt: null,
    assignedBy: 'founder',
    assignedAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-25T00:00:00.000Z',
    ...overrides,
  };
}

/** Injects one assignment row for whichever username is asked for. */
function withAssignment(row: AdminRoleAssignment) {
  return { readAssignment: async () => row };
}

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
  test('allows a session that holds the permission, and audits nothing', () => {
    expect(() => requirePermission(
      { username: 'founder', role: 'billing', permissions: permissionsForRole('billing') },
      'subscriptions.write',
    )).not.toThrow();
    expect(recentAdminAudit.entries()).toEqual([]);
  });

  // Batch 3 §8.9c RETARGETED this case rather than deleting it. The THROW
  // assertion stays here; the AUDIT assertion moved to requireAdminPermission,
  // which is the async path that can await the record. requirePermission is
  // synchronous and throws, so control never returns to a caller that could
  // wait for it.
  test('throws, and records NOTHING of its own', () => {
    expect(() => requirePermission(
      { username: 'ops', role: 'read_only', permissions: permissionsForRole('read_only') },
      'subscriptions.write',
    )).toThrow(AdminForbiddenError);

    expect(recentAdminAudit.entries()).toEqual([]);
  });

  test('the thrown error names the permission and the role, not the data', () => {
    try {
      requirePermission(
        { username: 'ops', role: 'support', permissions: permissionsForRole('support') },
        'subscriptions.write',
      );
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AdminForbiddenError);
      expect((error as InstanceType<typeof AdminForbiddenError>).permission).toBe('subscriptions.write');
      expect((error as InstanceType<typeof AdminForbiddenError>).role).toBe('support');
    }
  });

  test('the EFFECTIVE set decides, not the role (Batch 3 §4.3)', () => {
    // This is the whole intersection guarantee at the choke point: a session
    // whose role still reads super_admin but whose narrowed set lacks the
    // permission is refused. Reading hasPermission(role) here would pass.
    expect(() => requirePermission(
      { username: 'founder', role: 'super_admin', permissions: permissionsForRole('read_only') },
      'admins.write',
    )).toThrow(AdminForbiddenError);
  });

  test('an empty effective set holds nothing at all', () => {
    for (const permission of ['shops.read', 'admins.write', 'settings.read'] as const) {
      expect(() => requirePermission(
        { username: 'ops', role: 'super_admin', permissions: [] },
        permission,
      )).toThrow(AdminForbiddenError);
    }
  });
});

describe('currentAdminSession', () => {
  test('returns the role ADMIN_ROLES grants, not the one the cookie claims', async () => {
    cookieStore.value = await cookieFor('ops', 'super_admin');

    const session = await currentAdminSession(BASE_ENV, NO_ASSIGNMENT);

    expect(session).toEqual({
      username: 'ops',
      role: 'read_only',
      claimedRole: 'super_admin',
      assignedRole: null,
      permissions: permissionsForRole('read_only'),
    });
  });

  test('a stale role claim is AUDITED, and the environment still wins', async () => {
    cookieStore.value = await cookieFor('ops', 'super_admin');

    await currentAdminSession(BASE_ENV, NO_ASSIGNMENT);

    expect(recentAdminAudit.entries()).toMatchObject([{
      actor: 'ops',
      role: 'read_only',
      action: 'session.role_mismatch',
      meta: { claimedRole: 'super_admin', effectiveRole: 'read_only' },
    }]);
  });

  test('a username removed from ADMIN_ROLES is denied immediately, cookie and all', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin');

    await expect(currentAdminSession({ ...BASE_ENV, ADMIN_ROLES: '{"ops":"read_only"}' }, NO_ASSIGNMENT))
      .rejects.toBeInstanceOf(AdminUnauthenticatedError);

    expect(recentAdminAudit.entries()).toMatchObject([{
      actor: 'founder',
      role: null,
      action: 'session.role_revoked',
      outcome: 'denied',
    }]);
  });

  test('no cookie at all is a rejection', async () => {
    await expect(currentAdminSession(BASE_ENV, NO_ASSIGNMENT))
      .rejects.toBeInstanceOf(AdminUnauthenticatedError);
  });

  test('an expired cookie is a rejection', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin', { now: Date.now() - 9 * 60 * 60 * 1_000 });
    await expect(currentAdminSession(BASE_ENV, NO_ASSIGNMENT))
      .rejects.toBeInstanceOf(AdminUnauthenticatedError);
  });

  test('a cookie from a revoked epoch is a rejection', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin', { epoch: 1 });
    await expect(currentAdminSession({ ...BASE_ENV, ADMIN_SESSION_EPOCH: '2' }, NO_ASSIGNMENT))
      .rejects.toBeInstanceOf(AdminUnauthenticatedError);
  });

  test('an unconfigured panel throws rather than admitting anyone', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin');
    await expect(currentAdminSession({ ADMIN_ROLES: BASE_ENV.ADMIN_ROLES }, NO_ASSIGNMENT)).rejects.toThrow();
    await expect(currentAdminSession({ ADMIN_SESSION_SECRET: SECRET }, NO_ASSIGNMENT)).rejects.toThrow();
  });

  test('the store is read BEFORE any authority is returned', async () => {
    // Ordering matters: a read that happened after the context was built would
    // make the disabled and revoked cases below unreachable in production.
    cookieStore.value = await cookieFor('ops', 'read_only');
    const asked: string[] = [];

    await currentAdminSession(BASE_ENV, {
      readAssignment: async (username) => {
        asked.push(username);
        return null;
      },
    });

    expect(asked).toEqual(['ops']);
  });
});

describe('currentAdminSession — the assignment row (Batch 3 §4.3)', () => {
  test('rule 1: an is_active=false row DENIES, and never falls back to ADMIN_ROLES', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin');

    await expect(currentAdminSession(
      BASE_ENV,
      withAssignment(assignment({ username: 'founder', role: 'super_admin', isActive: false })),
    )).rejects.toMatchObject({ reason: 'assignment_disabled' });

    expect(recentAdminAudit.entries()).toMatchObject([{
      actor: 'founder',
      role: 'super_admin',
      action: 'session.account_disabled',
      outcome: 'denied',
      meta: { reason: 'assignment_disabled' },
    }]);
  });

  test('rule 2: permissions are the INTERSECTION — a wider row grants nothing', async () => {
    cookieStore.value = await cookieFor('ops', 'read_only');

    const session = await currentAdminSession(
      BASE_ENV,
      withAssignment(assignment({ username: 'ops', role: 'super_admin' })),
    );

    // The environment says read_only; the row says super_admin; the row loses.
    expect(session.role).toBe('read_only');
    expect(session.assignedRole).toBe('super_admin');
    expect([...session.permissions].sort()).toEqual([...permissionsForRole('read_only')].sort());
    expect(session.permissions).not.toContain('admins.write');
  });

  test('rule 2: a narrower row is what applies', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin');

    const session = await currentAdminSession(
      BASE_ENV,
      withAssignment(assignment({ username: 'founder', role: 'support' })),
    );

    expect(session.role).toBe('super_admin');
    expect([...session.permissions].sort()).toEqual([...permissionsForRole('support')].sort());
    expect(session.permissions).not.toContain('admins.write');
    expect(session.permissions).not.toContain('subscriptions.write');
  });

  test('rule 3: a cookie minted BEFORE the revocation is refused', async () => {
    const mintedAt = Date.now() - 60_000;
    cookieStore.value = await cookieFor('ops', 'read_only', { now: mintedAt });

    await expect(currentAdminSession(
      BASE_ENV,
      withAssignment(assignment({ sessionsRevokedAtMs: mintedAt + 1_000 })),
    )).rejects.toMatchObject({ reason: 'sessions_revoked' });

    expect(recentAdminAudit.entries()).toMatchObject([{
      actor: 'ops',
      action: 'session.sessions_revoked',
      outcome: 'denied',
    }]);
  });

  test('rule 3: a cookie minted AT the revocation instant is refused too', async () => {
    const mintedAt = Date.now() - 60_000;
    cookieStore.value = await cookieFor('ops', 'read_only', { now: mintedAt });

    await expect(currentAdminSession(
      BASE_ENV,
      withAssignment(assignment({ sessionsRevokedAtMs: mintedAt })),
    )).rejects.toMatchObject({ reason: 'sessions_revoked' });
  });

  test('rule 3: a cookie minted AFTER the revocation still works', async () => {
    const revokedAt = Date.now() - 60_000;
    cookieStore.value = await cookieFor('ops', 'read_only', { now: revokedAt + 1_000 });

    const session = await currentAdminSession(
      BASE_ENV,
      withAssignment(assignment({ sessionsRevokedAtMs: revokedAt })),
    );

    expect(session.username).toBe('ops');
  });

  test('a disabled row denies even a cookie minted after its revocation point', async () => {
    const revokedAt = Date.now() - 60_000;
    cookieStore.value = await cookieFor('ops', 'read_only', { now: revokedAt + 1_000 });

    await expect(currentAdminSession(
      BASE_ENV,
      withAssignment(assignment({ isActive: false, sessionsRevokedAtMs: revokedAt })),
    )).rejects.toMatchObject({ reason: 'assignment_disabled' });
  });

  test('an unreadable store DENIES, with its own audited reason', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin');

    await expect(currentAdminSession(BASE_ENV, {
      readAssignment: async () => {
        throw new Error('connection refused');
      },
    })).rejects.toMatchObject({ reason: 'role_store_unavailable' });

    expect(recentAdminAudit.entries()).toMatchObject([{
      actor: 'founder',
      role: 'super_admin',
      action: 'session.role_store_unavailable',
      outcome: 'denied',
    }]);
  });

  test('an unreadable store does NOT fall back to the environment role', async () => {
    // The failure mode this rules out: catching the read error and carrying on
    // with ADMIN_ROLES alone, which would silently restore every permission a
    // narrowing row had taken away, exactly when the store cannot say so.
    cookieStore.value = await cookieFor('founder', 'super_admin');

    await expect(currentAdminSession(BASE_ENV, {
      readAssignment: async () => {
        throw new Error('connection refused');
      },
    })).rejects.toBeInstanceOf(AdminUnauthenticatedError);
  });
});

describe('requireAdminPermission', () => {
  test('authenticates then authorizes, and returns who', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin');

    const session = await requireAdminPermission('subscriptions.write', BASE_ENV, NO_ASSIGNMENT);

    expect(session.username).toBe('founder');
  });

  test('a demoted account loses the write permission on the very next request', async () => {
    cookieStore.value = await cookieFor('founder', 'billing');

    await expect(
      requireAdminPermission(
        'subscriptions.write',
        { ...BASE_ENV, ADMIN_ROLES: '{"founder":"support"}' },
        NO_ASSIGNMENT,
      ),
    ).rejects.toBeInstanceOf(AdminForbiddenError);
  });

  test('a demotion from billing to support is not a RANKING question', async () => {
    // support holds support.write, which billing never had; billing held
    // subscriptions.write, which support never had. Whatever ADMIN_ROLES says
    // now is the whole answer.
    cookieStore.value = await cookieFor('founder', 'billing');
    const env = { ...BASE_ENV, ADMIN_ROLES: '{"founder":"support"}' };

    await expect(requireAdminPermission('support.write', env, NO_ASSIGNMENT))
      .resolves.toMatchObject({ role: 'support' });
    await expect(requireAdminPermission('subscriptions.write', env, NO_ASSIGNMENT))
      .rejects.toBeInstanceOf(AdminForbiddenError);
  });

  test('a narrowing row takes a permission away at the gate, not just in the nav', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin');
    const narrowed = withAssignment(assignment({ username: 'founder', role: 'read_only' }));

    await expect(requireAdminPermission('shops.read', BASE_ENV, narrowed))
      .resolves.toMatchObject({ username: 'founder' });
    await expect(requireAdminPermission('admins.write', BASE_ENV, narrowed))
      .rejects.toBeInstanceOf(AdminForbiddenError);
    await expect(requireAdminPermission('settings.write', BASE_ENV, narrowed))
      .rejects.toBeInstanceOf(AdminForbiddenError);
  });

  test('the denial is AUDITED here, on the awaited path (§8.9c)', async () => {
    cookieStore.value = await cookieFor('ops', 'read_only');

    await expect(requireAdminPermission('subscriptions.write', BASE_ENV, NO_ASSIGNMENT))
      .rejects.toBeInstanceOf(AdminForbiddenError);

    expect(recentAdminAudit.entries()).toMatchObject([{
      actor: 'ops',
      actorVerified: true,
      role: 'read_only',
      action: 'authz.denied',
      outcome: 'denied',
      meta: { permission: 'subscriptions.write' },
    }]);
  });

  test('the denial audit SETTLES before the rejection is visible', async () => {
    cookieStore.value = await cookieFor('ops', 'read_only');
    const order: string[] = [];
    const slowSink = {
      write: () => order.push('write'),
      flush: async () => {
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        order.push('flushed');
      },
    };

    await expect(requireAdminPermission('subscriptions.write', BASE_ENV, {
      ...NO_ASSIGNMENT,
      sinks: [slowSink],
    })).rejects.toBeInstanceOf(AdminForbiddenError);
    order.push('rejected');

    // Not just "both happened": the flush completed FIRST. A denial recorded
    // after the rejection propagates is a denial the request can outrun, and
    // dropping the await is exactly what this ordering catches.
    expect(order).toEqual(['write', 'flushed', 'rejected']);
  });

  test('the denial is recorded exactly ONCE', async () => {
    cookieStore.value = await cookieFor('ops', 'read_only');

    await expect(requireAdminPermission('subscriptions.write', BASE_ENV, NO_ASSIGNMENT))
      .rejects.toThrow();

    expect(recentAdminAudit.entries().filter((entry) => entry.action === 'authz.denied'))
      .toHaveLength(1);
  });

  test('an authorized call records no denial at all', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin');

    await requireAdminPermission('shops.read', BASE_ENV, NO_ASSIGNMENT);

    expect(recentAdminAudit.entries().map((entry) => entry.action)).not.toContain('authz.denied');
  });

  test('a disabled row refuses every permission, including the ones it names', async () => {
    cookieStore.value = await cookieFor('founder', 'super_admin');
    const disabled = withAssignment(
      assignment({ username: 'founder', role: 'super_admin', isActive: false }),
    );

    for (const permission of ['shops.read', 'admins.write', 'audit.export'] as const) {
      await expect(requireAdminPermission(permission, BASE_ENV, disabled))
        .rejects.toBeInstanceOf(AdminUnauthenticatedError);
    }
  });
});

describe('every page is gated server-side (W4-07)', () => {
  // A page whose permission check is missing looks identical in review to one
  // that has it, and the nav hiding a link is NOT the gate: typing the URL
  // reaches the page directly. So the gate's presence is asserted in the source
  // of every page, with /login the one deliberate exception.
  const APP_ROOT = join(import.meta.dirname, '..', 'app');
  const PUBLIC_PAGES = new Set(['login/page.tsx']);

  function pages(directory: string): { path: string; contents: string }[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) return pages(absolute);
      if (entry.name !== 'page.tsx') return [];
      return [{
        path: relative(APP_ROOT, absolute).split(sep).join('/'),
        contents: readFileSync(absolute, 'utf8'),
      }];
    });
  }

  const PAGES = pages(APP_ROOT);

  test('finds every page', () => {
    // Batch 3 §8's ELEVEN pages, plus /accounts, /accounts/[id],
    // /shops/[id] and /payments — real routes that left the top-level nav and
    // lost no functionality — plus /login, the one public page.
    //
    // The list is spelled out rather than counted, so ADDING a page is a
    // deliberate edit here. A page that appeared without this test changing
    // would be a page nobody had checked the gate on.
    expect(PAGES.map((page) => page.path).sort()).toEqual([
      'accounts/[id]/page.tsx',
      'accounts/page.tsx',
      'admins/page.tsx',
      'analytics/page.tsx',
      'audit/page.tsx',
      'login/page.tsx',
      'maps/page.tsx',
      'page.tsx',
      'payments/page.tsx',
      'pharmacies/page.tsx',
      'reports/page.tsx',
      'revenue/page.tsx',
      'settings/page.tsx',
      'shops/[id]/page.tsx',
      'subscriptions/page.tsx',
      'support/page.tsx',
    ]);
  });

  test.each(PAGES.filter((page) => !PUBLIC_PAGES.has(page.path)).map((page) => page.path))(
    '%s calls requireAdminPermission',
    (path) => {
      const page = PAGES.find((candidate) => candidate.path === path);
      expect(page?.contents).toMatch(/await requireAdminPermission\('[a-z.]+'\)/);
    },
  );

  test('the gate comes BEFORE any data read on every gated page', () => {
    for (const page of PAGES.filter((candidate) => !PUBLIC_PAGES.has(candidate.path))) {
      const gate = page.contents.indexOf('requireAdminPermission');
      // Every loader a page can call. The list must grow with each new page,
      // or the assertion passes vacuously for exactly the page nobody checked.
      const loaders = ['listAccountSummaries(', 'listSubscriptionSummaries(', 'listPaymentOrderSummaries(',
        'getAccountDetail(', 'getShopDetail(', 'loadStats(', 'loadPharmacies(', 'recentAdminAudit.entries(',
        'loadMap(', 'loadSettings(', 'loadSupport(', 'loadReport(', 'loadRevenue(', 'loadAnalytics(',
        'loadAssignments(', 'listShopLocations(', 'listSupportCaseSummaries(', 'settingsView(',
        'revenueOverview(', 'analyticsOverview(', 'listRoleAssignments(', 'platformReportData(',
        // Batch 3 §8.1/§8.2/§8.3/§8.9 — the loaders the four extended pages add.
        'loadDashboard(', 'dashboardOverview(', 'getPlatformStats(', 'loadSubscriptions(',
        'subscriptionsOverview(', 'loadAudit(', 'listShopSupportNotes(', 'shopLocationFor('];
      for (const loader of loaders) {
        const read = page.contents.indexOf(loader);
        if (read < 0) continue;
        expect(gate, page.path + ' reads before it authorizes').toBeLessThan(read);
      }
    }
  });

  test('the two drill-downs validate their route parameter', () => {
    for (const path of ['accounts/[id]/page.tsx', 'shops/[id]/page.tsx']) {
      const page = PAGES.find((candidate) => candidate.path === path);
      expect(page?.contents).toMatch(/if \(!isUuid\(id\)\) notFound\(\)/);
    }
  });

  test('the login page performs no query and needs no permission', () => {
    const login = PAGES.find((page) => page.path === 'login/page.tsx');

    expect(login?.contents).not.toMatch(/requireAdminPermission/);
    expect(login?.contents).not.toMatch(/getSupabaseAdmin|list[A-Z]|get[A-Z][a-z]+Detail/);
  });
});
