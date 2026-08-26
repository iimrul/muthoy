import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createHarness,
  type Harness,
  OWNER_A,
  seedShops,
  SHOP_A,
  STAFF_A,
  T0,
} from "./harness";

// B3 Group 7: server-side grouped-sync coverage for purchase_return, added
// by 20260824000000_b3_group7_purchase_return_sync.sql. Mirrors the
// b3-groups456-sync.pgtest.ts harness pattern exactly — real Postgres (via
// PGlite), real migrations, real sync_apply_operation.
//
// The three re-derivations this dispatcher branch must never trust from the
// client are each proven by their own rejection test: the max-returnable
// quantity (received-minus-returned AND current batch stock, whichever is
// smaller), the credit_amount arithmetic, and the movement/audit row shape.

const SUPPLIER = "96000000-0000-4000-8000-000000000001";
const MEDICINE = "96000000-0000-4000-8000-000000000002";
const CREATED_AT = "2026-08-24T04:00:00.000Z";
const UPDATED_AT = "2026-08-24T05:00:00.000Z";
const BUSINESS_DATE = "2026-08-24";

let h: Harness | null = null;

beforeEach(async () => {
  h = await createHarness();
  await seedShops(h);
  await h.exec(`
    insert into suppliers(id,shop_id,name,created_at,updated_at)
    values('${SUPPLIER}','${SHOP_A}','Return Test Supplier','${T0}','${T0}');
    insert into medicines(id,shop_id,name,created_at,updated_at)
    values('${MEDICINE}','${SHOP_A}','Napa Return Test','${T0}','${T0}');
  `);
}, 60_000);

afterEach(async () => {
  await h?.close();
  h = null;
});

function row(
  queueId: string,
  tableName: string,
  op: "insert" | "update" | "delete",
  payload: Record<string, unknown>,
) {
  return { queueId, tableName, rowId: payload.id, op, payload };
}

function returnRow(id: string, purchaseId: string, purchaseItemId: string, overrides: Record<string, unknown> = {}) {
  return {
    id, shop_id: SHOP_A, purchase_id: purchaseId, purchase_item_id: purchaseItemId,
    qty: 1, reason: "expired", credit_amount: 0, created_by: OWNER_A,
    created_at: CREATED_AT, updated_at: CREATED_AT,
    is_deleted: false, deleted_at: null, deleted_by: null,
    ...overrides,
  };
}
function movementRow(id: string, batchId: string, refId: string, overrides: Record<string, unknown> = {}) {
  return {
    id, shop_id: SHOP_A, batch_id: batchId, change_qty: -1, reason: "return", ref_id: refId,
    created_by: OWNER_A, created_at: CREATED_AT, updated_at: CREATED_AT,
    is_deleted: false, deleted_at: null, deleted_by: null,
    ...overrides,
  };
}
function auditRow(id: string, target: string, overrides: Record<string, unknown> = {}) {
  return {
    id, shop_id: SHOP_A, actor_id: OWNER_A, action: "purchase_return_created", target, meta: "{}",
    created_at: CREATED_AT, updated_at: CREATED_AT,
    is_deleted: false, deleted_at: null, deleted_by: null,
    ...overrides,
  };
}

function purchaseRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, shop_id: SHOP_A, invoice_no: `PUR-G7-${id.slice(-4)}`, supplier_id: SUPPLIER,
    total: 0, payment_terms: "cod", paid_amount: 0, invoice_date: null, source: "manual",
    voided_at: null, voided_by: null, created_at: CREATED_AT, updated_at: CREATED_AT,
    is_deleted: false, deleted_at: null, deleted_by: null,
    ...overrides,
  };
}
function purchaseItemRow(id: string, purchaseId: string, overrides: Record<string, unknown> = {}) {
  return {
    id, shop_id: SHOP_A, purchase_id: purchaseId, medicine_id: MEDICINE, batch_no: "B-G7-COD",
    expiry_date: "2028-01-01", qty: 1, purchase_price: 0, sale_price: 0, status: "received",
    received_at: CREATED_AT, created_at: CREATED_AT, updated_at: CREATED_AT,
    is_deleted: false, deleted_at: null, deleted_by: null,
    ...overrides,
  };
}
function batchRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, shop_id: SHOP_A, medicine_id: MEDICINE, batch_no: "B-G7-COD", expiry_date: "2028-01-01",
    stock: 0, purchase_price: 0, sale_price: 0, is_discounted: false, original_price: null,
    created_at: CREATED_AT, updated_at: CREATED_AT,
    is_deleted: false, deleted_at: null, deleted_by: null,
    ...overrides,
  };
}
function paymentRow(id: string, purchaseId: string, amount: number) {
  return {
    id, shop_id: SHOP_A, type: "supplier_payment", party_id: SUPPLIER, amount,
    method: "cash", ref_id: purchaseId, created_by: OWNER_A,
    created_at: CREATED_AT, updated_at: CREATED_AT,
    is_deleted: false, deleted_at: null, deleted_by: null,
  };
}
function drawerRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, shop_id: SHOP_A, business_date: BUSINESS_DATE, opening_cash: 0, opened_by: OWNER_A,
    opened_at: CREATED_AT, closed_by: null, closed_at: null, closing_expected: 0,
    closing_counted: null, created_at: CREATED_AT, updated_at: CREATED_AT,
    is_deleted: false, deleted_at: null, deleted_by: null,
    ...overrides,
  };
}

async function stage(
  operationId: string,
  rows: unknown[],
  actorId: string = OWNER_A,
  expectedCount: number = rows.length,
) {
  return h!.one<{ result: { status: string; receivedRowCount: number } }>(
    `select sync_stage_operation_chunk(
       $1,$2,'purchase_return',$3,'device-a',$4,'g7-payload-hash-0001',
       0,'g7-chunk-hash-0001',$5::jsonb
     ) result`,
    [SHOP_A, operationId, actorId, expectedCount, JSON.stringify(rows)],
  );
}

