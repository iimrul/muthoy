// H-3 plaintext -> SQLCipher copy/verify/swap coordinator.
// File operations are supplied by encryptionEnvironment so the state machine
// is testable without weakening the native Android path.

import {
  CANDIDATE_FILE_NAME,
  DATABASE_FILE_NAME,
  LOCKED_DATABASE_BACKUP_FILE_NAME,
  PLAINTEXT_BACKUP_FILE_NAME,
  PRESERVED_PLAINTEXT_FILE_NAME,
  RECOVERY_DATABASE_FILE_NAME,
  planDatabaseStartup,
  type DatabaseDiskState,
  type DatabaseFileClass,
  type StartupActionKind,
} from './encryptionPlan';
import {
  collectDatabaseFingerprint,
  compareDatabasePayloads,
  compareFingerprints,
  rebuildMedicinesFts,
  verifyForeignKeys,
  verifyIntegrity,
  verifyMedicinesFtsSearchable,
  type SqlConnection,
  type VerificationFailure,
} from './encryptionVerify';
import {
  DatabaseEncryptionMigrationError,
  DatabaseKeyUnrecoverableError,
  DatabaseRecoveryPendingError,
} from './errors';

export interface MigrationConnection extends SqlConnection {
  /**
   * Closes asynchronously so the close never runs on the JS thread.
   *
   * On device, closing a written, encrypted, checkpointed candidate after
   * verification did not return at all: first as a permanent 100%-CPU spin,
   * and — once the close was moved off the JS thread — as an uninterruptible
   * block that ART eventually aborted the process over. The cause was inside
   * expo-sqlite's close, not in thread scheduling: `closeDatabase` runs
   * `sqlite3_finalize_all_statement()` over every statement still registered
   * on the connection BEFORE `sqlite3_close()`, and that walk was what hung.
   * The actual fix is `finalizeUnusedStatementsBeforeClosing: false` in
   * encryptionEnvironment's MIGRATION_OPEN_OPTIONS, which skips the walk.
   *
   * This asynchronous contract is kept on top of that fix: closing a database
   * is I/O, it must not block the boot frame, and it leaves the JS thread free
   * if a future close ever does take real time.
   */
  close(): Promise<void>;
}

export interface EncryptionEnvironment {
  exists(fileName: string): boolean;
  classify(fileName: string): DatabaseFileClass;
  deleteFile(fileName: string): void;
  deleteSidecars(fileName: string): void;
  rename(fromFileName: string, toFileName: string): void;
  openPlaintext(fileName: string): MigrationConnection;
  openEncrypted(fileName: string, keyHex: string): MigrationConnection;
  exportToEncrypted(
    source: MigrationConnection,
    toFileName: string,
    keyHex: string,
  ): void;
  log(event: EncryptionEvent): void;
}

export interface DatabaseKeyProvider {
  hasKey(): Promise<boolean>;
  getKeyHex(): Promise<string>;
  hasPendingRecovery?(): Promise<boolean>;
}

export type EncryptionOutcome = 'fresh' | 'already-encrypted' | 'migrated' | 'finalized';

export type EncryptionEvent =
  | { type: 'startup-action'; action: StartupActionKind }
  | { type: 'migration-started' }
  | { type: 'migration-verified' }
  | { type: 'migration-rejected'; failureCodes: string[] }
  | { type: 'stale-candidate-discarded' }
  | { type: 'backup-retained' }
  | { type: 'backup-released' }
  /** An unreadable encrypted main was replaced by its plaintext original. */
  | { type: 'plaintext-backup-restored' }
  /** A backup that is NOT this main's original; both copies kept. */
  | { type: 'foreign-backup-retained' }
  /** A superseded plaintext original re-exported encrypted, then removed. */
  | { type: 'unsynced-backup-preserved' };

export interface EncryptionPreparation {
  keyHex: string;
  outcome: EncryptionOutcome;
  /** Delete only after the promoted main has been reopened as the live DB. */
  releasePlaintextBackup: boolean;
}

function state(environment: EncryptionEnvironment): DatabaseDiskState {
  return {
    main: environment.classify(DATABASE_FILE_NAME),
    candidate: environment.classify(CANDIDATE_FILE_NAME),
    backup: environment.classify(PLAINTEXT_BACKUP_FILE_NAME),
  };
}

