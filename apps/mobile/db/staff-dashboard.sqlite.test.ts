import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sqliteConnection } from './test/client';
import { recordSuccessfulLogin } from './auth';
import { getManagerDashboard } from './staffDashboard';

const MIGRATIONS = resolve('apps/mobile/db/migrations');
const SHOP_ID = '81000000-0000-4000-8000-000000000001';
const OTHER_SHOP_ID = '82000000-0000-4000-8000-000000000001';
const MANAGER_ID = '81000000-0000-4000-8000-000000000002';
const STAFF_ONE_ID = '81000000-0000-4000-8000-000000000003';
const STAFF_TWO_ID = '81000000-0000-4000-8000-000000000004';

function migrate(name: string): void {
  sqliteConnection.execSync(readFileSync(resolve(MIGRATIONS, name), 'utf8'));
}

beforeAll(() => {
  for (const name of [
    '0000_open_senator_kelly.sql',
    '0001_medicines_fts.sql',
    '0002_furry_celestials.sql',
    '0003_curious_wild_pack.sql',
    '0004_deep_boomer.sql',
    '0005_eminent_legion.sql',
    '0006_inventory_movement_ledger.sql',
    '0007_staff_device_login.sql',
    '0008_native_pin_lookup.sql',
    '0009_strong_gargoyle.sql',
  ]) migrate(name);
});

beforeEach(() => {
  sqliteConnection.execSync('PRAGMA foreign_keys = OFF');
  for (const table of [
    'user_permissions', 'audit_logs', 'sync_queue', 'cash_drawer', 'credits',
    'sales', 'batches', 'medicines', 'users', 'roles', 'shops',
  ]) sqliteConnection.execSync(`DELETE FROM ${table}`);
  sqliteConnection.execSync('PRAGMA foreign_keys = ON');

  sqliteConnection.execSync(`
    INSERT INTO shops (id, owner_id, name, phone) VALUES
      ('${SHOP_ID}', '${MANAGER_ID}', 'Main', '01700000001'),
      ('${OTHER_SHOP_ID}', '${MANAGER_ID}', 'Other', '01700000002');
    INSERT INTO roles (id, shop_id, name, is_system) VALUES
      ('role-manager', '${SHOP_ID}', 'manager', 1),
      ('role-staff', '${SHOP_ID}', 'staff', 1),
      ('role-other-staff', '${OTHER_SHOP_ID}', 'staff', 1);
    INSERT INTO users (id, shop_id, name, pin_hash, role_id) VALUES
      ('${MANAGER_ID}', '${SHOP_ID}', 'Manager', 'hash', 'role-manager'),
      ('${STAFF_ONE_ID}', '${SHOP_ID}', 'Staff One', 'hash', 'role-staff'),
      ('${STAFF_TWO_ID}', '${SHOP_ID}', 'Staff Two', 'hash', 'role-staff'),
      ('82000000-0000-4000-8000-000000000002', '${OTHER_SHOP_ID}', 'Other Staff', 'hash', 'role-other-staff');
    INSERT INTO user_permissions (id, shop_id, user_id, key, allowed) VALUES
      ('permission-1', '${SHOP_ID}', '${MANAGER_ID}', 'staff_management', 1),
      ('permission-2', '${SHOP_ID}', '${MANAGER_ID}', 'reports', 0);
  `);
});

describe('Manager Staff Active metric', () => {
  it('counts distinct staff login events today, not the active roster', async () => {
    const staffSession = {
      shopId: SHOP_ID,
      userId: STAFF_ONE_ID,
      role: 'staff' as const,
      permissions: {},
    };
    await recordSuccessfulLogin(staffSession);
    await recordSuccessfulLogin(staffSession);
    sqliteConnection.execSync(`
      INSERT INTO audit_logs (id, shop_id, actor_id, action, created_at, updated_at) VALUES
        ('login-old', '${SHOP_ID}', '${STAFF_TWO_ID}', 'user_login', datetime('now', 'localtime', '-1 day'), datetime('now', 'localtime')),
        ('login-self', '${SHOP_ID}', '${MANAGER_ID}', 'user_login', datetime('now', 'localtime'), datetime('now', 'localtime')),
        ('login-other-shop', '${OTHER_SHOP_ID}', '82000000-0000-4000-8000-000000000002', 'user_login', datetime('now', 'localtime'), datetime('now', 'localtime'));
    `);

    await expect(getManagerDashboard(SHOP_ID, MANAGER_ID)).resolves.toMatchObject({ activeStaff: 1 });
  });

  it('loads the prototype Manager dashboard with the Manager reports grant', async () => {
    sqliteConnection.execSync(
      `UPDATE user_permissions SET allowed = 1 WHERE shop_id = '${SHOP_ID}' AND user_id = '${MANAGER_ID}' AND key = 'reports'`,
    );

    await expect(getManagerDashboard(SHOP_ID, MANAGER_ID)).resolves.toMatchObject({
      actorName: 'Manager',
      totalSales: 0,
      transactionCount: 0,
      staffPerformance: expect.any(Array),
      recent: expect.any(Array),
    });
  });
});
