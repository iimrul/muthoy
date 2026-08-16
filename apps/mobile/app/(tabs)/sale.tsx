import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { formatMoney } from '@muthoy/utils';
import { MedicineTextScanner } from '../../components/scanner/MedicineTextScanner';
import { EmptyState } from '../../components/ui/EmptyState';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { searchMedicinesForSale, type MedicineSearchResult } from '../../db/sales';
import { createLatestRequestGuard } from '../../domain/latestRequestGuard';
import { extractMedicineNameCandidate, findExactNameMatch } from '../../domain/ocrText';
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
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const [searchGuard] = useState(() => createLatestRequestGuard());

  if (!session) {
    return null;
  }

  // Shared by manual typing and scan-to-search so both hit the exact same
  // searchMedicinesForSale relevance path — no new matching logic invented
  // for OCR (docs/plans/ocr.md). Returns both the matches and whether this
  // call is still the most recent one: a scan's search can take long enough
  // (capture + OCR + query) that a manual retype starts and finishes first,
  // and a stale scan result must never drive an auto-add after that
  // (docs/plans/ocr.md — Sale Entry stale-result safety).
  const runSearch = async (value: string): Promise<{ matches: MedicineSearchResult[]; isLatest: boolean }> => {
    const requestId = searchGuard.start();
    if (!value.trim()) {
      setResults([]);
      setIsSearching(false);
      return { matches: [], isLatest: searchGuard.isLatest(requestId) };
    }

    setIsSearching(true);
    try {
      const matches = await searchMedicinesForSale(session.shopId, value);
      const isLatest = searchGuard.isLatest(requestId);
      if (isLatest) {
        setResults(matches);
      }
      return { matches, isLatest };
    } catch {
      const isLatest = searchGuard.isLatest(requestId);
      if (isLatest) {
        setResults([]);
        setSearchError('Medicine search failed. Try again.');
      }
      return { matches: [], isLatest };
    } finally {
      if (searchGuard.isLatest(requestId)) {
        setIsSearching(false);
      }
    }
  };

  const handleQueryChange = async (value: string) => {
    setQuery(value);
    setSearchError(null);
    setScanFeedback(null);
    await runSearch(value);
  };

  // Read-only lookup: a scan just runs the same search a manual query would.
  // Auto-adds to cart only when the search is still current (not superseded
  // by a newer manual search while the scan was in flight) AND the sole
  // result's own name is an exact normalized match for what was scanned —
  // searchMedicinesForSale does FTS *prefix* matching, so "exactly one
  // result" alone is not enough evidence a short/truncated OCR read is
  // really that product (docs/plans/ocr.md). Anything less certain just
  // populates the list like any ambiguous typed query — never a dead end.
  const handleScanResult = async (recognizedText: string) => {
    const candidate = extractMedicineNameCandidate(recognizedText) ?? recognizedText.trim();
    setSearchError(null);
    setScanFeedback(null);
    setQuery(candidate);
    const { matches, isLatest } = await runSearch(candidate);
    if (!isLatest) {
      return;
    }
    const exactMatch = findExactNameMatch(candidate, matches);
    if (exactMatch) {
      addItem({
        medicineId: exactMatch.medicineId,
        medicineName: exactMatch.name,
        batchId: exactMatch.activeBatch.id,
        quantity: 1,
        unitPrice: exactMatch.activeBatch.salePrice,
      });
      setScanFeedback(`Added ${exactMatch.name} to cart from scan.`);
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
          onPress={() => setIsScannerVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Scan medicine strip"
          className="w-14 items-center justify-center rounded-lg border border-midGray bg-white active:opacity-80"
        >
          <Text className="text-xl">📷</Text>
        </Pressable>
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
      {scanFeedback ? <Text className="px-4 pb-2 font-sans text-sm text-brand-green">{scanFeedback}</Text> : null}
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
      <MedicineTextScanner
        visible={isScannerVisible}
        mode="lookup"
        onClose={() => setIsScannerVisible(false)}
        onTextRecognized={handleScanResult}
      />
    </View>
  );
}
