import { ReactNode } from "react";
import { canUseFeature } from "../utils/planStore";
import { PremiumLock } from "./PremiumLock";

type PremiumFeature =
  | "multi_shop"
  | "supplier_invoices"
  | "expenses"
  | "reports"
  | "export"
  | "printer"
  | "extra_staff";

export const PREMIUM_FEATURE_LABELS: Record<
  PremiumFeature,
  { bn: string; en: string }
> = {
  expenses: { bn: "খরচ ট্র্যাকিং", en: "Expense tracking" },
  multi_shop: { bn: "একাধিক দোকান", en: "Multi-shop" },
  supplier_invoices: { bn: "সরবরাহকারী ইনভয়েস", en: "Supplier invoices" },
  reports: { bn: "রিপোর্ট", en: "Reports" },
  export: { bn: "ডেটা এক্সপোর্ট", en: "Data export" },
  printer: { bn: "প্রিন্টার", en: "Printer" },
  extra_staff: { bn: "অতিরিক্ত স্টাফ", en: "Extra staff" },
};

interface PremiumGateProps {
  feature: PremiumFeature;
  children: ReactNode;
}

/** Renders children when the user's plan includes the feature; otherwise shows PremiumLock. */
export function PremiumGate({ feature, children }: PremiumGateProps) {
  if (canUseFeature(feature)) return <>{children}</>;

  const labels = PREMIUM_FEATURE_LABELS[feature];
  return (
    <PremiumLock featureNameBn={labels.bn} featureNameEn={labels.en} />
  );
}
