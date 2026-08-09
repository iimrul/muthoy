import { Text, View } from 'react-native';

// Checkout — Volume 4 SALES, Volume 0 Day 7 [HIGHEST RISK DAY — budget extra
// review time]. Layout/navigation only here (DEVELOPMENT_RULES.md) — the
// actual logic lives in domain/ and db/, called in this order per Volume 2's
// sequence diagram:
//   1. domain/discounts.applyDiscount   — resolve each line's discount
//   2. domain/cashFormula.expectedCash  — calculate the expected total
//   3. domain/fefo.deduct               — resolve batch(es) to deduct per line
//   4. db/sales.createSaleTransaction   — write sales+sale_items+inventory_movements
//        (one transaction, using the plan domain/fefo.deduct() resolved)
//   5. db -> sync: enqueue each written row (Day 13 — not yet built)
//   6. state/cartStore.clear            — clear the cart
//   7. navigate to a confirmation screen (not yet specced beyond this)
// TODO(Day 7): cash/credit choice, wired to db/sales.ts's paymentType field.
// TODO(Day 7): MUST have a passing unit test for both FEFO deduction and the
//   cash formula before this is considered done (Volume 0 Day 7 checklist).
export default function CheckoutScreen() {
  return (
    <View>
      <Text>TODO: Checkout — FEFO deduction + cash drawer update (Volume 0 Day 7)</Text>
    </View>
  );
}
