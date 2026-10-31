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

/**
 * E11, measured rather than asserted.
 *
 * b4_refresh_entitlement_snapshot stamps verified_at = now() and rederives
 * NOTHING (20260831000000:620-630), and billing-status calls it on every poll
 * (sync/billing.ts:60). The Batch 3 plan recorded the consequence as "extends
 * paid access with no payment". These tests exist to find out whether that is
 * true, because the remediation depends on which of two defects this is.
 *
 * It is NOT true, and the reason is visible in resolveEntitlement: the
 * verification ceiling is ANDed with the business dates, never substituted for
 * them. Advancing verified_at cannot create access the snapshot does not
 * already carry. What it CAN do is keep extending trust in a snapshot that
 * nothing has checked against payment evidence -- a false attestation and a
 * defeated backstop, not a payment bypass.
 */
describe('E11 -- what advancing verified_at can and cannot buy', () => {
  it('cannot extend premium one millisecond past paid_through', () => {
    // paid_through is 20 days out, grace 27. A refresh stamps verified_at now,
    // so the ceiling is 30 days out -- strictly BEYOND both business dates.
    const refreshed = { ...base, verifiedAt: now.toISOString() };
    const ceiling = now.getTime() + MAX_OFFLINE_VERIFICATION_DAYS * DAY_MS;
    expect(ceiling).toBeGreaterThan(Date.parse(base.graceEndsAt!));

    // Access still ends at grace, not at the ceiling.
    const atGrace = resolveEntitlement(refreshed, new Date(Date.parse(isoAfter(27)) - 1));
    expect(atGrace.premium).toBe(true);
    const pastGrace = resolveEntitlement(refreshed, new Date(Date.parse(isoAfter(27)) + 1));
    expect(pastGrace.premium).toBe(false);
    expect(pastGrace.effectiveTier).toBe('free');
    expect(pastGrace.reason).toBe('paid_expired');
  });

  it('grants nothing at all on a snapshot whose dates have already run out', () => {
    // The adversarial case the plan described: an account with no live
    // entitlement, refreshed repeatedly. Each refresh moves the ceiling and
    // buys zero access, because every branch requires a business date ahead of
    // now BEFORE the ceiling is consulted.
    const spent = {
      ...base, paidThrough: isoAfter(-40), graceEndsAt: isoAfter(-33),
      verifiedAt: now.toISOString(),
    };
    const resolved = resolveEntitlement(spent, now);
    expect(resolved).toMatchObject({ premium: false, effectiveTier: 'free', reason: 'paid_expired' });

    // And a trial that has ended is not revived by a fresh stamp either.
    const endedTrial = {
      ...base, tier: 'free' as const, status: 'trialing' as const,
      trialEndsAt: isoAfter(-1), paidThrough: null, graceEndsAt: null,
      verifiedAt: now.toISOString(),
    };
    expect(resolveEntitlement(endedTrial, now)).toMatchObject({ premium: false, reason: 'trial_ended' });
  });

  it('does move the offline ceiling, which is the one legitimate thing it is for', () => {
    // This is why the call cannot simply be deleted. A paid device that has
    // been offline 31 days is stale and resolves to free; contacting the
    // server is exactly what should restore it. Removing the refresh without
    // replacing it would strip premium from paying customers who are online.
    const annual = { ...base, paidThrough: isoAfter(300), graceEndsAt: isoAfter(307) };
    const stale = { ...annual, verifiedAt: isoAfter(-31) };
    expect(resolveEntitlement(stale, now)).toMatchObject({ premium: false, reason: 'verification_stale' });

    const refreshed = { ...annual, verifiedAt: now.toISOString() };
    expect(resolveEntitlement(refreshed, now)).toMatchObject({ premium: true, reason: 'paid' });
  });

  it('bounds the exposure window at 30 days of unchecked trust per refresh', () => {
    // The measured impact. A snapshot that has diverged from payment reality
    // but still carries open business dates keeps premium for min(business
    // date, verified_at + 30d). The ceiling is the ONLY mechanism that would
    // ever force that snapshot to be re-derived, and the refresh resets it, so
    // the window renews indefinitely while the dates stay open.
    const diverged = { ...base, paidThrough: isoAfter(300), graceEndsAt: isoAfter(307) };
    const resolved = resolveEntitlement({ ...diverged, verifiedAt: now.toISOString() }, now);
    expect(resolved.offlineValidUntil)
      .toBe(new Date(now.getTime() + MAX_OFFLINE_VERIFICATION_DAYS * DAY_MS).toISOString());
    // Not the business date: the ceiling binds here, and a refresh moves it.
    expect(resolved.offlineValidUntil).not.toBe(resolved.accessEndsAt);
  });
});
