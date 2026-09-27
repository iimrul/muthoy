import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Caller } from './_shared/auth.ts';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./_shared/supabaseAdmin.ts', () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

const {
  assertDeviceAuthority,
  assertSessionMayBindInstallation,
  blockedShopsForSession,
  isDeviceGuardedAction,
} = await import('./deviceGuard.ts');

const caller = {
  authUserId: 'auth-1',
  appUserId: 'actor-1',
  principalUserId: 'principal-1',
  billingAccountId: 'account-1',
  shopId: 'shop-1',
  role: 'owner',
  permissionVersion: 1,
  authSessionId: 'session-1',
  freshPhoneOtp: null,
  isAnonymous: false,
  email: null,
  emailConfirmedAt: null,
  raw: { app_metadata: {} },
} as unknown as Caller;

const ACTIVE_AUTHORITY = {
  known: true,
  status: 'active',
  registryVersion: 3,
  enforced: false,
  bindings: [{ actorUserId: 'actor-1', status: 'active', bindingVersion: 2 }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('device gate RPC boundary', () => {
  it.each(['shop-switch', 'shop-create'])(
    'executes the shared runtime guard predicate for %s',
    (action) => expect(isDeviceGuardedAction(action)).toBe(true),
  );

  it('accepts only the explicit legacy-unbound shape while enforcement is off', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        bound: false,
        enforced: false,
        deviceStatus: null,
        bindingStatus: null,
        authority: null,
      },
      error: null,
    });
    await expect(assertDeviceAuthority(caller)).resolves.toBeUndefined();
  });

  it.each([
    null,
    {},
    { bound: false },
    { bound: false, enforced: false, deviceStatus: null, bindingStatus: null },
    {
      bound: true,
      enforced: false,
      deviceStatus: 'active',
      bindingStatus: 'active',
      authority: {},
    },
    {
      bound: true,
      enforced: false,
      deviceStatus: 'invented',
      bindingStatus: 'active',
      authority: ACTIVE_AUTHORITY,
    },
  ])('fails closed on malformed gate data %#', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(assertDeviceAuthority(caller)).rejects.toMatchObject({
      status: 503,
      code: 'device_gate_unavailable',
    });
  });

  it('preserves a valid authoritative revocation and its snapshot', async () => {
    const authority = { ...ACTIVE_AUTHORITY, status: 'revoked', registryVersion: 4 };
    mocks.rpc.mockResolvedValue({
      data: {
        bound: true,
        enforced: false,
        deviceStatus: 'revoked',
        bindingStatus: 'active',
        authority,
      },
      error: null,
    });
    await expect(assertDeviceAuthority(caller)).rejects.toMatchObject({
      status: 403,
      code: 'device_revoked',
      details: { authority },
    });
  });
});

describe('cross-shop RPC boundary', () => {
  it.each([null, {}, 'shop-1', ['shop-2']])(
    'fails closed on malformed or unexpected blocked-shop data %#',
    async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      await expect(blockedShopsForSession(caller, ['shop-1'])).rejects.toMatchObject({
        status: 503,
        code: 'device_gate_unavailable',
      });
    },
  );

  it('returns only a validated target-shop set', async () => {
    mocks.rpc.mockResolvedValue({ data: ['shop-1'], error: null });
    await expect(blockedShopsForSession(caller, ['shop-1']))
      .resolves.toEqual(new Set(['shop-1']));
  });
});

describe('credential flow cannot route around an existing revocation', () => {
  it('allows an explicit unbound session after the enclosing flow proved a credential', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        bound: false,
        enforced: true,
        deviceStatus: null,
        bindingStatus: null,
        authority: null,
      },
      error: null,
    });
    await expect(assertSessionMayBindInstallation(caller, 'shop-1', 'actor-1'))
      .resolves.toBeUndefined();
  });

  it('rejects a bound revoked session even while enforcement is off', async () => {
    const authority = { ...ACTIVE_AUTHORITY, status: 'revoked', registryVersion: 4 };
    mocks.rpc.mockResolvedValue({
      data: {
        bound: true,
        enforced: false,
        deviceStatus: 'revoked',
        bindingStatus: 'active',
        authority,
      },
      error: null,
    });
    await expect(assertSessionMayBindInstallation(caller, 'shop-1', 'actor-1'))
      .rejects.toMatchObject({ status: 403, code: 'device_revoked' });
  });
});
