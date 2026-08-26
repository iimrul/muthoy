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

const SUPPLIER = "98000000-0000-4000-8000-000000000001";
const DRAFT_MEDICINE_A = "98000000-0000-4000-8000-000000000002";
const DRAFT_MEDICINE_B = "98000000-0000-4000-8000-000000000003";
const CREATED_AT = "2026-08-25T04:00:00.000Z";
const UPDATED_AT = "2026-08-25T04:01:00.000Z";

let h: Harness | null = null;

beforeEach(async () => {
  h = await createHarness();
  await seedShops(h);
  await h.exec(`
    insert into suppliers(id,shop_id,name,created_at,updated_at)
    values('${SUPPLIER}','${SHOP_A}','Inventory Add Supplier','${T0}','${T0}');
    insert into medicines(
      id,shop_id,name,unit_of_measure,requires_prescription,threshold,created_at,updated_at
    ) values
      ('${DRAFT_MEDICINE_A}','${SHOP_A}','Cancelled Draft Medicine','piece',false,10,'${T0}','${T0}'),
      ('${DRAFT_MEDICINE_B}','1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b','Other Shop Medicine','piece',false,10,'${T0}','${T0}');
  `);
}, 60_000);

afterEach(async () => {
  await h?.close();
  h = null;
});

function row(
  queueId: string,
  tableName: string,
  op: "insert" | "update",
  payload: Record<string, unknown>,
) {
  return { queueId, tableName, rowId: payload.id, op, payload };
}

function graph(kind: "credit" | "cod" = "credit") {
  const medicineId = "98000000-0000-4000-8100-000000000001";
  const purchaseId = "98000000-0000-4000-8100-000000000002";
  const batchId = "98000000-0000-4000-8100-000000000003";
  const itemId = "98000000-0000-4000-8100-000000000004";
  const movementId = "98000000-0000-4000-8100-000000000005";
  const base = { shop_id: SHOP_A, is_deleted: false, deleted_at: null, deleted_by: null };
  const rows = [
    row("98000000-0000-4000-8200-000000000001", "medicines", "insert", {
      ...base, id: medicineId, name: "Granted New Medicine", generic: null,
      manufacturer: null, type: null, strength: null, category: null,
      unit_of_measure: "piece", requires_prescription: true, barcode: null,
      threshold: 10, low_stock_threshold_override: null,
      created_at: CREATED_AT, updated_at: CREATED_AT,
    }),
    row("98000000-0000-4000-8200-000000000002", "purchases", "insert", {
      ...base, id: purchaseId, invoice_no: `PUR-IAP-${kind}`, supplier_id: SUPPLIER,
      total: 20000, payment_terms: kind, paid_amount: kind === "cod" ? 20000 : 0,
      invoice_date: null, source: "manual", voided_at: null, voided_by: null,
      created_at: CREATED_AT, updated_at: CREATED_AT,
    }),
    row("98000000-0000-4000-8200-000000000003", "batches", "insert", {
      ...base, id: batchId, medicine_id: medicineId, batch_no: "IAP-1",
      expiry_date: "2028-01-01", stock: 0, purchase_price: 10000,
      sale_price: 15000, is_discounted: false, original_price: null,
      oversold_at: null, created_at: CREATED_AT, updated_at: CREATED_AT,
    }),
    row("98000000-0000-4000-8200-000000000004", "purchase_items", "insert", {
      ...base, id: itemId, purchase_id: purchaseId, medicine_id: medicineId,
      batch_no: "IAP-1", expiry_date: "2028-01-01", qty: 2,
      purchase_price: 10000, sale_price: 15000, status: "received",
      received_at: CREATED_AT, created_at: CREATED_AT, updated_at: CREATED_AT,
    }),
    row("98000000-0000-4000-8200-000000000005", "inventory_movements", "insert", {
      ...base, id: movementId, batch_id: batchId, change_qty: 2,
      reason: "purchase", ref_id: purchaseId, created_by: STAFF_A,
      created_at: CREATED_AT, updated_at: CREATED_AT,
    }),
  ];
  if (kind === "cod") {
    const paymentId = "98000000-0000-4000-8100-000000000006";
    const drawerId = "98000000-0000-4000-8100-000000000007";
    rows.push(
      row("98000000-0000-4000-8200-000000000006", "payments", "insert", {
        ...base, id: paymentId, type: "supplier_payment", party_id: SUPPLIER,
        amount: 20000, method: "cash", ref_id: purchaseId, created_by: STAFF_A,
        created_at: CREATED_AT, updated_at: CREATED_AT,
      }),
      row("98000000-0000-4000-8200-000000000007", "cash_drawer", "insert", {
        ...base, id: drawerId, business_date: "2026-08-25", opening_cash: 0,
        opened_by: STAFF_A, opened_at: CREATED_AT, closed_by: null, closed_at: null,
        closing_expected: null, closing_counted: null, reconciled_counted_amount: null,
        reconciled_at: null, reconciled_by: null, created_at: CREATED_AT, updated_at: CREATED_AT,
      }),
      row("98000000-0000-4000-8200-000000000008", "cash_drawer", "update", {
        ...base, id: drawerId, business_date: "2026-08-25", opening_cash: 0,
        opened_by: STAFF_A, opened_at: CREATED_AT, closed_by: null, closed_at: null,
        closing_expected: -20000, closing_counted: null, reconciled_counted_amount: null,
        reconciled_at: null, reconciled_by: null, created_at: CREATED_AT, updated_at: UPDATED_AT,
      }),
    );
  }
  return { medicineId, purchaseId, rows };
}

