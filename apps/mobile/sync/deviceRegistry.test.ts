import { FunctionsHttpError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  readDeviceSecret: vi.fn(),
  handleDeviceRevocation: vi.fn(),
  applyDeviceAuthority: vi.fn(),
  deviceEnrolmentMatches: vi.fn(),
  setSession: vi.fn(),
}));

vi.mock('../db/deviceRegistry', async (importOriginal) => {
  const original = await importOriginal<typeof import('../db/deviceRegistry')>();
  return {
    ...original,
    readDeviceSecret: mocks.readDeviceSecret,
    applyDeviceAuthority: mocks.applyDeviceAuthority,
    deviceEnrolmentMatches: mocks.deviceEnrolmentMatches,
    forgetDeviceEnrolment: vi.fn(),
    readDeviceAccessObjection: vi.fn(),
    readLocalDeviceRegistry: vi.fn(),
  };
});
vi.mock('../native/deviceId', () => ({ getDeviceId: () => 'installation-1' }));
vi.mock('./supabaseClient', () => ({
  requireSupabaseConfiguration: vi.fn(),
  supabase: {
    functions: { invoke: mocks.invoke },
    auth: { setSession: mocks.setSession },
  },
}));
vi.mock('./deviceRevocation', () => ({
  handleDeviceRevocation: mocks.handleDeviceRevocation,
}));

const {
  recordBoundInstallation,
  refreshDeviceAuthority,
  switchActorOnDevice,
} = await import('./deviceRegistry');

const AUTHORITY = {
  known: true,
  status: 'revoked',
  registryVersion: 7,
  enforced: false,
  bindings: [{ actorUserId: 'actor-1', status: 'active', bindingVersion: 2 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readDeviceSecret.mockResolvedValue('secret');
  mocks.handleDeviceRevocation.mockResolvedValue(undefined);
  mocks.applyDeviceAuthority.mockResolvedValue(true);
  mocks.deviceEnrolmentMatches.mockResolvedValue(false);
  mocks.setSession.mockResolvedValue({ error: null });
});

describe('credential-bound secret persistence', () => {
  const response = {
    deviceSecret: 'a'.repeat(64),
    deviceAuthority: {
      shopId: 'shop-1',
      devicePublicId: 'installation-1',
      known: true,
      status: 'active',
      registryVersion: 3,
      enforced: false,
      bindings: [{ actorUserId: 'actor-1', status: 'active', bindingVersion: 2 }],
    },
  };

  it('persists only a matching installation and active actor binding', async () => {
    await expect(recordBoundInstallation('shop-1', response, {
      required: true,
      expectedActorUserId: 'actor-1',
    })).resolves.toBe(true);
    expect(mocks.applyDeviceAuthority).toHaveBeenCalledWith(
      'shop-1',
      'installation-1',
      expect.objectContaining({ known: true, registryVersion: 3 }),
      { deviceSecret: 'a'.repeat(64) },
    );
  });

  it.each([
    ['wrong shop', { ...response, deviceAuthority: { ...response.deviceAuthority, shopId: 'other' } }],
    ['wrong device', { ...response, deviceAuthority: { ...response.deviceAuthority, devicePublicId: 'other' } }],
    ['wrong secret shape', { ...response, deviceSecret: 'not-a-server-secret' }],
    ['missing binding', {
      ...response,
      deviceAuthority: { ...response.deviceAuthority, bindings: [] },
    }],
  ])('fails closed for %s', async (_label, candidate) => {
    await expect(recordBoundInstallation('shop-1', candidate, {
      required: true,
      expectedActorUserId: 'actor-1',
    })).rejects.toThrow('securely save');
    expect(mocks.applyDeviceAuthority).not.toHaveBeenCalled();
  });

  it('fails closed when the secure mirror rejects or cannot persist the snapshot', async () => {
    mocks.applyDeviceAuthority.mockResolvedValueOnce(false);
    await expect(recordBoundInstallation('shop-1', response, { required: true }))
      .rejects.toThrow('securely save');

    mocks.applyDeviceAuthority.mockRejectedValueOnce(new Error('SQLCipher unavailable'));
    await expect(recordBoundInstallation('shop-1', response, { required: true }))
      .rejects.toThrow('SQLCipher unavailable');
  });

  // The hardware defect. applyDeviceAuthority answers `false` both for a write
  // that could not happen AND for a snapshot the monotonic guard correctly
  // discarded — and the second case leaves the handset properly enrolled. This
  // used to be reported to the person signing in as a failed login, which sent
  // them back to retype a phone number and made the server rotate the secret
  // again on every attempt.
  it('completes when the mirror already holds this exact enrolment', async () => {
    mocks.applyDeviceAuthority.mockResolvedValueOnce(false);
    mocks.deviceEnrolmentMatches.mockResolvedValueOnce(true);

    await expect(recordBoundInstallation('shop-1', response, {
      required: true,
      expectedActorUserId: 'actor-1',
    })).resolves.toBe(true);
    expect(mocks.deviceEnrolmentMatches).toHaveBeenCalledWith(
      'shop-1',
      'installation-1',
      'a'.repeat(64),
    );
  });

  it('still fails closed when the mirror holds a DIFFERENT secret', async () => {
    mocks.applyDeviceAuthority.mockResolvedValueOnce(false);
    mocks.deviceEnrolmentMatches.mockResolvedValueOnce(false);

    await expect(recordBoundInstallation('shop-1', response, { required: true }))
      .rejects.toThrow('securely save');
  });

  it('reports a legacy best-effort caller honestly instead of throwing', async () => {
    mocks.applyDeviceAuthority.mockResolvedValueOnce(false);
    mocks.deviceEnrolmentMatches.mockResolvedValueOnce(false);

    await expect(recordBoundInstallation('shop-1', response)).resolves.toBe(false);
  });
});

describe('unauthenticated actor-switch revocation', () => {
  it('persists and quarantines through the shared handler before rejecting', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(new Response(JSON.stringify({
        code: 'device_revoked',
        error: 'removed',
        authority: AUTHORITY,
      }), { status: 403, headers: { 'content-type': 'application/json' } })),
    });

    let handledBeforeReject = false;
    try {
      await switchActorOnDevice('shop-1', 'actor-1', '1234');
    } catch {
      handledBeforeReject = mocks.handleDeviceRevocation.mock.calls.length === 1;
    }
    expect(handledBeforeReject).toBe(true);
    expect(mocks.handleDeviceRevocation).toHaveBeenCalledWith(
      'shop-1', 'actor-1', 'device_revoked', AUTHORITY,
    );
  });

  it('does not turn a malformed revocation payload into a quarantine', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(new Response(JSON.stringify({
        code: 'device_revoked',
        error: 'removed',
        authority: {},
      }), { status: 403, headers: { 'content-type': 'application/json' } })),
    });
    mocks.handleDeviceRevocation.mockRejectedValueOnce(
      new Error('Authoritative device revocation omitted a valid snapshot.'),
    );

    await expect(switchActorOnDevice('shop-1', 'actor-1', '1234'))
      .rejects.toThrow(/omitted a valid snapshot/);
  });
});

