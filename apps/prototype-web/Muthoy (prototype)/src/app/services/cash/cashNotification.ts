// 8 PM local notification for daily cash summary.
// Works fully offline using the browser Notification API + a tab-resident timer.
// No server push; gracefully no-ops in unsupported environments.

import { getCashBreakdown, getDateKey } from "./cashCalculation";
import { pushCashSummaryNotification } from "../notifications/notificationScheduler";

const SETTINGS_KEY = "cashNotificationSettings";
const FIRED_KEY = "cashNotificationFired"; // { [YYYY-MM-DD]: true }
const DEFAULT_HOUR = 20; // 8 PM
const DEFAULT_MINUTE = 0;

export interface CashNotificationSettings {
  enabled: boolean;
  hour: number;
  minute: number;
}

export function getNotificationSettings(): CashNotificationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { hour: DEFAULT_HOUR, minute: DEFAULT_MINUTE, ...JSON.parse(raw) };
  } catch {}
  return { enabled: false, hour: DEFAULT_HOUR, minute: DEFAULT_MINUTE };
}

// Whether the OS-level browser notification should fire. The in-app inbox
// notification always fires regardless of this setting so users see the
// 8 PM cash reminder in the bell even without granting browser permission.
function osNotificationsEnabled(): boolean {
  return getNotificationSettings().enabled;
}

export function saveNotificationSettings(s: Partial<CashNotificationSettings>) {
  const merged = { ...getNotificationSettings(), ...s };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  // Re-arm timer with the new settings.
  scheduleDailyCashNotification();
}

export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return "denied";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  return Notification.requestPermission();
}

function formatBdtAmount(n: number): string {
  return "৳" + Math.round(n).toLocaleString("en-US");
}

function buildBody(): string {
  const { expected } = getCashBreakdown();
  return `এখন ড্রয়ারে আছে: ${formatBdtAmount(expected)}`;
}

function buildBodyEn(): string {
  const { expected } = getCashBreakdown();
  return `Cash in drawer now: ${formatBdtAmount(expected)}`;
}

function markFired() {
  const map = JSON.parse(localStorage.getItem(FIRED_KEY) || "{}");
  map[getDateKey()] = true;
  localStorage.setItem(FIRED_KEY, JSON.stringify(map));
}

function alreadyFiredToday(): boolean {
  const map = JSON.parse(localStorage.getItem(FIRED_KEY) || "{}");
  return Boolean(map[getDateKey()]);
}

function fireNotification() {
  // Always drop it in the in-app inbox so users see it even if the
  // OS-level notification is denied or the tab was backgrounded.
  pushCashSummaryNotification();

  if (!osNotificationsEnabled() || !isNotificationSupported() || Notification.permission !== "granted") {
    markFired();
    return;
  }
  try {
    const n = new Notification("আজকের নগদ সারসংক্ষেপ", {
      body: buildBody(),
      tag: "cash-summary-daily",
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      // Persistent tag so duplicate firings (e.g. multiple tabs) coalesce.
    });
    n.onclick = () => {
      window.focus();
      window.location.assign("/app/cash-summary");
      n.close();
    };
    markFired();
  } catch {
    // Some environments throw if not in a secure context — ignore quietly.
  }
}

let timerId: ReturnType<typeof setTimeout> | null = null;

function msUntilNext(hour: number, minute: number): number {
  const now = new Date();
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

export function scheduleDailyCashNotification() {
  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
  }
  const s = getNotificationSettings();

  // If we're past the trigger time today and haven't fired yet, fire now.
  const now = new Date();
  const triggerToday = new Date();
  triggerToday.setHours(s.hour, s.minute, 0, 0);
  if (now >= triggerToday && !alreadyFiredToday()) {
    fireNotification();
  }

  const delay = msUntilNext(s.hour, s.minute);
  timerId = setTimeout(() => {
    fireNotification();
    scheduleDailyCashNotification(); // re-arm for the next day
  }, delay);
}

export async function enableCashNotifications(): Promise<boolean> {
  const perm = await requestNotificationPermission();
  if (perm !== "granted") {
    saveNotificationSettings({ enabled: false });
    return false;
  }
  saveNotificationSettings({ enabled: true });
  return true;
}

export function disableCashNotifications() {
  // Only disables OS-level browser notifications. The in-app bell inbox
  // notification continues to fire daily so users don't miss the reminder.
  saveNotificationSettings({ enabled: false });
}
