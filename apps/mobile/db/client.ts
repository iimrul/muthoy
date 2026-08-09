import { openDatabaseSync } from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as schema from './schema';

/**
 * The local SQLite database file. This is the app's ONLY source of truth
 * (CLAUDE.md rule 1) — no screen ever reads from the network to decide what
 * to show.
 */
const DATABASE_NAME = 'muthoy.db';

const expoDb = openDatabaseSync(DATABASE_NAME);

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
expoDb.execSync('PRAGMA journal_mode = WAL;');
expoDb.execSync('PRAGMA foreign_keys = ON;');

/**
 * The Drizzle client. Everything that reads or writes SQLite goes through
 * this, and only from inside db/ (Volume 2: db/ is the ONLY code that imports
 * Drizzle or touches SQLite directly).
 */
export const db = drizzle(expoDb, { schema });

/** Escape hatch for raw SQL (FTS5 queries on Day 3, PRAGMA checks in tests). */
export const sqliteConnection = expoDb;

export { DATABASE_NAME };
