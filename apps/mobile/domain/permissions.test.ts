import { describe, expect, it } from 'vitest';
import {
  ACCESS_DENIED_MESSAGE,
  CASHIER_DEFAULT_PERMISSIONS, MANAGER_DEFAULT_PERMISSIONS, PERMISSION_KEYS, PERMISSION_PRESETS,
  fromStoragePermissionKey, hasPermission, hasPermissionForRoleName, permissionStorageKey,
  resolvePermission, toRole, type Permission,
} from './permissions';

describe('Phase B1 permission contract', () => {
  it('contains the exact twelve prototype keys', () => {
    expect(PERMISSION_KEYS).toEqual(['sale_entry','sale_discount','sale_return','sale_history','inventory_view','inventory_edit','expiry_manage','credit_view','credit_manage','cash_drawer','reports','staff_manage']);
  });
  it('uses exact Cashier, Manager and Custom presets', () => {
    expect(PERMISSION_KEYS.filter((key) => PERMISSION_PRESETS.cashier[key])).toEqual(CASHIER_DEFAULT_PERMISSIONS);
    expect(PERMISSION_KEYS.filter((key) => PERMISSION_PRESETS.manager[key])).toEqual(MANAGER_DEFAULT_PERMISSIONS);
    expect(MANAGER_DEFAULT_PERMISSIONS).toEqual(PERMISSION_KEYS.filter((key) => key !== 'staff_manage'));
    expect(PERMISSION_KEYS.some((key) => PERMISSION_PRESETS.custom[key])).toBe(false);
  });
  it('keeps mapped production storage keys stable', () => {
    const pairs: [Permission, string][] = [['sale_entry','sales'],['inventory_edit','inventory_write'],['credit_manage','credit_management'],['cash_drawer','cash_management'],['staff_manage','staff_management']];
    for (const [product, storage] of pairs) { expect(permissionStorageKey(product)).toBe(storage); expect(fromStoragePermissionKey(storage)).toBe(product); }
  });
  it('gives Owner everything, Manager all operational defaults except staff management, and Cashier two defaults', () => {
    for (const key of PERMISSION_KEYS) expect(hasPermission('owner', key)).toBe(true);
    for (const key of PERMISSION_KEYS) expect(hasPermission('manager', key)).toBe(key !== 'staff_manage');
    for (const key of PERMISSION_KEYS) expect(hasPermission('staff', key)).toBe(key === 'sale_entry' || key === 'inventory_view');
  });
  it('applies individual overrides and never lets settings_manage escape Owner-only', () => {
    expect(resolvePermission('manager', 'staff_manage', { staff_manage: true })).toBe(true);
    expect(resolvePermission('manager', 'reports', { reports: false })).toBe(false);
    expect(resolvePermission('staff', 'sale_entry', { sale_entry: false })).toBe(false);
    expect(resolvePermission('manager', 'settings_manage', {})).toBe(false);
  });
  it('accepts Manager and denies unknown roles', () => {
    expect(toRole('manager')).toBe('manager'); expect(toRole('owner')).toBe('owner'); expect(toRole('staff')).toBe('staff');
    expect(toRole('superuser')).toBeNull(); expect(hasPermissionForRoleName('superuser', 'sale_entry')).toBe(false);
  });
  it('fails closed for null, missing, and empty role names', () => {
    for (const roleName of [null, undefined, '']) {
      expect(toRole(roleName)).toBeNull();
      expect(hasPermissionForRoleName(roleName, 'sale_entry')).toBe(false);
    }
  });
  it('keeps the shared access-denied message stable', () => {
    expect(ACCESS_DENIED_MESSAGE).toBe('Owner access only.');
  });
});
