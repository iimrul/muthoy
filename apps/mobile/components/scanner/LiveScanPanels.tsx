import { Pressable, ScrollView, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import type { Paisa } from "@muthoy/types";
import { DOSAGE_FORM_LABEL, normalizeDosageForm } from "../../domain/dosageForm";
import type { ScanVocabularyEntry } from "../../domain/stripMatcher";
import type { CatalogKey } from "../../i18n/catalog";
import { useI18n } from "../../state/localeStore";
import { DosageFormTag } from "../medicine/DosageFormBadge";

// components/scanner/LiveScanPanels.tsx — the presentational pieces of the live
// strip scanner: the notice at the top, the "which one?" choice, and the cart
// bar at the bottom. Props in, taps out; no state, no data access.

export type LiveScanNoticeTone = "success" | "warning" | "error";

export interface LiveScanNotice {
  id: number;
  tone: LiveScanNoticeTone;
  title: string;
  message?: string;
  /** Present only on an add, for the Undo window. */
  undoMedicineId?: string;
}

const NOTICE_SURFACE: Record<LiveScanNoticeTone, string> = {
  success: "bg-brand-green",
  warning: "bg-warning",
  error: "bg-error",
};

export function LiveScanNoticeBanner({
  notice,
  onUndo,
}: {
  notice: LiveScanNotice;
  onUndo: (medicineId: string) => void;
}) {
  const { t } = useI18n();
  const { undoMedicineId } = notice;
  return (
    <View
      accessibilityLiveRegion="polite"
      className={`mx-4 flex-row items-center gap-3 rounded-2xl px-4 py-3 ${NOTICE_SURFACE[notice.tone]}`}
    >
      <View className="flex-1">
        <Text className="font-sans-semibold text-sm text-white">{notice.title}</Text>
        {notice.message ? (
          <Text className="font-sans text-xs text-white/90">{notice.message}</Text>
        ) : null}
      </View>
      {undoMedicineId ? (
        <Pressable
          onPress={() => onUndo(undoMedicineId)}
          accessibilityRole="button"
          accessibilityLabel={t("liveScanUndo")}
          hitSlop={8}
          className="rounded-lg bg-white/20 px-3 py-2 active:opacity-70"
        >
          <Text className="font-sans-bold text-sm text-white">{t("liveScanUndo")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function describeOption(option: ScanVocabularyEntry): string {
  return [option.generic, option.manufacturer].filter(Boolean).join(" · ");
}

/** "Telmepress 20 · Capsule": two same-name options must not read alike. */
function optionLabel(option: ScanVocabularyEntry, t: (key: CatalogKey) => string): string {
  const form = normalizeDosageForm(option.dosageForm);
  return form && form !== "other" ? `${option.name} · ${t(DOSAGE_FORM_LABEL[form])}` : option.name;
}

export function LiveScanChoices({
  options,
  onChoose,
  onDismiss,
}: {
  options: readonly ScanVocabularyEntry[];
  onChoose: (option: ScanVocabularyEntry) => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <View className="gap-3 rounded-2xl bg-white p-4">
      <Text className="font-sans-bold text-base text-richBlack">{t("liveScanChooseTitle")}</Text>
      {options.map((option) => (
        <Pressable
          key={option.medicineId}
          disabled={!option.isSellable}
          onPress={() => onChoose(option)}
          accessibilityRole="button"
          accessibilityLabel={optionLabel(option, t)}
          accessibilityState={{ disabled: !option.isSellable }}
          className="gap-1 rounded-xl border border-fieldBorder p-3 active:opacity-70 disabled:opacity-40"
        >
          <Text className="font-sans-semibold text-base text-richBlack">{option.name}</Text>
          <DosageFormTag type={option.dosageForm} strength={option.strength} />
          <Text className="font-sans text-xs text-midGray">
            {option.isSellable ? describeOption(option) : t("liveScanOutOfStock")}
          </Text>
        </Pressable>
      ))}
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={t("liveScanChooseDismiss")}
        className="items-center py-2 active:opacity-70"
      >
        <Text className="font-sans-semibold text-sm text-midGray">{t("liveScanChooseDismiss")}</Text>
      </Pressable>
    </View>
  );
}

export interface LiveScanCartLine {
  medicineId: string;
  name: string;
  quantity: number;
}

export function LiveScanCartBar({
  lines,
  itemCount,
  total,
  onDone,
  onManualSearch,
}: {
  lines: readonly LiveScanCartLine[];
  itemCount: number;
  total: Paisa;
  onDone: () => void;
  onManualSearch: () => void;
}) {
  const { t, formatNumber, formatMoney } = useI18n();
  return (
    <View className="gap-3">
      {lines.length === 0 ? (
        <Text className="text-center font-sans-semibold text-base text-white">
          {t("liveScanNextPrompt")}
        </Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {lines.map((line) => (
            <View key={line.medicineId} className="flex-row items-center gap-1 rounded-full bg-white/20 px-3 py-1.5">
              <Text className="font-sans-semibold text-xs text-white">{line.name}</Text>
              <Text className="font-sans-bold text-xs text-white">×{formatNumber(line.quantity)}</Text>
            </View>
          ))}
        </ScrollView>
      )}
      {itemCount > 0 ? (
        <View className="flex-row items-center gap-3">
          <View className="flex-row items-center gap-2 rounded-2xl border border-white/30 bg-white/20 px-4 py-3.5">
            <Feather name="shopping-cart" size={18} color="white" />
            <Text className="font-sans-bold text-base text-white">{formatNumber(itemCount)}</Text>
          </View>
          <Pressable
            onPress={onDone}
            accessibilityRole="button"
            accessibilityLabel={`${t("done")}: ${formatNumber(itemCount)}`}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-brand-green py-3.5 active:opacity-80"
          >
            <Text className="font-sans-bold text-base text-white">{t("done")}</Text>
            <Text className="font-mono text-base text-white">{formatMoney(total)}</Text>
          </Pressable>
        </View>
      ) : null}
      <Pressable
        onPress={onManualSearch}
        accessibilityRole="button"
        accessibilityLabel={t("searchManually")}
        className="items-center py-1 active:opacity-70"
      >
        <Text className="font-sans text-sm text-white/70 underline">{t("searchManually")}</Text>
      </Pressable>
    </View>
  );
}
