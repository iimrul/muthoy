import { describe, expect, it } from "vitest";
import {
  summarizeUndelivered,
  syncDiagnosticReport,
  syncFailureKindOf,
  syncFailureReasonOf,
  undeliveredChanges,
  type UndeliveredSyncRow,
} from "./syncFailures";

const row = (over: Partial<UndeliveredSyncRow>): UndeliveredSyncRow => ({
  id: over.id ?? "q1",
  tableName: "audit_logs",
  op: "insert",
  operationKind: null,
  operationGroupId: null,
  createdAt: "2026-11-25T06:39:30.000Z",
  lastError: null,
  status: "failed",
  attempts: 1,
  ...over,
});

describe("what an undelivered row is, in an owner's words", () => {
  it("names a grouped operation by its operation, not by its table", () => {
    expect(syncFailureKindOf({ tableName: "inventory_movements", operationKind: "sale" })).toBe("sale");
    expect(syncFailureKindOf({ tableName: "audit_logs", operationKind: "purchase_void" })).toBe("purchase");
    expect(syncFailureKindOf({ tableName: "cash_drawer", operationKind: "withdrawal" })).toBe("cash");
  });

  it("names a single row by its table, and anything unknown as other", () => {
    expect(syncFailureKindOf({ tableName: "audit_logs", operationKind: null })).toBe("activity");
    expect(syncFailureKindOf({ tableName: "shop_b2_settings", operationKind: null })).toBe("settings");
    expect(syncFailureKindOf({ tableName: "users", operationKind: null })).toBe("staff");
    expect(syncFailureKindOf({ tableName: "something_new", operationKind: "unknown_kind" })).toBe("other");
  });

  it("counts one sale with five rows as one sale", () => {
    const sale = ["sales", "sale_items", "sale_items", "inventory_movements", "payments"].map((tableName, index) =>
      row({ id: `s${index}`, tableName, operationKind: "sale", operationGroupId: "op-1" }));
    expect(undeliveredChanges(sale)).toHaveLength(1);
    expect(summarizeUndelivered(sale)).toEqual([{ kind: "sale", count: 1 }]);
  });

  it("puts money before records, whatever order the rows came in", () => {
    const rows = [
      row({ id: "a", tableName: "audit_logs" }),
      row({ id: "b", tableName: "sales", operationKind: "sale", operationGroupId: "g1" }),
      row({ id: "c", tableName: "sales", operationKind: "sale", operationGroupId: "g2" }),
      row({ id: "d", tableName: "customers" }),
    ];
    expect(summarizeUndelivered(rows)).toEqual([
      { kind: "sale", count: 2 },
      { kind: "customer", count: 1 },
      { kind: "activity", count: 1 },
    ]);
  });
});

describe("why it did not arrive", () => {
  it("reads the server's message into a plain reason", () => {
    expect(syncFailureReasonOf({ status: "stuck", lastError: "network" })).toBe("keepsFailing");
    expect(syncFailureReasonOf({ status: "failed", lastError: "Shop is read-only under the current plan" })).toBe("planReadOnly");
    expect(syncFailureReasonOf({ status: "failed", lastError: "Atomic operation group is incomplete or inconsistent." })).toBe("incomplete");
    expect(syncFailureReasonOf({ status: "failed", lastError: "Commercial fields are server-owned" })).toBe("notAllowed");
    expect(syncFailureReasonOf({ status: "failed", lastError: "Caller does not have permission for this table" })).toBe("notAllowed");
    expect(syncFailureReasonOf({ status: "failed", lastError: "duplicate key value" })).toBe("refused");
    expect(syncFailureReasonOf({ status: "failed", lastError: null })).toBe("refused");
  });
});

describe("the support report", () => {
  it("carries tables, statuses and the server's message, never a long number", () => {
    const report = syncDiagnosticReport("7e95674d-894b-4df7-ad91-45eb8821c373", [
      row({ lastError: "Row for 8801700000000 rejected\nsecond line" }),
    ], "0.1.0 (2)");
    expect(report).toContain("shop 7e95674d · app 0.1.0 (2) · 1 undelivered");
    expect(report).toContain("activity | audit_logs.insert | - | failed/1 | Row for <n> rejected second line");
    expect(report).not.toMatch(/\d{7,}/);
    expect(report).not.toContain("45eb8821c373");
  });

  it("shortens a long server message", () => {
    const report = syncDiagnosticReport("shop", [row({ lastError: "x".repeat(400) })], "1");
    expect(report.split("\n")[2]!.length).toBeLessThan(260);
    expect(report).toContain("…");
  });
});
