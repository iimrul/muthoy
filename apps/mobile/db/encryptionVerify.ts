// H-3 verification. Every comparison here runs before a plaintext source or
// recovery backup may be released. Failure details are structural only: no
// row values, counts, money, stock totals, or identifiers leave this module.

export interface SqlConnection {
  execSync(sql: string): void;
  getAllSync<T>(sql: string): T[];
  getFirstSync<T>(sql: string): T | null;
}

interface TableDescriptor {
  name: string;
  rowCount: number;
}

interface SchemaObject {
  type: string;
  name: string;
  tableName: string;
  sql: string | null;
}

export interface DatabaseFingerprint {
  tables: TableDescriptor[];
  schema: SchemaObject[];
  ledgerMismatchCount: number;
}

export interface VerificationFailure {
  check: string;
  detail: string;
}

function sqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** SQLite/FTS-owned derived tables are rebuilt or represented by schema. */
function isInternalTable(name: string): boolean {
  return name.startsWith('sqlite_') || /_fts(_data|_idx|_docsize|_config|_content)?$/.test(name);
}

function isInternalSchemaObject(name: string): boolean {
  return name.startsWith('sqlite_') || /_fts_(data|idx|docsize|config|content)$/.test(name);
}

function firstNumber(connection: SqlConnection, sql: string): number {
  const row = connection.getFirstSync<{ value: number | null }>(sql);
  return Number(row?.value ?? 0);
}

function tableExists(connection: SqlConnection, name: string): boolean {
  return connection.getFirstSync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(name)}`,
  ) !== null;
}

function listDataTables(connection: SqlConnection): string[] {
  return connection
    .getAllSync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    )
    .map((row) => row.name)
    .filter((name) => !isInternalTable(name));
}

function collectSchema(connection: SqlConnection): SchemaObject[] {
  return connection
    .getAllSync<{ type: string; name: string; tableName: string; sql: string | null }>(
      `SELECT type, name, tbl_name AS tableName, sql
       FROM sqlite_master
       WHERE type IN ('table', 'index', 'trigger', 'view')
       ORDER BY type, name`,
    )
    .filter((item) => !isInternalSchemaObject(item.name));
}

export function collectDatabaseFingerprint(connection: SqlConnection): DatabaseFingerprint {
  const tables = listDataTables(connection).map((name) => ({
    name,
    rowCount: firstNumber(connection, `SELECT COUNT(*) AS value FROM ${sqlIdentifier(name)}`),
  }));
  return {
    tables,
    schema: collectSchema(connection),
    ledgerMismatchCount:
      tableExists(connection, 'batches') && tableExists(connection, 'inventory_movements')
        ? countLedgerMismatches(connection)
        : 0,
  };
}

export function countLedgerMismatches(connection: SqlConnection): number {
  return firstNumber(
    connection,
    `SELECT COUNT(*) AS value FROM (
       SELECT b.id
       FROM batches b
       LEFT JOIN inventory_movements m ON m.batch_id = b.id
       GROUP BY b.id, b.stock
       HAVING b.stock <> COALESCE(SUM(m.change_qty), 0)
     )`,
  );
}

export function compareFingerprints(
  source: DatabaseFingerprint,
  target: DatabaseFingerprint,
): VerificationFailure[] {
  const failures: VerificationFailure[] = [];
  if (source.ledgerMismatchCount !== 0) {
    failures.push({ check: 'source-ledger-invalid', detail: 'source ledger invariant failed' });
  }
  if (target.ledgerMismatchCount !== 0) {
    failures.push({ check: 'target-ledger-invalid', detail: 'target ledger invariant failed' });
  }
  if (JSON.stringify(source.schema) !== JSON.stringify(target.schema)) {
    failures.push({ check: 'schema-mismatch', detail: 'schema objects differ' });
  }

  const targetByName = new Map(target.tables.map((table) => [table.name, table.rowCount]));
  for (const table of source.tables) {
    const targetCount = targetByName.get(table.name);
    if (targetCount === undefined) {
      failures.push({ check: 'table-missing', detail: 'a source table is absent' });
    } else if (targetCount !== table.rowCount) {
      failures.push({ check: 'row-count-mismatch', detail: 'a table row count differs' });
    }
  }
  const sourceNames = new Set(source.tables.map((table) => table.name));
  if (target.tables.some((table) => !sourceNames.has(table.name))) {
    failures.push({ check: 'table-unexpected', detail: 'an unexpected table is present' });
  }
  return failures;
}

interface TableColumn {
  name: string;
  pk: number;
  cid: number;
}

function canonicalValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `s${value.length}:${value}`;
  if (typeof value === 'number') return `n:${Object.is(value, -0) ? '-0' : String(value)}`;
  if (typeof value === 'bigint') return `i:${value.toString()}`;
  if (value instanceof Uint8Array) {
    return `b:${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  if (value instanceof ArrayBuffer) return canonicalValue(new Uint8Array(value));
  throw new Error('SQLite returned an unsupported value type during verification');
}

