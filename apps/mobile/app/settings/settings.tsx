import { Text, View } from 'react-native';

// Settings — Volume 4 SETTINGS. Mixed scope: shop profile + security
// (change own PIN) are P0; backup-key restore-on-new-phone and the
// plan/billing entry point's DESTINATION screens are P1 (Volume 0's scope
// lock) — this screen itself is a reasonable P0 shell since "change own
// PIN" needs a home, but its Subscription-linked rows point at P1 screens.
// TODO(Day 11-ish, P0 slice): shop profile view/edit, security section
//   with "change own PIN" (reuses components/ui/PinPad.tsx, writes via
//   db/settings.ts's changeOwnPin + db/staff.ts's writeAuditLog).
// TODO(P0 slice): language toggle.
// TODO(P1 slice): backup key restore-on-new-phone.
// TODO(P1 slice): plan/billing entry point — components/ui/PlanBadge.tsx,
//   links to app/settings/plans.tsx.
export default function SettingsScreen() {
  return (
    <View>
      <Text>TODO: Settings — profile, change PIN (P0), plan entry (P1) (Volume 4 SETTINGS)</Text>
    </View>
  );
}
