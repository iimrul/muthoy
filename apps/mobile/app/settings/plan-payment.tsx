import { Text, View } from 'react-native';

// Plan Payment — Volume 4 SUBSCRIPTION, TECH_STACK.md's payment providers.
// P1 (entire feature is post-beta per Volume 0's scope lock).
// TODO(P1): SSLCommerz/bKash payment flow (TECH_STACK.md). On success,
//   writes a `subscriptions` row via the payment webhook Edge Function
//   (Volume 3 EDGE FUNCTIONS) — "the phone never self-declares its own
//   premium status."
export default function PlanPaymentScreen() {
  return (
    <View>
      <Text>TODO: Plan Payment — SSLCommerz/bKash (P1 — post-beta, Volume 4 SUBSCRIPTION)</Text>
    </View>
  );
}
