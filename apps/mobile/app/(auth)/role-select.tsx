import { Text, View } from 'react-native';

// Role Select — Volume 2 lists this alongside register/pin-setup/pin-login
// in the (auth) route group. Lets a returning user on a shared device pick
// "Owner" vs "Staff" before PIN entry, since both converge on the same
// pin-login screen but may need different context (e.g. owner-only phone
// recovery vs staff PIN-reset-by-owner) — see Volume 4 AUTHENTICATION.
// TODO(Day 4-5): exact flow/copy not detailed beyond this in Volume 4 —
//   flag with the founder before implementing if the split isn't obvious
//   from the PIN itself (CLAUDE.md rule 11).
export default function RoleSelectScreen() {
  return (
    <View>
      <Text>TODO: Role Select — owner vs staff, before PIN entry (Volume 0 Day 4-5)</Text>
    </View>
  );
}