async function closeQuietly(connection: MigrationConnection | null): Promise<void> {
  if (!connection) return;
  try {
    await connection.close();
  } catch {
    // The original error is authoritative. A failed close must not mask it.
  }
}

function failureCodes(failures: VerificationFailure[]): string[] {
  return [...new Set(failures.map((failure) => failure.check))].sort();
}

function reject(
  environment: EncryptionEnvironment,
  step: string,
  failures: VerificationFailure[],
): never {
  const codes = failureCodes(failures);
  environment.log({ type: 'migration-rejected', failureCodes: codes });
  const readableCodes = codes
    .map((code) => (code.includes('ledger') ? 'ledger-invariant' : code))
    .join(',');
  throw new DatabaseEncryptionMigrationError(step, readableCodes || 'verification-failed');
}

function verifyStandalone(connection: MigrationConnection): VerificationFailure[] {
  const fingerprint = collectDatabaseFingerprint(connection);
  return [
    ...verifyIntegrity(connection),
    ...verifyForeignKeys(connection),
    ...(fingerprint.ledgerMismatchCount === 0
      ? []
      : [{ check: 'ledger-invariant', detail: 'ledger invariant failed' }]),
  ];
}

/**
 * `rebuildTargetFts` exists because the target is not always a throwaway.
 *
 * An FTS5 external-content index does not survive `sqlcipher_export`, so a
 * freshly copied CANDIDATE must be rebuilt before it can be compared. A
 * plaintext `.plainbak`, by contrast, is the shop's last readable copy and
 * carries an index that was already correct — rebuilding it would mean
 * WRITING to the safety backup during a read-only proof (H-3 review LOW-1).
 * Everything else here, `verifyMedicinesFtsSearchable` included, only reads
 * the main database or scratch objects in `temp`.
 */
function verifyCopies(
  source: MigrationConnection,
  target: MigrationConnection,
  { rebuildTargetFts }: { rebuildTargetFts: boolean },
): VerificationFailure[] {
  if (rebuildTargetFts) rebuildMedicinesFts(target);
  return [
    ...verifyStandalone(source),
    ...verifyStandalone(target),
    ...compareFingerprints(
      collectDatabaseFingerprint(source),
      collectDatabaseFingerprint(target),
    ),
    ...compareDatabasePayloads(source, target),
    ...verifyMedicinesFtsSearchable(target),
  ];
}

function deleteDatabase(environment: EncryptionEnvironment, fileName: string): void {
  environment.deleteSidecars(fileName);
  environment.deleteFile(fileName);
}

function checkpoint(connection: MigrationConnection): void {
  const result = connection.getFirstSync<{
    busy: number;
    log: number;
    checkpointed: number;
  }>('PRAGMA wal_checkpoint(TRUNCATE)');
  if (
    result === null ||
    Number(result.busy) !== 0 ||
    Number(result.log) !== Number(result.checkpointed)
  ) {
    throw new DatabaseEncryptionMigrationError('checkpoint', 'checkpoint-incomplete');
  }
}

/**
 * Renames a database only after its WAL has been checkpointed. All Android
 * renames are same-directory native rename(2); sidecars are removed while the
 * connection is closed, including rollback journals.
 */
function renameDatabase(
  environment: EncryptionEnvironment,
  fromFileName: string,
  toFileName: string,
): void {
  environment.deleteSidecars(fromFileName);
  environment.deleteSidecars(toFileName);
  // Header classification deliberately treats Expo-created zero-byte files
  // as missing. POSIX rename still sees such a path as an existing target, so
  // remove only that proven-empty placeholder before the no-overwrite rename.
  if (environment.classify(toFileName) === 'missing' && environment.exists(toFileName)) {
    environment.deleteFile(toFileName);
  }
  environment.rename(fromFileName, toFileName);
}

