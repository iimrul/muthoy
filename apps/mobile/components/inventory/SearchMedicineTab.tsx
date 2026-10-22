import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useI18n } from "../../state/localeStore";
import { createLatestRequestGuard } from "../../domain/latestRequestGuard";
import {
  unavailableMedicineSearchProvider,
  type MedicineSearchProvider,
  type MedicineSearchResult,
} from "../../domain/medicineSearchProvider";

interface SearchMedicineTabProps {
  onSelect: (result: MedicineSearchResult) => void;
  onSwitchToManual: () => void;
  onScan: () => void;
  /** The real one is db/medicineCatalog.ts's catalogMedicineSearchProvider. */
  provider?: MedicineSearchProvider;
}

/**
 * Strength, dosage form and pack size on one secondary line.
 *
 * Without them a 21k catalogue renders "Napa 500mg" and "Napa 665mg" as two
 * identical rows both reading "Napa", and the user picks blind. They are shown
 * BESIDE the name, never concatenated into it — `medicines.name` must stay the
 * brand name (medicines_fts indexes it, findExactNameMatch compares it).
 */
function detailLine(result: MedicineSearchResult): string {
  return [result.strength, result.dosageForm, result.packSize]
    .filter(Boolean)
    .join(" • ");
}

// Search Medicine — the UI half of W2-02. The medicine reference catalogue is
// a real table with a real FTS index now (db/medicineCatalog.ts), but it ships
// with ZERO rows: no licensed dataset has been cleared (gate E7). So a query
// against a fresh install finds nothing and still lands on the explicit
// "not connected yet" state with a way into Manual Entry — this component
// never shows a fake or fixture match, and never shows that state in place of
// a failure it should report instead.
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
  const [searchError, setSearchError] = useState<string | null>(null);
  // Against a 21k catalogue a slow early query can resolve after a fast later
  // one and overwrite it, so the newest keystroke's results are the only ones
  // allowed to land. Same guard app/(tabs)/sale.tsx's search already uses.
  const [searchGuard] = useState(() => createLatestRequestGuard());

  const handleChangeText = (text: string) => {
    setQuery(text);
    const requestId = searchGuard.start();
    if (!text.trim()) {
      setResults([]);
      setHasSearched(false);
      setSearchError(null);
      return;
    }
    setHasSearched(true);
    setSearchError(null);
    void provider
      .search(text)
      .then((matches) => {
        if (searchGuard.isLatest(requestId)) {
          setResults(matches);
        }
      })
      .catch(() => {
        if (searchGuard.isLatest(requestId)) {
          setResults([]);
          setSearchError(t("medicineSearchFailedRetryLabel"));
        }
      });
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
          {results.map((result) => {
            const details = detailLine(result);
            return (
              <Pressable
                key={result.id}
                onPress={() => onSelect(result)}
                accessibilityRole="button"
                // The details belong in the label too: a Pressable's label
                // replaces its children for a screen reader, so without them a
                // TalkBack user hears "Napa" for both strengths and still
                // picks blind.
                accessibilityLabel={
                  details ? `${result.name} • ${details}` : result.name
                }
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
                {details ? (
                  <Text className="font-sans text-xs text-midGray">
                    {details}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {searchError ? (
        <Text className="font-sans text-sm text-error">{searchError}</Text>
      ) : null}
      {hasSearched && results.length === 0 && !searchError ? (
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
