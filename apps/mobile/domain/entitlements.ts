import type { Paisa } from '@muthoy/types';

export const DAY_MS = 24 * 60 * 60 * 1_000;
export const TRIAL_DAYS = 14;
export const PAID_GRACE_DAYS = 7;
export const MAX_OFFLINE_VERIFICATION_DAYS = 30;

export type PlanTier = 'free' | 'pro' | 'ultra';
export type BillingCycle = 'monthly' | 'annual';
export type EntitlementStatus =
  | 'trialing'
  | 'active'
  | 'grace'
  | 'past_due'
  | 'canceled'
  | 'expired';

export type PremiumFeature =
  | 'multi_shop'
  | 'supplier_invoices'
  | 'expenses'
  | 'reports'
  | 'export'
  | 'printer'
  | 'extra_staff';

export interface PlanOffering {
  tier: PlanTier;
  monthlyPaisa: Paisa;
  annualPaisa: Paisa;
  maxActiveShops: number | null;
  maxActiveNonOwnerStaffPerShop: number | null;
}

export const PLAN_OFFERINGS: Readonly<Record<PlanTier, PlanOffering>> = {
  free: {
    tier: 'free',
    monthlyPaisa: 0 as Paisa,
    annualPaisa: 0 as Paisa,
    maxActiveShops: 1,
    maxActiveNonOwnerStaffPerShop: 1,
  },
  pro: {
    tier: 'pro',
    monthlyPaisa: 39_900 as Paisa,
    annualPaisa: 383_000 as Paisa,
    maxActiveShops: 3,
    maxActiveNonOwnerStaffPerShop: 4,
  },
  ultra: {
    tier: 'ultra',
    monthlyPaisa: 49_900 as Paisa,
    annualPaisa: 479_000 as Paisa,
    maxActiveShops: null,
    maxActiveNonOwnerStaffPerShop: null,
  },
};

export interface EntitlementSnapshot {
  billingAccountId: string;
  tier: PlanTier;
  status: EntitlementStatus;
  trialEndsAt: string | null;
  paidThrough: string | null;
  graceEndsAt: string | null;
  verifiedAt: string;
  version: number;
}

export type AccessReason =
  | 'free'
  | 'trial'
  | 'paid'
  | 'paid_grace'
  | 'trial_ended'
  | 'paid_expired'
  | 'verification_stale'
  | 'invalid_snapshot';

export interface EffectiveEntitlement {
  commercialTier: PlanTier;
  effectiveTier: PlanTier;
  status: EntitlementStatus;
  reason: AccessReason;
  premium: boolean;
  accessEndsAt: string | null;
  offlineValidUntil: string;
  verifiedAt: string | null;
}

export type DisplayPlan = PlanTier | 'trial';

