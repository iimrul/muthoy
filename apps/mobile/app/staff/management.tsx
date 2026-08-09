import { Text, View } from 'react-native';

// Staff Management — Volume 4 AUTHENTICATION/NAVIGATION cross-reference,
// Volume 0 Day 11. Owner-only screen.
// TODO(Day 11): owner adds staff with name + PIN (reuse
//   components/ui/PinPad.tsx). List existing staff with active/deactivated
//   status.
// TODO(Day 11): owner can reset a staff PIN or change their own PIN — reuse
//   the dots+keypad component. Every PIN change/staff deactivation writes
//   to audit_logs (db/staff.ts's writeAuditLog), NEVER logging the PIN
//   value itself (CLAUDE.md rule 8).
export default function StaffManagementScreen() {
  return (
    <View>
      <Text>TODO: Staff Management — add staff, reset PIN, audit log (Volume 0 Day 11)</Text>
    </View>
  );
}
