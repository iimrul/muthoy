import { applyRemoteRows, type SyncTableName } from "../db/sync-helpers";
import {
  getLastPulledCursor,
  HYDRATION_TABLE_ORDER,
  setLastPulledCursor,
  type PullCursor,
} from "./cursorStore";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

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

const HYDRATION_APPLY_CHUNK_SIZE = 50;
const HYDRATION_TABLE_RANK = new Map<SyncTableName, number>(
  HYDRATION_TABLE_ORDER.map((tableName, index) => [tableName, index]),
);
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
  const { data, error } = await supabase.functions.invoke("sync", {
    body: { action: "pull", shopId, since: cursor },
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

function applyChanges(changes: PullChange[]): void {
  applyRemoteRows(
    changes.map((change) => ({
      tableName: change.tableName,
      row: change.payload,
    })),
  );
}

function orderForHydration(changes: PullChange[]): PullChange[] {
  return changes
    .map((change, discoveryIndex) => ({ change, discoveryIndex }))
    .sort((left, right) => {
      const tableRankDifference =
        HYDRATION_TABLE_RANK.get(left.change.tableName)! -
        HYDRATION_TABLE_RANK.get(right.change.tableName)!;
      return tableRankDifference || left.discoveryIndex - right.discoveryIndex;
    })
    .map(({ change }) => change);
}

async function pullFullHydration(shopId: string): Promise<void> {
  const discoveredChanges: PullChange[] = [];
  let cursor: PullCursor | null = null;
  let finalCursor: PullCursor | null = null;

  while (true) {
    const page = await fetchPullPage(shopId, cursor);
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

  const orderedChanges = orderForHydration(discoveredChanges);
  for (
    let offset = 0;
    offset < orderedChanges.length;
    offset += HYDRATION_APPLY_CHUNK_SIZE
  ) {
    applyChanges(
      orderedChanges.slice(offset, offset + HYDRATION_APPLY_CHUNK_SIZE),
    );
  }

  if (finalCursor) {
    setLastPulledCursor(shopId, finalCursor);
  }
}

async function pullIncremental(
  shopId: string,
  initialCursor: PullCursor,
): Promise<void> {
  let cursor = initialCursor;
  while (true) {
    const page = await fetchPullPage(shopId, cursor);
    applyChanges(page.changes);

    if (page.changes.length > 0) {
      cursor = requireNextCursor(page);
      setLastPulledCursor(shopId, cursor);
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
    await pullFullHydration(shopId);
    return;
  }
  await pullIncremental(shopId, initialCursor);
}
