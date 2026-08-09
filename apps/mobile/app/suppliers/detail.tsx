import { Text, View } from 'react-native';

// Supplier detail — Volume 4 SUPPLIER: "its own detail view showing
// purchase history and outstanding payables." P1 (post-beta fast-follow,
// Volume 0's scope lock).
// TODO(P1): purchase history + outstanding payables via
//   db/suppliers.ts's getSupplierDetail. Entry point to
//   app/suppliers/purchase-create.tsx for a new purchase against this supplier.
export default function SupplierDetailScreen() {
  return (
    <View>
      <Text>TODO: Supplier detail — history + payables (P1 — post-beta, Volume 4 SUPPLIER)</Text>
    </View>
  );
}
