// H-3 review fixes, executed against real SQLite files.
//
// One describe per finding, so a regression names the finding it undid:
//   HIGH-1   an unreadable main prefers its readable plaintext original, and a
//            server recovery preserves that original instead of deleting it
//   HIGH-2   the steady-state open does no full-database scanning
//   MEDIUM-1 a failed promotion during resume rolls back and THROWS, and can
//            never restore the backup twice
//   MEDIUM-2 candidate cleanup is decided by the files, not by a test class
//   LOW-1    verification never writes to the plaintext safety backup
//
// Same honest limitation as the sibling migration suite: node:sqlite cannot
// produce SQLCipher ciphertext, so "encrypted" is modelled with a `.keymark`
// sidecar plus the observable contract (a keyed file classifies as encrypted;
// opening it with the wrong key throws). Real ciphertext is the device gate.

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  prepareEncryptedDatabase,
  preserveUnsyncedPlaintextBackup,
  type EncryptionEnvironment,
  type EncryptionEvent,
  type MigrationConnection,
} from './encryptionMigration';
import {
  CANDIDATE_FILE_NAME,
  DATABASE_FILE_NAME,
  LOCKED_DATABASE_BACKUP_FILE_NAME,
  PLAINTEXT_BACKUP_FILE_NAME,
  PRESERVED_PLAINTEXT_FILE_NAME,
} from './encryptionPlan';
import { DatabaseEncryptionMigrationError, DatabaseKeyUnrecoverableError } from './errors';

const KEY = 'ab'.repeat(32);
const OTHER_KEY = 'cd'.repeat(32);

let directory = '';
let events: EncryptionEvent[] = [];
let statements: string[] = [];

const filePath = (name: string) => join(directory, name);
const markPath = (name: string) => join(directory, `${name}.keymark`);

function markerKey(name: string): string | null {
  return existsSync(markPath(name)) ? readFileSync(markPath(name), 'utf8') : null;
}

function markEncrypted(name: string, keyHex: string): void {
  writeFileSync(markPath(name), keyHex);
}

function md5(name: string): string {
  return createHash('md5').update(readFileSync(filePath(name))).digest('hex');
}

/** A small but structurally real shop: FTS, a foreign key, and a ledger. */
function seed(name: string, medicine = 'Napa', stock = 40): void {
  const database = new DatabaseSync(filePath(name));
  database.exec(`
    CREATE TABLE medicines (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE batches (
      id TEXT PRIMARY KEY,
      medicine_id TEXT NOT NULL REFERENCES medicines(id) ON DELETE RESTRICT,
      stock INTEGER NOT NULL
    );
    CREATE TABLE inventory_movements (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
      change_qty INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE medicines_fts
      USING fts5(name, content='medicines', content_rowid='rowid');
    INSERT INTO medicines VALUES ('m1', '${medicine}'), ('m2', 'Seclo');
    INSERT INTO batches VALUES ('b1', 'm1', ${stock});
    INSERT INTO inventory_movements VALUES ('v1', 'b1', ${stock});
    INSERT INTO medicines_fts(medicines_fts) VALUES('rebuild');
  `);
  database.close();
}

function rowCount(name: string, table: string): number {
  const database = new DatabaseSync(filePath(name));
  const row = database.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as {
    value: number;
  };
  database.close();
  return Number(row.value);
}

