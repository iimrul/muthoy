// db/conflicts.ts — H-6's writer, reader and resolver.
//
// The detector itself lives in sync-helpers.ts, inside the apply transaction,
// because that is the only place that sees both sides of a row at once. This
// module owns everything around it: recording a notice, de-duplicating repeat
// sightings, listing what an actor may see, and applying a decision.
//
// Two rules govern the whole file:
//
//   1. FAIL SOFT on detection. A conflict notice is worth less than the sync
//      that carries the shop's money, so recording one never throws into the
//      apply path (see tryRecordConflict in sync-helpers.ts).
//   2. FAIL CLOSED on resolution. Choosing a side mutates business data, so it
//      re-derives authorization, re-reads the row, and commits atomically.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./client";
import { conflictQueue, syncQueue } from "./schema";
import { generateId } from "../native/id";
import { assertSessionLive, NotAuthorizedError } from "./errors";
import {
  conflictPolicyFor,
  satisfiesGate,
  type ConflictGate,
} from "../domain/conflictTables";
import {
  resolvePermission,
  toRole,
  type PermissionOverrides,
  type Role,
} from "../domain/permissions";
import {
  applyConflictRemoteRow,
  bumpRowUpdatedAt,
  recordChange,
  type DbTransaction,
  type SyncTableName,
} from "./sync-helpers";

export type ConflictReason = "pull_local_pending" | "push_superseded";
export type ConflictResolution = "keep_local" | "keep_remote";

export interface ConflictRecordInput {
  readonly shopId: string;
  readonly tableName: SyncTableName;
  readonly rowId: string;
  readonly reason: ConflictReason;
  readonly localValue: Readonly<Record<string, unknown>>;
  readonly remoteValue: Readonly<Record<string, unknown>>;
  readonly localUpdatedAt: string | null;
  readonly remoteUpdatedAt: string | null;
  readonly detectedBy?: string | null;
}

/**
 * Records one conflict, or bumps the existing unresolved notice for that row.
 *
 * Runs inside the caller's transaction so the notice and the row-apply commit
 * together: a conflict recorded against an apply that then rolled back would
 * describe a state that never existed.
 *
 * De-duplication is by (shopId, tableName, rowId) over UNRESOLVED rows, which
 * migration 0031 also enforces with a partial unique index. createdAt keeps the
 * first sighting; the snapshots and updatedAt are refreshed so the owner sees
 * the CURRENT disagreement rather than a stale one.
 */
