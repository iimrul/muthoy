import { Text, View } from 'react-native';

// Expiry Management — Volume 4 SALES/CUSTOMER cross-reference, Volume 0
// Day 9. Lists batches sorted by nearest REAL expiry date (not a stored
// day-count — CLAUDE.md rule 3), flags anything inside a configurable
// threshold.
// TODO(Day 9): must reuse domain/fefo.ts's date logic for sorting, not a
//   new hand-rolled sort (Volume 0 Day 9 checklist: "Confirm the expiry
//   sort uses the shared FEFO/date logic, not a new hand-rolled sort").
// TODO(Day 9): configurable threshold (e.g. "expiring within N days") — the
//   threshold value itself isn't specced further in Volume 4; confirm with
//   the founder before hardcoding a default (CLAUDE.md rule 11).
export default function ExpiryManagementScreen() {
  return (
    <View>
      <Text>TODO: Expiry Management — nearest-first, real dates only (Volume 0 Day 9)</Text>
    </View>
  );
}
