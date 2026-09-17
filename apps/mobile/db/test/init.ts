// Node stand-in for db/init.ts, aliased in vitest.config.ts alongside
// db/test/client.ts.
//
// db/init.ts runs Drizzle's migrator. Under test that is not just
// unnecessary, it is wrong: every SQLite suite builds its own schema by
// exec'ing the migration files straight into the shared in-memory database,
// so a second `migrate()` pass re-issues `CREATE TABLE` on tables that
// already exist and the suite dies on `credits`.
//
// This became reachable when H-3 added a database gate to the headless
// notification task — db/init.ts is now in the import graph of any test that
// touches native/notifications.ts, which it never was before.
//
// The schema is already there by the time anything calls these, so both are
// satisfied no-ops.

export interface DatabaseInitState {
  isReady: boolean;
  error: Error | undefined;
  retry: () => void;
}

export async function ensureDatabaseInitialized(): Promise<void> {}

export function useDatabaseMigrations(): DatabaseInitState {
  return { isReady: true, error: undefined, retry: () => undefined };
}
