import { countFailedSyncRows } from '../db/sync-helpers';
import {
  createNotification,
  findUnresolvedSyncAlert,
} from '../db/notifications';

export async function notifyIfSyncIsStuck(shopId: string): Promise<void> {
  const failedCount = countFailedSyncRows(shopId);
  if (failedCount <= 0 || await findUnresolvedSyncAlert(shopId)) {
    return;
  }
  await createNotification(
    shopId,
    'sync',
    'warning',
    'Sync issue',
    `${failedCount} change(s) could not reach the cloud yet`,
  );
}

export async function notifySyncHalted(shopId: string, message: string): Promise<void> {
  if (await findUnresolvedSyncAlert(shopId)) {
    return;
  }
  await createNotification(
    shopId,
    'sync',
    'warning',
    'Sync stopped',
    message,
  );
}
