import { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { medicineMetadataSchema } from "@muthoy/validation";
import Feather from "@expo/vector-icons/Feather";
import { AccessDenied } from "../../components/ui/AccessDenied";
import { StandardHeader } from "../../components/ui/StandardHeader";
import {
  archiveMedicine,
  getMedicine,
  listBatchesForMedicine,
  updateMedicine,
  type BatchDetailRow,
} from "../../db/inventory";
import { useI18n } from "../../state/localeStore";
import { captureSessionFor } from "../../state/sessionGuard";
import { usePermission } from "../../state/usePermission";
import { triggerSyncNow } from "../../sync";

export default function EditMedicineScreen() {
  const { medicineId } = useLocalSearchParams<{ medicineId: string }>();
  const { session, isAllowed } = usePermission("inventory_edit");
  const { t, formatDate, formatMoney, formatNumber } = useI18n();
  const [name, setName] = useState("");
  const [generic, setGeneric] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [barcode, setBarcode] = useState("");
  const [threshold, setThreshold] = useState("");
  const [requiresPrescription, setRequiresPrescription] = useState(false);
  const [batches, setBatches] = useState<BatchDetailRow[]>([]);
  const [saving, setSaving] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!session || !medicineId) return;
      void Promise.all([
        getMedicine(session.shopId, medicineId),
        listBatchesForMedicine(session.shopId, medicineId),
      ]).then(([row, batchRows]) => {
        if (!row) return;
        setName(row.name);
        setGeneric(row.generic ?? "");
        setManufacturer(row.manufacturer ?? "");
        setBarcode(row.barcode ?? "");
        setThreshold(String(row.threshold));
        setRequiresPrescription(row.requiresPrescription);
        setBatches(batchRows);
      });
    }, [medicineId, session]),
  );
  if (!session || !isAllowed || !medicineId) return <AccessDenied />;
  const save = async () => {
    const guard = captureSessionFor(session);
    if (!guard) return;
    setSaving(true);
    try {
      const parsed = medicineMetadataSchema.parse({
        name,
        generic,
        manufacturer,
        barcode,
        requiresPrescription,
        lowStockThresholdOverride: threshold.trim() ? Number(threshold) : null,
      });
      await updateMedicine({
        shopId: session.shopId,
        actorUserId: session.userId,
        medicineId,
        isStillActive: guard.isStillActive,
        values: parsed,
      });
      void triggerSyncNow(session.shopId);
      guard.ifLive(() => router.back());
    } catch (caught) {
      if (!guard.isStale())
        Alert.alert(
          t("updateMedicineFailedLabel"),
          caught instanceof Error ? caught.message : t("tryAgainLabel"),
        );
    } finally {
      setSaving(false);
    }
  };
  const archive = async () => {
    const guard = captureSessionFor(session);
    if (!guard) return;
    try {
      await archiveMedicine(
        session.shopId,
        session.userId,
        medicineId,
        guard.isStillActive,
      );
      void triggerSyncNow(session.shopId);
      guard.ifLive(() => router.replace("/inventory"));
    } catch (caught) {
      if (!guard.isStale())
        Alert.alert(
          t("medicineArchiveFailedTitle"),
          caught instanceof Error
            ? caught.message
            : t("medicineArchiveRequirementsLabel"),
        );
    }
  };
  return (
    <View className="flex-1 bg-[#F9F9FC]">
      <StandardHeader
        title={t("editMedicineTitle")}
        onBackPress={() => router.back()}
      />
      <ScrollView contentContainerClassName="gap-4 p-4 pb-32">
        <View className="gap-4 rounded-2xl bg-white p-4 shadow-sm">
          <View className="flex-row items-center gap-2">
            <View className="h-9 w-9 items-center justify-center rounded-lg bg-brand-softGreen">
              <Feather name="file-text" size={17} color="#059669" />
            </View>
            <Text className="font-sans-bold text-base text-richBlack">
              {t("medicineDetailsLabel")}
            </Text>
          </View>
          <Field label={t("medicineNameLabel")} value={name} onChange={setName} />
          <Field label={t("genericNameLabel")} value={generic} onChange={setGeneric} />
          <Field
            label={t("manufacturerLabel")}
            value={manufacturer}
            onChange={setManufacturer}
          />
          <Field label={t("barcodeLabel")} value={barcode} onChange={setBarcode} />
          <Field
            label={t("minimumStockLabel")}
            value={threshold}
            onChange={setThreshold}
            numeric
          />
          <View className="flex-row items-center justify-between rounded-xl border border-[#D1D5DB] bg-white p-3">
            <View className="flex-1 gap-0.5 pr-3">
              <Text className="font-sans-semibold text-sm text-richBlack">
                {t("requiresPrescriptionLabel")}
              </Text>
              <Text className="font-sans text-xs text-midGray">
                {t("requiresPrescriptionHint")}
              </Text>
            </View>
            <Switch
              value={requiresPrescription}
              onValueChange={setRequiresPrescription}
              accessibilityLabel={t("requiresPrescriptionLabel")}
            />
          </View>
          <View className="flex-row gap-3">
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel={t("cancelLabel")}
              className="h-12 flex-1 items-center justify-center rounded-xl border border-brand-green bg-white"
            >
              <Text className="font-sans-bold text-brand-green">
                {t("cancelLabel")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void save()}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={t("saveChangesLabel")}
              className="h-12 flex-1 items-center justify-center rounded-xl bg-brand-green disabled:opacity-40"
            >
              <Text className="font-sans-bold text-white">
                {saving ? t("savingChangesLabel") : t("saveChangesLabel")}
              </Text>
            </Pressable>
          </View>
        </View>

        <View className="gap-3 rounded-2xl bg-white p-4 shadow-sm">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-9 w-9 items-center justify-center rounded-lg bg-[#CFE6F2]">
                <Feather name="layers" size={17} color="#526772" />
              </View>
              <Text className="font-sans-bold text-base text-richBlack">
                {t("batchesAndStockLabel")}
              </Text>
            </View>
            <View className="rounded-full bg-brand-softGreen px-2 py-1">
              <Text className="font-sans-bold text-[10px] text-brand-green">
                {formatNumber(batches.length)}
              </Text>
            </View>
          </View>
          {batches.length ? (
            batches.map((batch) => (
              <View
                key={batch.id}
                className="gap-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-3"
              >
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-1">
                    <Text className="font-sans-bold text-sm text-richBlack">
                      #{batch.batchNo}
                    </Text>
                    <Text className="font-sans text-xs text-midGray">
                      {t("expiryDateLabel")}: {batch.expiryDate ? formatDate(batch.expiryDate) : "—"}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="font-sans text-[10px] uppercase text-midGray">
                      {t("currentStockLabel")}
                    </Text>
                    <Text className="font-sans-extrabold text-lg text-brand-green">
                      {formatNumber(batch.quantityAvailable)}
                    </Text>
                  </View>
                </View>
                <View className="flex-row gap-2">
                  <View className="flex-1 rounded-lg bg-white p-2">
                    <Text className="font-sans text-[10px] text-midGray">
                      {t("purchasePriceLabel")}
                    </Text>
                    <Text className="font-mono text-sm text-richBlack">
                      {formatMoney(batch.purchasePrice)}
                    </Text>
                  </View>
                  <View className="flex-1 rounded-lg bg-white p-2">
                    <Text className="font-sans text-[10px] text-midGray">
                      {t("salePriceLabel")}
                    </Text>
                    <Text className="font-mono text-sm text-richBlack">
                      {formatMoney(batch.salePrice)}
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/inventory/edit-batch" as never,
                      params: { medicineId, batchId: batch.id },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${t("editBatchLabel")} ${batch.batchNo}`}
                  className="h-10 flex-row items-center justify-center gap-2 rounded-lg border border-brand-green bg-brand-softGreen"
                >
                  <Feather name="edit-2" size={15} color="#059669" />
                  <Text className="font-sans-bold text-sm text-brand-green">
                    {t("editBatchLabel")}
                  </Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text className="py-4 text-center font-sans text-sm text-midGray">
              {t("noBatchesLabel")}
            </Text>
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("archiveMedicineLabel")}
          onPress={() =>
            Alert.alert(
              t("archiveMedicineTitle"),
              t("medicineArchiveRequirementsLabel"),
              [
                { text: t("cancelLabel") },
                {
                  text: t("archiveLabel"),
                  style: "destructive",
                  onPress: () => void archive(),
                },
              ],
            )
          }
          className="h-12 items-center justify-center rounded-xl border border-error bg-white"
        >
          <Text className="font-sans-bold text-error">
            {t("archiveMedicineLabel")}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
}) {
  return (
    <View className="gap-1.5">
      <Text className="font-sans-semibold text-sm text-richBlack">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        keyboardType={numeric ? "number-pad" : "default"}
        placeholderTextColor="#6B7280"
        className="h-12 rounded-xl border border-[#D1D5DB] bg-white px-3 font-sans text-sm text-richBlack"
      />
    </View>
  );
}
