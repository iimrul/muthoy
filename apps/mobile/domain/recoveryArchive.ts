// Versioned recovery protocol. Pure TypeScript; no database or network access.
export const RECOVERY_SCHEMA_VERSION = 35;
export const RECOVERY_BUSINESS_TABLES = [
  "shops",
  "subscriptions",
  "roles",
  "permissions",
  "users",
  "user_permissions",
  "shop_b2_settings",
  "medicines",
  "suppliers",
  "customers",
  "batches",
  "batch_promotions",
  "purchases",
  "purchase_items",
  "sales",
  "sale_drafts",
  "sale_draft_items",
  "sale_items",
  "sale_attachments",
  "sale_refunds",
  "sales_returns",
  "refund_tenders",
  "purchase_returns",
  "inventory_movements",
  "credits",
  "payments",
  "credit_payment_allocations",
  "credit_reconciliation_states",
  "expenses",
  "cash_drawer",
  "inventory_imports",
  "audit_logs",
] as const;
export const RECOVERY_TABLES = [
  ...RECOVERY_BUSINESS_TABLES,
  "sync_queue",
  "conflict_queue",
  "recovery_journal",
] as const;
export type RecoveryTable = (typeof RECOVERY_TABLES)[number];
export type RecoveryRow = Record<string, string | number | null>;
export interface RecoveryHeader {
  version: 1;
  schemaVersion: number;
  shopId: string;
  ownerId: string;
  deviceId: string;
  archiveId: string;
  watermark: number;
  previousSha256: string | null;
  createdAt: string;
}
export interface RecoverySnapshot {
  header: RecoveryHeader;
  tables: Record<RecoveryTable, RecoveryRow[]>;
}
export interface RecoveryCipher {
  random(length: number): Promise<Uint8Array>;
  sha256(data: Uint8Array): Promise<Uint8Array>;
  seal(
    key: Uint8Array,
    nonce: Uint8Array,
    plaintext: Uint8Array,
    aad: Uint8Array,
  ): Promise<Uint8Array>;
  open(
    key: Uint8Array,
    nonce: Uint8Array,
    ciphertextAndTag: Uint8Array,
    aad: Uint8Array,
  ): Promise<Uint8Array>;
}
export const recoveryUtf8 = (text: string): Uint8Array =>
  new TextEncoder().encode(text);
export const recoveryHex = (data: Uint8Array): string =>
  Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
