import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyRow,
  createBareHarness,
  createHarness,
  migrationFiles,
  migrationSql,
  type Harness,
  OWNER_A,
  seedShops,
  SHOP_A,
  STAFF_A,
  T0,
} from "./harness";

const GROUP3_MIGRATION = "20260823030000_b3_group3_expense_category_taxonomy.sql";
const EXPENSE = "93000000-0000-4000-8000-000000000001";
const PAYMENT = "93000000-0000-4000-8000-000000000002";
const DRAWER = "93000000-0000-4000-8000-000000000003";
const DELETE_OPERATION = "93000000-0000-4000-8000-000000000004";
const CREATED_AT = "2026-08-23T04:00:00.000Z";
const UPDATED_AT = "2099-08-23T04:00:00.000Z";
const BUSINESS_DATE = "2026-08-23";

let h: Harness | null = null;

beforeEach(async () => {
  h = await createHarness();
  await seedShops(h);
}, 60_000);

afterEach(async () => {
  await h?.close();
  h = null;
});

function expensePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: EXPENSE,
    shop_id: SHOP_A,
    category: "utilities",
    amount: 2500,
    description: "Power",
    receipt_image: null,
    created_by: OWNER_A,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    is_deleted: false,
    deleted_at: null,
    deleted_by: null,
    ...overrides,
  };
}

function paymentPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT,
    shop_id: SHOP_A,
    type: "expense",
    party_id: null,
    amount: 2500,
    method: "cash",
    ref_id: EXPENSE,
    note: null,
    created_by: OWNER_A,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    is_deleted: false,
    deleted_at: null,
    deleted_by: null,
    ...overrides,
  };
}

function drawerPayload(overrides: Record<string, unknown> = {}) {
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
    updated_at: UPDATED_AT,
    is_deleted: false,
    deleted_at: null,
    deleted_by: null,
    ...overrides,
  };
}

function row(
  queueId: string,
  tableName: "expenses" | "payments" | "cash_drawer",
  op: "insert" | "update" | "delete",
  payload: Record<string, unknown>,
) {
  return { queueId, tableName, rowId: payload.id, op, payload };
}

async function stage(
  kind: "expense_create" | "expense_delete",
  rows: unknown[],
  actorId: string = OWNER_A,
  expectedCount: number = rows.length,
) {
  return h!.one<{ result: { status: string; receivedRowCount: number } }>(
    `select sync_stage_operation_chunk(
       $1,$2,$3,$4,'device-a',$5,'expense-payload-hash-0001',
       0,'expense-chunk-hash-0001',$6::jsonb
     ) result`,
    [SHOP_A, kind === "expense_create" ? EXPENSE : DELETE_OPERATION, kind, actorId, expectedCount, JSON.stringify(rows)],
  );
}

async function seedOpenDrawer() {
  await h!.exec(`insert into cash_drawer(
    id,shop_id,business_date,opening_cash,opened_by,opened_at,
    closing_expected,created_at,updated_at
  ) values(
    '${DRAWER}','${SHOP_A}','${BUSINESS_DATE}',0,'${OWNER_A}','${CREATED_AT}',
    0,'${T0}','${T0}'
  )`);
}

