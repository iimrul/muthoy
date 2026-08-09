import { Text, View } from 'react-native';

// End of Day — Volume 0 Day 10: "locks the day: total sales, cash/credit
// split, profit via COGS, expenses, new credit given, credit collected,
// expected vs counted cash, opened_by/closed_by."
// TODO(Day 10): render the full close-out summary via db/cash.ts's
//   getCashSummary + domain/cashFormula.expectedCash, then let the owner
//   enter the COUNTED cash and call db/cash.ts's closeDay, which locks the
//   day (Volume 0 Day 10 checklist: "End of Day's numbers match a hand
//   calculation for a full test day").
export default function EndOfDayScreen() {
  return (
    <View>
      <Text>TODO: End of Day — locks the daily close-out (Volume 0 Day 10)</Text>
    </View>
  );
}
