import { Text, View } from 'react-native';

// PlanBadge — Volume 2 components/ui: "Header, PinPad, PlanBadge, buttons".
// Volume 4 SETTINGS: "plan/billing entry point (PlanBadge, links to Plans
// screen)." Presentation only (DEVELOPMENT_RULES.md). The badge itself is
// low-cost to scaffold now, but everything it links to (Plans/Plan Payment)
// is P1 (Volume 0's scope lock).

export interface PlanBadgeProps {
  /** "Trial" during the 14-day trial window, never "Ultra" (Volume 4 SUBSCRIPTION). */
  plan: 'free' | 'pro' | 'ultra' | 'trial';
}

// TODO(P1): render the plan label/styling, tap navigates to
// app/settings/plans.tsx.
export function PlanBadge(_props: PlanBadgeProps) {
  return (
    <View>
      <Text>TODO: PlanBadge (P1 — post-beta, Volume 4 SUBSCRIPTION)</Text>
    </View>
  );
}
