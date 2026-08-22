import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  addBatchSchema,
  type AddBatchInput,
  type AddBatchOutput,
} from "@muthoy/validation";
import { fromTaka } from "@muthoy/types";
import { daysUntilExpiry, formatMoney, formatNumber } from "@muthoy/utils";
import { FormField } from "../../components/forms/FormField";
import { StandardHeader } from "../../components/ui/StandardHeader";
import {
  addBatchToMedicine,
  getMedicine,
  listBatchesForMedicine,
  type BatchDetailRow,
  type MedicineDetail,
} from "../../db/inventory";
import { DuplicateBatchError } from "../../db/errors";
import { captureSessionFor } from "../../state/sessionGuard";
import { usePermission } from "../../state/usePermission";
import { triggerSyncNow } from "../../sync";

// Medicine detail: batch list + Add Batch — Volume 4 INVENTORY, Volume 0 Day
// 8. This is the path that adds a batch to an EXISTING medicine, which is
// the only way the UNIQUE(shop_id, medicine_id, batch_no) constraint (Volume
// 3) can actually be hit — Add Medicine's first batch never collides, since
// its medicineId is always freshly generated. Volume 0 Day 8 checklist:
// "Duplicate batch number for the same medicine shows a friendly error" —
// rendered inline under the batch-number field below, never an Alert.
export default function BatchDetailScreen() {
  const { medicineId } = useLocalSearchParams<{ medicineId: string }>();
  // Mixed screen: the batch LIST is inventory-view, which Staff keeps
  // (Volume 0 Day 11). Only the Add Batch half is gated on inventory_write,
  // so the route itself is not blocked for Staff — the write is.
  const { session, isAllowed: canWriteInventory } =
    usePermission("inventory_write");
  const [medicine, setMedicine] = useState<MedicineDetail | null>(null);
  const [batches, setBatches] = useState<BatchDetailRow[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { control, handleSubmit, setError, reset } = useForm<
    AddBatchInput,
    unknown,
    AddBatchOutput
  >({
    resolver: zodResolver(addBatchSchema),
    defaultValues: { batchNo: "", quantity: 0, purchasePrice: 0, salePrice: 0 },
  });

  const reload = useCallback(async () => {
    if (!session || !medicineId) {
      return;
    }
    const [medicineDetail, batchList] = await Promise.all([
      getMedicine(session.shopId, medicineId),
      listBatchesForMedicine(session.shopId, medicineId),
    ]);
    setMedicine(medicineDetail);
    setBatches(batchList);
  }, [session, medicineId]);

  useEffect(() => {
    // Load-once-on-mount from SQLite, same pattern as app/staff/management.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  const onSubmit = useCallback(
    async (input: AddBatchOutput) => {
      if (!session || !medicineId || !canWriteInventory) {
        return;
      }
      // Adding stock is an actor-stamped mutation, and react-hook-form's
      // resolver already awaited before this handler ran.
      const guard = captureSessionFor(session);
      if (!guard) {
        return;
      }
      setIsSubmitting(true);
      try {
        await addBatchToMedicine({
          shopId: session.shopId,
          actorUserId: session.userId,
          isStillActive: guard.isStillActive,
          medicineId,
          batchNo: input.batchNo,
          expiryDate: input.expiryDate,
          quantity: input.quantity,
          purchasePrice: fromTaka(input.purchasePrice),
          salePrice: fromTaka(input.salePrice),
        });
        void triggerSyncNow(session.shopId);
        // Form reset and list repaint belong to the user who added the batch.
        guard.ifLive(() => {
          reset();
          setIsAdding(false);
        });
        await guard.ifLiveAsync(reload);
      } catch (err) {
        if (guard.isStale()) {
          return;
        }
        if (err instanceof DuplicateBatchError) {
          setError("batchNo", { message: err.message });
          return;
        }
        Alert.alert("Something went wrong", "Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [session, medicineId, canWriteInventory, reset, reload, setError],
  );

  if (!session || !medicineId) {
    return null;
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader
        title={medicine?.name ?? "Batches"}
        onBackPress={() => router.back()}
      />
      <ScrollView
        contentContainerClassName="gap-4 p-6"
        keyboardShouldPersistTaps="handled"
      >
        {canWriteInventory ? (
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/inventory/edit-medicine",
                params: { medicineId },
              })
            }
            className="items-center rounded-lg border border-brand-green bg-white py-3"
          >
            <Text className="text-brand-green">Edit medicine</Text>
          </Pressable>
        ) : null}
        {batches.map((batch) => (
          <BatchRow
            key={batch.id}
            batch={batch}
            onEdit={
              canWriteInventory
                ? () =>
                    router.push({
                      pathname: "/inventory/edit-batch" as never,
                      params: { medicineId, batchId: batch.id },
                    })
                : undefined
            }
          />
        ))}

        {!canWriteInventory ? null : isAdding ? (
          <View className="gap-4 rounded-lg bg-white p-4">
            <Text className="font-sans-bold text-base text-richBlack">
              Add batch
            </Text>
            <FormField
              control={control}
              name="batchNo"
              label="Batch number"
              placeholder="e.g. B-2024-02"
            />
            <FormField
              control={control}
              name="expiryDate"
              label="Expiry date"
              placeholder="YYYY-MM-DD"
            />
            <FormField
              control={control}
              name="quantity"
              label="Quantity"
              numeric
            />
            <FormField
              control={control}
              name="purchasePrice"
              label="Purchase price (৳)"
              numeric
            />
            <FormField
              control={control}
              name="salePrice"
              label="Sale price (৳)"
              numeric
            />
            <View className="flex-row gap-4">
              <Pressable
                onPress={() => {
                  reset();
                  setIsAdding(false);
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                className="flex-1 items-center rounded-lg border border-midGray py-3"
              >
                <Text className="font-sans-medium text-base text-richBlack">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={handleSubmit(onSubmit)}
                disabled={isSubmitting}
                accessibilityRole="button"
                accessibilityLabel="Save batch"
                className="flex-1 items-center rounded-lg bg-brand-green py-3"
              >
                <Text className="font-sans-semibold text-base text-white">
                  {isSubmitting ? "Saving…" : "Save batch"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setIsAdding(true)}
            accessibilityRole="button"
            accessibilityLabel="Add batch"
            className="items-center rounded-lg bg-brand-green py-3.5 active:opacity-80"
          >
            <Text className="font-sans-semibold text-base text-white">
              Add batch
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

function BatchRow({
  batch,
  onEdit,
}: {
  batch: BatchDetailRow;
  onEdit?: () => void;
}) {
  const days = daysUntilExpiry(batch.expiryDate, new Date());
  const expiryLabel =
    days === null
      ? "No expiry"
      : days < 0
        ? "Expired"
        : `${formatNumber(days)}d left`;

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
          {formatNumber(batch.quantityAvailable)} in stock · {expiryLabel}
        </Text>
      </View>
      <Text className="font-mono text-base text-brand-green">
        {formatMoney(batch.salePrice)}
      </Text>
      {onEdit ? <Text className="ml-3 text-brand-green">Edit</Text> : null}
    </Pressable>
  );
}
