import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { linkDeviceToShop } from './linkDevice';

describe('linkDeviceToShop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue({ data: {}, error: null });
  });

  it('refreshes the JWT and verifies the linked shop claim', async () => {
    mocks.refreshSession.mockResolvedValue({
      data: { session: { user: { app_metadata: { shop_id: 'shop-1' } } } },
      error: null,
    });

    await linkDeviceToShop('shop-1');

    expect(mocks.invoke).toHaveBeenCalledWith('sync', {
      body: { action: 'link-device', shopId: 'shop-1' },
    });
    expect(mocks.refreshSession).toHaveBeenCalledOnce();
  });

  it('rejects a refreshed JWT without the linked shop claim', async () => {
    mocks.refreshSession.mockResolvedValue({
      data: { session: { user: { app_metadata: {} } } },
      error: null,
    });

    await expect(linkDeviceToShop('shop-1')).rejects.toThrow('does not contain the linked shop');
  });
});