function removeIfPresent(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

function deleteBoth(name: string): void {
  removeIfPresent(filePath(name));
  removeIfPresent(markPath(name));
}

interface Options {
  /** Refuse to open this exact file even when its key matches. */
  refuseOpenOf?: string;
}

/**
 * db/encryptionEnvironment.ts never returns a connection it has not read
 * from — `applyKeyAndProbe` forces a `sqlite_master` read so a wrong key or a
 * corrupt file fails AT OPEN. The double must do the same.
 */
function probe(database: DatabaseSync): DatabaseSync {
  try {
    database.prepare('SELECT count(*) AS value FROM sqlite_master').get();
  } catch (error) {
    try {
      database.close();
    } catch {
      // The open failure is the authoritative one.
    }
    throw error;
  }
  return database;
}

/** The double has to know which file a connection belongs to, because
 * sqlcipher_export copies the SOURCE connection, not some fixed file. */
interface TrackedConnection extends MigrationConnection {
  readonly sourceFile: string;
}

/** Records every statement the orchestrator issues, for the HIGH-2 check. */
function wrap(database: DatabaseSync, sourceFile: string): TrackedConnection {
  return {
    sourceFile,
    execSync: (sql: string) => {
      statements.push(sql);
      database.exec(sql);
    },
    getAllSync: <T,>(sql: string) => {
      statements.push(sql);
      return database.prepare(sql).all() as T[];
    },
    getFirstSync: <T,>(sql: string) => {
      statements.push(sql);
      return (database.prepare(sql).get() ?? null) as T | null;
    },
    // Async by contract — production closes asynchronously so the JS thread
    // stays free for the GC that finalizes statements (H-3 TEST stage).
    close: async () => database.close(),
  };
}

function createEnvironment(options: Options = {}): EncryptionEnvironment {
  return {
    exists: (name) => existsSync(filePath(name)),
    classify: (name) => {
      if (!existsSync(filePath(name))) return 'missing';
      const bytes = readFileSync(filePath(name));
      if (bytes.length === 0) return 'missing';
      if (markerKey(name) !== null) return 'encrypted';
      return bytes.subarray(0, 15).toString('utf8') === 'SQLite format 3'
        ? 'plaintext'
        : 'encrypted';
    },
    deleteFile: (name) => deleteBoth(name),
    deleteSidecars: (name) => {
      for (const suffix of ['-journal', '-wal', '-shm']) {
        deleteBoth(`${name}${suffix}`);
      }
    },
    rename: (from, to) => {
      // Mirrors the native Os.rename guards exactly.
      if (!existsSync(filePath(from))) {
        throw new Error('Database rename source is missing');
      }
      if (existsSync(filePath(to))) {
        throw new Error('Database rename target already exists');
      }
      renameSync(filePath(from), filePath(to));
      const key = markerKey(from);
      removeIfPresent(markPath(from));
      if (key !== null) markEncrypted(to, key);
    },
    openPlaintext: (name) => {
      if (markerKey(name) !== null) throw new Error('file is not a database');
      return wrap(probe(new DatabaseSync(filePath(name))), name);
    },
    openEncrypted: (name, keyHex) => {
      if (options.refuseOpenOf === name) throw new Error('file is not a database');
      if (markerKey(name) !== keyHex) throw new Error('file is not a database');
      return wrap(probe(new DatabaseSync(filePath(name))), name);
    },
    exportToEncrypted: (source, to, keyHex) => {
      deleteBoth(to);
      copyFileSync(filePath((source as TrackedConnection).sourceFile), filePath(to));
      // sqlcipher_export produces a database whose external-content FTS index
      // does not carry over; model that so the rebuild stays load-bearing.
      const copy = new DatabaseSync(filePath(to));
      copy.exec(`DELETE FROM medicines_fts_data WHERE id > 1`);
      copy.close();
      markEncrypted(to, keyHex);
    },
    log: (event) => events.push(event),
  };
}

const keys = { hasKey: async () => true, getKeyHex: async () => KEY };
const keysWithout = { hasKey: async () => false, getKeyHex: async () => KEY };

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'muthoy-h3-hardening-'));
  events = [];
  statements = [];
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('HIGH-1: an unreadable main prefers its readable plaintext original', () => {
  test('a main sealed with a lost key is rebuilt from the backup beside it', async () => {
    seed(DATABASE_FILE_NAME);
    copyFileSync(filePath(DATABASE_FILE_NAME), filePath(PLAINTEXT_BACKUP_FILE_NAME));
    markEncrypted(DATABASE_FILE_NAME, OTHER_KEY);

    const result = await prepareEncryptedDatabase(createEnvironment(), keysWithout);

    expect(result.outcome).toBe('migrated');
    expect(events.map((event) => event.type)).toContain('plaintext-backup-restored');
    // Every row survived, and the shop is usable again rather than "lost".
    expect(rowCount(DATABASE_FILE_NAME, 'inventory_movements')).toBe(1);
    expect(markerKey(DATABASE_FILE_NAME)).toBe(KEY);
  });

  test('the displaced unreadable main is archived, never deleted', async () => {
    seed(DATABASE_FILE_NAME);
    copyFileSync(filePath(DATABASE_FILE_NAME), filePath(PLAINTEXT_BACKUP_FILE_NAME));
    markEncrypted(DATABASE_FILE_NAME, OTHER_KEY);

    await prepareEncryptedDatabase(createEnvironment(), keysWithout);

    expect(existsSync(filePath(LOCKED_DATABASE_BACKUP_FILE_NAME))).toBe(true);
    expect(markerKey(LOCKED_DATABASE_BACKUP_FILE_NAME)).toBe(OTHER_KEY);
  });

  test('an unreadable backup changes nothing and still fails closed', async () => {
    seed(DATABASE_FILE_NAME);
    markEncrypted(DATABASE_FILE_NAME, OTHER_KEY);
    // Present, but not a database anyone can read.
    writeFileSync(filePath(PLAINTEXT_BACKUP_FILE_NAME), 'not a database at all');
    const mainBefore = md5(DATABASE_FILE_NAME);

    await expect(prepareEncryptedDatabase(createEnvironment(), keysWithout)).rejects.toBeInstanceOf(
      DatabaseKeyUnrecoverableError,
    );

    expect(md5(DATABASE_FILE_NAME)).toBe(mainBefore);
    expect(existsSync(filePath(PLAINTEXT_BACKUP_FILE_NAME))).toBe(true);
    expect(existsSync(filePath(LOCKED_DATABASE_BACKUP_FILE_NAME))).toBe(false);
  });

  test('an occupied archive slot refuses rather than overwriting a locked copy', async () => {
    seed(DATABASE_FILE_NAME);
    copyFileSync(filePath(DATABASE_FILE_NAME), filePath(PLAINTEXT_BACKUP_FILE_NAME));
    markEncrypted(DATABASE_FILE_NAME, OTHER_KEY);
    seed(LOCKED_DATABASE_BACKUP_FILE_NAME, 'Older');
    markEncrypted(LOCKED_DATABASE_BACKUP_FILE_NAME, OTHER_KEY);
    const archiveBefore = md5(LOCKED_DATABASE_BACKUP_FILE_NAME);

    await expect(prepareEncryptedDatabase(createEnvironment(), keysWithout)).rejects.toBeInstanceOf(
      DatabaseKeyUnrecoverableError,
    );

    expect(md5(LOCKED_DATABASE_BACKUP_FILE_NAME)).toBe(archiveBefore);
    expect(existsSync(filePath(PLAINTEXT_BACKUP_FILE_NAME))).toBe(true);
  });

  test('a backup that is not this database original keeps both copies', async () => {
    // The shape a server recovery leaves behind: main is the hydrated
    // database, the backup is an older plaintext original with its own rows.
    seed(DATABASE_FILE_NAME);
    markEncrypted(DATABASE_FILE_NAME, KEY);
    seed(PLAINTEXT_BACKUP_FILE_NAME, 'Older', 7);

    const result = await prepareEncryptedDatabase(createEnvironment(), keys);

    expect(result.outcome).toBe('already-encrypted');
    // Neither copy may be released: one is live, the other holds unsynced rows.
    expect(result.releasePlaintextBackup).toBe(false);
    expect(events.map((event) => event.type)).toContain('foreign-backup-retained');
    expect(existsSync(filePath(PLAINTEXT_BACKUP_FILE_NAME))).toBe(true);
    expect(rowCount(DATABASE_FILE_NAME, 'medicines')).toBe(2);
  });

  test('recovery preserves a superseded original encrypted, not deleted', async () => {
    seed(PLAINTEXT_BACKUP_FILE_NAME, 'Unsynced');
    seed(DATABASE_FILE_NAME);
    markEncrypted(DATABASE_FILE_NAME, KEY);

    const preserved = await preserveUnsyncedPlaintextBackup(createEnvironment(), KEY);

    expect(preserved).toBe(true);
    // The plaintext file is gone, but its rows are not.
    expect(existsSync(filePath(PLAINTEXT_BACKUP_FILE_NAME))).toBe(false);
    expect(existsSync(filePath(PRESERVED_PLAINTEXT_FILE_NAME))).toBe(true);
    expect(markerKey(PRESERVED_PLAINTEXT_FILE_NAME)).toBe(KEY);
    expect(rowCount(PRESERVED_PLAINTEXT_FILE_NAME, 'medicines')).toBe(2);
  });

  test('an occupied preserve slot keeps the plaintext rather than losing it', async () => {
    seed(PLAINTEXT_BACKUP_FILE_NAME, 'Unsynced');
    seed(DATABASE_FILE_NAME);
    markEncrypted(DATABASE_FILE_NAME, KEY);
    seed(PRESERVED_PLAINTEXT_FILE_NAME, 'EvenOlder');
    markEncrypted(PRESERVED_PLAINTEXT_FILE_NAME, KEY);
    const earlier = md5(PRESERVED_PLAINTEXT_FILE_NAME);

    expect(await preserveUnsyncedPlaintextBackup(createEnvironment(), KEY)).toBe(false);

    // Nothing overwritten, nothing dropped.
    expect(existsSync(filePath(PLAINTEXT_BACKUP_FILE_NAME))).toBe(true);
    expect(md5(PRESERVED_PLAINTEXT_FILE_NAME)).toBe(earlier);
  });
});

