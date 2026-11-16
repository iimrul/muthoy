import { countFailedSyncRows, countStuckSyncRows } from "../db/sync-helpers";
import {
  createNotification,
  findUnresolvedSyncAlert,
  resolveSyncAlerts,
} from "../db/notifications";
import { encodeLocalizedText } from "../i18n/localizedText";

export async function notifyIfSyncIsStuck(shopId: string): Promise<void> {
  // Stuck rows count too: they keep retrying instead of failing, so the failed
  // count alone would stay at zero while later sales wait behind them.
  const failedCount = countFailedSyncRows(shopId) + countStuckSyncRows(shopId);
  if (failedCount <= 0 || (await findUnresolvedSyncAlert(shopId))) {
    return;
  }
  await createNotification(
    shopId,
    "sync",
    "warning",
    encodeLocalizedText("Sync issue", "সিঙ্ক সমস্যা"),
    encodeLocalizedText(
      `${failedCount} change(s) could not reach the cloud yet`,
      `${new Intl.NumberFormat("bn-BD").format(failedCount)}টি পরিবর্তন এখনো ক্লাউডে পৌঁছায়নি`,
    ),
  );
}

export async function notifySyncHalted(
  shopId: string,
  message: string,
): Promise<void> {
  if (await findUnresolvedSyncAlert(shopId)) {
    return;
  }
  await createNotification(shopId, "sync", "warning", "Sync stopped", message);
}

/**
 * Re-arms the warning: once a completed cycle leaves nothing failed or stuck,
 * the open sync warning is resolved so the next problem is reported afresh.
 */
export async function resolveSyncAlertIfHealthy(shopId: string): Promise<void> {
  if (countFailedSyncRows(shopId) + countStuckSyncRows(shopId) > 0) {
    return;
  }
  await resolveSyncAlerts(shopId);
}