/**
 * "Cannot be opened at all" and "opens fine but does not match the backup" are
 * different facts and must not collapse into one failure list.
 *
 * Unreadable means the key no longer fits the main database, and the plaintext
 * original beside it is the recovery. A mismatch means main IS readable and the
 * backup simply is not its original — a `.plainbak` preserved across a server
 * recovery, say. Treating that second case as "restore the backup" would
 * discard a live, working database (H-3 review HIGH-1).
 */
type PromotedMainCheck =
  | { kind: 'ok' }
  | { kind: 'unreadable' }
  | { kind: 'corrupt'; failures: VerificationFailure[] }
  | { kind: 'mismatch'; failures: VerificationFailure[] };

async function verifyPromotedMain(
  environment: EncryptionEnvironment,
  keyHex: string,
): Promise<PromotedMainCheck> {
  let target: MigrationConnection | null = null;
  try {
    target = environment.openEncrypted(DATABASE_FILE_NAME, keyHex);
  } catch {
    await closeQuietly(target);
    return { kind: 'unreadable' };
  }

  let source: MigrationConnection | null = null;
  try {
    // Main's own health first. A corrupt promoted database is never "ok",
    // whatever the backup sitting beside it turns out to be.
    const ownFailures = verifyStandalone(target);
    if (ownFailures.length > 0) return { kind: 'corrupt', failures: ownFailures };

    source = environment.openPlaintext(PLAINTEXT_BACKUP_FILE_NAME);
    const failures = verifyCopies(source, target, { rebuildTargetFts: true });
    return failures.length > 0 ? { kind: 'mismatch', failures } : { kind: 'ok' };
  } catch {
    return {
      kind: 'mismatch',
      failures: [{ check: 'promoted-compare-failed', detail: 'comparison could not complete' }],
    };
  } finally {
    await closeQuietly(source);
    await closeQuietly(target);
  }
}

/**
 * Cheap post-rename confirmation for a promotion happening in THIS process,
 * right after the file being renamed was already fully verified.
 *
 * `Os.rename` is POSIX rename(2): atomic, same inode, same bytes. It cannot
 * corrupt or substitute file content, so re-running the full integrity/FK/
 * ledger/FTS/row-payload comparison against the backup here proves nothing
 * that the pre-rename `verifyCopies` (moments earlier, same call stack, same
 * bytes under the CANDIDATE name) had not already proven. It only doubles the
 * synchronous native/SQL work and the number of short-lived connections open
 * in one burst — on this device class that reliably provoked a JS-GC pass
 * concurrent with native teardown, crashing the process in a background
 * runtime thread (ART JIT compiler / Nitro `HybridData` finalizer) with zero
 * app frames. The fix is to stop doing the redundant work, not to chase the
 * runtime crash directly.
 *
 * `inspectFinishedMigration` is a DIFFERENT situation — it examines whatever
 * a previous, possibly-crashed process left behind on the next boot, where
 * nothing is known about what happened between processes. That path keeps
 * using the full `verifyPromotedMain` above.
 */
async function probePromotedMain(
  environment: EncryptionEnvironment,
  keyHex: string,
): Promise<'ok' | 'unreadable'> {
  let target: MigrationConnection | null = null;
  try {
    target = environment.openEncrypted(DATABASE_FILE_NAME, keyHex);
    return 'ok';
  } catch {
    return 'unreadable';
  } finally {
    await closeQuietly(target);
  }
}

function rollbackPromotion(environment: EncryptionEnvironment): void {
  // The pre-swap candidate was independently verified. Preserve it while
  // restoring the equally valid plaintext backup to the live name.
  if (
    environment.classify(DATABASE_FILE_NAME) !== 'missing' &&
    environment.classify(CANDIDATE_FILE_NAME) === 'missing'
  ) {
    renameDatabase(environment, DATABASE_FILE_NAME, CANDIDATE_FILE_NAME);
  }
  if (
    environment.classify(DATABASE_FILE_NAME) === 'missing' &&
    environment.classify(PLAINTEXT_BACKUP_FILE_NAME) !== 'missing'
  ) {
    renameDatabase(environment, PLAINTEXT_BACKUP_FILE_NAME, DATABASE_FILE_NAME);
  }
}

