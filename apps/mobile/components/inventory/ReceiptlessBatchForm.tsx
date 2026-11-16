import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { addBatchSchema, type AddBatchInput, type AddBatchOutput } from "@muthoy/validation";
import { fromTaka } from "@muthoy/types";
import { addBatchToMedicine, getMedicine, type MedicineDetail } from "../../db/inventory";
import { captureSessionFor } from "../../state/sessionGuard";
import type { Session } from "../../state/sessionStore";
import { useI18n } from "../../state/localeStore";
import { userFacingError } from "../../i18n/display";
import { FormField } from "../forms/FormField";
import { triggerSyncNow } from "../../sync";

// The ledger requires a positive whole addition; shared validation permits zero
// for other medicine-entry flows, so this form tightens that boundary explicitly.
const schema = addBatchSchema.extend({
  quantity: z.number().int("Quantity must be a whole number").min(1, "Quantity must be at least 1"),
});

export function ReceiptlessBatchForm({ session, medicineId, onSaved }: {
  session: Session; medicineId: string; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [medicine, setMedicine] = useState<MedicineDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitLock = useRef(false);
  const { control, handleSubmit } = useForm<AddBatchInput, unknown, AddBatchOutput>({
    resolver: zodResolver(schema),
    defaultValues: { batchNo: "", expiryDate: "" },
  });
  useEffect(() => {
    let active = true;
    const guard = captureSessionFor(session);
    setMedicine(null);
    if (!guard) return;
    void getMedicine(session.shopId, medicineId).then(row => {
      if (!active) return;
      guard.ifLive(() => {
        setMedicine(row);
        setError(row ? null : t("restockLoadFailed"));
      });
    }).catch(() => {
      if (active) guard.ifLive(() => setError(t("restockLoadFailed")));
    });
    return () => { active = false; };
  }, [medicineId, session, t]);

  const submit = handleSubmit(async values => {
    if (submitLock.current || !medicine || medicine.id !== medicineId) return;
    const guard = captureSessionFor(session);
    if (!guard) return;
    submitLock.current = true;
    setSaving(true);
    setError(null);
    try {
      // Re-read at submission; the writer independently verifies tenant and
      // deletion inside its transaction, including changes during this await.
      const current = await getMedicine(session.shopId, medicineId);
      guard.assertLive();
      if (!current) { setError(t("restockLoadFailed")); return; }
      await addBatchToMedicine({
        shopId: session.shopId, actorUserId: session.userId,
        isStillActive: guard.isStillActive, medicineId,
        batchNo: values.batchNo, expiryDate: values.expiryDate,
        quantity: values.quantity,
        purchasePrice: fromTaka(values.purchasePrice), salePrice: fromTaka(values.salePrice),
      });
      guard.ifLive(() => { void triggerSyncNow(session.shopId); onSaved(); });
    } catch (caught) {
      guard.ifLive(() => setError(userFacingError(caught, "restockSaveFailed", t)));
    } finally {
      submitLock.current = false;
      guard.ifLive(() => setSaving(false));
    }
  });

  return <View className="gap-4 rounded-xl bg-white p-4">
    <Text className="font-sans-semibold text-lg text-richBlack">{medicine?.name ?? t("addBatchLabel")}</Text>
    <Text className="font-sans text-sm text-midGray">{t("receiptlessBatchHint")}</Text>
    <FormField control={control} name="batchNo" label={t("batchNumberLabel")} />
    <FormField control={control} name="expiryDate" label={t("expiryDateLabel")} placeholder="YYYY-MM-DD" />
    <FormField control={control} name="quantity" label={t("quantityLabel")} numeric keyboardType="number-pad" />
    <FormField control={control} name="purchasePrice" label={t("purchasePriceLabel")} numeric money />
    <FormField control={control} name="salePrice" label={t("salePriceLabel")} numeric money />
    {error ? <Text accessibilityRole="alert" className="font-sans text-sm text-error">{error}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={t("saveBatchLabel")}
      accessibilityState={{ disabled: saving || !medicine }}
      disabled={saving || !medicine} onPress={() => void submit()}
      className="min-h-12 items-center justify-center rounded-xl bg-brand-green p-4">
      <Text className="font-sans-semibold text-white">{saving ? t("savingLabel") : t("saveBatchLabel")}</Text>
    </Pressable>
  </View>;
}
