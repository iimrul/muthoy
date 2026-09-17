// H-3, layer C: the copy -> verify -> swap, executed for real.
//
// This drives the SAME prepareEncryptedDatabase() the device runs, against
// REAL SQLite files in a temp directory, carrying REAL migrations 0000-0029
// and real seeded rows. Row preservation, the Drizzle journal, the ledger
// invariant, the FTS rebuild, the resume states and the rollback are all
// genuinely executed here rather than reasoned about.
//
// WHAT THIS DOES NOT PROVE — stated plainly, because the gap matters:
// node:sqlite cannot produce SQLCipher ciphertext. The environment below
// therefore MODELS the cipher's observable contract (a keyed file classifies
// as encrypted; opening it with the wrong key throws; opening it without a
// key throws) while the bytes on disk stay ordinary SQLite. Whether the file
// is genuinely unreadable without the key is the separate on-device gate:
// raw bytes must not begin "SQLite format 3", and no known medicine or
// customer value may appear in them.

import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import {
  prepareEncryptedDatabase,
  releaseVerifiedPlaintextBackup,
  type EncryptionEnvironment,
  type EncryptionEvent,
  type MigrationConnection,
} from './encryptionMigration';
import {
  CANDIDATE_FILE_NAME,
  LOCKED_DATABASE_BACKUP_FILE_NAME,
  DATABASE_FILE_NAME,
  PLAINTEXT_BACKUP_FILE_NAME,
  classifyDatabaseHeader,
  SQLITE_PLAINTEXT_HEADER,
  type DatabaseFileClass,
} from './encryptionPlan';
import { collectDatabaseFingerprint } from './encryptionVerify';
import { DatabaseEncryptionMigrationError, DatabaseKeyUnrecoverableError } from './errors';

// Real migrations against real files: a single case runs about a second, and
// the multi-boot resume cases run several. The 5s default is not enough and
// failing on it would read as a defect rather than a slow fixture.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const MIGRATIONS_DIR = 'apps/mobile/db/migrations';
const KEY = 'ab'.repeat(32);
const WRONG_KEY = 'cd'.repeat(32);

