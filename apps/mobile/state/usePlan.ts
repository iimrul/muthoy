import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getEffectiveEntitlementForShop, subscribeCommercialCache } from '../db/commercial';
import {
  accessDaysRemaining,
  displayPlanForEntitlement,
  type AccessReason,
  type DisplayPlan,
  type EntitlementStatus,
  type PlanTier,
} from '../domain/entitlements';
import { subscribeToSyncCompletion } from '../sync';
import { useSessionStore } from './sessionStore';

export type Plan = DisplayPlan;
export interface PlanInfo {
  plan: Plan;
  effectiveTier: PlanTier;
  status: EntitlementStatus | 'unknown';
  reason: AccessReason | 'unverified';
  trialEndsAt?: string;
  accessEndsAt?: string;
  validUntil?: string;
  daysLeft?: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

const fallback = { plan: 'free' as const, effectiveTier: 'free' as const, status: 'unknown' as const, reason: 'unverified' as const, loading: true };

export function usePlan(): PlanInfo {
  const shopId = useSessionStore((state) => state.session?.shopId);
  const [state, setState] = useState<Omit<PlanInfo, 'refresh'>>(fallback);
  const refresh = useCallback(async () => {
    if (!shopId) { setState({ ...fallback, loading: false }); return; }
    const effective = await getEffectiveEntitlementForShop(shopId);
    if (!effective) { setState({ ...fallback, loading: false }); return; }
    const isTrial = effective.reason === 'trial';
    const daysLeft = accessDaysRemaining(effective.accessEndsAt);
    setState({
      plan: displayPlanForEntitlement(effective),
      effectiveTier: effective.effectiveTier,
      status: effective.status,
      reason: effective.reason,
      trialEndsAt: isTrial ? effective.accessEndsAt ?? undefined : undefined,
      accessEndsAt: effective.accessEndsAt ?? undefined,
      validUntil: effective.offlineValidUntil,
      daysLeft,
      loading: false,
    });
  }, [shopId]);
  useEffect(() => {
    // Session/cache changes are external triggers for the SQLite entitlement read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const unsubCache = subscribeCommercialCache(() => void refresh());
    const unsubSync = shopId ? subscribeToSyncCompletion(shopId, refresh) : undefined;
    return () => { unsubCache(); unsubSync?.(); };
  }, [refresh, shopId]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    const deadline = state.validUntil ? Date.parse(state.validUntil) : Number.NaN;
    const delay = Number.isFinite(deadline)
      ? Math.min(2_147_000_000, Math.max(0, deadline - Date.now() + 50))
      : null;
    const timer = delay === null ? null : setTimeout(() => void refresh(), delay);
    return () => { subscription.remove(); if (timer) clearTimeout(timer); };
  }, [refresh, state.validUntil]);
  return { ...state, refresh };
}
