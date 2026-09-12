import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  inspectBinding: vi.fn(),
  invoke: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  generateId: vi.fn(() => 'operation-1'),
  session: null as null | { shopId: string; userId: string; role: string },
}));

vi.mock('../db/staff', () => ({ isStaffAuthoritativelyActive: mocks.active }));
vi.mock('../native/id', () => ({ generateId: mocks.generateId }));
vi.mock('../state/sessionStore', () => ({
  useSessionStore: { getState: () => ({ session: mocks.session }) },
}));
vi.mock('./authActorBinding', () => ({
  inspectCloudActorBinding: mocks.inspectBinding,
  assertCloudActorBinding: (binding: { status: string }) => {
    if (binding.status !== 'matched') throw new Error('Cloud actor mismatch');
  },
}));
vi.mock('./invoke', () => ({ invokeSyncWithClaimRefresh: mocks.invoke }));
vi.mock('./pull', () => ({ pullChanges: mocks.pull }));
vi.mock('./push', () => ({ pushPendingRows: mocks.push }));

// eslint-disable-next-line import/first
import { reactivateStaffOnServer } from './staffReactivation';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { shopId: 'shop-a', userId: 'owner-a', role: 'owner' };
  mocks.inspectBinding.mockResolvedValue({
    status: 'matched', actorUserId: 'owner-a', shopId: 'shop-a',
  });
  mocks.invoke.mockResolvedValue({ data: { replayed: false }, error: null });
  mocks.pull.mockResolvedValue(undefined);
  mocks.push.mockResolvedValue(true);
  mocks.active.mockResolvedValue(true);
});

describe('server-authoritative Staff reactivation', () => {
  it('calls Owner RPC, then full hydration, then proves the local row active', async () => {
    await reactivateStaffOnServer('shop-a', 'staff-a', () => true);

    expect(mocks.invoke).toHaveBeenCalledWith({
      action: 'staff-reactivate',
      shopId: 'shop-a',
      staffUserId: 'staff-a',
      operationId: 'operation-1',
    });
    expect(mocks.push).toHaveBeenCalledWith('shop-a', expect.any(Function));
    expect(mocks.push).toHaveBeenCalledBefore(mocks.invoke);
    expect(mocks.invoke).toHaveBeenCalledBefore(mocks.pull);
    expect(mocks.pull).toHaveBeenCalledWith('shop-a', null, expect.any(Function));
    expect(mocks.pull).toHaveBeenCalledBefore(mocks.active);
    expect(mocks.active).toHaveBeenCalledWith('shop-a', 'staff-a');
  });

  it('never hydrates or changes local truth after RPC denial', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('Owner access only') });
    await expect(reactivateStaffOnServer('shop-a', 'staff-a', () => true))
      .rejects.toThrow(/Owner access only/);
    expect(mocks.pull).not.toHaveBeenCalled();
    expect(mocks.active).not.toHaveBeenCalled();
  });

  it('does not call reactivation while a pending deactivation cannot sync', async () => {
    mocks.push.mockResolvedValue(false);
    await expect(reactivateStaffOnServer('shop-a', 'staff-a', () => true))
      .rejects.toThrow(/Pending changes must sync/);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.pull).not.toHaveBeenCalled();
  });

  it('blocks a mismatched Staff JWT before the reactivation RPC', async () => {
    mocks.inspectBinding.mockResolvedValue({
      status: 'mismatched', actorUserId: 'staff-a', shopId: 'shop-a',
    });
    await expect(reactivateStaffOnServer('shop-a', 'staff-a', () => true))
      .rejects.toThrow(/Cloud actor mismatch/);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('rejects non-Owner and cross-shop local actors before network work', async () => {
    mocks.session = { shopId: 'shop-a', userId: 'staff-a', role: 'staff' };
    await expect(reactivateStaffOnServer('shop-a', 'staff-b', () => true))
      .rejects.toThrow(/Owner access only/);
    mocks.session = { shopId: 'shop-b', userId: 'owner-b', role: 'owner' };
    await expect(reactivateStaffOnServer('shop-a', 'staff-a', () => true))
      .rejects.toThrow(/Owner access only/);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