const SHOP_ID = '90000000-0000-4000-8000-000000000001';
const ROLE_ID = '90000000-0000-4000-8000-000000000002';
const OWNER_ID = '90000000-0000-4000-8000-000000000003';
const MEDICINE_A = '90000000-0000-4000-8000-00000000000a';
const MEDICINE_B = '90000000-0000-4000-8000-00000000000b';
const BATCH_A = '90000000-0000-4000-8000-0000000000aa';
const BATCH_B = '90000000-0000-4000-8000-0000000000bb';
const STAMP = '2026-09-01T10:00:00.000Z';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function journalEntries(): JournalEntry[] {
  const journal = JSON.parse(
    readFileSync(resolve(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: JournalEntry[] };
  return journal.entries;
}

/** Applies every shipped migration, then records them the way Drizzle does. */
function applyAllMigrations(database: DatabaseSync): void {
  database.exec('PRAGMA foreign_keys = ON;');
  const entries = journalEntries();
  for (const entry of entries) {
    database.exec(readFileSync(resolve(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8'));
  }
  database.exec(
    `CREATE TABLE IF NOT EXISTS __drizzle_migrations (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       hash text NOT NULL,
       created_at numeric
     )`,
  );
  const insert = database.prepare(
    'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
  );
  for (const entry of entries) {
    insert.run(entry.tag, entry.when);
  }
}

/**
 * A shop with money and stock in it. Batches start at zero and are driven up
 * by movements, because migration 0006's triggers are the only sanctioned way
 * stock changes — seeding an absolute would be rejected, which is the point.
 */
function seedShopData(database: DatabaseSync): void {
  database.exec(
    `INSERT INTO shops (id, owner_id, name, phone, plan, created_at, updated_at)
     VALUES ('${SHOP_ID}', '${OWNER_ID}', 'Encrypted Pharmacy', '01700000000', 'free', '${STAMP}', '${STAMP}')`,
  );
  database.exec(
    `INSERT INTO roles (id, shop_id, name, is_system, created_at, updated_at)
     VALUES ('${ROLE_ID}', '${SHOP_ID}', 'owner', 1, '${STAMP}', '${STAMP}')`,
  );
  database.exec(
    `INSERT INTO users (id, shop_id, role_id, name, phone, pin_hash, is_active, created_at, updated_at)
     VALUES ('${OWNER_ID}', '${SHOP_ID}', '${ROLE_ID}', 'Owner', '01700000000', 'bcrypt-hash', 1, '${STAMP}', '${STAMP}')`,
  );
  for (const [id, name, generic] of [
    [MEDICINE_A, 'Napa', 'Paracetamol'],
    [MEDICINE_B, 'Seclo', 'Omeprazole'],
  ]) {
    database.exec(
      `INSERT INTO medicines (id, shop_id, name, generic, unit_of_measure, threshold, created_at, updated_at)
       VALUES ('${id}', '${SHOP_ID}', '${name}', '${generic}', 'piece', 10, '${STAMP}', '${STAMP}')`,
    );
  }
  for (const [batchId, medicineId, batchNo] of [
    [BATCH_A, MEDICINE_A, 'A-1'],
    [BATCH_B, MEDICINE_B, 'B-1'],
  ]) {
    database.exec(
      `INSERT INTO batches (id, shop_id, medicine_id, batch_no, stock, purchase_price, sale_price, is_deleted, created_at, updated_at)
       VALUES ('${batchId}', '${SHOP_ID}', '${medicineId}', '${batchNo}', 0, 10000, 15000, 0, '${STAMP}', '${STAMP}')`,
    );
  }
  const movements: [string, string, number][] = [
    ['90000000-0000-4000-8000-0000000000c1', BATCH_A, 40],
    ['90000000-0000-4000-8000-0000000000c2', BATCH_A, -7],
    ['90000000-0000-4000-8000-0000000000c3', BATCH_B, 25],
  ];
  for (const [id, batchId, changeQty] of movements) {
    database.exec(
      `INSERT INTO inventory_movements (id, shop_id, batch_id, change_qty, reason, created_by, created_at, updated_at)
       VALUES ('${id}', '${SHOP_ID}', '${batchId}', ${changeQty}, 'purchase', '${OWNER_ID}', '${STAMP}', '${STAMP}')`,
    );
  }
}

// ── the environment ─────────────────────────────────────────────────────

let workspace: string;
let events: EncryptionEvent[] = [];
let hasKeyFlag = false;

function filePath(fileName: string): string {
  return join(workspace, fileName);
}

/**
 * Marks a file as "encrypted under this key".
 *
 * Stands in for SQLCipher's whole-file encryption, which node:sqlite cannot
 * do. What it faithfully reproduces is the behaviour the migration depends
 * on: the file classifies as encrypted, and only the matching key opens it.
 */
function keyMarkerPath(fileName: string): string {
  return join(workspace, `${fileName}.keymark`);
}

function markEncrypted(fileName: string, keyHex: string): void {
  writeFileSync(keyMarkerPath(fileName), keyHex, 'utf8');
}

function markerKey(fileName: string): string | null {
  const marker = keyMarkerPath(fileName);
  return existsSync(marker) ? readFileSync(marker, 'utf8') : null;
}

/**
 * Windows holds a lock on a SQLite file briefly after close, so an unlink that
 * immediately follows can fail with EBUSY. Android — where this code actually
 * runs — unlinks open files happily, so this retry is a property of the test
 * host and not something the production environment needs.
 */
function removeIfPresent(path: string): void {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!existsSync(path)) {
      return;
    }
    try {
      unlinkSync(path);
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'EBUSY' && code !== 'EPERM') {
        throw error;
      }
      // Busy-wait: the suite is synchronous inside the migration runner, so
      // there is no turn of the event loop available to yield to.
      const until = Date.now() + 25;
      while (Date.now() < until) {
        /* spin */
      }
    }
  }
  throw new Error(`could not remove ${path}`);
}

type RawConnection = MigrationConnection & { __raw: DatabaseSync };

/**
 * db/encryptionEnvironment.ts never hands back a connection it has not read
 * from: `applyKeyAndProbe` runs `SELECT count(*) FROM sqlite_master` so a
 * wrong key or a corrupt file fails AT OPEN rather than somewhere later. The
 * double has to do the same, or corruption production catches at the door
 * goes unnoticed here.
 */
function probeOrClose(database: DatabaseSync): DatabaseSync {
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

function wrapConnection(database: DatabaseSync): RawConnection {
  return {
    __raw: database,
    execSync: (sql: string) => database.exec(sql),
    getAllSync: <T,>(sql: string) => database.prepare(sql).all() as T[],
    getFirstSync: <T,>(sql: string) => (database.prepare(sql).get() ?? null) as T | null,
    // Async by contract — see MigrationConnection.close (H-3 TEST stage).
    close: async () => database.close(),
  };
}

/**
 * Copies every table and its rows into a new database, the way
 * `sqlcipher_export()` does.
 *
 * Order matters and mirrors the real thing: tables first, then data, then
 * indexes and triggers. Loading rows before 0006's ledger triggers exist is
 * what allows `batches.stock` to arrive at its real value instead of being
 * rejected — sqlcipher_export copies rows without firing triggers for the
 * same reason.
 *
 * FTS5 shadow tables are deliberately NOT copied. Creating the virtual table
 * recreates them empty, which is exactly the state that makes
 * rebuildMedicinesFts() necessary rather than decorative.
 */
function exportRows(source: DatabaseSync, targetPath: string): void {
  // Off for the duration of the copy: sqlite_master order is not dependency
  // order, so a child table is routinely written before its parent. The real
  // sqlcipher_export() copies content without enforcing constraints for the
  // same reason — the integrity it preserves is the source's, already proven.
  source.exec('PRAGMA foreign_keys = OFF');
  source.exec(`ATTACH DATABASE '${targetPath.replace(/'/g, "''")}' AS target`);
  try {
    const objects = source
      .prepare(
        `SELECT type, name, sql FROM sqlite_master
         WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`,
      )
      .all() as unknown as { type: string; name: string; sql: string }[];

    const isFtsShadow = (name: string) => /_fts(_data|_idx|_docsize|_config|_content)$/.test(name);
    const isVirtual = (sql: string) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(sql);

    const tables = objects.filter((object) => object.type === 'table' && !isFtsShadow(object.name));
    const rest = objects.filter((object) => object.type !== 'table' && !isFtsShadow(object.name));

    for (const table of tables) {
      source.exec(table.sql.replace(/^(\s*CREATE\s+(?:VIRTUAL\s+)?TABLE\s+)/i, '$1target.'));
    }
    for (const table of tables) {
      if (isVirtual(table.sql)) {
        continue; // rebuilt from content, never copied
      }
      source.exec(`INSERT INTO target."${table.name}" SELECT * FROM main."${table.name}"`);
    }
    for (const object of rest) {
      source.exec(
        object.sql.replace(
          /^(\s*CREATE\s+(?:UNIQUE\s+)?(?:INDEX|TRIGGER|VIEW)\s+)/i,
          '$1target.',
        ),
      );
    }
  } finally {
    source.exec('DETACH DATABASE target');
    source.exec('PRAGMA foreign_keys = ON');
  }
}

interface EnvironmentOptions {
  /** Corrupts the candidate right after export, to exercise rollback. */
  damageCandidate?: (candidatePath: string) => void;
  /** Stops the run at a chosen point, modelling process death. */
  crashAfter?: 'export' | 'first-rename';
  /** Refuses only the post-promotion main reopen. */
  failPromotedOpen?: boolean;
}

class SimulatedCrash extends Error {}

function createEnvironment(options: EnvironmentOptions = {}): EncryptionEnvironment {
  let renames = 0;
  return {
    exists(fileName) {
      return existsSync(filePath(fileName));
    },
    classify(fileName): DatabaseFileClass {
      const path = filePath(fileName);
      if (!existsSync(path)) {
        return 'missing';
      }
      if (markerKey(fileName) !== null) {
        return 'encrypted';
      }
      const buffer = readFileSync(path).subarray(0, SQLITE_PLAINTEXT_HEADER.length);
      return classifyDatabaseHeader(new Uint8Array(buffer));
    },
    deleteFile(fileName) {
      removeIfPresent(filePath(fileName));
      removeIfPresent(keyMarkerPath(fileName));
    },
    deleteSidecars(fileName) {
      removeIfPresent(filePath(`${fileName}-journal`));
      removeIfPresent(filePath(`${fileName}-wal`));
      removeIfPresent(filePath(`${fileName}-shm`));
    },
    rename(fromFileName, toFileName) {
      const fromKey = markerKey(fromFileName);
      writeFileSync(filePath(toFileName), readFileSync(filePath(fromFileName)));
      removeIfPresent(filePath(fromFileName));
      removeIfPresent(keyMarkerPath(fromFileName));
      if (fromKey !== null) {
        markEncrypted(toFileName, fromKey);
      }
      renames += 1;
      if (options.crashAfter === 'first-rename' && renames === 1) {
        throw new SimulatedCrash('process died between the renames');
      }
    },
    openPlaintext(fileName) {
      if (markerKey(fileName) !== null) {
        throw new Error('file is not a database');
      }
      return wrapConnection(probeOrClose(new DatabaseSync(filePath(fileName))));
    },
    openEncrypted(fileName, keyHex) {
      if (options.failPromotedOpen && fileName === DATABASE_FILE_NAME) {
        throw new Error('promoted open failed');
      }
      const stored = markerKey(fileName);
      if (stored === null || stored !== keyHex) {
        // SQLCipher's actual symptom for a wrong or absent key.
        throw new Error('file is not a database');
      }
      return wrapConnection(probeOrClose(new DatabaseSync(filePath(fileName))));
    },
    exportToEncrypted(source, toFileName, keyHex) {
      const targetPath = filePath(toFileName);
      removeIfPresent(targetPath);
      removeIfPresent(keyMarkerPath(toFileName));
      exportRows((source as RawConnection).__raw, targetPath);
      markEncrypted(toFileName, keyHex);
      options.damageCandidate?.(targetPath);
      if (options.crashAfter === 'export') {
        throw new SimulatedCrash('process died after the export');
      }
    },
    log(event) {
      events.push(event);
    },
  };
}

const keys = {
  hasKey: async () => hasKeyFlag,
  getKeyHex: async () => KEY,
};

function openRaw(fileName: string): DatabaseSync {
  return new DatabaseSync(filePath(fileName));
}

function rowCount(database: DatabaseSync, table: string): number {
  return Number(
    (database.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as unknown as { c: number }).c,
  );
}

// Applying thirty migrations and seeding takes seconds; doing it per test
// dominated the suite. The fixture is deterministic, so it is built once and
// each test gets a byte copy — the same starting state, a fraction of the cost.
let templateDirectory: string;
let templatePath: string;

beforeAll(() => {
  templateDirectory = mkdtempSync(join(tmpdir(), 'muthoy-h3-template-'));
  templatePath = join(templateDirectory, DATABASE_FILE_NAME);
  const database = new DatabaseSync(templatePath);
  applyAllMigrations(database);
  seedShopData(database);
  // Fold the WAL in so the copied file is self-contained.
  database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  database.close();
});

afterAll(() => {
  rmSync(templateDirectory, { recursive: true, force: true });
});

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'muthoy-h3-'));
  events = [];
  hasKeyFlag = false;
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 });
});

