import { drizzle } from 'drizzle-orm/expo-sqlite/driver';
import * as schema from '../schema';
import { adapter } from './expo-sqlite';

export const db = drizzle(adapter as never, { schema });

// Mirrors db/client.ts's raw-SQL escape hatch so modules using it are testable.
export const sqliteConnection = adapter as never as typeof import('../client').sqliteConnection;

/**
 * H-3 no-ops. Production `db/client.ts` is lazy behind the SQLCipher key, but
 * this harness owns an in-memory node:sqlite database that is ready the
 * moment it is imported — there is nothing to unlock and nothing to migrate
 * on demand. Present so the barrel in db/index.ts re-exports the same names
 * under test as it does on device.
 */
export async function ensureDatabaseReady(): Promise<void> {}

export function getDatabaseEncryptionOutcome(): null {
  return null;
}

export const DATABASE_NAME = 'muthoy.db';
