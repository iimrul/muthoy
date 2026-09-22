// scripts/classify-migrations.mjs — H-11 C1, the machine half.
//
// The first audit classified migrations by grepping for DML anywhere in the
// file, which counted UPDATE and INSERT statements living inside
// CREATE OR REPLACE FUNCTION bodies. Those are RUNTIME code shipped by the
// migration, not mutation the migration performs; counting them as data
// writes marked seven migrations forward-only that are nothing of the kind.
//
// This module is the single source of that classification. ROLLBACK.md is
// written from it and a test asserts the document still matches it, so the
// two cannot drift.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const PG_MIGRATIONS_DIR = 'backend/supabase/migrations';
export const SQLITE_MIGRATIONS_DIR = 'apps/mobile/db/migrations';
export const CLASSIFICATION_MANIFEST_PATH =
  'backend/supabase/migrations/rollback-classification.json';
export const CLASSIFICATION_MANIFEST = JSON.parse(
  readFileSync(resolve(CLASSIFICATION_MANIFEST_PATH), 'utf8'),
);

/**
 * The baseline creates every table in the schema. No DML runs in it, so the
 * mechanical rule below would call it reversible — but the only reverse for
 * "create the entire database" is dropping it, which is a restore. This is
 * the one judgement in the file, and it is declared rather than hidden.
 */
export const FORWARD_ONLY_OVERRIDES = new Set(
  CLASSIFICATION_MANIFEST.postgresDeclaredOverrides,
);

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/** Dollar-quoted function bodies: runtime code, never migration-time writes. */
function stripPostgresFunctionBodies(sql) {
  return sql.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' <FUNCTION_BODY> ');
}

/** SQLite trigger bodies are runtime code for exactly the same reason. */
function stripSqliteTriggerBodies(sql) {
  return sql.replace(/CREATE\s+TRIGGER\b[\s\S]*?\bEND\s*;/gi, ' <TRIGGER_BODY> ');
}

function count(sql, pattern) {
  return (sql.match(pattern) ?? []).length;
}

/**
 * What a migration actually does at migration time, after runtime bodies are
 * removed.
 */
export function describeMigration(sql, dialect) {
  const clean = stripComments(sql);
  const body = dialect === 'postgres'
    ? stripPostgresFunctionBodies(clean)
    : stripSqliteTriggerBodies(clean);
  return {
    update: count(body, /\bUPDATE\s+[`"\w.]+\s+SET\b/gi),
    insert: count(body, /\bINSERT\s+INTO\b/gi),
    delete: count(body, /\bDELETE\s+FROM\b/gi),
    dropTable: count(body, /\bDROP\s+TABLE\b/gi),
    dropColumn: count(body, /\bDROP\s+COLUMN\b/gi),
    dropIndex: count(body, /\bDROP\s+INDEX\b/gi),
    dropFunction: count(body, /\bDROP\s+FUNCTION\b/gi),
    dropPolicy: count(body, /\bDROP\s+POLICY\b/gi),
    dropTrigger: count(body, /\bDROP\s+TRIGGER\b/gi),
    dropConstraint: count(body, /\bDROP\s+CONSTRAINT\b/gi),
    // Counted on the UNSTRIPPED source: the point is that the migration ships
    // a function, which is what makes it redeployable.
    createFunction: count(clean, /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi),
    createPolicy: count(body, /\bCREATE\s+POLICY\b/gi),
    // createTrigger is counted on the UNSTRIPPED source too: stripping is
    // precisely what removes a SQLite trigger, so counting it on the body
    // would score every one of them as zero.
    createTrigger: count(clean, /\bCREATE\s+TRIGGER\b/gi),
    createTable: count(body, /\bCREATE\s+TABLE\b/gi),
    createIndex: count(body, /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/gi),
    addColumn: count(body, /\bADD\s+COLUMN\b/gi),
    grant: count(body, /\bGRANT\b/gi),
    revoke: count(body, /\bREVOKE\b/gi),
  };
}

/**
 * A — reversible: purely additive objects, reversed by the obvious inverse.
 * B — redeployable: ships a function, policy, trigger or constraint whose
 *     previous definition is in git; reverting is a deploy, not a data op.
 * C — forward-only: the migration wrote or destroyed DATA.
 */
export function classify(facts, { forwardOnly = false } = {}) {
  const destroysData = facts.update + facts.insert + facts.delete
    + facts.dropTable + facts.dropColumn > 0;
  if (forwardOnly || destroysData) return 'C';
  const swapsDefinitions = facts.createFunction + facts.createPolicy
    + facts.createTrigger + facts.dropFunction + facts.dropPolicy
    + facts.dropTrigger + facts.dropConstraint > 0;
  return swapsDefinitions ? 'B' : 'A';
}

export function classifyDirectory(directory, dialect) {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const facts = describeMigration(readFileSync(join(directory, name), 'utf8'), dialect);
      return {
        name,
        facts,
        class: classify(facts, { forwardOnly: FORWARD_ONLY_OVERRIDES.has(name) }),
      };
    });
}

export function classCounts(rows) {
  return rows.reduce(
    (totals, row) => ({ ...totals, [row.class]: (totals[row.class] ?? 0) + 1 }),
    { A: 0, B: 0, C: 0 },
  );
}

export function assertManifestMatchesMigrations() {
  const pg = classifyDirectory(PG_MIGRATIONS_DIR, 'postgres');
  const actualNames = pg.map((row) => row.name);
  const manifestNames = Object.keys(CLASSIFICATION_MANIFEST.postgres).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(manifestNames)) {
    throw new Error('PostgreSQL migration set drifted from rollback-classification.json');
  }
  for (const row of pg) {
    if (CLASSIFICATION_MANIFEST.postgres[row.name] !== row.class) {
      throw new Error(
        `${row.name}: manifest=${CLASSIFICATION_MANIFEST.postgres[row.name]} actual=${row.class}`,
      );
    }
  }

  const lite = classifyDirectory(SQLITE_MIGRATIONS_DIR, 'sqlite');
  const writes = lite
    .filter((row) => row.facts.update + row.facts.insert + row.facts.delete > 0)
    .map((row) => row.name.slice(0, 4));
  const drops = lite
    .filter((row) => row.facts.dropTable > 0)
    .map((row) => row.name.slice(0, 4));
  if (JSON.stringify(writes) !== JSON.stringify(CLASSIFICATION_MANIFEST.sqliteDataWrites)) {
    throw new Error('SQLite data-writing migrations drifted from rollback-classification.json');
  }
  if (JSON.stringify(drops) !== JSON.stringify(CLASSIFICATION_MANIFEST.sqliteDropsTables)) {
    throw new Error('SQLite table-dropping migrations drifted from rollback-classification.json');
  }
  return { pg, lite };
}
