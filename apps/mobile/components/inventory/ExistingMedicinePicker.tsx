import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { searchRestockMedicines } from "../../db/inventory";
import { useI18n } from "../../state/localeStore";

interface ExistingMedicinePickerProps {
  shopId: string;
  initialQuery?: string;
  onSelect: (id: string) => void;
}

export function ExistingMedicinePicker(props: ExistingMedicinePickerProps) {
  return <MedicinePicker key={`${props.shopId}:${props.initialQuery ?? ""}`} {...props} />;
}

function MedicinePicker({ shopId, initialQuery = "", onSelect }: ExistingMedicinePickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<{
    query: string;
    rows: Awaited<ReturnType<typeof searchRestockMedicines>>;
    status: "ready" | "error";
  } | null>(null);
  const rows = result?.query === query ? result.rows : [];
  const status = result?.query === query ? result.status : "loading";
  useEffect(() => {
    let live = true;
    void searchRestockMedicines(shopId, query).then((results) => {
      if (live) setResult({ query, rows: results, status: "ready" });
    }).catch(() => { if (live) setResult({ query, rows: [], status: "error" }); });
    return () => { live = false; };
  }, [shopId, query]);
  return <View className="gap-3 rounded-xl bg-white p-4">
    <Text className="font-sans-semibold text-richBlack">{t("restockChooseLabel")}</Text>
    <TextInput value={query} onChangeText={setQuery} accessibilityLabel={t("restockSearchLabel")}
      className="rounded-lg border border-midGray p-3 font-sans text-richBlack" />
    <Text className="font-sans text-sm text-midGray">{t("restockContextHint")}</Text>
    {status === "error" ? <Text className="font-sans text-error">{t("restockLoadFailed")}</Text> : null}
    {status === "loading" ? <Text className="font-sans">{t("loadingLabel")}</Text> : null}
    {status === "ready" && rows.length === 0 ? <Text className="font-sans">{t("restockNoMatches")}</Text> : null}
    {rows.map((row) => <Pressable key={row.id} onPress={() => onSelect(row.id)}
      accessibilityRole="button" accessibilityLabel={`${t("restockSameLabel")}: ${row.name} / ${row.strength ?? "—"} / ${row.id}`}
      className="gap-1 rounded-lg border border-midGray p-3">
      <Text className="font-sans-semibold text-richBlack">{row.name}</Text>
      <Text className="font-sans text-midGray">{[row.generic, row.manufacturer, row.strength, row.type, row.unitOfMeasure, row.barcode].filter(Boolean).join(" / ")}</Text>
      <Text className="font-sans text-sm text-midGray">{row.batchContext || t("restockNoBatches")}</Text>
      <Text className="font-sans text-xs text-midGray">{row.id}</Text>
      <Text className="font-sans-semibold text-brand-green">{t("restockSameLabel")}</Text>
    </Pressable>)}
    {rows.length === 50 ? <Text className="font-sans text-midGray">{t("restockRefineHint")}</Text> : null}
  </View>;
}
