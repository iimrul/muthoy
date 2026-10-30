// W4-06 — the role table and the ADMIN_ROLES reader.
//
// EDGE-SAFE ON PURPOSE. middleware.ts imports this file on every request, so
// nothing here may touch node:crypto, `server-only`, or any password material.
// ADMIN_ROLES carries usernames and roles and NOTHING else; the salts and
// hashes live in ADMIN_ACCOUNTS, which only lib/adminIdentity.ts reads, in the
// Node runtime, at the one place credentials are verified.
//
// ADMIN_ROLES is AUTHORITATIVE. The session cookie proves who the caller is;
// this file decides what that identity may do, re-read per request, so removing
// a username here denies the next request even though a signed cookie is still
// in the browser. The cookie's own `role` claim grants nothing — it exists only
// so a mismatch can be audited.

import { AdminConfigError } from './errors';
import { isAdminUsername } from '@muthoy/validation';

export const ADMIN_ROLE_NAMES = ['super_admin', 'billing', 'support', 'read_only'] as const;
export type AdminRole = (typeof ADMIN_ROLE_NAMES)[number];

// Batch 3 §4.1. The seven W4-06 names are UNCHANGED — renaming one would
// silently un-gate whatever still asked for the old string — and twelve are
// added for the eleven pages.
export const ADMIN_PERMISSIONS = [
  'shops.read',
  'accounts.read',
  'subscriptions.read',
  'subscriptions.write',
  'payments.read',
  'revenue.read',
  'analytics.read',
  'maps.read',
  'support.read',
  'support.write',
  'audit.read',
  'shop_audit.read',
  'audit.export',
  'admins.read',
  'admins.write',
  'reports.read',
  'reports.export',
  'settings.read',
  'settings.write',
  // E4-B, 2026-10-30. Publishing an immutable financial snapshot. super_admin
  // ONLY, and that is the strictest grant in this list for a reason: the action
  // is irreversible by design — the database forbids UPDATE and DELETE on a
  // published row — and it moves a pharmacy money figure from withheld to
  // disclosed permanently. `revenue.read` lets a role look at money.
  // `publications.write` lets a role decide that money is public. billing holds
  // the first and deliberately not the second.
  'publications.write',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

// Frozen, and frozen deliberately: a role table that can be mutated at runtime
// is a role table an imported module can widen.
//
// Batch 3 §4.2. The four grants that are not obvious, each deliberate:
//   - `support` holds NO subscriptions.write and NO revenue.read, so the
//     support surface cannot become a billing console;
//   - `read_only` holds NO maps.read, because a coordinate is the one field in
//     this product that locates a physical person;
//   - `audit.export` is super_admin only, because an export is the one way the
//     log leaves the panel;
//   - `shop_audit.read` goes to `support` and NOT to `billing`: Volume 5 scopes
//     the per-shop log to "support/debugging use only".
const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = Object.freeze({
  super_admin: Object.freeze([...ADMIN_PERMISSIONS]),
  billing: Object.freeze([
    'shops.read',
    'accounts.read',
    'subscriptions.read',
    'subscriptions.write',
    'payments.read',
    'revenue.read',
    'analytics.read',
    'maps.read',
    'audit.read',
    'reports.read',
    'reports.export',
    'settings.read',
  ] as const),
  support: Object.freeze([
    'shops.read',
    'accounts.read',
    'subscriptions.read',
    'payments.read',
    'analytics.read',
    'maps.read',
    'support.read',
    'support.write',
    'shop_audit.read',
    'reports.read',
    'settings.read',
  ] as const),
  read_only: Object.freeze([
    'shops.read',
    'accounts.read',
    'subscriptions.read',
    'payments.read',
    'analytics.read',
    'support.read',
    'audit.read',
    'reports.read',
    'settings.read',
  ] as const),
});

/**
 * Own-property lookup, the guard Batch 1 established (apps/mobile/i18n/display.ts).
 * Plain `table[name]` would resolve an inherited name such as `constructor` to a
 * truthy value and hand out a permission nobody granted.
 */
function ownValue<T>(table: Readonly<Record<string, T>>, name: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, name) ? table[name] : undefined;
}

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && (ADMIN_ROLE_NAMES as readonly string[]).includes(value);
}

export function permissionsForRole(role: string): readonly AdminPermission[] {
  return ownValue(ROLE_PERMISSIONS, role) ?? [];
}

