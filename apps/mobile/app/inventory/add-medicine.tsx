import { Text, View } from 'react-native';

// Add Medicine — Volume 4 INVENTORY, Volume 0 Day 8.
// TODO(Day 8): React Hook Form + Zod (schema in packages/validation): name,
//   generic, manufacturer, strength, category, unit_of_measure,
//   requires_prescription, threshold, barcode, plus the first batch
//   (batch_no, expiry, qty, purchase/sale price).
// TODO(Day 8): on the UNIQUE(shop_id, medicine_id, batch_no) constraint
//   (Volume 3), show a friendly inline error — never a crash (Volume 0 Day 8
//   checklist: "Duplicate batch number for the same medicine shows a
//   friendly error").
// TODO(Day 8): calls db/inventory.ts's createMedicineWithBatch.
export default function AddMedicineScreen() {
  return (
    <View>
      <Text>TODO: Add Medicine — RHF+Zod, first batch entry (Volume 0 Day 8)</Text>
    </View>
  );
}
