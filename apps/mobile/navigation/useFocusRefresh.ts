import { useCallback } from "react";
import { useFocusEffect } from "expo-router";

/**
 * Runs `refresh` each time the screen gains focus — one task AFTER the focus,
 * so the frame that shows the screen is never held up by its data reads.
 *
 * Why: the primary screens are kept mounted (app/(tabs)/_layout.tsx) and
 * reload on focus. A focus effect runs in the same JavaScript task as the tap
 * that caused it, and the reads behind it are synchronous SQLite calls, so
 * reloading inline made the tab switch wait for the queries. Deferred, the
 * kept screen appears at once with its last data and updates a moment later.
 */
export function useFocusRefresh(refresh: () => void): void {
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(refresh, 0);
      return () => clearTimeout(timer);
    }, [refresh]),
  );
}