async function stageKind(operationId: string, kind: "purchase_create" | "purchase_receive_line", rows: unknown[]) {
  return h!.one<{ result: { status: string; receivedRowCount: number } }>(
    `select sync_stage_operation_chunk(
       $1,$2,$3,$4,'device-a',$5,'g7-cod-payload-hash-0001',
       0,'g7-cod-chunk-hash-0001',$6::jsonb
     ) result`,
    [SHOP_A, operationId, kind, OWNER_A, rows.length, JSON.stringify(rows)],
  );
}

async function seedSupplierCredit(creditAmount: number) {
  await h!.exec(`
    insert into purchases(id,shop_id,invoice_no,supplier_id,total,payment_terms,paid_amount,source,created_at,updated_at)
    values('97000000-0000-4000-8100-000000000001','${SHOP_A}','PUR-G7-CREDIT','${SUPPLIER}',10000,'credit',10000,'manual','${CREATED_AT}','${CREATED_AT}');
    insert into purchase_items(id,shop_id,purchase_id,medicine_id,batch_no,expiry_date,qty,purchase_price,sale_price,status,received_at,created_at,updated_at)
    values('97000000-0000-4000-8100-000000000002','${SHOP_A}','97000000-0000-4000-8100-000000000001','${MEDICINE}','B-G7-CREDIT','2028-01-01',1,10000,15000,'received','${CREATED_AT}','${CREATED_AT}','${CREATED_AT}');
    insert into purchase_returns(id,shop_id,purchase_id,purchase_item_id,qty,reason,credit_amount,created_by,created_at,updated_at)
    values('97000000-0000-4000-8100-000000000003','${SHOP_A}','97000000-0000-4000-8100-000000000001','97000000-0000-4000-8100-000000000002',1,'expired',${creditAmount},'${OWNER_A}','${CREATED_AT}','${CREATED_AT}');
  `);
}

/**
 * Seeds a fully-received purchase line with `qty` units, `purchasePrice`
 * paisa each, and that much REAL ledger-derived stock. `batches.stock` is
 * ledger-derived and enforced by a `before insert` trigger that forces any
 * inserted absolute to 0 — the opening quantity must arrive as a real
 * `inventory_movements` row (reason: 'purchase'), exactly as a genuine
 * createPurchase call would produce, or every batch here would seed at 0
 * and every return would be rejected as exceeding available stock.
 */
async function seedReceivedLine(
  purchaseId: string,
  itemId: string,
  batchId: string,
  qty: number,
  purchasePrice: number,
  batchNo = "B-RET-1",
) {
  const openingMovementId = `${batchId.slice(0, -1)}9`;
  await h!.exec(`
    insert into purchases(id,shop_id,invoice_no,supplier_id,total,payment_terms,paid_amount,source,created_at,updated_at)
    values('${purchaseId}','${SHOP_A}','PUR-RET-${purchaseId.slice(-4)}','${SUPPLIER}',${qty * purchasePrice},'credit',0,'manual','${CREATED_AT}','${CREATED_AT}');
    insert into purchase_items(id,shop_id,purchase_id,medicine_id,batch_no,expiry_date,qty,purchase_price,sale_price,status,received_at,created_at,updated_at)
    values('${itemId}','${SHOP_A}','${purchaseId}','${MEDICINE}','${batchNo}','2028-01-01',${qty},${purchasePrice},${Math.round(purchasePrice * 1.5)},'received','${CREATED_AT}','${CREATED_AT}','${CREATED_AT}');
    insert into batches(id,shop_id,medicine_id,batch_no,expiry_date,stock,purchase_price,sale_price,created_at,updated_at)
    values('${batchId}','${SHOP_A}','${MEDICINE}','${batchNo}','2028-01-01',0,${purchasePrice},${Math.round(purchasePrice * 1.5)},'${CREATED_AT}','${CREATED_AT}');
    insert into inventory_movements(id,shop_id,batch_id,change_qty,reason,ref_id,created_by,created_at,updated_at)
    values('${openingMovementId}','${SHOP_A}','${batchId}',${qty},'purchase','${purchaseId}','${OWNER_A}','${CREATED_AT}','${CREATED_AT}');
  `);
}

