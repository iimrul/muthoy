import {
  applyRemoteRows,
  purgeUnreadableTables,
  type SyncTableName,
} from "../db/sync-helpers";
import {
  getLastPulledCursor,
  HYDRATION_TABLE_ORDER,
  setLastPulledCursor,
  type PullCursor,
} from "./cursorStore";
import { invokeSyncWithClaimRefresh, SyncHaltedError } from "./invoke";
import { isSupabaseConfigured } from "./supabaseClient";
import type { AuthTimingTrace } from "../dev/authTiming";

interface PullChange {
  updatedAt: string;
  tableName: SyncTableName;
  rowId: string;
  payload: Record<string, unknown>;
}

interface PullPage {
  changes: PullChange[];
  hasMore: boolean;
  nextCursor: PullCursor | null;
  accessVersion: number;
  /**
   * The tables this caller may still hold locally, present only on the page
   * that asked for it. Absent means "no answer" — the device keeps what it has.
   */
  access?: {
    readableTables: SyncTableName[];
    actorUserId: string;
    saleHistoryScope: "all" | "own";
  };
}

const SYNC_TABLE_NAMES = new Set<string>(HYDRATION_TABLE_ORDER);
const ALWAYS_READABLE_TABLES = [
  "shops",
  "subscriptions",
  "roles",
  "permissions",
  "users",
  "user_permissions",
  "shop_b2_settings",
  "sales",
  "sale_items",
  "sale_attachments",
  "sale_refunds",
  "sales_returns",
  "refund_tenders",
] as const satisfies readonly SyncTableName[];

