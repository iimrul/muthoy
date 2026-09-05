import type { Paisa } from '@muthoy/types';
import { priceFor, type BillingCycle, type PlanTier } from '../domain/entitlements';
import { useSessionStore } from '../state/sessionStore';
import {
  cacheCommercialSnapshot,
  createPaymentAttempt,
  getBillingAccountIdForShop,
  updatePaymentAttempt,
  updatePaymentAttemptByServerOrder,
  type ServerCommercialSnapshot,
} from '../db/commercial';
import { invokeSyncWithClaimRefresh } from './invoke';
import { requireSupabaseConfiguration } from './supabaseClient';

interface BillingStatusResponse extends ServerCommercialSnapshot {
  order: { id: string; status: 'created' | 'pending' | 'verified' | 'failed' | 'canceled' | 'expired'; failure_code: string | null } | null;
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid billing response');
  return value as Record<string, unknown>;
}

export interface BillingRefreshOptions {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
}

export class StaleBillingRefreshError extends Error {
  constructor() {
    super('Billing response belongs to a stale session.');
    this.name = 'StaleBillingRefreshError';
  }
}

function assertCurrent(options?: BillingRefreshOptions): void {
  if (options?.isCurrent && !options.isCurrent()) throw new StaleBillingRefreshError();
}

export async function refreshBillingStatus(
  shopId: string,
  orderId?: string,
  options?: BillingRefreshOptions,
): Promise<BillingStatusResponse> {
  const startingSession = useSessionStore.getState();
  const isCurrent = options?.isCurrent ?? (() => {
    const current = useSessionStore.getState();
    return current.epoch === startingSession.epoch
      && current.session?.shopId === shopId;
  });
  const guardedOptions = { ...options, isCurrent };

  assertCurrent(guardedOptions);
  requireSupabaseConfiguration();
  const { data, error } = await invokeSyncWithClaimRefresh(
    { action: 'billing-status', ...(orderId ? { orderId } : {}) },
    { signal: options?.signal },
  );
  assertCurrent(guardedOptions);
  if (error) throw error;
  const result = requireObject(data) as unknown as BillingStatusResponse;
  if (!result.account || !result.entitlement || !Array.isArray(result.memberships) || !Array.isArray(result.shops)) {
    throw new Error('Invalid billing response');
  }
  await cacheCommercialSnapshot(result, isCurrent);
  assertCurrent(guardedOptions);
  if (result.order && orderId) {
    await updatePaymentAttemptByServerOrder(orderId, {
      status: result.order.status,
      failureCode: result.order.failure_code,
    });
    assertCurrent(guardedOptions);
  }
  return result;
}

export async function initiatePlanPayment(input: {
  shopId: string;
  tier: Exclude<PlanTier, 'free'>;
  billingCycle: BillingCycle;
}): Promise<{ localAttemptId: string; orderId: string; checkoutUrl: string }> {
  const billingAccountId = await getBillingAccountIdForShop(input.shopId);
  if (!billingAccountId) throw new Error('Connect to the internet to verify plan access first');
  const amountPaisa = priceFor(input.tier, input.billingCycle) as Paisa;
  const local = await createPaymentAttempt({ ...input, billingAccountId, amountPaisa });
  const { data, error } = await invokeSyncWithClaimRefresh({
    action: 'billing-init', tier: input.tier, billingCycle: input.billingCycle,
    clientRequestId: local.clientRequestId,
  });
  if (error) {
    await updatePaymentAttempt(local.id, { status: 'failed', failureCode: 'request_failed' });
    throw error;
  }
  const result = requireObject(data);
  if (typeof result.orderId !== 'string' || typeof result.checkoutUrl !== 'string') {
    await updatePaymentAttempt(local.id, { status: 'failed', failureCode: 'invalid_response' });
    throw new Error('Payment provider did not return a checkout URL');
  }
  await updatePaymentAttempt(local.id, {
    serverOrderId: result.orderId,
    status: 'pending',
    checkoutUrl: result.checkoutUrl,
    expiresAt: typeof result.expiresAt === 'string' ? result.expiresAt : null,
  });
  return { localAttemptId: local.id, orderId: result.orderId, checkoutUrl: result.checkoutUrl };
}

export async function recordPlanPaymentTerminal(
  orderId: string,
  status: 'failed' | 'canceled',
): Promise<void> {
  const { error } = await invokeSyncWithClaimRefresh({ action: 'billing-terminal', orderId, status });
  if (error) throw error;
  await updatePaymentAttemptByServerOrder(orderId, {
    status,
    failureCode: status === 'canceled' ? 'client_canceled' : 'client_reported_failed',
  });
}
