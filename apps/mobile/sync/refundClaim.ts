import type { RefundServerClaim } from '../db/refunds';
import { getDeviceId } from '../native/deviceId';
import { invokeSyncWithClaimRefresh } from './invoke';

export interface ClaimRefundAuthorityInput {
  shopId: string;
  saleId: string;
  operationId: string;
  deviceId?: string;
}

/**
 * How long the refund screen waits for the server before saying the refund did
 * not happen. Without it a network drop held "Asking for permission…" for about
 * three minutes on device (2026-11-26). A late answer is harmless: the server
 * keeps one claim per sale and hands the SAME claim back to the same device,
 * actor and operation (sync_claim_refund), and the operation id is fixed per
 * sale, so retrying can never produce a second refund.
 */
export const REFUND_CLAIM_TIMEOUT_MS = 20_000;

export class RefundClaimTimeoutError extends Error {
  constructor() {
    super('The refund claim got no answer in time.');
    this.name = 'RefundClaimTimeoutError';
  }
}

/** Online-only authority gate. Call before any physical payout or local refund mutation. */
export async function claimRefundAuthority(
  input: ClaimRefundAuthorityInput,
  options: { timeoutMs?: number } = {},
): Promise<RefundServerClaim> {
  const deviceId = input.deviceId ?? getDeviceId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? REFUND_CLAIM_TIMEOUT_MS);
  let result: Awaited<ReturnType<typeof invokeSyncWithClaimRefresh>>;
  try {
    result = await invokeSyncWithClaimRefresh({
      action: 'refund-claim',
      shopId: input.shopId,
      saleId: input.saleId,
      operationId: input.operationId,
      deviceId,
    }, { signal: controller.signal });
  } catch (caught) {
    if (controller.signal.aborted) throw new RefundClaimTimeoutError();
    throw caught;
  } finally {
    clearTimeout(timer);
  }
  const { data, error } = result;
  if (error) {
    if (controller.signal.aborted) throw new RefundClaimTimeoutError();
    throw error;
  }
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
