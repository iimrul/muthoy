// W4-06 — ADMIN_ACCOUNTS, executed, and it is a file of rejections.
//
// A credential variable that half-parses is worse than one that is absent: it
// looks configured and then denies, or worse, admits. So every malformed shape
// below throws, including the two that an operator would most plausibly write
// by hand — a plaintext password field, and an account provisioned in one
// variable but not the other.

import { describe, expect, test } from 'vitest';
import { AdminConfigError } from './errors';
import { loadAdminIdentity, parseAdminAccounts } from './adminIdentity';

const SALT = '00112233445566778899aabbccddeeff';
const HASH = 'a'.repeat(64);
const ACCOUNTS = JSON.stringify([{ username: 'founder', salt: SALT, hash: HASH }]);

describe('parseAdminAccounts', () => {
  test('parses a well-formed array', () => {
    const accounts = parseAdminAccounts(ACCOUNTS);
    expect(accounts.get('founder')).toEqual({ username: 'founder', salt: SALT, hash: HASH });
  });

  test('parses several accounts', () => {
    const accounts = parseAdminAccounts(JSON.stringify([
      { username: 'founder', salt: SALT, hash: HASH },
      { username: 'ops', salt: SALT, hash: 'b'.repeat(64) },
    ]));
    expect([...accounts.keys()]).toEqual(['founder', 'ops']);
  });

  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '  '],
    ['not JSON', '[{'],
    ['an object', '{"founder":{}}'],
    ['null', 'null'],
    ['an empty array', '[]'],
    ['a string element', '["founder"]'],
    ['a null element', '[null]'],
    ['a nested array element', '[[]]'],
  ])('refuses %s', (_label, raw) => {
    expect(() => parseAdminAccounts(raw)).toThrow(AdminConfigError);
  });

  test('refuses a PLAINTEXT password field — that is an error, not a convenience', () => {
    expect(() => parseAdminAccounts(JSON.stringify([
      { username: 'founder', salt: SALT, hash: HASH, password: 'correct horse battery staple' },
    ]))).toThrow(AdminConfigError);

    expect(() => parseAdminAccounts(JSON.stringify([
      { username: 'founder', password: 'correct horse battery staple' },
    ]))).toThrow(AdminConfigError);
  });

  test('refuses a role field — roles belong to ADMIN_ROLES, which the Edge reads', () => {
    expect(() => parseAdminAccounts(JSON.stringify([
      { username: 'founder', salt: SALT, hash: HASH, role: 'super_admin' },
    ]))).toThrow(AdminConfigError);
  });

  test.each([
    ['a missing salt', { username: 'founder', hash: HASH }],
    ['a missing hash', { username: 'founder', salt: SALT }],
    ['a short salt', { username: 'founder', salt: '00', hash: HASH }],
    ['a long salt', { username: 'founder', salt: SALT + '00', hash: HASH }],
    ['a short hash', { username: 'founder', salt: SALT, hash: 'a'.repeat(63) }],
    ['uppercase hex', { username: 'founder', salt: SALT.toUpperCase(), hash: HASH }],
    ['non-hex characters', { username: 'founder', salt: 'z'.repeat(32), hash: HASH }],
    ['a numeric hash', { username: 'founder', salt: SALT, hash: 12345 }],
    ['an empty username', { username: '', salt: SALT, hash: HASH }],
    ['a padded username', { username: ' founder', salt: SALT, hash: HASH }],
    ['an unmanageable username', { username: 'u'.repeat(65), salt: SALT, hash: HASH }],
    ['an internal-space username', { username: 'ops user', salt: SALT, hash: HASH }],
    ['a reserved username', { username: 'constructor', salt: SALT, hash: HASH }],
    ['a NUL username', { username: '\u0000', salt: SALT, hash: HASH }],
    ['an unpaired surrogate username', { username: '\uD800', salt: SALT, hash: HASH }],
    ['a numeric username', { username: 7, salt: SALT, hash: HASH }],
  ])('refuses %s', (_label, entry) => {
    expect(() => parseAdminAccounts(JSON.stringify([entry]))).toThrow(AdminConfigError);
  });

  test('refuses duplicate usernames, including a case-only difference', () => {
    expect(() => parseAdminAccounts(JSON.stringify([
      { username: 'founder', salt: SALT, hash: HASH },
      { username: 'founder', salt: SALT, hash: HASH },
    ]))).toThrow(AdminConfigError);

    expect(() => parseAdminAccounts(JSON.stringify([
      { username: 'founder', salt: SALT, hash: HASH },
      { username: 'Founder', salt: SALT, hash: HASH },
    ]))).toThrow(AdminConfigError);
  });

  test('the error message never contains the hash or the salt', () => {
    try {
      parseAdminAccounts(JSON.stringify([{ username: 'founder', salt: SALT, hash: 'nope' }]));
      throw new Error('expected a throw');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(SALT);
      expect(message).not.toContain('nope');
      expect(message).toContain('founder');
    }
  });
});

describe('the two variables are cross-validated', () => {
  test('a matched pair loads', () => {
    const identity = loadAdminIdentity({
      ADMIN_ACCOUNTS: ACCOUNTS,
      ADMIN_ROLES: '{"founder":"super_admin"}',
    });

    expect(identity.accounts.get('founder')?.hash).toBe(HASH);
    expect(identity.roles.get('founder')).toBe('super_admin');
  });

  test('an account with no role entry is a startup failure', () => {
    expect(() => loadAdminIdentity({
      ADMIN_ACCOUNTS: JSON.stringify([
        { username: 'founder', salt: SALT, hash: HASH },
        { username: 'ops', salt: SALT, hash: HASH },
      ]),
      ADMIN_ROLES: '{"founder":"super_admin"}',
    })).toThrow(AdminConfigError);
  });

  test('a role with no account entry is a startup failure', () => {
    expect(() => loadAdminIdentity({
      ADMIN_ACCOUNTS: ACCOUNTS,
      ADMIN_ROLES: '{"founder":"super_admin","ops":"support"}',
    })).toThrow(AdminConfigError);
  });

  test('a missing variable on either side fails closed', () => {
    expect(() => loadAdminIdentity({ ADMIN_ROLES: '{"founder":"support"}' })).toThrow(AdminConfigError);
    expect(() => loadAdminIdentity({ ADMIN_ACCOUNTS: ACCOUNTS })).toThrow(AdminConfigError);
    expect(() => loadAdminIdentity({})).toThrow(AdminConfigError);
  });
});
