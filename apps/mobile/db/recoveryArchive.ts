import { db, sqliteConnection } from "./client";
import { requireOwner } from "./auth";
import { assertSessionLive } from "./errors";
import {
  RECOVERY_BUSINESS_TABLES,
  RECOVERY_TABLES,
  RECOVERY_SCHEMA_VERSION,
  canonicalRecoveryJson,
  recoverySupersededEntries,
  validateRecoveryHeader,
  validateRecoverySnapshot,
  type RecoveryHeader,
  type RecoveryRow,
  type RecoverySnapshot,
  type RecoveryTable,
} from "../domain/recoveryArchive";

export interface RecoverySqlite {
  execSync(sql: string): void;
  prepareSync(sql: string): {
    executeSync(params?: (string | number | null)[]): {
      getAllSync(): unknown[];
    };
    finalizeSync?(): void;
  };
}
function rows<T>(
  connection: RecoverySqlite,
  sql: string,
  params: (string | number | null)[] = [],
): T[] {
  const statement = connection.prepareSync(sql);
  try {
    return statement.executeSync(params).getAllSync() as T[];
  } finally {
    statement.finalizeSync?.();
  }
}
function run(
  connection: RecoverySqlite,
  sql: string,
  params: (string | number | null)[] = [],
): void {
  const statement = connection.prepareSync(sql);
  try {
    statement.executeSync(params);
  } finally {
    statement.finalizeSync?.();
  }
}
const source = sqliteConnection as unknown as RecoverySqlite;
const SECRET =
  /^(pin_hash|pin_lookup_tag|device_secret|access_token|refresh_token|recovery_code)$/;
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        SECRET.test(key)
          ? key === "pin_hash"
            ? "RECOVERY_REAUTH_REQUIRED"
            : null
          : redact(v),
      ]),
    );
  return value;
}
function sanitized(name: RecoveryTable, original: RecoveryRow): RecoveryRow {
  const row = redact(original) as RecoveryRow;
  if (name === "sync_queue" || name === "recovery_journal") {
    const payload = JSON.parse(String(row.payload)) as Record<string, unknown>;
    if (
      name === "sync_queue" &&
      row.status !== "sent" &&
      Object.keys(payload).some(
        (key) => SECRET.test(key) && payload[key] !== null,
      )
    ) {
      throw new Error(
        "Pending credential changes require authenticated sync before business-only recovery capture",
      );
    }
    row.payload = JSON.stringify(redact(payload));
  }
  if (name === "conflict_queue") {
    for (const field of ["local_value", "remote_value"])
      if (row[field])
        row[field] = JSON.stringify(redact(JSON.parse(String(row[field]))));
    if (row.superseded_payloads) {
      row.superseded_payloads = JSON.stringify(
        recoverySupersededEntries(String(row.superseded_payloads)).map((entry) => ({
          ...redact(entry) as Record<string, unknown>,
          payload: JSON.stringify(redact(JSON.parse(entry.payload))),
        })),
      );
    }
  }
  return row;
}
// Derive FK checks from the shipped SQLite schema, without duplicating money
// rules. Pending payload parents must survive too; historical journal witnesses
// are retained but are never replayed as fresh business writes.
function validateSnapshotParents(
  connection: RecoverySqlite,
  snapshot: RecoverySnapshot,
): void {
  const foreignKeys = new Map<
    string,
    { table: string; from: string; to: string }[]
  >();
  for (const name of RECOVERY_BUSINESS_TABLES)
    foreignKeys.set(
      name,
      rows<{ table: string; from: string; to: string }>(
        connection,
        `pragma foreign_key_list(${name})`,
      ),
    );
  const parentIndices = new Map<string, Set<unknown>>();
  function check(name: string, row: Record<string, unknown>): void {
    for (const fk of foreignKeys.get(name) ?? []) {
      const value = row[fk.from];
      if (value === null || value === undefined) continue;
      const supported = RECOVERY_TABLES.includes(fk.table as RecoveryTable);
      const key = fk.table + "\0" + (fk.to || "id");
      if (supported && !parentIndices.has(key))
        parentIndices.set(key, new Set(snapshot.tables[fk.table as RecoveryTable].map(parent => parent[fk.to || "id"])));
      if (!supported || !parentIndices.get(key)?.has(value)) {
        throw new Error(
          "Recovery dependency missing from the isolated shop graph",
        );
      }
    }
  }
  for (const name of RECOVERY_BUSINESS_TABLES)
    for (const row of snapshot.tables[name]) check(name, row);
  for (const row of snapshot.tables.sync_queue)
    if (row.status !== "sent")
      check(
        String(row.table_name),
        JSON.parse(String(row.payload)) as Record<string, unknown>,
      );
}