/** Builds the pre-H-3 device: a populated plaintext muthoy.db. */
function givenPlaintextDatabaseWithData(): void {
  copyFileSync(templatePath, filePath(DATABASE_FILE_NAME));
}

describe('fresh install', () => {
  test('no database on disk mints a key and reports a fresh start', async () => {
    const result = await prepareEncryptedDatabase(createEnvironment(), keys);

    expect(result.outcome).toBe('fresh');
    expect(result.keyHex).toBe(KEY);
    expect(existsSync(filePath(PLAINTEXT_BACKUP_FILE_NAME))).toBe(false);
  });
});

describe('migrating a populated plaintext database', () => {
  beforeEach(() => {
    givenPlaintextDatabaseWithData();
  });

  test('completes and leaves the encrypted database in place', async () => {
    const result = await prepareEncryptedDatabase(createEnvironment(), keys);

    expect(result.outcome).toBe('migrated');
    expect(markerKey(DATABASE_FILE_NAME)).toBe(KEY);
    expect(existsSync(filePath(CANDIDATE_FILE_NAME))).toBe(false);
  });

  test('retains the plaintext original as .plainbak', async () => {
    await prepareEncryptedDatabase(createEnvironment(), keys);

    expect(existsSync(filePath(PLAINTEXT_BACKUP_FILE_NAME))).toBe(true);
    expect(markerKey(PLAINTEXT_BACKUP_FILE_NAME)).toBeNull();
    expect(events.map((event) => event.type)).toContain('backup-retained');
  });

  test('preserves every row of every table', async () => {
    const before = openRaw(DATABASE_FILE_NAME);
    const sourceFingerprint = collectDatabaseFingerprint(wrapConnection(before));
    before.close();

    await prepareEncryptedDatabase(createEnvironment(), keys);

    const after = openRaw(DATABASE_FILE_NAME);
    const targetFingerprint = collectDatabaseFingerprint(wrapConnection(after));
    after.close();

    expect(targetFingerprint.tables).toEqual(sourceFingerprint.tables);
  });

  test('preserves the shop, user, medicine, batch and movement rows specifically', async () => {
    await prepareEncryptedDatabase(createEnvironment(), keys);

    const database = openRaw(DATABASE_FILE_NAME);
    expect(rowCount(database, 'shops')).toBe(1);
    expect(rowCount(database, 'users')).toBe(1);
    expect(rowCount(database, 'medicines')).toBe(2);
    expect(rowCount(database, 'batches')).toBe(2);
    expect(rowCount(database, 'inventory_movements')).toBe(3);
    expect(
      (
        database.prepare(`SELECT name FROM shops WHERE id = '${SHOP_ID}'`).get() as unknown as {
          name: string;
        }
      ).name,
    ).toBe('Encrypted Pharmacy');
    database.close();
  });

  test('preserves the Drizzle migration journal', async () => {
    const expected = journalEntries();

    await prepareEncryptedDatabase(createEnvironment(), keys);

    const database = openRaw(DATABASE_FILE_NAME);
    const actual = database
      .prepare(`SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY id`)
      .all() as unknown as { hash: string; createdAt: number }[];
    database.close();

    expect(actual).toEqual(expected.map((entry) => ({ hash: entry.tag, createdAt: entry.when })));
  });

  test('preserves the ledger invariant: stock equals the sum of movements', async () => {
    await prepareEncryptedDatabase(createEnvironment(), keys);

    const database = openRaw(DATABASE_FILE_NAME);
    const fingerprint = collectDatabaseFingerprint(wrapConnection(database));

    expect(fingerprint.ledgerMismatchCount).toBe(0);
    const batchTotal = database.prepare(`SELECT SUM(stock) AS value FROM batches`).get() as unknown as {
      value: number;
    };
    const movementTotal = database
      .prepare(`SELECT SUM(change_qty) AS value FROM inventory_movements`)
      .get() as unknown as { value: number };
    expect(batchTotal.value).toBe(58); // 40 - 7 + 25
    expect(movementTotal.value).toBe(58);
    expect(
      (
        database.prepare(`SELECT stock FROM batches WHERE id = '${BATCH_A}'`).get() as unknown as {
          stock: number;
        }
      ).stock,
    ).toBe(33);
    database.close();
  });

  test('rebuilds the FTS index so search still returns hits', async () => {
    await prepareEncryptedDatabase(createEnvironment(), keys);

    const database = openRaw(DATABASE_FILE_NAME);
    const hits = database
      .prepare(`SELECT name FROM medicines_fts WHERE medicines_fts MATCH 'Napa'`)
      .all() as unknown as { name: string }[];
    database.close();

    expect(hits.map((hit) => hit.name)).toContain('Napa');
  });

  test('the retained backup is still a readable plaintext database', async () => {
    await prepareEncryptedDatabase(createEnvironment(), keys);

    const backup = openRaw(PLAINTEXT_BACKUP_FILE_NAME);
    expect(rowCount(backup, 'inventory_movements')).toBe(3);
    backup.close();
  });
});

