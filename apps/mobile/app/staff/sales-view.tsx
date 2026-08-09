import { Text, View } from 'react-native';

// Staff sales view — Volume 2 lists this alongside management/ under
// app/staff/. Sales/cash attribution to the logged-in user (Volume 0 Day
// 11) — this screen is the per-staff-member view of what they've sold.
// TODO(Day 11): list sales attributed to a given staff user_id (db/staff.ts
//   or db/sales.ts — decide which owns this query once Day 11 is actually
//   implemented; not yet obvious from Volume 4 which file should own it).
// TODO(Day 11): a Staff-role login must only see their OWN attributed
//   sales, never another staff member's or owner-only financial data
//   (Volume 0 Day 11 checklist: "A Staff-role login cannot access
//   owner-only screens" — enforced via domain/permissions.ts).
export default function StaffSalesViewScreen() {
  return (
    <View>
      <Text>TODO: Staff sales view — own attributed sales only (Volume 0 Day 11)</Text>
    </View>
  );
}