async function promoteVerifiedCandidate(
  environment: EncryptionEnvironment,
  keyHex: string,
): Promise<void> {
  if (environment.classify(PLAINTEXT_BACKUP_FILE_NAME) === 'missing') {
    renameDatabase(environment, DATABASE_FILE_NAME, PLAINTEXT_BACKUP_FILE_NAME);
  } else {
    // A pre-existing backup is allowed only when it is an exact verified copy
    // of main. That proof occurs in migratePlaintextDatabase before this call.
    deleteDatabase(environment, DATABASE_FILE_NAME);
  }

  renameDatabase(environment, CANDIDATE_FILE_NAME, DATABASE_FILE_NAME);
  // Lightweight probe, not the full verifyPromotedMain — see probePromotedMain.
  const probeResult = await probePromotedMain(environment, keyHex);
  if (probeResult !== 'ok') {
    rollbackPromotion(environment);
    reject(environment, 'promoted-reopen', [
      { check: 'promoted-open-failed', detail: 'promoted database could not be opened' },
    ]);
  }
}

async function migratePlaintextDatabase(
  environment: EncryptionEnvironment,
  keyHex: string,
): Promise<EncryptionPreparation> {
  environment.log({ type: 'migration-started' });
  let source: MigrationConnection | null = null;
  let candidate: MigrationConnection | null = null;
  let sourceVerified = false;
  try {
    source = environment.openPlaintext(DATABASE_FILE_NAME);
    checkpoint(source);
    const sourceFailures = verifyStandalone(source);
    if (sourceFailures.length > 0) reject(environment, 'source-verification', sourceFailures);
    sourceVerified = true;

    // A candidate is disposable only after the plaintext source has opened,
    // checkpointed, and passed integrity/foreign-key/ledger checks.
    if (environment.classify(CANDIDATE_FILE_NAME) !== 'missing') {
      deleteDatabase(environment, CANDIDATE_FILE_NAME);
      environment.log({ type: 'stale-candidate-discarded' });
    }

    environment.exportToEncrypted(source, CANDIDATE_FILE_NAME, keyHex);
    candidate = environment.openEncrypted(CANDIDATE_FILE_NAME, keyHex);
    const failures = verifyCopies(source, candidate, { rebuildTargetFts: true });
    if (failures.length > 0) reject(environment, 'verification', failures);

    // If a backup was stranded from an older attempt, prove it is the same
    // source before permitting main to be removed during promotion.
    if (environment.classify(PLAINTEXT_BACKUP_FILE_NAME) !== 'missing') {
      let backup: MigrationConnection | null = null;
      try {
        backup = environment.openPlaintext(PLAINTEXT_BACKUP_FILE_NAME);
        // Read-only: never rebuild the FTS index of the last plaintext copy.
        const backupFailures = verifyCopies(source, backup, { rebuildTargetFts: false });
        if (backupFailures.length > 0) reject(environment, 'backup-verification', backupFailures);
      } finally {
        await closeQuietly(backup);
      }
    }

    checkpoint(candidate);
    environment.log({ type: 'migration-verified' });
  } catch (error) {
    await closeQuietly(candidate);
    await closeQuietly(source);
    // Whether the half-built candidate may be dropped is a question about the
    // FILES, not about who threw. It is disposable exactly when a readable
    // plaintext main is still on disk to retry from — re-checked here rather
    // than inferred, so an interrupted export can never take the last copy
    // with it. (H-3 review MEDIUM-2 replaced a test-class-name check here.)
    if (sourceVerified && environment.classify(DATABASE_FILE_NAME) === 'plaintext') {
      deleteDatabase(environment, CANDIDATE_FILE_NAME);
    }
    if (error instanceof DatabaseEncryptionMigrationError) throw error;
    // SQLCipher may include the ATTACH statement in its exception. That
    // statement contains the raw key, so never retain the original cause.
    throw new DatabaseEncryptionMigrationError('copy', 'copy-failed');
  }

  await closeQuietly(candidate);
  await closeQuietly(source);
  await promoteVerifiedCandidate(environment, keyHex);
  environment.log({ type: 'backup-retained' });
  return { keyHex, outcome: 'migrated', releasePlaintextBackup: true };
}

