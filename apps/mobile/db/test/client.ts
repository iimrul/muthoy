import { drizzle } from 'drizzle-orm/expo-sqlite/driver';
import * as schema from '../schema';
import { adapter } from './expo-sqlite';

export const db = drizzle(adapter as never, { schema });