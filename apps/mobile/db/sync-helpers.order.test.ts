import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const helperSource = readFileSync(
  resolve("apps/mobile/db/sync-helpers.ts"),
  "utf8",
);
const schemaSource = readFileSync(resolve("apps/mobile/db/schema.ts"), "utf8");

function hydrationOrder(): string[] {
  const block = helperSource.match(
    /export const HYDRATION_TABLE_ORDER = \[([\s\S]*?)\] as const/,
  );
  if (!block?.[1]) throw new Error("HYDRATION_TABLE_ORDER not found");
  return [...block[1].matchAll(/["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);
}

function syncedSchemaTables(): string[] {
  const localOnly = new Set(["notifications", "sync_queue", "conflict_queue"]);
  return [...schemaSource.matchAll(/sqliteTable\(["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((table): table is string => table !== undefined)
    .filter((table) => !localOnly.has(table));
}

interface ForeignKeyEdge {
  source: string;
  target: string;
}

function foreignKeyEdges(): ForeignKeyEdge[] {
  const variableToTable = new Map(
    [
      ...schemaSource.matchAll(/export const (\w+) = sqliteTable\(["']([^"']+)["']/g),
    ].map((match) => [match[1], match[2]] as const),
  );
  const edges: ForeignKeyEdge[] = [];
  const tableBlocks = schemaSource.matchAll(
    /export const (\w+) = sqliteTable\(["']([^"']+)["'], \{([\s\S]*?)\n\}, \(t\)/g,
  );
  for (const block of tableBlocks) {
    const source = block[2];
    const body = block[3] ?? "";
    if (!source) continue;
    for (const reference of body.matchAll(/references\(\(\) => (\w+)\.id/g)) {
      const target = reference[1]
        ? variableToTable.get(reference[1])
        : undefined;
      if (target) edges.push({ source, target });
    }
  }
  return edges;
}

describe("HYDRATION_TABLE_ORDER", () => {
  it("contains every syncable table exactly once", () => {
    const order = hydrationOrder();
    expect(order).toHaveLength(21);
    expect(new Set(order).size).toBe(order.length);
    expect(new Set(order)).toEqual(new Set(syncedSchemaTables()));
  });

  it("places every FK target before its source table", () => {
    const order = hydrationOrder();
    const rank = new Map(order.map((table, index) => [table, index]));
    const synced = new Set(order);
    const violations = foreignKeyEdges().filter(
      ({ source, target }) =>
        synced.has(source) &&
        synced.has(target) &&
        (rank.get(target) ?? Infinity) >= (rank.get(source) ?? -1),
    );
    expect(violations).toEqual([]);
  });
});