/**
 * Whether an already-built candidate can be promoted against the verified
 * backup.
 *
 * Returns false ONLY while nothing has moved, so the caller may safely fall
 * back to restoring the backup. Once the candidate has been renamed onto the
 * live name the decision is committed: a failure there rolls back and THROWS.
 * The previous version swallowed that throw and then tried to restore a
 * backup the rollback had already consumed, turning a recoverable state into
 * a hard boot failure (H-3 review MEDIUM-1).
 */
async function tryPromoteExistingCandidate(
  environment: EncryptionEnvironment,
  keyHex: string,
): Promise<boolean> {
  if (environment.classify(CANDIDATE_FILE_NAME) !== 'encrypted') return false;

  let backup: MigrationConnection | null = null;
  let candidate: MigrationConnection | null = null;
  try {
    candidate = environment.openEncrypted(CANDIDATE_FILE_NAME, keyHex);
    backup = environment.openPlaintext(PLAINTEXT_BACKUP_FILE_NAME);
    if (verifyCopies(backup, candidate, { rebuildTargetFts: true }).length > 0) return false;
    checkpoint(candidate);
  } catch {
    // An unusable candidate is not an error here: the backup is authoritative
    // and the caller re-runs the migration from it. The candidate is left on
    // disk for migratePlaintextDatabase to clear once the source is proven.
    return false;
  } finally {
    await closeQuietly(candidate);
    await closeQuietly(backup);
  }

  renameDatabase(environment, CANDIDATE_FILE_NAME, DATABASE_FILE_NAME);
  // Lightweight probe, not the full verifyPromotedMain — see probePromotedMain.
  if ((await probePromotedMain(environment, keyHex)) !== 'ok') {
    rollbackPromotion(environment);
    reject(environment, 'promoted-reopen', [
      { check: 'promoted-open-failed', detail: 'promoted database could not be opened' },
    ]);
  }
  return true;
}

async function resumeSwapOrRestore(
  environment: EncryptionEnvironment,
  keyHex: string,
): Promise<EncryptionPreparation> {
  let backup: MigrationConnection | null = null;
  let backupFailures: VerificationFailure[] = [];
  try {
    backup = environment.openPlaintext(PLAINTEXT_BACKUP_FILE_NAME);
    backupFailures = verifyStandalone(backup);
  } catch {
    throw new DatabaseEncryptionMigrationError('backup-verification', 'backup-open-failed');
  } finally {
    await closeQuietly(backup);
  }
  if (backupFailures.length > 0) reject(environment, 'backup-verification', backupFailures);

  if (await tryPromoteExistingCandidate(environment, keyHex)) {
    environment.log({ type: 'backup-retained' });
    return { keyHex, outcome: 'migrated', releasePlaintextBackup: true };
  }

  // Preserve even an unusable candidate until the plaintext backup is back at
  // the live name and migratePlaintextDatabase has opened and verified it.
  // That function then performs the bounded candidate cleanup.
  renameDatabase(environment, PLAINTEXT_BACKUP_FILE_NAME, DATABASE_FILE_NAME);
  return migratePlaintextDatabase(environment, keyHex);
}

async function inspectFinishedMigration(
  environment: EncryptionEnvironment,
  keyHex: string,
): Promise<EncryptionPreparation> {
  const check = await verifyPromotedMain(environment, keyHex);

  if (check.kind === 'unreadable') {
    // The key no longer opens main, but its plaintext original is right here
    // and needs no key. Restore it instead of declaring the shop lost.
    return restorePlaintextBackup(environment, keyHex);
  }

  if (check.kind === 'corrupt') {
    // Main opens but is internally damaged. Both copies are kept and a human
    // decides: silently promoting the backup could discard a newer database.
    environment.log({ type: 'migration-rejected', failureCodes: failureCodes(check.failures) });
    throw new DatabaseKeyUnrecoverableError('encrypted-main-corrupt');
  }

  if (check.kind === 'mismatch') {
    // Main is readable and sound; the backup simply is not its original —
    // typically a plaintext copy preserved across a server recovery. Keep
    // BOTH. Promoting the backup would discard a working database, and
    // releasing it would discard rows this device never pushed.
    environment.log({ type: 'foreign-backup-retained' });
    return { keyHex, outcome: 'already-encrypted', releasePlaintextBackup: false };
  }

  // Main is now proven usable. A leftover candidate is no longer the only
  // valid encrypted copy and can be removed. Backup remains until live reopen.
  if (environment.classify(CANDIDATE_FILE_NAME) !== 'missing') {
    deleteDatabase(environment, CANDIDATE_FILE_NAME);
    environment.log({ type: 'stale-candidate-discarded' });
  }
  return { keyHex, outcome: 'finalized', releasePlaintextBackup: true };
}

