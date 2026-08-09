import { Text, View } from 'react-native';

// Cash Summary — Volume 0 Day 10: "live expected-cash view."
// TODO(Day 10): render domain/cashFormula.expectedCash live, fed by
//   db/cash.ts's getCashSummary. Opening cash defaults to 0, set by the
//   user, and resets at midnight — NEVER inherit yesterday's value
//   (CLAUDE.md rule 5, must hold here even though the entry UI for opening
//   cash itself may live on the dashboard or first-sale flow).
export default function CashSummaryScreen() {
  return (
    <View>
      <Text>TODO: Cash Summary — live expected-cash view (Volume 0 Day 10)</Text>
    </View>
  );
}