describe('first PIN actor switch', () => {
  it('uses the secret read from the encrypted registry without phone fallback', async () => {
    mocks.readDeviceSecret.mockResolvedValueOnce('persisted-installation-secret');
    mocks.invoke.mockResolvedValueOnce({
      data: {
        shopId: 'shop-1',
        userId: 'actor-1',
        role: 'owner',
        accessToken: 'access',
        refreshToken: 'refresh',
      },
      error: null,
    });

    await switchActorOnDevice('shop-1', 'actor-1', '1234');
    expect(mocks.invoke).toHaveBeenCalledWith('sync', {
      body: {
        action: 'device-actor-switch',
        shopId: 'shop-1',
        devicePublicId: 'installation-1',
        deviceSecret: 'persisted-installation-secret',
        actorUserId: 'actor-1',
        pin: '1234',
      },
    });
  });
});

describe('registry response parsing', () => {
  it.each([null, {}, { known: false }, { bound: true }])(
    'treats malformed authority data as unavailable, never unbound: %#',
    async (data) => {
      mocks.invoke.mockResolvedValue({ data, error: null });
      await expect(refreshDeviceAuthority('shop-1')).resolves.toEqual({ kind: 'unavailable' });
    },
  );

  it('accepts only an explicit bound=false legacy response as unbound', async () => {
    mocks.invoke.mockResolvedValue({ data: { bound: false }, error: null });
    await expect(refreshDeviceAuthority('shop-1')).resolves.toEqual({ kind: 'unbound' });
  });
});
