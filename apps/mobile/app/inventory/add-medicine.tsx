import { useState } from "react";
import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StandardHeader } from "../../components/ui/StandardHeader";
import { AccessDenied } from "../../components/ui/AccessDenied";
import { SearchMedicineTab } from "../../components/inventory/SearchMedicineTab";
import { ManualEntryForm } from "../../components/inventory/ManualEntryForm";
import { ExistingMedicinePicker } from "../../components/inventory/ExistingMedicinePicker";
import type { MedicineSearchResult } from "../../domain/medicineSearchProvider";
import {
  medicinePrefillFromCatalog,
  medicinePrefillFromSearchResult,
  type MedicinePrefill,
} from "../../domain/catalogPrefill";
import { createLatestRequestGuard } from "../../domain/latestRequestGuard";
import {
  catalogMedicineSearchProvider,
  getCatalogEntry,
} from "../../db/medicineCatalog";
import { usePermission } from "../../state/usePermission";
import { useI18n } from "../../state/localeStore";

type AddMedicineTab = "search" | "manual" | "existing";

// Add Medicine — Volume 0 Day 8, revised for the founder's Sales+Inventory
// prototype-parity recovery: two real, always-switchable entry points
// (Search Medicine defaults active, matching the prototype), gated on the
// dedicated inventory_add permission rather than the broader inventory_edit
// (Owner always allowed; a staff member only once explicitly granted —
// domain/permissions.ts).
//
// W2-02 connects Search Medicine to the real offline reference catalogue
// (db/medicineCatalog.ts). Selecting a hit only READS: it prefills Manual
// Entry, which still owns the one and only write, through
// db/inventory.ts's atomic createMedicineWithPurchase when the user presses
// Save. There is deliberately no catalogue-to-medicines shortcut.
export default function AddMedicineScreen() {
  const { t } = useI18n();
  const { session, isAllowed } = usePermission("inventory_add");
  const [tab, setTab] = useState<AddMedicineTab>("search");
  const [selectedMedicine, setSelectedMedicine] =
    useState<MedicinePrefill | null>(null);
  const [scanRequest, setScanRequest] = useState(0);
  // Two quick taps on two different rows each start a catalogue read; only
  // the newest one may prefill the form.
  const [selectGuard] = useState(() => createLatestRequestGuard());

  // Re-reads the selected row by id — the authoritative base-table row rather
  // than the FTS projection — and prefills from that. The read resolves BEFORE
  // the form opens, so there is exactly one prefill pass and a late resolve can
  // never overwrite what the user has started typing. A row that can no longer
  // be read (a re-import replaces ids, so null is legitimate) falls back to the
  // values the result row already showed; nothing is lost and nothing is
  // written either way.
  const handleSelect = async (result: MedicineSearchResult) => {
    const requestId = selectGuard.start();
    let prefill = medicinePrefillFromSearchResult(result);
    try {
      const entry = await getCatalogEntry(result.id);
      if (entry) {
        prefill = medicinePrefillFromCatalog(entry);
      }
    } catch {
      // Keep the search-result prefill: it carries every field this screen
      // maps onto a medicine, so the user loses nothing they could see.
    }
    if (!selectGuard.isLatest(requestId)) return;
    setSelectedMedicine(prefill);
    setTab("manual");
  };

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
        <Pressable onPress={() => setTab("existing")} accessibilityRole="button"
          accessibilityLabel={t("restockLabel")} className="mb-3 rounded-xl bg-brand-green p-3">
          <Text className="text-center font-sans-semibold text-white">{t("restockLabel")}</Text>
        </Pressable>
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
        {tab === "existing" ? <ExistingMedicinePicker key={`${session.shopId}:${session.userId}`} shopId={session.shopId} onSelect={(medicineId) => {
          router.push({ pathname: "/inventory/add-batch" as never, params: { medicineId } });
        }} /> : tab === "search" ? (
          <SearchMedicineTab
            provider={catalogMedicineSearchProvider}
            onSelect={(result) => {
              void handleSelect(result);
            }}
            onSwitchToManual={() => setTab("manual")}
            onScan={() => {
              setTab("manual");
              setScanRequest((current) => current + 1);
            }}
          />
        ) : (
          <ManualEntryForm
            key={`${session.shopId}:${session.userId}`}
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
