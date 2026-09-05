import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  MAX_OFFLINE_VERIFICATION_DAYS,
  PLAN_OFFERINGS,
  accessDaysRemaining,
  canUseFeature,
  displayPlanForEntitlement,
  partitionByPlanLimit,
  priceFor,
  resolveEntitlement,
  type EntitlementSnapshot,
  type PremiumFeature,
} from './entitlements';

const now = new Date('2026-08-31T12:00:00.000Z');
const isoAfter = (days: number) => new Date(now.getTime() + days * DAY_MS).toISOString();
const base: EntitlementSnapshot = {
  billingAccountId: 'billing-1', tier: 'pro', status: 'active', trialEndsAt: null,
  paidThrough: isoAfter(20), graceEndsAt: isoAfter(27), verifiedAt: now.toISOString(), version: 1,
};

describe('B4 entitlement contract', () => {
  it('locks prototype prices as integer paisa', () => {
    expect(PLAN_OFFERINGS.free.monthlyPaisa).toBe(0);
    expect(priceFor('pro', 'monthly')).toBe(39_900);
    expect(priceFor('pro', 'annual')).toBe(383_000);
    expect(priceFor('ultra', 'monthly')).toBe(49_900);
    expect(priceFor('ultra', 'annual')).toBe(479_000);
  });

  it('locks Free, Pro, and Ultra limits', () => {
    expect(PLAN_OFFERINGS.free).toMatchObject({ maxActiveShops: 1, maxActiveNonOwnerStaffPerShop: 1 });
    expect(PLAN_OFFERINGS.pro).toMatchObject({ maxActiveShops: 3, maxActiveNonOwnerStaffPerShop: 4 });
    expect(PLAN_OFFERINGS.ultra).toMatchObject({ maxActiveShops: null, maxActiveNonOwnerStaffPerShop: null });
  });

  it('makes the active trial Ultra-equivalent and gives it no grace', () => {
    const trial = { ...base, tier: 'free' as const, status: 'trialing' as const, trialEndsAt: isoAfter(1), paidThrough: null, graceEndsAt: null };
    const active = resolveEntitlement(trial, now);
    expect(active.effectiveTier).toBe('ultra');
    expect(active.reason).toBe('trial');
    expect(active.commercialTier).toBe('free');
    expect(displayPlanForEntitlement(active)).toBe('trial');
    const features: PremiumFeature[] = ['multi_shop','supplier_invoices','expenses','reports','export','printer','extra_staff'];
    expect(features.every((feature) => canUseFeature(active.effectiveTier, feature))).toBe(true);
    const expired = resolveEntitlement(trial, new Date(isoAfter(1)));
    expect(expired.reason).toBe('trial_ended');
    expect(expired.effectiveTier).toBe('free');
    expect(expired.premium).toBe(false);
    expect(displayPlanForEntitlement(expired)).toBe('free');
  });

  it('reports the trial countdown from the verified server end timestamp', () => {
    expect(accessDaysRemaining(isoAfter(14), now)).toBe(14);
    expect(accessDaysRemaining(new Date(now.getTime() + 13 * DAY_MS + 1).toISOString(), now)).toBe(14);
    expect(accessDaysRemaining(now.toISOString(), now)).toBe(0);
    expect(accessDaysRemaining(null, now)).toBeUndefined();
  });

  it('honors active paid access and the separately bounded paid grace', () => {
    expect(resolveEntitlement(base, now).reason).toBe('paid');
    expect(resolveEntitlement({ ...base, status: 'past_due', paidThrough: isoAfter(-1) }, now).reason).toBe('paid_grace');
    expect(resolveEntitlement({ ...base, status: 'past_due', paidThrough: isoAfter(-8), graceEndsAt: isoAfter(-1) }, now).effectiveTier).toBe('free');
  });

  it('keeps canceled paid access only through paid-through time', () => {
    expect(resolveEntitlement({ ...base, status: 'canceled' }, now).effectiveTier).toBe('pro');
    expect(resolveEntitlement({ ...base, status: 'canceled', paidThrough: isoAfter(-1) }, now).effectiveTier).toBe('free');
  });

  it('fails closed when offline verification is older than 30 days', () => {
    const stale = { ...base, verifiedAt: new Date(now.getTime() - (MAX_OFFLINE_VERIFICATION_DAYS + 1) * DAY_MS).toISOString() };
    expect(resolveEntitlement(stale, now, 'offline').reason).toBe('verification_stale');
    expect(resolveEntitlement(stale, now, 'online').reason).toBe('paid');
  });

  it('never lets malformed snapshots unlock premium', () => {
    expect(resolveEntitlement({ ...base, verifiedAt: 'not-a-date' }, now).effectiveTier).toBe('free');
    expect(resolveEntitlement({ ...base, status: 'trialing', trialEndsAt: null }, now).effectiveTier).toBe('free');
  });

  it('gates every prototype premium feature on Free and enables Pro/Ultra', () => {
    const features: PremiumFeature[] = ['multi_shop','supplier_invoices','expenses','reports','export','printer','extra_staff'];
    for (const feature of features) {
      expect(canUseFeature('free', feature)).toBe(false);
      expect(canUseFeature('pro', feature)).toBe(true);
      expect(canUseFeature('ultra', feature)).toBe(true);
    }
  });

  it('selects downgrade survivors deterministically without deleting data', () => {
    const result = partitionByPlanLimit([
      { id: 'c', createdAt: '2026-01-02' }, { id: 'b', createdAt: '2026-01-01' }, { id: 'a', createdAt: '2026-01-01' },
    ], 2);
    expect(result.allowed.map((row) => row.id)).toEqual(['a', 'b']);
    expect(result.suspended.map((row) => row.id)).toEqual(['c']);
    expect(partitionByPlanLimit(result.allowed, null).suspended).toEqual([]);
  });
});
