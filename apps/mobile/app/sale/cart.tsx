import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { formatMoney } from '@muthoy/utils';
import { EmptyState } from '../../components/ui/EmptyState';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { applyDiscount } from '../../domain/discounts';
import { useCartStore, type CartLine } from '../../state/cartStore';

export default function CartScreen() {
  const items = useCartStore((state) => state.items);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const total = useCartStore((state) => state.total());

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Cart" onBackPress={() => router.back()} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.batchId}
        contentContainerClassName="flex-grow gap-3 p-4"
        ListEmptyComponent={
          <EmptyState
            title="Cart is empty"
            message="Search for medicines to start a sale."
            actionLabel="Find medicines"
            onAction={() => router.replace('/sale')}
          />
        }
        renderItem={({ item }) => (
          <CartRow item={item} onQuantityChange={(quantity) => updateQuantity(item.batchId, quantity)} />
        )}
      />
      {items.length > 0 ? (
        <View className="gap-4 border-t border-midGray bg-white p-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-sans-bold text-lg text-richBlack">Total</Text>
            <Text className="font-mono text-xl text-brand-green">{formatMoney(total)}</Text>
          </View>
          <Pressable
            onPress={() => router.push('/sale/checkout')}
            accessibilityRole="button"
            accessibilityLabel="Checkout"
            className="items-center rounded-lg bg-brand-green py-3.5 active:opacity-80"
          >
            <Text className="font-sans-semibold text-base text-white">Checkout</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function CartRow({ item, onQuantityChange }: { item: CartLine; onQuantityChange: (quantity: number) => void }) {
  const lineTotal = applyDiscount(item.unitPrice, item.quantity, item.discount).lineTotal;
  return (
    <View className="gap-3 rounded-lg bg-white p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="font-sans-medium text-base text-richBlack">{item.medicineName}</Text>
          <Text className="font-mono text-xs text-midGray">{formatMoney(item.unitPrice)} each</Text>
        </View>
        <Text className="font-mono text-base text-brand-green">{formatMoney(lineTotal)}</Text>
      </View>
      <View className="flex-row items-center justify-end gap-4">
        <Pressable
          onPress={() => onQuantityChange(item.quantity - 1)}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${item.medicineName} quantity`}
          className="h-10 w-10 items-center justify-center rounded-lg border border-midGray active:opacity-70"
        >
          <Text className="font-sans-bold text-xl text-richBlack">−</Text>
        </Pressable>
        <Text className="min-w-8 text-center font-mono text-base text-richBlack">{item.quantity}</Text>
        <Pressable
          onPress={() => onQuantityChange(item.quantity + 1)}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${item.medicineName} quantity`}
          className="h-10 w-10 items-center justify-center rounded-lg bg-brand-green active:opacity-70"
        >
          <Text className="font-sans-bold text-xl text-white">+</Text>
        </Pressable>
      </View>
    </View>
  );
}
