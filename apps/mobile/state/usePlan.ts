// state/usePlan.ts — Volume 4 SUBSCRIPTION: "a usePlan hook reading the
// cached shops.plan (fast path) while `subscriptions` is the billing
// source of truth." P1 (entire feature is post-beta per Volume 0's scope
// lock). Not a Zustand store — reads a cached value (shops.plan), so this
// stays a plain hook rather than global mutable UI state.

export type Plan = 'free' | 'pro' | 'ultra' | 'trial';

export interface PlanInfo {
  plan: Plan;
  /** Only set while plan === 'trial'. */
  trialEndsAt?: string;
}

// TODO(P1): read the cached shops.plan (fast path, no network/DB round
// trip on every render) rather than querying `subscriptions` directly —
// `subscriptions` stays the billing source of truth, synced down
// separately (Day 13's sync layer).
export function usePlan(): PlanInfo {
  throw new Error('TODO: implement usePlan (P1 — post-beta, Volume 4 SUBSCRIPTION)');
}
