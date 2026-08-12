import { Text, View } from 'react-native';

// Currently unreachable and deferred. Owner and staff PINs both use the
// PIN-only login route; role selection needs an explicitly approved future
// flow before this route is exposed.
export default function RoleSelectScreen() {
  return (
    <View>
      <Text>TODO: Role Select — owner vs staff, before PIN entry (Volume 0 Day 4-5)</Text>
    </View>
  );
}
