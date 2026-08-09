// Shared types for the in-app notification center.
// Kept in its own file so any layer can import it without circular deps.

export type NotificationType =
  | "cash_summary"
  | "low_stock"
  | "expiry"
  | "overdue_credit"
  | "sync_completed"
  | "backup_reminder"
  | "refund";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string; // ISO timestamp
  isRead: boolean;
  actionRoute?: string;
  /** Optional grouping key — duplicate same-day notifications collapse on this. */
  dedupeKey?: string;
}
