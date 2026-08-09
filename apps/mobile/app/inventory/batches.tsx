import { Text, View } from 'react-native';

// Batch detail/edit — Volume 2 lists this alongside add-medicine/expiry
// under app/inventory/. Not detailed as its own flow in Volume 4 beyond
// "first batch entry" on Add Medicine; this covers editing an EXISTING
// batch (qty/price/expiry correction) after initial entry. For UI/layout
// reference only (never logic — Prototype Rule), see apps/prototype-web's
// EditBatchModal.tsx.
// TODO(Day 8): edit an existing batch's qty/purchase-price/sale-price/
//   expiry. Must still enforce the UNIQUE(shop_id, medicine_id, batch_no)
//   constraint (Volume 3) if batch_no is editable.
export default function BatchDetailScreen() {
  return (
    <View>
      <Text>TODO: Batch detail/edit (Volume 0 Day 8)</Text>
    </View>
  );
}
