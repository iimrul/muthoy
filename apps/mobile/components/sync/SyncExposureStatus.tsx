import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { colors } from "@muthoy/constants";
import { getSyncExposure } from "../../db/sync-helpers";
import { subscribeToSyncCompletion } from "../../sync";
import type { Session } from "../../state/sessionStore";
import { captureSessionFor } from "../../state/sessionGuard";
import { useI18n } from "../../state/localeStore";

export function SyncExposureStatus({ session }: { session: Session }) {
  const { t, formatNumber } = useI18n();
  const [exposure, setExposure] = useState<{ shopId: string; pending: number; failed: number; stuck: number } | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    const refresh = () => {
      const guard = captureSessionFor(session);
      if (!active || !guard) return;
      try {
        const counts = getSyncExposure(session.shopId);
        guard.ifLive(() => setExposure({ shopId: session.shopId, ...counts }));
      } catch {
        guard.ifLive(() => setExposure(null));
      }
    };
    refresh();
    const unsubscribe = subscribeToSyncCompletion(session.shopId, async () => refresh());
    return () => { active = false; unsubscribe(); };
  }, [session]));
  const current = exposure?.shopId === session.shopId ? exposure : null;
  const stuckSuffix = current && current.stuck > 0
    ? " · " + t("syncStuckLabel") + ": " + formatNumber(current.stuck)
    : "";
  // Brand card (2026-11-22): the parent owns the spacing, the counts read in
  // the brand green until something failed or stuck, and the three safety
  // sentences sit together in one muted panel. Every sentence is kept.
  const hasProblem = current !== null && (current.failed > 0 || current.stuck > 0);
  return <View className="gap-3 rounded-2xl border border-auth-fieldBorder bg-white p-4">
    <View className="flex-row items-center gap-3">
      <View className={`h-10 w-10 items-center justify-center rounded-xl ${hasProblem ? "bg-errorBg" : "bg-brand-softGreen"}`}>
        <Feather name="refresh-cw" size={18} color={hasProblem ? colors.error : colors.authHeroEnd} />
      </View>
      <View className="flex-1">
        <Text className="font-sans-bold text-sm text-richBlack">{t("syncExposureTitle")}</Text>
        <Text className={`mt-0.5 font-sans-semibold text-xs ${hasProblem ? "text-error" : "text-auth-heroEnd"}`}>
          {current ? t("syncPendingLabel") + ": " + formatNumber(current.pending) + " · " + t("syncFailedLabel") + ": " + formatNumber(current.failed) + stuckSuffix : t("syncExposureUnavailable")}
        </Text>
      </View>
    </View>
    <View className="gap-1.5 rounded-xl bg-auth-neutralFill p-3">
      <Text className="font-sans text-xs leading-5 text-midGray">{t("syncExposureWarning")}</Text>
      <Text className="font-sans text-xs leading-5 text-midGray">{t("syncExposureNotBackup")}</Text>
      <Text className="font-sans text-xs leading-5 text-midGray">{t(session.role === "owner" ? "recoveryOwnerStatusHint" : "recoveryStaffUnprotected")}</Text>
    </View>
  </View>;
}
