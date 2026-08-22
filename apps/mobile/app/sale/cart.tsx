import { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { formatMoney } from "@muthoy/utils";
import { EmptyState } from "../../components/ui/EmptyState";
import { StandardHeader } from "../../components/ui/StandardHeader";
import { cancelSaleDraft, holdSaleDraft } from "../../db/saleDrafts";
import { getActiveBatchForMedicine } from "../../db/sales";
import { applyDiscount } from "../../domain/discounts";
import { getDeviceId } from "../../native/deviceId";
import { useCartStore, type CartLine } from "../../state/cartStore";
import { captureSessionFor } from "../../state/sessionGuard";
import { useSessionStore } from "../../state/sessionStore";
import { triggerSyncNow } from "../../sync";

export default function CartScreen() {
  const session = useSessionStore((state) => state.session);
  const items = useCartStore((state) => state.items);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const updateQuote = useCartStore((state) => state.updateQuote);
  const total = useCartStore((state) => state.total());
  const clear = useCartStore((state) => state.clear);
  const resumedDraftId = useCartStore((state) => state.resumedDraftId);
  const resumedDraftDeviceId = useCartStore(
    (state) => state.resumedDraftDeviceId,
  );
  const [holding, setHolding] = useState(false);
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

  const hold = async () => {
    if (!session || !items.length) return;
    const guard = captureSessionFor(session);
    if (!guard) return;
    setHolding(true);
    try {
      await holdSaleDraft({
        shopId: session.shopId,
        actorUserId: session.userId,
        originDeviceId: getDeviceId(),
        isStillActive: guard.isStillActive,
        items: items.map((item) => ({
          medicineId: item.medicineId,
          quantity: item.quantity,
        })),
      });
      if (guard.isStale()) return;
      clear();
      void triggerSyncNow(session.shopId);
      router.replace("/sale");
    } catch (caught) {
      if (!guard.isStale())
        Alert.alert(
          "Could not hold sale",
          caught instanceof Error ? caught.message : "Try again.",
        );
    } finally {
      setHolding(false);
    }
  };
  const cancelCurrent = async () => {
    if (!session) return;
    const guard = captureSessionFor(session);
    if (!guard) return;
    try {
      if (resumedDraftId && resumedDraftDeviceId) {
        await cancelSaleDraft(
          session.shopId,
          session.userId,
          resumedDraftId,
          resumedDraftDeviceId,
          guard.isStillActive,
        );
        triggerSyncNow(session.shopId);
      }
      if (guard.isStale()) return;
      clear();
      router.replace("/sale");
    } catch (caught) {
      if (!guard.isStale())
        Alert.alert(
          "Could not cancel sale",
          caught instanceof Error ? caught.message : "Try again.",
        );
    }
  };

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Cart" onBackPress={() => router.back()} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.medicineId}
        contentContainerClassName="flex-grow gap-3 p-4"
        ListEmptyComponent={
          <EmptyState
            title="Cart is empty"
            message="Search for medicines to start a sale."
            actionLabel="Find medicines"
            onAction={() => router.replace("/sale")}
          />
        }
        renderItem={({ item }) => (
          <CartRow
            item={item}
            onQuantityChange={(quantity) =>
              updateQuantity(item.medicineId, quantity)
            }
            onRemove={() => removeItem(item.medicineId)}
          />
        )}
      />
      {items.length > 0 ? (
        <View className="gap-4 border-t border-midGray bg-white p-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-sans-bold text-lg text-richBlack">Total</Text>
            <Text className="font-mono text-xl text-brand-green">
              {formatMoney(total)}
            </Text>
          </View>
          <View className="flex-row gap-3">
            {!resumedDraftId ? (
              <Pressable
                onPress={hold}
                disabled={holding}
                className="flex-1 items-center rounded-lg border border-brand-green py-3"
              >
                <Text className="text-brand-green">
                  {holding ? "Holding…" : "Hold"}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => router.push("/sale/checkout")}
              accessibilityRole="button"
              accessibilityLabel="Checkout"
              className="flex-1 items-center rounded-lg bg-brand-green py-3 active:opacity-80"
            >
              <Text className="font-sans-semibold text-base text-white">
                Checkout
              </Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() => router.push("/sale/held")}
            className="items-center py-2"
          >
            <Text className="text-sm text-midGray">View held sales</Text>
          </Pressable>
          <Pressable
            onPress={() => void cancelCurrent()}
            className="items-center py-2"
          >
            <Text className="text-sm text-error">Cancel current sale</Text>
          </Pressable>
          <Pressable
            onPress={() => router.replace("/sale")}
            accessibilityRole="button"
            accessibilityLabel="Continue sale"
            className="items-center py-2 active:opacity-70"
          >
            <Text className="font-sans-semibold text-sm text-brand-green">
              + Add more items
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function CartRow({
  item,
  onQuantityChange,
  onRemove,
}: {
  item: CartLine;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  const lineTotal = applyDiscount(
    item.unitPrice,
    item.quantity,
    item.discount,
  ).lineTotal;
  const maximum = item.availableQuantity ?? Number.MAX_SAFE_INTEGER;
  return (
    <View className="gap-3 rounded-lg bg-white p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="font-sans-medium text-base text-richBlack">
            {item.medicineName}
          </Text>
          <Text className="font-mono text-xs text-midGray">
            {formatMoney(item.unitPrice)} each
          </Text>
        </View>
        <View className="items-end gap-2">
          <Text className="font-mono text-base text-brand-green">
            {formatMoney(lineTotal)}
          </Text>
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.medicineName}`}
          >
            <Text className="font-sans-semibold text-xs text-error">
              Remove
            </Text>
          </Pressable>
        </View>
      </View>
      {item.batchNo || item.expiryDate ? (
        <Text className="font-sans text-xs text-midGray">
          {item.batchNo ? `Batch ${item.batchNo}` : "Batch"}
          {item.expiryDate ? ` · Exp ${item.expiryDate}` : ""}
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
              {quantity}
            </Text>
          </Pressable>
        ))}
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
          <Text className="font-sans-bold text-xl text-white">+</Text>
        </Pressable>
      </View>
    </View>
  );
}
