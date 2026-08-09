import { Text, View } from 'react-native';

// Registration — Volume 4 AUTHENTICATION, Volume 0 Day 4. Layout only here
// (DEVELOPMENT_RULES.md) — form/validation/writes live in components/forms
// and db/auth.ts.
// TODO(Day 4): shop name + phone only (React Hook Form + Zod, schema in
//   packages/validation). Design the phone field so it can later gate an
//   OTP step (Day 13) without a screen rebuild — do not treat it as
//   OTP-verified yet.
// TODO(Day 4): on submit, call db/auth.ts's createShopAndOwner, which must
//   generate a unique, non-hardcoded shop id (CLAUDE.md rule 7 — a new
//   owner on the same device must NEVER see a previous owner's data).
// TODO(Day 5): no StandardHeader on this screen (Volume 4 NAVIGATION: header
//   applies to every screen except MorningDashboard and Registration).
export default function RegisterScreen() {
  return (
    <View>
      <Text>TODO: Registration — shop name + phone (Volume 0 Day 4)</Text>
    </View>
  );
}