function canonicalRows(connection: SqlConnection, tableName: string): string[] {
  const columns = connection.getAllSync<TableColumn>(`PRAGMA table_info(${sqlIdentifier(tableName)})`);
  if (columns.length === 0) return [];
  const orderedColumns = [...columns].sort((a, b) => a.cid - b.cid);
  const primaryKey = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk);
  const orderColumns = primaryKey.length > 0 ? primaryKey : orderedColumns;
  const select = orderedColumns.map((column) => sqlIdentifier(column.name)).join(', ');
  const orderBy = orderColumns.map((column) => sqlIdentifier(column.name)).join(', ');
  const rows = connection.getAllSync<Record<string, unknown>>(
    `SELECT ${select} FROM ${sqlIdentifier(tableName)} ORDER BY ${orderBy}`,
  );
  return rows.map((row) =>
    orderedColumns.map((column) => canonicalValue(row[column.name])).join('|'),
  );
}

/** Exact ordered payload comparison, including __drizzle_migrations rows/hashes. */
export function compareDatabasePayloads(
  source: SqlConnection,
  target: SqlConnection,
): VerificationFailure[] {
  const sourceTables = listDataTables(source);
  const targetNames = new Set(listDataTables(target));
  for (const tableName of sourceTables) {
    if (!targetNames.has(tableName)) continue;
    if (
      JSON.stringify(canonicalRows(source, tableName)) !==
      JSON.stringify(canonicalRows(target, tableName))
    ) {
      return [{ check: 'row-payload-mismatch', detail: 'table payloads differ' }];
    }
  }
  return [];
}

export function rebuildMedicinesFts(connection: SqlConnection): void {
  if (tableExists(connection, 'medicines_fts')) {
    connection.execSync(`INSERT INTO medicines_fts(medicines_fts) VALUES('rebuild')`);
  }
}

/** FTS5 integrity plus a real MATCH query; COUNT(*) is external-content-vacuous. */
export function verifyMedicinesFtsSearchable(connection: SqlConnection): VerificationFailure[] {
  const hasFts = tableExists(connection, 'medicines_fts');
  const hasMedicines = tableExists(connection, 'medicines');
  // Both absent is the legitimate fresh-encrypted-before-first-migration
  // state. A one-sided absence is schema damage and must fail closed.
  if (!hasFts && !hasMedicines) return [];
  if (!hasFts || !hasMedicines) {
    return [{ check: 'fts-schema-missing', detail: 'FTS schema is incomplete' }];
  }
  try {
    connection.execSync(
      `INSERT INTO medicines_fts(medicines_fts, rank) VALUES('integrity-check', 1)`,
    );
    if (firstNumber(connection, `SELECT COUNT(*) AS value FROM medicines`) === 0) return [];
    // The term comes from the medicine's own indexed content, ordered by
    // `rowid` — the same column the FTS index itself is linked to
    // (`content_rowid=rowid`) — never from an `fts5vocab` virtual table.
    //
    // Building and dropping that temp virtual table here is what made a later
    // close() hang on-device (H-3 TEST stage). The mechanism is expo-sqlite's
    // close path rather than anything about this query: `closeDatabase` runs
    // `sqlite3_finalize_all_statement()` across every statement still
    // registered on the connection BEFORE `sqlite3_close()`, and an FTS5 vocab
    // cursor is exactly the kind of object that walk failed to get through.
    //
    // MIGRATION_OPEN_OPTIONS in encryptionEnvironment.ts now skips that walk,
    // so the migration connections no longer depend on this. Avoiding the temp
    // virtual table is still the right call, and not merely defensive:
    // verifyHydratedDatabase runs this same function against the LIVE
    // connection, which keeps expo's defaults and therefore still performs the
    // walk. A real column value proves everything MATCH needs to prove without
    // ever creating the cursor.
    const row = connection.getFirstSync<{ name: string }>(
      `SELECT name FROM medicines ORDER BY rowid LIMIT 1`,
    );
    const term = row?.name.trim().split(/\s+/)[0];
    if (!term) {
      return [{ check: 'fts-match-empty', detail: 'FTS index has no searchable term' }];
    }
    const phrase = `"${term.replace(/"/g, '""')}"`;
    const match = connection.getFirstSync<{ value: number }>(
      `SELECT 1 AS value FROM medicines_fts WHERE medicines_fts MATCH ${sqlString(phrase)} LIMIT 1`,
    );
    return match ? [] : [{ check: 'fts-match-failed', detail: 'FTS MATCH returned no row' }];
  } catch {
    return [{ check: 'fts-integrity-failed', detail: 'FTS integrity verification failed' }];
  }
}

export function verifyIntegrity(connection: SqlConnection): VerificationFailure[] {
  const row = connection.getFirstSync<{ integrity_check: string }>(`PRAGMA integrity_check`);
  return row?.integrity_check === 'ok'
    ? []
    : [{ check: 'integrity-check-failed', detail: 'SQLite integrity check failed' }];
}

export function verifyForeignKeys(connection: SqlConnection): VerificationFailure[] {
  const violations = connection.getAllSync<Record<string, unknown>>(`PRAGMA foreign_key_check`);
  return violations.length === 0
    ? []
    : [{ check: 'foreign-key-check-failed', detail: 'foreign key verification failed' }];
}

/** Standalone verification for a fully hydrated recovery candidate/main. */
export function verifyHydratedDatabase(connection: SqlConnection): VerificationFailure[] {
  rebuildMedicinesFts(connection);
  const fingerprint = collectDatabaseFingerprint(connection);
  return [
    ...verifyIntegrity(connection),
    ...verifyForeignKeys(connection),
    ...(fingerprint.ledgerMismatchCount === 0
      ? []
      : [{ check: 'ledger-invariant', detail: 'ledger invariant failed' }]),
    ...verifyMedicinesFtsSearchable(connection),
  ];
}