export interface OwnerRecoveryCoverage {
  actorUserId: string;
  saleHistoryScope: "all" | "own";
  readableTables: readonly string[];
}
export function assertOwnerInsideTransaction(shopId: string, ownerId: string): void {
  const owner = rows(
    source,
    `select u.id from users u join roles r on r.id=u.role_id and r.shop_id=u.shop_id
    join shops s on s.id=u.shop_id and s.owner_id=u.id
    where u.id=? and u.shop_id=? and u.is_active=1 and u.is_deleted=0
      and u.access_locked_at is null and r.name='owner' and r.is_deleted=0 and s.is_deleted=0`,
    [ownerId, shopId],
  );
  if (owner.length !== 1) throw new Error("Owner recovery authority changed");
}
export async function captureRecoverySnapshot(
  header: RecoveryHeader,
  coverage: OwnerRecoveryCoverage,
  isStillActive: () => boolean,
): Promise<RecoverySnapshot> {
  await requireOwner(header.shopId, header.ownerId);
  if (
    coverage.actorUserId !== header.ownerId ||
    coverage.saleHistoryScope !== "all" ||
    new Set(coverage.readableTables).size !== RECOVERY_BUSINESS_TABLES.length ||
    RECOVERY_BUSINESS_TABLES.some(
      (table) => !coverage.readableTables.includes(table),
    )
  )
    throw new Error("Complete Owner materialized scope required");
  return db.transaction(() => {
    assertSessionLive(isStillActive);
    assertOwnerInsideTransaction(header.shopId, header.ownerId);
    const tables = Object.fromEntries(
      RECOVERY_TABLES.map((name) => {
        const query =
          name === "shops"
            ? "select * from shops where id=? order by id"
            : name === "permissions"
              ? "select * from permissions where role_id in (select id from roles where shop_id=?) order by id"
              : `select * from ${name} where shop_id=? order by id`;
        return [
          name,
          rows<RecoveryRow>(source, query, [header.shopId]).map((row) =>
            sanitized(name, row),
          ),
        ];
      }),
    ) as RecoverySnapshot["tables"];
    const watermark = tables.recovery_journal.reduce(
      (n, row) => Math.max(n, Number(row.id)),
      0,
    );
    const snapshot = {
      header: { ...header, schemaVersion: RECOVERY_SCHEMA_VERSION, watermark },
      tables,
    };
    validateRecoverySnapshot(snapshot);
    validateSnapshotParents(source, snapshot);
    assertSessionLive(isStillActive);
    return snapshot;
  });
}
export interface VerifiedRecoveryReceipt {
  header: RecoveryHeader;
  archiveSha256: string;
  verifiedAt: string;
}
export async function recordVerifiedRecoveryBackup(
  receipt: VerifiedRecoveryReceipt,
  isStillActive: () => boolean,
): Promise<void> {
  validateRecoveryHeader(receipt.header);
  await requireOwner(receipt.header.shopId, receipt.header.ownerId);
  if (
    !/^[a-f0-9]{64}$/.test(receipt.archiveSha256) ||
    !Number.isFinite(Date.parse(receipt.verifiedAt))
  )
    throw new Error("Invalid independent-copy receipt");
  db.transaction(() => {
    assertSessionLive(isStillActive);
    assertOwnerInsideTransaction(receipt.header.shopId, receipt.header.ownerId);
    const previous = rows<{
      archive_id: string;
      archive_sha256: string;
      watermark: number;
    }>(
      source,
      "select archive_id,archive_sha256,watermark from recovery_backup_state where shop_id=? and device_id=?",
      [receipt.header.shopId, receipt.header.deviceId],
    )[0];
    const max = rows<{ watermark: number }>(
      source,
      "select coalesce(max(id),0) watermark from recovery_journal where shop_id=?",
      [receipt.header.shopId],
    )[0]!.watermark;
    if (
      previous?.archive_sha256 === receipt.archiveSha256 &&
      previous.archive_id === receipt.header.archiveId &&
      previous.watermark === receipt.header.watermark
    )
      return;
    if (
      (previous?.archive_sha256 ?? null) !== receipt.header.previousSha256 ||
      receipt.header.watermark < (previous?.watermark ?? 0) ||
      receipt.header.watermark > max
    )
      throw new Error("Stale recovery receipt");
    run(
      source,
      `insert into recovery_backup_state(shop_id,device_id,archive_id,archive_sha256,watermark,verified_at)
      values(?,?,?,?,?,?) on conflict(shop_id,device_id) do update set archive_id=excluded.archive_id,
      archive_sha256=excluded.archive_sha256,watermark=excluded.watermark,verified_at=excluded.verified_at`,
      [
        receipt.header.shopId,
        receipt.header.deviceId,
        receipt.header.archiveId,
        receipt.archiveSha256,
        receipt.header.watermark,
        receipt.verifiedAt,
      ],
    );
  });
}
export async function getRecoveryExposure(
  shopId: string,
  ownerId: string,
  deviceId: string,
): Promise<{ protectedWatermark: number | null; unprotectedChanges: number }> {
  await requireOwner(shopId, ownerId);
  const state = rows<{ watermark: number }>(
    source,
    "select watermark from recovery_backup_state where shop_id=? and device_id=?",
    [shopId, deviceId],
  )[0];
  const count = rows<{ count: number }>(
    source,
    "select count(*) count from recovery_journal where shop_id=? and id>?",
    [shopId, state?.watermark ?? 0],
  )[0]!.count;
  return {
    protectedWatermark: state?.watermark ?? null,
    unprotectedChanges: count,
  };
}
function targetRows(
  connection: RecoverySqlite,
  name: RecoveryTable,
): RecoveryRow[] {
  return rows<RecoveryRow>(connection, `select * from ${name} order by id`);
}
/** Never swaps the live DB. Only a fresh, separately opened recovery file. */
export function importRecoverySnapshot(
  destination: RecoverySqlite,
  snapshot: RecoverySnapshot,
  archiveSha256: string,
  expected: { shopId: string; ownerId: string },
): "imported" | "already_imported" {
  validateRecoverySnapshot(snapshot);
  if (
    snapshot.header.shopId !== expected.shopId ||
    snapshot.header.ownerId !== expected.ownerId ||
    !/^[a-f0-9]{64}$/.test(archiveSha256)
  )
    throw new Error("Recovery identity mismatch");
  if (destination === source)
    throw new Error("Live database cannot be a recovery destination");
  const databases = rows<{ name: string; file: string }>(
    destination,
    "pragma database_list",
  );
  const main = databases.find((row) => row.name === "main");
  if (
    !main ||
    databases.some(
      (row) => row.name !== "main" && (row.name !== "temp" || row.file !== ""),
    ) ||
    (main.file !== "" &&
      !/(?:^|[\/])muthoy\.recovery-[a-f0-9-]{36}\.db$/i.test(main.file))
  )
    throw new Error("Isolated recovery destination required");
  validateSnapshotParents(destination, snapshot);
  const prior = rows<{
    archive_sha256: string;
    shop_id: string;
    owner_id: string;
  }>(
    destination,
    "select archive_sha256,shop_id,owner_id from recovery_import_receipts where archive_id=?",
    [snapshot.header.archiveId],
  )[0];
  if (prior) {
    if (
      prior.archive_sha256 !== archiveSha256 ||
      prior.shop_id !== expected.shopId ||
      prior.owner_id !== expected.ownerId ||
      RECOVERY_TABLES.some(
        (name) =>
          canonicalRecoveryJson(targetRows(destination, name)) !==
          canonicalRecoveryJson(snapshot.tables[name]),
      )
    )
      throw new Error("Recovery receipt or restored rows changed");
    return "already_imported";
  }
  if (
    RECOVERY_TABLES.some(
      (name) => targetRows(destination, name).length !== 0,
    ) ||
    rows(destination, "select 1 from recovery_import_receipts limit 1").length
  )
    throw new Error("Recovery destination is not empty");
  destination.execSync(
    "PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;",
  );
  try {
    for (const name of RECOVERY_TABLES) {
      const columns = rows<{ name: string }>(
        destination,
        `pragma table_info(${name})`,
      ).map((r) => r.name);
      for (const row of snapshot.tables[name]) {
        const keys = Object.keys(row);
        if (
          keys.length !== columns.length ||
          keys.some((key) => !columns.includes(key))
        )
          throw new Error("Recovery schema columns mismatch");
        run(
          destination,
          `insert into ${name} (${keys.map((k) => '"' + k + '"').join(",")}) values (${keys.map(() => "?").join(",")})`,
          keys.map((k) => (name === "batches" && k === "stock" ? 0 : row[k]!)),
        );
      }
    }
    // Existing movement triggers rebuild stock once from original immutable IDs.
    // Their updated_at side effect is not a new business edit during restoration.
    for (const batch of snapshot.tables.batches)
      run(
        destination,
        "update batches set updated_at=?,oversold_at=? where id=? and shop_id=?",
        [
          batch.updated_at!,
          batch.oversold_at!,
          batch.id!,
          snapshot.header.shopId,
        ],
      );
    if (
      RECOVERY_TABLES.some(
        (name) =>
          canonicalRecoveryJson(targetRows(destination, name)) !==
          canonicalRecoveryJson(snapshot.tables[name]),
      )
    )
      throw new Error(
        "Restored recovery rows differ from the authenticated snapshot",
      );
    if (rows(destination, "pragma foreign_key_check").length)
      throw new Error("Incomplete recovery parent graph");
    run(
      destination,
      "insert into recovery_import_receipts(archive_id,shop_id,owner_id,archive_sha256,imported_at) values(?,?,?,?,?)",
      [
        snapshot.header.archiveId,
        expected.shopId,
        expected.ownerId,
        archiveSha256,
        new Date().toISOString(),
      ],
    );
    destination.execSync("COMMIT");
    return "imported";
  } catch (error) {
    destination.execSync("ROLLBACK");
    throw error;
  }
}

export async function getLastRecoveryBackup(
  shopId: string,
  ownerId: string,
  deviceId: string,
): Promise<{ archiveSha256: string; watermark: number } | null> {
  await requireOwner(shopId, ownerId);
  const row = rows<{ archive_sha256: string; watermark: number }>(
    source,
    "select archive_sha256,watermark from recovery_backup_state where shop_id=? and device_id=?",
    [shopId, deviceId],
  )[0];
  return row
    ? { archiveSha256: row.archive_sha256, watermark: row.watermark }
    : null;
}
