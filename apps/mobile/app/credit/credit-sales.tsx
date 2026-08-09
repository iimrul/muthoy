import { Text, View } from 'react-native';

// Credit Sales (customer list + entry point) — Volume 4 CUSTOMER, Volume 0
// Day 9.
// TODO(Day 9): list customers (name/phone/address/notes) with outstanding
//   balance, via db/customers.ts's listCustomers. Entry point to
//   app/credit/customer-detail.tsx and to creating a new customer.
// TODO(Day 9): Checkout's "credit" payment type (app/sale/checkout.tsx)
//   attaches an existing or new customer here and calls
//   db/customers.ts's recordCreditSale — a credit sale must NOT touch cash
//   (Volume 0 Day 9 checklist).
export default function CreditSalesScreen() {
  return (
    <View>
      <Text>TODO: Credit Sales — customer list + balances (Volume 0 Day 9)</Text>
    </View>
  );
}