describe("B3 Group 3 grouped expense sync", () => {
  it("applies create atomically and retries the same operation idempotently", async () => {
    await seedOpenDrawer();
    const rows = [
      row("93000000-0000-4000-8000-000000000011", "expenses", "insert", expensePayload()),
      row("93000000-0000-4000-8000-000000000012", "payments", "insert", paymentPayload()),
      row("93000000-0000-4000-8000-000000000013", "cash_drawer", "update", drawerPayload()),
    ];
    expect((await stage("expense_create", rows)).result.status).toBe("applied");
    expect((await stage("expense_create", rows)).result.status).toBe("applied");
    expect(await h!.one(
      `select
         (select count(*)::int from expenses where id=$1) expenses,
         (select count(*)::int from payments where id=$2 and ref_id=$1) payments,
         (select closing_expected::int from cash_drawer where id=$3) closing_expected`,
      [EXPENSE, PAYMENT, DRAWER],
    )).toEqual({ expenses: 1, payments: 1, closing_expected: -2500 });

    const marker = { shop_id: SHOP_A, is_deleted: true, deleted_at: "2100-08-23T04:00:00.000Z", deleted_by: OWNER_A, updated_at: "2100-08-23T04:00:00.000Z" };
    const deleteRows = [
      row("93000000-0000-4000-8000-000000000071", "expenses", "delete", { id: EXPENSE, ...marker }),
      row("93000000-0000-4000-8000-000000000072", "payments", "delete", { id: PAYMENT, ...marker }),
      row("93000000-0000-4000-8000-000000000073", "cash_drawer", "update", drawerPayload({ closing_expected: 0, updated_at: "2100-08-23T04:00:00.000Z" })),
    ];
    expect((await stage("expense_delete", deleteRows)).result.status).toBe("applied");
    expect(await h!.all<{ operation_kind: string }>(
      `select operation_kind from sync_operation_staging
        where operation_id in ($1,$2) order by operation_kind`,
      [EXPENSE, DELETE_OPERATION],
    )).toEqual([{ operation_kind: "expense_create" }, { operation_kind: "expense_delete" }]);
  });

  it("rolls back the whole create graph when shape validation fails", async () => {
    await seedOpenDrawer();
    const rows = [
      row("93000000-0000-4000-8000-000000000021", "expenses", "insert", expensePayload()),
      row("93000000-0000-4000-8000-000000000022", "payments", "insert", paymentPayload({ amount: 2499 })),
      row("93000000-0000-4000-8000-000000000023", "cash_drawer", "update", drawerPayload()),
    ];
    await expect(stage("expense_create", rows)).rejects.toMatchObject({ code: "MU024" });
    expect(await h!.one(
      `select
         (select count(*)::int from expenses where id=$1) expenses,
         (select count(*)::int from payments where id=$2) payments,
         (select closing_expected::int from cash_drawer where id=$3) closing_expected`,
      [EXPENSE, PAYMENT, DRAWER],
    )).toEqual({ expenses: 0, payments: 0, closing_expected: 0 });
  });

  it("accepts only the exact first-drawer create order/count and remains Owner-only", async () => {
    const rows = [
      row("93000000-0000-4000-8000-000000000051", "cash_drawer", "insert", drawerPayload({ closing_expected: null, updated_at: "2099-08-23T03:59:59.999Z" })),
      row("93000000-0000-4000-8000-000000000052", "expenses", "insert", expensePayload()),
      row("93000000-0000-4000-8000-000000000053", "payments", "insert", paymentPayload()),
      row("93000000-0000-4000-8000-000000000054", "cash_drawer", "update", drawerPayload()),
    ];
    await expect(stage("expense_create", rows, STAFF_A)).rejects.toMatchObject({ code: "MU015" });
    await expect(stage("expense_create", [rows[1], rows[0], rows[2], rows[3]])).rejects.toMatchObject({ code: "MU024" });
    await expect(stage("expense_create", rows, OWNER_A, 3)).rejects.toMatchObject({ code: "MU024" });
    expect((await stage("expense_create", rows)).result).toEqual({ status: "applied", receivedRowCount: 4 });
  });

  it("soft-deletes expense/payment atomically and retries idempotently", async () => {
    await seedOpenDrawer();
    await h!.exec(`
      insert into expenses(id,shop_id,category,amount,description,created_by,created_at,updated_at)
      values('${EXPENSE}','${SHOP_A}','utilities',2500,'Power','${OWNER_A}','${CREATED_AT}','${T0}');
      insert into payments(id,shop_id,type,party_id,amount,method,ref_id,created_by,created_at,updated_at)
      values('${PAYMENT}','${SHOP_A}','expense',null,2500,'cash','${EXPENSE}','${OWNER_A}','${CREATED_AT}','${T0}');
    `);
    const marker = {
      shop_id: SHOP_A,
      is_deleted: true,
      deleted_at: UPDATED_AT,
      deleted_by: OWNER_A,
      updated_at: UPDATED_AT,
    };
    const rows = [
      row("93000000-0000-4000-8000-000000000031", "expenses", "delete", { id: EXPENSE, ...marker }),
      row("93000000-0000-4000-8000-000000000032", "payments", "delete", { id: PAYMENT, ...marker }),
      row("93000000-0000-4000-8000-000000000033", "cash_drawer", "update", drawerPayload({ closing_expected: 0 })),
    ];
    expect((await stage("expense_delete", rows)).result.status).toBe("applied");
    expect((await stage("expense_delete", rows)).result.status).toBe("applied");
    expect(await h!.one(
      `select
         (select is_deleted from expenses where id=$1) expense_deleted,
         (select is_deleted from payments where id=$2) payment_deleted,
         (select closing_expected::int from cash_drawer where id=$3) closing_expected`,
      [EXPENSE, PAYMENT, DRAWER],
    )).toEqual({ expense_deleted: true, payment_deleted: true, closing_expected: 0 });
  });

  it("rolls back delete when its paired payment shape is wrong", async () => {
    await seedOpenDrawer();
    await h!.exec(`
      insert into expenses(id,shop_id,category,amount,created_by,created_at,updated_at)
      values('${EXPENSE}','${SHOP_A}','rent',2500,'${OWNER_A}','${CREATED_AT}','${T0}');
      insert into payments(id,shop_id,type,amount,method,ref_id,created_by,created_at,updated_at)
      values('${PAYMENT}','${SHOP_A}','expense',2500,'cash','${EXPENSE}','${OWNER_A}','${CREATED_AT}','${T0}');
    `);
    const marker = { shop_id: SHOP_A, is_deleted: true, deleted_at: UPDATED_AT, deleted_by: OWNER_A, updated_at: UPDATED_AT };
    const rows = [
      row("93000000-0000-4000-8000-000000000041", "expenses", "delete", { id: EXPENSE, ...marker }),
      row("93000000-0000-4000-8000-000000000042", "payments", "delete", { id: PAYMENT, ...marker, deleted_by: "22222222-2222-4222-8222-222222222299" }),
      row("93000000-0000-4000-8000-000000000043", "cash_drawer", "update", drawerPayload({ closing_expected: 0 })),
    ];
    await expect(stage("expense_delete", rows)).rejects.toMatchObject({ code: "MU024" });
    expect(await h!.one(
      `select
         (select is_deleted from expenses where id=$1) expense_deleted,
         (select is_deleted from payments where id=$2) payment_deleted,
         (select closing_expected::int from cash_drawer where id=$3) closing_expected`,
      [EXPENSE, PAYMENT, DRAWER],
    )).toEqual({ expense_deleted: false, payment_deleted: false, closing_expected: 0 });
  });

  it("applies the exact first-drawer delete order as one four-row transaction", async () => {
    await h!.exec(`
      insert into expenses(id,shop_id,category,amount,created_by,created_at,updated_at)
      values('${EXPENSE}','${SHOP_A}','other',2500,'${OWNER_A}','${CREATED_AT}','${T0}');
      insert into payments(id,shop_id,type,amount,method,ref_id,created_by,created_at,updated_at)
      values('${PAYMENT}','${SHOP_A}','expense',2500,'cash','${EXPENSE}','${OWNER_A}','${CREATED_AT}','${T0}');
    `);
    const marker = { shop_id: SHOP_A, is_deleted: true, deleted_at: UPDATED_AT, deleted_by: OWNER_A, updated_at: UPDATED_AT };
    const rows = [
      row("93000000-0000-4000-8000-000000000061", "expenses", "delete", { id: EXPENSE, ...marker }),
      row("93000000-0000-4000-8000-000000000062", "payments", "delete", { id: PAYMENT, ...marker }),
      row("93000000-0000-4000-8000-000000000063", "cash_drawer", "insert", drawerPayload({ closing_expected: null, updated_at: "2099-08-23T03:59:59.999Z" })),
      row("93000000-0000-4000-8000-000000000064", "cash_drawer", "update", drawerPayload({ closing_expected: 0 })),
    ];
    expect((await stage("expense_delete", rows)).result).toEqual({ status: "applied", receivedRowCount: 4 });
    expect(await h!.one(
      `select
         (select is_deleted from expenses where id=$1) expense_deleted,
         (select is_deleted from payments where id=$2) payment_deleted,
         (select count(*)::int from cash_drawer where id=$3) drawers`,
      [EXPENSE, PAYMENT, DRAWER],
    )).toEqual({ expense_deleted: true, payment_deleted: true, drawers: 1 });
  });
});

