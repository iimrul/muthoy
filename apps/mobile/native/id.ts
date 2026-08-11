import { randomUUID } from 'expo-crypto';

// native/id.ts — the ONLY place generating primary-key IDs. Every table's
// `id` is a "device-generated UUID" (Volume 3) — SQLite text primary keys
// aren't autoincrement, so the app generates the ID before insert.
// expo-crypto's randomUUID draws from the OS's secure random source, not
// Math.random (DEVELOPMENT_RULES.md: native/ is the only code touching
// native modules; this is one).
export function generateId(): string {
  return randomUUID();
}