describe("residual-cash COD sync compatibility", () => {
  it("purchase_create consumes Supplier Credit and records only residual cash", async () => {
    await seedSupplierCredit(30000);
    const purchaseId = "97000000-0000-4000-8200-000000000011";
    const itemId = "97000000-0000-4000-8200-000000000012";
    const batchId = "97000000-0000-4000-8200-000000000013";
    const movementId = "97000000-0000-4000-8200-000000000014";
    const paymentId = "97000000-0000-4000-8200-000000000015";
    const rows = [
      row("97000000-0000-4000-8300-000000000011", "purchases", "insert",
        purchaseRow(purchaseId, { total: 50000, paid_amount: 20000 })),
      row("97000000-0000-4000-8300-000000000012", "purchase_items", "insert",
        purchaseItemRow(itemId, purchaseId, { qty: 5, purchase_price: 10000, sale_price: 15000 })),
      row("97000000-0000-4000-8300-000000000013", "batches", "insert",
        batchRow(batchId, { purchase_price: 10000, sale_price: 15000 })),
      row("97000000-0000-4000-8300-000000000014", "inventory_movements", "insert",
        movementRow(movementId, batchId, purchaseId, { change_qty: 5, reason: "purchase" })),
      row("97000000-0000-4000-8300-000000000015", "payments", "insert",
        paymentRow(paymentId, purchaseId, 20000)),
      row("97000000-0000-4000-8300-000000000016", "cash_drawer", "insert",
        drawerRow("97000000-0000-4000-8200-000000000016")),
      row("97000000-0000-4000-8300-000000000017", "cash_drawer", "update",
        drawerRow("97000000-0000-4000-8200-000000000016",
          { closing_expected: 20000, updated_at: UPDATED_AT })),
    ];
    expect((await stageKind(purchaseId, "purchase_create", rows)).result.status).toBe("applied");
    expect(await h!.one(
      `select p.paid_amount::int paid_amount,
        (select sum(amount)::int from payments where ref_id=p.id) cash_paid
       from purchases p where p.id=$1`, [purchaseId],
    )).toEqual({ paid_amount: 20000, cash_paid: 20000 });
  });

  it("fully credit-covered purchase_create has no fake payment or drawer row", async () => {
    await seedSupplierCredit(30000);
    const purchaseId = "97000000-0000-4000-8200-000000000021";
    const itemId = "97000000-0000-4000-8200-000000000022";
    const batchId = "97000000-0000-4000-8200-000000000023";
    const rows = [
      row("97000000-0000-4000-8300-000000000021", "purchases", "insert",
        purchaseRow(purchaseId, { total: 20000, paid_amount: 0 })),
      row("97000000-0000-4000-8300-000000000022", "purchase_items", "insert",
        purchaseItemRow(itemId, purchaseId, { qty: 2, purchase_price: 10000, sale_price: 15000 })),
      row("97000000-0000-4000-8300-000000000023", "batches", "insert",
        batchRow(batchId, { purchase_price: 10000, sale_price: 15000 })),
      row("97000000-0000-4000-8300-000000000024", "inventory_movements", "insert",
        movementRow("97000000-0000-4000-8200-000000000024", batchId, purchaseId,
          { change_qty: 2, reason: "purchase" })),
    ];
    expect((await stageKind(purchaseId, "purchase_create", rows)).result.status).toBe("applied");
    expect(await h!.one(
      `select (select count(*)::int from payments where ref_id=$1) payments,
              (select count(*)::int from cash_drawer where shop_id=$2) drawers`,
      [purchaseId, SHOP_A],
    )).toEqual({ payments: 0, drawers: 0 });
  });

  it("purchase_receive_line validates cumulative paid_amount and residual payment", async () => {
    await seedSupplierCredit(30000);
    const purchaseId = "97000000-0000-4000-8200-000000000031";
    const itemId = "97000000-0000-4000-8200-000000000032";
    const batchId = "97000000-0000-4000-8200-000000000033";
    await h!.exec(`
      insert into purchases(id,shop_id,invoice_no,supplier_id,total,payment_terms,paid_amount,source,created_at,updated_at)
      values('${purchaseId}','${SHOP_A}','PUR-G7-RECV','${SUPPLIER}',0,'cod',0,'manual','${CREATED_AT}','${CREATED_AT}');
      insert into purchase_items(id,shop_id,purchase_id,medicine_id,batch_no,expiry_date,qty,purchase_price,sale_price,status,received_at,created_at,updated_at)
      values('${itemId}','${SHOP_A}','${purchaseId}','${MEDICINE}','B-G7-RECV','2028-01-01',5,10000,15000,'pending',null,'${CREATED_AT}','${CREATED_AT}');
    `);
    const operationId = "97000000-0000-4000-8200-000000000039";
    const rows = [
      row("97000000-0000-4000-8300-000000000031", "purchase_items", "update",
        purchaseItemRow(itemId, purchaseId, {
          batch_no: "B-G7-RECV", qty: 5, purchase_price: 10000, sale_price: 15000,
          updated_at: UPDATED_AT,
        })),
      row("97000000-0000-4000-8300-000000000032", "batches", "insert",
        batchRow(batchId, { batch_no: "B-G7-RECV", purchase_price: 10000, sale_price: 15000 })),
      row("97000000-0000-4000-8300-000000000033", "inventory_movements", "insert",
        movementRow("97000000-0000-4000-8200-000000000034", batchId, purchaseId,
          { change_qty: 5, reason: "purchase" })),
      row("97000000-0000-4000-8300-000000000034", "purchases", "update",
        purchaseRow(purchaseId, {
          invoice_no: "PUR-G7-RECV", total: 50000, paid_amount: 20000, updated_at: UPDATED_AT,
        })),
      row("97000000-0000-4000-8300-000000000035", "payments", "insert",
        paymentRow("97000000-0000-4000-8200-000000000035", purchaseId, 20000)),
      row("97000000-0000-4000-8300-000000000036", "cash_drawer", "insert",
        drawerRow("97000000-0000-4000-8200-000000000036")),
      row("97000000-0000-4000-8300-000000000037", "cash_drawer", "update",
        drawerRow("97000000-0000-4000-8200-000000000036",
          { closing_expected: 20000, updated_at: UPDATED_AT })),
    ];
    expect((await stageKind(operationId, "purchase_receive_line", rows)).result.status).toBe("applied");
    expect(await h!.one(`select total::int,paid_amount::int from purchases where id=$1`, [purchaseId]))
      .toEqual({ total: 50000, paid_amount: 20000 });
  });

  it("fully credit-covered purchase_receive_line writes no payment or drawer row", async () => {
    await seedSupplierCredit(30000);
    const purchaseId = "97000000-0000-4000-8200-000000000051";
    const itemId = "97000000-0000-4000-8200-000000000052";
    const batchId = "97000000-0000-4000-8200-000000000053";
    await h!.exec(`
      insert into purchases(id,shop_id,invoice_no,supplier_id,total,payment_terms,paid_amount,source,created_at,updated_at)
      values('${purchaseId}','${SHOP_A}','PUR-G7-RECV-FULL','${SUPPLIER}',0,'cod',0,'manual','${CREATED_AT}','${CREATED_AT}');
      insert into purchase_items(id,shop_id,purchase_id,medicine_id,batch_no,expiry_date,qty,purchase_price,sale_price,status,received_at,created_at,updated_at)
      values('${itemId}','${SHOP_A}','${purchaseId}','${MEDICINE}','B-G7-RECV-FULL','2028-01-01',2,10000,15000,'pending',null,'${CREATED_AT}','${CREATED_AT}');
    `);
    const operationId = "97000000-0000-4000-8200-000000000059";
    const rows = [
      row("97000000-0000-4000-8300-000000000051", "purchase_items", "update",
        purchaseItemRow(itemId, purchaseId, {
          batch_no: "B-G7-RECV-FULL", qty: 2, purchase_price: 10000, sale_price: 15000,
          updated_at: UPDATED_AT,
        })),
      row("97000000-0000-4000-8300-000000000052", "batches", "insert",
        batchRow(batchId, { batch_no: "B-G7-RECV-FULL", purchase_price: 10000, sale_price: 15000 })),
      row("97000000-0000-4000-8300-000000000053", "inventory_movements", "insert",
        movementRow("97000000-0000-4000-8200-000000000054", batchId, purchaseId,
          { change_qty: 2, reason: "purchase" })),
      row("97000000-0000-4000-8300-000000000054", "purchases", "update",
        purchaseRow(purchaseId, {
          invoice_no: "PUR-G7-RECV-FULL", total: 20000, paid_amount: 0, updated_at: UPDATED_AT,
        })),
    ];

    expect((await stageKind(operationId, "purchase_receive_line", rows)).result.status).toBe("applied");
    expect(await h!.one(
      `select p.total::int total,p.paid_amount::int paid_amount,
              (select count(*)::int from payments where ref_id=p.id) payments,
              (select count(*)::int from cash_drawer where shop_id=p.shop_id) drawers
         from purchases p where p.id=$1`,
      [purchaseId],
    )).toEqual({ total: 20000, paid_amount: 0, payments: 0, drawers: 0 });
  });

  it("rejects a COD create item that is not bound to its operation header", async () => {
    const purchaseId = "97000000-0000-4000-8200-000000000061";
    const rows = [
      row("97000000-0000-4000-8300-000000000061", "purchases", "insert",
        purchaseRow(purchaseId, { total: 0, paid_amount: 0 })),
      row("97000000-0000-4000-8300-000000000062", "purchase_items", "insert",
        purchaseItemRow("97000000-0000-4000-8200-000000000062",
          "97000000-0000-4000-8200-000000000069", { status: "pending", received_at: null })),
    ];

    await expect(stageKind(purchaseId, "purchase_create", rows)).rejects.toMatchObject({ code: "MU024" });
    expect((await h!.one<{ n: number }>(
      `select count(*)::int n from purchases where id=$1`, [purchaseId],
    )).n).toBe(0);
  });

  it("rejects non-bijective create movements across duplicate batch lines", async () => {
    await seedSupplierCredit(20000);
    const purchaseId = "97000000-0000-4000-8200-000000000091";
    const batchId = "97000000-0000-4000-8200-000000000093";
    const unrelatedBatchId = "97000000-0000-4000-8200-000000000099";
    await h!.exec(`
      insert into batches(id,shop_id,medicine_id,batch_no,expiry_date,stock,purchase_price,sale_price,created_at,updated_at)
      values('${unrelatedBatchId}','${SHOP_A}','${MEDICINE}','B-G7-UNRELATED','2028-01-01',0,10000,15000,'${CREATED_AT}','${CREATED_AT}');
    `);
    const rows = [
      row("97000000-0000-4000-8300-000000000091", "purchases", "insert",
        purchaseRow(purchaseId, { total: 20000, paid_amount: 0 })),
      row("97000000-0000-4000-8300-000000000092", "purchase_items", "insert",
        purchaseItemRow("97000000-0000-4000-8200-000000000092", purchaseId,
          { qty: 1, purchase_price: 10000, sale_price: 15000 })),
      row("97000000-0000-4000-8300-000000000093", "purchase_items", "insert",
        purchaseItemRow("97000000-0000-4000-8200-000000000094", purchaseId,
          { qty: 1, purchase_price: 10000, sale_price: 15000 })),
      row("97000000-0000-4000-8300-000000000094", "batches", "insert",
        batchRow(batchId, { purchase_price: 10000, sale_price: 15000 })),
      row("97000000-0000-4000-8300-000000000095", "inventory_movements", "insert",
        movementRow("97000000-0000-4000-8200-000000000095", batchId, purchaseId,
          { change_qty: 1, reason: "purchase" })),
      row("97000000-0000-4000-8300-000000000096", "inventory_movements", "insert",
        movementRow("97000000-0000-4000-8200-000000000096", unrelatedBatchId, purchaseId,
          { change_qty: 1, reason: "purchase" })),
    ];

    await expect(stageKind(purchaseId, "purchase_create", rows)).rejects.toMatchObject({ code: "MU024" });
    expect((await h!.one<{ n: number }>(
      `select count(*)::int n from purchases where id=$1`, [purchaseId],
    )).n).toBe(0);
  });

  it("rejects a receive payload that mutates locked purchase-item fields", async () => {
    await seedSupplierCredit(50000);
    const purchaseId = "97000000-0000-4000-8200-000000000071";
    const itemId = "97000000-0000-4000-8200-000000000072";
    const batchId = "97000000-0000-4000-8200-000000000073";
    await h!.exec(`
      insert into purchases(id,shop_id,invoice_no,supplier_id,total,payment_terms,paid_amount,source,created_at,updated_at)
      values('${purchaseId}','${SHOP_A}','PUR-G7-RECV-MUTATE','${SUPPLIER}',0,'cod',0,'manual','${CREATED_AT}','${CREATED_AT}');
      insert into purchase_items(id,shop_id,purchase_id,medicine_id,batch_no,expiry_date,qty,purchase_price,sale_price,status,received_at,created_at,updated_at)
      values('${itemId}','${SHOP_A}','${purchaseId}','${MEDICINE}','B-G7-RECV-MUTATE','2028-01-01',2,10000,15000,'pending',null,'${CREATED_AT}','${CREATED_AT}');
    `);
    const rows = [
      row("97000000-0000-4000-8300-000000000071", "purchase_items", "update",
        purchaseItemRow(itemId, purchaseId, {
          batch_no: "B-G7-RECV-MUTATE", qty: 3, purchase_price: 10000, sale_price: 15000,
          updated_at: UPDATED_AT,
        })),
      row("97000000-0000-4000-8300-000000000072", "batches", "insert",
        batchRow(batchId, { batch_no: "B-G7-RECV-MUTATE", purchase_price: 10000, sale_price: 15000 })),
      row("97000000-0000-4000-8300-000000000073", "inventory_movements", "insert",
        movementRow("97000000-0000-4000-8200-000000000074", batchId, purchaseId,
          { change_qty: 2, reason: "purchase" })),
      row("97000000-0000-4000-8300-000000000074", "purchases", "update",
        purchaseRow(purchaseId, {
          invoice_no: "PUR-G7-RECV-MUTATE", total: 20000, paid_amount: 0, updated_at: UPDATED_AT,
        })),
    ];

    await expect(stageKind(
      "97000000-0000-4000-8200-000000000079", "purchase_receive_line", rows,
    )).rejects.toMatchObject({ code: "MU024" });
    expect(await h!.one(`select status,qty::int from purchase_items where id=$1`, [itemId]))
      .toEqual({ status: "pending", qty: 2 });
  });

  it("rejects a residual-COD drawer row for the wrong business date", async () => {
    const purchaseId = "97000000-0000-4000-8200-000000000081";
    const batchId = "97000000-0000-4000-8200-000000000083";
    const rows = [
      row("97000000-0000-4000-8300-000000000081", "purchases", "insert",
        purchaseRow(purchaseId, { total: 10000, paid_amount: 10000 })),
      row("97000000-0000-4000-8300-000000000082", "purchase_items", "insert",
        purchaseItemRow("97000000-0000-4000-8200-000000000082", purchaseId,
          { qty: 1, purchase_price: 10000, sale_price: 15000 })),
      row("97000000-0000-4000-8300-000000000083", "batches", "insert",
        batchRow(batchId, { purchase_price: 10000, sale_price: 15000 })),
      row("97000000-0000-4000-8300-000000000084", "inventory_movements", "insert",
        movementRow("97000000-0000-4000-8200-000000000084", batchId, purchaseId,
          { change_qty: 1, reason: "purchase" })),
      row("97000000-0000-4000-8300-000000000085", "payments", "insert",
        paymentRow("97000000-0000-4000-8200-000000000085", purchaseId, 10000)),
      row("97000000-0000-4000-8300-000000000086", "cash_drawer", "insert",
        drawerRow("97000000-0000-4000-8200-000000000086", { business_date: "2026-08-23" })),
      row("97000000-0000-4000-8300-000000000087", "cash_drawer", "update",
        drawerRow("97000000-0000-4000-8200-000000000086",
          { business_date: "2026-08-23", closing_expected: 10000, updated_at: UPDATED_AT })),
    ];

    await expect(stageKind(purchaseId, "purchase_create", rows)).rejects.toMatchObject({ code: "MU024" });
    expect((await h!.one<{ n: number }>(
      `select count(*)::int n from purchases where id=$1`, [purchaseId],
    )).n).toBe(0);
  });

  it("rejects new-drawer rows when update precedes insert", async () => {
    const purchaseId = "97000000-0000-4000-8200-000000000101";
    const batchId = "97000000-0000-4000-8200-000000000103";
    const drawerId = "97000000-0000-4000-8200-000000000106";
    const rows = [
      row("97000000-0000-4000-8300-000000000101", "purchases", "insert",
        purchaseRow(purchaseId, { total: 10000, paid_amount: 10000 })),
      row("97000000-0000-4000-8300-000000000102", "purchase_items", "insert",
        purchaseItemRow("97000000-0000-4000-8200-000000000102", purchaseId,
          { qty: 1, purchase_price: 10000, sale_price: 15000 })),
      row("97000000-0000-4000-8300-000000000103", "batches", "insert",
        batchRow(batchId, { purchase_price: 10000, sale_price: 15000 })),
      row("97000000-0000-4000-8300-000000000104", "inventory_movements", "insert",
        movementRow("97000000-0000-4000-8200-000000000104", batchId, purchaseId,
          { change_qty: 1, reason: "purchase" })),
      row("97000000-0000-4000-8300-000000000105", "payments", "insert",
        paymentRow("97000000-0000-4000-8200-000000000105", purchaseId, 10000)),
      row("97000000-0000-4000-8300-000000000106", "cash_drawer", "update",
        drawerRow(drawerId, { closing_expected: 10000, updated_at: UPDATED_AT })),
      row("97000000-0000-4000-8300-000000000107", "cash_drawer", "insert",
        drawerRow(drawerId)),
    ];

    await expect(stageKind(purchaseId, "purchase_create", rows)).rejects.toMatchObject({ code: "MU024" });
  });

  it("rejects forged residual cash and rolls back the whole COD create", async () => {
    await seedSupplierCredit(30000);
    const purchaseId = "97000000-0000-4000-8200-000000000041";
    const itemId = "97000000-0000-4000-8200-000000000042";
    const batchId = "97000000-0000-4000-8200-000000000043";
    const rows = [
      row("97000000-0000-4000-8300-000000000041", "purchases", "insert",
        purchaseRow(purchaseId, { total: 50000, paid_amount: 50000 })),
      row("97000000-0000-4000-8300-000000000042", "purchase_items", "insert",
        purchaseItemRow(itemId, purchaseId, { qty: 5, purchase_price: 10000 })),
      row("97000000-0000-4000-8300-000000000043", "batches", "insert", batchRow(batchId)),
      row("97000000-0000-4000-8300-000000000044", "inventory_movements", "insert",
        movementRow("97000000-0000-4000-8200-000000000044", batchId, purchaseId,
          { change_qty: 5, reason: "purchase" })),
      row("97000000-0000-4000-8300-000000000045", "payments", "insert",
        paymentRow("97000000-0000-4000-8200-000000000045", purchaseId, 50000)),
      row("97000000-0000-4000-8300-000000000046", "cash_drawer", "insert",
        drawerRow("97000000-0000-4000-8200-000000000046")),
    ];
    await expect(stageKind(purchaseId, "purchase_create", rows)).rejects.toMatchObject({ code: "MU024" });
    expect((await h!.one<{ n: number }>(`select count(*)::int n from purchases where id=$1`, [purchaseId])).n).toBe(0);
  });
});

