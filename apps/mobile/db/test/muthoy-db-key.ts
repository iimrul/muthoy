// Node stand-in for modules/muthoy-db-key, aliased in vitest.config.ts the
// same way db/test/muthoy-pin-crypto.ts stands in for the PIN module.
//
// Models the CONTRACT the Kotlin side promises, not its implementation: one
// key minted on first request, the same key thereafter, and a distinguishable
// failure when a wrapped key exists but cannot be unwrapped. The helpers below
// let a suite simulate a reinstall (wipe) or a destroyed Keystore key
// (breakKeystore) without an Android device.

import { randomBytes } from 'node:crypto';

interface KeyStoreState {
  wrappedKey: string | null;
  archivedWrappedKey: string | null;
  recoveryPending: boolean;
  keystoreAvailable: boolean;
  mintCount: number;
}

const state: KeyStoreState = {
  wrappedKey: null,
  archivedWrappedKey: null,
  recoveryPending: false,
  keystoreAvailable: true,
  mintCount: 0,
};

class NativeCodedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'NativeCodedError';
    this.code = code;
  }
}

export async function hasDatabaseKeyNative(): Promise<boolean> {
  return state.wrappedKey !== null;
}

export async function getOrCreateDatabaseKeyHexNative(): Promise<string> {
  if (state.wrappedKey !== null) {
    if (!state.keystoreAvailable) {
      // Ciphertext survived, the key protecting it did not. The real module
      // raises exactly this code from its unwrap path.
      throw new NativeCodedError(
        'MU_DBKEY_UNRECOVERABLE',
        'The AndroidKeyStore key protecting the local database is gone',
      );
    }
    return state.wrappedKey;
  }

  if (!state.keystoreAvailable) {
    throw new NativeCodedError('MU_DBKEY_UNAVAILABLE', 'Key store unavailable');
  }

  state.wrappedKey = randomBytes(32).toString('hex');
  state.mintCount += 1;
  return state.wrappedKey;
}

export async function hasPendingDatabaseKeyRecoveryNative(): Promise<boolean> {
  return state.recoveryPending;
}

export async function beginDatabaseKeyRecoveryNative(): Promise<string> {
  if (!state.recoveryPending) {
    state.archivedWrappedKey = state.wrappedKey;
    state.wrappedKey = null;
    state.recoveryPending = true;
  }
  return getOrCreateDatabaseKeyHexNative();
}

export async function completeDatabaseKeyRecoveryNative(): Promise<void> {
  state.archivedWrappedKey = null;
  state.recoveryPending = false;
}

export function atomicRenameDatabaseFileNative(): void {
  throw new Error('Native file rename is not available in the generic Node key-store double.');
}

// ── test controls ───────────────────────────────────────────────────────

/** Back to a device that has never run the app. */
export function __resetDbKeyStore(): void {
  state.wrappedKey = null;
  state.archivedWrappedKey = null;
  state.recoveryPending = false;
  state.keystoreAvailable = true;
  state.mintCount = 0;
}

/** How many distinct keys have been minted — proves "generate once". */
export function __dbKeyMintCount(): number {
  return state.mintCount;
}

export function __hasArchivedDbKey(): boolean {
  return state.archivedWrappedKey !== null;
}

export function __isDbKeyRecoveryPending(): boolean {
  return state.recoveryPending;
}

/** Simulates a Keystore key destroyed while the wrapped blob survived. */
export function __breakKeystore(): void {
  state.keystoreAvailable = false;
}

/** Simulates an app reinstall: both the key and its wrapper are gone. */
export function __wipeKeyStore(): void {
  state.wrappedKey = null;
}

/** Forces a specific key, for the malformed/zero-key rejection tests. */
export function __forceStoredKey(keyHex: string): void {
  state.wrappedKey = keyHex;
}
