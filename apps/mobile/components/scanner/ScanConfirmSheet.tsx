import { Pressable, Text, View } from "react-native";
import type { Paisa } from "@muthoy/types";
import { BaseModal } from "../ui/BaseModal";
import { useI18n } from "../../state/localeStore";

// components/scanner/ScanConfirmSheet.tsx — W2-01 section 6.2.3.
//
// Scanning used to put a line straight into the cart the moment OCR produced
// an exact single match. A cart line is the first step of a money path, and
// scope C requires manual confirmation and correction before medicine details
// are recorded, so the match now has to pass through here first.
//
// This component decides NOTHING. It renders what was read, what it matched,
// and three ways out; the calling screen owns the cart write. That is what
// makes "addItem is reachable only from Confirm" checkable in one place per
// screen rather than spread through a scan handler.
//
// Not dismissible by a tap outside the panel: an accidental gesture must not
// be able to resolve a confirmation either way. Android Back and the panel's
// own control both discard, because discarding is the safe direction.

export interface ScanConfirmCandidate {
  /** What OCR actually read, shown so a misread is obvious before confirming. */
  recognizedText: string;
  medicineId: string;
  name: string;
  generic: string | null;
  manufacturer: string | null;
  requiresPrescription: boolean;
  batchId: string;
  batchNo: string | null;
  expiryDate: string | null;
  unitPrice: Paisa;
  /** Carried so a confirmed line keeps the stock ceiling the cart enforces. */
  availableQuantity?: number;
}

export interface ScanConfirmSheetProps {
  /** Null when nothing is awaiting confirmation. */
  candidate: ScanConfirmCandidate | null;
  onConfirm: (candidate: ScanConfirmCandidate) => void;
  /** Hands the recognised text back to a manual search for correction. */
  onEdit: (candidate: ScanConfirmCandidate) => void;
  onDiscard: () => void;
}

export function ScanConfirmSheet({
  candidate,
  onConfirm,
  onEdit,
  onDiscard,
}: ScanConfirmSheetProps) {
  const { t, formatMoney, formatDate } = useI18n();
  if (!candidate) return null;

  const secondary = [candidate.generic, candidate.manufacturer]
    .filter(Boolean)
    .join(" • ");

  return (
    <BaseModal
      visible
      // Back and the scrim both land here. Never on confirm.
      onClose={onDiscard}
      title={t("scanConfirmTitle")}
      dismissOnBackdropPress={false}
      hasEquivalentDismissControl
    >
      <View className="gap-3">
        <Text className="font-sans text-xs text-midGray">
          {t("scanConfirmHint")}
        </Text>

        <View className="gap-1 rounded-xl bg-[#F9FAFB] p-3">
          <Text className="font-sans text-xs text-midGray">
            {t("scanRecognizedTextLabel")}
          </Text>
          <Text className="font-sans text-sm text-richBlack">
            {candidate.recognizedText}
          </Text>
        </View>

        <View className="gap-1 rounded-xl bg-brand-softGreen p-3">
          <Text className="font-sans text-xs text-midGray">
            {t("scanMatchedMedicineLabel")}
          </Text>
          <Text className="font-sans-semibold text-base text-richBlack">
            {candidate.name}
          </Text>
          {secondary ? (
            <Text className="font-sans text-xs text-midGray">{secondary}</Text>
          ) : null}
          {candidate.requiresPrescription ? (
            <Text className="font-sans-medium text-xs text-[#92400E]">
              {t("requiresPrescriptionLabel")}
            </Text>
          ) : null}
        </View>

        <View className="flex-row justify-between">
          <Text className="font-sans text-xs text-midGray">
            {t("batchNoColumnLabel")}
          </Text>
          <Text className="font-sans text-xs text-richBlack">
            {candidate.batchNo ?? "—"}
          </Text>
        </View>
        <View className="flex-row justify-between">
          <Text className="font-sans text-xs text-midGray">
            {t("expiryShortLabel")}
          </Text>
          <Text className="font-sans text-xs text-richBlack">
            {candidate.expiryDate ? formatDate(candidate.expiryDate) : "—"}
          </Text>
        </View>
        <View className="flex-row justify-between">
          <Text className="font-sans text-xs text-midGray">
            {t("priceColumnLabel")}
          </Text>
          {/* Money carries the DM Mono token, never Plus Jakarta Sans. */}
          <Text className="font-mono text-sm text-richBlack">
            {formatMoney(candidate.unitPrice)}
          </Text>
        </View>

        <Pressable
          onPress={() => onConfirm(candidate)}
          accessibilityRole="button"
          accessibilityLabel={t("scanConfirmAddLabel")}
          className="items-center rounded-xl bg-brand-green py-3 active:opacity-80"
        >
          <Text className="font-sans-semibold text-base text-white">
            {t("scanConfirmAddLabel")}
          </Text>
        </Pressable>
        <View className="flex-row gap-3">
          <Pressable
            onPress={() => onEdit(candidate)}
            accessibilityRole="button"
            accessibilityLabel={t("scanEditLabel")}
            className="flex-1 items-center rounded-xl border border-brand-green py-3 active:opacity-80"
          >
            <Text className="font-sans-semibold text-sm text-brand-green">
              {t("scanEditLabel")}
            </Text>
          </Pressable>
          <Pressable
            onPress={onDiscard}
            accessibilityRole="button"
            accessibilityLabel={t("scanDiscardLabel")}
            className="flex-1 items-center rounded-xl border border-error py-3 active:opacity-80"
          >
            <Text className="font-sans-semibold text-sm text-error">
              {t("scanDiscardLabel")}
            </Text>
          </Pressable>
        </View>
      </View>
    </BaseModal>
  );
}
