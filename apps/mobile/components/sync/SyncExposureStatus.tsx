import { useCallback, useState, type ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { colors } from "@muthoy/constants";
import { getSyncExposure, listUndeliveredSyncRows } from "../../db/sync-helpers";
import type { UndeliveredSyncRow } from "../../domain/syncFailures";
import { fillTemplate } from "../../i18n/display";
import { subscribeToSyncCompletion } from "../../sync";
import type { Session } from "../../state/sessionStore";
import { captureSessionFor } from "../../state/sessionGuard";
import { useI18n } from "../../state/localeStore";
import { SyncFailureSheet } from "./SyncFailureSheet";
import { syncStateOf, type SyncCounts, type SyncState } from "./syncState";
import { undeliveredSentence } from "./undeliveredText";

export { syncStateOf };

interface SyncExposure extends SyncCounts {
  shopId: string;
  /** Read only when something failed or is stuck; empty otherwise. */
  undelivered: UndeliveredSyncRow[];
}

function readUndelivered(shopId: string, counts: SyncCounts): UndeliveredSyncRow[] {
  if (counts.failed + counts.stuck === 0) return [];
  try {
    return listUndeliveredSyncRows(shopId);
  } catch {
    // The counts still tell the owner something failed; only the names are lost.
    return [];
  }
}

interface StateLook {
  tile: string;
  title: string;
  icon: ComponentProps<typeof Feather>["name"];
  color: string;
}

function lookOf(state: SyncState): StateLook {
  switch (state) {
    case "sent":
      return { tile: "bg-brand-softGreen", title: "text-auth-heroEnd", icon: "check-circle", color: colors.authHeroEnd };
    case "waiting":
      return { tile: "bg-warningBg", title: "text-richBlack", icon: "upload-cloud", color: colors.warning };
    case "failing":
      return { tile: "bg-errorBg", title: "text-error", icon: "alert-triangle", color: colors.error };
    default:
      return { tile: "bg-auth-neutralFill", title: "text-richBlack", icon: "help-circle", color: colors.midGray };
  }
}

// Simplified 2026-11-22 at the founder's request: one plain sentence for the
// state — sent (green), waiting (amber), failing (red) — and what to do about
// it. Two rules from the android remediation plan still hold: the shop's own
// pending/failed counts stay visible when anything is wrong, and an empty
// queue is never presented as a backup (the footnote says so every time).
// 2026-11-25 (founder): a failing card names WHAT did not arrive, in one line
// ("1 sale and 1 activity record didn't reach the server"), and "View details"
// opens a sheet with each one's time and reason. The card does not grow.
export function SyncExposureStatus({ session }: { session: Session }) {
  const { t, formatNumber } = useI18n();
  const [exposure, setExposure] = useState<SyncExposure | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    const refresh = () => {
      const guard = captureSessionFor(session);
      if (!active || !guard) return;
      try {
        const counts = getSyncExposure(session.shopId);
        const undelivered = readUndelivered(session.shopId, counts);
        guard.ifLive(() => setExposure({ shopId: session.shopId, ...counts, undelivered }));
      } catch {
        guard.ifLive(() => setExposure(null));
      }
    };
    refresh();
    const unsubscribe = subscribeToSyncCompletion(session.shopId, async () => refresh());
    return () => { active = false; unsubscribe(); };
  }, [session]));
  const current = exposure?.shopId === session.shopId ? exposure : null;
  const state = syncStateOf(current);
  const look = lookOf(state);

  let title = t("syncExposureUnavailable");
  let detail: string | null = null;
  let advice: string | null = null;
  if (current && state === "sent") {
    title = t("syncAllSentTitle");
    detail = t("syncAllSentBody");
  } else if (current && state === "waiting") {
    title = fillTemplate(t("syncWaitingTitle"), { count: formatNumber(current.pending) });
    advice = t("syncExposureWarning");
  } else if (current && state === "failing") {
    title = undeliveredSentence(current.undelivered, t, formatNumber)
      ?? fillTemplate(t("syncFailingTitle"), { count: formatNumber(current.failed + current.stuck) });
    detail = [
      t("syncPendingLabel") + ": " + formatNumber(current.pending),
      t("syncFailedLabel") + ": " + formatNumber(current.failed),
      ...(current.stuck > 0 ? [t("syncStuckLabel") + ": " + formatNumber(current.stuck)] : []),
    ].join(" · ");
    advice = t("syncFailingBody");
  }
  const canShowDetails = state === "failing" && (current?.undelivered.length ?? 0) > 0;
  const notBackup = session.role === "owner"
    ? t("syncExposureNotBackup") + " " + t("recoveryOwnerStatusHint")
    : t("syncExposureNotBackup");

  return <View className="gap-3 rounded-2xl border border-auth-fieldBorder bg-white p-4">
    <View className="flex-row items-center gap-3">
      <View className={"h-10 w-10 items-center justify-center rounded-xl " + look.tile}>
        <Feather name={look.icon} size={18} color={look.color} />
      </View>
      <View className="flex-1">
        <Text accessibilityRole="header" className={"font-sans-bold text-sm " + look.title}>{title}</Text>
        {canShowDetails ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("syncDetailsLink")}
            onPress={() => setDetailsOpen(true)}
            hitSlop={8}
            className="mt-0.5 flex-row items-center gap-1 self-start active:opacity-70"
          >
            <Text className="font-sans text-xs text-midGray">{detail}</Text>
            <Text className="font-sans-semibold text-xs text-brand-green">{" · " + t("syncDetailsLink")}</Text>
            <Feather name="chevron-right" size={12} color={colors.brandGreen} />
          </Pressable>
        ) : detail ? <Text className="mt-0.5 font-sans text-xs text-midGray">{detail}</Text> : null}
      </View>
    </View>
    {advice ? (
      <View className={"rounded-xl p-3 " + (state === "failing" ? "bg-errorBg" : "bg-warningBg")}>
        <Text className={"font-sans-semibold text-xs leading-5 " + (state === "failing" ? "text-error" : "text-richBlack")}>
          {advice}
        </Text>
      </View>
    ) : null}
    <Text className="font-sans text-[11px] leading-4 text-midGray">{notBackup}</Text>
    {canShowDetails && current ? (
      <SyncFailureSheet
        visible={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        shopId={current.shopId}
        rows={current.undelivered}
        counts={{ pending: current.pending, failed: current.failed, stuck: current.stuck }}
      />
    ) : null}
  </View>;
}
