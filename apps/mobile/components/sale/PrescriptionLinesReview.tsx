import { Pressable, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import type { PrescriptionLine } from "../../domain/prescriptionLines";
import { useI18n } from "../../state/localeStore";

// components/sale/PrescriptionLinesReview.tsx — W2-01 section 6.2.4.
//
// A captured prescription is now read as well as stored, and this is the
// review list that text lands in. It is the same per-line
// review-and-confirm shape app/suppliers/purchase-create.tsx already proves,
// not a second pattern.
//
// Presentational only: no database, no cart, no matching. app/sale/checkout.tsx
// owns all three, which is what keeps "nothing is added without a press" a
// property of one screen rather than of this list.
//
// The recognised text is never persisted. It lives in checkout's state for as
// long as that screen is open and goes no further.

// The line shape lives in domain/prescriptionLines.ts, beside the matching
// that produces it, so this component and checkout cannot drift apart.

export interface PrescriptionLinesReviewProps {
  lines: readonly PrescriptionLine[];
  /** A non-blocking notice: the image is kept whatever the reader managed. */
  notice: string | null;
  onAdd: (line: PrescriptionLine) => void;
  onSearch: (line: PrescriptionLine) => void;
  onDismiss: () => void;
}

export function PrescriptionLinesReview({
  lines,
  notice,
  onAdd,
  onSearch,
  onDismiss,
}: PrescriptionLinesReviewProps) {
  const { t, formatMoney } = useI18n();
  if (!notice && lines.length === 0) return null;

  return (
    <View className="gap-3 rounded-lg bg-white p-4">
      <View className="flex-row items-center justify-between">
        <Text className="font-sans-semibold text-richBlack">
          {t("prescriptionLinesTitle")}
        </Text>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={t("dismissLabel")}
          hitSlop={8}
          className="h-8 w-8 items-center justify-center"
        >
          <Feather name="x" size={18} color="#6B7280" />
        </Pressable>
      </View>

      {notice ? (
        <Text className="font-sans text-xs text-midGray">{notice}</Text>
      ) : null}

      {lines.length > 0 ? (
        <>
          <Text className="font-sans text-xs text-midGray">
            {t("prescriptionLinesHint")}
          </Text>
          {lines.map((line) => (
            <View key={line.id} className="gap-1 rounded-xl bg-[#F9FAFB] p-3">
              <Text className="font-sans text-xs text-midGray">
                {line.rawText}
              </Text>
              {line.match ? (
                <>
                  <View className="flex-row items-center justify-between">
                    <Text className="flex-1 font-sans-medium text-sm text-richBlack">
                      {line.match.name}
                    </Text>
                    {/* Money carries the DM Mono token. */}
                    <Text className="font-mono text-sm text-richBlack">
                      {formatMoney(line.match.unitPrice)}
                    </Text>
                  </View>
                  {line.isAdded ? (
                    <Text className="font-sans-medium text-xs text-brand-green">
                      {t("prescriptionLineAddedLabel")}
                    </Text>
                  ) : (
                    <Pressable
                      onPress={() => onAdd(line)}
                      accessibilityRole="button"
                      accessibilityLabel={`${t("prescriptionLineAddLabel")} ${line.match.name}`}
                      className="items-center rounded-lg bg-brand-green py-2 active:opacity-80"
                    >
                      <Text className="font-sans-semibold text-sm text-white">
                        {t("prescriptionLineAddLabel")}
                      </Text>
                    </Pressable>
                  )}
                </>
              ) : (
                <>
                  <Text className="font-sans text-xs text-[#92400E]">
                    {t("prescriptionLineNoMatchLabel")}
                  </Text>
                  <Pressable
                    onPress={() => onSearch(line)}
                    accessibilityRole="button"
                    accessibilityLabel={`${t("prescriptionLineSearchLabel")} ${line.rawText}`}
                    className="items-center rounded-lg border border-brand-green py-2 active:opacity-80"
                  >
                    <Text className="font-sans-semibold text-sm text-brand-green">
                      {t("prescriptionLineSearchLabel")}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}