/**
 * Replaces an unreadable encrypted main with the plaintext original that is
 * still sitting beside it, then runs the ordinary migration under the current
 * key. This is H-3 review HIGH-1: the old code called this state
 * "unrecoverable" and sent the owner to a server restore, which cannot know
 * about rows the device never pushed.
 *
 * Nothing moves until the backup has been opened and passed integrity,
 * foreign-key and ledger checks, and the displaced main is ARCHIVED rather
 * than deleted — "no key today" must never become "no data ever" if the
 * Keystore entry later proves recoverable.
 */
async function restorePlaintextBackup(
  environment: EncryptionEnvironment,
  keyHex: string,
): Promise<EncryptionPreparation> {
  let backup: MigrationConnection | null = null;
  let failures: VerificationFailure[] = [];
  try {
    backup = environment.openPlaintext(PLAINTEXT_BACKUP_FILE_NAME);
    failures = verifyStandalone(backup);
  } catch {
    throw new DatabaseKeyUnrecoverableError('encrypted-without-readable-backup');
  } finally {
    await closeQuietly(backup);
  }
  if (failures.length > 0) {
    environment.log({ type: 'migration-rejected', failureCodes: failureCodes(failures) });
    throw new DatabaseKeyUnrecoverableError('encrypted-without-readable-backup');
  }

  if (environment.classify(DATABASE_FILE_NAME) !== 'missing') {
    if (environment.classify(LOCKED_DATABASE_BACKUP_FILE_NAME) !== 'missing') {
      // Refuse rather than overwrite an existing archive: two locked copies
      // is a state for a human, not for a boot sequence.
      throw new DatabaseKeyUnrecoverableError('locked-archive-occupied');
    }
    renameDatabase(environment, DATABASE_FILE_NAME, LOCKED_DATABASE_BACKUP_FILE_NAME);
  }

  renameDatabase(environment, PLAINTEXT_BACKUP_FILE_NAME, DATABASE_FILE_NAME);
  environment.log({ type: 'plaintext-backup-restored' });
  return migratePlaintextDatabase(environment, keyHex);
}

/**
 * Keeps a plaintext original that a server recovery superseded, without
 * leaving plaintext on disk.
 *
 * Server hydration rebuilds the shop from the cloud, so anything this device
 * had not yet pushed exists ONLY in that backup — deleting it was the second
 * half of H-3 review HIGH-1. It is re-exported ENCRYPTED under the current
 * key, verified against its source, and only then is the plaintext removed.
 *
 * Returns false, having changed nothing, whenever preservation cannot be
 * completed: keeping a plaintext backup is always better than losing it.
 */
export async function preserveUnsyncedPlaintextBackup(
  environment: EncryptionEnvironment,
  keyHex: string,
): Promise<boolean> {
  if (environment.classify(PLAINTEXT_BACKUP_FILE_NAME) !== 'plaintext') return false;
  // An occupied slot is an earlier preserved copy. Keep it and keep this one
  // where it is; nothing here may overwrite unsynced data.
  if (environment.classify(PRESERVED_PLAINTEXT_FILE_NAME) !== 'missing') return false;

  let source: MigrationConnection | null = null;
  let preserved: MigrationConnection | null = null;
  let verified = false;
  try {
    source = environment.openPlaintext(PLAINTEXT_BACKUP_FILE_NAME);
    environment.exportToEncrypted(source, PRESERVED_PLAINTEXT_FILE_NAME, keyHex);
    preserved = environment.openEncrypted(PRESERVED_PLAINTEXT_FILE_NAME, keyHex);
    verified = verifyCopies(source, preserved, { rebuildTargetFts: true }).length === 0;
  } catch {
    verified = false;
  } finally {
    await closeQuietly(preserved);
    await closeQuietly(source);
  }

  if (!verified) {
    deleteDatabase(environment, PRESERVED_PLAINTEXT_FILE_NAME);
    return false;
  }

  deleteDatabase(environment, PLAINTEXT_BACKUP_FILE_NAME);
  environment.log({ type: 'unsynced-backup-preserved' });
  return true;
}

