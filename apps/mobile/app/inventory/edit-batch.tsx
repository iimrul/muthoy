import { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { parseTakaTextToPaisa } from "@muthoy/utils";
import Feather from "@expo/vector-icons/Feather";
import { StandardHeader } from "../../components/ui/StandardHeader";
import { AccessDenied } from "../../components/ui/AccessDenied";
import {
  adjustBatchStock,
  archiveBatch,
  listBatchesForMedicine,
  updateBatch,
} from "../../db/inventory";
import { captureSessionFor } from "../../state/sessionGuard";
import { usePermission } from "../../state/usePermission";
import { useI18n } from "../../state/localeStore";
import { triggerSyncNow } from "../../sync";

type AdjustmentKind = "adjustment" | "expiry_disposal" | "reconciliation";

export default function EditBatchScreen() {
  const { medicineId, batchId } = useLocalSearchParams<{
    medicineId: string;
    batchId: string;
  }>();
  const { session, isAllowed } = usePermission("inventory_edit");
  const { isAllowed: canManageExpiry } = usePermission("expiry_manage");
  const { t, formatNumber } = useI18n();
  const [batchNo, setBatchNo] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [currentStock, setCurrentStock] = useState(0);
  const [changeQty, setChangeQty] = useState("");
  const [direction, setDirection] = useState<"increase" | "decrease">(
    "increase",
  );
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<AdjustmentKind>("adjustment");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!session || !medicineId || !batchId) return;
    void listBatchesForMedicine(session.shopId, medicineId).then((rows) => {
      const row = rows.find((candidate) => candidate.id === batchId);
      if (!row) return;
      setBatchNo(row.batchNo);
      setExpiryDate(row.expiryDate ?? "");
      setPurchasePrice(String(row.purchasePrice / 100));
      setSalePrice(String(row.salePrice / 100));
      setCurrentStock(row.quantityAvailable);
    });
  }, [batchId, medicineId, session]);
  if (!session || !isAllowed || !medicineId || !batchId)
    return <AccessDenied />;
  const run = async (
    action: (isStillActive: () => boolean) => Promise<void>,
  ) => {
    const guard = captureSessionFor(session);
    if (!guard) return;
    setBusy(true);
    try {
      await action(guard.isStillActive);
      void triggerSyncNow(session.shopId);
      guard.ifLive(() => router.back());
    } catch (caught) {
      if (!guard.isStale())
        Alert.alert(
          t("updateBatchFailedLabel"),
          caught instanceof Error ? caught.message : t("tryAgainLabel"),
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="flex-1 bg-[#F9F9FC]">
      <StandardHeader
        title={t("editBatchTitle")}
        onBackPress={() => router.back()}
      />
      <ScrollView contentContainerClassName="gap-4 p-4 pb-32">
        <View className="gap-4 rounded-2xl bg-white p-4 shadow-sm">
          <View className="flex-row items-center gap-2">
            <View className="h-9 w-9 items-center justify-center rounded-lg bg-brand-softGreen">
              <Feather name="package" size={17} color="#059669" />
            </View>
            <Text className="font-sans-bold text-base text-richBlack">
              {t("batchMetadataLabel")}
            </Text>
          </View>
          <Field
            label={t("batchNoColumnLabel")}
            value={batchNo}
            onChange={setBatchNo}
          />
          <Field
            label={t("expiryDateLabel")}
            value={expiryDate}
            onChange={setExpiryDate}
            placeholder="YYYY-MM-DD"
          />
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Field
                label={t("purchasePriceLabel")}
                value={purchasePrice}
                onChange={setPurchasePrice}
                numeric
              />
            </View>
            <View className="flex-1">
              <Field
                label={t("salePriceLabel")}
                value={salePrice}
                onChange={setSalePrice}
                numeric
              />
            </View>
          </View>
          <Pressable
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("saveMetadataLabel")}
            onPress={() =>
              void run((isStillActive) =>
                updateBatch({
                  shopId: session.shopId,
                  actorUserId: session.userId,
                  batchId,
                  isStillActive,
                  values: {
                    batchNo: batchNo.trim(),
                    expiryDate: expiryDate.trim() || null,
                    purchasePrice: parseTakaTextToPaisa(purchasePrice),
                    salePrice: parseTakaTextToPaisa(salePrice),
                  },
                }),
              )
            }
            className="h-12 items-center justify-center rounded-xl bg-brand-green disabled:opacity-40"
          >
            <Text className="font-sans-bold text-white">
              {t("saveMetadataLabel")}
            </Text>
          </Pressable>
        </View>

        <View className="gap-4 rounded-2xl bg-white p-4 shadow-sm">
          <View className="flex-row items-center gap-2">
            <View className="h-9 w-9 items-center justify-center rounded-lg bg-[#CFE6F2]">
              <Feather name="activity" size={17} color="#526772" />
            </View>
            <Text className="font-sans-bold text-base text-richBlack">
              {t("stockAdjustmentLabel")}
            </Text>
          </View>
          <View className="flex-row gap-2">
            <View className="flex-1 items-center rounded-xl bg-[#F3F4F6] p-3">
              <Text className="font-sans text-[10px] uppercase text-midGray">
                {t("currentStockLabel")}
              </Text>
              <Text className="font-sans-extrabold text-2xl text-richBlack">
                {formatNumber(currentStock)}
              </Text>
            </View>
            <View className="flex-1 items-center rounded-xl bg-brand-softGreen p-3">
              <Text className="font-sans text-[10px] uppercase text-midGray">
                {t("resultingStockLabel")}
              </Text>
              <Text className="font-sans-extrabold text-2xl text-brand-green">
                {formatNumber(
                  currentStock +
                    (direction === "decrease" ? -1 : 1) *
                      (Number(changeQty) || 0),
                )}
              </Text>
            </View>
          </View>
          <View className="flex-row gap-2">
            {(["increase", "decrease"] as const).map((value) => (
              <Pressable
                key={value}
                onPress={() => setDirection(value)}
                accessibilityRole="button"
                accessibilityLabel={t(
                  value === "increase"
                    ? "increaseStockLabel"
                    : "decreaseStockLabel",
                )}
                className={`h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border ${direction === value ? "border-brand-green bg-brand-softGreen" : "border-[#D1D5DB] bg-white"}`}
              >
                <Feather
                  name={value === "increase" ? "plus" : "minus"}
                  size={16}
                  color={direction === value ? "#059669" : "#6B7280"}
                />
                <Text
                  className={`font-sans-bold text-xs ${direction === value ? "text-brand-green" : "text-midGray"}`}
                >
                  {t(
                    value === "increase"
                      ? "increaseStockLabel"
                      : "decreaseStockLabel",
                  )}
                </Text>
              </Pressable>
            ))}
          </View>
          <View className="flex-row gap-2">
            {(
              [
                "adjustment",
                ...(canManageExpiry ? (["expiry_disposal"] as const) : []),
                "reconciliation",
              ] as const
            ).map(
              (value) => (
                <Pressable
                  key={value}
                  onPress={() => {
                    setKind(value);
                    if (value === "expiry_disposal") setDirection("decrease");
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    value === "adjustment"
                      ? "adjustmentLabel"
                      : value === "expiry_disposal"
                        ? "expiryDisposalLabel"
                        : "reconciliationLabel",
                  )}
                  className={`flex-1 items-center rounded-lg border p-2 ${kind === value ? "border-brand-green bg-brand-softGreen" : "border-[#D1D5DB]"}`}
                >
                  <Text
                    className={`text-center font-sans-semibold text-[10px] ${kind === value ? "text-brand-green" : "text-midGray"}`}
                  >
                    {t(
                      value === "adjustment"
                        ? "adjustmentLabel"
                        : value === "expiry_disposal"
                          ? "expiryDisposalLabel"
                          : "reconciliationLabel",
                    )}
                  </Text>
                </Pressable>
              ),
            )}
          </View>
          <Field
            label={t("quantityChangeLabel")}
            value={changeQty}
            onChange={setChangeQty}
            numeric
          />
          <Field
            label={t("requiredReasonLabel")}
            value={reason}
            onChange={setReason}
          />
          <Pressable
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("postAdjustmentLabel")}
            onPress={() =>
              void run((isStillActive) =>
                adjustBatchStock({
                  shopId: session.shopId,
                  actorUserId: session.userId,
                  batchId,
                  changeQty:
                    (direction === "decrease" ? -1 : 1) * Number(changeQty),
                  reason,
                  kind,
                  isStillActive,
                }),
              )
            }
            className="h-12 items-center justify-center rounded-xl border border-brand-green bg-brand-softGreen disabled:opacity-40"
          >
            <Text className="font-sans-bold text-brand-green">
              {t("postAdjustmentLabel")}
            </Text>
          </Pressable>
        </View>
        <Pressable
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t("archiveBatchLabel")}
          onPress={() =>
            Alert.alert(
              t("archiveBatchTitle"),
              t("medicineArchiveRequirementsLabel"),
              [
                { text: t("cancelLabel") },
                {
                  text: t("archiveLabel"),
                  style: "destructive",
                  onPress: () =>
                    void run((isStillActive) =>
                      archiveBatch(
                        session.shopId,
                        session.userId,
                        batchId,
                        isStillActive,
                      ),
                    ),
                },
              ],
            )
          }
          className="h-12 items-center justify-center rounded-xl border border-error bg-white"
        >
          <Text className="font-sans-bold text-error">
            {t("archiveBatchLabel")}
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
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  placeholder?: string;
}) {
  return (
    <View className="gap-1.5">
      <Text className="font-sans-semibold text-sm text-richBlack">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        keyboardType={numeric ? "decimal-pad" : "default"}
        placeholder={placeholder}
        placeholderTextColor="#6B7280"
        className="h-12 rounded-xl border border-[#D1D5DB] bg-white px-3 font-sans text-sm text-richBlack"
      />
    </View>
  );
}
