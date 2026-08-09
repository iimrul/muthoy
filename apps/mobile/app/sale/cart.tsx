import { Text, View } from 'react-native';

// Cart — Volume 4 SALES, Volume 0 Day 6. Volume 2: "Cart screen renders from
// the store" (state/cartStore.ts) — never fetches directly, presentation only.
// TODO(Day 6): render cart.items (state/cartStore) as line rows with qty
//   steppers; each row's line total is unitPrice * quantity, resolved
//   through domain/discounts.ts's applyDiscount when a discount is set.
// TODO(Day 6): render the running total (state/cartStore's total()).
// TODO(Day 6): a "Checkout" action navigates to app/sale/checkout.tsx.
export default function CartScreen() {
  return (
    <View>
      <Text>TODO: Cart — line items + qty steppers + running total (Volume 0 Day 6)</Text>
    </View>
  );
}
