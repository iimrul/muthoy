// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const commercial = vi.hoisted(() => ({
  readMultiShopContext: vi.fn(),
  subscribeCommercialCache: vi.fn(() => () => undefined),
}));
vi.mock('../db/commercial', () => ({
  readMultiShopContext: commercial.readMultiShopContext,
  subscribeCommercialCache: commercial.subscribeCommercialCache,
}));

const { useSessionStore } = await import('./sessionStore');
const { useMultiShopAccess } = await import('./useMultiShopAccess');

const OWNER_SESSION = { shopId: 'shop-1', userId: 'owner-1', role: 'owner' as const };
const STAFF_SESSION = { shopId: 'shop-1', userId: 'staff-1', role: 'staff' as const };
const MANAGER_SESSION = { shopId: 'shop-1', userId: 'manager-1', role: 'manager' as const };

afterEach(cleanup);

describe('useMultiShopAccess role-gated reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commercial.readMultiShopContext.mockResolvedValue({ entitled: true, primaryShopId: 'shop-1', liveShopCount: 2 });
  });

  it.each([
    ['Staff', STAFF_SESSION],
    ['Manager', MANAGER_SESSION],
  ])('never reads owner-wide multi-shop context for %s', async (_label, session) => {
    useSessionStore.setState({ session, epoch: 0 });
    const { result } = renderHook(() => useMultiShopAccess());

    // No async settling to wait on — a denied role resolves synchronously to
    // DENIED without ever calling into SQLite.
    expect(result.current).toMatchObject({ allowed: false, entitled: false, loading: false });
    expect(commercial.readMultiShopContext).not.toHaveBeenCalled();
    expect(commercial.subscribeCommercialCache).not.toHaveBeenCalled();
  });

  it('reads owner-wide context for an Owner session', async () => {
    useSessionStore.setState({ session: OWNER_SESSION, epoch: 0 });
    const { result } = renderHook(() => useMultiShopAccess());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(commercial.readMultiShopContext).toHaveBeenCalledWith('shop-1');
    expect(result.current).toMatchObject({ allowed: true, entitled: true, hasMultipleShops: true });
  });

  it('stops reading and re-denies immediately when the session switches from Owner to Staff', async () => {
    useSessionStore.setState({ session: OWNER_SESSION, epoch: 0 });
    const { result, rerender } = renderHook(() => useMultiShopAccess());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(commercial.readMultiShopContext).toHaveBeenCalledTimes(1);

    act(() => useSessionStore.setState({ session: STAFF_SESSION, epoch: 0 }));
    rerender();

    expect(result.current).toMatchObject({ allowed: false, entitled: false, loading: false });
    // Still exactly one call — from the earlier Owner render. The role switch
    // itself triggers no new read.
    expect(commercial.readMultiShopContext).toHaveBeenCalledTimes(1);
  });
});