describe("purchase_return — atomic apply + idempotent retry", () => {
  it("applies a normal partial return atomically and retries idempotently", async () => {
    const purchaseId = "96000000-0000-4000-8100-000000000001";
    const itemId = "96000000-0000-4000-8100-000000000002";
    const batchId = "96000000-0000-4000-8100-000000000003";
    const returnId = "96000000-0000-4000-8100-000000000004";
    await seedReceivedLine(purchaseId, itemId, batchId, 10, 10000);

    const rows = [
      row("96000000-0000-4000-8200-000000000001", "purchase_returns", "insert",
        returnRow(returnId, purchaseId, itemId, { qty: 3, credit_amount: 30000 })),
      row("96000000-0000-4000-8200-000000000002", "inventory_movements", "insert",
        movementRow("96000000-0000-4000-8100-000000000005", batchId, returnId, { change_qty: -3 })),
      row("96000000-0000-4000-8200-000000000003", "audit_logs", "insert",
        auditRow("96000000-0000-4000-8100-000000000006", returnId)),
    ];
    expect((await stage(returnId, rows)).result.status).toBe("applied");
    // Retry with the SAME operation id is a true no-op, not reapplied.
    expect((await stage(returnId, rows)).result.status).toBe("applied");

    expect(await h!.one(
      `select
         (select count(*)::int from purchase_returns where id=$1) returns,
         (select count(*)::int from inventory_movements where ref_id=$1) movements,
         (select stock::int from batches where id=$2) stock`,
      [returnId, batchId],
    )).toEqual({ returns: 1, movements: 1, stock: 7 });
  });
});

