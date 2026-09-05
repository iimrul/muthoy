import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { LinkDeviceServerError, linkDeviceToShop } from './linkDevice';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  refreshSession: vi.fn(),
  requireConfiguration: vi.fn(),
}));

vi.mock('./supabaseClient', () => ({
  requireSupabaseConfiguration: mocks.requireConfiguration,
  supabase: {
    functions: { invoke: mocks.invoke },
    auth: { refreshSession: mocks.refreshSession },
  },
}));

const SHOP_ID = 'shop-1';
const OWNER_ID = 'owner-1';
const FULL = {
  app_user_id: OWNER_ID,
  principal_user_id: OWNER_ID,
  shop_id: SHOP_ID,
  role: 'owner',
  permission_version: 1,
  billing_account_id: 'billing-1',
};

function token(appMetadata: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ app_metadata: appMetadata })}.sig`;
}

function refreshed(
  appMetadata: Record<string, unknown>,
  userShopId: string = SHOP_ID,
) {
  return {
    data: {
      session: {
        access_token: token(appMetadata),
        user: { app_metadata: { shop_id: userShopId } },
      },
    },
    error: null,
  };
}

describe('linkDeviceToShop Owner token postcondition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue({ data: {}, error: null });
    mocks.refreshSession.mockResolvedValue(refreshed(FULL));
  });

  it('accepts a complete matching Owner token and forwards ownerUserId', async () => {
    await expect(linkDeviceToShop(SHOP_ID, OWNER_ID)).resolves.toMatchObject({
      appUserId: OWNER_ID,
      principalUserId: OWNER_ID,
      shopId: SHOP_ID,
      role: 'owner',
      permissionVersion: 1,
      billingAccountId: 'billing-1',
    });
    expect(mocks.invoke).toHaveBeenCalledWith('sync', {
      body: { action: 'link-device', shopId: SHOP_ID, ownerUserId: OWNER_ID },
    });
    expect(mocks.refreshSession).toHaveBeenCalledOnce();
  });

  it('forwards the onboarding payload without changing normal calls', async () => {
    // Sent by EVERY new registration now, not just DEV: the server cannot read
    // the Owner back to write the binding unless this call creates it first.
    const onboarding = { safe: 'payload' };
    await linkDeviceToShop(
      SHOP_ID,
      OWNER_ID,
      { onboarding: onboarding as never },
    );
    expect(mocks.invoke).toHaveBeenCalledWith('sync', {
      body: {
        action: 'link-device',
        shopId: SHOP_ID,
        ownerUserId: OWNER_ID,
        onboarding,
      },
    });
  });

  it('surfaces the actual Edge status and allowlisted response body', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(new Response(
        JSON.stringify({ error: 'This account cannot be linked to that shop' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      )),
    });

    const failure = await linkDeviceToShop(SHOP_ID, OWNER_ID).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(LinkDeviceServerError);
    expect(failure).toMatchObject({
      status: 403,
      code: null,
      serverMessage: 'This account cannot be linked to that shop',
    });
    expect((failure as Error).message).toBe(
      'sync/link-device failed (HTTP 403): This account cannot be linked to that shop',
    );
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });

  it('requires ownerUserId before invoking link-device', async () => {
    await expect(linkDeviceToShop(SHOP_ID)).rejects.toThrow('Owner identity is required');
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });

  it.each([
    ['principal_user_id', { ...FULL, principal_user_id: undefined }, /principal_user_id/],
    ['billing_account_id', { ...FULL, billing_account_id: undefined }, /billing_account_id/],
    ['permission_version', { ...FULL, permission_version: undefined }, /permission_version/],
    ['Owner role', { ...FULL, role: 'staff' }, /role_not_owner/],
    ['matching shop_id', { ...FULL, shop_id: 'other-shop' }, /shop_id_mismatch/],
    ['matching app_user_id', { ...FULL, app_user_id: 'other-owner' }, /app_user_id_mismatch/],
  ])('rejects a refreshed token without %s', async (_label, metadata, message) => {
    mocks.refreshSession.mockResolvedValue(refreshed(metadata));
    await expect(linkDeviceToShop(SHOP_ID, OWNER_ID)).rejects.toThrow(message);
  });

  it('accepts permission_version 0', async () => {
    mocks.refreshSession.mockResolvedValue(refreshed({ ...FULL, permission_version: 0 }));
    await expect(linkDeviceToShop(SHOP_ID, OWNER_ID)).resolves.toMatchObject({ permissionVersion: 0 });
  });

  it('rejects a mismatched shop on the refreshed auth user row', async () => {
    mocks.refreshSession.mockResolvedValue(refreshed(FULL, 'other-shop'));
    await expect(linkDeviceToShop(SHOP_ID, OWNER_ID)).rejects.toThrow('does not contain the linked shop');
  });

  it('never exposes expected identifiers in validation errors', async () => {
    mocks.refreshSession.mockResolvedValue(refreshed({ ...FULL, app_user_id: 'other-owner' }));
    const error = await linkDeviceToShop(SHOP_ID, OWNER_ID).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(OWNER_ID);
    expect((error as Error).message).not.toContain(SHOP_ID);
  });
});
