// W4-06 — the role table and ADMIN_ROLES, executed.
//
// Two properties carry the authorization model: the table says exactly what
// each role may do, and a malformed ADMIN_ROLES denies everything rather than
// granting a half-parsed subset. The planted prototype test is the third: a
// lookup that resolved an inherited name would hand out a permission nobody
// granted.

import { describe, expect, test } from 'vitest';
import { AdminConfigError } from './errors';
import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLE_NAMES,
  hasPermission,
  isAdminRole,
  parseAdminRoles,
  permissionsForRole,
  resolveRole,
} from './adminRoles';

describe('the role table', () => {
  test('super_admin holds every permission', () => {
    expect([...permissionsForRole('super_admin')].sort()).toEqual([...ADMIN_PERMISSIONS].sort());
  });

  test.each([
    ['billing', 'subscriptions.write', true],
    ['billing', 'support.write', false],
    ['support', 'support.write', true],
    ['support', 'subscriptions.write', false],
    ['read_only', 'shops.read', true],
    ['read_only', 'subscriptions.write', false],
    ['read_only', 'support.write', false],
    ['read_only', 'audit.read', false],
    ['billing', 'audit.read', true],
    ['support', 'audit.read', false],
  ])('%s %s -> %s', (role, permission, expected) => {
    expect(hasPermission(role, permission)).toBe(expected);
  });

  test('billing and support are NOT ordered — neither contains the other', () => {
    // This is why a role mismatch cannot be resolved by "the lower-privilege of
    // the two wins": there is no lower. Either ranking preserves authority the
    // other role never had.
    const billing = new Set(permissionsForRole('billing'));
    const support = new Set(permissionsForRole('support'));
    expect([...support].every((permission) => billing.has(permission))).toBe(false);
    expect([...billing].every((permission) => support.has(permission))).toBe(false);
  });

  test('an unknown role holds nothing', () => {
    expect(permissionsForRole('owner')).toEqual([]);
    expect(hasPermission('owner', 'shops.read')).toBe(false);
  });

  test('a prototype name resolves to no permissions', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(permissionsForRole(name)).toEqual([]);
      expect(hasPermission(name, 'shops.read')).toBe(false);
    }
  });

  test('a prototype name is not a permission either', () => {
    expect(hasPermission('super_admin', 'constructor')).toBe(false);
    expect(hasPermission('super_admin', '__proto__')).toBe(false);
  });

  test('the table cannot be widened at runtime', () => {
    const permissions = permissionsForRole('read_only');
    expect(Object.isFrozen(permissions)).toBe(true);
    expect(() => {
      (permissions as string[]).push('subscriptions.write');
    }).toThrow();
    expect(hasPermission('read_only', 'subscriptions.write')).toBe(false);
  });

  test('isAdminRole accepts exactly the four names', () => {
    for (const role of ADMIN_ROLE_NAMES) expect(isAdminRole(role)).toBe(true);
    for (const value of ['owner', '', 'SUPER_ADMIN', null, undefined, 7, {}]) {
      expect(isAdminRole(value)).toBe(false);
    }
  });
});

describe('parseAdminRoles fails closed', () => {
  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['not JSON', '{founder:'],
    ['an array', '["founder"]'],
    ['null', 'null'],
    ['a string', '"founder"'],
    ['an empty object', '{}'],
    ['an unknown role', '{"founder":"owner"}'],
    ['a role of the wrong type', '{"founder":1}'],
    ['a nested role', '{"founder":{"role":"support"}}'],
    ['a padded username', '{" founder":"support"}'],
    ['an empty username', '{"":"support"}'],
    ['duplicate usernames differing only in case', '{"founder":"support","Founder":"billing"}'],
    ['a reserved username', '{"__proto__":"super_admin"}'],
  ])('refuses %s', (_label, raw) => {
    expect(() => parseAdminRoles(raw)).toThrow(AdminConfigError);
  });

  test('accepts a well-formed table', () => {
    const roles = parseAdminRoles('{"founder":"super_admin","ops":"support"}');
    expect([...roles.entries()]).toEqual([
      ['founder', 'super_admin'],
      ['ops', 'support'],
    ]);
  });

  test('resolveRole answers null for an account the table does not list', () => {
    const roles = parseAdminRoles('{"founder":"super_admin"}');
    expect(resolveRole(roles, 'founder')).toBe('super_admin');
    expect(resolveRole(roles, 'ops')).toBeNull();
    expect(resolveRole(roles, 'constructor')).toBeNull();
  });
});
