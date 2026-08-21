import { and, eq, isNull } from 'drizzle-orm';
import { generateId } from '../native/id';
import { resolvePermission, type Permission } from '../domain/permissions';
import { getActiveSessionContext, requireOwner } from './auth';
import { assertSessionLive } from './errors';
import { db, sqliteConnection } from './client';
import { notificationReceipts, notifications } from './schema';

export type NotificationType = (typeof notifications.$inferInsert)['type'];
export type NotificationSeverity = NonNullable<(typeof notifications.$inferInsert)['severity']>;

export interface Notification {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  isRead: boolean;
  refId: string | null;
  createdAt: string;
}

interface RawNotification extends Omit<Notification, 'isRead'> {
  isRead: number;
}

const REQUIRED_PERMISSION: Partial<Record<NotificationType, Permission>> = {
  daily_summary: 'cash_drawer',
  low_stock: 'inventory_view',
  expiry: 'expiry_manage',
  overdue_credit: 'credit_view',
  refund: 'sale_return',
};

async function mayReadType(shopId: string, actorUserId: string, type: NotificationType): Promise<boolean> {
  const context = await getActiveSessionContext(actorUserId, shopId);
  if (!context) return false;
  if (type === 'daily_summary') return context.role === 'owner';
  const permission = REQUIRED_PERMISSION[type];
  return !permission || resolvePermission(context.role, permission, context.permissions);
}

export async function listNotifications(shopId: string, actorUserId: string): Promise<Notification[]> {
  const context = await getActiveSessionContext(actorUserId, shopId);
  if (!context) return [];
  const rows = sqliteConnection.getAllSync<RawNotification>(
    `SELECT n.id, n.type, n.severity, n.title, n.body, n.ref_id AS refId,
            n.created_at AS createdAt,
            CASE WHEN r.read_at IS NULL THEN 0 ELSE 1 END AS isRead
       FROM notifications n
       LEFT JOIN notification_receipts r
         ON r.notification_id = n.id AND r.user_id = $userId AND r.is_deleted = 0
      WHERE n.shop_id = $shopId AND n.is_deleted = 0 AND r.dismissed_at IS NULL
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT 200`,
    { $shopId: shopId, $userId: actorUserId },
  );
  return rows
    .filter((row) => {
      if (row.type === 'daily_summary') return context.role === 'owner';
      const permission = REQUIRED_PERMISSION[row.type];
      return !permission || resolvePermission(context.role, permission, context.permissions);
    })
    .map((row) => ({ ...row, isRead: Boolean(row.isRead) }));
}

export async function getUnreadCount(shopId: string, actorUserId: string): Promise<number> {
  return (await listNotifications(shopId, actorUserId)).filter((item) => !item.isRead).length;
}

function upsertReceipt(
  shopId: string,
  actorUserId: string,
  notificationId: string,
  values: { readAt?: string; dismissedAt?: string },
): void {
  const now = new Date().toISOString();
  db.insert(notificationReceipts)
    .values({
      id: generateId(),
      shopId,
      notificationId,
      userId: actorUserId,
      readAt: values.readAt ?? null,
      dismissedAt: values.dismissedAt ?? null,
      isDirty: false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [notificationReceipts.notificationId, notificationReceipts.userId],
      set: { ...values, updatedAt: now },
    })
    .run();
}

export async function markAsRead(
  shopId: string,
  actorUserId: string,
  notificationId: string,
  isStillActive: () => boolean,
): Promise<void> {
  const [item] = await db.select({ type: notifications.type }).from(notifications).where(and(
    eq(notifications.id, notificationId),
    eq(notifications.shopId, shopId),
    eq(notifications.isDeleted, false),
  ));
  if (!item || !(await mayReadType(shopId, actorUserId, item.type))) return;
  assertSessionLive(isStillActive);
  upsertReceipt(shopId, actorUserId, notificationId, { readAt: new Date().toISOString() });
}

