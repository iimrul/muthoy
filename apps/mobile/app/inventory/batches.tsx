import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { daysUntilExpiry, formatMoney, formatNumber } from "@muthoy/utils";
import { StandardHeader } from "../../components/ui/StandardHeader";
import { getMedicine, listBatchesForMedicine, type BatchDetailRow, type MedicineDetail } from "../../db/inventory";
import { usePermission } from "../../state/usePermission";
import { useI18n } from "../../state/localeStore";

// Every receipt goes through the supplier purchase ledger, including deep links
// to this legacy batch-list route. No stock-only restocking form remains here.
export default function BatchDetailScreen() {
  const { medicineId } = useLocalSearchParams<{ medicineId: string }>();
  const { session } = usePermission("inventory_edit");
  if (!session || !medicineId) return null;
  return <BatchDetailContent key={`${session.shopId}:${session.userId}:${medicineId}`} />;
}

function BatchDetailContent() {
  const { t } = useI18n();
  const { medicineId } = useLocalSearchParams<{ medicineId: string }>();
  const { session, isAllowed: canEdit } = usePermission("inventory_edit");
  const { isAllowed: canAdd } = usePermission("inventory_add");
  const [medicine, setMedicine] = useState<MedicineDetail | null>(null);
  const [batches, setBatches] = useState<BatchDetailRow[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  useFocusEffect(useCallback(() => {
    if (!session || !medicineId) return;
    let live = true;
    void Promise.all([getMedicine(session.shopId, medicineId), listBatchesForMedicine(session.shopId, medicineId)])
      .then(([detail, rows]) => { if (live) { setMedicine(detail); setBatches(rows); setLoadFailed(false); } })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, [session, medicineId]));
  if (!session || !medicineId) return null;
  return <View className="flex-1 bg-brand-softGreen">
    <StandardHeader title={medicine?.name ?? t("batchesCountLabel")} onBackPress={() => router.back()} />
    <ScrollView contentContainerClassName="gap-4 p-6" keyboardShouldPersistTaps="handled">
      {loadFailed ? <Text className="font-sans text-error">{t("restockLoadFailed")}</Text> : null}
      {canEdit ? <Pressable onPress={() => router.push({ pathname: "/inventory/edit-medicine", params: { medicineId } })}
        accessibilityRole="button" accessibilityLabel={t("editMedicineTitle")} className="rounded-lg bg-white p-3">
        <Text className="font-sans-semibold text-brand-green">{t("editMedicineTitle")}</Text>
      </Pressable> : null}
      {batches.map((batch) => <BatchRow key={batch.id} batch={batch} onEdit={canEdit ? () => router.push({ pathname: "/inventory/edit-batch" as never, params: { medicineId, batchId: batch.id } }) : undefined} />)}
      {canAdd ? <Pressable onPress={() => router.push({ pathname: "/inventory/add-batch" as never, params: { medicineId } })}
        accessibilityRole="button" accessibilityLabel={t("addBatchLabel")} className="rounded-lg bg-brand-green p-4">
        <Text className="font-sans-semibold text-white">{t("addBatchLabel")}</Text>
      </Pressable> : null}
    </ScrollView>
  </View>;
}

function BatchRow({
  batch,
  onEdit,
}: {
  batch: BatchDetailRow;
  onEdit?: () => void;
}) {
  const { t } = useI18n();
  const days = daysUntilExpiry(batch.expiryDate, new Date());
  const expiryLabel =
    days === null
      ? t("noExpiryLabel")
      : days < 0
        ? t("expiredLabel")
        : `${formatNumber(days)} ${t("daysLeftSuffix")}`;

  return (
    <Pressable
      onPress={onEdit}
      disabled={!onEdit}
      className="flex-row items-center justify-between rounded-lg bg-white p-4"
    >
      <View className="gap-1">
        <Text className="font-sans-medium text-base text-richBlack">
          {batch.batchNo}
        </Text>
        <Text className="font-sans text-xs text-midGray">
          {formatNumber(batch.quantityAvailable)} {t("inStockSuffix")} · {expiryLabel}
        </Text>
      </View>
      <Text className="font-mono text-base text-brand-green">
        {formatMoney(batch.salePrice)}
      </Text>
      {onEdit ? <Text className="ml-3 text-brand-green">{t("editLabel")}</Text> : null}
    </Pressable>
  );
}
