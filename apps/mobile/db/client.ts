import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  getDatabaseKeyHex,
  hasDatabaseKey,
  hasPendingDatabaseKeyRecovery,
} from './databaseKey';
import { createEncryptionEnvironment, openKeyedDatabase } from './encryptionEnvironment';
import { DATABASE_FILE_NAME } from './encryptionPlan';
import {
  prepareEncryptedDatabase,
  releaseCompletedRecoveryArtifacts,
  releaseVerifiedPlaintextBackup,
  type EncryptionEvent,
  type EncryptionOutcome,
} from './encryptionMigration';
import { DatabaseInitializationError, DatabaseNotReadyError } from './errors';
import * as schema from './schema';

/**
 * The local SQLite database file. This is the app's ONLY source of truth
 * (CLAUDE.md rule 1) — no screen ever reads from the network to decide what
 * to show. Since H-3 it is encrypted at rest with SQLCipher.
 */
const DATABASE_NAME = DATABASE_FILE_NAME;

interface InitializedDatabase {
  drizzle: ExpoSQLiteDatabase<typeof schema>;
  connection: SQLiteDatabase;
  encryption: EncryptionOutcome;
}

let initialized: InitializedDatabase | null = null;
let initialization: Promise<InitializedDatabase> | null = null;

/**
 * Prepares and opens the encrypted database. Must complete before anything
 * touches `db` or `sqliteConnection`.
 *
 * Before H-3 the connection was built at module-import time, which is no
 * longer possible: the SQLCipher key comes from the Android Keystore and that
 * is asynchronous. Both entry points therefore await this — app boot via
 * db/init.ts's useDatabaseMigrations, and the headless notification task in
 * native/notifications.ts.
 *
 * Concurrent callers share ONE attempt. That is not just an optimisation: two
 * parallel attempts could each decide to run the plaintext migration, and the
 * second would find the files mid-swap.
 *
 * Failed transient Keystore attempts are released so an explicit UI/headless
 * retry can make a new attempt. Data/key failures remain fail-closed.
 */
export async function ensureDatabaseReady(): Promise<void> {
  if (initialized !== null) {
    return;
  }
  initialization ??= initializeDatabase();
  try {
    await initialization;
  } catch (error) {
    // Every failed attempt closes any connection it opened. Releasing the
    // promise makes transient storage/I/O failures retryable; permanent data
    // failures remain fail-closed and simply reject again without data loss.
    initialization = null;
    throw error;
  }
}

async function initializeDatabase(): Promise<InitializedDatabase> {
  const environment = createEncryptionEnvironment(logEncryptionEvent);
  const preparation = await prepareEncryptedDatabase(environment, {
    hasKey: hasDatabaseKey,
    getKeyHex: getDatabaseKeyHex,
    hasPendingRecovery: hasPendingDatabaseKeyRecovery,
  });

  // `PRAGMA key` is applied inside openKeyedDatabase, as the first statement
  // on the connection. Everything below depends on it having succeeded.
  // prepareEncryptedDatabase has already opened and verified every existing
  // encrypted main. A failure here is a live-open/init failure, not evidence
  // that the key is unrecoverable; surface it unchanged so retry can reopen.
  let connection: SQLiteDatabase;
  try {
    connection = openConfiguredDatabase(DATABASE_NAME, preparation.keyHex);
  } catch {
    // SQLite/SQLCipher exceptions can include statement text. Never retain a
    // cause from a path whose first statement contains key material.
    throw new DatabaseInitializationError('live-open-failed');
  }

  try {
    if (preparation.releasePlaintextBackup) {
      releaseVerifiedPlaintextBackup(environment);
    }
    if (preparation.outcome === 'already-encrypted') {
      releaseCompletedRecoveryArtifacts(environment);
    }

    const instance = installDatabase(connection, preparation.outcome);
    initialized = instance;
    return instance;
  } catch (error) {
    try {
      connection.closeSync();
    } catch {
      // Preserve the initialization failure; the handle is never published.
    }
    throw error;
  }
}