describe("B3 Group 3 category rollout", () => {
  it("canonicalizes stale-client rows in PostgreSQL and rejects unknown final values", async () => {
    const stale = await applyRow(h!, {
      table: "expenses",
      row: expensePayload({ category: "electricity" }),
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(stale.ok).toBe(true);
    expect((await h!.one<{ category: string }>(`select category from expenses where id=$1`, [EXPENSE])).category).toBe("utilities");

    const unknownId = "93000000-0000-4000-8000-000000000099";
    const unknown = await applyRow(h!, {
      table: "expenses",
      row: expensePayload({ id: unknownId, category: "fuel" }),
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(unknown).toMatchObject({ ok: false, code: "MU024" });
    await expect(h!.exec(
      `insert into expenses(id,shop_id,category,amount,created_by)
       values('${unknownId}','${SHOP_A}','fuel',100,'${OWNER_A}')`,
    )).rejects.toMatchObject({ code: "23514" });
  });

  it("backfills a populated PostgreSQL database with exact mapping and row-count preservation", async () => {
    const populated = await createBareHarness();
    try {
      for (const name of migrationFiles().filter((name) => name < GROUP3_MIGRATION)) {
        await populated.exec(migrationSql(name));
      }
      await seedShops(populated);
      const categories = ["electricity", "transport", "staff_salary", "supplies", "rent", "other"];
      for (const [index, category] of categories.entries()) {
        await populated.exec(
          `insert into expenses(id,shop_id,category,amount,created_by,created_at,updated_at)
           values('94000000-0000-4000-8000-00000000000${index + 1}','${SHOP_A}','${category}',100,'${OWNER_A}','${T0}','${T0}')`,
        );
      }
      await populated.exec(migrationSql(GROUP3_MIGRATION));
      const rows = await populated.all<{ category: string }>(
        `select category from expenses where shop_id=$1 order by id`,
        [SHOP_A],
      );
      expect(rows.map((entry) => entry.category)).toEqual([
        "utilities", "conveyance", "salary", "other", "rent", "other",
      ]);
      expect(rows).toHaveLength(6);
    } finally {
      await populated.close();
    }
  }, 30_000);
});