export async function markAllAsRead(
  shopId: string,
  actorUserId: string,
  isStillActive: () => boolean,
): Promise<void> {
  const visible = await listNotifications(shopId, actorUserId);
  assertSessionLive(isStillActive);
  const now = new Date().toISOString();
  for (const item of visible) upsertReceipt(shopId, actorUserId, item.id, { readAt: now });
}

export async function dismissNotification(
  shopId: string,
  actorUserId: string,
  notificationId: string,
  isStillActive: () => boolean,
): Promise<void> {
  const visible = (await listNotifications(shopId, actorUserId)).some((item) => item.id === notificationId);
  if (!visible) return;
  assertSessionLive(isStillActive);
  const now = new Date().toISOString();
  upsertReceipt(shopId, actorUserId, notificationId, { readAt: now, dismissedAt: now });
}

export async function createNotification(
  shopId: string,
  type: NotificationType,
  severity: NotificationSeverity,
  title: string,
  body: string,
  refId?: string,
): Promise<void> {
  const today = localBusinessDate(new Date());
  if (refId) {
    const existing = sqliteConnection.getFirstSync<{ id: string }>(
      `SELECT id FROM notifications
        WHERE shop_id = $shopId AND type = $type AND ref_id = $refId
          AND is_deleted = 0 AND resolved_at IS NULL
          AND date(created_at, 'localtime') = $today
        ORDER BY created_at DESC LIMIT 1`,
      { $shopId: shopId, $type: type, $refId: refId, $today: today },
    );
    if (existing) {
      await db.update(notifications).set({ title, body, severity, updatedAt: new Date().toISOString() }).where(eq(notifications.id, existing.id));
      return;
    }
  }
  await db.insert(notifications).values({
    id: generateId(), shopId, type, severity, title, body,
    refId: refId ?? null, isDirty: false,
  });
}

export async function createDailySummaryNotification(shopId: string, actorUserId: string, title: string, body: string, businessDate: string): Promise<void> {
  await requireOwner(shopId, actorUserId);
  await createNotification(shopId, 'daily_summary', 'info', title, body, businessDate);
}

export async function findUnresolvedLowStockAlert(shopId: string, medicineId: string): Promise<{ id: string } | null> {
  const [row] = await db.select({ id: notifications.id }).from(notifications).where(and(
    eq(notifications.shopId, shopId), eq(notifications.type, 'low_stock'),
    eq(notifications.refId, medicineId), isNull(notifications.resolvedAt),
    eq(notifications.isDeleted, false),
  )).limit(1);
  return row ?? null;
}

export async function findUnresolvedSyncAlert(shopId: string): Promise<{ id: string } | null> {
  const [row] = await db.select({ id: notifications.id }).from(notifications).where(and(
    eq(notifications.shopId, shopId), eq(notifications.type, 'sync'),
    isNull(notifications.resolvedAt), eq(notifications.isDeleted, false),
  )).limit(1);
  return row ?? null;
}

export async function resolveLowStockAlert(notificationId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.update(notifications).set({ resolvedAt: now, updatedAt: now }).where(and(
    eq(notifications.id, notificationId), eq(notifications.type, 'low_stock'), isNull(notifications.resolvedAt),
  ));
}

export async function hasExpiryAlert(shopId: string, batchId: string): Promise<boolean> {
  const [row] = await db.select({ id: notifications.id }).from(notifications).where(and(
    eq(notifications.shopId, shopId), eq(notifications.type, 'expiry'),
    eq(notifications.refId, batchId), eq(notifications.isDeleted, false),
  )).limit(1);
  return Boolean(row);
}

export async function hasDailySummaryToday(shopId: string, businessDate: string): Promise<boolean> {
  const [row] = await db.select({ id: notifications.id }).from(notifications).where(and(
    eq(notifications.shopId, shopId), eq(notifications.type, 'daily_summary'),
    eq(notifications.refId, businessDate), eq(notifications.isDeleted, false),
  )).limit(1);
  return Boolean(row);
}

export function localBusinessDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
