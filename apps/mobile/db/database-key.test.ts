// H-3, layer A: the key provider's contract.
//
// The Keystore itself is Android-only, so what is provable here is everything
// around it — that a key is minted exactly once, survives a "restart",
// produces the right PRAGMA, and that the two failure shapes stay
// distinguishable. That distinction matters more than it looks: one means
// "retry later" and the other means "this shop's data is locked and must be
// restored from the server", and answering the second with a fresh empty
// database is the single worst thing H-3 could do.

import { beforeEach, describe, expect, test } from 'vitest';

import {
  __breakKeystore,
  __dbKeyMintCount,
  __forceStoredKey,
  __hasArchivedDbKey,
  __isDbKeyRecoveryPending,
  __resetDbKeyStore,
  __wipeKeyStore,
} from './test/muthoy-db-key';
import {
  __resetDatabaseKeyCacheForTests,
  buildKeyPragma,
  beginDatabaseKeyRecovery,
  completeDatabaseKeyRecovery,
  getDatabaseKeyHex,
  hasDatabaseKey,
  hasPendingDatabaseKeyRecovery,
  isUsableDatabaseKeyHex,
} from './databaseKey';
import { DatabaseKeyUnavailableError, DatabaseKeyUnrecoverableError } from './errors';

beforeEach(() => {
  __resetDbKeyStore();
  __resetDatabaseKeyCacheForTests();
});

describe('key generation', () => {
  test('mints exactly one key however many times it is asked', async () => {
    const first = await getDatabaseKeyHex();
    const second = await getDatabaseKeyHex();
    const third = await getDatabaseKeyHex();

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(__dbKeyMintCount()).toBe(1);
  });

  test('concurrent callers all receive the same key', async () => {
    const keys = await Promise.all([
      getDatabaseKeyHex(),
      getDatabaseKeyHex(),
      getDatabaseKeyHex(),
      getDatabaseKeyHex(),
    ]);

    expect(new Set(keys).size).toBe(1);
    expect(__dbKeyMintCount()).toBe(1);
  });

  test('returns a 32-byte key, not a placeholder', async () => {
    const keyHex = await getDatabaseKeyHex();

    expect(keyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(keyHex).not.toMatch(/^0+$/);
  });

  test('two devices do not share a key', async () => {
    const deviceA = await getDatabaseKeyHex();

    // A different install: new key store, nothing carried over.
    __resetDbKeyStore();
    __resetDatabaseKeyCacheForTests();
    const deviceB = await getDatabaseKeyHex();

    expect(deviceB).not.toBe(deviceA);
  });
});

describe('persistence across a restart', () => {
  test('the same key comes back after the process forgets its cache', async () => {
    const beforeRestart = await getDatabaseKeyHex();

    // Process restart: module memory is gone, the key store is not.
    __resetDatabaseKeyCacheForTests();

    expect(await getDatabaseKeyHex()).toBe(beforeRestart);
    expect(__dbKeyMintCount()).toBe(1);
  });

  test('hasDatabaseKey is false before first use and true after', async () => {
    expect(await hasDatabaseKey()).toBe(false);

    await getDatabaseKeyHex();
    __resetDatabaseKeyCacheForTests();

    expect(await hasDatabaseKey()).toBe(true);
  });

  test('a reinstall reports no key rather than inventing one', async () => {
    await getDatabaseKeyHex();
    __wipeKeyStore();
    __resetDatabaseKeyCacheForTests();

    expect(await hasDatabaseKey()).toBe(false);
  });
});

describe('authenticated recovery key lifecycle', () => {
  test('archives the old key, mints a different active key, and is idempotent', async () => {
    const oldKey = await getDatabaseKeyHex();

    const recoveryKey = await beginDatabaseKeyRecovery();
    const repeated = await beginDatabaseKeyRecovery();

    expect(recoveryKey).not.toBe(oldKey);
    expect(repeated).toBe(recoveryKey);
    expect(__hasArchivedDbKey()).toBe(true);
    expect(__isDbKeyRecoveryPending()).toBe(true);
    expect(await hasPendingDatabaseKeyRecovery()).toBe(true);
  });

  test('releases archived material only when recovery is completed', async () => {
    await getDatabaseKeyHex();
    await beginDatabaseKeyRecovery();

    await completeDatabaseKeyRecovery();

    expect(__hasArchivedDbKey()).toBe(false);
    expect(__isDbKeyRecoveryPending()).toBe(false);
  });
});

describe('failure modes stay distinguishable', () => {
  test('a destroyed Keystore key raises the unrecoverable error', async () => {
    await getDatabaseKeyHex();
    __resetDatabaseKeyCacheForTests();
    __breakKeystore();

    await expect(getDatabaseKeyHex()).rejects.toBeInstanceOf(DatabaseKeyUnrecoverableError);
  });

  test('the unrecoverable error tells the owner their data still exists', async () => {
    await getDatabaseKeyHex();
    __resetDatabaseKeyCacheForTests();
    __breakKeystore();

    await expect(getDatabaseKeyHex()).rejects.toThrow(/has not been deleted/i);
  });

  test('an unavailable key store is a different, retryable error', async () => {
    __breakKeystore();

    await expect(getDatabaseKeyHex()).rejects.toBeInstanceOf(DatabaseKeyUnavailableError);
  });

  test('a malformed stored key is refused instead of used', async () => {
    __forceStoredKey('not-hex');

    await expect(getDatabaseKeyHex()).rejects.toBeInstanceOf(DatabaseKeyUnavailableError);
  });

  test('an all-zero key is refused — a stub must never encrypt real data', async () => {
    __forceStoredKey('0'.repeat(64));

    await expect(getDatabaseKeyHex()).rejects.toBeInstanceOf(DatabaseKeyUnavailableError);
  });

  test('the rejection never echoes the key material', async () => {
    const leakyKey = 'dead'.repeat(17); // 68 chars: wrong length, still secret-shaped
    __forceStoredKey(leakyKey);

    await expect(getDatabaseKeyHex()).rejects.toSatisfy(
      (error: unknown) => error instanceof Error && !error.message.includes(leakyKey),
    );
  });
});

describe('isUsableDatabaseKeyHex', () => {
  test.each([
    ['a valid key', 'a'.repeat(64), true],
    ['all zeroes', '0'.repeat(64), false],
    ['too short', 'ab'.repeat(31), false],
    ['too long', 'ab'.repeat(33), false],
    ['uppercase hex', 'A'.repeat(64), false],
    ['non-hex characters', 'g'.repeat(64), false],
    ['empty', '', false],
  ])('%s', (_label, value, expected) => {
    expect(isUsableDatabaseKeyHex(value as string)).toBe(expected);
  });
});

describe('buildKeyPragma', () => {
  test('produces SQLCipher raw-key form so no KDF is involved', () => {
    const keyHex = 'ab'.repeat(32);

    expect(buildKeyPragma(keyHex)).toBe(`PRAGMA key = "x'${keyHex}'";`);
  });

  test('refuses to interpolate anything that is not 64 hex characters', () => {
    // Also the SQL-injection guard: this string is concatenated into SQL.
    expect(() => buildKeyPragma(`'; DROP TABLE sales; --`)).toThrow(DatabaseKeyUnavailableError);
  });
});