describe('verification failure leaves the original untouched', () => {
  beforeEach(() => {
    givenPlaintextDatabaseWithData();
  });

  test('a candidate that lost rows is rejected and deleted', async () => {
    const environment = createEnvironment({
      damageCandidate: (candidatePath) => {
        const candidate = new DatabaseSync(candidatePath);
        // FK off: batches reference medicines with a restrict policy, so the
        // delete would otherwise fail here and the run would abort during
        // EXPORT — never reaching the verification step this test is about.
        candidate.exec('PRAGMA foreign_keys = OFF');
        // The FTS triggers must go too. The candidate's external-content
        // index is deliberately empty until rebuildMedicinesFts() runs, and
        // deleting a row that the index does not know about corrupts it
        // ("database disk image is malformed") — again failing at EXPORT
        // rather than at the verification this test is written to reach.
        candidate.exec('DROP TRIGGER IF EXISTS medicines_fts_delete');
        candidate.exec('DROP TRIGGER IF EXISTS medicines_fts_update');
        candidate.exec('DROP TRIGGER IF EXISTS medicines_fts_insert');
        candidate.exec('DELETE FROM medicines');
        candidate.close();
      },
    });

    const rejection = await prepareEncryptedDatabase(environment, keys).catch(
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(DatabaseEncryptionMigrationError);
    // Pinned to the verification step: an export-stage failure would also be a
    // DatabaseEncryptionMigrationError, and would silently stop this test from
    // exercising the rollback it exists to prove.
    expect((rejection as DatabaseEncryptionMigrationError).step).toBe('verification');

    // The original is still the live, plaintext, complete database.
    expect(markerKey(DATABASE_FILE_NAME)).toBeNull();
    const database = openRaw(DATABASE_FILE_NAME);
    expect(rowCount(database, 'medicines')).toBe(2);
    expect(rowCount(database, 'inventory_movements')).toBe(3);
    database.close();

    expect(existsSync(filePath(CANDIDATE_FILE_NAME))).toBe(false);
    expect(existsSync(filePath(PLAINTEXT_BACKUP_FILE_NAME))).toBe(false);
  });

  test('the rejection names the check that failed', async () => {
    const environment = createEnvironment({
      damageCandidate: (candidatePath) => {
        const candidate = new DatabaseSync(candidatePath);
        // FK off: batches reference medicines with a restrict policy, so the
        // delete would otherwise fail here and the run would abort during
        // EXPORT — never reaching the verification step this test is about.
        candidate.exec('PRAGMA foreign_keys = OFF');
        // The FTS triggers must go too. The candidate's external-content
        // index is deliberately empty until rebuildMedicinesFts() runs, and
        // deleting a row that the index does not know about corrupts it
        // ("database disk image is malformed") — again failing at EXPORT
        // rather than at the verification this test is written to reach.
        candidate.exec('DROP TRIGGER IF EXISTS medicines_fts_delete');
        candidate.exec('DROP TRIGGER IF EXISTS medicines_fts_update');
        candidate.exec('DROP TRIGGER IF EXISTS medicines_fts_insert');
        candidate.exec('DELETE FROM medicines');
        candidate.close();
      },
    });

    await expect(prepareEncryptedDatabase(environment, keys)).rejects.toThrow(/row-count/);
  });

  test('a candidate whose ledger disagrees is rejected', async () => {
    const environment = createEnvironment({
      damageCandidate: (candidatePath) => {
        const candidate = new DatabaseSync(candidatePath);
        // Drop a movement without touching the projection: exactly the shape
        // of a truncated copy.
        candidate.exec('PRAGMA foreign_keys = OFF');
        candidate.exec(`DROP TRIGGER IF EXISTS inventory_movement_is_undeletable`);
        candidate.exec(`DELETE FROM inventory_movements WHERE batch_id = '${BATCH_B}'`);
        candidate.close();
      },
    });

    await expect(prepareEncryptedDatabase(environment, keys)).rejects.toThrow(/ledger-invariant/);

    const database = openRaw(DATABASE_FILE_NAME);
    expect(rowCount(database, 'inventory_movements')).toBe(3);
    database.close();
  });

  test('same-count row payload corruption is rejected', async () => {
    const environment = createEnvironment({
      damageCandidate: (candidatePath) => {
        const candidate = new DatabaseSync(candidatePath);
        candidate.exec(`UPDATE shops SET name = 'Different payload' WHERE id = '${SHOP_ID}'`);
        candidate.close();
      },
    });

    await expect(prepareEncryptedDatabase(environment, keys)).rejects.toThrow(/row-payload/);
    expect(markerKey(DATABASE_FILE_NAME)).toBeNull();
  });

  test('missing schema objects are rejected', async () => {
    const environment = createEnvironment({
      damageCandidate: (candidatePath) => {
        const candidate = new DatabaseSync(candidatePath);
        candidate.exec(`DROP INDEX audit_logs_shop_idx`);
        candidate.close();
      },
    });

    await expect(prepareEncryptedDatabase(environment, keys)).rejects.toThrow(/schema-mismatch/);
  });

  test('same-count migration journal payload corruption is rejected', async () => {
    const environment = createEnvironment({
      damageCandidate: (candidatePath) => {
        const candidate = new DatabaseSync(candidatePath);
        candidate.exec(`UPDATE __drizzle_migrations SET hash = 'altered' WHERE id = 1`);
        candidate.close();
      },
    });

    await expect(prepareEncryptedDatabase(environment, keys)).rejects.toThrow(/row-payload/);
  });
});

describe('crash and resume', () => {
  test('zero-byte Expo placeholders do not block the atomic no-overwrite swap', async () => {
    givenPlaintextDatabaseWithData();
    writeFileSync(filePath(PLAINTEXT_BACKUP_FILE_NAME), '');

    const result = await prepareEncryptedDatabase(createEnvironment(), keys);

    expect(result.outcome).toBe('migrated');
    expect(markerKey(DATABASE_FILE_NAME)).toBe(KEY);
    expect(existsSync(filePath(PLAINTEXT_BACKUP_FILE_NAME))).toBe(true);
  });

  test('a crash after export leaves the original intact, and the retry succeeds', async () => {
    givenPlaintextDatabaseWithData();

    await expect(
      prepareEncryptedDatabase(createEnvironment({ crashAfter: 'export' }), keys),
    ).rejects.toBeInstanceOf(Error);

    // Original still plaintext and complete; a candidate is stranded.
    expect(markerKey(DATABASE_FILE_NAME)).toBeNull();

    // Next boot.
    const result = await prepareEncryptedDatabase(createEnvironment(), keys);

    expect(result.outcome).toBe('migrated');
    const database = openRaw(DATABASE_FILE_NAME);
    expect(rowCount(database, 'inventory_movements')).toBe(3);
    database.close();
  });

  test('stale rollback-journal and WAL sidecars are cleaned with the candidate', async () => {
    givenPlaintextDatabaseWithData();
    copyFileSync(templatePath, filePath(CANDIDATE_FILE_NAME));
    markEncrypted(CANDIDATE_FILE_NAME, KEY);
    writeFileSync(filePath(`${CANDIDATE_FILE_NAME}-journal`), 'stale');
    writeFileSync(filePath(`${CANDIDATE_FILE_NAME}-wal`), 'stale');

    await prepareEncryptedDatabase(createEnvironment(), keys);

    expect(existsSync(filePath(`${CANDIDATE_FILE_NAME}-journal`))).toBe(false);
    expect(existsSync(filePath(`${CANDIDATE_FILE_NAME}-wal`))).toBe(false);
  });

  test('a crash between the renames is recovered from the backup', async () => {
    givenPlaintextDatabaseWithData();

    await expect(
      prepareEncryptedDatabase(createEnvironment({ crashAfter: 'first-rename' }), keys),
    ).rejects.toBeInstanceOf(Error);

    // Mid-swap: main is gone, the original is sitting in .plainbak.
    expect(existsSync(filePath(DATABASE_FILE_NAME))).toBe(false);
    expect(existsSync(filePath(PLAINTEXT_BACKUP_FILE_NAME))).toBe(true);

    const result = await prepareEncryptedDatabase(createEnvironment(), keys);

    expect(result.outcome).toBe('migrated');
    const database = openRaw(DATABASE_FILE_NAME);
    expect(rowCount(database, 'medicines')).toBe(2);
    expect(rowCount(database, 'inventory_movements')).toBe(3);
    database.close();
  });

  test('migration does not run twice: the second boot finalizes instead', async () => {
    givenPlaintextDatabaseWithData();
    await prepareEncryptedDatabase(createEnvironment(), keys);

    hasKeyFlag = true;
    events = [];
    const second = await prepareEncryptedDatabase(createEnvironment(), keys);

    expect(second.outcome).toBe('finalized');
    expect(events.map((event) => event.type)).not.toContain('migration-started');
  });

  test('the backup is released only after the live encrypted reopen succeeds', async () => {
    givenPlaintextDatabaseWithData();
    const environment = createEnvironment();
    const result = await prepareEncryptedDatabase(environment, keys);
    expect(result.releasePlaintextBackup).toBe(true);
    expect(existsSync(filePath(PLAINTEXT_BACKUP_FILE_NAME))).toBe(true);
    releaseVerifiedPlaintextBackup(environment);
    expect(existsSync(filePath(PLAINTEXT_BACKUP_FILE_NAME))).toBe(false);
    expect(events.map((event) => event.type)).toContain('backup-released');
  });

  test('a third boot is an ordinary open', async () => {
    givenPlaintextDatabaseWithData();
    await prepareEncryptedDatabase(createEnvironment(), keys);
    hasKeyFlag = true;
    const secondEnvironment = createEnvironment();
    const second = await prepareEncryptedDatabase(secondEnvironment, keys);
    releaseVerifiedPlaintextBackup(secondEnvironment);
    expect(second.releasePlaintextBackup).toBe(true);

    events = [];
    const third = await prepareEncryptedDatabase(createEnvironment(), keys);

    expect(third.outcome).toBe('already-encrypted');
    expect(events.map((event) => event.type)).not.toContain('migration-started');
  });

  test('a main that will not open is rebuilt from its plaintext original', async () => {
    givenPlaintextDatabaseWithData();
    await prepareEncryptedDatabase(createEnvironment(), keys);

    // The device comes back with a different key than the one that sealed it.
    const wrongKeys = { hasKey: async () => true, getKeyHex: async () => WRONG_KEY };

    const result = await prepareEncryptedDatabase(createEnvironment(), wrongKeys);

    // H-3 review HIGH-1. This state used to be declared unrecoverable while a
    // perfectly readable copy of the shop sat right beside it.
    expect(result.outcome).toBe('migrated');
    expect(markerKey(DATABASE_FILE_NAME)).toBe(WRONG_KEY);
    // The unreadable original is archived, never deleted.
    expect(existsSync(filePath(LOCKED_DATABASE_BACKUP_FILE_NAME))).toBe(true);
    expect(existsSync(filePath(PLAINTEXT_BACKUP_FILE_NAME))).toBe(true);
  });

  test('failed promoted reopen restores main and preserves verified candidate', async () => {
    givenPlaintextDatabaseWithData();

    await expect(
      prepareEncryptedDatabase(createEnvironment({ failPromotedOpen: true }), keys),
    ).rejects.toThrow(/promoted-open-failed/);

    expect(markerKey(DATABASE_FILE_NAME)).toBeNull();
    expect(markerKey(CANDIDATE_FILE_NAME)).toBe(KEY);
    expect(existsSync(filePath(PLAINTEXT_BACKUP_FILE_NAME))).toBe(false);
    const database = openRaw(DATABASE_FILE_NAME);
    expect(rowCount(database, 'inventory_movements')).toBe(3);
    database.close();
  });
});

describe('the missing-key path never replaces data', () => {
  test('an encrypted database with no key and no readable copy refuses and touches nothing', async () => {
    givenPlaintextDatabaseWithData();
    const firstEnvironment = createEnvironment();
    await prepareEncryptedDatabase(firstEnvironment, keys);
    releaseVerifiedPlaintextBackup(firstEnvironment);
    const sealedBytes = readFileSync(filePath(DATABASE_FILE_NAME));

    // Keystore wiped: ciphertext survives, the key does not.
    hasKeyFlag = false;

    await expect(prepareEncryptedDatabase(createEnvironment(), keys)).rejects.toBeInstanceOf(
      DatabaseKeyUnrecoverableError,
    );

    expect(existsSync(filePath(DATABASE_FILE_NAME))).toBe(true);
    expect(readFileSync(filePath(DATABASE_FILE_NAME))).toEqual(sealedBytes);
    expect(markerKey(DATABASE_FILE_NAME)).toBe(KEY);
  });

  test('the refusal happens before any file is written', async () => {
    givenPlaintextDatabaseWithData();
    const firstEnvironment = createEnvironment();
    await prepareEncryptedDatabase(firstEnvironment, keys);
    releaseVerifiedPlaintextBackup(firstEnvironment);
    hasKeyFlag = false;
    events = [];

    await expect(prepareEncryptedDatabase(createEnvironment(), keys)).rejects.toThrow();

    expect(events.map((event) => event.type)).not.toContain('stale-candidate-discarded');
    expect(events.map((event) => event.type)).not.toContain('migration-started');
  });

  test('wrong-key open does not discard a stranded encrypted candidate', async () => {
    givenPlaintextDatabaseWithData();
    const firstEnvironment = createEnvironment();
    await prepareEncryptedDatabase(firstEnvironment, keys);
    releaseVerifiedPlaintextBackup(firstEnvironment);
    copyFileSync(filePath(DATABASE_FILE_NAME), filePath(CANDIDATE_FILE_NAME));
    markEncrypted(CANDIDATE_FILE_NAME, KEY);
    hasKeyFlag = true;
    const wrongKeys = { hasKey: async () => true, getKeyHex: async () => WRONG_KEY };

    await expect(prepareEncryptedDatabase(createEnvironment(), wrongKeys)).rejects.toThrow();

    expect(markerKey(CANDIDATE_FILE_NAME)).toBe(KEY);
    expect(markerKey(DATABASE_FILE_NAME)).toBe(KEY);
  });

  test('a corrupt encrypted main fails closed without replacement', async () => {
    givenPlaintextDatabaseWithData();
    const firstEnvironment = createEnvironment();
    await prepareEncryptedDatabase(firstEnvironment, keys);
    releaseVerifiedPlaintextBackup(firstEnvironment);
    const corruptBytes = Buffer.from('corrupt-ciphertext');
    writeFileSync(filePath(DATABASE_FILE_NAME), corruptBytes);
    hasKeyFlag = true;

    await expect(prepareEncryptedDatabase(createEnvironment(), keys)).rejects.toThrow();

    expect(readFileSync(filePath(DATABASE_FILE_NAME))).toEqual(corruptBytes);
    expect(existsSync(filePath(PLAINTEXT_BACKUP_FILE_NAME))).toBe(false);
  });
});
