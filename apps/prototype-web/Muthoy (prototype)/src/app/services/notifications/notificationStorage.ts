// Local-first storage for the in-app notification center.
// All notifications live in localStorage["notifications"] sorted newest-first.

import type { AppNotification } from "./types";

const KEY = "notifications";
const MAX_STORED = 200;

function readAll(): AppNotification[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as AppNotification[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAll(list: AppNotification[]) {
  // Cap retention so storage never grows unbounded.
  const trimmed = list.slice(0, MAX_STORED);
  localStorage.setItem(KEY, JSON.stringify(trimmed));
}

export function getNotifications(): AppNotification[] {
  return readAll().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getUnreadCount(): number {
  return readAll().filter((n) => !n.isRead).length;
}

export function addNotificationRaw(n: AppNotification): AppNotification {
  const list = readAll();

  // Dedupe within the same calendar day if a key is given.
  if (n.dedupeKey) {
    const today = new Date().toDateString();
    const existingIdx = list.findIndex(
      (x) =>
        x.dedupeKey === n.dedupeKey &&
        new Date(x.createdAt).toDateString() === today
    );
    if (existingIdx >= 0) {
      const prev = list[existingIdx];
      // Preserve id, createdAt, and read state so re-pushes from periodic
      // scans don't resurrect a notification the user already dismissed.
      list[existingIdx] = {
        ...prev,
        ...n,
        id: prev.id,
        createdAt: prev.createdAt,
        isRead: prev.isRead,
      };
      writeAll(list);
      return list[existingIdx];
    }
  }

  list.unshift(n);
  writeAll(list);
  return n;
}

export function markRead(id: string) {
  const list = readAll().map((n) => (n.id === id ? { ...n, isRead: true } : n));
  writeAll(list);
}

export function markAllRead() {
  const list = readAll().map((n) => ({ ...n, isRead: true }));
  writeAll(list);
}

export function deleteNotification(id: string) {
  const list = readAll().filter((n) => n.id !== id);
  writeAll(list);
}

export function clearAll() {
  writeAll([]);
}
