import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyRow,
  createHarness,
  type Harness,
  OWNER_A,
  seedShops,
  SHOP_A,
  STAFF_A,
  T0,
} from "./harness";

// B3 Groups 4-6 review-fix: server-side grouped-sync coverage for
// supplier_payment, purchase_receive_line, purchase_void, purchase_create —
// added by 20260823050000_b3_groups456_sync_completion.sql. Mirrors the
// b3-group3.pgtest.ts harness pattern exactly.
//
// recordChange (db/sync-helpers.ts) re-reads the COMPLETE current row from
// SQLite for every non-delete outgoing payload — never a partial patch — so
// every "update" row below carries the full row shape too, exactly as a
// real client would push it.

const SUPPLIER = "95000000-0000-4000-8000-000000000001";
const MEDICINE = "95000000-0000-4000-8000-000000000002";
const CREATED_AT = "2026-08-23T04:00:00.000Z";
// sync_apply_row_base's upsert is last-write-wins: `where <table>.updated_at
// < excluded.updated_at`. Every row targeting an EXISTING row (an "update"
// op, or an "insert" whose id was already seeded directly via SQL) must
// carry a strictly-later updated_at than what's already in the table, or
// the write silently no-ops instead of applying.
const UPDATED_AT = "2026-08-23T05:00:00.000Z";
const BUSINESS_DATE = "2026-08-23";

let h: Harness | null = null;

