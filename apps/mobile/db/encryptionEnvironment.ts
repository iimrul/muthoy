// db/encryptionEnvironment.ts — H-3, the only place the encryption machinery
// touches the real filesystem and the real SQLCipher build.
//
// Everything decision-shaped lives in encryptionPlan.ts / encryptionVerify.ts
// / encryptionMigration.ts and is unit-tested. This file is deliberately thin
// and mechanical, because it is the part that can only be exercised on a
// device.

import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { atomicRenameDatabaseFileNative } from '../modules/muthoy-db-key';
import { buildKeyPragma } from './databaseKey';
import {
  classifyDatabaseHeader,
  SQLITE_PLAINTEXT_HEADER,
  type DatabaseFileClass,
} from './encryptionPlan';
import type {
  EncryptionEnvironment,
  EncryptionEvent,
  MigrationConnection,
} from './encryptionMigration';

/** expo-sqlite resolves bare database names against `<document>/SQLite`. */
const SQLITE_DIRECTORY = 'SQLite';

/**
 * Open options for the SHORT-LIVED migration/recovery connections only. The
 * app's live connection (openKeyedDatabase) keeps expo-sqlite's defaults.
 *
 * `useNewConnection` keeps these out of expo-sqlite's by-name cache so one can
 * never be handed back later as the app's live connection.
 *
 * `finalizeUnusedStatementsBeforeClosing: false` is the H-3 close fix.
 * expo-sqlite's `closeDatabase` runs `sqlite3_finalize_all_statement()` — a
 * walk over every statement still registered on the connection — BEFORE
 * `sqlite3_close()`. On device that walk never returned for the written,
 * encrypted, checkpointed candidate: first as a permanent 100%-CPU spin on the
 * JS thread, then, once the close was made async, as an uninterruptible block
 * on a coroutine worker that ART eventually aborted the process over. Skipping
 * it goes straight to `sqlite3_close()`. Verification is read-mostly and every
 * statement it issues is already consumed, so there is nothing these
 * connections need that walk to clean up; if SQLite still considers one busy,
 * close reports it and `closeQuietly` keeps the original error authoritative.
 */
const MIGRATION_OPEN_OPTIONS = {
  useNewConnection: true,
  finalizeUnusedStatementsBeforeClosing: false,
} as const;

function databaseDirectory(): Directory {
  return new Directory(Paths.document, SQLITE_DIRECTORY);
}

function databaseFile(fileName: string): File {
  return new File(databaseDirectory(), fileName);
}

/**
 * SQLite's `ATTACH` takes a filesystem path, not a `file://` URI. Percent
 * decoding matters because the document directory contains the app's package
 * path, which the URI form escapes.
 */
