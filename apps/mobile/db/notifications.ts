import { and, count, desc, eq, isNull, ne } from 'drizzle-orm';
import { generateId } from '../native/id';
import { getActiveSessionRole, requireOwner } from './auth';
import { db } from './client';
import { notifications } from './schema';

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

export async function listNotifications(shopId: string, actorUserId: string): Promise<Notification[]> {
  const isOwner = (await getActiveSessionRole(actorUserId, shopId)) === 'owner';
  return db
    .select({
      id: notifications.id,
      type: notifications.type,
      severity: notifications.severity,
      title: notifications.title,
      body: notifications.body,
      isRead: notifications.isRead,
      refId: notifications.refId,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(eq(notifications.shopId, shopId), eq(notifications.isDeleted, false), ...(isOwner ? [] : [ne(notifications.type, 'daily_summary')])))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));
}

export async function getUnreadCount(shopId: string, actorUserId: string): Promise<number> {
  const isOwner = (await getActiveSessionRole(actorUserId, shopId)) === 'owner';
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.shopId, shopId),
        eq(notifications.isRead, false),
        eq(notifications.isDeleted, false),
        ...(isOwner ? [] : [ne(notifications.type, 'daily_summary')]),
      ),
    );
  return row?.value ?? 0;
}

export async function markAsRead(shopId: string, actorUserId: string, notificationId: string): Promise<void> {
  const isOwner = await getActiveSessionRole(actorUserId, shopId) === 'owner';
  await db
    .update(notifications)
    .set({
      isRead: true,
      updatedAt: new Date().toISOString(),
    })
    .where(and(
      eq(notifications.id, notificationId),
      eq(notifications.shopId, shopId),
      ...(isOwner ? [] : [ne(notifications.type, 'daily_summary')]),
    ));
}

export async function createNotification(
  shopId: string,
  type: NotificationType,
  severity: NotificationSeverity,
  title: string,
  body: string,
  refId?: string,
): Promise<void> {
  await db.insert(notifications).values({
    id: generateId(),
    shopId,
    type,
    severity,
    title,
    body,
    refId: refId ?? null,
    isDirty: false,
  });
}

export async function createDailySummaryNotification(shopId: string, actorUserId: string, title: string, body: string, businessDate: string): Promise<void> {
  await requireOwner(shopId, actorUserId);
  await createNotification(shopId, 'daily_summary', 'info', title, body, businessDate);
}

export async function findUnresolvedLowStockAlert(shopId: string, medicineId: string): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.shopId, shopId),
        eq(notifications.type, 'low_stock'),
        eq(notifications.refId, medicineId),
        isNull(notifications.resolvedAt),
        eq(notifications.isDeleted, false),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function resolveLowStockAlert(notificationId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(notifications)
    .set({ resolvedAt: now, updatedAt: now })
    .where(and(eq(notifications.id, notificationId), eq(notifications.type, 'low_stock'), isNull(notifications.resolvedAt)));
}

export async function hasExpiryAlert(shopId: string, batchId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.shopId, shopId), eq(notifications.type, 'expiry'), eq(notifications.refId, batchId), eq(notifications.isDeleted, false)))
    .limit(1);
  return Boolean(row);
}

export async function hasDailySummaryToday(shopId: string, businessDate: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(eq(notifications.shopId, shopId), eq(notifications.type, 'daily_summary'), eq(notifications.refId, businessDate), eq(notifications.isDeleted, false)),
    )
    .limit(1);
  return Boolean(row);
}

export function localBusinessDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
