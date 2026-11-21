import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { AppTextInput as TextInput } from "../../components/ui/AppTextInput";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { asPaisa } from "@muthoy/types";
import { daysUntilExpiry } from "@muthoy/utils";
import { LiveStripScanner } from "../../components/scanner/LiveStripScanner";
import { showToast } from "../../components/ui/Toast";
import { EmptyState } from "../../components/ui/EmptyState";
import { StandardHeader } from "../../components/ui/StandardHeader";
import {
  listSaleInsights,
  searchMedicinesForSale,
  type MedicineSearchResult,
  type SaleInsightMode,
} from "../../db/sales";
import { getActiveBatchForMedicine } from "../../db/sales";
import {
  searchBarcodeCandidates,
  type BarcodeCandidate,
} from "../../db/inventory";
import { createLatestRequestGuard } from "../../domain/latestRequestGuard";
import { useCartStore } from "../../state/cartStore";
import { useI18n } from "../../state/localeStore";
import { useSessionStore } from "../../state/sessionStore";
import { useUnreadCount } from "../../state/useUnreadCount";

const FILTER_PILLS = [
  { value: "all", icon: "shopping-bag", labelKey: "allMedicineLabel" },
  { value: "recent", icon: "clock", labelKey: "recentSalesLabel" },
  { value: "top", icon: "trending-up", labelKey: "topSalesLabel" },
  { value: "favorites", icon: "star", labelKey: "favoritesLabel" },
] as const;

const NEAR_EXPIRY_DAYS = 60;