/** Trial is a commercial state, not an Ultra subscription label. */
export function displayPlanForEntitlement(
  entitlement: Pick<EffectiveEntitlement, 'reason' | 'commercialTier'>,
): DisplayPlan {
  return entitlement.reason === 'trial' ? 'trial' : entitlement.commercialTier;
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

function freeResult(
  snapshot: EntitlementSnapshot,
  reason: AccessReason,
  offlineValidUntil: number,
): EffectiveEntitlement {
  return {
    commercialTier: snapshot.tier,
    effectiveTier: 'free',
    status: snapshot.status,
    reason,
    premium: false,
    accessEndsAt: null,
    offlineValidUntil: iso(offlineValidUntil),
    verifiedAt: timestamp(snapshot.verifiedAt) === null ? null : snapshot.verifiedAt,
  };
}

/**
 * Resolves the server snapshot into local access. The client can only reduce
 * access: trial/paid/grace time and the 30-day verification ceiling are all
 * hard upper bounds. A redirect or local payment row never enters this path.
 */
export function resolveEntitlement(
  snapshot: EntitlementSnapshot,
  now: Date = new Date(),
  mode: 'online' | 'offline' = 'offline',
): EffectiveEntitlement {
  const nowMs = now.getTime();
  const verifiedMs = timestamp(snapshot.verifiedAt);
  if (verifiedMs === null || !Number.isInteger(snapshot.version) || snapshot.version < 0) {
    return freeResult(snapshot, 'invalid_snapshot', nowMs);
  }

  const verificationCeiling = verifiedMs + MAX_OFFLINE_VERIFICATION_DAYS * DAY_MS;
  if (mode === 'offline' && nowMs > verificationCeiling) {
    return freeResult(snapshot, 'verification_stale', verificationCeiling);
  }

  if (snapshot.status === 'trialing') {
    const trialEnd = timestamp(snapshot.trialEndsAt);
    if (trialEnd === null) return freeResult(snapshot, 'invalid_snapshot', verificationCeiling);
    if (nowMs >= trialEnd) return freeResult(snapshot, 'trial_ended', Math.min(trialEnd, verificationCeiling));
    const accessEnd = Math.min(trialEnd, verificationCeiling);
    return {
      commercialTier: snapshot.tier,
      effectiveTier: 'ultra',
      status: snapshot.status,
      reason: 'trial',
      premium: true,
      accessEndsAt: iso(trialEnd),
      offlineValidUntil: iso(accessEnd),
      verifiedAt: snapshot.verifiedAt,
    };
  }

  const paidThrough = timestamp(snapshot.paidThrough);
  const graceEnd = timestamp(snapshot.graceEndsAt);
  let accessEnd: number | null = null;
  let reason: AccessReason = 'paid_expired';

  if ((snapshot.status === 'active' || snapshot.status === 'canceled') && paidThrough !== null && nowMs < paidThrough) {
    accessEnd = paidThrough;
    reason = 'paid';
  } else if (
    (snapshot.status === 'grace' || snapshot.status === 'past_due' || snapshot.status === 'active') &&
    graceEnd !== null &&
    nowMs < graceEnd
  ) {
    accessEnd = graceEnd;
    reason = 'paid_grace';
  }

  if (snapshot.tier === 'free' || accessEnd === null) {
    return freeResult(snapshot, snapshot.tier === 'free' ? 'free' : reason, verificationCeiling);
  }

  return {
    commercialTier: snapshot.tier,
    effectiveTier: snapshot.tier,
    status: snapshot.status,
    reason,
    premium: true,
    accessEndsAt: iso(accessEnd),
    offlineValidUntil: iso(Math.min(accessEnd, verificationCeiling)),
    verifiedAt: snapshot.verifiedAt,
  };
}

export function priceFor(tier: Exclude<PlanTier, 'free'>, cycle: BillingCycle): Paisa {
  const offering = PLAN_OFFERINGS[tier];
  return cycle === 'monthly' ? offering.monthlyPaisa : offering.annualPaisa;
}

export function canUseFeature(tier: PlanTier, _feature: PremiumFeature): boolean {
  return tier === 'pro' || tier === 'ultra';
}

export type PremiumAccessStatus = 'open' | 'loading' | 'locked';

/**
 * One decision for both the cover a gate draws and the pointer/accessibility
 * isolation applied to whatever stays mounted underneath it. An unverified
 * device resolves to effectiveTier 'free', so it locks — fail closed.
 */
export function premiumAccessStatus(
  plan: { effectiveTier: PlanTier; loading: boolean },
  feature: PremiumFeature | null,
): PremiumAccessStatus {
  if (!feature) return 'open';
  if (plan.loading) return 'loading';
  return canUseFeature(plan.effectiveTier, feature) ? 'open' : 'locked';
}

export function planLimits(tier: PlanTier): Pick<PlanOffering, 'maxActiveShops' | 'maxActiveNonOwnerStaffPerShop'> {
  const { maxActiveShops, maxActiveNonOwnerStaffPerShop } = PLAN_OFFERINGS[tier];
  return { maxActiveShops, maxActiveNonOwnerStaffPerShop };
}

/** Display-only countdown. Access still comes exclusively from resolveEntitlement. */
export function accessDaysRemaining(accessEndsAt: string | null | undefined, now: Date = new Date()): number | undefined {
  const end = timestamp(accessEndsAt);
  if (end === null) return undefined;
  return Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS));
}

export interface LimitCandidate {
  id: string;
  createdAt: string;
}

/** Stable oldest-first selection prevents different clients suspending different rows. */
export function partitionByPlanLimit<T extends LimitCandidate>(
  candidates: readonly T[],
  limit: number | null,
): { allowed: T[]; suspended: T[] } {
  const ordered = [...candidates].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
  if (limit === null) return { allowed: ordered, suspended: [] };
  return { allowed: ordered.slice(0, limit), suspended: ordered.slice(limit) };
}
