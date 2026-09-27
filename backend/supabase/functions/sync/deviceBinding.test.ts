import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./_shared/supabaseAdmin.ts', () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

const {
  prepareInstallationEnrollment,
  tryBindSession,
} = await import('./deviceBinding.ts');

const SHOP = '10000000-0000-4000-8000-000000000001';
const ACTOR = '10000000-0000-4000-8000-000000000002';

function decision(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      allowed: true,
      held: false,
      enforced: false,
      legacyUnbound: false,
      ...overrides,
    },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue(decision());
});

describe('credential-flow enrollment preflight', () => {
  it('refuses an omitted devicePublicId from an A2.3-capable device-login/recovery', async () => {
    await expect(prepareInstallationEnrollment(SHOP, ACTOR, {
      deviceRegistryVersion: 1,
    })).rejects.toMatchObject({ status: 400, code: 'device_id_required' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('preserves only the explicit unenforced legacy-unbound case', async () => {
    mocks.rpc.mockResolvedValueOnce(decision({ legacyUnbound: true }));
    await expect(prepareInstallationEnrollment(SHOP, ACTOR, {})).resolves.toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith('a23_prepare_enrollment', {
      p_shop_id: SHOP,
      p_actor_user_id: ACTOR,
      p_device_public_id: null,
    });
  });

  it('fails closed for a missing legacy id once shop enforcement applies', async () => {
    mocks.rpc.mockResolvedValueOnce(decision({
      allowed: false,
      enforced: true,
      legacyUnbound: true,
    }));
    await expect(prepareInstallationEnrollment(SHOP, ACTOR, {}))
      .rejects.toMatchObject({ status: 403, code: 'device_session_unbound' });
  });

  it('blocks a revoked actor on a fresh id and records that exact pending id', async () => {
    mocks.rpc.mockResolvedValueOnce(decision({ allowed: false, held: true }));
    await expect(prepareInstallationEnrollment(SHOP, ACTOR, {
      deviceRegistryVersion: 1,
      devicePublicId: 'replacement-installation',
    })).rejects.toMatchObject({ status: 403, code: 'device_enrollment_held' });
    expect(mocks.rpc).toHaveBeenCalledWith('a23_prepare_enrollment', {
      p_shop_id: SHOP,
      p_actor_user_id: ACTOR,
      p_device_public_id: 'replacement-installation',
    });
  });

  it('admits an approved/non-held current installation and returns its labels', async () => {
    await expect(prepareInstallationEnrollment(SHOP, ACTOR, {
      deviceRegistryVersion: 1,
      devicePublicId: 'replacement-installation',
      model: 'A14',
    })).resolves.toMatchObject({
      devicePublicId: 'replacement-installation',
      model: 'A14',
    });
  });

  it.each([null, {}, { allowed: true }])(
    'treats malformed preflight data as unavailable %#',
    async (data) => {
      mocks.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(prepareInstallationEnrollment(SHOP, ACTOR, {
        deviceRegistryVersion: 1,
        devicePublicId: 'replacement-installation',
      })).rejects.toMatchObject({ status: 503, code: 'device_gate_unavailable' });
    },
  );
});

describe('binding never silently degrades a current client', () => {
  it('propagates a held bind instead of returning an unbound session', async () => {
    mocks.rpc
      .mockResolvedValueOnce(decision())
      .mockResolvedValueOnce({ data: null, error: { code: 'MU070' } });
    await expect(tryBindSession(
      '10000000-0000-4000-8000-000000000003',
      SHOP,
      ACTOR,
      { deviceRegistryVersion: 1, devicePublicId: 'replacement-installation' },
    )).rejects.toMatchObject({ status: 403, code: 'device_enrollment_held' });
  });
});