export default function SaleEntryScreen() {
  const { t, formatNumber, formatMoney } = useI18n();
  const session = useSessionStore((state) => state.session);
  const unreadCount = useUnreadCount(session?.shopId, session?.userId);
  const addItem = useCartStore((state) => state.addItem);
  const cartCount = useCartStore((state) =>
    state.items.reduce((sum, item) => sum + item.quantity, 0),
  );
  // app/scan.tsx hands a scan over here for correction, carrying the
  // recognised text as a route param, so the manual search opens pre-filled
  // rather than making the user retype what the camera already read.
  const params = useLocalSearchParams<{ q?: string }>();
  const handedOverQuery = typeof params.q === "string" ? params.q.trim() : "";
  const [query, setQuery] = useState(handedOverQuery);
  const [mode, setMode] = useState<SaleInsightMode>("all");
  const [results, setResults] = useState<MedicineSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const [barcodeCandidates, setBarcodeCandidates] = useState<
    BarcodeCandidate[]
  >([]);
  const [searchGuard] = useState(() => createLatestRequestGuard());
  const hasRunHandedOverQuery = useRef(false);
  // The Sale tab is now kept mounted (app/(tabs)/_layout.tsx), so coming back
  // to it must refresh stock and prices — but only AFTER the tab has been
  // shown, so the tap itself is answered at once. The first focus is the mount,
  // which already loads.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const hasFocusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnce.current) {
        hasFocusedOnce.current = true;
        return undefined;
      }
      const timer = setTimeout(() => setRefreshNonce((value) => value + 1), 0);
      return () => clearTimeout(timer);
    }, []),
  );

  useEffect(() => {
    if (!session || query.trim()) return;
    let current = true;
    const timer = setTimeout(() => {
      setIsSearching(true);
      void listSaleInsights(session.shopId, mode)
        .then((rows) => {
          if (current) setResults(rows);
        })
        .catch(() => {
          if (current) setSearchError(t("medicineInsightsFailedLabel"));
        })
        .finally(() => {
          if (current) setIsSearching(false);
        });
    }, 0);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [mode, query, session, t, refreshNonce]);

  // The typed search (and a query handed over from another screen). Returns
  // both the matches and whether this call is still the most recent one, so a
  // slow search that a newer keystroke overtook never overwrites the results.
  // Scanning no longer goes through here: the live strip scanner matches
  // against the shop's whole inventory in memory (domain/stripMatcher.ts).
  //
  // Declared HERE, above the effects and above the `!session` guard below, and
  // wrapped in useCallback: the handed-over-query effect calls it, and an
  // effect that reaches forward to a function declared later in the body is
  // both a temporal-dead-zone hazard and a lint error
  // (react-hooks/immutability). W2-01 introduced that shape; this is the fix.
  // The session guard moves inside, since the function may now be defined
  // before the component has decided whether it has a session.
  const runSearch = useCallback(
    async (
      value: string,
    ): Promise<{ matches: MedicineSearchResult[]; isLatest: boolean }> => {
      if (!session) return { matches: [], isLatest: true };
      const requestId = searchGuard.start();
      if (!value.trim()) {
        setResults(await listSaleInsights(session.shopId, mode));
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
          setSearchError(t("medicineSearchFailedRetryLabel"));
        }
        return { matches: [], isLatest };
      } finally {
        if (searchGuard.isLatest(requestId)) {
          setIsSearching(false);
        }
      }
    },
    [mode, searchGuard, session, t],
  );

  useEffect(() => {
    if (!session || !handedOverQuery || hasRunHandedOverQuery.current) return;
    hasRunHandedOverQuery.current = true;
    void runSearch(handedOverQuery);
  }, [handedOverQuery, runSearch, session]);

  // A typed search shown when the tab is left is re-run when it comes back,
  // so its stock and prices are current. Typing itself searches per keystroke.
  useEffect(() => {
    if (refreshNonce === 0 || !query.trim()) return undefined;
    const timer = setTimeout(() => void runSearch(query), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refocus refresh only
  }, [refreshNonce]);

  if (!session) {
    return null;
  }

  const addLineAndReport = (line: Parameters<typeof addItem>[0]): boolean => {
    if (!addItem(line)) {
      setScanFeedback(t("cartQuantityAtStockLimitLabel"));
      return false;
    }
    showToast({ variant: 'card', label: t('addedToCartLabel'), message: line.medicineName });
    return true;
  };

  const handleQueryChange = async (value: string) => {
    setQuery(value);
    setSearchError(null);
    setScanFeedback(null);
    await runSearch(value);
  };

  const addBarcodeCandidate = async (candidate: BarcodeCandidate) => {
    const batch = await getActiveBatchForMedicine(
      session.shopId,
      candidate.medicineId,
    );
    if (!batch || candidate.disabledReason) {
      setScanFeedback(candidate.disabledReason ?? t("noSellableBatchLabel"));
      return;
    }
    addLineAndReport({
      medicineId: candidate.medicineId,
      medicineName: candidate.name,
      batchId: batch.id,
      quantity: 1,
      unitPrice: candidate.effectiveUnitPrice ?? batch.salePrice,
      expiryDate: batch.expiryDate,
      availableQuantity: batch.quantityAvailable,
    });
    setBarcodeCandidates([]);
  };

  const handleBarcode = async (barcode: string) => {
    const matches = await searchBarcodeCandidates(session.shopId, barcode);
    if (!matches.length) return setScanFeedback(t("barcodeNotFoundLabel"));
    const enabled = matches.filter((candidate) => !candidate.disabledReason);
    if (matches.length === 1 && enabled[0])
      await addBarcodeCandidate(enabled[0]);
    else setBarcodeCandidates(matches);
  };

  const handleAddResult = (item: MedicineSearchResult) => {
    addLineAndReport({
      medicineId: item.medicineId,
      medicineName: item.name,
      generic: item.generic,
      manufacturer: item.manufacturer,
      requiresPrescription: item.requiresPrescription,
      batchId: item.activeBatch.id,
      batchNo: item.activeBatchNo ?? undefined,
      quantity: 1,
      unitPrice: item.activeBatch.salePrice,
      expiryDate: item.activeBatch.expiryDate,
      availableQuantity: item.activeBatch.quantityAvailable,
    });
  };

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader
        title={t("sale")}
        onBellPress={() => router.push("/notifications")}
        unreadCount={unreadCount}
      />
      <View className="flex-row gap-3 p-4 pb-2">
        <View className="relative flex-1">
          <View className="absolute inset-y-0 left-3 z-10 items-center justify-center">
            <Feather name="search" size={18} color="#6B7280" />
          </View>
          <TextInput
            value={query}
            onChangeText={handleQueryChange}
            placeholder={t("searchMedicineOrGenericPlaceholder")}
            accessibilityLabel={t("searchMedicineOrGenericPlaceholder")}
            autoCapitalize="none"
            className="rounded-lg border border-midGray bg-white py-3 pl-10 pr-4 font-sans text-base text-richBlack"
          />
        </View>
        <Pressable
          onPress={() => setIsScannerVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={t("scanMedicineStripLabel")}
          className="w-14 items-center justify-center rounded-lg border border-midGray bg-white active:opacity-80"
        >
          <Feather name="camera" size={20} color="#059669" />
        </Pressable>
        <Pressable
          onPress={() => router.push("/sale/cart")}
          accessibilityRole="button"
          accessibilityLabel={`${t("cartTitle")}: ${cartCount}`}
          className="min-w-14 flex-row items-center justify-center gap-1.5 rounded-lg bg-brand-green px-3 active:opacity-80"
        >
          <Feather name="shopping-cart" size={16} color="#FFFFFF" />
          <Text className="font-mono text-base text-white">
            {formatNumber(cartCount)}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => router.push("/sale/held")}
          accessibilityLabel={t("heldSalesLabel")}
          className="flex-row items-center gap-1 rounded-lg border border-midGray bg-white px-3"
        >
          <Feather name="clock" size={14} color="#111827" />
          <Text className="text-xs text-richBlack">
            {t("heldSalesLabel")}
          </Text>
        </Pressable>
      </View>
      {!query.trim() ? (
        <View className="flex-row gap-2 px-4 pb-2">
          {FILTER_PILLS.map((pill) => {
            const active = mode === pill.value;
            return (
              <Pressable
                key={pill.value}
                onPress={() => setMode(pill.value)}
                className={`flex-row items-center gap-1.5 rounded-full px-3 py-2 ${
                  active ? "bg-brand-green" : "bg-white"
                }`}
              >
                <Feather
                  name={pill.icon}
                  size={13}
                  color={active ? "#FFFFFF" : "#3D4A42"}
                />
                <Text
                  className={`font-sans-medium text-xs ${
                    active ? "text-white" : "text-richBlack"
                  }`}
                >
                  {t(pill.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {searchError ? (
        <Text className="px-4 pb-2 font-sans text-sm text-error">
          {searchError}
        </Text>
      ) : null}
      {scanFeedback ? (
        <Text className="px-4 pb-2 font-sans text-sm text-brand-green">
          {scanFeedback}
        </Text>
      ) : null}
      <FlatList
        data={results}
        keyExtractor={(item) => item.medicineId}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="flex-grow gap-3 p-4"
        ListEmptyComponent={
          <EmptyState
            icon="package"
            title={
              isSearching
                ? t("searchingTitle")
                : query.trim()
                  ? t("noMedicinesFoundTitle")
                  : t("noSellableMedicinesTitle")
            }
            message={
              isSearching
                ? t("searchingMessage")
                : query.trim()
                  ? t("noMedicinesFoundMessage")
                  : t("noSellableMedicinesMessage")
            }
          />
        }
        renderItem={({ item, index }) => {
          const stock = item.activeBatch.quantityAvailable;
          const days = daysUntilExpiry(item.activeBatch.expiryDate, new Date());
          const nearExpiry = days !== null && days < NEAR_EXPIRY_DAYS;
          return (
            <Pressable
              onPress={() => handleAddResult(item)}
              accessibilityRole="button"
              accessibilityLabel={`Add ${item.name} to cart`}
              className="relative flex-row items-start justify-between rounded-xl border border-[#E5E7EB] bg-white p-4 active:opacity-80"
            >
              {index === 0 && !query.trim() ? (
                <View className="absolute bottom-1/4 left-0 top-1/4 w-1 rounded-r-full bg-[#85F8C4]" />
              ) : null}
              <View className={`flex-1 gap-1 pr-3 ${index === 0 && !query.trim() ? "pl-2" : ""}`}>
                <Text className="font-sans-bold text-base text-richBlack">
                  {item.name}
                </Text>
                {item.generic || item.manufacturer ? (
                  <Text className="font-sans-medium text-xs text-midGray">
                    {[item.generic, item.manufacturer]
                      .filter(Boolean)
                      .join(" • ")}
                  </Text>
                ) : null}
                {item.activeBatchNo || item.activeBatch.expiryDate ? (
                  <Text
                    className={`font-sans text-[10px] ${nearExpiry ? "font-sans-semibold text-error" : "text-midGray"}`}
                  >
                    {item.activeBatchNo
                      ? `${t("batchNumberLabel")} #${item.activeBatchNo}`
                      : t("batchNumberLabel")}
                    {item.activeBatch.expiryDate
                      ? ` · ${t("expiryShortLabel")}: ${item.activeBatch.expiryDate}`
                      : ""}
                    {days !== null ? ` (${formatNumber(days)}${t("dayShortLabel")})` : ""}
                  </Text>
                ) : null}
                <View className="flex-row flex-wrap items-center gap-1.5 pt-0.5">
                  {stock > 20 ? (
                    <View className="rounded bg-[#A6F2D1] px-2 py-0.5">
                      <Text className="font-sans-bold text-[10px] uppercase tracking-wider text-[#237157]">
                        {t("inStockLabel")}: {formatNumber(stock)}
                      </Text>
                    </View>
                  ) : stock > 0 ? (
                    <View className="rounded bg-[#FFDAD7] px-2 py-0.5">
                      <Text className="font-sans-bold text-[10px] uppercase tracking-wider text-[#7F2928]">
                        {t("lowStock")}: {formatNumber(stock)}
                      </Text>
                    </View>
                  ) : (
                    <View className="rounded bg-[#E5E7EB] px-2 py-0.5">
                      <Text className="font-sans-bold text-[10px] uppercase tracking-wider text-[#6B7280]">
                        {t("outOfStockLabel")}
                      </Text>
                    </View>
                  )}
                  {item.promotionBps > 0 ? (
                    <View className="flex-row items-center gap-1 rounded bg-brand-green px-2 py-0.5">
                      <Feather name="tag" size={9} color="#FFFFFF" />
                      <Text className="font-sans-bold text-[10px] uppercase tracking-wider text-white">
                        {formatNumber(Math.round(item.promotionBps / 100))}% {t("offLabel")}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <View className="items-end gap-2">
                {item.promotionBps > 0 ? (
                  <>
                    <Text className="font-mono text-xs text-midGray line-through">
                      {formatMoney(item.originalUnitPrice)}
                    </Text>
                  </>
                ) : null}
                <Text className="font-mono text-base text-brand-green">
                  {formatMoney(item.activeBatch.salePrice)}
                </Text>
                {item.promotionBps > 0 ? (
                  <Text className="font-sans-bold text-[9px] uppercase tracking-wide text-brand-green">
                    {t("saveLabel")} {formatMoney(asPaisa(item.originalUnitPrice - item.activeBatch.salePrice))}
                  </Text>
                ) : null}
                <View
                  className={`h-10 w-10 items-center justify-center rounded-full ${stock === 0 ? "bg-[#E5E7EB]" : "bg-brand-green"}`}
                >
                  <Feather
                    name="shopping-cart"
                    size={18}
                    color={stock === 0 ? "#9CA3AF" : "#FFFFFF"}
                  />
                </View>
              </View>
            </Pressable>
          );
        }}
      />
      {query.trim() && results.length === 50 ? (
        <View className="mx-4 mb-3 rounded-xl border border-[#F59E0B] bg-[#FEF3C7] p-3">
          <Text className="text-center font-sans-semibold text-sm text-[#92400E]">
            {t("moreThanFiftyResultsLabel")}
          </Text>
        </View>
      ) : null}
      {cartCount > 0 ? (
        <Pressable
          onPress={() => router.push("/sale/checkout")}
          className="absolute bottom-24 right-4 items-center gap-1 rounded-2xl border-2 border-brand-deepGreen bg-white px-4 py-3"
        >
          <View className="flex-row items-center gap-1.5">
            <Feather name="shopping-cart" size={14} color="#006948" />
            <Text className="font-sans-bold text-xs text-brand-deepGreen">
              {t("checkoutTitle")}
            </Text>
          </View>
          <Text className="font-mono text-sm text-brand-deepGreen">
            {formatMoney(useCartStore.getState().total())}
          </Text>
        </Pressable>
      ) : null}
      {/* The same live scanner app/scan.tsx renders (founder decision
          2026-11-20): a confident strip adds one unit with an Undo window. */}
      <LiveStripScanner
        visible={isScannerVisible}
        shopId={session.shopId}
        userId={session.userId}
        onClose={() => setIsScannerVisible(false)}
        onDone={() => {
          // Closed first: the scanner is a native modal and would otherwise
          // stay on top of the cart screen pushed below it.
          setIsScannerVisible(false);
          router.push("/sale/cart");
        }}
        onBarcodeRecognized={handleBarcode}
      />
      <Modal
        visible={barcodeCandidates.length > 0}
        transparent
        animationType="fade"
        onRequestClose={() => setBarcodeCandidates([])}
      >
        <View className="flex-1 justify-end bg-black/40">
          <View className="gap-3 rounded-t-2xl bg-white p-5">
            <Text className="font-sans-bold text-lg">
              {t("chooseMedicineLabel")}
            </Text>
            {barcodeCandidates.map((candidate) => (
              <Pressable
                key={candidate.medicineId}
                disabled={Boolean(candidate.disabledReason)}
                onPress={() => void addBarcodeCandidate(candidate)}
                className="rounded-lg border border-midGray p-4 disabled:opacity-40"
              >
                <Text>{candidate.name}</Text>
                <Text className="text-xs text-midGray">
                  {candidate.disabledReason ??
                    `${formatNumber(candidate.sellableStock)} · ${candidate.effectiveUnitPrice ? formatMoney(candidate.effectiveUnitPrice) : "—"}`}
                </Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setBarcodeCandidates([])}
              className="items-center p-3"
            >
              <Text>{t("cancelLabel")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