describe('HIGH-2: the steady-state open does no full-database scanning', () => {
  test('opening an already-encrypted database issues no verification SQL', async () => {
    seed(DATABASE_FILE_NAME);
    markEncrypted(DATABASE_FILE_NAME, KEY);

    const result = await prepareEncryptedDatabase(createEnvironment(), keys);

    expect(result.outcome).toBe('already-encrypted');
    // The key probe lives inside openEncrypted (the real one runs `PRAGMA key`
    // then a sqlite_master read). The orchestrator itself must add nothing on
    // this path — no scan whose cost grows with the shop's history.
    expect(statements).toEqual([]);
  });

  test('the expensive checks still run where there is something to compare', async () => {
    seed(DATABASE_FILE_NAME);

    await prepareEncryptedDatabase(createEnvironment(), keys);

    const issued = statements.join('\n');
    expect(issued).toContain('integrity_check');
    expect(issued).toContain('foreign_key_check');
  });
});

describe('MEDIUM-1: a failed promotion rolls back once and throws', () => {
  test('the promoted-reopen failure surfaces instead of being swallowed', async () => {
    // Crashed mid-swap: no main, a verified backup, and a matching candidate.
    seed(PLAINTEXT_BACKUP_FILE_NAME);
    copyFileSync(filePath(PLAINTEXT_BACKUP_FILE_NAME), filePath(CANDIDATE_FILE_NAME));
    markEncrypted(CANDIDATE_FILE_NAME, KEY);

    const rejection = await prepareEncryptedDatabase(
      createEnvironment({ refuseOpenOf: DATABASE_FILE_NAME }),
      keys,
    ).catch((error: unknown) => error);

    // Previously this throw was caught by a bare `catch {}`, and the code then
    // tried to restore a backup the rollback had already consumed — producing
    // an untyped "rename source is missing" instead of the real reason.
    expect(rejection).toBeInstanceOf(DatabaseEncryptionMigrationError);
    expect((rejection as DatabaseEncryptionMigrationError).step).toBe('promoted-reopen');
  });

  test('rollback leaves the plaintext original live and keeps the candidate', async () => {
    seed(PLAINTEXT_BACKUP_FILE_NAME);
    copyFileSync(filePath(PLAINTEXT_BACKUP_FILE_NAME), filePath(CANDIDATE_FILE_NAME));
    markEncrypted(CANDIDATE_FILE_NAME, KEY);

    await prepareEncryptedDatabase(
      createEnvironment({ refuseOpenOf: DATABASE_FILE_NAME }),
      keys,
    ).catch(() => undefined);

    // Exactly one restore happened: main is the readable original again.
    expect(existsSync(filePath(DATABASE_FILE_NAME))).toBe(true);
    expect(markerKey(DATABASE_FILE_NAME)).toBeNull();
    expect(rowCount(DATABASE_FILE_NAME, 'medicines')).toBe(2);
    // The independently verified candidate is preserved, not dropped.
    expect(existsSync(filePath(CANDIDATE_FILE_NAME))).toBe(true);
  });
});

