// db/notifications.ts — the ONLY file that will touch Drizzle/SQLite for
// Notifications (DEVELOPMENT_RULES.md). P1 (post-beta fast-follow, Volume 0's
// scope lock). The Drizzle schema doesn't exist yet (Day 2) either way —
// signature-only stubs.

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface Notification {
  id: string;
  severity: NotificationSeverity;
  message: string;
  isRead: boolean;
  createdAt: string;
}

// TODO(P1): list notifications for a shop, newest first. Volume 3's
// notifications(shop_id, is_read) index exists for the unread-count badge —
// use it, don't scan the whole table client-side.
export async function listNotifications(_shopId: string): Promise<Notification[]> {
  throw new Error('TODO: implement notification list query (P1 — post-beta, Volume 4 NOTIFICATION)');
}

export async function markAsRead(_notificationId: string): Promise<void> {
  throw new Error('TODO: implement mark-as-read (P1 — post-beta, Volume 4 NOTIFICATION)');
}

export async function createNotification(_shopId: string, _severity: NotificationSeverity, _message: string): Promise<void> {
  throw new Error('TODO: implement notification creation (P1 — post-beta, Volume 4 NOTIFICATION)');
}
