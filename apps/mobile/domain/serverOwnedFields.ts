// domain/serverOwnedFields.ts — which columns the SERVER owns on a push.
//
// This exists because of one question H-6's push-side detector has to answer
// correctly or not at all: when a pulled row differs from what this device
// pushed, is that a lost write, or is it the server legitimately rewriting a
// field it owns?
//
// Get it wrong in the "server-owned" direction and the detector goes blind on a
// real conflict — silently, because an absent notice looks exactly like no
// conflict. Get it wrong the other way and every shop with a plan or a tax
// snapshot raises false conflicts. The first failure mode is worse, and it is
// the one every draft of this list fell into, which is why
// tests/server-owned-fields.test.ts derives the whole thing from the migration
// SQL and the Edge sources rather than trusting what is written here.
//
// Pure: no database, no React, no native module.

import type { SyncTableName } from "../db/sync-helpers";

/**
 * Fields the server writes regardless of what the device sent, per table.
 *
 * SNAKE CASE, because that is the wire shape — the comparison runs against the
 * pushed payload (toSnakeCasePayload) and the pulled row, not against camelCase
 * local columns.
 *
 * Each entry names its authority. "Pinned" means a wrapper overwrites the
 * value; "stripped" means toSyncPayload never sends it, so the server's copy is
 * authoritative by default.
 */
export const SERVER_OWNED_FIELDS: Partial<
  Record<SyncTableName, readonly string[]>
> = {
  // 20260818000100 pins both from the server's own ledger, and applyToTable
  // preserves the local figures on the way in. Stock moves only via movements.
  batches: ["stock", "oversold_at"],

  // 20260831000000 (B4) pins the six commercial fields; toSyncPayload strips
  // cloud_linked_at, which is a device-local marker.
  //
  // W4-05 LANDED in Batch 3 (migration 35, 20261023000000), so the eight shop
  // IDENTITY fields are now pinned too and have moved here out of the
  // comparable set. The wrapper overwrites them from the stored row whenever
  // the caller is not the shop's owner.
  //
  // Listed UNCONDITIONALLY even though the pin is conditional on the actor.
  // The outbox records WHICH rows changed, not which actor pushed them, so a
  // device cannot tell locally whether its own push was an owner's. Treating
  // them as always server-owned costs the detector an equal-timestamp conflict
  // on the Owner's own shop-profile edit; treating them as always client-owned
  // would raise a false conflict on every non-owner shop push. Of the two
  // errors this one is quieter and does not cry wolf, and it is the choice
  // Batch 1's plan recorded when it specified the wrapper.
  shops: [
    "plan",
    "trial_ends_at",
    "billing_account_id",
    "commercial_status",
    "commercial_reason",
    "archived_at",
    "cloud_linked_at",
    "name",
    "name_en",
    "phone",
    "latitude",
    "longitude",
    "thana",
    "district",
    "location_captured_at",
  ],

  // Six stripped by toSyncPayload, then the five the staff-device wrapper and
  // revokeSessionsIfNeeded rewrite on an actor-aware basis. The outbox does not
  // record WHICH actor pushed, so the actor-dependent five cannot be reasoned
  // about locally and are excluded rather than guessed at.
  //
  // NOT listed: address, email. push.ts's applyUserProfileFields writes the
  // CLIENT's values in a separate statement predicated `.lte('updated_at', …)`,
  // so on the equal-timestamp drop they land even though the main upsert did
  // not. They are client-owned.
  users: [
    "permission_version",
    "pin_lookup_tag",
    "pin_lookup_pin_set_at",
    "plan_suspended_at",
    "plan_suspension_reason",
    "access_locked_at",
    "role_id",
    "is_active",
    "is_deleted",
    "pin_hash",
    "pin_set_at",
  ],

  // 20260827010000 refuses a changed tax snapshot with MU024 and then pins all
  // three to the existing values on any UPDATE. (On INSERT they are
  // client-defaulted, which push_superseded never examines — it only ever looks
  // at a row the server already holds.)
  sales: ["tax_amount", "tax_rate_bp", "tax_label"],

  // push.ts rewrites the category through canonicalizeExpensePayload before the
  // row reaches SQL, so a pushed value can legitimately come back canonicalised.
  expenses: ["category"],

  // Stripped by toSyncPayload: all three are local upload bookkeeping.
  sale_attachments: ["local_uri", "upload_status", "upload_error"],
};

/**
 * Tables that cannot produce a conflict at all.
 *
 * upsertRemoteRow applies these with onConflictDoNothing — they are append-only
 * ledgers and idempotent operation rows, so a redelivery writes nothing and
 * there is no "losing" side. Exactly six; the guard test derives the set from
 * sync-helpers.ts so it cannot drift from the switch statement.
 */
export const CONFLICT_EXEMPT_TABLES: readonly SyncTableName[] = [
  "inventory_movements",
  "sale_refunds",
  "refund_tenders",
  "credit_payment_allocations",
  "inventory_imports",
  "audit_logs",
];

const EXEMPT = new Set<string>(CONFLICT_EXEMPT_TABLES);

export function isConflictExemptTable(table: string): boolean {
  return EXEMPT.has(table);
}

/**
 * Bookkeeping columns every table carries. Excluded from the comparison because
 * a difference in them is never the thing a shopkeeper is being asked about:
 * `updated_at` is the LWW key itself (compared separately), and the rest move
 * with it mechanically.
 */
const UNIVERSAL_EXCLUSIONS: readonly string[] = [
  "id",
  "created_at",
  "updated_at",
  "is_dirty",
];

/**
 * Is this field worth comparing for `table`?
 *
 * A field is comparable when it is neither universal bookkeeping nor
 * server-owned. Callers additionally intersect with the keys actually present
 * in both payloads, so a column one side has never heard of is not a conflict.
 */
export function isComparableField(table: SyncTableName, field: string): boolean {
  if (UNIVERSAL_EXCLUSIONS.includes(field)) return false;
  return !(SERVER_OWNED_FIELDS[table] ?? []).includes(field);
}

/** The comparable subset of a pair of payloads, for diffing. */
export function comparableFields(
  table: SyncTableName,
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): readonly string[] {
  const shared = new Set<string>();
  for (const key of Object.keys(left)) {
    if (key in right) shared.add(key);
  }
  return [...shared].filter((field) => isComparableField(table, field)).sort();
}
