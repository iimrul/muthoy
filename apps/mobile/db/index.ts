// db/ — the ONLY code in this app that imports Drizzle or touches SQLite
// directly (Volume 2). Screens and domain logic import from here, never from
// drizzle-orm or expo-sqlite themselves.
export { db, sqliteConnection, DATABASE_NAME } from './client';
export { useDatabaseMigrations } from './init';
export type { DatabaseInitState } from './init';
export * as schema from './schema';
