import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyRow,
  createHarness,
  type Harness,
  OWNER_A,
  OWNER_B,
  seedShops,
  SHOP_A,
  SHOP_B,
  STAFF_A,
  T0,
} from "./harness";

const DRAWER = "8c000000-0000-4000-8000-000000000001";
const PAYMENT = "8c000000-0000-4000-8000-000000000002";
const QUEUE_1 = "8c000000-0000-4000-8000-000000000011";
const QUEUE_2 = "8c000000-0000-4000-8000-000000000012";
const QUEUE_3 = "8c000000-0000-4000-8000-000000000013";
const BUSINESS_DATE = "2026-08-23";
const CREATED_AT = "2026-08-23T04:00:00.000Z";
const UPDATED_AT = "2099-08-23T04:00:00.000Z";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await seedShops(h);
// Full runs initialize several independent PGlite databases concurrently.
// Group 2 is healthy in isolation but can exceed 30s while those workers
// contend for CPU; match the established PG-suite setup budget.
}, 60_000);

afterEach(async () => h.close());

function paymentPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT,
    shop_id: SHOP_A,
    type: "withdrawal",
    party_id: null,
    amount: 2500,
    method: "cash",
    ref_id: null,
    note: "Bank deposit",
    created_by: OWNER_A,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    is_deleted: false,
    ...overrides,
  };
}

function drawerPayload(
  updatedAt: string = UPDATED_AT,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: DRAWER,
    shop_id: SHOP_A,
    business_date: BUSINESS_DATE,
    opening_cash: 0,
    opened_by: OWNER_A,
    opened_at: CREATED_AT,
    closed_by: null,
    closed_at: null,
    closing_expected: -2500,
    closing_counted: null,
    reconciled_counted_amount: null,
    reconciled_at: null,
    reconciled_by: null,
    created_at: CREATED_AT,
    updated_at: updatedAt,
    is_deleted: false,
    ...overrides,
  };
}

function operationRow(
  queueId: string,
  tableName: "payments" | "cash_drawer",
  op: "insert" | "update",
  payload: Record<string, unknown>,
) {
  return { queueId, tableName, rowId: payload.id, op, payload };
}

async function stageWithdrawal(
  rows: unknown[],
  actorId: string = OWNER_A,
  expectedCount: number = rows.length,
) {
  return h.one<{ result: { status: string; receivedRowCount: number } }>(
    `select sync_stage_operation_chunk(
       $1,$2,'withdrawal',$3,'device-a',$4,'client-payload-hash-0001',
       0,'client-chunk-hash-0001',$5::jsonb
     ) result`,
    [SHOP_A, PAYMENT, actorId, expectedCount, JSON.stringify(rows)],
  );
}

describe("B3 Group 2 grouped withdrawal sync", () => {
  it("atomically applies the existing-drawer 2-row shape and retries idempotently", async () => {
    await h.exec(`insert into cash_drawer(
      id,shop_id,business_date,opening_cash,opened_by,opened_at,
      closing_expected,created_at,updated_at
    ) values(
      '${DRAWER}','${SHOP_A}','${BUSINESS_DATE}',0,'${OWNER_A}','${CREATED_AT}',
      0,'${T0}','${T0}'
    )`);
    const rows = [
      operationRow(QUEUE_1, "payments", "insert", paymentPayload()),
      operationRow(QUEUE_2, "cash_drawer", "update", drawerPayload()),
    ];

    expect((await stageWithdrawal(rows)).result.status).toBe("applied");
    expect((await stageWithdrawal(rows)).result.status).toBe("applied");

    const stored = await h.one<{
      payments: number;
      amount: number;
      closing_expected: number;
    }>(
      `select
         (select count(*)::int from payments where id=$1) payments,
         (select amount::int from payments where id=$1) amount,
         (select closing_expected::int from cash_drawer where id=$2) closing_expected`,
      [PAYMENT, DRAWER],
    );
    expect(stored).toEqual({
      payments: 1,
      amount: 2500,
      closing_expected: -2500,
    });
  });

  it("validates and applies the first-drawer 3-row insert/payment/update shape", async () => {
    const rows = [
      operationRow(
        QUEUE_1,
        "cash_drawer",
        "insert",
        drawerPayload("2099-08-23T03:59:59.999Z", { closing_expected: null }),
      ),
      operationRow(QUEUE_2, "payments", "insert", paymentPayload()),
      operationRow(QUEUE_3, "cash_drawer", "update", drawerPayload()),
    ];

    expect((await stageWithdrawal(rows)).result).toEqual({
      status: "applied",
      receivedRowCount: 3,
    });
    const stored = await h.one<{
      drawers: number;
      payments: number;
      closing_expected: number;
    }>(
      `select
         (select count(*)::int from cash_drawer where shop_id=$1 and business_date=$2) drawers,
         (select count(*)::int from payments where id=$3) payments,
         (select closing_expected::int from cash_drawer where id=$4) closing_expected`,
      [SHOP_A, BUSINESS_DATE, PAYMENT, DRAWER],
    );
    expect(stored).toEqual({
      drawers: 1,
      payments: 1,
      closing_expected: -2500,
    });
  });

  it("rejects non-owner, wrong amount/method/date/shop, and expected-count mismatches", async () => {
    const validRows = [
      operationRow(
        QUEUE_1,
        "cash_drawer",
        "insert",
        drawerPayload("2099-08-23T03:59:59.999Z", { closing_expected: null }),
      ),
      operationRow(QUEUE_2, "payments", "insert", paymentPayload()),
      operationRow(QUEUE_3, "cash_drawer", "update", drawerPayload()),
    ];
    await expect(stageWithdrawal(validRows, STAFF_A)).rejects.toMatchObject({
      code: "MU015",
    });
    await expect(stageWithdrawal(validRows, OWNER_A, 2)).rejects.toMatchObject({
      code: "MU024",
    });
    await expect(stageWithdrawal(validRows, OWNER_A, 4)).rejects.toMatchObject({
      code: "23514",
    });

    await expect(
      stageWithdrawal([validRows[1], validRows[0], validRows[2]]),
    ).rejects.toMatchObject({
      code: "MU024",
    });

    for (const badPayment of [
      paymentPayload({ amount: 0 }),
      paymentPayload({ method: "card" }),
      paymentPayload({ shop_id: SHOP_B }),
    ]) {
      const rows = [
        validRows[0],
        operationRow(QUEUE_2, "payments", "insert", badPayment),
        validRows[2],
      ];
      await expect(stageWithdrawal(rows)).rejects.toMatchObject({
        code: badPayment.shop_id === SHOP_B ? "MU003" : "MU024",
      });
    }

    const wrongDateRows = [
      validRows[0],
      operationRow(QUEUE_2, "payments", "insert", paymentPayload()),
      operationRow(
        QUEUE_3,
        "cash_drawer",
        "update",
        drawerPayload(UPDATED_AT, { business_date: "2026-08-22" }),
      ),
    ];
    await expect(stageWithdrawal(wrongDateRows)).rejects.toMatchObject({
      code: "MU024",
    });
  });
});

