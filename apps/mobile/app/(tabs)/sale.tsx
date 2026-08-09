import { Text, View } from 'react-native';

// Sale Entry — Volume 4 SALES, Volume 0 Day 6. Layout/navigation only here
// (DEVELOPMENT_RULES.md) — no business logic, no direct DB calls.
// TODO(Day 6): FTS5 search (capped at 50 results) via db/sales.ts's
//   searchMedicinesForSale — each result row shows the medicine's FEFO
//   active batch price in DM Mono (db/sales.ts's getActiveBatchForMedicine).
// TODO(Day 6): tapping a result calls state/cartStore's addItem.
// TODO(Day 5): this route lives in the (tabs) group; the tab bar layout
//   itself ((tabs)/_layout.tsx) is Day 5's navigation-shell scope, not built
//   yet — this file works as a standalone route via the root layout's Stack
//   until then.
export default function SaleEntryScreen() {
  return (
    <View>
      <Text>TODO: Sale Entry — FTS5 search + FEFO-priced results (Volume 0 Day 6)</Text>
    </View>
  );
}
