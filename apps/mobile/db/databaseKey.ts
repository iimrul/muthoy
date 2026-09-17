// db/databaseKey.ts — H-3, the JS side of the SQLCipher key.
//
// The native module owns generation, wrapping and storage. This file owns the
// three things that must not live in Kotlin: validating what came back,
// turning it into the exact `PRAGMA key` literal, and translating native error
// codes into the typed errors db/errors.ts defines so callers can tell
// "retry later" from "this data is locked forever".
//
// The key is cached in module memory after the first successful read. It has
// to be in memory anyway — it is about to be interpolated into a PRAGMA — and
// re-entering the Keystore on every open would show up in the cold-start and
// PIN-login budgets (§16). It is never logged, never serialized, never put in
// a store, and never crosses into sync/ or telemetry.

import {
  beginDatabaseKeyRecoveryNative,
  completeDatabaseKeyRecoveryNative,
  getOrCreateDatabaseKeyHexNative,
  hasDatabaseKeyNative,
  hasPendingDatabaseKeyRecoveryNative,
} from '../modules/muthoy-db-key';
import { DatabaseKeyUnavailableError, DatabaseKeyUnrecoverableError } from './errors';

/** SQLCipher raw keys are 32 bytes, written as 64 hex characters. */
export const DATABASE_KEY_HEX_LENGTH = 64;

const HEX_KEY_PATTERN = /^[0-9a-f]{64}$/;
const NATIVE_UNRECOVERABLE_CODE = 'MU_DBKEY_UNRECOVERABLE';

let cachedKeyHex: string | null = null;

/**
 * Whether a hex string is a key we are willing to encrypt a real pharmacy's
 * data with.
 *
 * The all-zero rejection is not paranoia about SecureRandom: it guards against
 * a stub, a mis-wired test double, or a native module that returned a
 * zero-filled buffer on an error path it forgot to check. Encrypting with a
 * predictable key looks identical to encrypting properly from the outside, so
 * this is the only place it can be caught.
 */
export function isUsableDatabaseKeyHex(value: string): boolean {
  if (!HEX_KEY_PATTERN.test(value)) {
    return false;
  }
  return !/^0+$/.test(value);
}

/**
 * Builds the exact statement that must be the FIRST SQL executed on a
 * connection. SQLCipher's raw-key form (`x'...'`) skips the KDF entirely, so
 * the bytes are used verbatim and there is no salt or iteration count to keep
 * in sync between the migration and the steady-state open path.
 *
 * Throws rather than interpolating anything unvalidated: this string is
 * concatenated into SQL, so the hex check above is also the injection guard.
 */
export function buildKeyPragma(keyHex: string): string {
  if (!isUsableDatabaseKeyHex(keyHex)) {
    throw new DatabaseKeyUnavailableError('the key store returned an unusable key');
  }
  return `PRAGMA key = "x'${keyHex}'";`;
}

/**
 * Whether this device already holds a wrapped key.
 *
 * Pairs with the on-disk database state in db/encryptionPlan.ts: `false`
 * alongside an encrypted database is the unrecoverable case, and must never
 * be answered by minting a replacement.
 */
export async function hasDatabaseKey(): Promise<boolean> {
  if (cachedKeyHex !== null) {
    return true;
  }
  try {
    return await hasDatabaseKeyNative();
  } catch (error) {
    throw new DatabaseKeyUnavailableError('could not be queried', { cause: error });
  }
}

/**
 * The database key, minting one on first use.
 *
 * Safe to call concurrently: the native side is idempotent and the cache makes
 * every later call free. Callers still serialize through db/client.ts's single
 * initialization promise.
 */
export async function getDatabaseKeyHex(): Promise<string> {
  if (cachedKeyHex !== null) {
    return cachedKeyHex;
  }

  let keyHex: string;
  try {
    keyHex = await getOrCreateDatabaseKeyHexNative();
  } catch (error) {
    if (isUnrecoverableNativeError(error)) {
      throw new DatabaseKeyUnrecoverableError('keystore-unwrap-failed', { cause: error });
    }
    throw new DatabaseKeyUnavailableError('the device key could not be read', { cause: error });
  }

  if (!isUsableDatabaseKeyHex(keyHex)) {
    // Deliberately does not echo the value: even a bad key is key material.
    throw new DatabaseKeyUnavailableError('the device returned a malformed key');
  }

  cachedKeyHex = keyHex;
  return keyHex;
}

export async function hasPendingDatabaseKeyRecovery(): Promise<boolean> {
  try {
    return await hasPendingDatabaseKeyRecoveryNative();
  } catch (error) {
    throw new DatabaseKeyUnavailableError('recovery state could not be queried', { cause: error });
  }
}

/** Explicitly rotates the key only after server authentication succeeded. */
export async function beginDatabaseKeyRecovery(): Promise<string> {
  cachedKeyHex = null;
  let keyHex: string;
  try {
    keyHex = await beginDatabaseKeyRecoveryNative();
  } catch (error) {
    throw new DatabaseKeyUnavailableError('a recovery key could not be created', { cause: error });
  }
  if (!isUsableDatabaseKeyHex(keyHex)) {
    throw new DatabaseKeyUnavailableError('the device returned a malformed recovery key');
  }
  cachedKeyHex = keyHex;
  return keyHex;
}

export async function completeDatabaseKeyRecovery(): Promise<void> {
  try {
    await completeDatabaseKeyRecoveryNative();
  } catch (error) {
    throw new DatabaseKeyUnavailableError('recovery key state could not be finalized', {
      cause: error,
    });
  }
}

function isUnrecoverableNativeError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (code === NATIVE_UNRECOVERABLE_CODE) {
    return true;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.includes(NATIVE_UNRECOVERABLE_CODE);
}

/**
 * Drops the in-memory copy. Test-only hook so a suite can prove the key is
 * fetched once per process rather than once per call; production never needs
 * to forget a key it will immediately need again.
 */
export function __resetDatabaseKeyCacheForTests(): void {
  cachedKeyHex = null;
}