export function hasPermission(role: string, permission: string): boolean {
  return (permissionsForRole(role) as readonly string[]).includes(permission);
}

export function isAdminPermission(value: unknown): value is AdminPermission {
  return typeof value === 'string' && (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Batch 3 §4.3 rule 2. The effective set of two disagreeing roles.
 *
 * lib/adminAuthz.ts already recorded why this is the only correct operation:
 * billing holds subscriptions.write and support does not, support holds
 * support.write and billing does not, so the four roles are NOT totally
 * ordered and any ranking preserves authority one of them never had.
 *
 * Order follows ADMIN_PERMISSIONS, not either input, so the result is stable
 * whichever way round it is called — a set, not a filtered list.
 */
export function intersectPermissions(
  left: readonly AdminPermission[],
  right: readonly AdminPermission[],
): readonly AdminPermission[] {
  const inLeft = new Set<string>(left);
  const inRight = new Set<string>(right);
  return ADMIN_PERMISSIONS.filter(
    (permission) => inLeft.has(permission) && inRight.has(permission),
  );
}

/**
 * The §4.2 matrix, read from ROLE_PERMISSIONS itself.
 *
 * Page 8 renders this rather than a hand-kept copy, so the documented matrix
 * cannot drift from the enforced one. Returns fresh arrays: a caller that
 * sorts or splices its result must not be able to reach the frozen table.
 */
export function permissionMatrix(): readonly {
  permission: AdminPermission;
  roles: readonly { role: AdminRole; granted: boolean }[];
}[] {
  return ADMIN_PERMISSIONS.map((permission) => ({
    permission,
    roles: ADMIN_ROLE_NAMES.map((role) => ({
      role,
      granted: hasPermission(role, permission),
    })),
  }));
}

/**
 * Parses ADMIN_ROLES: a JSON object of username -> role, nothing else.
 *
 * Fails closed on every malformed shape rather than yielding a partial map: a
 * half-parsed role table is indistinguishable from a demotion that silently did
 * not apply.
 */
export function parseAdminRoles(raw: string | undefined): Map<string, AdminRole> {
  const text = raw?.trim();
  if (!text) {
    throw new AdminConfigError('ADMIN_ROLES is not set');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AdminConfigError('ADMIN_ROLES is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AdminConfigError('ADMIN_ROLES must be a JSON object of username -> role');
  }

  const roles = new Map<string, AdminRole>();
  const seenLowercase = new Set<string>();
  for (const [username, role] of Object.entries(parsed as Record<string, unknown>)) {
    if (username === '__proto__' || username === 'constructor' || username === 'prototype') {
      throw new AdminConfigError('ADMIN_ROLES contains a reserved username');
    }
    if (!isAdminUsername(username)) {
      // NAMES THE OFFENDER, because this refusal is new and it fails the whole
      // panel closed at boot. A username with an interior space used to log in
      // perfectly well and merely could not be revoked; now it stops the panel
      // starting, which is the right direction -- configuration must not accept
      // an account management cannot revoke -- but a founder who cannot read
      // code would otherwise face a dead panel and a sentence that does not say
      // which value to change. `getErrorMessage` replaces this with a fixed
      // sentence for the browser, so the detail stays in the server log.
      throw new AdminConfigError(
        'ADMIN_ROLES has a username that cannot be managed: '
        + JSON.stringify(username)
        + '. An admin username needs 1-64 characters and no whitespace.',
      );
    }
    if (!isAdminRole(role)) {
      throw new AdminConfigError(`ADMIN_ROLES has an unknown role for ${username}`);
    }
    // Two accounts differing only in case would make "which role applies"
    // depend on JSON key order.
    const lowercase = username.toLowerCase();
    if (seenLowercase.has(lowercase)) {
      throw new AdminConfigError('ADMIN_ROLES has duplicate usernames');
    }
    seenLowercase.add(lowercase);
    roles.set(username, role);
  }

  if (roles.size === 0) {
    throw new AdminConfigError('ADMIN_ROLES is empty');
  }
  return roles;
}

/** The role ADMIN_ROLES currently grants this username, or null if it grants none. */
export function resolveRole(roles: ReadonlyMap<string, AdminRole>, username: string): AdminRole | null {
  return roles.get(username) ?? null;
}
