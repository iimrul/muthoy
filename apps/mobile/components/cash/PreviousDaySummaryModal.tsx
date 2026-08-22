import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { formatMoney } from "@muthoy/utils";
import { ZERO_PAISA } from "@muthoy/types";
import type { DaySummary } from "../../db/ownerDashboard";
import { useI18n } from "../../state/localeStore";

// The prototype's PreviousDaySummaryModal, on the production day summary.
//
// Presentational: dashboard.tsx loads the DaySummary through
// db/ownerDashboard.getDaySummary (which gates on cash_management) and passes
// it in. CLAUDE.md rule 6: money in DM Mono, counts in Plus Jakarta Sans.

interface StatProps {
  label: string;
  value: string;
  isMoney?: boolean;
}

function Stat({ label, value, isMoney = true }: StatProps) {
  return (
    <View className="flex-1 gap-1 rounded-xl border border-midGray/20 bg-white p-3">
      <Text
        numberOfLines={1}
        className="font-sans-semibold text-[10px] uppercase tracking-wide text-midGray"
      >
        {label}
      </Text>
      <Text
        numberOfLines={1}
        className={`text-base text-richBlack ${isMoney ? "font-mono" : "font-sans-bold"}`}
      >
        {value}
      </Text>
    </View>
  );
}

interface PreviousDaySummaryModalProps {
  visible: boolean;
  onClose: () => void;
  summary: DaySummary | null;
  /** Localised date line for `summary.businessDate`, built by the screen. */
  dateLabel: string;
}

export function PreviousDaySummaryModal({
  visible,
  onClose,
  summary,
  dateLabel,
}: PreviousDaySummaryModalProps) {
  const { t, formatNumber } = useI18n();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable onPress={onClose} className="flex-1 justify-end bg-black/50">
        <Pressable className="max-h-[85%] rounded-t-3xl bg-white">
          <View className="gap-1 rounded-t-3xl bg-brand-green p-5">
            <Text className="font-sans-semibold text-[11px] uppercase tracking-widest text-white/70">
              {t("yesterdaySummary")}
            </Text>
            <Text className="font-sans text-xs text-white/80">{dateLabel}</Text>
            <Text className="font-mono text-3xl text-white">
              {formatMoney(summary?.totalSales ?? ZERO_PAISA)}
            </Text>
            {summary?.trend ? (
              <Text className="font-sans text-xs text-white/80">
                {summary.trend.isUp ? "▲" : "▼"}{" "}
                {formatNumber(summary.trend.percent)}%{" "}
                {summary.trend.isUp
                  ? t("moreThanDayBefore")
                  : t("lessThanDayBefore")}
              </Text>
            ) : null}
          </View>

          <ScrollView contentContainerClassName="gap-4 p-5">
            <View className="flex-row gap-3">
              <Stat
                label={t("cashSales")}
                value={formatMoney(summary?.cashSales ?? ZERO_PAISA)}
              />
              <Stat
                label={t("creditSales")}
                value={formatMoney(summary?.creditSales ?? ZERO_PAISA)}
              />
            </View>
            <View className="flex-row gap-3">
              <Stat
                label={t("transactions")}
                value={formatNumber(summary?.transactionCount ?? 0)}
                isMoney={false}
              />
              <Stat
                label={t("avgSale")}
                value={formatMoney(summary?.averageSale ?? ZERO_PAISA)}
              />
            </View>

            <View className="gap-2">
              <Text className="font-sans-semibold text-[11px] uppercase tracking-wide text-midGray">
                {t("topSold")}
              </Text>
              {summary?.topItems.length ? (
                summary.topItems.map((item, index) => (
                  <View
                    key={`${item.medicineName}-${item.unit}`}
                    className="flex-row items-center justify-between gap-3"
                  >
                    <View className="flex-1 flex-row items-center gap-2">
                      <View className="h-6 w-6 items-center justify-center rounded-full bg-brand-softGreen">
                        <Text className="font-mono text-[10px] text-brand-green">
                          {formatNumber(index + 1)}
                        </Text>
                      </View>
                      <Text
                        numberOfLines={1}
                        className="flex-1 font-sans-semibold text-sm text-richBlack"
                      >
                        {item.medicineName}
                      </Text>
                    </View>
                    <Text className="font-sans-semibold text-sm text-midGray">
                      {formatNumber(item.quantity)} {item.unit}
                    </Text>
                  </View>
                ))
              ) : (
                <Text className="font-sans text-sm text-midGray">
                  {t("noSalesThatDay")}
                </Text>
              )}
            </View>

            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              className="items-center rounded-2xl bg-brand-softGreen py-4"
            >
              <Text className="font-sans-bold text-brand-green">
                {t("close")}
              </Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