function filesystemPath(file: File): string {
  return decodeURIComponent(file.uri.replace(/^file:\/\//, ''));
}

function readLeadingBytes(file: File, length: number): Uint8Array | null {
  if (!file.exists) {
    return null;
  }
  const handle = file.open(FileMode.ReadOnly);
  try {
    return handle.readBytes(length);
  } finally {
    handle.close();
  }
}

function deleteIfPresent(file: File): void {
  if (file.exists) {
    file.delete();
  }
}

/**
 * Applies the key and then forces SQLCipher to actually read a page.
 *
 * `PRAGMA key` alone never fails — SQLCipher defers verification until the
 * first read, so without this probe a wrong key produces a connection that
 * looks fine and throws somewhere deep in the app later. The probe is what
 * makes "wrong key fails closed" true.
 */
function applyKeyAndProbe(database: SQLiteDatabase, keyHex: string): void {
  database.execSync(buildKeyPragma(keyHex));
  // Throws "file is not a database" when the key is wrong.
  database.getFirstSync(`SELECT count(*) AS value FROM sqlite_master`);
}

function toMigrationConnection(database: SQLiteDatabase): MigrationConnection {
  return {
    execSync: (sql: string) => database.execSync(sql),
    getAllSync: <T,>(sql: string): T[] => database.getAllSync(sql) as T[],
    getFirstSync: <T,>(sql: string): T | null => database.getFirstSync(sql) as T | null,
    // Asynchronous by contract — see MigrationConnection.close. It keeps the
    // close off the JS thread; what actually made close return at all is
    // MIGRATION_OPEN_OPTIONS' finalizeUnusedStatementsBeforeClosing: false.
    close: async () => {
      await database.closeAsync();
    },
  };
}

/**
 * Opens the application database with `PRAGMA key` as the first statement.
 *
 * Order is load-bearing and not stylistic: on a SQLCipher build every page
 * read before the key is applied fails, so `journal_mode` and `foreign_keys`
 * cannot come first the way they used to.
 */
export function openKeyedDatabase(fileName: string, keyHex: string): SQLiteDatabase {
  const database = openDatabaseSync(fileName);
  try {
    applyKeyAndProbe(database, keyHex);
  } catch (error) {
    database.closeSync();
    throw error;
  }
  return database;
}

export function createEncryptionEnvironment(
  log: (event: EncryptionEvent) => void,
): EncryptionEnvironment {
  return {
    exists(fileName: string): boolean {
      return databaseFile(fileName).exists;
    },

    classify(fileName: string): DatabaseFileClass {
      return classifyDatabaseHeader(
        readLeadingBytes(databaseFile(fileName), SQLITE_PLAINTEXT_HEADER.length),
      );
    },

    deleteFile(fileName: string): void {
      deleteIfPresent(databaseFile(fileName));
    },

    deleteSidecars(fileName: string): void {
      deleteIfPresent(databaseFile(`${fileName}-journal`));
      deleteIfPresent(databaseFile(`${fileName}-wal`));
      deleteIfPresent(databaseFile(`${fileName}-shm`));
    },

    rename(fromFileName: string, toFileName: string): void {
      atomicRenameDatabaseFileNative(fromFileName, toFileName);
    },

    openPlaintext(fileName: string): MigrationConnection {
      // No `PRAGMA key`: a SQLCipher build reads an unkeyed plaintext database
      // normally, which is exactly how the pre-H-3 file is still readable.
      // `useNewConnection` keeps this out of expo-sqlite's by-name cache so it
      // cannot be handed back later as the app's live connection.
      return toMigrationConnection(openDatabaseSync(fileName, MIGRATION_OPEN_OPTIONS));
    },

    openEncrypted(fileName: string, keyHex: string): MigrationConnection {
      const database = openDatabaseSync(fileName, MIGRATION_OPEN_OPTIONS);
      try {
        applyKeyAndProbe(database, keyHex);
      } catch (error) {
        database.closeSync();
        throw error;
      }
      return toMigrationConnection(database);
    },

    exportToEncrypted(source: MigrationConnection, toFileName: string, keyHex: string): void {
      const target = databaseFile(toFileName);
      // ATTACH creates the file; a leftover would be appended to rather than
      // replaced. The caller has already established this path is stale.
      deleteIfPresent(target);
      deleteIfPresent(databaseFile(`${toFileName}-journal`));
      deleteIfPresent(databaseFile(`${toFileName}-wal`));
      deleteIfPresent(databaseFile(`${toFileName}-shm`));
      const path = filesystemPath(target).replace(/'/g, "''");
      source.execSync(`ATTACH DATABASE '${path}' AS muthoy_enc KEY "x'${assertHex(keyHex)}'";`);
      try {
        source.execSync(`SELECT sqlcipher_export('muthoy_enc');`);
      } finally {
        source.execSync(`DETACH DATABASE muthoy_enc;`);
      }
    },

    log,
  };
}

/**
 * Second hex gate, at the point of string concatenation into SQL.
 * buildKeyPragma guards the open path the same way; ATTACH is a separate
 * statement and gets its own check rather than trusting the caller.
 */
function assertHex(keyHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(keyHex)) {
    throw new Error('Refusing to attach with a malformed database key');
  }
  return keyHex;
}
