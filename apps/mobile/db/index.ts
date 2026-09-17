// db/ — the ONLY code in this app that imports Drizzle or touches SQLite
// directly (Volume 2). Screens and domain logic import from here, never from
// drizzle-orm or expo-sqlite themselves.
export { db, sqliteConnection, DATABASE_NAME } from './client';
// H-3: the database is encrypted at rest, so the handles above are inert
// until one of these resolves. Screens get it via the root layout's boot
// gate; headless tasks must await ensureDatabaseInitialized() themselves.
export { ensureDatabaseReady, getDatabaseEncryptionOutcome } from './client';
export { ensureDatabaseInitialized, useDatabaseMigrations } from './init';
export type { DatabaseInitState } from './init';
export * as schema from './schema';
