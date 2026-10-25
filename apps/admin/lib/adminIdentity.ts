import 'server-only';

// W4-06 — ADMIN_ACCOUNTS: the salts and hashes, and the ONLY module that reads
// them.
//
// server-only, and NODE-only in practice: lib/adminLogin.ts is its single
// caller, and that runs in the Node runtime of app/api/admin/session/route.ts.
// The split from ADMIN_ROLES is the point — the Edge middleware resolves a role
// per request without any password material in its reach.
//
// Fails closed on absent, empty, malformed, duplicate-username, and
// cross-variable mismatch. A half-provisioned account is worse than none: it
// looks configured and denies at the worst moment. A plaintext password field
// anywhere in ADMIN_ACCOUNTS is a parse ERROR, never a convenience.
//
// NOTE, deliberately: this parser is hand-written rather than a Zod schema as
// plan rev 7 sketched, because apps/admin has no zod dependency and adding one
// mid-sprint means a lockfile change for a parser whose every rejection has to
// be enumerated in tests either way. The validation below is total: shape,
// key set, hex widths, duplicate and cross-variable checks, with a test per
// rejection.

import { AdminConfigError } from './errors';
import { parseAdminRoles, type AdminRole } from './adminRoles';

export interface AdminAccount {
  username: string;
  /** 16 bytes, lowercase hex. */
  salt: string;
  /** PBKDF2-SHA256 output, 32 bytes, lowercase hex. */
  hash: string;
}

export const SALT_HEX_LENGTH = 32;
export const HASH_HEX_LENGTH = 64;
/** Sorted, because the check below compares it with Object.keys().sort(). */
const ACCOUNT_KEYS = ['hash', 'salt', 'username'];
const HEX = /^[0-9a-f]+$/;

/** Reads ADMIN_ACCOUNTS and ADMIN_ROLES. See adminSession.ts for why this is a
 * Record rather than an all-optional interface. */
export type IdentityEnvironment = Readonly<Record<string, string | undefined>>;

export interface AdminIdentity {
  accounts: ReadonlyMap<string, AdminAccount>;
  roles: ReadonlyMap<string, AdminRole>;
}

function requireHex(value: unknown, length: number, field: string, username: string): string {
  if (typeof value !== 'string' || value.length !== length || !HEX.test(value)) {
    throw new AdminConfigError(
      'ADMIN_ACCOUNTS entry for ' + username + ' has an invalid ' + field,
    );
  }
  return value;
}

export function parseAdminAccounts(raw: string | undefined): Map<string, AdminAccount> {
  const text = raw?.trim();
  if (!text) {
    throw new AdminConfigError('ADMIN_ACCOUNTS is not set');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AdminConfigError('ADMIN_ACCOUNTS is not valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new AdminConfigError('ADMIN_ACCOUNTS must be a JSON array');
  }

  const accounts = new Map<string, AdminAccount>();
  const seenLowercase = new Set<string>();
  for (const element of parsed) {
    if (element === null || typeof element !== 'object' || Array.isArray(element)) {
      throw new AdminConfigError('ADMIN_ACCOUNTS has an entry that is not an object');
    }
    const candidate = element as Record<string, unknown>;

    // Exact key set. An extra key is how a plaintext "password" or a stray
    // "role" would arrive, and either one means the operator misunderstood
    // where that value belongs.
    const keys = Object.keys(candidate).sort();
    if (keys.length !== ACCOUNT_KEYS.length || !keys.every((key, index) => key === ACCOUNT_KEYS[index])) {
      throw new AdminConfigError(
        'ADMIN_ACCOUNTS entries must have exactly username, salt and hash',
      );
    }

    const username = candidate.username;
    if (typeof username !== 'string' || username.length === 0 || username.trim() !== username) {
      throw new AdminConfigError('ADMIN_ACCOUNTS has an invalid username');
    }
    const lowercase = username.toLowerCase();
    if (seenLowercase.has(lowercase)) {
      throw new AdminConfigError('ADMIN_ACCOUNTS has duplicate usernames');
    }
    seenLowercase.add(lowercase);

    accounts.set(username, {
      username,
      salt: requireHex(candidate.salt, SALT_HEX_LENGTH, 'salt', username),
      hash: requireHex(candidate.hash, HASH_HEX_LENGTH, 'hash', username),
    });
  }

  if (accounts.size === 0) {
    throw new AdminConfigError('ADMIN_ACCOUNTS is empty');
  }
  return accounts;
}

/**
 * Both variables, cross-validated: every account must have a role and every
 * role must have an account. A username in one and not the other is a
 * provisioning mistake that would otherwise surface as a login that succeeds
 * and then has no authority, or a role that grants nothing to anybody.
 */
export function loadAdminIdentity(env: IdentityEnvironment): AdminIdentity {
  const accounts = parseAdminAccounts(env.ADMIN_ACCOUNTS);
  const roles = parseAdminRoles(env.ADMIN_ROLES);

  for (const username of accounts.keys()) {
    if (!roles.has(username)) {
      throw new AdminConfigError('ADMIN_ACCOUNTS has ' + username + ' with no ADMIN_ROLES entry');
    }
  }
  for (const username of roles.keys()) {
    if (!accounts.has(username)) {
      throw new AdminConfigError('ADMIN_ROLES has ' + username + ' with no ADMIN_ACCOUNTS entry');
    }
  }
  return { accounts, roles };
}

/**
 * Batch 3 §8.11 — presence for the Settings diagnostics panel.
 *
 * Here for the same containment reason as lib/env.ts's and
 * lib/adminSession.ts's: serviceRoleExposure.test.ts asserts exactly one
 * module's source contains `ADMIN_ACCOUNTS`, and that module is this one. The
 * panel asks; it does not look.
 *
 * A name and a boolean — this function never touches a salt or a hash.
 */
export const ACCOUNTS_ENV_NAMES = ['ADMIN_ACCOUNTS', 'ADMIN_ROLES'] as const;

export function accountsEnvDiagnostics(
  env: Record<string, string | undefined>,
): readonly { name: string; isSet: boolean }[] {
  return ACCOUNTS_ENV_NAMES.map((name) => ({
    name,
    isSet: (env[name] ?? '').trim().length > 0,
  }));
}
