import { useEffect } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { daysUntilExpiry } from "@muthoy/utils";
import { EmptyState } from "../../components/ui/EmptyState";
import { StandardHeader } from "../../components/ui/StandardHeader";
import { getActiveBatchForMedicine } from "../../db/sales";
import { applyDiscount } from "../../domain/discounts";
import type { CatalogKey } from "../../i18n/catalog";
import { useCartStore, type CartLine } from "../../state/cartStore";
import { useI18n } from "../../state/localeStore";
import { useSessionStore } from "../../state/sessionStore";

const NEAR_EXPIRY_DAYS = 60;

export default function CartScreen() {
  const { t, formatNumber, formatMoney } = useI18n();
  const session = useSessionStore((state) => state.session);
  const items = useCartStore((state) => state.items);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const updateQuote = useCartStore((state) => state.updateQuote);
  const total = useCartStore((state) => state.total());
  const medicineIds = items
    .map((item) => item.medicineId)
    .sort()
    .join("|");
  useEffect(() => {
    if (!session) return;
    let current = true;
    void Promise.all(
      items.map(async (item) => {
        const batch = await getActiveBatchForMedicine(
          session.shopId,
          item.medicineId,
        );
        if (current && batch)
          updateQuote(item.medicineId, {
            batchId: batch.id,
            unitPrice: batch.salePrice,
            availableQuantity: batch.quantityAvailable,
            expiryDate: batch.expiryDate,
          });
      }),
    );
    return () => {
      current = false;
    };
    // Refresh when cart membership changes; quote writes do not retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medicineIds, session?.shopId, updateQuote]);

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={t("cartTitle")} onBackPress={() => router.back()} />
      {items.length > 0 ? (
        <Text className="px-4 pt-2 font-sans text-sm text-brand-green/70">
          {formatNumber(items.length)} {items.length === 1 ? t("itemCountLabel") : t("itemsCountLabel")}
        </Text>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.medicineId}
        contentContainerClassName="flex-grow gap-3 p-4"
        ListEmptyComponent={
          <EmptyState
            icon="shopping-bag"
            title={t("cartEmptyTitle")}
            message={t("cartEmptyMessage")}
            actionLabel={t("findMedicinesLabel")}
            onAction={() => router.replace("/sale")}
          />
        }
        renderItem={({ item }) => (
          <CartRow
            item={item}
            t={t}
            formatNumber={formatNumber}
            formatMoney={formatMoney}
            onQuantityChange={(quantity) =>
              updateQuantity(item.medicineId, quantity)
            }
            onRemove={() => removeItem(item.medicineId)}
          />
        )}
      />
      {items.length > 0 ? (
        <View className="gap-3 border-t border-midGray bg-white p-4">
          <View className="flex-row items-center justify-between rounded-2xl border-2 border-brand-green/20 bg-brand-softGreen px-4 py-3">
            <Text className="font-sans-bold text-lg text-richBlack">
              {t("totalLabel")}
            </Text>
            <Text className="font-mono text-3xl text-brand-green">
              {formatMoney(total)}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/sale/checkout")}
            accessibilityRole="button"
            accessibilityLabel={t("checkoutTitle")}
            className="items-center rounded-full bg-brand-green py-4 active:opacity-80"
          >
            <Text className="font-sans-semibold text-base text-white">
              {t("proceedToCheckoutLabel")} →
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/sale/held")}
            className="items-center py-2"
          >
            <Text className="text-sm text-midGray">
              {t("viewHeldSalesLabel")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.replace("/sale")}
            accessibilityRole="button"
            accessibilityLabel={t("addMoreItemsLabel")}
            className="items-center py-2 active:opacity-70"
          >
            <Text className="font-sans-semibold text-sm text-brand-green">
              {t("addMoreItemsLabel")}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function CartRow({
  item,
  t,
  formatNumber,
  formatMoney,
  onQuantityChange,
  onRemove,
}: {
  item: CartLine;
  t: (key: CatalogKey) => string;
  formatNumber: (value: number) => string;
  formatMoney: (value: import("@muthoy/types").Paisa) => string;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  const lineTotal = applyDiscount(
    item.unitPrice,
    item.quantity,
    item.discount,
  ).lineTotal;
  const maximum = item.availableQuantity ?? Number.MAX_SAFE_INTEGER;
  const days = daysUntilExpiry(item.expiryDate ?? null, new Date());
  const nearExpiry = days !== null && days < NEAR_EXPIRY_DAYS;
  return (
    <View className="gap-3 rounded-lg bg-white p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="font-sans-medium text-base text-richBlack">
            {item.medicineName}
          </Text>
          <Text className="font-mono text-xs text-midGray">
            {formatMoney(item.unitPrice)} {t("eachLabel")}
          </Text>
          {item.generic || item.manufacturer ? (
            <Text className="font-sans text-xs text-midGray">
              {[item.generic, item.manufacturer].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
        </View>
        <View className="items-end gap-2">
          <Text className="font-mono text-base text-brand-green">
            {formatMoney(lineTotal)}
          </Text>
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.medicineName}`}
            hitSlop={8}
          >
            <Feather name="trash-2" size={16} color="#DC2626" />
          </Pressable>
        </View>
      </View>
      {item.batchNo || item.expiryDate ? (
        <Text
          className={`font-sans text-xs ${nearExpiry ? "font-sans-semibold text-error" : "text-midGray"}`}
        >
          {item.batchNo ? `${t("batchNumberLabel")} #${item.batchNo}` : t("batchNumberLabel")}
          {item.expiryDate ? ` · ${t("expiryShortLabel")}: ${item.expiryDate}` : ""}
          {days !== null ? ` (${formatNumber(days)}${t("dayShortLabel")})` : ""}
        </Text>
      ) : null}
      <View className="flex-row gap-2">
        {[1, 5, 10, 20].map((quantity) => (
          <Pressable
            key={quantity}
            disabled={quantity > maximum}
            onPress={() => onQuantityChange(quantity)}
            accessibilityRole="button"
            accessibilityLabel={`Set ${item.medicineName} quantity to ${quantity}`}
            className={`flex-1 items-center rounded-lg py-2 ${item.quantity === quantity ? "bg-brand-green" : "bg-brand-softGreen"} disabled:opacity-30`}
          >
            <Text
              className={`font-mono text-xs ${item.quantity === quantity ? "text-white" : "text-richBlack"}`}
            >
              {formatNumber(quantity)}
            </Text>
          </Pressable>
        ))}
      </View>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-4">
          <Pressable
            onPress={() => onQuantityChange(Math.max(1, item.quantity - 1))}
            accessibilityRole="button"
            accessibilityLabel={`Decrease ${item.medicineName} quantity`}
            className="h-10 w-10 items-center justify-center rounded-lg border border-midGray active:opacity-70"
          >
            <Feather name="minus" size={16} color="#111827" />
          </Pressable>
          <TextInput
            value={String(item.quantity)}
            onChangeText={(value) => {
              const parsed = Number.parseInt(value, 10);
              if (Number.isInteger(parsed) && parsed > 0)
                onQuantityChange(parsed);
            }}
            onBlur={() => {
              if (item.quantity < 1) onQuantityChange(1);
            }}
            selectTextOnFocus
            keyboardType="number-pad"
            accessibilityLabel={`${item.medicineName} quantity`}
            className="h-10 w-16 rounded-lg border border-brand-green text-center font-mono text-base text-richBlack"
          />
          <Pressable
            onPress={() => onQuantityChange(item.quantity + 1)}
            disabled={item.quantity >= maximum}
            accessibilityRole="button"
            accessibilityLabel={`Increase ${item.medicineName} quantity`}
            className="h-10 w-10 items-center justify-center rounded-lg bg-brand-green active:opacity-70 disabled:opacity-30"
          >
            <Feather name="plus" size={16} color="#FFFFFF" />
          </Pressable>
        </View>
        <View className="items-end">
          <Text className="font-sans text-xs text-midGray">
            {t("subtotalLabel")}
          </Text>
          <Text className="font-mono text-xl text-brand-green">
            {formatMoney(lineTotal)}
          </Text>
        </View>
      </View>
      {item.quantity > maximum ? (
        <View className="flex-row items-start gap-2 rounded-lg bg-errorBg p-2">
          <Feather name="alert-triangle" size={13} color="#DC2626" />
          <Text className="flex-1 font-sans text-xs text-error">
            {t("insufficientStockAvailableLabel")} {formatNumber(maximum)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
