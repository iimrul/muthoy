import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useI18n } from "../../state/localeStore";
import {
  unavailableMedicineSearchProvider,
  type MedicineSearchProvider,
  type MedicineSearchResult,
} from "../../domain/medicineSearchProvider";

interface SearchMedicineTabProps {
  onSelect: (result: MedicineSearchResult) => void;
  onSwitchToManual: () => void;
  onScan: () => void;
  /** Swappable later for a real ~21k master-database provider — see domain/medicineSearchProvider.ts. */
  provider?: MedicineSearchProvider;
}

// Search Medicine — UI/flow shell only. No medicine master database is
// connected yet (backend/dataset decision pending); this renders a real
// search input and a real result-row shape so a provider can be swapped in
// later with no redesign, but it never shows a fake or fixture match — a
// query that finds nothing (because nothing is connected) shows an explicit
// "not connected yet" state with a way into Manual Entry instead.
export function SearchMedicineTab({
  onSelect,
  onSwitchToManual,
  onScan,
  provider = unavailableMedicineSearchProvider,
}: SearchMedicineTabProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MedicineSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const handleChangeText = (text: string) => {
    setQuery(text);
    if (!text.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    setHasSearched(true);
    void provider.search(text).then(setResults);
  };

  return (
    <View className="gap-3">
      <View className="relative">
        <View className="absolute inset-y-0 left-3 z-10 justify-center">
          <Feather name="search" size={20} color="#9CA3AF" />
        </View>
        <TextInput
          value={query}
          onChangeText={handleChangeText}
          placeholder={t("searchMedicinePlaceholder")}
          placeholderTextColor="#6B7280"
          accessibilityLabel={t("searchMedicineLabel")}
          className="h-12 rounded-xl border border-[#D1D5DB] bg-white pl-10 pr-14 font-sans text-base text-richBlack"
        />
        <Pressable
          onPress={onScan}
          accessibilityRole="button"
          accessibilityLabel={t("scanStripToPrefillLabel")}
          className="absolute right-2 top-1.5 h-9 w-9 items-center justify-center rounded-lg bg-brand-green active:opacity-80"
        >
          <Feather name="maximize" size={16} color="#FFFFFF" />
        </Pressable>
      </View>
      {results.length > 0 ? (
        <View className="gap-2">
          {results.map((result) => (
            <Pressable
              key={result.id}
              onPress={() => onSelect(result)}
              accessibilityRole="button"
              accessibilityLabel={result.name}
              className="rounded-xl bg-[#F9FAFB] p-3 active:opacity-80"
            >
              <Text className="font-sans-medium text-base text-richBlack">
                {result.name}
              </Text>
              {result.generic || result.manufacturer ? (
                <Text className="font-sans text-xs text-midGray">
                  {[result.generic, result.manufacturer]
                    .filter(Boolean)
                    .join(" • ")}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      {hasSearched && results.length === 0 ? (
        <View className="gap-3 rounded-xl bg-white p-4">
          <Text className="font-sans-medium text-sm text-richBlack">
            {t("medicineDatabaseNotConnected")}
          </Text>
          <Text className="font-sans text-xs text-midGray">
            {t("medicineDatabaseNotConnectedHint")}
          </Text>
          <Pressable
            onPress={onSwitchToManual}
            accessibilityRole="button"
            accessibilityLabel={t("manualEntryTitle")}
            className="items-center rounded-xl border border-brand-green py-2.5 active:opacity-80"
          >
            <Text className="font-sans-semibold text-sm text-brand-green">
              {t("manualEntryTitle")}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
