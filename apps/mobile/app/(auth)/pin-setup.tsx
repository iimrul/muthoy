import { Text, View } from 'react-native';

// PIN Setup — Volume 4 AUTHENTICATION, Volume 0 Day 4. Runs immediately
// after Registration, before the owner's first login.
// TODO(Day 4): 4 dots + custom numeric keypad — components/ui/PinPad.tsx,
//   reused here and by pin-login/change-PIN/staff-PIN-reset (Volume 4:
//   "reused everywhere a PIN is entered").
// TODO(Day 4): on confirm, bcrypt-hash the PIN before it ever reaches db/auth.ts
//   — CLAUDE.md rule 8: PINs are bcrypt-hashed, never logged or stored in
//   plain text. Never log the raw PIN value, even during development.
export default function PinSetupScreen() {
  return (
    <View>
      <Text>TODO: PIN Setup — dots + keypad, bcrypt-hash before saving (Volume 0 Day 4)</Text>
    </View>
  );
}
