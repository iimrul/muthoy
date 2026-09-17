import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, test } from 'vitest';

import {
  collectDatabaseFingerprint,
  compareDatabasePayloads,
  compareFingerprints,
  verifyForeignKeys,
  verifyMedicinesFtsSearchable,
  type SqlConnection,
} from './encryptionVerify';

const openDatabases: DatabaseSync[] = [];

function database(): DatabaseSync {
  const value = new DatabaseSync(':memory:');
  openDatabases.push(value);
  return value;
}

function connection(value: DatabaseSync): SqlConnection {
  return {
    execSync: (sql) => value.exec(sql),
    getAllSync: <T,>(sql: string) => value.prepare(sql).all() as T[],
    getFirstSync: <T,>(sql: string) => (value.prepare(sql).get() ?? null) as T | null,
  };
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close();
});

describe('deterministic FTS verification', () => {
  test('rejects a missing FTS object when the content table exists', () => {
    const raw = database();
    raw.exec(`CREATE TABLE medicines (name TEXT NOT NULL, generic TEXT)`);

    expect(verifyMedicinesFtsSearchable(connection(raw))).toMatchObject([
      { check: 'fts-schema-missing' },
    ]);
  });

  test('requires a real MATCH result, not an external-content COUNT', () => {
    const raw = database();
    raw.exec(`
      CREATE TABLE medicines (name TEXT NOT NULL, generic TEXT);
      CREATE VIRTUAL TABLE medicines_fts USING fts5(
        name, generic, content=medicines, content_rowid=rowid
      );
      INSERT INTO medicines VALUES ('Napa', 'Paracetamol');
      INSERT INTO medicines_fts(medicines_fts) VALUES('rebuild');
    `);
    const delegate = connection(raw);
    let sawMatch = false;
    const forcedMiss: SqlConnection = {
      ...delegate,
      getFirstSync: <T,>(sql: string) => {
        if (sql.includes(' MATCH ')) {
          sawMatch = true;
          return null;
        }
        return delegate.getFirstSync<T>(sql);
      },
    };

    expect(verifyMedicinesFtsSearchable(forcedMiss)).toEqual([
      { check: 'fts-match-failed', detail: 'FTS MATCH returned no row' },
    ]);
    expect(sawMatch).toBe(true);
  });

  // H-3 TEST stage, on-device: creating and dropping an `fts5vocab` temp
  // virtual table on the same connection this function verified is what made
  // SQLite's close() spin the calling JS thread forever afterward. The term
  // now comes from a real column (ordered by `rowid`, the same column the
  // FTS index itself is linked to), never from a virtual table.
  test('never creates a temp virtual table to find a search term', () => {
    const raw = database();
    raw.exec(`
      CREATE TABLE medicines (name TEXT NOT NULL, generic TEXT);
      CREATE VIRTUAL TABLE medicines_fts USING fts5(
        name, generic, content=medicines, content_rowid=rowid
      );
      INSERT INTO medicines VALUES ('Napa', 'Paracetamol');
      INSERT INTO medicines_fts(medicines_fts) VALUES('rebuild');
    `);
    const delegate = connection(raw);
    const statements: string[] = [];
    const tracked: SqlConnection = {
      execSync: (sql) => {
        statements.push(sql);
        delegate.execSync(sql);
      },
      getAllSync: <T,>(sql: string) => {
        statements.push(sql);
        return delegate.getAllSync<T>(sql);
      },
      getFirstSync: <T,>(sql: string) => {
        statements.push(sql);
        return delegate.getFirstSync<T>(sql);
      },
    };

    expect(verifyMedicinesFtsSearchable(tracked)).toEqual([]);

    expect(statements.some((sql) => /CREATE\s+VIRTUAL\s+TABLE/i.test(sql))).toBe(false);
    expect(statements.some((sql) => sql.includes('fts5vocab'))).toBe(false);
  });

  test('picks the search term from a real column, ordered by rowid', () => {
    const raw = database();
    raw.exec(`
      CREATE TABLE medicines (name TEXT NOT NULL, generic TEXT);
      CREATE VIRTUAL TABLE medicines_fts USING fts5(
        name, generic, content=medicines, content_rowid=rowid
      );
      INSERT INTO medicines VALUES ('Seclo', 'Omeprazole');
      INSERT INTO medicines VALUES ('Napa', 'Paracetamol');
      INSERT INTO medicines_fts(medicines_fts) VALUES('rebuild');
    `);

    expect(verifyMedicinesFtsSearchable(connection(raw))).toEqual([]);
  });
});

describe('copy verification is non-vacuous', () => {
  test('detects payload changes even when table counts match', () => {
    const source = database();
    const target = database();
    for (const item of [source, target]) {
      item.exec(`CREATE TABLE shops (id TEXT PRIMARY KEY, name TEXT NOT NULL)`);
      item.exec(`INSERT INTO shops VALUES ('shop-1', 'Original')`);
    }
    target.exec(`UPDATE shops SET name = 'Changed' WHERE id = 'shop-1'`);

    expect(compareDatabasePayloads(connection(source), connection(target))).toMatchObject([
      { check: 'row-payload-mismatch' },
    ]);
  });

  test('compares the complete migration journal payload', () => {
    const source = database();
    const target = database();
    for (const item of [source, target]) {
      item.exec(`
        CREATE TABLE __drizzle_migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hash TEXT NOT NULL,
          created_at NUMERIC
        );
        INSERT INTO __drizzle_migrations(hash, created_at) VALUES ('hash-a', 100);
      `);
    }
    target.exec(`UPDATE __drizzle_migrations SET hash = 'hash-b'`);

    expect(compareDatabasePayloads(connection(source), connection(target))).toMatchObject([
      { check: 'row-payload-mismatch' },
    ]);
  });

  test('detects missing indexes, triggers, and views', () => {
    const source = database();
    const target = database();
    for (const item of [source, target]) {
      item.exec(`CREATE TABLE rows (id INTEGER PRIMARY KEY, value TEXT)`);
    }
    source.exec(`
      CREATE INDEX rows_value_idx ON rows(value);
      CREATE TRIGGER rows_insert AFTER INSERT ON rows BEGIN UPDATE rows SET value = value; END;
      CREATE VIEW rows_view AS SELECT id, value FROM rows;
    `);

    expect(
      compareFingerprints(
        collectDatabaseFingerprint(connection(source)),
        collectDatabaseFingerprint(connection(target)),
      ),
    ).toMatchObject([{ check: 'schema-mismatch' }]);
  });

  test('runs foreign_key_check against copied payloads', () => {
    const raw = database();
    raw.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE parent (id INTEGER PRIMARY KEY);
      CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));
      INSERT INTO child VALUES (1, 999);
    `);

    expect(verifyForeignKeys(connection(raw))).toMatchObject([
      { check: 'foreign-key-check-failed' },
    ]);
  });
});
