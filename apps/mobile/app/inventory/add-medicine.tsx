import { useState } from "react";
import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StandardHeader } from "../../components/ui/StandardHeader";
import { AccessDenied } from "../../components/ui/AccessDenied";
import { SearchMedicineTab } from "../../components/inventory/SearchMedicineTab";
import { ManualEntryForm } from "../../components/inventory/ManualEntryForm";
import type { MedicineSearchResult } from "../../domain/medicineSearchProvider";
import { usePermission } from "../../state/usePermission";
import { useI18n } from "../../state/localeStore";

type AddMedicineTab = "search" | "manual";

// Add Medicine — Volume 0 Day 8, revised for the founder's Sales+Inventory
// prototype-parity recovery: two real, always-switchable entry points
// (Search Medicine defaults active, matching the prototype), gated on the
// dedicated inventory_add permission rather than the broader inventory_edit
// (Owner always allowed; a staff member only once explicitly granted —
// domain/permissions.ts). Search Medicine has no live dataset yet — see
// components/inventory/SearchMedicineTab.tsx — so it always hands off to
// Manual Entry, which now owns the real write via
// db/inventory.ts's createMedicineWithPurchase.
export default function AddMedicineScreen() {
  const { t } = useI18n();
  const { session, isAllowed } = usePermission("inventory_add");
  const [tab, setTab] = useState<AddMedicineTab>("search");
  const [selectedMedicine, setSelectedMedicine] =
    useState<MedicineSearchResult | null>(null);
  const [scanRequest, setScanRequest] = useState(0);

  if (!session || !isAllowed) {
    return <AccessDenied />;
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader
        title={t("addMedicineTitle")}
        onBackPress={() => router.back()}
      />
      <View className="border-b border-[#E5E7EB] px-4 py-4">
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => setTab("search")}
            accessibilityRole="button"
            accessibilityLabel={t("searchMedicineLabel")}
            className={`flex-1 items-center rounded-xl px-4 py-2 ${
              tab === "search" ? "bg-brand-green" : "bg-[#F3F4F6]"
            }`}
          >
            <Text
              className={`font-sans-semibold text-sm ${
                tab === "search" ? "text-white" : "text-midGray"
              }`}
            >
              {t("searchMedicineLabel")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTab("manual")}
            accessibilityRole="button"
            accessibilityLabel={t("manualEntryTitle")}
            className={`flex-1 items-center rounded-xl px-4 py-2 ${
              tab === "manual" ? "bg-brand-green" : "bg-[#F3F4F6]"
            }`}
          >
            <Text
              className={`font-sans-semibold text-sm ${
                tab === "manual" ? "text-white" : "text-midGray"
              }`}
            >
              {t("manualEntryTitle")}
            </Text>
          </Pressable>
        </View>
      </View>
      <ScrollView
        contentContainerClassName="gap-4 p-4 pb-32"
        keyboardShouldPersistTaps="handled"
      >
        {tab === "search" ? (
          <SearchMedicineTab
            onSelect={(result) => {
              setSelectedMedicine(result);
              setTab("manual");
            }}
            onSwitchToManual={() => setTab("manual")}
            onScan={() => {
              setTab("manual");
              setScanRequest((current) => current + 1);
            }}
          />
        ) : (
          <ManualEntryForm
            session={session}
            onSaved={() => router.back()}
            initialMedicine={selectedMedicine}
            scanRequest={scanRequest}
          />
        )}
      </ScrollView>
    </View>
  );
}
