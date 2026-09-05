import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { premiumAccessStatus, type PremiumFeature } from '../../domain/entitlements';
import { usePlan } from '../../state/usePlan';
import { PremiumLock } from './PremiumLock';

export interface PremiumGateProps {
  feature?: PremiumFeature;
  requiredPlan?: 'pro' | 'ultra';
  children?: ReactNode;
  compact?: boolean;
  /**
   * Renders the locked/loading state as an absolutely-filled cover instead of a
   * flex child. NavigationBoundary needs this: it must keep the <Stack />
   * navigator mounted underneath, because replacing it resets route state.
   */
  overlay?: boolean;
}

/**
 * In-place entitlement gate for a subtree. A live trial resolves to
 * effectiveTier 'ultra' (domain/entitlements), so a trial owner passes without
 * any trial-specific special case.
 *
 * This is presentation. It is never the only check — every protected
 * operation re-verifies against the SQLite entitlement cache (db/commercial)
 * and, for anything that leaves the device, against the server.
 */
export function PremiumGate({ feature = 'reports', requiredPlan, children, compact = false, overlay = false }: PremiumGateProps) {
  const plan = usePlan();
  const status = requiredPlan === 'ultra'
    ? (plan.loading ? 'loading' : plan.effectiveTier === 'ultra' ? 'open' : 'locked')
    : premiumAccessStatus(plan, feature);
  if (status === 'loading') {
    return (
      <View style={overlay ? StyleSheet.absoluteFill : undefined} className="flex-1 items-center justify-center bg-brand-softGreen">
        <ActivityIndicator color="#059669" />
      </View>
    );
  }
  if (status === 'open') return <>{children}</>;
  return <PremiumLock feature={feature} compact={compact} overlay={overlay} />;
}