async function grantInventoryAdd() {
  await h!.exec(`insert into user_permissions(
    id,shop_id,user_id,key,allowed,created_at,updated_at
  ) values(
    '98000000-0000-4000-8300-000000000001','${SHOP_A}','${STAFF_A}',
    'inventory_add',true,'${T0}','${T0}'
  )`);
}

async function stage(kind: string, operationId: string, rows: unknown[], actor = STAFF_A) {
  return h!.one<{ result: { status: string } }>(
    `select sync_stage_operation_chunk(
       $1,$2,$3,$4,'device-iap',$5,'iap-payload-hash-0001',
       0,'iap-chunk-hash-0001',$6::jsonb
     ) result`,
    [SHOP_A, operationId, kind, actor, rows.length, JSON.stringify(rows)],
  );
}

describe("inventory_add_purchase", () => {
  it("applies exactly one new medicine and its one-line credit purchase for granted staff", async () => {
    await grantInventoryAdd();
    const { medicineId, purchaseId, rows } = graph();
    expect((await stage("inventory_add_purchase", purchaseId, rows)).result.status).toBe("applied");
    expect(await h!.one(
      `select
        (select count(*)::int from medicines where id=$1) medicines,
        (select count(*)::int from purchases where id=$2) purchases,
        (select count(*)::int from purchase_items where purchase_id=$2) items,
        (select count(*)::int from batches where medicine_id=$1) batches,
        (select count(*)::int from inventory_movements where ref_id=$2) movements`,
      [medicineId, purchaseId],
    )).toEqual({ medicines: 1, purchases: 1, items: 1, batches: 1, movements: 1 });
  });

  it("applies the exact COD graph for granted staff without purchase_create", async () => {
    await grantInventoryAdd();
    const { medicineId, purchaseId, rows } = graph("cod");
    expect((await stage("inventory_add_purchase", purchaseId, rows)).result.status).toBe("applied");
    expect(await h!.one(
      `select
        (select count(*)::int from medicines where id=$1) medicines,
        (select count(*)::int from purchases where id=$2) purchases,
        (select count(*)::int from payments where ref_id=$2) payments,
        (select count(*)::int from batches where medicine_id=$1 and stock=2) batches,
        (select count(*)::int from inventory_movements where ref_id=$2 and change_qty=2) movements,
        (select closing_expected::int from cash_drawer where id='98000000-0000-4000-8100-000000000007') closing_expected`,
      [medicineId, purchaseId],
    )).toEqual({
      medicines: 1,
      purchases: 1,
      payments: 1,
      batches: 1,
      movements: 1,
      closing_expected: -20000,
    });
  });

  it("rejects missing inventory_add without leaving a partial medicine", async () => {
    const { medicineId, purchaseId, rows } = graph();
    await expect(stage("inventory_add_purchase", purchaseId, rows)).rejects.toMatchObject({ code: "MU015" });
    expect((await h!.one<{ n: number }>(
      `select count(*)::int n from medicines where id=$1`, [medicineId],
    )).n).toBe(0);
  });

  it.each([
    ["opening cash", 6, "opening_cash", 999999],
    ["closing expected", 7, "closing_expected", 999999],
  ])("rejects COD drawer %s smuggling atomically", async (_label, index, field, value) => {
    await grantInventoryAdd();
    const { medicineId, purchaseId, rows } = graph("cod");
    (rows[index]!.payload as Record<string, unknown>)[field] = value;
    await expect(stage("inventory_add_purchase", purchaseId, rows)).rejects.toMatchObject({ code: "MU024" });
    expect((await h!.one<{ n: number }>(
      `select count(*)::int n from medicines where id=$1`, [medicineId],
    )).n).toBe(0);
  });

  it("does not widen ordinary purchase_create for staff with inventory_add", async () => {
    await grantInventoryAdd();
    const { purchaseId, rows } = graph();
    await expect(stage("purchase_create", purchaseId, rows.slice(1))).rejects.toMatchObject({ code: "MU015" });
  });
});

