// High-level API for creating notifications + a tiny pub/sub so any
// component can subscribe and re-render when the inbox changes.

import { addNotificationRaw, getNotifications, getUnreadCount, markAllRead, markRead, deleteNotification } from "./notificationStorage";
import type { AppNotification, NotificationType } from "./types";

export const NOTIFICATIONS_UPDATED_EVENT = "notifications:updated";

function emit() {
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_UPDATED_EVENT));
}

export interface AddNotificationInput {
  type: NotificationType;
  title: string;
  message: string;
  actionRoute?: string;
  dedupeKey?: string;
}

export function pushNotification(input: AddNotificationInput): AppNotification {
  const n: AppNotification = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: input.type,
    title: input.title,
    message: input.message,
    actionRoute: input.actionRoute,
    dedupeKey: input.dedupeKey,
    createdAt: new Date().toISOString(),
    isRead: false,
  };
  const saved = addNotificationRaw(n);
  emit();
  return saved;
}

export function markNotificationRead(id: string) {
  markRead(id);
  emit();
}

export function markAllNotificationsRead() {
  markAllRead();
  emit();
}

export function removeNotification(id: string) {
  deleteNotification(id);
  emit();
}

// Re-export reads for convenience.
export { getNotifications, getUnreadCount };