function openConfiguredDatabase(fileName: string, keyHex: string): SQLiteDatabase {
  const connection = openKeyedDatabase(fileName, keyHex);

  // ── PRAGMAs — both are required, for different reasons ──────────────────
  //
  // journal_mode = WAL: crash-safe, allows concurrent read while writing. This
  // one is PERSISTENT — it is written into the database file itself, so it
  // survives restarts and only really needs setting once. Set here anyway so a
  // freshly created file is always correct.
  //
  // foreign_keys = ON: SQLite ships with foreign key enforcement OFF BY DEFAULT.
  // Without this line, every `onDelete` policy in schema.ts parses fine and
  // enforces NOTHING — ON DELETE RESTRICT would silently fail to protect
  // financial/audit history (CLAUDE.md rule 2). Unlike WAL, this setting is
  // PER-CONNECTION and resets to OFF every single time the database is opened,
  // which is exactly why it lives here in the open path and not in a migration.
  //
  // Both now run AFTER the key. On a SQLCipher build a page read before the
  // key is applied fails outright, so the old ordering would not survive.
  try {
    connection.execSync('PRAGMA journal_mode = WAL;');
    connection.execSync('PRAGMA foreign_keys = ON;');
    return connection;
  } catch (error) {
    connection.closeSync();
    throw error;
  }
}

function installDatabase(
  connection: SQLiteDatabase,
  encryption: EncryptionOutcome,
): InitializedDatabase {
  return {
    drizzle: drizzle(connection, { schema }),
    connection,
    encryption,
  };
}

/** Recovery-only: point db/ at an authenticated, isolated target file. */
export function initializeDatabaseFileForRecovery(fileName: string, keyHex: string): void {
  closeDatabaseForRecovery();
  let connection: SQLiteDatabase;
  try {
    connection = openConfiguredDatabase(fileName, keyHex);
  } catch {
    throw new DatabaseInitializationError('recovery-open-failed');
  }
  try {
    const instance = installDatabase(connection, 'fresh');
    initialized = instance;
    initialization = Promise.resolve(instance);
  } catch {
    try {
      connection.closeSync();
    } catch {
      // The failed handle is never published.
    }
    throw new DatabaseInitializationError('recovery-client-install-failed');
  }
}

/** Recovery-only: closes candidate/main before an atomic filename switch. */
export function closeDatabaseForRecovery(): void {
  const connection = initialized?.connection;
  initialized = null;
  initialization = null;
  connection?.closeSync();
}

function requireInitialized(): InitializedDatabase {
  if (initialized === null) {
    throw new DatabaseNotReadyError();
  }
  return initialized;
}

/**
 * Wraps the not-yet-existing handle so the call sites in db/ keep their
 * original `db.select(...)` / `sqliteConnection.getAllSync(...)` shape. The
 * alternative — threading an awaited handle through every function in db/ —
 * would have rewritten the whole directory for one initialization change, and
 * H-3 is not a refactor of the data layer.
 */
function lazyHandle<T extends object>(select: (instance: InitializedDatabase) => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const source = select(requireInitialized()) as Record<PropertyKey, unknown>;
      const value = Reflect.get(source, property);
      return typeof value === 'function' ? value.bind(source) : value;
    },
    has(_target, property) {
      return property in (select(requireInitialized()) as object);
    },
    ownKeys() {
      return Reflect.ownKeys(select(requireInitialized()) as object);
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(
        select(requireInitialized()) as object,
        property,
      );
      return descriptor && { ...descriptor, configurable: true };
    },
  });
}

/**
 * The Drizzle client. Everything that reads or writes SQLite goes through
 * this, and only from inside db/ (Volume 2: db/ is the ONLY code that imports
 * Drizzle or touches SQLite directly).
 *
 * Throws DatabaseNotReadyError until `ensureDatabaseReady()` has resolved.
 */
export const db = lazyHandle((instance) => instance.drizzle);

/** Escape hatch for raw SQL (FTS5 queries on Day 3, PRAGMA checks in tests). */
export const sqliteConnection = lazyHandle((instance) => instance.connection);

/**
 * What the startup encryption pass actually did. Diagnostic only — no screen
 * branches on it; it exists so a device check can distinguish a fresh
 * encrypted install from a completed upgrade.
 */
export function getDatabaseEncryptionOutcome(): EncryptionOutcome | null {
  return initialized?.encryption ?? null;
}

/**
 * Startup logging for the encryption pass.
 *
 * EncryptionEvent is a closed union carrying only an outcome and, on failure,
 * which check objected — no key material, no row contents, no phone or money
 * values. That shape is what makes it safe to forward to H-8 later.
 */
function logEncryptionEvent(event: EncryptionEvent): void {
  if (event.type === 'migration-rejected') {
    console.warn('[db] encryption migration rejected', event.failureCodes);
    return;
  }
  console.log('[db] encryption', event.type, 'action' in event ? event.action : '');
}

export { DATABASE_NAME };