describe('MEDIUM-2: candidate cleanup is decided by the files', () => {
  test('no production module mentions a test-only crash class', () => {
    const sources = [
      'apps/mobile/db/encryptionMigration.ts',
      'apps/mobile/db/encryptionPlan.ts',
      'apps/mobile/db/encryptionVerify.ts',
      'apps/mobile/db/encryptionEnvironment.ts',
      'apps/mobile/db/databaseRecovery.ts',
    ];
    for (const source of sources) {
      expect(readFileSync(source, 'utf8')).not.toContain('SimulatedCrash');
    }
  });

  test('a half-built candidate is dropped only while a plaintext main remains', async () => {
    seed(DATABASE_FILE_NAME);
    const environment = createEnvironment();
    const exploding: EncryptionEnvironment = {
      ...environment,
      exportToEncrypted: (source, to, keyHex) => {
        environment.exportToEncrypted(source, to, keyHex);
        throw new Error('export died partway');
      },
    };

    await expect(prepareEncryptedDatabase(exploding, keys)).rejects.toBeInstanceOf(
      DatabaseEncryptionMigrationError,
    );

    // The readable source is still there, so the candidate is disposable.
    expect(existsSync(filePath(CANDIDATE_FILE_NAME))).toBe(false);
    expect(rowCount(DATABASE_FILE_NAME, 'medicines')).toBe(2);
  });

  test('the candidate is kept when the main is no longer a plaintext source', async () => {
    seed(DATABASE_FILE_NAME);
    const environment = createEnvironment();
    const exploding: EncryptionEnvironment = {
      ...environment,
      exportToEncrypted: (source, to, keyHex) => {
        environment.exportToEncrypted(source, to, keyHex);
        // Model a process that lost the plaintext main mid-flight: the
        // candidate may now be the only copy and must survive.
        markEncrypted(DATABASE_FILE_NAME, OTHER_KEY);
        throw new Error('export died partway');
      },
    };

    await expect(prepareEncryptedDatabase(exploding, keys)).rejects.toBeInstanceOf(
      DatabaseEncryptionMigrationError,
    );

    expect(existsSync(filePath(CANDIDATE_FILE_NAME))).toBe(true);
  });
});

