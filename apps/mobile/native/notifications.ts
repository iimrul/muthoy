import { Platform } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { daysUntilExpiry, formatMoney, formatNumber } from '@muthoy/utils';
import { expectedCash } from '../domain/cashFormula';
import { sortByExpiry } from '../domain/fefo';
import { expirySeverity, isBatchInExpiryWindow, isLowStockCrossing, isStockRecovered } from '../domain/notificationRules';
import { hasPermissionForRoleName } from '../domain/permissions';
import { getActiveSessionRole } from '../db/auth';
import { getCashSummary } from '../db/cash';
import { listBatchesForMedicine, listMedicines } from '../db/inventory';
import {
  createDailySummaryNotification,
  createNotification,
  findUnresolvedLowStockAlert,
  hasDailySummaryToday,
  hasExpiryAlert,
  localBusinessDate,
  resolveLowStockAlert,
  type NotificationSeverity,
} from '../db/notifications';
import { readPersistedSessionSync } from '../state/sessionStore';

// expo-background-task's SDK 57 iOS plugin schedules this fixed native
// identifier; using the same task name keeps app.json and defineTask aligned.
export const NOTIFICATION_BACKGROUND_TASK = 'com.expo.modules.backgroundtask.processing';
const ANDROID_CHANNEL_ID = 'muthoy-alerts';
const BACKGROUND_MINIMUM_INTERVAL_MINUTES = 15;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidNotificationChannelAsync(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Muthoy alerts',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

async function presentLocalNotification(title: string, body: string, severity: NotificationSeverity): Promise<void> {
  try {
    await ensureAndroidNotificationChannelAsync();
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { route: '/notifications' },
        priority: severity === 'critical' ? Notifications.AndroidNotificationPriority.HIGH : undefined,
      },
      trigger: Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : null,
    });
  } catch (error) {
    console.warn('Local notification delivery failed', error);
  }
}

async function runLowStockCheck(shopId: string): Promise<void> {
  const medicines = await listMedicines(shopId);
  for (const medicine of medicines) {
    const unresolved = await findUnresolvedLowStockAlert(shopId, medicine.medicineId);
    if (isLowStockCrossing(medicine.totalStock, medicine.threshold, Boolean(unresolved))) {
      const title = `Low stock: ${medicine.name}`;
      const body = `${formatNumber(medicine.totalStock)} left (threshold ${formatNumber(medicine.threshold)})`;
      await createNotification(shopId, 'low_stock', 'warning', title, body, medicine.medicineId);
      await presentLocalNotification(title, body, 'warning');
    } else if (isStockRecovered(medicine.totalStock, medicine.threshold, Boolean(unresolved)) && unresolved) {
      await resolveLowStockAlert(unresolved.id);
    }
  }
}

async function runExpiryCheck(shopId: string, now: Date): Promise<void> {
  const medicines = await listMedicines(shopId);
  for (const medicine of medicines) {
    const batches = sortByExpiry(await listBatchesForMedicine(shopId, medicine.medicineId));
    for (const batch of batches) {
      const days = daysUntilExpiry(batch.expiryDate, now);
      if (!isBatchInExpiryWindow(days) || days === null || (await hasExpiryAlert(shopId, batch.id))) {
        continue;
      }
      const severity = expirySeverity(days);
      const title = `Expiring soon: ${medicine.name}`;
      const body = `Batch ${batch.batchNo} expires in ${formatNumber(days)} days (${batch.expiryDate})`;
      await createNotification(shopId, 'expiry', severity, title, body, batch.id);
      await presentLocalNotification(title, body, severity);
    }
  }
}

async function runDailySummaryCheck(shopId: string, now: Date): Promise<void> {
  const session = readPersistedSessionSync();
  // Cheap pre-filter off the persisted session, then the authoritative SQLite
  // re-read. Both route through domain/permissions so a P1 'manager' or an
  // unknown persisted role fails closed here exactly as it does everywhere
  // else, instead of being compared against the literal 'owner'.
  if (
    !session ||
    session.shopId !== shopId ||
    !hasPermissionForRoleName(session.role, 'cash_management') ||
    now.getHours() < 20
  ) {
    return;
  }
  if (!hasPermissionForRoleName(await getActiveSessionRole(session.userId, shopId), 'cash_management')) {
    return;
  }
  const businessDate = localBusinessDate(now);
  if (await hasDailySummaryToday(shopId, businessDate)) {
    return;
  }
  // The owner check above already ran against SQLite; getCashSummary re-checks
  // it as the single gate on this read.
  const cash = expectedCash(await getCashSummary(shopId, session.userId, businessDate));
  const title = `Cash summary — ${businessDate}`;
  const body = `Expected cash in drawer: ${formatMoney(cash)}`;
  await createDailySummaryNotification(shopId, session.userId, title, body, businessDate);
  await presentLocalNotification(title, body, 'info');
}

let activeCheck: Promise<void> | null = null;

export function runNotificationChecks(shopId: string): Promise<void> {
  if (activeCheck) {
    return activeCheck;
  }
  activeCheck = (async () => {
    const session = readPersistedSessionSync();
    if (!session || session.shopId !== shopId) {
      return;
    }
    const now = new Date();
    try {
      await runLowStockCheck(shopId);
    } catch (error) {
      console.warn('Low-stock notification check failed', error);
    }
    try {
      await runExpiryCheck(shopId, now);
    } catch (error) {
      console.warn('Expiry notification check failed', error);
    }
    try {
      await runDailySummaryCheck(shopId, now);
    } catch (error) {
      console.warn('Daily-summary notification check failed', error);
    }
  })().finally(() => {
    activeCheck = null;
  });
  return activeCheck;
}

if (!TaskManager.isTaskDefined(NOTIFICATION_BACKGROUND_TASK)) {
  TaskManager.defineTask(NOTIFICATION_BACKGROUND_TASK, async () => {
    const session = readPersistedSessionSync();
    if (!session) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    try {
      await runNotificationChecks(session.shopId);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerNotificationBackgroundTaskAsync(): Promise<void> {
  if (!(await TaskManager.isAvailableAsync())) {
    return;
  }
  if (!(await TaskManager.isTaskRegisteredAsync(NOTIFICATION_BACKGROUND_TASK))) {
    await BackgroundTask.registerTaskAsync(NOTIFICATION_BACKGROUND_TASK, {
      minimumInterval: BACKGROUND_MINIMUM_INTERVAL_MINUTES,
    });
  }
}

export async function requestNotificationPermissionsAsync(): Promise<boolean> {
  await ensureAndroidNotificationChannelAsync();
  const current = await Notifications.getPermissionsAsync();
  const result = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (result.granted) {
    await registerNotificationBackgroundTaskAsync();
  }
  return result.granted;
}
