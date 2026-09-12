import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('./supabaseClient', () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));

// eslint-disable-next-line import/first
import { inspectCloudActorBinding } from './authActorBinding';

function token(actorUserId: string, shopId: string): string {
  const payload = Buffer.from(JSON.stringify({
    app_metadata: { app_user_id: actorUserId, shop_id: shopId },
  })).toString('base64url');
  return `header.${payload}.signature`;
}

beforeEach(() => vi.clearAllMocks());

describe('cloud/local actor binding', () => {
  it('matches only the exact actor and shop pair', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: token('owner-a', 'shop-a') } },
      error: null,
    });
    await expect(inspectCloudActorBinding({ userId: 'owner-a', shopId: 'shop-a' }))
      .resolves.toEqual({ status: 'matched', actorUserId: 'owner-a', shopId: 'shop-a' });
  });

  it('detects the retained Staff JWT after an Owner local handover', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: token('revoked-staff', 'shop-a') } },
      error: null,
    });
    await expect(inspectCloudActorBinding({ userId: 'owner-a', shopId: 'shop-a' }))
      .resolves.toEqual({
        status: 'mismatched', actorUserId: 'revoked-staff', shopId: 'shop-a',
      });
  });

  it('fails closed for a cross-shop or missing cloud identity', async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { access_token: token('owner-a', 'shop-b') } }, error: null,
    });
    await expect(inspectCloudActorBinding({ userId: 'owner-a', shopId: 'shop-a' }))
      .resolves.toMatchObject({ status: 'mismatched', shopId: 'shop-b' });

    mocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(inspectCloudActorBinding({ userId: 'owner-a', shopId: 'shop-a' }))
      .resolves.toEqual({ status: 'missing', actorUserId: null, shopId: null });
  });
});