describe('LOW-1: verification never writes to the plaintext safety backup', () => {
  test('proving a stranded backup leaves its bytes untouched', async () => {
    seed(DATABASE_FILE_NAME);
    copyFileSync(filePath(DATABASE_FILE_NAME), filePath(PLAINTEXT_BACKUP_FILE_NAME));
    const backupBefore = md5(PLAINTEXT_BACKUP_FILE_NAME);

    const result = await prepareEncryptedDatabase(createEnvironment(), keys);

    expect(result.outcome).toBe('migrated');
    // The comparison rebuilt the CANDIDATE's FTS index, never the backup's.
    expect(md5(PLAINTEXT_BACKUP_FILE_NAME)).toBe(backupBefore);
  });
});

// H-3 TEST stage, on-device: a real migration on a real device reliably
// crashed in a background runtime thread (ART JIT compiler with a debuggable
// build; a Nitro `HybridData` finalizer without one) with zero app frames,
// always during or immediately after promotion. Root cause: promoting a
// freshly verified candidate re-ran the ENTIRE heavy comparison a second
// time against the very bytes that had just passed it under the candidate's
// name — doubling the synchronous native/SQL burst was enough to provoke a
// concurrent GC/finalizer race on that device's memory budget. rename(2) is
// atomic and cannot alter file content, so the fix is to stop re-proving
// what the rename could not have broken, not to chase the runtime crash.
describe('device promotion-phase stability: same-process promotion probes, does not re-verify', () => {
  test('a fresh migration does not re-run the full comparison after promoting', async () => {
    seed(DATABASE_FILE_NAME);

    const result = await prepareEncryptedDatabase(createEnvironment(), keys);

    expect(result.outcome).toBe('migrated');
    expect(rowCount(DATABASE_FILE_NAME, 'medicines')).toBe(2);
    // migratePlaintextDatabase's own work accounts for exactly three: the
    // plaintext source verified standalone before export, then source and
    // candidate again as part of their comparison. Promotion adding a fourth
    // would mean the redundant post-rename re-verification is back — with it
    // the doubled crash-prone burst that caused it on device.
    const integrityChecks = statements.filter((sql) => sql.includes('integrity_check'));
    expect(integrityChecks).toHaveLength(3);
  });

  test('a fresh migration promotion never reopens the backup a second time', async () => {
    seed(DATABASE_FILE_NAME);
    const base = createEnvironment();
    let backupOpens = 0;
    const environment: EncryptionEnvironment = {
      ...base,
      openPlaintext: (name) => {
        if (name === PLAINTEXT_BACKUP_FILE_NAME) backupOpens += 1;
        return base.openPlaintext(name);
      },
    };

    const result = await prepareEncryptedDatabase(environment, keys);

    expect(result.outcome).toBe('migrated');
    // The backup does not exist yet when migratePlaintextDatabase runs its
    // own verification; it is created by the rename inside promotion. The
    // only place that used to reopen it was the redundant post-rename
    // verifyCopies this fix removed from the same-process path.
    expect(backupOpens).toBe(0);
  });

  test('a same-process promotion still fails closed if the renamed file will not reopen', async () => {
    // Crashed mid-swap: no main, a verified backup, and a matching candidate.
    seed(PLAINTEXT_BACKUP_FILE_NAME);
    copyFileSync(filePath(PLAINTEXT_BACKUP_FILE_NAME), filePath(CANDIDATE_FILE_NAME));
    markEncrypted(CANDIDATE_FILE_NAME, KEY);

    const rejection = await prepareEncryptedDatabase(
      createEnvironment({ refuseOpenOf: DATABASE_FILE_NAME }),
      keys,
    ).catch((error: unknown) => error);

    // The lighter probe still fails closed exactly like the full check did:
    // rollback restores the original, the verified candidate is preserved,
    // and the real reason surfaces rather than a swallowed rename error.
    expect(rejection).toBeInstanceOf(DatabaseEncryptionMigrationError);
    expect((rejection as DatabaseEncryptionMigrationError).step).toBe('promoted-reopen');
    expect(markerKey(DATABASE_FILE_NAME)).toBeNull();
    expect(existsSync(filePath(CANDIDATE_FILE_NAME))).toBe(true);
  });

  test('a cross-boot inspection of a finished migration still runs the full comparison', async () => {
    // What a DIFFERENT, possibly-crashed process left behind: main already
    // encrypted, an untouched plaintext backup beside it. This path has no
    // guarantee that a rename just ran in this process, so it must keep the
    // full check the same-process path above no longer needs.
    seed(DATABASE_FILE_NAME);
    markEncrypted(DATABASE_FILE_NAME, KEY);
    copyFileSync(filePath(DATABASE_FILE_NAME), filePath(PLAINTEXT_BACKUP_FILE_NAME));

    const result = await prepareEncryptedDatabase(createEnvironment(), keys);

    expect(result.outcome).toBe('finalized');
    // verifyPromotedMain's own verifyStandalone(target), plus verifyCopies'
    // verifyStandalone(source) + verifyStandalone(target): three total.
    const integrityChecks = statements.filter((sql) => sql.includes('integrity_check'));
    expect(integrityChecks).toHaveLength(3);
  });
});
