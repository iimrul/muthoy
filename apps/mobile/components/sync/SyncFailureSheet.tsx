import { Pressable, ScrollView, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { colors } from "@muthoy/constants";
import { UNDELIVERED_LIST_LIMIT } from "../../db/sync-helpers";
import {
  syncDiagnosticReport,
  syncFailureKindOf,
  syncFailureReasonOf,
  undeliveredChanges,
  type UndeliveredSyncRow,
} from "../../domain/syncFailures";
import { fillTemplate } from "../../i18n/display";
import { useI18n } from "../../state/localeStore";
import { BaseSheet } from "../ui/BaseModal";
import { showToast } from "../ui/Toast";
import { kindLabel, queueTimestamp, reasonLabel } from "./undeliveredText";

// components/sync/SyncFailureSheet.tsx — the "View details" sheet behind the
// dashboard's one-line summary (founder request 2026-11-25). One line per
// thing the owner did: what it was, when, and why it did not arrive, plus a
// support report that carries no payload. The card itself stays one line.

export interface SyncFailureSheetProps {
  visible: boolean;
  onClose: () => void;
  shopId: string;
  rows: readonly UndeliveredSyncRow[];
  counts: { pending: number; failed: number; stuck: number };
}

function appVersion(): string {
  const version = Constants.expoConfig?.version ?? "0.1.0";
  const build = Constants.expoConfig?.android?.versionCode;
  return build ? `${version} (${build})` : version;
}

export function SyncFailureSheet({ visible, onClose, shopId, rows, counts }: SyncFailureSheetProps) {
  const { t, formatNumber, formatDateTime } = useI18n();
  const changes = undeliveredChanges(rows);
  const countsLine = [
    t("syncPendingLabel") + ": " + formatNumber(counts.pending),
    t("syncFailedLabel") + ": " + formatNumber(counts.failed),
    ...(counts.stuck > 0 ? [t("syncStuckLabel") + ": " + formatNumber(counts.stuck)] : []),
  ].join(" · ");

  const copyReport = async () => {
    try {
      await Clipboard.setStringAsync(syncDiagnosticReport(shopId, rows, appVersion()));
      showToast({ message: t("syncDetailsCopied") });
    } catch {
      // Nothing to recover: the sheet stays open and the owner can try again.
    }
  };

  return (
    <BaseSheet visible={visible} onClose={onClose} title={t("syncDetailsTitle")} panelClassName="max-h-[85%]">
      <Text className="font-sans text-xs text-midGray">{countsLine}</Text>
      <ScrollView className="mt-2" contentContainerClassName="pb-1">
        {changes.map((row) => (
          <View key={row.id} className="flex-row gap-3 border-b border-auth-fieldBorder py-3">
            <View className="mt-1.5 h-2 w-2 rounded-full bg-error" />
            <View className="flex-1 gap-0.5">
              <Text className="font-sans-semibold text-sm text-richBlack">
                {kindLabel(syncFailureKindOf(row), t)}
              </Text>
              <Text className="font-sans text-xs text-midGray">{formatDateTime(queueTimestamp(row.createdAt))}</Text>
              <Text className="font-sans text-xs text-error">{reasonLabel(syncFailureReasonOf(row), t)}</Text>
            </View>
          </View>
        ))}
        {rows.length >= UNDELIVERED_LIST_LIMIT ? (
          <Text className="pt-2 font-sans text-xs text-midGray">
            {fillTemplate(t("syncDetailsTruncated"), { count: formatNumber(UNDELIVERED_LIST_LIMIT) })}
          </Text>
        ) : null}
      </ScrollView>
      <View className="mt-3 rounded-xl bg-errorBg p-3">
        <Text className="font-sans-semibold text-xs leading-5 text-error">{t("syncFailingBody")}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("syncDetailsCopy")}
        onPress={() => { void copyReport(); }}
        className="mt-3 min-h-[48px] flex-row items-center justify-center gap-2 rounded-xl border border-brand-green active:opacity-80"
      >
        <Feather name="copy" size={16} color={colors.brandGreen} />
        <Text className="font-sans-bold text-sm text-brand-green">{t("syncDetailsCopy")}</Text>
      </Pressable>
    </BaseSheet>
  );
}
