import { useRef, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { formatMoney } from '@muthoy/utils';
import { EmptyState } from '../../components/ui/EmptyState';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { searchMedicinesForSale, type MedicineSearchResult } from '../../db/sales';
import { useCartStore } from '../../state/cartStore';
import { useSessionStore } from '../../state/sessionStore';
import { useUnreadCount } from '../../state/useUnreadCount';

export default function SaleEntryScreen() {
  const session = useSessionStore((state) => state.session);
  const unreadCount = useUnreadCount(session?.shopId, session?.userId);
  const addItem = useCartStore((state) => state.addItem);
  const cartCount = useCartStore((state) => state.items.reduce((sum, item) => sum + item.quantity, 0));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MedicineSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const requestId = useRef(0);

  if (!session) {
    return null;
  }

  const handleQueryChange = async (value: string) => {
    setQuery(value);
    setSearchError(null);
    const currentRequest = ++requestId.current;
    if (!value.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const matches = await searchMedicinesForSale(session.shopId, value);
      if (currentRequest === requestId.current) {
        setResults(matches);
      }
    } catch {
      if (currentRequest === requestId.current) {
        setResults([]);
        setSearchError('Medicine search failed. Try again.');
      }
    } finally {
      if (currentRequest === requestId.current) {
        setIsSearching(false);
      }
    }
  };

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Sale" onBellPress={() => router.push('/notifications')} unreadCount={unreadCount} />
      <View className="flex-row gap-3 p-4 pb-2">
        <TextInput
          value={query}
          onChangeText={handleQueryChange}
          placeholder="Search medicine or generic"
          accessibilityLabel="Search medicines"
          autoCapitalize="none"
          className="flex-1 rounded-lg border border-midGray bg-white px-4 py-3 font-sans text-base text-richBlack"
        />
        <Pressable
          onPress={() => router.push('/sale/cart')}
          accessibilityRole="button"
          accessibilityLabel={`Open cart with ${cartCount} items`}
          className="min-w-14 items-center justify-center rounded-lg bg-brand-green px-4 active:opacity-80"
        >
          <Text className="font-mono text-base text-white">{cartCount}</Text>
        </Pressable>
      </View>
      {searchError ? <Text className="px-4 pb-2 font-sans text-sm text-error">{searchError}</Text> : null}
      <FlatList
        data={results}
        keyExtractor={(item) => item.medicineId}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="flex-grow gap-3 p-4"
        ListEmptyComponent={
          <EmptyState
            title={isSearching ? 'Searching…' : query.trim() ? 'No medicines found' : 'Search medicines'}
            message={
              isSearching
                ? 'Checking local stock.'
                : query.trim()
                  ? 'Try a different medicine or generic name.'
                  : 'Type a medicine or generic name to start a sale.'
            }
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              addItem({
                medicineId: item.medicineId,
                medicineName: item.name,
                batchId: item.activeBatch.id,
                quantity: 1,
                unitPrice: item.activeBatch.salePrice,
              })
            }
            accessibilityRole="button"
            accessibilityLabel={`Add ${item.name} to cart`}
            className="flex-row items-center justify-between rounded-lg bg-white p-4 active:opacity-80"
          >
            <View className="flex-1 gap-1 pr-3">
              <Text className="font-sans-medium text-base text-richBlack">{item.name}</Text>
              {item.generic ? <Text className="font-sans text-xs text-midGray">{item.generic}</Text> : null}
            </View>
            <Text className="font-mono text-base text-brand-green">{formatMoney(item.activeBatch.salePrice)}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
