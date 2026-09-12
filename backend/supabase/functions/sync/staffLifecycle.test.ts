import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Caller, CallerRecord } from './_shared/auth.ts';

const mocks = vi.hoisted(() => ({ assertCurrent: vi.fn(), rpc: vi.fn() }));
vi.mock('./_shared/auth.ts', async (original) => {
  const actual = await original<typeof import('./_shared/auth.ts')>();
  return { ...actual, assertCallerCurrent: mocks.assertCurrent };
});
vi.mock('./_shared/supabaseAdmin.ts', () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import { reactivateStaff } from './staffLifecycle.ts';

const caller = { appUserId: 'owner-a', shopId: 'shop-a' } as Caller;
const owner = {
  appUserId: 'owner-a', shopId: 'shop-a', isOwner: true,
} as CallerRecord;
const validBody = {
  shopId: '11111111-1111-4111-8111-111111111111',
  staffUserId: '22222222-2222-4222-8222-222222222222',
  operationId: '33333333-3333-4333-8333-333333333333',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCurrent.mockResolvedValue({ ...owner, shopId: validBody.shopId });
  mocks.rpc.mockResolvedValue({ data: { replayed: false }, error: null });
});

describe('staff-reactivate Edge authorization', () => {
  it('passes only server-derived Owner identity to the narrow RPC', async () => {
    await expect(reactivateStaff(caller, validBody)).resolves.toEqual({ replayed: false });
    expect(mocks.rpc).toHaveBeenCalledWith('h7_reactivate_staff', {
      p_owner_user_id: 'owner-a',
      p_shop_id: validBody.shopId,
      p_staff_user_id: validBody.staffUserId,
      p_operation_id: validBody.operationId,
    });
  });

  it.each([
    [{ ...owner, isOwner: false, shopId: validBody.shopId }],
    [{ ...owner, shopId: 'foreign-shop' }],
  ])('rejects non-Owner or foreign-shop callers before RPC', async (record) => {
    mocks.assertCurrent.mockResolvedValue(record);
    await expect(reactivateStaff(caller, validBody)).rejects.toMatchObject({
      status: 403, code: 'owner_required',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
