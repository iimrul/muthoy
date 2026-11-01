import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { ManualEntryForm } from "../../components/inventory/ManualEntryForm";
import { AccessDenied } from "../../components/ui/AccessDenied";
import { StandardHeader } from "../../components/ui/StandardHeader";
import { usePermission } from "../../state/usePermission";
import { useI18n } from "../../state/localeStore";

export default function AddBatchScreen() {
  const { medicineId } = useLocalSearchParams<{ medicineId: string }>();
  const { session, isAllowed } = usePermission("inventory_add");
  const { t } = useI18n();
  if (!session || !isAllowed || !medicineId) return <AccessDenied />;
  return <View className="flex-1 bg-brand-softGreen">
    <StandardHeader title={t("addBatchLabel")} onBackPress={() => router.back()} />
    <ScrollView contentContainerClassName="gap-4 p-4 pb-32" keyboardShouldPersistTaps="handled">
      <ManualEntryForm key={`${session.shopId}:${session.userId}:${medicineId}`} session={session}
        existingMedicineId={medicineId} onSaved={() => router.back()} />
    </ScrollView>
  </View>;
}
