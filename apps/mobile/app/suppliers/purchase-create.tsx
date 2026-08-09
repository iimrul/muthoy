import { Text, View } from 'react-native';

// Purchase creation — Volume 4 PURCHASE: "invoice_no auto-generated, line
// items create/update batches → COD pays cash immediately, credit updates
// the supplier payable only." P1 (post-beta fast-follow, Volume 0's scope
// lock) — Beta ships manual batch entry via Add Medicine instead.
// TODO(P1): line items create/update batches (overlaps db/inventory.ts's
//   batch-creation logic — decide whether to share it or keep purchase's
//   own path when this is actually implemented). Invoice number via
//   domain/purchases.ts's generateInvoiceNumber.
// TODO(P1): COD pays cash immediately (feeds domain/cashFormula as a
//   supplierPayments input); credit only updates the supplier's payable,
//   no cash-drawer effect at creation time.
export default function PurchaseCreateScreen() {
  return (
    <View>
      <Text>TODO: Purchase creation — COD/credit (P1 — post-beta, Volume 4 PURCHASE)</Text>
    </View>
  );
}