export async function prepareEncryptedDatabase(
  environment: EncryptionEnvironment,
  keys: DatabaseKeyProvider,
): Promise<EncryptionPreparation> {
  if (await keys.hasPendingRecovery?.()) {
    throw new DatabaseRecoveryPendingError();
  }

  const diskState = state(environment);
  const keyPresent = await keys.hasKey();
  const plan = planDatabaseStartup(diskState, keyPresent);
  environment.log({ type: 'startup-action', action: plan.action });

  if (plan.action === 'fail-unrecoverable') {
    throw new DatabaseKeyUnrecoverableError(plan.reason ?? 'unknown-database-state');
  }

  const keyHex = await keys.getKeyHex();
  switch (plan.action) {
    case 'open-fresh':
      return { keyHex, outcome: 'fresh', releasePlaintextBackup: false };
    case 'open-encrypted': {
      // The steady state: every launch, and every headless notification wake.
      //
      // The ONLY thing a safe open requires is proof that the key fits, and
      // openEncrypted already provides it — it applies `PRAGMA key` and then
      // forces a `sqlite_master` read, which is what makes a wrong key fail
      // closed here instead of somewhere deep in a screen. That read is
      // bounded by the SCHEMA, not by how much the pharmacy has sold.
      //
      // Deliberately NOT integrity_check, foreign_key_check, per-table counts,
      // the ledger join or the FTS probe. Those are full-database scans on an
      // encrypted file, so their cost grows with the shop's history forever;
      // running them on every cold start was H-3 review HIGH-2, and it
      // competes directly with H-4's login budget. They belong to the
      // migration and recovery paths, which run once and have a second copy
      // to compare against — a lone self-check of the only database cannot
      // repair anything it finds anyway.
      let main: MigrationConnection | null = null;
      try {
        main = environment.openEncrypted(DATABASE_FILE_NAME, keyHex);
      } catch {
        throw new DatabaseKeyUnrecoverableError('wrong-key-or-corrupt-database');
      } finally {
        await closeQuietly(main);
      }
      if (plan.discardStaleCandidate) {
        deleteDatabase(environment, CANDIDATE_FILE_NAME);
        environment.log({ type: 'stale-candidate-discarded' });
      }
      return { keyHex, outcome: 'already-encrypted', releasePlaintextBackup: false };
    }
    case 'finalize-previous-migration':
      return inspectFinishedMigration(environment, keyHex);
    case 'restore-backup-then-migrate':
      return resumeSwapOrRestore(environment, keyHex);
    case 'restore-plaintext-backup':
      return restorePlaintextBackup(environment, keyHex);
    case 'migrate-plaintext':
      return migratePlaintextDatabase(environment, keyHex);
    default:
      throw new DatabaseKeyUnrecoverableError('unsupported-startup-state');
  }
}

/** Called only after client.ts has reopened and configured the live main DB. */
export function releaseVerifiedPlaintextBackup(environment: EncryptionEnvironment): void {
  if (environment.classify(PLAINTEXT_BACKUP_FILE_NAME) === 'missing') return;
  deleteDatabase(environment, PLAINTEXT_BACKUP_FILE_NAME);
  environment.log({ type: 'backup-released' });
}

/**
 * Finishes cleanup if recovery crashed after the replacement main and new key
 * were activated. Call only after steady-state main has been reopened and
 * verified with the active key; pending recovery is rejected before this path.
 */
export function releaseCompletedRecoveryArtifacts(environment: EncryptionEnvironment): void {
  deleteDatabase(environment, LOCKED_DATABASE_BACKUP_FILE_NAME);
  deleteDatabase(environment, RECOVERY_DATABASE_FILE_NAME);
}
