import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface NotificationRow {
  id: string;
  shop_id: string;
  type: string;
  is_read: number;
  resolved_at: string | null;
}

let sqlite: DatabaseSync;

function applyMigration(fileName: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', fileName), 'utf8'));
}

function insertNotification(id: string, shopId: string, type: 'low_stock' | 'daily_summary' | 'sync', refId: string): void {
  sqlite
    .prepare(
      `INSERT INTO notifications
        (id, shop_id, type, severity, title, body, ref_id, is_dirty)
       VALUES (?, ?, ?, 'info', ?, ?, ?, 0)`,
    )
    .run(id, shopId, type, `${type} title`, `${type} body`, refId);
}

function listVisible(shopId: string, userId: string, isOwner: boolean): NotificationRow[] {
  return sqlite
    .prepare(
      `SELECT n.id, n.shop_id, n.type,
              CASE WHEN r.read_at IS NULL THEN 0 ELSE 1 END AS is_read,
              n.resolved_at
         FROM notifications n
         LEFT JOIN notification_receipts r
           ON r.notification_id = n.id AND r.user_id = ? AND r.is_deleted = 0
        WHERE n.shop_id = ? AND n.is_deleted = 0 AND r.dismissed_at IS NULL
          AND (? = 1 OR n.type <> 'daily_summary')
        ORDER BY n.created_at DESC, n.id DESC`,
    )
    .all(userId, shopId, isOwner ? 1 : 0) as unknown as NotificationRow[];
}

function unreadCount(shopId: string, userId: string, isOwner: boolean): number {
  return listVisible(shopId, userId, isOwner).filter((row) => row.is_read === 0).length;
}

function markVisibleAsRead(shopId: string, userId: string, notificationId: string, isOwner: boolean): number {
  const visible = listVisible(shopId, userId, isOwner).some((row) => row.id === notificationId);
  if (!visible) return 0;
  return Number(sqlite.prepare(
    `INSERT INTO notification_receipts
       (id, shop_id, notification_id, user_id, read_at, is_dirty)
     VALUES (?, ?, ?, ?, current_timestamp, 0)
     ON CONFLICT(notification_id, user_id) DO UPDATE SET read_at = current_timestamp`,
  ).run(`receipt-${userId}-${notificationId}`, shopId, notificationId, userId).changes);
}

