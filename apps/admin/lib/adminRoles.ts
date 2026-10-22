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

export const ADMIN_ROLE_NAMES = ['super_admin', 'billing', 'support', 'read_only'] as const;
export type AdminRole = (typeof ADMIN_ROLE_NAMES)[number];

export const ADMIN_PERMISSIONS = [
  'shops.read',
  'accounts.read',
  'subscriptions.read',
  'subscriptions.write',
  'payments.read',
  'support.write',
  'audit.read',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

// Frozen, and frozen deliberately: a role table that can be mutated at runtime
// is a role table an imported module can widen.
const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = Object.freeze({
  super_admin: Object.freeze([...ADMIN_PERMISSIONS]),
  billing: Object.freeze([
    'shops.read',
    'accounts.read',
    'subscriptions.read',
    'subscriptions.write',
    'payments.read',
    'audit.read',
  ] as const),
  support: Object.freeze([
    'shops.read',
    'accounts.read',
    'subscriptions.read',
    'payments.read',
    'support.write',
  ] as const),
  read_only: Object.freeze([
    'shops.read',
    'accounts.read',
    'subscriptions.read',
    'payments.read',
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
    if (username.trim() !== username || username.length === 0) {
      throw new AdminConfigError('ADMIN_ROLES has a username with leading or trailing space');
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
