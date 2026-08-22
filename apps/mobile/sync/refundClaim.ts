import type { RefundServerClaim } from '../db/refunds';
import { getDeviceId } from '../native/deviceId';
import { invokeSyncWithClaimRefresh } from './invoke';

export interface ClaimRefundAuthorityInput {
  shopId: string;
  saleId: string;
  operationId: string;
  deviceId?: string;
}

/** Online-only authority gate. Call before any physical payout or local refund mutation. */
export async function claimRefundAuthority(
  input: ClaimRefundAuthorityInput,
): Promise<RefundServerClaim> {
  const deviceId = input.deviceId ?? getDeviceId();
  const { data, error } = await invokeSyncWithClaimRefresh({
    action: 'refund-claim',
    shopId: input.shopId,
    saleId: input.saleId,
    operationId: input.operationId,
    deviceId,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Refund claim returned an invalid response.');
  }
  const claim = data as Record<string, unknown>;
  if (typeof claim.claimId !== 'string' || typeof claim.claimToken !== 'string'
    || claim.operationId !== input.operationId || claim.deviceId !== deviceId) {
    throw new Error('Refund claim returned invalid authority.');
  }
  return {
    claimId: claim.claimId,
    claimToken: claim.claimToken,
    operationId: input.operationId,
    deviceId,
  };
}
