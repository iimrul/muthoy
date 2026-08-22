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
import { triggerSyncNow } from "../../sync";

type AdjustmentKind = "adjustment" | "expiry_disposal" | "reconciliation";

export default function EditBatchScreen() {
  const { medicineId, batchId } = useLocalSearchParams<{
    medicineId: string;
    batchId: string;
  }>();
  const { session, isAllowed } = usePermission("inventory_edit");
  const [batchNo, setBatchNo] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [changeQty, setChangeQty] = useState("");
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
          "Could not update batch",
          caught instanceof Error ? caught.message : "Try again.",
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Edit batch" onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Field label="Batch number" value={batchNo} onChange={setBatchNo} />
        <Field
          label="Expiry (blank = unknown)"
          value={expiryDate}
          onChange={setExpiryDate}
        />
        <Field
          label="Purchase price (৳)"
          value={purchasePrice}
          onChange={setPurchasePrice}
          numeric
        />
        <Field
          label="Sale price (৳)"
          value={salePrice}
          onChange={setSalePrice}
          numeric
        />
        <Pressable
          disabled={busy}
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
          className="items-center rounded-lg bg-brand-green py-4 disabled:opacity-40"
        >
          <Text className="text-white">Save metadata</Text>
        </Pressable>
        <View className="gap-3 rounded-lg bg-white p-4">
          <Text className="font-sans-semibold">Ledger adjustment</Text>
          <View className="flex-row gap-2">
            {(["adjustment", "expiry_disposal", "reconciliation"] as const).map(
              (value) => (
                <Pressable
                  key={value}
                  onPress={() => setKind(value)}
                  className={`flex-1 rounded border p-2 ${kind === value ? "border-brand-green" : "border-midGray"}`}
                >
                  <Text className="text-xs">{value}</Text>
                </Pressable>
              ),
            )}
          </View>
          <Field
            label="Signed quantity"
            value={changeQty}
            onChange={setChangeQty}
            numeric
          />
          <Field label="Required reason" value={reason} onChange={setReason} />
          <Pressable
            disabled={busy}
            onPress={() =>
              void run((isStillActive) =>
                adjustBatchStock({
                  shopId: session.shopId,
                  actorUserId: session.userId,
                  batchId,
                  changeQty: Number(changeQty),
                  reason,
                  kind,
                  isStillActive,
                }),
              )
            }
            className="items-center rounded-lg border border-brand-green py-3 disabled:opacity-40"
          >
            <Text className="text-brand-green">Post adjustment</Text>
          </Pressable>
        </View>
        <Pressable
          disabled={busy}
          onPress={() =>
            Alert.alert(
              "Archive batch?",
              "Requires zero stock, no oversell, and no active promotion.",
              [
                { text: "Cancel" },
                {
                  text: "Archive",
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
          className="items-center rounded-lg border border-error py-4"
        >
          <Text className="text-error">Archive batch</Text>
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
    <View className="gap-2">
      <Text>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? "decimal-pad" : "default"}
        className="rounded-lg border border-midGray bg-white p-3"
      />
    </View>
  );
}