beforeEach(async () => {
  h = await createHarness();
  await seedShops(h);
  await h.exec(`
    insert into suppliers(id,shop_id,name,created_at,updated_at)
    values('${SUPPLIER}','${SHOP_A}','Test Supplier','${T0}','${T0}');
    insert into medicines(id,shop_id,name,created_at,updated_at)
    values('${MEDICINE}','${SHOP_A}','Napa Extra','${T0}','${T0}');
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

function purchasesRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, shop_id: SHOP_A, invoice_no: "PUR-TEST", supplier_id: SUPPLIER, total: 0,
    payment_terms: "credit", paid_amount: 0, invoice_date: null, source: "manual",
    voided_at: null, voided_by: null, created_at: CREATED_AT, updated_at: CREATED_AT,
    is_deleted: false, deleted_at: null, deleted_by: null,
    ...overrides,
  };
}
function purchaseItemsRow(id: string, purchaseId: string, overrides: Record<string, unknown> = {}) {
  return {
    id, shop_id: SHOP_A, purchase_id: purchaseId, medicine_id: MEDICINE, batch_no: "B-X",
    expiry_date: "2028-01-01", qty: 1, purchase_price: 0, sale_price: 0, status: "received",
    received_at: CREATED_AT, created_at: CREATED_AT, updated_at: CREATED_AT,
    is_deleted: false, deleted_at: null, deleted_by: null,
    ...overrides,
  };
}
function batchesRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, shop_id: SHOP_A, medicine_id: MEDICINE, batch_no: "B-X", expiry_date: "2028-01-01",
    stock: 0, purchase_price: 0, sale_price: 0, is_discounted: false, original_price: null,
    created_at: CREATED_AT, updated_at: CREATED_AT,
    is_deleted: false, deleted_at: null, deleted_by: null,
    ...overrides,
  };
}
function movementRow(id: string, batchId: string, refId: string, overrides: Record<string, unknown> = {}) {
  return {
    id, shop_id: SHOP_A, batch_id: batchId, change_qty: 1, reason: "purchase", ref_id: refId,
    created_by: OWNER_A, created_at: CREATED_AT, updated_at: CREATED_AT,
    is_deleted: false, deleted_at: null, deleted_by: null,
    ...overrides,
  };
}
function paymentsRow(id: string, refId: string, overrides: Record<string, unknown> = {}) {
  return {
    id, shop_id: SHOP_A, type: "supplier_payment", party_id: SUPPLIER, amount: 0,
    method: "cash", ref_id: refId, created_by: OWNER_A, created_at: CREATED_AT, updated_at: CREATED_AT,
    is_deleted: false, deleted_at: null, deleted_by: null,
    ...overrides,
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
function auditRow(id: string, target: string, overrides: Record<string, unknown> = {}) {
  return {
    id, shop_id: SHOP_A, actor_id: OWNER_A, action: "purchase_voided", target, meta: "{}",
    created_at: CREATED_AT, updated_at: CREATED_AT,
    is_deleted: false, deleted_at: null, deleted_by: null,
    ...overrides,
  };
}

async function stage(
  operationId: string,
  kind:
    | "supplier_payment"
    | "purchase_receive_line"
    | "purchase_void"
    | "purchase_create",
  rows: unknown[],
  actorId: string = OWNER_A,
  expectedCount: number = rows.length,
) {
  return h!.one<{ result: { status: string; receivedRowCount: number } }>(
    `select sync_stage_operation_chunk(
       $1,$2,$3,$4,'device-a',$5,'g456-payload-hash-0001',
       0,'g456-chunk-hash-0001',$6::jsonb
     ) result`,
    [SHOP_A, operationId, kind, actorId, expectedCount, JSON.stringify(rows)],
  );
}

async function seedCreditPurchase(purchaseId: string, total: number, paidAmount = 0) {
  await h!.exec(`
    insert into purchases(
      id,shop_id,invoice_no,supplier_id,total,payment_terms,paid_amount,
      source,created_at,updated_at
    ) values(
      '${purchaseId}','${SHOP_A}','PUR-TEST-${purchaseId.slice(-4)}','${SUPPLIER}',
      ${total},'credit',${paidAmount},'manual','${CREATED_AT}','${CREATED_AT}'
    );
  `);
}

describe("purchase_create", () => {
  it("applies a full credit purchase atomically and retries idempotently", async () => {
    const purchaseId = "95000000-0000-4000-8100-000000000001";
    const itemId = "95000000-0000-4000-8100-000000000002";
    const batchId = "95000000-0000-4000-8100-000000000003";
    const movementId = "95000000-0000-4000-8100-000000000004";
    const rows = [
      row("95000000-0000-4000-8200-000000000001", "purchases", "insert",
        purchasesRow(purchaseId, { invoice_no: "PUR-2026-000001", total: 50000 })),
      row("95000000-0000-4000-8200-000000000002", "purchase_items", "insert",
        purchaseItemsRow(itemId, purchaseId, { batch_no: "B-100", qty: 5, purchase_price: 10000, sale_price: 15000 })),
      row("95000000-0000-4000-8200-000000000003", "batches", "insert",
        batchesRow(batchId, { batch_no: "B-100", purchase_price: 10000, sale_price: 15000 })),
      row("95000000-0000-4000-8200-000000000004", "inventory_movements", "insert",
        movementRow(movementId, batchId, purchaseId, { change_qty: 5 })),
    ];
    expect((await stage(purchaseId, "purchase_create", rows)).result.status).toBe("applied");
    expect((await stage(purchaseId, "purchase_create", rows)).result.status).toBe("applied");
    expect(await h!.one(
      `select
         (select count(*)::int from purchases where id=$1) purchases,
         (select count(*)::int from purchase_items where purchase_id=$1) items,
         (select count(*)::int from inventory_movements where ref_id=$1) movements`,
      [purchaseId],
    )).toEqual({ purchases: 1, items: 1, movements: 1 });
  });

  it("rejects a total that does not match the server-recomputed sum of received lines", async () => {
    const purchaseId = "95000000-0000-4000-8100-000000000011";
    const itemId = "95000000-0000-4000-8100-000000000012";
    const batchId = "95000000-0000-4000-8100-000000000013";
    const movementId = "95000000-0000-4000-8100-000000000014";
    const rows = [
      row("95000000-0000-4000-8200-000000000011", "purchases", "insert",
        purchasesRow(purchaseId, { invoice_no: "PUR-2026-000002", total: 999999 })),
      row("95000000-0000-4000-8200-000000000012", "purchase_items", "insert",
        purchaseItemsRow(itemId, purchaseId, { batch_no: "B-101", qty: 5, purchase_price: 10000, sale_price: 15000 })),
      row("95000000-0000-4000-8200-000000000013", "batches", "insert",
        batchesRow(batchId, { batch_no: "B-101", purchase_price: 10000, sale_price: 15000 })),
      row("95000000-0000-4000-8200-000000000014", "inventory_movements", "insert",
        movementRow(movementId, batchId, purchaseId, { change_qty: 5 })),
    ];
    await expect(stage(purchaseId, "purchase_create", rows)).rejects.toMatchObject({ code: "MU024" });
    expect((await h!.one<{ n: number }>(
      `select count(*)::int n from purchases where id=$1`, [purchaseId],
    )).n).toBe(0);
  });

  it("requires COD purchases to be fully paid at creation via one settlement payment and drawer rows", async () => {
    const purchaseId = "95000000-0000-4000-8100-000000000021";
    const itemId = "95000000-0000-4000-8100-000000000022";
    const batchId = "95000000-0000-4000-8100-000000000023";
    const movementId = "95000000-0000-4000-8100-000000000024";
    const paymentId = "95000000-0000-4000-8100-000000000025";
    const drawerId = "95000000-0000-4000-8100-000000000026";
    const rows = [
      row("95000000-0000-4000-8200-000000000021", "purchases", "insert",
        purchasesRow(purchaseId, { invoice_no: "PUR-2026-000003", total: 20000, payment_terms: "cod", paid_amount: 20000, source: "ocr" })),
      row("95000000-0000-4000-8200-000000000022", "purchase_items", "insert",
        purchaseItemsRow(itemId, purchaseId, { batch_no: "B-102", qty: 2, purchase_price: 10000, sale_price: 15000 })),
      row("95000000-0000-4000-8200-000000000023", "batches", "insert",
        batchesRow(batchId, { batch_no: "B-102", purchase_price: 10000, sale_price: 15000 })),
      row("95000000-0000-4000-8200-000000000024", "inventory_movements", "insert",
        movementRow(movementId, batchId, purchaseId, { change_qty: 2 })),
      row("95000000-0000-4000-8200-000000000025", "payments", "insert",
        paymentsRow(paymentId, purchaseId, { amount: 20000 })),
      row("95000000-0000-4000-8200-000000000026", "cash_drawer", "insert",
        drawerRow(drawerId, { closing_expected: 20000 })),
    ];
    expect((await stage(purchaseId, "purchase_create", rows)).result.status).toBe("applied");
    expect(await h!.one(
      `select total::int,paid_amount::int from purchases where id=$1`, [purchaseId],
    )).toEqual({ total: 20000, paid_amount: 20000 });
  });

  it("is Owner-only", async () => {
    const purchaseId = "95000000-0000-4000-8100-000000000031";
    const rows = [
      row("95000000-0000-4000-8200-000000000031", "purchases", "insert",
        purchasesRow(purchaseId, { invoice_no: "PUR-2026-000004", total: 0 })),
      row("95000000-0000-4000-8200-000000000032", "purchase_items", "insert",
        purchaseItemsRow("95000000-0000-4000-8100-000000000032", purchaseId, {
          batch_no: "B-103", qty: 1, purchase_price: 0, sale_price: 0, status: "pending", received_at: null,
        })),
    ];
    await expect(stage(purchaseId, "purchase_create", rows, STAFF_A)).rejects.toMatchObject({ code: "MU015" });
  });
});

describe("supplier_payment", () => {
  it("caps an over-amount client payload server-side rather than trusting it", async () => {
    const purchaseId = "95000000-0000-4000-8100-000000000041";
    await seedCreditPurchase(purchaseId, 30000, 0);
    const paymentId = "95000000-0000-4000-8100-000000000042";
    // Client SHOULD have capped this to 30000, but the server must never
    // trust that arithmetic — it re-derives remaining from the purchase row.
    const rows = [
      row("95000000-0000-4000-8200-000000000041", "payments", "insert",
        paymentsRow(paymentId, purchaseId, { amount: 30000 })),
      row("95000000-0000-4000-8200-000000000042", "purchases", "update",
        purchasesRow(purchaseId, { total: 30000, paid_amount: 30000, updated_at: UPDATED_AT })),
      row("95000000-0000-4000-8200-000000000043", "cash_drawer", "insert",
        drawerRow("95000000-0000-4000-8100-000000000043", { closing_expected: 30000 })),
    ];
    expect((await stage(paymentId, "supplier_payment", rows)).result.status).toBe("applied");
    expect((await stage(paymentId, "supplier_payment", rows)).result.status).toBe("applied");
    expect(await h!.one(
      `select paid_amount::int from purchases where id=$1`, [purchaseId],
    )).toEqual({ paid_amount: 30000 });
  });

  it("rejects an over-amount purchase-update mismatch against the server-recomputed remaining", async () => {
    const purchaseId = "95000000-0000-4000-8100-000000000051";
    await seedCreditPurchase(purchaseId, 30000, 0);
    const paymentId = "95000000-0000-4000-8100-000000000052";
    const rows = [
      row("95000000-0000-4000-8200-000000000051", "payments", "insert",
        paymentsRow(paymentId, purchaseId, { amount: 40000 })),
      row("95000000-0000-4000-8200-000000000052", "purchases", "update",
        purchasesRow(purchaseId, { total: 30000, paid_amount: 40000 })),
    ];
    await expect(stage(paymentId, "supplier_payment", rows)).rejects.toMatchObject({ code: "MU024" });
    expect(await h!.one(
      `select paid_amount::int from purchases where id=$1`, [purchaseId],
    )).toEqual({ paid_amount: 0 });
  });

  it("refuses a payment against a COD purchase", async () => {
    const purchaseId = "95000000-0000-4000-8100-000000000061";
    await h!.exec(`
      insert into purchases(
        id,shop_id,invoice_no,supplier_id,total,payment_terms,paid_amount,
        source,created_at,updated_at
      ) values(
        '${purchaseId}','${SHOP_A}','PUR-COD-1','${SUPPLIER}',10000,'cod',10000,
        'manual','${CREATED_AT}','${CREATED_AT}'
      );
    `);
    const paymentId = "95000000-0000-4000-8100-000000000062";
    const rows = [
      row("95000000-0000-4000-8200-000000000061", "payments", "insert",
        paymentsRow(paymentId, purchaseId, { amount: 100 })),
      row("95000000-0000-4000-8200-000000000062", "purchases", "update",
        purchasesRow(purchaseId, { total: 10000, payment_terms: "cod", paid_amount: 10100 })),
    ];
    await expect(stage(paymentId, "supplier_payment", rows)).rejects.toMatchObject({ code: "MU024" });
  });
});

describe("purchase_receive_line — COD atomic settlement (review §3/§4)", () => {
  it("settles the newly-received line's value in the SAME transaction, keeping paid_amount equal to total", async () => {
    const purchaseId = "95000000-0000-4000-8100-000000000071";
    const receivedItemId = "95000000-0000-4000-8100-000000000079";
    const pendingItemId = "95000000-0000-4000-8100-000000000072";
    const batchId = "95000000-0000-4000-8100-000000000073";
    // COD purchase with one already-received line (worth 20000, matching the
    // seeded total/paid_amount) and one still-pending line worth 60000 once
    // received — recompute must be able to see BOTH rows.
    await h!.exec(`
      insert into purchases(
        id,shop_id,invoice_no,supplier_id,total,payment_terms,paid_amount,
        source,created_at,updated_at
      ) values(
        '${purchaseId}','${SHOP_A}','PUR-COD-RECV-1','${SUPPLIER}',20000,'cod',20000,
        'manual','${CREATED_AT}','${CREATED_AT}'
      );
      insert into purchase_items(
        id,shop_id,purchase_id,medicine_id,batch_no,expiry_date,qty,purchase_price,
        sale_price,status,received_at,created_at,updated_at
      ) values(
        '${receivedItemId}','${SHOP_A}','${purchaseId}','${MEDICINE}','B-RECV-0','2028-01-01',
        2,10000,15000,'received','${CREATED_AT}','${CREATED_AT}','${CREATED_AT}'
      );
      insert into purchase_items(
        id,shop_id,purchase_id,medicine_id,batch_no,expiry_date,qty,purchase_price,
        sale_price,status,received_at,created_at,updated_at
      ) values(
        '${pendingItemId}','${SHOP_A}','${purchaseId}','${MEDICINE}','B-PEND-1','2028-06-01',
        3,20000,30000,'pending',null,'${CREATED_AT}','${CREATED_AT}'
      );
      insert into payments(id,shop_id,type,party_id,amount,method,ref_id,created_by,created_at,updated_at)
      values('95000000-0000-4000-8100-000000000078','${SHOP_A}','supplier_payment','${SUPPLIER}',20000,'cash','${purchaseId}','${OWNER_A}','${CREATED_AT}','${CREATED_AT}');
    `);
    const movementId = "95000000-0000-4000-8100-000000000074";
    const codPaymentId = "95000000-0000-4000-8100-000000000075";
    const drawerId = "95000000-0000-4000-8100-000000000076";
    const rows = [
      row("95000000-0000-4000-8200-000000000071", "purchase_items", "update",
        purchaseItemsRow(pendingItemId, purchaseId, {
          batch_no: "B-PEND-1", expiry_date: "2028-06-01", qty: 3, purchase_price: 20000,
          sale_price: 30000, status: "received", received_at: CREATED_AT, updated_at: UPDATED_AT,
        })),
      row("95000000-0000-4000-8200-000000000072", "batches", "insert",
        batchesRow(batchId, { batch_no: "B-PEND-1", purchase_price: 20000, sale_price: 30000 })),
      row("95000000-0000-4000-8200-000000000073", "inventory_movements", "insert",
        movementRow(movementId, batchId, purchaseId, { change_qty: 3 })),
      row("95000000-0000-4000-8200-000000000074", "purchases", "update",
        purchasesRow(purchaseId, {
          invoice_no: "PUR-COD-RECV-1", total: 80000, payment_terms: "cod", paid_amount: 80000,
          updated_at: UPDATED_AT,
        })),
      row("95000000-0000-4000-8200-000000000075", "payments", "insert",
        paymentsRow(codPaymentId, purchaseId, { amount: 60000 })),
      row("95000000-0000-4000-8200-000000000076", "cash_drawer", "insert",
        drawerRow(drawerId, { closing_expected: 60000 })),
    ];
    expect((await stage(purchaseId, "purchase_receive_line", rows)).result.status).toBe("applied");
    const after = await h!.one<{ total: number; paid_amount: number }>(
      `select total::int,paid_amount::int from purchases where id=$1`, [purchaseId],
    );
    // The invariant this branch exists for: a COD invoice must never show a
    // remaining/unpaid balance after receiving a previously-pending line.
    expect(after.paid_amount).toBe(after.total);
    expect(after).toEqual({ total: 80000, paid_amount: 80000 });
    const paymentSum = await h!.one<{ sum: number }>(
      `select coalesce(sum(amount),0)::int sum from payments where ref_id=$1 and type='supplier_payment'`,
      [purchaseId],
    );
    expect(paymentSum.sum).toBe(80000);
  });

  it("rejects a total that does not match the server-recomputed sum", async () => {
    const purchaseId = "95000000-0000-4000-8100-000000000081";
    const itemId = "95000000-0000-4000-8100-000000000082";
    await h!.exec(`
      insert into purchases(
        id,shop_id,invoice_no,supplier_id,total,payment_terms,paid_amount,
        source,created_at,updated_at
      ) values(
        '${purchaseId}','${SHOP_A}','PUR-CREDIT-RECV-1','${SUPPLIER}',0,'credit',0,
        'manual','${CREATED_AT}','${CREATED_AT}'
      );
      insert into purchase_items(
        id,shop_id,purchase_id,medicine_id,batch_no,expiry_date,qty,purchase_price,
        sale_price,status,received_at,created_at,updated_at
      ) values(
        '${itemId}','${SHOP_A}','${purchaseId}','${MEDICINE}','B-PEND-2','2028-06-01',
        4,15000,22000,'pending',null,'${CREATED_AT}','${CREATED_AT}'
      );
    `);
    const batchId = "95000000-0000-4000-8100-000000000083";
    const movementId = "95000000-0000-4000-8100-000000000084";
    const rows = [
      row("95000000-0000-4000-8200-000000000081", "purchase_items", "update",
        purchaseItemsRow(itemId, purchaseId, {
          batch_no: "B-PEND-2", expiry_date: "2028-06-01", qty: 4, purchase_price: 15000,
          sale_price: 22000, status: "received", received_at: CREATED_AT,
        })),
      row("95000000-0000-4000-8200-000000000082", "batches", "insert",
        batchesRow(batchId, { batch_no: "B-PEND-2", purchase_price: 15000, sale_price: 22000 })),
      row("95000000-0000-4000-8200-000000000083", "inventory_movements", "insert",
        movementRow(movementId, batchId, purchaseId, { change_qty: 4 })),
      row("95000000-0000-4000-8200-000000000084", "purchases", "update",
        purchasesRow(purchaseId, { invoice_no: "PUR-CREDIT-RECV-1", total: 999999 })),
    ];
    await expect(stage(purchaseId, "purchase_receive_line", rows)).rejects.toMatchObject({ code: "MU024" });
    expect(await h!.one(
      `select status from purchase_items where id=$1`, [itemId],
    )).toEqual({ status: "pending" });
  });
});

describe("purchase_void — safety re-derived server-side (contract §5.13)", () => {
  it("voids a purchase with zero movements and zero payments", async () => {
    const purchaseId = "95000000-0000-4000-8100-000000000091";
    await seedCreditPurchase(purchaseId, 10000, 0);
    const auditId = "95000000-0000-4000-8100-000000000092";
    const rows = [
      row("95000000-0000-4000-8200-000000000091", "purchases", "update",
        purchasesRow(purchaseId, { total: 10000, voided_at: CREATED_AT, voided_by: OWNER_A, updated_at: UPDATED_AT })),
      row("95000000-0000-4000-8200-000000000092", "audit_logs", "insert",
        auditRow(auditId, purchaseId, { meta: JSON.stringify({ supplierId: SUPPLIER, amount: 10000 }) })),
    ];
    expect((await stage(purchaseId, "purchase_void", rows)).result.status).toBe("applied");
    expect(await h!.one(
      `select voided_by from purchases where id=$1`, [purchaseId],
    )).toEqual({ voided_by: OWNER_A });
  });

  it("rejects voiding a purchase that has a stock movement, even if the client claims otherwise", async () => {
    const purchaseId = "95000000-0000-4000-8100-000000000101";
    const batchId = "95000000-0000-4000-8100-000000000102";
    await seedCreditPurchase(purchaseId, 10000, 0);
    await h!.exec(`
      insert into batches(id,shop_id,medicine_id,batch_no,expiry_date,stock,purchase_price,sale_price,created_at,updated_at)
      values('${batchId}','${SHOP_A}','${MEDICINE}','B-VOID-1','2028-01-01',5,10000,15000,'${CREATED_AT}','${CREATED_AT}');
      insert into inventory_movements(id,shop_id,batch_id,change_qty,reason,ref_id,created_by,created_at,updated_at)
      values('95000000-0000-4000-8100-000000000103','${SHOP_A}','${batchId}',5,'purchase','${purchaseId}','${OWNER_A}','${CREATED_AT}','${CREATED_AT}');
    `);
    const auditId = "95000000-0000-4000-8100-000000000104";
    const rows = [
      row("95000000-0000-4000-8200-000000000101", "purchases", "update",
        purchasesRow(purchaseId, { total: 10000, voided_at: CREATED_AT, voided_by: OWNER_A })),
      row("95000000-0000-4000-8200-000000000102", "audit_logs", "insert",
        auditRow(auditId, purchaseId)),
    ];
    await expect(stage(purchaseId, "purchase_void", rows)).rejects.toMatchObject({ code: "MU024" });
    expect(await h!.one(
      `select voided_at from purchases where id=$1`, [purchaseId],
    )).toEqual({ voided_at: null });
  });

  it("rejects voiding a purchase that has a payment, even though this operation's own rows carry none", async () => {
    const purchaseId = "95000000-0000-4000-8100-000000000111";
    await seedCreditPurchase(purchaseId, 10000, 5000);
    await h!.exec(`
      insert into payments(id,shop_id,type,party_id,amount,method,ref_id,created_by,created_at,updated_at)
      values('95000000-0000-4000-8100-000000000112','${SHOP_A}','supplier_payment','${SUPPLIER}',5000,'cash','${purchaseId}','${OWNER_A}','${CREATED_AT}','${CREATED_AT}');
    `);
    const auditId = "95000000-0000-4000-8100-000000000113";
    const rows = [
      row("95000000-0000-4000-8200-000000000111", "purchases", "update",
        purchasesRow(purchaseId, { total: 10000, paid_amount: 5000, voided_at: CREATED_AT, voided_by: OWNER_A })),
      row("95000000-0000-4000-8200-000000000112", "audit_logs", "insert",
        auditRow(auditId, purchaseId)),
    ];
    await expect(stage(purchaseId, "purchase_void", rows)).rejects.toMatchObject({ code: "MU024" });
  });

  it("rejects a malformed 2-row graph missing the required audit_logs row", async () => {
    const purchaseId = "95000000-0000-4000-8100-000000000121";
    await seedCreditPurchase(purchaseId, 10000, 0);
    // sync_stage_operation_chunk only invokes sync_apply_operation once
    // expected_row_count rows have actually arrived (it's a chunking
    // mechanism, not a strict validator) — under-supplying rows just leaves
    // the operation "staged", waiting for more. To exercise THIS function's
    // own row-shape validation (MU024, not the outer expected_row_count=2
    // CHECK constraint's 23514), send exactly 2 rows that satisfy the count
    // but form an invalid graph: two purchases updates, no audit_logs row.
    const rows = [
      row("95000000-0000-4000-8200-000000000121", "purchases", "update",
        purchasesRow(purchaseId, { total: 10000, voided_at: CREATED_AT, voided_by: OWNER_A, updated_at: UPDATED_AT })),
      row("95000000-0000-4000-8200-000000000122", "purchases", "update",
        purchasesRow(purchaseId, { total: 10000, voided_at: CREATED_AT, voided_by: OWNER_A, updated_at: UPDATED_AT })),
    ];
    await expect(stage(purchaseId, "purchase_void", rows)).rejects.toMatchObject({ code: "MU024" });
  });

  it("is Owner-only", async () => {
    const purchaseId = "95000000-0000-4000-8100-000000000131";
    await seedCreditPurchase(purchaseId, 10000, 0);
    const rows = [
      row("95000000-0000-4000-8200-000000000131", "purchases", "update",
        purchasesRow(purchaseId, { total: 10000, voided_at: CREATED_AT, voided_by: STAFF_A })),
      row("95000000-0000-4000-8200-000000000132", "audit_logs", "insert",
        auditRow("95000000-0000-4000-8100-000000000132", purchaseId, { actor_id: STAFF_A })),
    ];
    await expect(stage(purchaseId, "purchase_void", rows, STAFF_A)).rejects.toMatchObject({ code: "MU015" });
  });
});

describe("old-client rollout safety", () => {
  it("still accepts an ungrouped (un-stamped) purchases row exactly as before this migration", async () => {
    // An old client never stamps an operation kind on purchases/purchase_items
    // — it pushes them one row at a time via the plain sync_apply_row path
    // (push.ts), never through sync_apply_operation/pushGroup.ts at all. This
    // migration must not have changed that path's acceptance in any way.
    const purchaseId = "95000000-0000-4000-8100-000000000141";
    const result = await applyRow(h!, {
      table: "purchases",
      row: purchasesRow(purchaseId, { invoice_no: "PUR-OLD-CLIENT-1", total: 5000 }),
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result.ok).toBe(true);
    expect(await h!.one(
      `select count(*)::int n from purchases where id=$1`, [purchaseId],
    )).toEqual({ n: 1 });
  });
});
