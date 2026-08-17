import { drizzle } from 'drizzle-orm/expo-sqlite/driver';
import * as schema from '../schema';
import { adapter } from './expo-sqlite';

export const db = drizzle(adapter as never, { schema });

// Mirrors db/client.ts's raw-SQL escape hatch so modules using it are testable.
export const sqliteConnection = adapter as never as typeof import('../client').sqliteConnection;