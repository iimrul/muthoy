import { Text, View } from 'react-native';

// PIN Login — Volume 4 AUTHENTICATION, Volume 0 Day 5. Checks the bcrypt
// hash OFFLINE — this must never require a network call to succeed.
// TODO(Day 5): reuse components/ui/PinPad.tsx. On submit, call
//   db/auth.ts's verifyPin; wrong PIN shows a clear rejection message
//   (Volume 0 Day 5 checklist), correct PIN establishes a session carrying
//   shop_id + role (Volume 4: "Both converge on a session carrying shop_id
//   + role") and persists it via MMKV (Volume 4 STATE MANAGEMENT).
export default function PinLoginScreen() {
  return (
    <View>
      <Text>TODO: PIN Login — offline bcrypt check (Volume 0 Day 5)</Text>
    </View>
  );
}
