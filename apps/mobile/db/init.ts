import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { db } from './client';
import migrations from './migrations/migrations';

export interface DatabaseInitState {
  /** True once the schema is present and the app may safely read/write. */
  isReady: boolean;
  /** Non-null if a migration failed — the app must NOT continue silently. */
  error: Error | undefined;
}

/**
 * Runs any pending migrations once, on app start.
 *
 * Safe to run on every launch: Drizzle records applied migrations in its own
 * `__drizzle_migrations` table and skips anything already applied, so a normal
 * reopen is a no-op and never re-runs destructively (Volume 0 Day 2's
 * validation checklist).
 *
 * Lives here rather than in app/_layout.tsx so that db/ stays the only place
 * importing Drizzle (Volume 2's folder responsibilities) — the root layout
 * just calls this one hook.
 */
export function useDatabaseMigrations(): DatabaseInitState {
  const { success, error } = useMigrations(db, migrations);
  return { isReady: success, error };
}
