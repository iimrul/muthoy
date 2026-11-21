// db/dhakaDay.ts on real SQLite. What the founder approved (rule 10) is a
// faster query with IDENTICAL results: the index range in front of the Dhaka
// day rule may only skip rows the rule itself would reject. These tests pin
// that on every timestamp shape the app can store, at every day boundary, and
// that SQLite really answers it from the (shop_id, created_at) index.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { DHAKA_SQL_OFFSET } from "@muthoy/utils";
import { onDhakaDay } from "./dhakaDay";

const OFFSETS = ["Z", "+00:00", "+06:00", "-05:30", "+14:00", "-14:00"];
const DAYS = ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"];

/** Every half hour from 18 Nov to 25 Nov (UTC), written in each stored shape. */
function timestamps(): string[] {
  const values: string[] = [];
  for (let at = Date.UTC(2026, 10, 18); at < Date.UTC(2026, 10, 25); at += 30 * 60_000) {
    const utc = new Date(at);
    const iso = utc.toISOString(); // 2026-11-21T03:30:00.000Z
    values.push(iso, iso.replace("T", " ").replace(".000Z", ""));
    for (const offset of OFFSETS.slice(1)) {
      const sign = offset.startsWith("-") ? -1 : 1;
      const [hours, minutes] = offset.slice(1).split(":").map(Number);
      const local = new Date(at + sign * ((hours ?? 0) * 60 + (minutes ?? 0)) * 60_000);
      values.push(`${local.toISOString().slice(0, 19)}${offset}`);
    }
  }
  // The exact minutes either side of the Dhaka midnight (18:00Z).
  values.push("2026-11-20T17:59:59.999Z", "2026-11-20T18:00:00.000Z", "2026-11-21T17:59:59.999Z", "2026-11-21T18:00:00.000Z");
  return values;
}

describe("onDhakaDay returns exactly the rows the Dhaka day rule returns", () => {
  const memory = new DatabaseSync(":memory:");
  beforeAll(() => {
    memory.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL)");
    const insert = memory.prepare("INSERT INTO t (created_at) VALUES (?)");
    for (const value of timestamps()) insert.run(value);
  });

  it.each(DAYS)("for business day %s, in every stored timestamp shape", (day) => {
    const exact = memory
      .prepare(`SELECT id FROM t WHERE date(created_at, '${DHAKA_SQL_OFFSET}') = $day ORDER BY id`)
      .all({ $day: day });
    const windowed = memory
      .prepare(`SELECT id FROM t WHERE ${onDhakaDay("created_at", "$day")} ORDER BY id`)
      .all({ $day: day });
    expect(exact.length).toBeGreaterThan(48 * OFFSETS.length);
    expect(windowed).toEqual(exact);
  });

  it("puts the 18:00Z instant on the next Dhaka day, as the rule does", () => {
    const at = (value: string, day: string) =>
      memory.prepare(`SELECT ${onDhakaDay("$value", "$day")} AS hit`).get({ $value: value, $day: day });
    expect(at("2026-11-20T17:59:59.999Z", "2026-11-20")).toEqual({ hit: 1 });
    expect(at("2026-11-20T18:00:00.000Z", "2026-11-21")).toEqual({ hit: 1 });
    expect(at("2026-11-20T18:00:00.000Z", "2026-11-20")).toEqual({ hit: 0 });
  });

  it("matches nothing for an absent day, like the rule", () => {
    const rows = memory.prepare(`SELECT id FROM t WHERE ${onDhakaDay("created_at", "$day")}`).all({ $day: null });
    expect(rows).toEqual([]);
  });

  it("works with an SQL expression as the day (staff 'today')", () => {
    const sql = `SELECT ${onDhakaDay("$value", `date('now', '${DHAKA_SQL_OFFSET}')`)} AS hit`;
    const now = new Date().toISOString();
    expect(memory.prepare(sql).get({ $value: now })).toEqual({ hit: 1 });
  });
});

describe("on the shipped schema", () => {
  const shipped = new DatabaseSync(":memory:");
  beforeAll(() => {
    const journal = JSON.parse(readFileSync(resolve("apps/mobile/db/migrations/meta/_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    for (const { tag } of journal.entries) {
      shipped.exec(readFileSync(resolve("apps/mobile/db/migrations", `${tag}.sql`), "utf8"));
    }
  });

  it("stores created_at as TEXT on every table the dashboard filters by day", () => {
    for (const table of ["sales", "payments", "credits", "expenses", "sales_returns", "cash_drawer"]) {
      const column = (shipped.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string }[]).find(
        (info) => info.name === "created_at",
      );
      expect(column?.type.toLowerCase(), table).toBe("text");
    }
  });

  it("answers a day filter on sales from the (shop_id, created_at) index", () => {
    const plan = (sql: string) =>
      (shipped.prepare(`EXPLAIN QUERY PLAN ${sql}`).all({ $shopId: "shop", $businessDate: "2026-11-21" }) as { detail: string }[])
        .map((row) => row.detail)
        .join(" | ");
    const windowed = plan(
      `SELECT COUNT(*) FROM sales WHERE shop_id = $shopId AND is_deleted = 0 AND ${onDhakaDay("created_at", "$businessDate")}`,
    );
    expect(windowed).toContain("sales_shop_created_idx (shop_id=? AND created_at>? AND created_at<?)");
    // The rule alone cannot use created_at in the index: it reads the whole shop.
    const exactOnly = plan(
      `SELECT COUNT(*) FROM sales WHERE shop_id = $shopId AND is_deleted = 0 AND date(created_at, '${DHAKA_SQL_OFFSET}') = $businessDate`,
    );
    expect(exactOnly).not.toContain("created_at>?");
  });
});