describe("B3 Group 2 reconcile sync", () => {
  beforeEach(async () => {
    await h.exec(`insert into cash_drawer(
      id,shop_id,business_date,opening_cash,opened_by,opened_at,
      closing_expected,created_at,updated_at
    ) values(
      '${DRAWER}','${SHOP_A}','${BUSINESS_DATE}',0,'${OWNER_A}','${CREATED_AT}',
      0,'${T0}','${T0}'
    )`);
  });

  it("round-trips winning reconcile fields through update and pull", async () => {
    const reconciledAt = "2099-08-23T04:01:00.000Z";
    const applied = await applyRow(h, {
      table: "cash_drawer",
      op: "update",
      row: drawerPayload(UPDATED_AT, {
        reconciled_counted_amount: 4321,
        reconciled_at: reconciledAt,
        reconciled_by: OWNER_A,
      }),
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(applied.ok).toBe(true);

    const pulled = await h.one<{ row_data: Record<string, unknown> }>(
      `select row_data from sync_pull_changes_b2($1,$2,null,null,null,500)
        where table_name='cash_drawer' and row_id=$3`,
      [SHOP_A, OWNER_A, DRAWER],
    );
    expect(pulled.row_data).toMatchObject({
      reconciled_counted_amount: 4321,
      reconciled_by: OWNER_A,
    });
    expect(Date.parse(String(pulled.row_data.reconciled_at))).toBe(
      Date.parse(reconciledAt),
    );
  });

  it("preserves remote reconcile values when an older payload omits the keys", async () => {
    await h.exec(`update cash_drawer set
      reconciled_counted_amount=7777,
      reconciled_at='2099-08-23T04:01:00Z',
      reconciled_by='${OWNER_A}',
      updated_at='2099-08-23T04:01:00Z'
      where id='${DRAWER}'`);
    const result = await h.one<{ result: string }>(
      `select sync_apply_row(
         'cash_drawer','update',
         (to_jsonb(d)-'reconciled_counted_amount'-'reconciled_at'-'reconciled_by')
           || '{"updated_at":"2099-08-23T04:02:00Z","closing_expected":50}'::jsonb,
         $1,$2,null
       ) result from cash_drawer d where d.id=$3`,
      [SHOP_A, OWNER_A, DRAWER],
    );
    expect(result.result).toBe("applied");
    const stored = await h.one<{
      reconciled_counted_amount: number;
      reconciled_by: string;
      closing_expected: number;
    }>(
      `select reconciled_counted_amount::int,reconciled_by,closing_expected::int
         from cash_drawer where id=$1`,
      [DRAWER],
    );
    expect(stored).toEqual({
      reconciled_counted_amount: 7777,
      reconciled_by: OWNER_A,
      closing_expected: 50,
    });
  });

  it("rejects cross-shop reconciled_by without changing the drawer", async () => {
    const result = await applyRow(h, {
      table: "cash_drawer",
      op: "update",
      row: drawerPayload(UPDATED_AT, {
        reconciled_counted_amount: 100,
        reconciled_at: UPDATED_AT,
        reconciled_by: OWNER_B,
      }),
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result).toMatchObject({ ok: false, code: "MU003" });
    const stored = await h.one<{
      reconciled_by: string | null;
      updated_at: Date;
    }>(`select reconciled_by,updated_at from cash_drawer where id=$1`, [
      DRAWER,
    ]);
    expect(stored.reconciled_by).toBeNull();
    expect(new Date(stored.updated_at).getTime()).toBe(new Date(T0).getTime());
  });
});