describe("purchase_return — server re-derives the max returnable, never trusts the client", () => {
  it("locks the exact batch row before validating current stock", async () => {
    const functionDef = await h!.one<{ definition: string }>(
      `select string_agg(pg_get_functiondef(p.oid), E'\n') definition
         from pg_proc p
         join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public'
          and p.proname like 'sync_apply_operation%'
          and pg_get_function_identity_arguments(p.oid)=
            'p_shop_id uuid, p_operation_id uuid, p_operation_kind text, p_actor_id uuid, p_device_id text, p_rows jsonb'`,
    );
    expect(functionDef.definition).toMatch(
      /select id, coalesce\(stock,0\)[\s\S]*?from batches[\s\S]*?batch_no=v_existing_item\.batch_no and not is_deleted[\s\S]*?for update/,
    );
  });

  it("rejects a qty exceeding received-minus-already-returned", async () => {
    const purchaseId = "96000000-0000-4000-8100-000000000011";
    const itemId = "96000000-0000-4000-8100-000000000012";
    const batchId = "96000000-0000-4000-8100-000000000013";
    const returnId = "96000000-0000-4000-8100-000000000014";
    await seedReceivedLine(purchaseId, itemId, batchId, 5, 10000, "B-RET-11");

    const rows = [
      row("96000000-0000-4000-8200-000000000011", "purchase_returns", "insert",
        returnRow(returnId, purchaseId, itemId, { qty: 6, credit_amount: 60000 })),
      row("96000000-0000-4000-8200-000000000012", "inventory_movements", "insert",
        movementRow("96000000-0000-4000-8100-000000000015", batchId, returnId, { change_qty: -6 })),
      row("96000000-0000-4000-8200-000000000013", "audit_logs", "insert",
        auditRow("96000000-0000-4000-8100-000000000016", returnId)),
    ];
    await expect(stage(returnId, rows)).rejects.toMatchObject({ code: "MU024" });
    expect((await h!.one<{ n: number }>(
      `select count(*)::int n from purchase_returns where id=$1`, [returnId],
    )).n).toBe(0);
  });

  it("rejects a qty exceeding CURRENT BATCH STOCK even when received-minus-returned would allow more", async () => {
    const purchaseId = "96000000-0000-4000-8100-000000000021";
    const itemId = "96000000-0000-4000-8100-000000000022";
    const batchId = "96000000-0000-4000-8100-000000000023";
    const returnId = "96000000-0000-4000-8100-000000000024";
    await seedReceivedLine(purchaseId, itemId, batchId, 10, 10000, "B-RET-21");
    // Simulate 7 units already sold — only 3 remain physically in stock.
    // batches.stock is ledger-derived and guarded against direct UPDATEs
    // too (the same before-update trigger forces new.stock:=old.stock), so
    // this must be a real negative inventory_movements row, exactly like a
    // genuine sale would produce.
    await h!.exec(`
      insert into inventory_movements(id,shop_id,batch_id,change_qty,reason,ref_id,created_by,created_at,updated_at)
      values('96000000-0000-4000-8100-000000000028','${SHOP_A}','${batchId}',-7,'sale',null,'${OWNER_A}','${CREATED_AT}','${CREATED_AT}');
    `);

    const rows = [
      row("96000000-0000-4000-8200-000000000021", "purchase_returns", "insert",
        returnRow(returnId, purchaseId, itemId, { qty: 4, credit_amount: 40000 })),
      row("96000000-0000-4000-8200-000000000022", "inventory_movements", "insert",
        movementRow("96000000-0000-4000-8100-000000000025", batchId, returnId, { change_qty: -4 })),
      row("96000000-0000-4000-8200-000000000023", "audit_logs", "insert",
        auditRow("96000000-0000-4000-8100-000000000026", returnId)),
    ];
    await expect(stage(returnId, rows)).rejects.toMatchObject({ code: "MU024" });
  });

  it("accounts for a prior return already on this line when computing the remainder", async () => {
    const purchaseId = "96000000-0000-4000-8100-000000000031";
    const itemId = "96000000-0000-4000-8100-000000000032";
    const batchId = "96000000-0000-4000-8100-000000000033";
    const firstReturnId = "96000000-0000-4000-8100-000000000034";
    const secondReturnId = "96000000-0000-4000-8100-000000000035";
    await seedReceivedLine(purchaseId, itemId, batchId, 10, 10000, "B-RET-31");

    await stage(firstReturnId, [
      row("96000000-0000-4000-8200-000000000031", "purchase_returns", "insert",
        returnRow(firstReturnId, purchaseId, itemId, { qty: 7, credit_amount: 70000 })),
      row("96000000-0000-4000-8200-000000000032", "inventory_movements", "insert",
        movementRow("96000000-0000-4000-8100-000000000036", batchId, firstReturnId, { change_qty: -7 })),
      row("96000000-0000-4000-8200-000000000033", "audit_logs", "insert",
        auditRow("96000000-0000-4000-8100-000000000037", firstReturnId)),
    ]);

    // Only 3 remain (10 - 7); requesting 4 more must be rejected.
    const overRows = [
      row("96000000-0000-4000-8200-000000000034", "purchase_returns", "insert",
        returnRow(secondReturnId, purchaseId, itemId, { qty: 4, credit_amount: 40000 })),
      row("96000000-0000-4000-8200-000000000035", "inventory_movements", "insert",
        movementRow("96000000-0000-4000-8100-000000000038", batchId, secondReturnId, { change_qty: -4 })),
      row("96000000-0000-4000-8200-000000000036", "audit_logs", "insert",
        auditRow("96000000-0000-4000-8100-000000000039", secondReturnId)),
    ];
    await expect(stage(secondReturnId, overRows)).rejects.toMatchObject({ code: "MU024" });

    // Exactly the remainder still succeeds.
    const exactRows = [
      row("96000000-0000-4000-8200-000000000037", "purchase_returns", "insert",
        returnRow(secondReturnId, purchaseId, itemId, { qty: 3, credit_amount: 30000 })),
      row("96000000-0000-4000-8200-000000000038", "inventory_movements", "insert",
        movementRow("96000000-0000-4000-8100-000000000040", batchId, secondReturnId, { change_qty: -3 })),
      row("96000000-0000-4000-8200-000000000039", "audit_logs", "insert",
        auditRow("96000000-0000-4000-8100-000000000041", secondReturnId)),
    ];
    expect((await stage(secondReturnId, exactRows)).result.status).toBe("applied");
  });

  it("rejects a return against a PENDING line", async () => {
    const purchaseId = "96000000-0000-4000-8100-000000000051";
    const itemId = "96000000-0000-4000-8100-000000000052";
    const returnId = "96000000-0000-4000-8100-000000000053";
    await h!.exec(`
      insert into purchases(id,shop_id,invoice_no,supplier_id,total,payment_terms,paid_amount,source,created_at,updated_at)
      values('${purchaseId}','${SHOP_A}','PUR-RET-PEND','${SUPPLIER}',0,'credit',0,'manual','${CREATED_AT}','${CREATED_AT}');
      insert into purchase_items(id,shop_id,purchase_id,medicine_id,batch_no,expiry_date,qty,purchase_price,sale_price,status,received_at,created_at,updated_at)
      values('${itemId}','${SHOP_A}','${purchaseId}','${MEDICINE}','B-PEND-1','2028-01-01',5,10000,15000,'pending',null,'${CREATED_AT}','${CREATED_AT}');
    `);
    const rows = [
      row("96000000-0000-4000-8200-000000000051", "purchase_returns", "insert",
        returnRow(returnId, purchaseId, itemId, { qty: 1, credit_amount: 10000 })),
      row("96000000-0000-4000-8200-000000000052", "inventory_movements", "insert",
        movementRow("96000000-0000-4000-8100-000000000054", "96000000-0000-4000-8100-000000000055", returnId)),
      row("96000000-0000-4000-8200-000000000053", "audit_logs", "insert",
        auditRow("96000000-0000-4000-8100-000000000056", returnId)),
    ];
    await expect(stage(returnId, rows)).rejects.toMatchObject({ code: "MU024" });
  });
});

