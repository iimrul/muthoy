// db/encryptionPlan.ts — H-3, the part that decides and nothing else.
//
// Pure: no expo-sqlite, no expo-file-system, no key store. Given what is on
// disk and whether a device key exists, it returns the ONE action startup may
// take. Every crash/restart case in the H-3 brief is a state in here rather
// than a comment in an imperative function, which is the only way they can all
// be tested (see db/encryption-plan.test.ts).
//
// The invariant the whole file exists to protect: at no point in any sequence
// is there zero readable copy of the shop's data. The original plaintext file
// is never renamed until an encrypted copy has been independently opened,
// verified and compared, and it is kept as `.plainbak` until the encrypted
// database has been reopened as the configured live connection.

/** Files this machine reasons about, classified by their real header bytes. */
export type DatabaseFileClass = 'missing' | 'plaintext' | 'encrypted';

/**
 * The first 16 bytes of every unencrypted SQLite file. SQLCipher encrypts from
 * byte 0 — header included — so its absence is what "encrypted" means here.
 */
export const SQLITE_PLAINTEXT_HEADER = 'SQLite format 3\0';

export const DATABASE_FILE_NAME = 'muthoy.db';
/** The encrypted copy under construction. Promoted only after verification. */
export const CANDIDATE_FILE_NAME = 'muthoy.enc.db';
/** The retained pre-encryption original. Deleted after verified live reopen. */
export const PLAINTEXT_BACKUP_FILE_NAME = 'muthoy.db.plainbak';
/** Fully hydrated recovery database, never active before verification. */
export const RECOVERY_DATABASE_FILE_NAME = 'muthoy.restore.db';
/** Locked pre-recovery database retained until recovery is fully activated. */
export const LOCKED_DATABASE_BACKUP_FILE_NAME = 'muthoy.db.lockedbak';
/**
 * A pre-encryption plaintext original that a server recovery superseded.
 *
 * Server hydration rebuilds the shop from the cloud, so anything this device
 * had not yet pushed exists ONLY in the plaintext backup. Deleting it would
 * silently lose those rows, so recovery re-exports it here ENCRYPTED with the
 * live key and only then removes the plaintext file. Never auto-deleted, and
 * never consulted by startup: reconciling its contents is an explicit,
 * operator-driven step (H-11), not something a boot may guess at.
 */
export const PRESERVED_PLAINTEXT_FILE_NAME = 'muthoy.db.unsyncedbak';

/**
 * Classifies a database file from its leading bytes.
 *
 * A zero-length file counts as `missing`: expo-sqlite's
 * `ensureDatabasePathExistsSync` can leave an empty file behind, and treating
 * that as an unreadable encrypted database would brick a fresh install.
 */
export function classifyDatabaseHeader(header: Uint8Array | null): DatabaseFileClass {
  if (header === null || header.length === 0) {
    return 'missing';
  }
  if (header.length < SQLITE_PLAINTEXT_HEADER.length) {
    // Too short to be either a real SQLite header or a usable page — but it is
    // NOT empty, so it is something we must not silently overwrite.
    return 'encrypted';
  }
  for (let index = 0; index < SQLITE_PLAINTEXT_HEADER.length; index += 1) {
    if (header[index] !== SQLITE_PLAINTEXT_HEADER.charCodeAt(index)) {
      return 'encrypted';
    }
  }
  return 'plaintext';
}

export interface DatabaseDiskState {
  main: DatabaseFileClass;
  candidate: DatabaseFileClass;
  backup: DatabaseFileClass;
}

export type StartupActionKind =
  /** Nothing on disk. Mint a key and open a new encrypted database. */
  | 'open-fresh'
  /** Already encrypted, nothing pending. The steady state. */
  | 'open-encrypted'
  /** Encrypted, but `.plainbak` is still here. Verify it before live reopen. */
  | 'finalize-previous-migration'
  /** A plaintext database from before H-3. Run the one-time migration. */
  | 'migrate-plaintext'
  /** Crashed mid-swap: verify/promote the candidate or restore the backup and retry. */
  | 'restore-backup-then-migrate'
  /** Main is locked forever, but the plaintext original is still readable. */
  | 'restore-plaintext-backup'
  /** Refuse to continue. Never destructive — files are left exactly as found. */
  | 'fail-unrecoverable';

