import { Platform } from "react-native";
import * as BackgroundTask from "expo-background-task";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { daysUntilExpiry, formatMoney, formatNumber } from "@muthoy/utils";
import { expectedCash } from "../domain/cashFormula";
import { sortByExpiry } from "../domain/fefo";
import {
  expirySeverity,
  isBatchInExpiryWindow,
  isLowStockCrossing,
  isStockRecovered,
} from "../domain/notificationRules";
import { getActiveSessionRole } from "../db/auth";
import { getCashSummary } from "../db/cash";
import { listBatchesForMedicine, listMedicines } from "../db/inventory";
import {
  createDailySummaryNotification,
  createNotification,
  findUnresolvedLowStockAlert,
  hasDailySummaryToday,
  hasExpiryAlert,
  localBusinessDate,
  resolveLowStockAlert,
  type NotificationSeverity,
} from "../db/notifications";
import { readPersistedSessionSync } from "../state/sessionStore";
import { readNotificationPreferences } from "../state/notificationPreferencesStore";
import { useLocaleStore } from "../state/localeStore";
import { encodeLocalizedText, localizeStoredText } from "../i18n/localizedText";

// expo-background-task's SDK 57 iOS plugin schedules this fixed native
// identifier; using the same task name keeps app.json and defineTask aligned.
export const NOTIFICATION_BACKGROUND_TASK =
  "com.expo.modules.backgroundtask.processing";
const ANDROID_CHANNEL_ID = "muthoy-alerts";
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
  if (Platform.OS !== "android") {
    return;
  }
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "Muthoy alerts",
    importance: Notifications.AndroidImportance.HIGH,
  });
}

async function presentLocalNotification(
  title: string,
  body: string,
  severity: NotificationSeverity,
): Promise<void> {
  try {
    await ensureAndroidNotificationChannelAsync();
    const locale = useLocaleStore.getState().locale;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: localizeStoredText(title, locale),
        body: localizeStoredText(body, locale),
        data: { route: "/notifications" },
        priority:
          severity === "critical"
            ? Notifications.AndroidNotificationPriority.HIGH
            : undefined,
      },
      trigger:
        Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : null,
    });
  } catch (error) {
    console.warn("Local notification delivery failed", error);
  }
}

async function runLowStockCheck(shopId: string): Promise<void> {
  const preferences = readNotificationPreferences(shopId);
  if (!preferences.all || !preferences.stock) return;
  const medicines = await listMedicines(shopId);
  for (const medicine of medicines) {
    const unresolved = await findUnresolvedLowStockAlert(
      shopId,
      medicine.medicineId,
    );
    if (
      isLowStockCrossing(
        medicine.totalStock,
        medicine.threshold,
        Boolean(unresolved),
      )
    ) {
      const title = encodeLocalizedText(
        `Low stock: ${medicine.name}`,
        `কম স্টক: ${medicine.name}`,
      );
      const body = encodeLocalizedText(
        `${formatNumber(medicine.totalStock)} left (threshold ${formatNumber(medicine.threshold)})`,
        `${new Intl.NumberFormat("bn-BD").format(medicine.totalStock)}টি বাকি (সীমা ${new Intl.NumberFormat("bn-BD").format(medicine.threshold)})`,
      );
      await createNotification(
        shopId,
        "low_stock",
        "warning",
        title,
        body,
        medicine.medicineId,
      );
      await presentLocalNotification(title, body, "warning");
    } else if (
      isStockRecovered(
        medicine.totalStock,
        medicine.threshold,
        Boolean(unresolved),
      ) &&
      unresolved
    ) {
      await resolveLowStockAlert(unresolved.id);
    }
  }
}

async function runExpiryCheck(shopId: string, now: Date): Promise<void> {
  const preferences = readNotificationPreferences(shopId);
  if (!preferences.all || !preferences.expiry) return;
  const medicines = await listMedicines(shopId);
  for (const medicine of medicines) {
    const batches = sortByExpiry(
      await listBatchesForMedicine(shopId, medicine.medicineId),
    );
    for (const batch of batches) {
      const days = daysUntilExpiry(batch.expiryDate, now);
      if (
        !isBatchInExpiryWindow(days) ||
        days === null ||
        (await hasExpiryAlert(shopId, batch.id))
      ) {
        continue;
      }
      const severity = expirySeverity(days);
      const title = encodeLocalizedText(
        `Expiring soon: ${medicine.name}`,
        `শিগগির মেয়াদ শেষ: ${medicine.name}`,
      );
      const body = encodeLocalizedText(
        `Batch ${batch.batchNo} expires in ${formatNumber(days)} days (${batch.expiryDate})`,
        `ব্যাচ ${batch.batchNo}-এর মেয়াদ ${new Intl.NumberFormat("bn-BD").format(days)} দিনের মধ্যে শেষ (${batch.expiryDate})`,
      );
      await createNotification(
        shopId,
        "expiry",
        severity,
        title,
        body,
        batch.id,
      );
      await presentLocalNotification(title, body, severity);
    }
  }
}

async function runDailySummaryCheck(shopId: string, now: Date): Promise<void> {
  const preferences = readNotificationPreferences(shopId);
  if (!preferences.all || !preferences.dailyCash) return;
  const session = readPersistedSessionSync();
  // Cash-summary notifications remain Owner-only even though an operational
  // Manager may use the cash drawer.
  if (
    !session ||
    session.shopId !== shopId ||
    session.role !== "owner" ||
    now.getHours() < 20
  ) {
    return;
  }
  if ((await getActiveSessionRole(session.userId, shopId)) !== "owner") {
    return;
  }
  const businessDate = localBusinessDate(now);
  if (await hasDailySummaryToday(shopId, businessDate)) {
    return;
  }
  // The owner check above already ran against SQLite; getCashSummary re-checks
  // it as the single gate on this read.
  const cash = expectedCash(
    await getCashSummary(shopId, session.userId, businessDate),
  );
  const title = encodeLocalizedText(
    `Cash summary — ${businessDate}`,
    `ক্যাশ সারাংশ — ${businessDate}`,
  );
  const body = encodeLocalizedText(
    `Expected cash in drawer: ${formatMoney(cash)}`,
    `ড্রয়ারে প্রত্যাশিত ক্যাশ: ${formatMoney(cash)}`,
  );
  await createDailySummaryNotification(
    shopId,
    session.userId,
    title,
    body,
    businessDate,
  );
  await presentLocalNotification(title, body, "info");
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
      console.warn("Low-stock notification check failed", error);
    }
    try {
      await runExpiryCheck(shopId, now);
    } catch (error) {
      console.warn("Expiry notification check failed", error);
    }
    try {
      await runDailySummaryCheck(shopId, now);
    } catch (error) {
      console.warn("Daily-summary notification check failed", error);
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
  if (
    !(await TaskManager.isTaskRegisteredAsync(NOTIFICATION_BACKGROUND_TASK))
  ) {
    await BackgroundTask.registerTaskAsync(NOTIFICATION_BACKGROUND_TASK, {
      minimumInterval: BACKGROUND_MINIMUM_INTERVAL_MINUTES,
    });
  }
}

export async function requestNotificationPermissionsAsync(): Promise<boolean> {
  await ensureAndroidNotificationChannelAsync();
  const current = await Notifications.getPermissionsAsync();
  const result = current.granted
    ? current
    : await Notifications.requestPermissionsAsync();
  if (result.granted) {
    await registerNotificationBackgroundTaskAsync();
  }
  return result.granted;
}
