import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

// PremiumGate — Volume 4 SUBSCRIPTION: "Free/Pro/Ultra gating via
// PremiumGate + a usePlan hook." P1 (entire feature is post-beta per
// Volume 0's scope lock). For UI/layout reference only (never logic — the
// Prototype Rule), see apps/prototype-web's PremiumLock.tsx.

export interface PremiumGateProps {
  /** Minimum plan required to see `children` unlocked. */
  requiredPlan: 'pro' | 'ultra';
  children: ReactNode;
}

// TODO(P1): reads state/usePlan.ts; if the shop's plan (or an active trial)
// doesn't meet requiredPlan, render an upgrade prompt instead of children —
// limits are enforced at creation time with an upgrade prompt, NEVER a
// crash (Volume 4 SUBSCRIPTION).
export function PremiumGate(_props: PremiumGateProps) {
  return (
    <View>
      <Text>TODO: PremiumGate (P1 — post-beta, Volume 4 SUBSCRIPTION)</Text>
    </View>
  );
}