describe('notification DB queries on real SQLite', () => {
  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON');
    applyMigration('0000_open_senator_kelly.sql');
    applyMigration('0001_medicines_fts.sql');
    applyMigration('0002_furry_celestials.sql');
    applyMigration('0003_curious_wild_pack.sql');
    applyMigration('0004_deep_boomer.sql');
    applyMigration('0005_eminent_legion.sql');
    applyMigration('0006_inventory_movement_ledger.sql');
    applyMigration('0007_staff_device_login.sql');
    applyMigration('0008_native_pin_lookup.sql');
    applyMigration('0009_strong_gargoyle.sql');
    sqlite.prepare('INSERT INTO shops (id, owner_id, name, phone) VALUES (?, ?, ?, ?)').run('shop-1', 'owner-1', 'Shop One', '01700000001');
    sqlite.prepare('INSERT INTO shops (id, owner_id, name, phone) VALUES (?, ?, ?, ?)').run('shop-2', 'owner-2', 'Shop Two', '01700000002');
    sqlite.prepare("INSERT INTO roles (id, shop_id, name, is_system) VALUES ('role-owner-1', 'shop-1', 'owner', 1)").run();
    sqlite.prepare("INSERT INTO roles (id, shop_id, name, is_system) VALUES ('role-staff-1', 'shop-1', 'staff', 1)").run();
    sqlite.prepare("INSERT INTO roles (id, shop_id, name, is_system) VALUES ('role-owner-2', 'shop-2', 'owner', 1)").run();
    sqlite.prepare("INSERT INTO users (id, shop_id, name, phone, pin_hash, role_id) VALUES ('owner-1', 'shop-1', 'Owner One', '01700000011', 'hash', 'role-owner-1')").run();
    sqlite.prepare("INSERT INTO users (id, shop_id, name, phone, pin_hash, role_id) VALUES ('staff-1', 'shop-1', 'Staff One', '01700000012', 'hash', 'role-staff-1')").run();
    sqlite.prepare("INSERT INTO users (id, shop_id, name, phone, pin_hash, role_id) VALUES ('owner-2', 'shop-2', 'Owner Two', '01700000021', 'hash', 'role-owner-2')").run();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('finds only unresolved low-stock alerts and re-arms after resolution', () => {
    insertNotification('low-1', 'shop-1', 'low_stock', 'medicine-1');
    const findUnresolved = sqlite.prepare(
      `SELECT id FROM notifications
        WHERE shop_id = ? AND type = 'low_stock' AND ref_id = ?
          AND resolved_at IS NULL AND is_deleted = 0 LIMIT 1`,
    );

    expect(findUnresolved.get('shop-1', 'medicine-1')).toMatchObject({ id: 'low-1' });
    expect(
      sqlite.prepare("UPDATE notifications SET resolved_at = current_timestamp WHERE id = ? AND type = 'low_stock' AND resolved_at IS NULL").run('low-1').changes,
    ).toBe(1);
    expect(findUnresolved.get('shop-1', 'medicine-1')).toBeUndefined();

    insertNotification('low-2', 'shop-1', 'low_stock', 'medicine-1');
    expect(findUnresolved.get('shop-1', 'medicine-1')).toMatchObject({ id: 'low-2' });
  });

  it('deduplicates unresolved sync alerts and has ordered queue migration', () => {
    insertNotification('sync-1', 'shop-1', 'sync', 'sync');
    const unresolved = sqlite.prepare(`SELECT id FROM notifications
      WHERE shop_id = ? AND type = 'sync' AND resolved_at IS NULL AND is_deleted = 0 LIMIT 1`);
    expect(unresolved.get('shop-1')).toMatchObject({ id: 'sync-1' });
    expect(unresolved.get('shop-2')).toBeUndefined();

    const columns = sqlite.prepare("PRAGMA table_info('sync_queue')").all() as { name: string; notnull: number }[];
    expect(columns).toContainEqual(expect.objectContaining({ name: 'seq', notnull: 1 }));
    const indexes = sqlite.prepare("PRAGMA index_info('sync_queue_shop_status_idx')").all() as { name: string }[];
    expect(indexes.map((row) => row.name)).toEqual(['shop_id', 'status', 'seq']);
  });
  it('excludes daily summaries from staff list, unread, and read paths', () => {
    insertNotification('low-1', 'shop-1', 'low_stock', 'medicine-1');
    insertNotification('daily-1', 'shop-1', 'daily_summary', '2026-08-12');

    expect(listVisible('shop-1', 'staff-1', false).map((row) => row.id)).toEqual(['low-1']);
    expect(unreadCount('shop-1', 'staff-1', false)).toBe(1);
    expect(markVisibleAsRead('shop-1', 'staff-1', 'daily-1', false)).toBe(0);
    expect(unreadCount('shop-1', 'staff-1', false)).toBe(1);

    expect(listVisible('shop-1', 'owner-1', true).map((row) => row.id).sort()).toEqual(['daily-1', 'low-1']);
    expect(unreadCount('shop-1', 'owner-1', true)).toBe(2);
    expect(markVisibleAsRead('shop-1', 'owner-1', 'daily-1', true)).toBe(1);
    expect(unreadCount('shop-1', 'owner-1', true)).toBe(1);
    expect(unreadCount('shop-1', 'staff-1', false)).toBe(1);
  });

  it('isolates list, unread, and read operations by shop', () => {
    insertNotification('shop-1-low', 'shop-1', 'low_stock', 'medicine-1');
    insertNotification('shop-2-low', 'shop-2', 'low_stock', 'medicine-2');

    expect(listVisible('shop-1', 'owner-1', true).map((row) => row.id)).toEqual(['shop-1-low']);
    expect(listVisible('shop-2', 'owner-2', true).map((row) => row.id)).toEqual(['shop-2-low']);
    expect(unreadCount('shop-1', 'owner-1', true)).toBe(1);
    expect(unreadCount('shop-2', 'owner-2', true)).toBe(1);
    expect(markVisibleAsRead('shop-1', 'owner-1', 'shop-2-low', true)).toBe(0);
    expect(unreadCount('shop-2', 'owner-2', true)).toBe(1);
  });
});
