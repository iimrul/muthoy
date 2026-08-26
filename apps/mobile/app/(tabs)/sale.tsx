import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { asPaisa } from "@muthoy/types";
import { daysUntilExpiry } from "@muthoy/utils";
import { MedicineTextScanner } from "../../components/scanner/MedicineTextScanner";
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
import {
  extractMedicineNameCandidate,
  findExactNameMatch,
} from "../../domain/ocrText";
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
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SaleInsightMode>("all");
  const [results, setResults] = useState<MedicineSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [addedToCartName, setAddedToCartName] = useState<string | null>(null);
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const [barcodeCandidates, setBarcodeCandidates] = useState<
    BarcodeCandidate[]
  >([]);
  const [searchGuard] = useState(() => createLatestRequestGuard());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, [mode, query, session, t]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  if (!session) {
    return null;
  }

  const showAddedToCartToast = (name: string) => {
    setAddedToCartName(name);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setAddedToCartName(null), 1800);
  };

  const addLineAndReport = (line: Parameters<typeof addItem>[0]): boolean => {
    if (!addItem(line)) {
      setScanFeedback(t("cartQuantityAtStockLimitLabel"));
      return false;
    }
    showAddedToCartToast(line.medicineName);
    return true;
  };

  // Shared by manual typing and scan-to-search so both hit the exact same
  // searchMedicinesForSale relevance path — no new matching logic invented
  // for OCR (docs/plans/ocr.md). Returns both the matches and whether this
  // call is still the most recent one: a scan's search can take long enough
  // (capture + OCR + query) that a manual retype starts and finishes first,
  // and a stale scan result must never drive an auto-add after that
  // (docs/plans/ocr.md — Sale Entry stale-result safety).
  const runSearch = async (
    value: string,
  ): Promise<{ matches: MedicineSearchResult[]; isLatest: boolean }> => {
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
    const candidate =
      extractMedicineNameCandidate(recognizedText) ?? recognizedText.trim();
    setSearchError(null);
    setScanFeedback(null);
    setQuery(candidate);
    const { matches, isLatest } = await runSearch(candidate);
    if (!isLatest) {
      return;
    }
    const exactMatch = findExactNameMatch(candidate, matches);
    if (exactMatch) {
      addLineAndReport({
        medicineId: exactMatch.medicineId,
        medicineName: exactMatch.name,
        generic: exactMatch.generic,
        manufacturer: exactMatch.manufacturer,
        requiresPrescription: exactMatch.requiresPrescription,
        batchId: exactMatch.activeBatch.id,
        batchNo: exactMatch.activeBatchNo ?? undefined,
        quantity: 1,
        unitPrice: exactMatch.activeBatch.salePrice,
        expiryDate: exactMatch.activeBatch.expiryDate,
        availableQuantity: exactMatch.activeBatch.quantityAvailable,
      });
    }
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
      {addedToCartName ? (
        <View
          pointerEvents="none"
          className="absolute left-0 right-0 top-20 items-center px-4"
        >
          <View className="w-full max-w-md flex-row items-center gap-3 rounded-2xl bg-brand-green px-5 py-4">
            <View className="h-9 w-9 items-center justify-center rounded-full bg-white/20">
              <Feather name="check-circle" size={20} color="#FFFFFF" />
            </View>
            <View>
              <Text className="font-sans text-xs text-white/90">
                {t("addedToCartLabel")}
              </Text>
              <Text className="font-sans-bold text-sm text-white">
                {addedToCartName}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
      <MedicineTextScanner
        visible={isScannerVisible}
        mode="lookup"
        onClose={() => setIsScannerVisible(false)}
        onTextRecognized={handleScanResult}
        onBarcodeRecognized={handleBarcode}
        keepOpenOnResult
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
