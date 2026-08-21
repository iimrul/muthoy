import { useSearchParams } from "react-router";
import { PremiumLock } from "../components/PremiumLock";
import { PREMIUM_FEATURE_LABELS } from "../components/PremiumGate";

/** Standalone preview route for the premium lock screen (design QA / demos). */
export function PremiumLockPreview() {
  const [params] = useSearchParams();
  const feature = params.get("feature") ?? "expenses";
  const labels =
    PREMIUM_FEATURE_LABELS[feature as keyof typeof PREMIUM_FEATURE_LABELS] ??
    PREMIUM_FEATURE_LABELS.expenses;

  return (
    <PremiumLock featureNameBn={labels.bn} featureNameEn={labels.en} />
  );
}
