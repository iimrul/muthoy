// Plan state management — mock/local until Supabase backend is wired.
// Plan tiers: "free" | "pro" | "ultra"
// Trial: 14 days from first registration, acts like Ultra.

export type PlanTier = "free" | "pro" | "ultra";

export interface PlanState {
  tier: PlanTier;
  trialStartedAt: string | null; // ISO date string
  subscribedAt: string | null;
  expiresAt: string | null;
}

const KEY = "planState";

function defaultState(): PlanState {
  return { tier: "free", trialStartedAt: null, subscribedAt: null, expiresAt: null };
}

export function getPlanState(): PlanState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    return defaultState();
  }
}

export function setPlanState(state: Partial<PlanState>) {
  const current = getPlanState();
  const next = { ...current, ...state };
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("plan-updated"));
}

export function getTrialDaysLeft(): number | null {
  const { trialStartedAt } = getPlanState();
  if (!trialStartedAt) return null;
  const start = new Date(trialStartedAt).getTime();
  const now = Date.now();
  const daysElapsed = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  const left = 14 - daysElapsed;
  return left > 0 ? left : 0;
}

export function isTrialActive(): boolean {
  const { trialStartedAt, tier } = getPlanState();
  if (!trialStartedAt) return false;
  if (tier !== "free") return false;
  const left = getTrialDaysLeft();
  return left !== null && left > 0;
}

export function isTrialExpired(): boolean {
  const { trialStartedAt, tier } = getPlanState();
  if (!trialStartedAt) return false;
  if (tier !== "free") return false;
  const left = getTrialDaysLeft();
  return left !== null && left === 0;
}

export function effectiveTier(): PlanTier {
  if (isTrialActive()) return "ultra"; // trial = all features
  return getPlanState().tier;
}

export function canUseFeature(feature: "multi_shop" | "supplier_invoices" | "expenses" | "reports" | "export" | "printer" | "extra_staff"): boolean {
  const tier = effectiveTier();
  if (tier === "ultra") return true;
  if (tier === "pro") {
    return ["multi_shop", "supplier_invoices", "expenses", "reports", "export", "printer", "extra_staff"].includes(feature);
  }
  return false; // free
}

// Start a 14-day trial for a new user (call once at registration).
export function startTrial() {
  const current = getPlanState();
  if (current.trialStartedAt) return; // already started
  setPlanState({ trialStartedAt: new Date().toISOString() });
}

export function upgradePlan(tier: PlanTier) {
  setPlanState({
    tier,
    subscribedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
}
