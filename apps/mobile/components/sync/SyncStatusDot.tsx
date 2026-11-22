import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, type ViewStyle } from "react-native";
import { colors } from "@muthoy/constants";
import type { CatalogKey } from "../../i18n/catalog";
import type { SyncState } from "./syncState";

// components/sync/SyncStatusDot.tsx — the blinking dot on a header's sync
// button. Yellow while changes wait to be sent, red when they cannot be sent,
// nothing otherwise. Presentational: the header passes the live state
// (state/liveSyncState.ts) so it can also say it to a screen reader — colour
// alone never carries the meaning.

const BLINK_HALF_MS = 650;
const DIM_OPACITY = 0.25;

const DOT_STYLE: ViewStyle = {
  position: "absolute",
  top: 6,
  right: 6,
  width: 9,
  height: 9,
  borderRadius: 4.5,
  borderWidth: 1.5,
  borderColor: colors.white,
};

/** The sync button's spoken name, with the queue state the dot shows. */
export function syncButtonLabel(t: (key: CatalogKey) => string, state: SyncState): string {
  if (state === "failing") return t("sync") + ". " + t("syncDotFailing");
  if (state === "waiting") return t("sync") + ". " + t("syncDotWaiting");
  return t("sync");
}

export function SyncStatusDot({ state }: { state: SyncState }) {
  if (state !== "waiting" && state !== "failing") return null;
  return <BlinkingDot color={state === "failing" ? colors.syncFailedDot : colors.syncPendingDot} />;
}

function BlinkingDot({ color }: { color: string }) {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    let cancelled = false;
    let loop: Animated.CompositeAnimation | null = null;
    // Reduce Motion keeps the dot, still: the warning stays, the blink goes.
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduceMotion) => {
        if (cancelled || reduceMotion) return;
        loop = Animated.loop(Animated.sequence([
          Animated.timing(opacity, { toValue: DIM_OPACITY, duration: BLINK_HALF_MS, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: BLINK_HALF_MS, useNativeDriver: true }),
        ]));
        loop.start();
      });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [opacity]);
  return (
    <Animated.View
      pointerEvents="none"
      testID="sync-status-dot"
      style={[DOT_STYLE, { backgroundColor: color, opacity }]}
    />
  );
}
