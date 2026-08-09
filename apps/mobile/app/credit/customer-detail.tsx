import { Text, View } from 'react-native';

// Customer Detail — Volume 4 CUSTOMER, Volume 0 Day 9.
// TODO(Day 9): credit ledger view for this customer (db/customers.ts's
//   getCustomerCreditLedger) — every credit sale and every collection,
//   running balance via domain/credit.ts's remainingBalance.
// TODO(Day 9): "collect payment" action — calls db/customers.ts's
//   collectPayment, which reduces the balance AND adds to the cash drawer
//   as a CreditCollection (feeds domain/cashFormula's creditCollections
//   input). Collecting must actually touch cash, unlike the original credit
//   sale (Volume 0 Day 9 checklist).
export default function CustomerDetailScreen() {
  return (
    <View>
      <Text>TODO: Customer Detail — credit ledger + collect payment (Volume 0 Day 9)</Text>
    </View>
  );
}
