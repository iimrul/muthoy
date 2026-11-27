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
import { getActiveSessionContext, getActiveSessionRole } from "../db/auth";
import { ensureDatabaseInitialized } from "../db/init";
import { resolvePermission } from "../domain/permissions";
import { getCashSummary } from "../db/cash";
import { shopHasOverdueCredit } from "../db/customers";
import {
  listBatchesForMedicine,
  listMedicines,
  listOversoldBatches,
} from "../db/inventory";
import {
  createDailySummaryNotification,
  createNotification,
  findUnresolvedLowStockAlert,
  hasDailySummaryToday,
  hasExpiryAlert,
  listUnresolvedOversellAlerts,
  resolveLowStockAlert,
  resolveOversellAlert,
  type NotificationSeverity,
} from "../db/notifications";
import { getB2Settings } from "../db/settings";
import { readPersistedSessionSync } from "../state/sessionStore";
import { readNotificationPreferences } from "../state/notificationPreferencesStore";
import { useLocaleStore } from "../state/localeStore";
import { encodeLocalizedText, localizeStoredText } from "../i18n/localizedText";
import { inspectSessionAuthority } from "../sync/sessionAuthority";

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
  } catch {
    console.warn("notification-delivery-failed");
  }
}

async function runLowStockCheck(shopId: string): Promise<void> {
  const preferences = readNotificationPreferences(shopId);
  if (!preferences.all || !preferences.stock) return;
  const medicines = await listMedicines(shopId);
  for (const medicine of medicines) {
    // An oversold medicine already has its own, louder alert (runOversellCheck);
    // a second "low stock: −2 left" banner for the same event is noise.
    if (medicine.oversoldStock < 0) continue;
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

/**
 * F13 (founder, 2026-11-27): two phones selling offline can together sell
 * more of a batch than it held. Both sales are kept and the batch goes below
 * zero, so the shelf needs a recount. One critical alert per oversold batch,
 * re-armed once the batch is corrected back to zero or above. The owner and
 * every staff member who may view stock get it (founder, 2026-11-27); the
 * same `inventory_view` gate hides it in db/notifications.ts.
 */
async function runOversellCheck(shopId: string): Promise<void> {
  const preferences = readNotificationPreferences(shopId);
  if (!preferences.all || !preferences.stock) return;
  const session = readPersistedSessionSync();
  if (!session || session.shopId !== shopId) return;
  const context = await getActiveSessionContext(session.userId, shopId);
  if (!context || !resolvePermission(context.role, "inventory_view", context.permissions)) {
    return;
  }
  const oversold = listOversoldBatches(shopId);
  const open = await listUnresolvedOversellAlerts(shopId);
  const stillOversold = new Set(oversold.map((row) => row.batchId));
  for (const alert of open) {
    if (!alert.refId || !stillOversold.has(alert.refId)) {
      await resolveOversellAlert(alert.id);
    }
  }
  const alerted = new Set(open.map((alert) => alert.refId));
  const bn = new Intl.NumberFormat("bn-BD");
  for (const row of oversold) {
    if (alerted.has(row.batchId)) continue;
    const extra = -row.stock;
    const title = encodeLocalizedText(
      `Oversold: ${row.medicineName}`,
      `বেশি বিক্রি: ${row.medicineName}`,
    );
    const body = encodeLocalizedText(
      `Batch ${row.batchNo}: ${formatNumber(extra)} more sold than in stock (stock ${formatNumber(row.stock)}). Count the shelf; the stock needs correcting.`,
      `ব্যাচ ${row.batchNo}: স্টকের চেয়ে ${bn.format(extra)}টি বেশি বিক্রি হয়েছে (স্টক ${bn.format(row.stock)})। তাক গুনে স্টক ঠিক করতে হবে।`,
    );
    const { created } = await createNotification(
      shopId,
      "oversell",
      "critical",
      title,
      body,
      row.batchId,
    );
    if (created) await presentLocalNotification(title, body, "critical");
  }
}

// One oversell check at a time, each after the previous: a sync can land
// while a check is mid-way, and the later check must still see it.
let oversellQueue: Promise<void> = Promise.resolve();

function queueOversellCheck(shopId: string): Promise<void> {
  oversellQueue = oversellQueue.then(() =>
    runOversellCheck(shopId).catch(() => {
      console.warn("notification-check-failed:oversell");
    }),
  );
  return oversellQueue;
}

/**
 * Called after every completed sync, which is when another phone's late
 * offline sale lands. Only the oversell check: the low-stock and expiry
 * sweeps walk every medicine and stay on their foreground/background cadence.
 */
export function runOversellAlertCheck(shopId: string): Promise<void> {
  return queueOversellCheck(shopId);
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

// B3 Group 4 (CP-5): pushes ONE `overdue_credit` notification per Dhaka
// business date whenever any customer holds a credit older than the shop's
// `credit_max_days`. Dedup is `createNotification`'s own (type + refId +
// same day) mechanism, with `businessDate` as the refId — the same pattern
// `runDailySummaryCheck` already uses below. Gated on the `credit` toggle
// (preferences.all && preferences.credit), matching the prototype's
// settings.creditAlerts gate (CP-5) and this module's low-stock/expiry
// pattern above. Not owner-scoped at creation: db/notifications.ts's
// REQUIRED_PERMISSION map (`overdue_credit: 'credit_view'`) is what actually
// controls who can read it back.
async function runOverdueCreditCheck(shopId: string, now: Date): Promise<void> {
  const preferences = readNotificationPreferences(shopId);
  if (!preferences.all || !preferences.credit) return;
  const { creditMaxDays } = await getB2Settings(shopId);
  const businessDate = dhakaBusinessDate(now);
  if (!shopHasOverdueCredit(shopId, businessDate, creditMaxDays)) return;
  const title = encodeLocalizedText(
    "Overdue credit",
    "মেয়াদোত্তীর্ণ বাকি",
  );
  const body = encodeLocalizedText(
    "One or more customers have an overdue credit balance.",
    "এক বা একাধিক গ্রাহকের বাকি মেয়াদোত্তীর্ণ হয়েছে।",
  );
  const { created } = await createNotification(
    shopId,
    "overdue_credit",
    "warning",
    title,
    body,
    businessDate,
  );
  // Generation stays shop-wide (above), but the OS banner is per-session: it
  // must not surface to a user whose role/permissions can't see credit data,
  // and must not re-fire on every check once today's row already exists.
  if (!created) return;
  const session = readPersistedSessionSync();
  if (!session || session.shopId !== shopId) return;
  const context = await getActiveSessionContext(session.userId, shopId);
  if (!context) return;
  if (!resolvePermission(context.role, "credit_view", context.permissions)) return;
  await presentLocalNotification(title, body, "warning");
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
    // H-3: this runs headless too, and a background wake can beat the app's
    // own boot to the database. Since the local database is encrypted, the
    // key has to be fetched and any pending upgrade completed before a single
    // read below — the db/ handles throw until it is. Awaiting a completed
    // initialization is free, so foreground callers pay nothing.
    //
    // Swallowed like every other check in this function, and for the same
    // reason: notifications are best-effort and this promise is consumed with
    // a bare `void` at app/_layout.tsx. A locked database is a real problem,
    // but the boot gate is where it gets reported — not from a background
    // wake that would only turn it into an unhandled rejection.
    try {
      await ensureDatabaseInitialized();
    } catch {
      console.warn("notification-check-failed:database-init");
      return;
    }
    // RootLayout's React gate does not exist in an OS background task. Apply
    // the same authority decision here before any stock, cash, credit, or
    // notification row is read. No anchor, expiry, rollback, corruption, or
    // quarantine therefore becomes a headless data-access bypass.
    try {
      const authority = await inspectSessionAuthority(session);
      if (
        authority.status !== "confirmed"
        && !(authority.status === "unverified" && authority.reason === "offline_window_open")
      ) {
        return;
      }
    } catch {
      return;
    }
    const now = new Date();
    await queueOversellCheck(shopId);
    try {
      await runLowStockCheck(shopId);
    } catch {
      console.warn("notification-check-failed:low-stock");
    }
    try {
      await runExpiryCheck(shopId, now);
    } catch {
      console.warn("notification-check-failed:expiry");
    }
    try {
      await runDailySummaryCheck(shopId, now);
    } catch {
      console.warn("notification-check-failed:daily-summary");
    }
    try {
      await runOverdueCreditCheck(shopId, now);
    } catch {
      console.warn("notification-check-failed:overdue-credit");
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
  } catch {
    console.warn("notification-schedule-failed");
  }
}

async function cancelClosingTimeScheduleAsync(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(CLOSING_TIME_NOTIFICATION_ID);
  } catch {
    console.warn("notification-cancel-failed");
  }
}
