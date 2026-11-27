import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { ManualEntryForm } from "../../components/inventory/ManualEntryForm";
import { ReceiptlessBatchForm } from "../../components/inventory/ReceiptlessBatchForm";
import { AccessDenied } from "../../components/ui/AccessDenied";
import { StandardHeader } from "../../components/ui/StandardHeader";
import { usePermission } from "../../state/usePermission";
import { usePlan } from "../../state/usePlan";
import { canUseFeature } from "../../domain/entitlements";
import { useI18n } from "../../state/localeStore";

export default function AddBatchScreen() {
  const { medicineId, mode } = useLocalSearchParams<{ medicineId: string; mode?: string }>();
  const { session, isAllowed } = usePermission("inventory_edit");
  const { isAllowed: canReceive } = usePermission("inventory_add");
  const plan = usePlan();
  const { t } = useI18n();
  const receipt = mode === "receipt";
  const allowed = receipt
    ? canReceive && session?.role === "owner" && !plan.loading && canUseFeature(plan.effectiveTier, "supplier_invoices")
    : isAllowed;
  if (!session || !allowed || typeof medicineId !== "string" || !medicineId || (mode && !receipt))
    return <AccessDenied />;
  return <View className="flex-1 bg-brand-softGreen">
    <StandardHeader title={t(receipt ? "supplierReceiptLabel" : "addBatchLabel")} onBackPress={() => router.back()} />
    <ScrollView contentContainerClassName="gap-4 p-4 pb-8" keyboardShouldPersistTaps="handled">
      {receipt
        ? <ManualEntryForm key={session.shopId + ":" + session.userId + ":" + medicineId} session={session}
          existingMedicineId={medicineId} onSaved={() => router.back()} />
        : <ReceiptlessBatchForm key={session.shopId + ":" + session.userId + ":" + medicineId} session={session}
          medicineId={medicineId} onSaved={() => router.back()} />}
    </ScrollView>
  </View>;
}
