// Volume 0 Day 11's permission matrix, proven at the pure-domain level.
// The roadmap's Day 11 checklist ("A Staff-role login cannot access owner-only
// screens") is enforced in two places — route guards and db/ action guards —
// and BOTH resolve through hasPermission below, so this file pins the rule
// itself. The action-level half is proven against a real SQLite engine in
// db/permissions.sqlite.test.ts.

import { describe, expect, it } from 'vitest';
import {
  ACCESS_DENIED_MESSAGE,
  hasPermission,
  hasPermissionForRoleName,
  toRole,
  type Permission,
} from './permissions';

const ALL_PERMISSIONS: Permission[] = [
  'sales',
  'inventory_view',
  'inventory_write',
  'staff_management',
  'cash_management',
  'settings_manage',
  'credit_management',
];

// Every role name that can reach a guard at runtime without being one of the
// two Beta assigns: the P1 'manager' rows every shop already carries, plus
// anything a tampered/stale MMKV session could hold.
const NON_P0_ROLE_NAMES = ['manager', 'superuser', '', null, undefined];

describe('hasPermission — owner', () => {
  it('grants every permission (Volume 0 Day 11: "Owner = everything")', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission('owner', permission)).toBe(true);
    }
  });
});

describe('hasPermission — staff', () => {
  it('allows making a sale', () => {
    expect(hasPermission('staff', 'sales')).toBe(true);
  });

  it('allows viewing inventory', () => {
    expect(hasPermission('staff', 'inventory_view')).toBe(true);
  });

  it.each<Permission>([
    'inventory_write',
    'staff_management',
    'cash_management',
    'settings_manage',
    'credit_management',
  ])(
    'denies the owner-only permission %s',
    (permission) => {
      expect(hasPermission('staff', permission)).toBe(false);
    },
  );

  // The predicate every Settings route guard evaluates. Volume 0 Day 11 keeps
  // PIN handling with the owner (own PIN, or resetting a staff PIN), so a
  // Staff login direct-navigating to /settings/settings is denied.
  it('is denied Settings — including changing its own PIN there', () => {
    expect(hasPermissionForRoleName('staff', 'settings_manage')).toBe(false);
  });

  // The predicate app/credit/* evaluates. Standalone credit management
  // (viewing balances, collecting a payment) stays owner-only even though
  // Staff can still make a credit SALE at checkout — that's the 'sales' grant,
  // a different permission from this one.
  it('is denied standalone credit management', () => {
    expect(hasPermissionForRoleName('staff', 'credit_management')).toBe(false);
  });

  it('grants exactly sales + inventory_view and nothing else', () => {
    const granted = ALL_PERMISSIONS.filter((permission) => hasPermission('staff', permission));
    expect(granted).toEqual(['sales', 'inventory_view']);
  });
});

describe('toRole', () => {
  it('passes through the two roles Beta assigns', () => {
    expect(toRole('owner')).toBe('owner');
    expect(toRole('staff')).toBe('staff');
  });

  // Every shop already has a 'manager' role row (db/auth.ts creates all three
  // system roles at registration) but the Manager matrix is P1. It must deny,
  // never fall through to owner-level access.
  it('denies manager — the P1 role that already exists in every shop', () => {
    expect(toRole('manager')).toBeNull();
  });

  it('denies an unknown, null, or missing role name', () => {
    expect(toRole('superuser')).toBeNull();
    expect(toRole(null)).toBeNull();
    expect(toRole(undefined)).toBeNull();
    expect(toRole('')).toBeNull();
  });
});

// hasPermissionForRoleName is what the UI guards (state/usePermission.ts,
// the dashboard tile filter) call, so this is the UI half of "manager and
// unknown roles fail closed" — db/permissions.sqlite.test.ts is the DB half.
describe('hasPermissionForRoleName — untrusted role strings', () => {
  it('matches hasPermission for the two roles Beta assigns', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermissionForRoleName('owner', permission)).toBe(hasPermission('owner', permission));
      expect(hasPermissionForRoleName('staff', permission)).toBe(hasPermission('staff', permission));
    }
  });

  it.each(NON_P0_ROLE_NAMES)('denies EVERY permission for the role name %p', (roleName) => {
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermissionForRoleName(roleName, permission)).toBe(false);
    }
  });

  // The specific regression this closes: 'manager' is not 'owner', so a naive
  // check would fall through to the staff grant list and hand it sales +
  // inventory_view. It must be denied outright until the P1 matrix ships.
  it('never treats manager as staff', () => {
    expect(hasPermissionForRoleName('manager', 'sales')).toBe(false);
    expect(hasPermissionForRoleName('manager', 'inventory_view')).toBe(false);
  });
});

describe('ACCESS_DENIED_MESSAGE', () => {
  it('is friendly text, not a stack trace or an error code', () => {
    expect(ACCESS_DENIED_MESSAGE).toBe('Owner access only.');
  });
});