function isSyncTableName(value: unknown): value is SyncTableName {
  return typeof value === "string" && SYNC_TABLE_NAMES.has(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function parseAccessAnswer(response: Record<string, unknown>): PullPage["access"] {
  if (!("readableTables" in response)) return undefined;
  const value = response.readableTables;
  const actorUserId = response.accessUserId;
  const saleHistoryScope = response.saleHistoryScope;
  if (
    !Array.isArray(value)
    || value.some((entry) => !isSyncTableName(entry))
    || new Set(value).size !== value.length
    || ALWAYS_READABLE_TABLES.some((table) => !value.includes(table))
    || typeof actorUserId !== "string"
    || actorUserId.length === 0
    || (saleHistoryScope !== "all" && saleHistoryScope !== "own")
  ) {
    // A malformed access answer must never be partially interpreted. The pull
    // may still apply valid rows, but reconciliation is skipped wholesale.
    return undefined;
  }
  return {
    readableTables: value as SyncTableName[],
    actorUserId,
    saleHistoryScope,
  };
}

function parseCursor(value: unknown): PullCursor | null {
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== "object") {
    throw new Error("Sync pull returned an invalid cursor.");
  }
  const cursor = value as Partial<PullCursor>;
  if (
    !isString(cursor.updatedAt) ||
    !isSyncTableName(cursor.tableName) ||
    !isString(cursor.rowId)
  ) {
    throw new Error("Sync pull returned an invalid cursor.");
  }
  return {
    updatedAt: cursor.updatedAt,
    tableName: cursor.tableName,
    rowId: cursor.rowId,
  };
}

function parsePullPage(value: unknown): PullPage {
  if (!value || typeof value !== "object") {
    throw new Error("Sync pull returned an invalid response.");
  }
  const response = value as {
    changes?: unknown;
    hasMore?: unknown;
    nextCursor?: unknown;
    accessVersion?: unknown;
  };
  if (
    !Array.isArray(response.changes) ||
    typeof response.hasMore !== "boolean" ||
    !Number.isSafeInteger(response.accessVersion) ||
    (response.accessVersion as number) < 0
  ) {
    throw new Error("Sync pull returned an invalid response.");
  }
  const changes = response.changes.map((item): PullChange => {
    if (!item || typeof item !== "object") {
      throw new Error("Sync pull returned an invalid change.");
    }
    const change = item as Partial<PullChange>;
    if (
      !isSyncTableName(change.tableName) ||
      !isString(change.rowId) ||
      !isString(change.updatedAt) ||
      !change.payload ||
      typeof change.payload !== "object" ||
      Array.isArray(change.payload)
    ) {
      throw new Error("Sync pull returned an invalid change.");
    }
    return {
      tableName: change.tableName,
      rowId: change.rowId,
      updatedAt: change.updatedAt,
      payload: change.payload as Record<string, unknown>,
    };
  });
  const access = parseAccessAnswer(value as Record<string, unknown>);

  return {
    changes,
    hasMore: response.hasMore,
    nextCursor: parseCursor(response.nextCursor),
    accessVersion: response.accessVersion as number,
    ...(access ? { access } : {}),
  };
}

async function fetchPullPage(
  shopId: string,
  cursor: PullCursor | null,
  timing?: AuthTimingTrace,
  includeAccess = false,
): Promise<PullPage> {
  const { data, error } = await invokeSyncWithClaimRefresh({
    action: "pull",
    shopId,
    since: cursor,
    // Only the first page of a cycle asks. The answer costs a permission
    // resolution per table server-side. Every page still carries accessVersion;
    // a mid-cycle change makes this cycle restart from its original cursor.
    ...(includeAccess ? { includeAccess: true } : {}),
    ...(timing ? { _timingId: timing.correlationId } : {}),
  });
  if (error) {
    throw error;
  }
  return parsePullPage(data);
}

/**
 * Drops rows for tables this caller may no longer hold.
 *
 * Runs AFTER a pull completes, never during one — a purge interleaved with an
 * apply could delete rows the same cycle is still writing. A cancelled or
 * failed pull purges nothing, so a device that changed hands mid-sync is left
 * exactly as it was for the next login to hydrate from scratch.
 */
function reconcileLocalAccess(
  shopId: string,
  access: PullPage["access"],
): void {
  if (!access) {
    return;
  }
  purgeUnreadableTables({ shopId, ...access });
}

class AccessChangedDuringPullError extends Error {
  constructor() {
    super("Access changed during paginated pull");
    this.name = "AccessChangedDuringPullError";
  }
}

function requireStableAccessVersion(
  expected: number | undefined,
  page: PullPage,
): number {
  if (expected !== undefined && page.accessVersion !== expected) {
    throw new AccessChangedDuringPullError();
  }
  return page.accessVersion;
}

function requireNextCursor(page: PullPage): PullCursor {
  if (!page.nextCursor) {
    throw new Error("Non-empty sync pull page omitted its next cursor.");
  }
  return page.nextCursor;
}

/**
 * Applies one batch of pulled rows and returns those that could not land yet.
 *
 * `applyRemoteRows` orders parents before dependents itself, so nothing here
 * needs to sort. What it cannot do is invent a parent that is still on the
 * server: a movement can be separated from its batch by a PAGE BOUNDARY, and
 * that row comes back as `deferred` for the caller to carry forward.
 */
function applyChanges(
  changes: PullChange[],
  moreToCome: boolean,
): PullChange[] {
  if (changes.length === 0) {
    return [];
  }
  const results = applyRemoteRows(
    changes.map((change) => ({
      tableName: change.tableName,
      row: change.payload,
    })),
    { moreToCome },
  );
  return changes.filter((_, index) => results[index] === "deferred");
}

async function pullFullHydration(
  shopId: string,
  isCancelled: () => boolean,
  timing?: AuthTimingTrace,
): Promise<void> {
  const discoveredChanges: PullChange[] = [];
  let cursor: PullCursor | null = null;
  let finalCursor: PullCursor | null = null;
  let access: PullPage["access"];
  let accessVersion: number | undefined;
  let first = true;

  while (true) {
    if (isCancelled()) {
      return;
    }
    const page = await fetchPullPage(shopId, cursor, timing, first);
    accessVersion = requireStableAccessVersion(accessVersion, page);
    access = access ?? page.access;
    first = false;
    // Abandoning a hydration mid-flight applies nothing and stores no cursor,
    // so the next login starts the full hydration over rather than inheriting
    // a half-populated shop.
    if (isCancelled()) {
      return;
    }
    discoveredChanges.push(...page.changes);

    if (page.changes.length > 0) {
      cursor = requireNextCursor(page);
      finalCursor = cursor;
    }

    if (!page.hasMore) {
      break;
    }
    if (page.changes.length === 0 || !page.nextCursor) {
      throw new Error("Sync pull cannot advance its pagination cursor.");
    }
  }

  if (isCancelled()) {
    return;
  }
  // ONE transaction for the entire hydration — the apply is synchronous, so
  // the check above covers the whole phase.
  //
  // This used to commit in chunks of 50, which meant a hydration that failed
  // partway through left a PREFIX of the shop on disk: some batches present,
  // most of their movement history missing, and every quantity short by
  // whatever had not been applied. The invariant held on each committed chunk,
  // so nothing detected it — the owner simply saw wrong stock with no way to
  // tell it apart from the truth. All or nothing instead: a failed hydration
  // rolls back to an empty shop and no cursor, so the next login starts over.
  applyChanges(discoveredChanges, false);
  // A fresh hydration cannot hold anything it was not just sent, so this is a
  // no-op in practice. It runs anyway so both pull paths obey one rule.
  reconcileLocalAccess(shopId, access);

  if (finalCursor) {
    setLastPulledCursor(shopId, finalCursor);
  }
}

async function pullIncremental(
  shopId: string,
  initialCursor: PullCursor,
  isCancelled: () => boolean,
): Promise<void> {
  let cursor = initialCursor;
  // Rows whose parent has not arrived yet ride along to the next page's apply.
  // Incremental pull commits page by page so a long backlog makes forward
  // progress; this is what keeps that safe when a batch and its movement fall
  // on opposite sides of a page boundary.
  let deferred: PullChange[] = [];
  let access: PullPage["access"];
  let accessVersion: number | undefined;
  let first = true;

  while (true) {
    if (isCancelled()) {
      return;
    }
    const page = await fetchPullPage(shopId, cursor, undefined, first);
    accessVersion = requireStableAccessVersion(accessVersion, page);
    access = access ?? page.access;
    first = false;
    // Applying rows and advancing the cursor are both writes. Neither may
    // happen once the device has changed hands — the page is simply dropped,
    // and the unmoved cursor makes the next login fetch it again.
    if (isCancelled()) {
      return;
    }
    deferred = applyChanges([...deferred, ...page.changes], page.hasMore);

    if (page.changes.length > 0) {
      cursor = requireNextCursor(page);
      // The cursor means "everything up to here is applied". Holding it back
      // while a row is still deferred is what makes a crash mid-backlog
      // re-fetch the page that carried it instead of stepping over it.
      if (deferred.length === 0) {
        setLastPulledCursor(shopId, cursor);
      }
    }

    if (!page.hasMore) {
      // The backlog is drained and every page has been applied, so dropping
      // now-forbidden rows cannot race an apply that is still writing them.
      reconcileLocalAccess(shopId, access);
      return;
    }
    if (page.changes.length === 0 || !page.nextCursor) {
      throw new Error("Sync pull cannot advance its pagination cursor.");
    }
  }
}

export async function pullChanges(
  shopId: string,
  cursorOverride?: PullCursor | null,
  isCancelled: () => boolean = () => false,
  timing?: AuthTimingTrace,
): Promise<void> {
  if (!isSupabaseConfigured) {
    if (cursorOverride === null) {
      throw new Error("Supabase is not configured. Cannot hydrate this shop.");
    }
    return;
  }

  const initialCursor =
    cursorOverride === undefined ? getLastPulledCursor(shopId) : cursorOverride;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (initialCursor === null) {
        await pullFullHydration(shopId, isCancelled, timing);
      } else {
        await pullIncremental(shopId, initialCursor, isCancelled);
      }
      return;
    } catch (error) {
      if (!(error instanceof AccessChangedDuringPullError)) throw error;
      if (attempt === 1) {
        throw new SyncHaltedError(
          "Permissions changed repeatedly during sync; sign in again",
          "permissions_changed",
          error,
        );
      }
      // Restart from the ORIGINAL cursor/page one. Full hydration has not
      // applied anything yet; incremental replays safely through LWW/idempotent
      // apply while replacing the stale first-page access answer.
    }
  }
}
