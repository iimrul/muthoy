// Node stand-in for db/migrations/migrations.js, aliased in vitest.config.ts.
//
// The real file does `import m0000 from './0000_....sql'`, which only works
// because babel.config.js runs babel-plugin-inline-import for Metro. Rollup
// under Vitest tries to parse the .sql as JavaScript and fails at
// `CREATE TABLE`.
//
// This became load-bearing when H-3 gave native/notifications.ts a headless
// database gate: db/init.ts is now reachable from a plain domain test's
// import graph, where it never was before.
//
// Deliberately NOT an empty stub. It reads the real journal and the real SQL
// off disk, so anything that actually runs these migrations under test gets
// the shipped schema rather than a hollow one.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS_DIR = 'apps/mobile/db/migrations';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

const journal = JSON.parse(
  readFileSync(resolve(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
) as Journal;

// Drizzle's migrator looks each entry up as `m` + the zero-padded index.
const migrations: Record<string, string> = Object.fromEntries(
  journal.entries.map((entry) => [
    `m${entry.idx.toString().padStart(4, '0')}`,
    readFileSync(resolve(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8'),
  ]),
);

export default { journal, migrations };
