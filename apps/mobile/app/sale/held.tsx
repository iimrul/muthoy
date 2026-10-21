import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { EmptyState } from "../../components/ui/EmptyState";
import { StandardHeader } from "../../components/ui/StandardHeader";
import { getActiveBatchForMedicine } from "../../db/sales";
import {
  cancelSaleDraft,
  getSaleDraft,
  listSaleDrafts,
  type SaleDraftRow,
} from "../../db/saleDrafts";
import { parseCheckoutSnapshot } from "../../domain/checkoutSnapshot";
import { getDeviceId } from "../../native/deviceId";
import { useCartStore } from "../../state/cartStore";
import { captureSessionFor } from "../../state/sessionGuard";
import { useSessionStore } from "../../state/sessionStore";
import { triggerSyncNow } from "../../sync";
import { useI18n } from "../../state/localeStore";
import { ownKey, userFacingError } from "../../i18n/display";
import type { CatalogKey } from "../../i18n/catalog";

/**
 * A held cart's status is our vocabulary, so it is translated. The timestamp
 * goes through formatDateTime: `toLocaleString()` follows the DEVICE locale,
 * so a phone set to English rendered an English date on a Bangla screen.
 */
const DRAFT_STATUS_KEYS: Record<string, CatalogKey> = {
  draft: 'statusDraft',
  held: 'statusHeld',
  cancelled: 'statusCancelled',
  completed: 'statusCompleted',
};

export default function HeldSalesScreen() {
  const { t, formatNumber, formatDateTime } = useI18n();
  const session = useSessionStore((state) => state.session);
  const clear = useCartStore((state) => state.clear);
  const addItem = useCartStore((state) => state.addItem);
  const setResumedDraft = useCartStore((state) => state.setResumedDraft);
  const setCheckoutSnapshot = useCartStore((state) => state.setCheckoutSnapshot);
  const [rows, setRows] = useState<SaleDraftRow[]>([]);
  const reload = useCallback(async () => {
    if (session)
      setRows(
        await listSaleDrafts(session.shopId, session.userId, getDeviceId()),
      );
  }, [session]);
  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [reload]);
  if (!session) return null;

  const resume = async (draftId: string) => {
    try {
      const held = await getSaleDraft(session.shopId, session.userId, draftId);
      const quoted = await Promise.all(
        held.items.map(async (item) => ({
          item,
          batch: await getActiveBatchForMedicine(
            session.shopId,
            item.medicineId,
          ),
        })),
      );
      if (quoted.some(({ batch }) => !batch))
        throw new Error("One or more medicines have no sellable stock.");
      clear();
      quoted.forEach(
        ({ item, batch }) =>
          batch &&
          addItem({
            medicineId: item.medicineId,
            medicineName: item.medicineName,
            generic: item.generic,
            manufacturer: item.manufacturer,
            requiresPrescription: item.requiresPrescription,
            batchId: batch.id,
            quantity: item.quantity,
            unitPrice: batch.salePrice,
            expiryDate: batch.expiryDate,
            availableQuantity: batch.quantityAvailable,
          }),
      );
      setCheckoutSnapshot(parseCheckoutSnapshot(held.draft.checkoutSnapshot));
      setResumedDraft(draftId, getDeviceId());
      router.replace("/sale/cart");
    } catch (caught) {
      Alert.alert(
        t("resumeSaleFailedTitle"),
        userFacingError(caught, "pleaseTryAgain", t),
      );
    }
  };
  const cancel = async (draftId: string) => {
    const guard = captureSessionFor(session);
    if (!guard) return;
    try {
      await cancelSaleDraft(
        session.shopId,
        session.userId,
        draftId,
        getDeviceId(),
        guard.isStillActive,
      );
      void triggerSyncNow(session.shopId);
      await guard.ifLiveAsync(reload);
    } catch (caught) {
      if (!guard.isStale())
        Alert.alert(
          t("cancelSaleFailedTitle"),
          userFacingError(caught, "pleaseTryAgain", t),
        );
    }
  };
  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={t("heldSalesTitle")} onBackPress={() => router.back()} />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerClassName="flex-grow gap-3 p-4"
        onRefresh={reload}
        refreshing={false}
        ListEmptyComponent={
          <EmptyState
            title={t("noHeldSales")}
            message={t("heldSalesEmptyBody")}
          />
        }
        renderItem={({ item }) => (
          <View className="gap-3 rounded-lg bg-white p-4">
            <Text className="font-sans-semibold">
              {formatNumber(item.itemCount)} {t('itemsSuffix')} · {item.actorName}
            </Text>
            <Text className="text-xs text-midGray">
              {formatDateTime(item.updatedAt)} ·{' '}
              {t(ownKey(DRAFT_STATUS_KEYS, item.status) ?? 'statusDraft')}
            </Text>
            {item.canMutate ? (
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => void cancel(item.id)}
                  className="flex-1 items-center rounded border border-error py-2"
                >
                  <Text className="text-error">{t("cancel")}</Text>
                </Pressable>
                <Pressable
                  onPress={() => void resume(item.id)}
                  className="flex-1 items-center rounded bg-brand-green py-2"
                >
                  <Text className="text-white">{t("resumeLabel")}</Text>
                </Pressable>
              </View>
            ) : (
              <Text className="text-xs text-midGray">
                {t("heldReadOnlyNote")}
              </Text>
            )}
          </View>
        )}
      />
    </View>
  );
}
