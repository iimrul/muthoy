// H-3 authenticated missing-key restore. The locked database is never opened,
// overwritten, or removed while the replacement is being hydrated.

import { sqliteConnection } from './client';
import { createEncryptionEnvironment } from './encryptionEnvironment';
import {
  DATABASE_FILE_NAME,
  LOCKED_DATABASE_BACKUP_FILE_NAME,
  RECOVERY_DATABASE_FILE_NAME,
} from './encryptionPlan';
import { verifyHydratedDatabase } from './encryptionVerify';
import { preserveUnsyncedPlaintextBackup } from './encryptionMigration';
import { DatabaseEncryptionMigrationError } from './errors';
import {
  closeDatabaseInitializationForRecovery,
  initializeRecoveryDatabase,
} from './init';

const SIDECAR_SUFFIXES = ['-journal', '-wal', '-shm'] as const;

function environment() {
  return createEncryptionEnvironment(() => undefined);
}

function deleteDatabase(fileName: string): void {
  const files = environment();
  files.deleteSidecars(fileName);
  files.deleteFile(fileName);
}

function usableFileExists(fileName: string): boolean {
  return environment().classify(fileName) !== 'missing';
}

function renameBaseFile(fromFileName: string, toFileName: string): void {
  const files = environment();
  if (files.classify(toFileName) === 'missing' && files.exists(toFileName)) {
    files.deleteFile(toFileName);
  }
  files.rename(fromFileName, toFileName);
}

function throwVerification(step: string, codes: string[]): never {
  throw new DatabaseEncryptionMigrationError(
    step,
    [...new Set(codes)].sort().join(',') || 'verification-failed',
  );
}

export function verifyCurrentRecoveryDatabase(): void {
  const failures = verifyHydratedDatabase(sqliteConnection);
  if (failures.length > 0) {
    throwVerification('recovery-verification', failures.map((failure) => failure.check));
  }
}

/** Stops exposing an isolated/failed recovery connection to db/ consumers. */
export function closeDatabaseRecoveryTarget(): void {
  closeDatabaseInitializationForRecovery();
}

function finishArchivingOldSidecars(): void {
  const files = environment();
  for (const suffix of SIDECAR_SUFFIXES) {
    const source = `${DATABASE_FILE_NAME}${suffix}`;
    const target = `${LOCKED_DATABASE_BACKUP_FILE_NAME}${suffix}`;
    if (!files.exists(source)) continue;
    if (files.exists(target)) {
      throw new DatabaseEncryptionMigrationError(
        'recovery-resume',
        'conflicting-locked-sidecar',
      );
    }
    files.rename(source, target);
  }
}

function promoteRecoveryFile(): void {
  const files = environment();
  finishArchivingOldSidecars();
  // Recovery DB was checkpointed and closed before promotion. Its sidecars
  // are not part of the verified payload.
  files.deleteSidecars(RECOVERY_DATABASE_FILE_NAME);
  files.deleteSidecars(DATABASE_FILE_NAME);
  renameBaseFile(RECOVERY_DATABASE_FILE_NAME, DATABASE_FILE_NAME);
}

export type RecoveryDatabaseState = 'needs-hydration' | 'promoted';

/** Called only after server authentication and key rotation have succeeded. */
export async function openDatabaseRecoveryTarget(
  keyHex: string,
): Promise<RecoveryDatabaseState> {
  const lockedExists = usableFileExists(LOCKED_DATABASE_BACKUP_FILE_NAME);
  const mainExists = usableFileExists(DATABASE_FILE_NAME);
  const recoveryExists = usableFileExists(RECOVERY_DATABASE_FILE_NAME);

  if (!lockedExists) {
    if (!mainExists) {
      throw new DatabaseEncryptionMigrationError('recovery-start', 'locked-database-missing');
    }
    // An unpromoted target may be partially hydrated. Restart the explicit
    // full pull against an empty target while the locked main remains.
    if (recoveryExists) deleteDatabase(RECOVERY_DATABASE_FILE_NAME);
    await initializeRecoveryDatabase(RECOVERY_DATABASE_FILE_NAME, keyHex);
    return 'needs-hydration';
  }

  if (!mainExists) {
    if (!recoveryExists) {
      throw new DatabaseEncryptionMigrationError('recovery-resume', 'replacement-missing');
    }
    promoteRecoveryFile();
  }

  await initializeRecoveryDatabase(DATABASE_FILE_NAME, keyHex);
  verifyCurrentRecoveryDatabase();
  // Delete a duplicate target only after the promoted main is open/verified.
  if (environment().exists(RECOVERY_DATABASE_FILE_NAME)) {
    deleteDatabase(RECOVERY_DATABASE_FILE_NAME);
  }
  return 'promoted';
}

/** Promote only a closed, fully hydrated, independently verified target. */
export async function promoteHydratedRecoveryDatabase(keyHex: string): Promise<void> {
  verifyCurrentRecoveryDatabase();
  const checkpoint = sqliteConnection.getFirstSync<{
    busy: number;
    log: number;
    checkpointed: number;
  }>('PRAGMA wal_checkpoint(TRUNCATE)');
  if (
    checkpoint === null ||
    Number(checkpoint.busy) !== 0 ||
    Number(checkpoint.log) !== Number(checkpoint.checkpointed)
  ) {
    throw new DatabaseEncryptionMigrationError('recovery-checkpoint', 'checkpoint-incomplete');
  }
  closeDatabaseInitializationForRecovery();

  const files = environment();
  if (!files.exists(LOCKED_DATABASE_BACKUP_FILE_NAME)) {
    if (!files.exists(DATABASE_FILE_NAME)) {
      throw new DatabaseEncryptionMigrationError('recovery-swap', 'locked-database-missing');
    }
    // Base first. If the process dies now, restart sees locked+candidate and
    // finishes moving old sidecars before promoting the replacement.
    renameBaseFile(DATABASE_FILE_NAME, LOCKED_DATABASE_BACKUP_FILE_NAME);
  }
  promoteRecoveryFile();

  try {
    await initializeRecoveryDatabase(DATABASE_FILE_NAME, keyHex);
    verifyCurrentRecoveryDatabase();
  } catch (error) {
    closeDatabaseInitializationForRecovery();
    // Preserve both locked original and promoted replacement after ambiguity.
    throw error;
  }
}

/** Called only after exact-user validation and session activation succeed. */
export async function releaseLockedRecoveryDatabase(keyHex: string): Promise<void> {
  deleteDatabase(LOCKED_DATABASE_BACKUP_FILE_NAME);

  // The pre-encryption plaintext original is NEVER deleted here. Server
  // hydration rebuilt this shop from the cloud, so any sale or stock movement
  // the device had not yet pushed exists only in that file — deleting it lost
  // exactly the rows nobody else has (H-3 review HIGH-1). It is re-exported
  // encrypted under the live key and kept for an explicit reconciliation
  // step; if that cannot be completed it is simply left in place.
  await preserveUnsyncedPlaintextBackup(environment(), keyHex);

  const files = environment();
  if (files.exists(RECOVERY_DATABASE_FILE_NAME)) {
    deleteDatabase(RECOVERY_DATABASE_FILE_NAME);
  }
}
