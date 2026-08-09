import { Text, View } from 'react-native';

// Expense Tracking — Volume 0 Day 10. Not nested under a named subfolder in
// Volume 2's illustrative route tree, so placed at the app/ top level
// (kebab-case per DEVELOPMENT_RULES.md route-naming rule).
// TODO(Day 10): category, amount, description, optional receipt photo
//   (stored locally for now — Supabase Storage upload is Day 13+ sync
//   territory, not this screen's concern).
// TODO(Day 10): on save, calls db/cash.ts's recordExpense, which writes
//   BOTH an `expenses` row and a `payments` row with type='expense',
//   ref_id pointing at the expense (Volume 0 Day 10).
export default function ExpenseTrackingScreen() {
  return (
    <View>
      <Text>TODO: Expense Tracking (Volume 0 Day 10)</Text>
    </View>
  );
}
