import { Text, View } from 'react-native';

// Data Export — Volume 4 REPORTS. Explicitly P1 (Volume 0's scope lock:
// "Reports polish (Monthly Report, Data Export, Printer Settings)").
// TODO(P1): export format not specced in Volume 4 beyond the name — confirm
//   with the founder (CSV? JSON? per Volume 3's "periodic full-shop export
//   to Supabase Storage (JSON snapshot)" backup mechanism, which is a
//   related but distinct Day 13+ concern, not this screen's) before
//   implementing (CLAUDE.md rule 11).
export default function DataExportScreen() {
  return (
    <View>
      <Text>TODO: Data Export (P1, Volume 4 REPORTS)</Text>
    </View>
  );
}
