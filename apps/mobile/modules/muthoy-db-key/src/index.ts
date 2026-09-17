import { requireNativeModule } from 'expo';

interface MuthoyDbKeyNativeModule {
  hasDatabaseKeyAsync(): Promise<boolean>;
  getOrCreateDatabaseKeyHexAsync(): Promise<string>;
  hasPendingDatabaseKeyRecoveryAsync(): Promise<boolean>;
  beginDatabaseKeyRecoveryAsync(): Promise<string>;
  completeDatabaseKeyRecoveryAsync(): Promise<void>;
  atomicRenameDatabaseFile(fromFileName: string, toFileName: string): void;
}

let nativeModule: MuthoyDbKeyNativeModule | null = null;

function requireModule(): MuthoyDbKeyNativeModule {
  nativeModule ??= requireNativeModule<MuthoyDbKeyNativeModule>('MuthoyDbKey');
  return nativeModule;
}

/**
 * Whether a wrapped database key already exists on this device.
 *
 * `false` means fresh install — nothing has ever been encrypted, so minting a
 * key is safe. `true` means an encrypted database should exist. The caller
 * pairs this with the on-disk database state so a missing key can never be
 * answered by silently creating an empty database.
 */
export function hasDatabaseKeyNative(): Promise<boolean> {
  return requireModule().hasDatabaseKeyAsync();
}

/**
 * The SQLCipher database key as 64 lowercase hex characters, minted and
 * wrapped on first call. Rejects with `MU_DBKEY_UNRECOVERABLE` when a wrapped
 * key exists but the AndroidKeyStore key protecting it is gone.
 */
export function getOrCreateDatabaseKeyHexNative(): Promise<string> {
  return requireModule().getOrCreateDatabaseKeyHexAsync();
}

export function hasPendingDatabaseKeyRecoveryNative(): Promise<boolean> {
  return requireModule().hasPendingDatabaseKeyRecoveryAsync();
}

export function beginDatabaseKeyRecoveryNative(): Promise<string> {
  return requireModule().beginDatabaseKeyRecoveryAsync();
}

export function completeDatabaseKeyRecoveryNative(): Promise<void> {
  return requireModule().completeDatabaseKeyRecoveryAsync();
}

export function atomicRenameDatabaseFileNative(
  fromFileName: string,
  toFileName: string,
): void {
  requireModule().atomicRenameDatabaseFile(fromFileName, toFileName);
}
