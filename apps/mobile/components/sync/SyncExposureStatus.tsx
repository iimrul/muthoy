import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
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
  return <View className="m-4 gap-2 rounded-xl border border-midGray bg-white p-4">
    <Text className="font-sans-semibold text-base text-richBlack">{t("syncExposureTitle")}</Text>
    <Text className="font-sans text-sm text-richBlack">
      {current ? t("syncPendingLabel") + ": " + formatNumber(current.pending) + " · " + t("syncFailedLabel") + ": " + formatNumber(current.failed) + stuckSuffix : t("syncExposureUnavailable")}
    </Text>
    <Text className="font-sans text-sm text-midGray">{t("syncExposureWarning")}</Text>
    <Text className="font-sans text-sm text-midGray">{t("syncExposureNotBackup")}</Text>
    <Text className="font-sans text-sm text-midGray">{t(session.role === "owner" ? "recoveryOwnerStatusHint" : "recoveryStaffUnprotected")}</Text>
  </View>;
}