export function recoveryUnhex(text: string): Uint8Array {
  if (!/^(?:[a-f0-9]{2})+$/.test(text))
    throw new Error("Invalid recovery encoding");
  return Uint8Array.from(text.match(/../g)!, (h) => parseInt(h, 16));
}
export function recoveryCodeBytes(code: string): Uint8Array {
  const hex = code.replace(/[\s-]/g, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hex) || /^0+$/.test(hex))
    throw new Error("Invalid recovery code");
  return recoveryUnhex(hex);
}
export async function generateRecoveryCode(
  cipher: RecoveryCipher,
): Promise<string> {
  const key = await cipher.random(32);
  if (key.length !== 32 || key.every((b) => b === 0))
    throw new Error("Secure random unavailable");
  return recoveryHex(key).match(/.{8}/g)!.join("-");
}
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function validateRecoveryHeader(h: RecoveryHeader): void {
  if (
    !h ||
    h.version !== 1 ||
    h.schemaVersion !== RECOVERY_SCHEMA_VERSION ||
    ![h.shopId, h.ownerId, h.deviceId, h.archiveId].every(
      (id) => typeof id === "string" && UUID.test(id),
    ) ||
    !Number.isSafeInteger(h.watermark) ||
    h.watermark < 0 ||
    !Number.isFinite(Date.parse(h.createdAt)) ||
    (h.previousSha256 !== null && !/^[a-f0-9]{64}$/.test(h.previousSha256))
  )
    throw new Error("Unsupported recovery header");
  if (
    Object.keys(h).sort().join(",") !==
    "archiveId,createdAt,deviceId,ownerId,previousSha256,schemaVersion,shopId,version,watermark"
  )
    throw new Error("Unknown recovery header fields");
}
export function canonicalRecoveryJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(canonicalRecoveryJson).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonicalRecoveryJson((value as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}
// Credentials are deliberately absent from recoverable business archives.
const SECRET =
  /(?:^|_)(?:pin_hash|pin_lookup_tag|device_secret|access_token|refresh_token|recovery_code)$/i;
function inspectValue(value: unknown, key = ""): void {
  if (
    SECRET.test(key) &&
    value !== null &&
    value !== "RECOVERY_REAUTH_REQUIRED"
  )
    throw new Error("Credentials are not recoverable business data");
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      (!["latitude", "longitude"].includes(key) &&
        !Number.isSafeInteger(value)))
  )
    throw new Error("Unsafe recovery numeric value");
  if (Array.isArray(value)) for (const v of value) inspectValue(v);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) inspectValue(v, k);
}
// conflicts.ts intentionally preserves outbox payloads as JSON STRINGS inside
// its superseded array. Inspect that known encoding, not arbitrary user text.
export function recoverySupersededEntries(serialized: string): (Record<string, unknown> & { payload: string })[] {
  const entries: unknown = JSON.parse(serialized);
  if (!Array.isArray(entries)) throw new Error("Invalid superseded recovery payloads");
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.payload !== "string")
      throw new Error("Invalid superseded recovery payloads");
    const payload: unknown = JSON.parse(entry.payload);
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new Error("Invalid superseded recovery payloads");
  }
  return entries;
}
function validateGroups(rows: RecoveryRow[]): void {
  const groups = new Map<string, RecoveryRow[]>();
  for (const row of rows) {
    if (row.operation_group_id === null) {
      if (
        [
          row.operation_kind,
          row.operation_sequence,
          row.operation_expected_count,
        ].some((v) => v !== null)
      )
        throw new Error("Partial operation metadata");
      continue;
    }
    if (typeof row.operation_group_id !== "string" || !row.operation_group_id)
      throw new Error("Invalid operation group");
    const group = groups.get(row.operation_group_id) ?? [];
    group.push(row);
    groups.set(row.operation_group_id, group);
  }
  for (const group of groups.values()) {
    const expected = group[0]!.operation_expected_count;
    const sequence = group
      .map((r) => r.operation_sequence)
      .sort((a, b) => Number(a) - Number(b));
    // Existing operation builders use zero-based operationSequence.
    if (
      !Number.isSafeInteger(expected) ||
      Number(expected) <= 0 ||
      group.length !== expected ||
      group.some(
        (r) =>
          r.operation_expected_count !== expected ||
          r.operation_kind !== group[0]!.operation_kind,
      ) ||
      sequence.some((v, i) => v !== i)
    )
      throw new Error("Incomplete recovery operation group");
  }
}
export function validateRecoverySnapshot(snapshot: RecoverySnapshot): void {
  validateRecoveryHeader(snapshot.header);
  if (
    !snapshot.tables ||
    Object.keys(snapshot.tables).sort().join(",") !==
      [...RECOVERY_TABLES].sort().join(",")
  )
    throw new Error("Incomplete recovery table set");
  const shop = snapshot.header.shopId;
  const roles = new Set(snapshot.tables.roles.map((r) => r.id));
  for (const name of RECOVERY_TABLES) {
    const rows = snapshot.tables[name];
    if (!Array.isArray(rows)) throw new Error("Invalid recovery rows");
    const ids = new Set<string>();
    for (const row of rows) {
      if (
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        Object.values(row).some(
          (v) => v !== null && !["string", "number"].includes(typeof v),
        )
      )
        throw new Error("Invalid recovery row");
      inspectValue(row);
      const id = String(row.id);
      if (ids.has(id) || !id || id === "undefined")
        throw new Error("Duplicate recovery identity");
      ids.add(id);
      if (
        name === "shops"
          ? row.id !== shop
          : name === "permissions"
            ? !roles.has(row.role_id)
            : row.shop_id !== shop
      )
        throw new Error("Cross-shop recovery row");
      if (name === "sync_queue" || name === "recovery_journal") {
        if (
          !RECOVERY_BUSINESS_TABLES.includes(
            row.table_name as (typeof RECOVERY_BUSINESS_TABLES)[number],
          ) ||
          !["insert", "update", "delete"].includes(String(row.op))
        )
          throw new Error("Invalid recovery journal table or operation");
        const payload = JSON.parse(String(row.payload)) as Record<
          string,
          unknown
        >;
        inspectValue(payload);
        if (
          payload.id !== row.row_id ||
          (payload.shop_id !== undefined && payload.shop_id !== shop)
        )
          throw new Error("Recovery payload identity mismatch");
      }
      if (name === "conflict_queue") {
        inspectValue(JSON.parse(String(row.local_value)));
        inspectValue(JSON.parse(String(row.remote_value)));
        if (row.superseded_payloads) {
          for (const entry of recoverySupersededEntries(String(row.superseded_payloads))) {
            inspectValue(entry);
            inspectValue(JSON.parse(entry.payload));
          }
        }
      }
    }
  }
  if (
    snapshot.tables.shops.length !== 1 ||
    snapshot.tables.shops[0]!.owner_id !== snapshot.header.ownerId ||
    !snapshot.tables.users.some((r) => r.id === snapshot.header.ownerId)
  )
    throw new Error("Owner recovery identity mismatch");
  validateGroups(snapshot.tables.sync_queue);
  validateGroups(snapshot.tables.recovery_journal);
  const max = snapshot.tables.recovery_journal.reduce(
    (n, r) => Math.max(n, Number(r.id)),
    0,
  );
  if (max !== snapshot.header.watermark)
    throw new Error("Recovery watermark mismatch");
}
interface RecoveryEnvelope {
  header: RecoveryHeader;
  nonceHex: string;
  ciphertextHex: string;
}
export async function sealRecoverySnapshot(
  snapshot: RecoverySnapshot,
  code: string,
  cipher: RecoveryCipher,
): Promise<string> {
  validateRecoverySnapshot(snapshot);
  const nonce = await cipher.random(12);
  if (nonce.length !== 12) throw new Error("Secure random unavailable");
  const aad = recoveryUtf8(canonicalRecoveryJson(snapshot.header));
  const ciphertext = await cipher.seal(
    recoveryCodeBytes(code),
    nonce,
    recoveryUtf8(canonicalRecoveryJson(snapshot)),
    aad,
  );
  return canonicalRecoveryJson({
    header: snapshot.header,
    nonceHex: recoveryHex(nonce),
    ciphertextHex: recoveryHex(ciphertext),
  });
}
export async function openRecoverySnapshot(
  archive: string,
  code: string,
  expectedShop: string,
  cipher: RecoveryCipher,
): Promise<RecoverySnapshot> {
  if (archive.length > 64 * 1024 * 1024)
    throw new Error("Recovery archive too large");
  const envelope = JSON.parse(archive) as RecoveryEnvelope;
  validateRecoveryHeader(envelope.header);
  if (
    envelope.header.shopId !== expectedShop ||
    Object.keys(envelope).sort().join(",") !==
      "ciphertextHex,header,nonceHex" ||
    !/^[a-f0-9]{24}$/.test(envelope.nonceHex) ||
    typeof envelope.ciphertextHex !== "string" ||
    envelope.ciphertextHex.length < 32
  )
    throw new Error("Invalid recovery envelope");
  const plaintext = await cipher.open(
    recoveryCodeBytes(code),
    recoveryUnhex(envelope.nonceHex),
    recoveryUnhex(envelope.ciphertextHex),
    recoveryUtf8(canonicalRecoveryJson(envelope.header)),
  );
  const snapshot = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
  ) as RecoverySnapshot;
  validateRecoverySnapshot(snapshot);
  if (
    canonicalRecoveryJson(snapshot.header) !==
    canonicalRecoveryJson(envelope.header)
  )
    throw new Error("Recovery header mismatch");
  return snapshot;
}
