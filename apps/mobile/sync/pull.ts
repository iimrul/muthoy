import { applyRemoteRows, type SyncTableName } from "../db/sync-helpers";
import {
  getLastPulledCursor,
  HYDRATION_TABLE_ORDER,
  setLastPulledCursor,
  type PullCursor,
} from "./cursorStore";
import { invokeSyncWithClaimRefresh } from "./invoke";
import { isSupabaseConfigured } from "./supabaseClient";

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
}

const SYNC_TABLE_NAMES = new Set<string>(HYDRATION_TABLE_ORDER);

function isSyncTableName(value: unknown): value is SyncTableName {
  return typeof value === "string" && SYNC_TABLE_NAMES.has(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
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
  };
  if (
    !Array.isArray(response.changes) ||
    typeof response.hasMore !== "boolean"
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
  return {
    changes,
    hasMore: response.hasMore,
    nextCursor: parseCursor(response.nextCursor),
  };
}

async function fetchPullPage(
  shopId: string,
  cursor: PullCursor | null,
): Promise<PullPage> {
  const { data, error } = await invokeSyncWithClaimRefresh({
    action: "pull",
    shopId,
    since: cursor,
  });
  if (error) {
    throw error;
  }
  return parsePullPage(data);
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
): Promise<void> {
  const discoveredChanges: PullChange[] = [];
  let cursor: PullCursor | null = null;
  let finalCursor: PullCursor | null = null;

  while (true) {
    if (isCancelled()) {
      return;
    }
    const page = await fetchPullPage(shopId, cursor);
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

  while (true) {
    if (isCancelled()) {
      return;
    }
    const page = await fetchPullPage(shopId, cursor);
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
): Promise<void> {
  if (!isSupabaseConfigured) {
    if (cursorOverride === null) {
      throw new Error("Supabase is not configured. Cannot hydrate this shop.");
    }
    return;
  }

  const initialCursor =
    cursorOverride === undefined ? getLastPulledCursor(shopId) : cursorOverride;
  if (initialCursor === null) {
    await pullFullHydration(shopId, isCancelled);
    return;
  }
  await pullIncremental(shopId, initialCursor, isCancelled);
}
