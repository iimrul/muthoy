import { Platform } from "react-native";
import * as BackgroundTask from "expo-background-task";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import {
  daysUntilExpiry,
  deviceDailyTriggerForDhakaClosing,
  dhakaBusinessDate,
  formatMoney,
  formatNumber,
  isBeforeDhakaClosing,
} from "@muthoy/utils";
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
  resolveLowStockAlert,
  type NotificationSeverity,
} from "../db/notifications";
import { getB2Settings } from "../db/settings";
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
// D-11: a stable identifier so re-scheduling (a settings save, a fresh login)
// replaces the previous OS trigger instead of stacking duplicates.
const CLOSING_TIME_NOTIFICATION_ID = "muthoy-closing-time";

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
  if (!session || session.shopId !== shopId || session.role !== "owner") {
    return;
  }
  // W-5: closing_hour is Asia/Dhaka shop time, never the device wall clock.
  const { closingHour } = await getB2Settings(shopId);
  if (isBeforeDhakaClosing(now, closingHour)) {
    return;
  }
  if ((await getActiveSessionRole(session.userId, shopId)) !== "owner") {
    return;
  }
  const businessDate = dhakaBusinessDate(now);
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
  // The OS schedule is the only daily-summary banner path. This check only
  // materializes the deduped in-app row, avoiding a second delivery.
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

/**
 * D-11: the closing-time reminder must fire even with the app fully closed,
 * which `runNotificationChecks`'s foreground/background-task check cannot
 * guarantee (it only runs while the app is opened or opportunistically
 * background-woken). This schedules a real OS daily trigger at the shop's
 * configured closing hour instead.
 *
 * Idempotent and safe to call often: the stable identifier replaces the
 * previous trigger. A failed replacement therefore leaves the working
 * reminder intact. Never requests OS permission
 * itself — that stays the explicit Settings toggle's job
 * (requestNotificationPermissionsAsync); this only acts on a permission
 * already granted, matching how the rest of this module treats local
 * delivery as best-effort, never a forced prompt.
 */
export async function syncClosingTimeScheduleAsync(shopId: string): Promise<void> {
  const preferences = readNotificationPreferences(shopId);
  if (!preferences.all || !preferences.dailyCash) {
    await cancelClosingTimeScheduleAsync();
    return;
  }
  const session = readPersistedSessionSync();
  if (!session || session.shopId !== shopId || session.role !== "owner") {
    await cancelClosingTimeScheduleAsync();
    return;
  }
  if ((await getActiveSessionRole(session.userId, shopId)) !== "owner") {
    await cancelClosingTimeScheduleAsync();
    return;
  }

  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    await cancelClosingTimeScheduleAsync();
    return;
  }

  const { closingHour } = await getB2Settings(shopId);
  try {
    await ensureAndroidNotificationChannelAsync();
    const locale = useLocaleStore.getState().locale;
    const title = encodeLocalizedText("Time to count the drawer", "ড্রয়ার গোনার সময়");
    const body = encodeLocalizedText(
      "Open Cash Summary to record today's count.",
      "আজকের গণনা রেকর্ড করতে ক্যাশ সারাংশ খুলুন।",
    );
    const triggerTime = deviceDailyTriggerForDhakaClosing(new Date(), closingHour);
    await Notifications.scheduleNotificationAsync({
      identifier: CLOSING_TIME_NOTIFICATION_ID,
      content: {
        title: localizeStoredText(title, locale),
        body: localizeStoredText(body, locale),
        data: { route: "/cash-summary" },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: triggerTime.hour,
        minute: triggerTime.minute,
        channelId: Platform.OS === "android" ? ANDROID_CHANNEL_ID : undefined,
      },
    });
  } catch (error) {
    console.warn("Closing-time schedule failed", error);
  }
}

async function cancelClosingTimeScheduleAsync(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(CLOSING_TIME_NOTIFICATION_ID);
  } catch (error) {
    console.warn("Closing-time schedule cancellation failed", error);
  }
}
