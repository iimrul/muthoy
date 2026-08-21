import { countFailedSyncRows } from "../db/sync-helpers";
import {
  createNotification,
  findUnresolvedSyncAlert,
} from "../db/notifications";
import { encodeLocalizedText } from "../i18n/localizedText";

export async function notifyIfSyncIsStuck(shopId: string): Promise<void> {
  const failedCount = countFailedSyncRows(shopId);
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