export type UnrecoverableReason =
  /** An encrypted database exists but the device key is gone. */
  | 'encrypted-without-key'
  /** A candidate with no original and no backup: not reachable from our own flow. */
  | 'orphan-candidate'
  /** `.plainbak` is itself encrypted — the slot only ever holds the plaintext original. */
  | 'corrupt-backup';

export interface StartupPlan {
  action: StartupActionKind;
  reason?: UnrecoverableReason;
  /**
   * A leftover candidate that is safe to discard, because a full original
   * (plaintext main, encrypted main, or the backup) still exists. Never set
   * when the candidate could be the only copy of anything.
   */
  discardStaleCandidate: boolean;
}

/**
 * Chooses the single startup action for the given disk state.
 *
 * `keyPresent` is whether the device already HAS a wrapped key, not whether
 * one could be minted. The distinction is the whole point of rule 1 below: an
 * encrypted database plus no key must fail loudly, and minting a fresh key
 * there would produce exactly the silent-empty-database outcome H-3 forbids.
 */
export function planDatabaseStartup(
  state: DatabaseDiskState,
  keyPresent: boolean,
): StartupPlan {
  const { main, candidate, backup } = state;

  // 1. Encrypted main we cannot unlock, but the pre-encryption original is
  // still here and needs no key at all. Declaring this unrecoverable was the
  // H-3 review's HIGH-1: it threw away a perfectly readable copy of the shop
  // and sent the owner to a server restore that cannot know about rows this
  // device never pushed.
  //
  // Safe because `.plainbak` only exists BEFORE the encrypted main has ever
  // been opened as the live database — db/client.ts releases it immediately
  // after that first successful open, with no application code in between. So
  // while it exists, the encrypted main holds nothing the backup lacks.
  if (main === 'encrypted' && !keyPresent && backup === 'plaintext') {
    return { action: 'restore-plaintext-backup', discardStaleCandidate: false };
  }

  // 2. Encrypted data we cannot unlock and no readable copy anywhere.
  // Loudest possible failure, zero writes.
  if (main === 'encrypted' && !keyPresent) {
    return { action: 'fail-unrecoverable', reason: 'encrypted-without-key', discardStaleCandidate: false };
  }

  // The backup slot holds the pre-encryption original and nothing else. An
  // encrypted file there means something outside this machine moved files
  // around; guessing would risk promoting the wrong one.
  if (backup === 'encrypted') {
    return { action: 'fail-unrecoverable', reason: 'corrupt-backup', discardStaleCandidate: false };
  }

  if (main === 'encrypted') {
    // A candidate alongside a finished encrypted main is a leftover from the
    // run that produced it — the main IS the promoted copy.
    return backup === 'plaintext'
      ? { action: 'finalize-previous-migration', discardStaleCandidate: candidate !== 'missing' }
      : { action: 'open-encrypted', discardStaleCandidate: candidate !== 'missing' };
  }

  if (main === 'plaintext') {
    // The live database is still plaintext, so it is by definition newer than
    // anything in the backup slot. Any candidate is from an aborted attempt.
    return { action: 'migrate-plaintext', discardStaleCandidate: candidate !== 'missing' };
  }

  // main === 'missing' from here down.

  if (backup === 'plaintext') {
    // Crashed between "rename original to .plainbak" and "promote candidate".
    // The original is intact; re-confirm a candidate against it and promote,
    // or restore the backup first and restart the migration.
    return { action: 'restore-backup-then-migrate', discardStaleCandidate: candidate !== 'missing' };
  }

  if (candidate !== 'missing') {
    // No main, no backup, but a candidate exists. Unreachable from this flow,
    // so we do not know what it is — and it may be the only copy of real data.
    // Preserve everything and make a human look.
    return { action: 'fail-unrecoverable', reason: 'orphan-candidate', discardStaleCandidate: false };
  }

  return { action: 'open-fresh', discardStaleCandidate: false };
}