export function recordConflict(
  tx: DbTransaction,
  input: ConflictRecordInput,
  now: () => Date = () => new Date(),
): void {
  const timestamp = now().toISOString();
  const existing = tx
    .select({ id: conflictQueue.id, occurrences: conflictQueue.occurrences })
    .from(conflictQueue)
    .where(
      and(
        eq(conflictQueue.shopId, input.shopId),
        eq(conflictQueue.tableName, input.tableName),
        eq(conflictQueue.rowId, input.rowId),
        eq(conflictQueue.resolved, false),
      ),
    )
    .get();

  if (existing) {
    tx.update(conflictQueue)
      .set({
        reason: input.reason,
        localValue: JSON.stringify(input.localValue),
        remoteValue: JSON.stringify(input.remoteValue),
        localUpdatedAt: input.localUpdatedAt,
        remoteUpdatedAt: input.remoteUpdatedAt,
        occurrences: existing.occurrences + 1,
        updatedAt: timestamp,
      })
      .where(eq(conflictQueue.id, existing.id))
      .run();
    return;
  }

  tx.insert(conflictQueue)
    .values({
      id: generateId(),
      shopId: input.shopId,
      tableName: input.tableName,
      rowId: input.rowId,
      reason: input.reason,
      localValue: JSON.stringify(input.localValue),
      remoteValue: JSON.stringify(input.remoteValue),
      localUpdatedAt: input.localUpdatedAt,
      remoteUpdatedAt: input.remoteUpdatedAt,
      detectedBy: input.detectedBy ?? null,
      resolved: false,
      occurrences: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

/**
 * A RE-DERIVED actor. Never built from a caller's claim.
 *
 * The screen holds a session with a role and an override snapshot, and an
 * earlier version of this module accepted both. That repeated the mistake
 * db/auth.ts's requirePermission exists to prevent: a stale or edited
 * persisted session, or a direct call, would decide its own authorization.
 * `conflictActor` below reads the role and the overrides out of SQLite in the
 * same breath, so an owner's revoke takes effect on the very next action.
 */
export interface ConflictActor {
  readonly userId: string;
  readonly role: Role;
  readonly permissions?: PermissionOverrides;
}

/**
 * Reads this actor's live standing for this shop. Returns null when the actor
 * has no usable role here, which every caller treats as "see nothing, resolve
 * nothing" rather than as an error.
 *
 * Called BEFORE any transaction opens, exactly as requirePermission is, so a
 * denial leaves no partial work.
 */
export async function conflictActor(
  shopId: string,
  actorUserId: string,
): Promise<ConflictActor | null> {
  const { getActiveSessionRole, getUserPermissionOverrides } = await import("./auth");
  const role = toRole(await getActiveSessionRole(actorUserId, shopId));
  if (!role) return null;
  return {
    userId: actorUserId,
    role,
    permissions: await getUserPermissionOverrides(shopId, actorUserId),
  };
}

export interface ConflictListRow {
  readonly id: string;
  readonly tableName: SyncTableName;
  readonly rowId: string;
  readonly reason: ConflictReason;
  readonly localValue: Record<string, unknown>;
  readonly remoteValue: Record<string, unknown>;
  readonly localUpdatedAt: string | null;
  readonly remoteUpdatedAt: string | null;
  readonly occurrences: number;
  readonly createdAt: string;
  /** False when the actor may see the notice but not choose a side. */
  readonly canResolve: boolean;
  /**
   * True when any outbox row for this key belongs to an atomic operation group.
   * keep_remote is withheld for these: cancelling one member of a sale, refund
   * or purchase group would leave a torn money operation, which is worse than
   * an unresolved notice.
   */
  readonly isGrouped: boolean;
}

function gateFor(actor: ConflictActor) {
  return (gate: ConflictGate): boolean =>
    satisfiesGate(gate, { isOwner: actor.role === "owner" }, (permission) =>
      resolvePermission(actor.role, permission, actor.permissions),
    );
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function hasGroupedOutboxRow(
  shopId: string,
  tableName: string,
  rowId: string,
): boolean {
  const grouped = db
    .select({ id: syncQueue.id })
    .from(syncQueue)
    .where(
      and(
        eq(syncQueue.shopId, shopId),
        eq(syncQueue.tableName, tableName),
        eq(syncQueue.rowId, rowId),
        inArray(syncQueue.status, ["pending", "failed"]),
        sql`operation_group_id is not null`,
      ),
    )
    .get();
  return Boolean(grouped);
}

/**
 * Unresolved conflicts this actor may SEE, oldest first.
 *
 * Filtering happens here rather than in the screen so there is one place to get
 * it right, and so a future caller cannot accidentally read the whole table.
 * Tenant isolation is the shopId predicate: a conflict belonging to another
 * shop is unreachable, not merely hidden.
 */
export async function listConflicts(
  shopId: string,
  actorUserId: string,
): Promise<readonly ConflictListRow[]> {
  const actor = await conflictActor(shopId, actorUserId);
  // No usable role in this shop: see nothing. A conflict notice carries row
  // payloads, so "unknown standing" must disclose nothing at all.
  if (!actor) return [];
  const satisfies = gateFor(actor);
  const rows = db
    .select()
    .from(conflictQueue)
    .where(
      and(eq(conflictQueue.shopId, shopId), eq(conflictQueue.resolved, false)),
    )
    .orderBy(asc(conflictQueue.createdAt))
    .all();

  const visible: ConflictListRow[] = [];
  for (const row of rows) {
    const policy = conflictPolicyFor(row.tableName as SyncTableName);
    // An unknown table is withheld rather than shown: a table this build does
    // not recognise is one whose disclosure rules it cannot reason about.
    if (!policy || !satisfies(policy.read)) continue;
    visible.push({
      id: row.id,
      tableName: row.tableName as SyncTableName,
      rowId: row.rowId,
      reason: row.reason,
      localValue: parseJsonObject(row.localValue),
      remoteValue: parseJsonObject(row.remoteValue),
      localUpdatedAt: row.localUpdatedAt,
      remoteUpdatedAt: row.remoteUpdatedAt,
      occurrences: row.occurrences,
      createdAt: row.createdAt,
      canResolve: satisfies(policy.write),
      isGrouped: hasGroupedOutboxRow(shopId, row.tableName, row.rowId),
    });
  }
  return visible;
}

/** Badge count. Same visibility rule as the list, so the two cannot disagree. */
export async function countVisibleConflicts(
  shopId: string,
  actorUserId: string,
): Promise<number> {
  return (await listConflicts(shopId, actorUserId)).length;
}

export class ConflictNotFoundError extends Error {
  constructor() {
    super("That conflict is no longer listed.");
    this.name = "ConflictNotFoundError";
  }
}

export class ConflictGroupedOperationError extends Error {
  constructor() {
    super(
      "This change is part of one operation and cannot be partly discarded. Keep this device's version, or let it finish syncing.",
    );
    this.name = "ConflictGroupedOperationError";
  }
}

/**
 * Applies a decision. ONE transaction: the row write, the outbox supersession
 * and the resolution stamp commit together or not at all.
 *
 * keep_local re-enqueues the local row through recordChange with a FRESH
 * updated_at, so the next push beats the server's timestamp instead of being
 * dropped by the same strict-< predicate that caused the conflict. It inherits
 * recordChange's commercial read-only and shop-limit gates for free.
 *
 * keep_remote force-applies the stored snapshot through applyConflictRemoteRow
 * — NOT applyRemoteRow, which returns 'skipped_stale' for exactly these rows
 * and would have been a silent no-op on every real conflict — then DELETES the
 * superseded outbox rows, preserving their exact bytes in superseded_payloads.
 */
export async function resolveConflict(
  shopId: string,
  conflictId: string,
  actorUserId: string,
  resolution: ConflictResolution,
  isStillActive: () => boolean,
  now: () => Date = () => new Date(),
): Promise<void> {
  // Authorization is re-derived from SQLite BEFORE the transaction opens, the
  // same order db/auth.ts's requirePermission uses, so a denial writes nothing.
  const actor = await conflictActor(shopId, actorUserId);
  if (!actor) throw new NotAuthorizedError();
  const satisfies = gateFor(actor);
  db.transaction((tx) => {
    assertSessionLive(isStillActive);
    const row = tx
      .select()
      .from(conflictQueue)
      .where(
        and(
          eq(conflictQueue.id, conflictId),
          eq(conflictQueue.shopId, shopId),
          eq(conflictQueue.resolved, false),
        ),
      )
      .get();
    // Also the idempotency guard: a second resolve finds nothing unresolved.
    if (!row) throw new ConflictNotFoundError();

    const tableName = row.tableName as SyncTableName;
    const policy = conflictPolicyFor(tableName);
    if (!policy || !satisfies(policy.read) || !satisfies(policy.write)) {
      throw new NotAuthorizedError();
    }

    const timestamp = now().toISOString();
    let supersededPayloads: string | null = null;

    if (resolution === "keep_remote") {
      if (hasGroupedOutboxRow(shopId, tableName, row.rowId)) {
        throw new ConflictGroupedOperationError();
      }
      applyConflictRemoteRow(tx, tableName, parseJsonObject(row.remoteValue));
      const superseded = tx
        .select({
          id: syncQueue.id,
          seq: syncQueue.seq,
          op: syncQueue.op,
          payload: syncQueue.payload,
        })
        .from(syncQueue)
        .where(
          and(
            eq(syncQueue.shopId, shopId),
            eq(syncQueue.tableName, tableName),
            eq(syncQueue.rowId, row.rowId),
            inArray(syncQueue.status, ["pending", "failed"]),
          ),
        )
        .all();
      if (superseded.length > 0) {
        // Exact bytes, captured BEFORE the delete. `payload` is the serialised
        // string recordChange wrote, so this is byte-faithful rather than a
        // re-serialisation of whatever the local row happens to say now.
        supersededPayloads = JSON.stringify(superseded);
        tx.delete(syncQueue)
          .where(
            inArray(
              syncQueue.id,
              superseded.map((entry) => entry.id),
            ),
          )
          .run();
      }
    } else {
      // keep_local. The row's `updated_at` must be pushed STRICTLY FORWARD
      // first, and this is the whole mechanism: sync_apply_row's predicate is
      // `<`, so re-queueing the row at its existing timestamp would be dropped
      // by exactly the rule that caused the conflict. An earlier version called
      // recordChange alone and did nothing — the decision looked applied and
      // the next push lost it again, silently.
      //
      // Strictly greater than every timestamp in play: the local row, the
      // server's copy, whatever is already queued, and now. `now` alone is not
      // enough — a device whose clock lags the server would mint a timestamp
      // the server still refuses.
      const candidates = [
        row.localUpdatedAt,
        row.remoteUpdatedAt,
        now().toISOString(),
      ].filter((value): value is string => typeof value === "string" && value.length > 0);
      const highWater = candidates.reduce((left, right) => (left > right ? left : right));
      const nextUpdatedAt = new Date(
        Math.max(Date.parse(highWater) + 1, now().getTime()),
      ).toISOString();
      bumpRowUpdatedAt(tx, tableName, row.rowId, nextUpdatedAt);
      // recordChange re-reads the complete row, so it picks the bumped value up
      // rather than being handed a snapshot to trust.
      recordChange(tx, {
        shopId,
        table: tableName,
        rowId: row.rowId,
        op: "update",
        payload: {},
      });
    }

    tx.update(conflictQueue)
      .set({
        resolved: true,
        resolution,
        resolvedAt: timestamp,
        updatedAt: timestamp,
        detectedBy: row.detectedBy ?? actor.userId,
        supersededPayloads,
      })
      .where(eq(conflictQueue.id, row.id))
      .run();

    assertSessionLive(isStillActive);
  });
}

/**
 * Drops conflict notices for tables this device may no longer hold.
 *
 * Called from purgeUnreadableTables. The snapshots are row payloads, so a
 * cashier who loses cash_management must lose the expense snapshots too —
 * otherwise the conflict screen becomes a way to read data the access
 * reconciliation just took away.
 */
export function purgeConflictsForTables(
  tx: DbTransaction,
  shopId: string,
  tableNames: readonly string[],
): number {
  if (tableNames.length === 0) return 0;
  const result = tx
    .delete(conflictQueue)
    .where(
      and(
        eq(conflictQueue.shopId, shopId),
        inArray(conflictQueue.tableName, [...tableNames]),
      ),
    )
    .run();
  return result.changes ?? 0;
}