function cancelledDraftGraph() {
  const draftId = "98000000-0000-4000-8400-000000000001";
  const itemId = "98000000-0000-4000-8400-000000000002";
  const base = {
    shop_id: SHOP_A,
    is_deleted: false,
    deleted_at: null,
    deleted_by: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
  const rows = [
    row("98000000-0000-4000-8500-000000000001", "sale_drafts", "insert", {
      ...base,
      id: draftId,
      status: "cancelled",
      origin_device_id: "device-iap",
      actor_id: STAFF_A,
      customer_id: null,
      completed_sale_id: null,
      checkout_snapshot: JSON.stringify({
        paymentType: "credit",
        discountType: "amount",
        discountText: "5",
        customerId: "customer-local-reference",
        prescriptionNo: "RX-1",
        imageUri: "file:///durable/draft-rx.jpg",
      }),
      prescription_no: "RX-1",
      patient_name: "Patient",
      prescriber_name: "Doctor",
    }),
    row("98000000-0000-4000-8500-000000000002", "sale_draft_items", "insert", {
      ...base,
      id: itemId,
      draft_id: draftId,
      medicine_id: DRAFT_MEDICINE_A,
      qty: 2,
    }),
  ];
  return { draftId, rows };
}

describe("draft_cancel_create", () => {
  it("atomically preserves a staff cancelled-cart header, snapshot, and items", async () => {
    const { draftId, rows } = cancelledDraftGraph();
    expect((await stage("draft_cancel_create", draftId, rows)).result.status).toBe("applied");
    expect(await h!.one(
      `select d.status,d.actor_id,d.origin_device_id,d.checkout_snapshot,
              (select sum(qty)::int from sale_draft_items where draft_id=d.id) qty
         from sale_drafts d where d.id=$1`,
      [draftId],
    )).toMatchObject({
      status: "cancelled",
      actor_id: STAFF_A,
      origin_device_id: "device-iap",
      qty: 2,
    });
  });

  it.each([
    ["another actor", (rows: ReturnType<typeof cancelledDraftGraph>["rows"]) => {
      rows[0]!.payload.actor_id = OWNER_A;
    }],
    ["another device", (rows: ReturnType<typeof cancelledDraftGraph>["rows"]) => {
      rows[0]!.payload.origin_device_id = "device-other";
    }],
    ["a non-cancelled status", (rows: ReturnType<typeof cancelledDraftGraph>["rows"]) => {
      rows[0]!.payload.status = "held";
    }],
    ["a cross-shop medicine", (rows: ReturnType<typeof cancelledDraftGraph>["rows"]) => {
      rows[1]!.payload.medicine_id = DRAFT_MEDICINE_B;
    }],
  ])("rejects %s without leaving a partial draft", async (_label, mutate) => {
    const { draftId, rows } = cancelledDraftGraph();
    mutate(rows);
    await expect(stage("draft_cancel_create", draftId, rows)).rejects.toMatchObject({ code: "MU024" });
    expect((await h!.one<{ n: number }>(
      `select count(*)::int n from sale_drafts where id=$1`,
      [draftId],
    )).n).toBe(0);
  });

  it("rejects duplicate medicines without leaving a partial draft", async () => {
    const { draftId, rows } = cancelledDraftGraph();
    rows.push(row(
      "98000000-0000-4000-8500-000000000003",
      "sale_draft_items",
      "insert",
      { ...rows[1]!.payload, id: "98000000-0000-4000-8400-000000000003" },
    ));
    await expect(stage("draft_cancel_create", draftId, rows)).rejects.toMatchObject({ code: "MU024" });
    expect((await h!.one<{ n: number }>(
      `select count(*)::int n from sale_drafts where id=$1`,
      [draftId],
    )).n).toBe(0);
  });
});