describe("purchase_return — server re-derives credit_amount, never trusts the client", () => {
  it("rejects a credit_amount that does not match qty * purchase_price", async () => {
    const purchaseId = "96000000-0000-4000-8100-000000000061";
    const itemId = "96000000-0000-4000-8100-000000000062";
    const batchId = "96000000-0000-4000-8100-000000000063";
    const returnId = "96000000-0000-4000-8100-000000000064";
    await seedReceivedLine(purchaseId, itemId, batchId, 5, 10000, "B-RET-61");

    const rows = [
      row("96000000-0000-4000-8200-000000000061", "purchase_returns", "insert",
        returnRow(returnId, purchaseId, itemId, { qty: 2, credit_amount: 999999 })), // should be 20000
      row("96000000-0000-4000-8200-000000000062", "inventory_movements", "insert",
        movementRow("96000000-0000-4000-8100-000000000065", batchId, returnId, { change_qty: -2 })),
      row("96000000-0000-4000-8200-000000000063", "audit_logs", "insert",
        auditRow("96000000-0000-4000-8100-000000000066", returnId)),
    ];
    await expect(stage(returnId, rows)).rejects.toMatchObject({ code: "MU024" });
  });
});

describe("purchase_return — row-shape and table-allowlist validation", () => {
  it("rejects reordered rows and leaves every table unchanged", async () => {
    const purchaseId = "96000000-0000-4000-8100-000000000111";
    const itemId = "96000000-0000-4000-8100-000000000112";
    const batchId = "96000000-0000-4000-8100-000000000113";
    const returnId = "96000000-0000-4000-8100-000000000114";
    await seedReceivedLine(purchaseId, itemId, batchId, 5, 10000, "B-RET-111");
    const rows = [
      row("96000000-0000-4000-8200-000000000111", "inventory_movements", "insert",
        movementRow("96000000-0000-4000-8100-000000000115", batchId, returnId)),
      row("96000000-0000-4000-8200-000000000112", "purchase_returns", "insert",
        returnRow(returnId, purchaseId, itemId, { credit_amount: 10000 })),
      row("96000000-0000-4000-8200-000000000113", "audit_logs", "insert",
        auditRow("96000000-0000-4000-8100-000000000116", returnId)),
    ];
    await expect(stage(returnId, rows)).rejects.toMatchObject({ code: "MU024" });
    expect(await h!.one(
      `select (select count(*)::int from purchase_returns where id=$1) returns,
              (select count(*)::int from inventory_movements where ref_id=$1) movements`,
      [returnId],
    )).toEqual({ returns: 0, movements: 0 });
  });

  it("rejects a tombstoned movement or audit row", async () => {
    const purchaseId = "96000000-0000-4000-8100-000000000121";
    const itemId = "96000000-0000-4000-8100-000000000122";
    const batchId = "96000000-0000-4000-8100-000000000123";
    const returnId = "96000000-0000-4000-8100-000000000124";
    await seedReceivedLine(purchaseId, itemId, batchId, 5, 10000, "B-RET-121");
    const rows = [
      row("96000000-0000-4000-8200-000000000121", "purchase_returns", "insert",
        returnRow(returnId, purchaseId, itemId, { credit_amount: 10000 })),
      row("96000000-0000-4000-8200-000000000122", "inventory_movements", "insert",
        movementRow("96000000-0000-4000-8100-000000000125", batchId, returnId,
          { is_deleted: true, deleted_at: CREATED_AT, deleted_by: OWNER_A })),
      row("96000000-0000-4000-8200-000000000123", "audit_logs", "insert",
        auditRow("96000000-0000-4000-8100-000000000126", returnId)),
    ];
    await expect(stage(returnId, rows)).rejects.toMatchObject({ code: "MU024" });
  });

  it("requires every grouped return row to explicitly be live", async () => {
    const purchaseId = "96000000-0000-4000-8100-000000000131";
    const itemId = "96000000-0000-4000-8100-000000000132";
    const batchId = "96000000-0000-4000-8100-000000000133";
    const returnId = "96000000-0000-4000-8100-000000000134";
    await seedReceivedLine(purchaseId, itemId, batchId, 5, 10000, "B-RET-131");
    const missingLiveMarker = auditRow("96000000-0000-4000-8100-000000000136", returnId);
    Reflect.deleteProperty(missingLiveMarker, "is_deleted");
    const rows = [
      row("96000000-0000-4000-8200-000000000131", "purchase_returns", "insert",
        returnRow(returnId, purchaseId, itemId, { credit_amount: 10000 })),
      row("96000000-0000-4000-8200-000000000132", "inventory_movements", "insert",
        movementRow("96000000-0000-4000-8100-000000000135", batchId, returnId)),
      row("96000000-0000-4000-8200-000000000133", "audit_logs", "insert", missingLiveMarker),
    ];
    await expect(stage(returnId, rows)).rejects.toMatchObject({ code: "MU024" });
  });

  it("rejects a movement row with the wrong sign, reason, or batch", async () => {
    const purchaseId = "96000000-0000-4000-8100-000000000071";
    const itemId = "96000000-0000-4000-8100-000000000072";
    const batchId = "96000000-0000-4000-8100-000000000073";
    const returnId = "96000000-0000-4000-8100-000000000074";
    await seedReceivedLine(purchaseId, itemId, batchId, 5, 10000, "B-RET-71");

    const rows = [
      row("96000000-0000-4000-8200-000000000071", "purchase_returns", "insert",
        returnRow(returnId, purchaseId, itemId, { qty: 2, credit_amount: 20000 })),
      row("96000000-0000-4000-8200-000000000072", "inventory_movements", "insert",
        movementRow("96000000-0000-4000-8100-000000000075", batchId, returnId, { change_qty: 2 })), // positive — wrong
      row("96000000-0000-4000-8200-000000000073", "audit_logs", "insert",
        auditRow("96000000-0000-4000-8100-000000000076", returnId)),
    ];
    await expect(stage(returnId, rows)).rejects.toMatchObject({ code: "MU024" });
  });

  it("rejects an audit row with the wrong action or target", async () => {
    const purchaseId = "96000000-0000-4000-8100-000000000081";
    const itemId = "96000000-0000-4000-8100-000000000082";
    const batchId = "96000000-0000-4000-8100-000000000083";
    const returnId = "96000000-0000-4000-8100-000000000084";
    await seedReceivedLine(purchaseId, itemId, batchId, 5, 10000, "B-RET-81");

    const rows = [
      row("96000000-0000-4000-8200-000000000081", "purchase_returns", "insert",
        returnRow(returnId, purchaseId, itemId, { qty: 2, credit_amount: 20000 })),
      row("96000000-0000-4000-8200-000000000082", "inventory_movements", "insert",
        movementRow("96000000-0000-4000-8100-000000000085", batchId, returnId, { change_qty: -2 })),
      row("96000000-0000-4000-8200-000000000083", "audit_logs", "insert",
        auditRow("96000000-0000-4000-8100-000000000086", returnId, { action: "purchase_voided" })), // wrong action
    ];
    await expect(stage(returnId, rows)).rejects.toMatchObject({ code: "MU024" });
  });

  it("rejects a disallowed table in the group", async () => {
    const purchaseId = "96000000-0000-4000-8100-000000000091";
    const itemId = "96000000-0000-4000-8100-000000000092";
    const batchId = "96000000-0000-4000-8100-000000000093";
    const returnId = "96000000-0000-4000-8100-000000000094";
    await seedReceivedLine(purchaseId, itemId, batchId, 5, 10000, "B-RET-91");

    const rows = [
      row("96000000-0000-4000-8200-000000000091", "purchase_returns", "insert",
        returnRow(returnId, purchaseId, itemId, { qty: 2, credit_amount: 20000 })),
      row("96000000-0000-4000-8200-000000000092", "inventory_movements", "insert",
        movementRow("96000000-0000-4000-8100-000000000095", batchId, returnId, { change_qty: -2 })),
      row("96000000-0000-4000-8200-000000000093", "payments", "insert",
        { id: "96000000-0000-4000-8100-000000000096", shop_id: SHOP_A, type: "supplier_payment", party_id: SUPPLIER, amount: 1, method: "cash", ref_id: purchaseId, created_by: OWNER_A, created_at: CREATED_AT, updated_at: CREATED_AT, is_deleted: false, deleted_at: null, deleted_by: null }),
    ];
    await expect(stage(returnId, rows)).rejects.toMatchObject({ code: "MU004" });
  });

  it("is Owner-only", async () => {
    const purchaseId = "96000000-0000-4000-8100-000000000101";
    const itemId = "96000000-0000-4000-8100-000000000102";
    const batchId = "96000000-0000-4000-8100-000000000103";
    const returnId = "96000000-0000-4000-8100-000000000104";
    await seedReceivedLine(purchaseId, itemId, batchId, 5, 10000, "B-RET-101");

    const rows = [
      row("96000000-0000-4000-8200-000000000101", "purchase_returns", "insert",
        returnRow(returnId, purchaseId, itemId, { qty: 1, credit_amount: 10000, created_by: STAFF_A })),
      row("96000000-0000-4000-8200-000000000102", "inventory_movements", "insert",
        movementRow("96000000-0000-4000-8100-000000000105", batchId, returnId, { change_qty: -1 })),
      row("96000000-0000-4000-8200-000000000103", "audit_logs", "insert",
        auditRow("96000000-0000-4000-8100-000000000106", returnId, { actor_id: STAFF_A })),
    ];
    await expect(stage(returnId, rows, STAFF_A)).rejects.toMatchObject({ code: "MU015" });
  });
});
