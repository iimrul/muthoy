// Migration 45 (founder decision B2, 2026-11-27): a staff member with the
// explicit inventory_add grant may add ONE row of opening stock without a
// supplier — the same one-row inventory_import graph the Owner sends — and
// nothing wider. Every rejection must leave nothing behind.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness, OWNER_A, seedShops, SHOP_A, STAFF_A, T0 } from "./harness";

const OTHER_SHOP_MEDICINE = "99000000-0000-4000-8000-000000000001";
const EXISTING_MEDICINE = "99000000-0000-4000-8000-000000000002";
const CREATED_AT = "2026-11-27T04:00:00.000Z";

let h: Harness | null = null;

beforeEach(async () => {
  h = await createHarness();
  await seedShops(h);
  await h.exec(`
    insert into medicines(id,shop_id,name,unit_of_measure,requires_prescription,threshold,created_at,updated_at)
    values
      ('${EXISTING_MEDICINE}','${SHOP_A}','Telmepress 20','piece',false,10,'${T0}','${T0}'),
      ('${OTHER_SHOP_MEDICINE}','1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b','Other Shop Medicine','piece',false,10,'${T0}','${T0}');
  `);
}, 60_000);

afterEach(async () => {
  await h?.close();
  h = null;
});

const base = { shop_id: SHOP_A, is_deleted: false, deleted_at: null, deleted_by: null, created_at: CREATED_AT, updated_at: CREATED_AT };

type SyncRow = { queueId: string; tableName: string; rowId: unknown; op: string; payload: Record<string, unknown> };

function row(tableName: string, payload: Record<string, unknown>, op = "insert"): SyncRow {
  return { queueId: `q-${String(payload.id)}`, tableName, rowId: payload.id, op, payload };
}

interface GraphOptions {
  actor?: string;
  existingMedicineId?: string;
  importId?: string;
}

/** Exactly what createOpeningStock (apps/mobile/db/inventoryImport.ts) records. */
function graph(options: GraphOptions = {}) {
  const actor = options.actor ?? STAFF_A;
  const importId = options.importId ?? "99000000-0000-4000-8100-000000000001";
  const medicineId = options.existingMedicineId ?? "99000000-0000-4000-8100-000000000002";
  const batchId = `${importId.slice(0, -2)}a3`;
  const rows: SyncRow[] = [
    row("inventory_imports", {
      ...base, id: importId, file_fingerprint: `opening:${importId}`, row_count: 1,
      status: "committed", created_by: actor,
    }),
    ...(options.existingMedicineId ? [] : [row("medicines", {
      ...base, id: medicineId, name: "Telmepress 20", generic: "Telmisartan",
      manufacturer: null, type: "capsule", strength: "20mg", category: null,
      unit_of_measure: "piece", requires_prescription: false, barcode: null,
      threshold: 10, low_stock_threshold_override: null,
    })]),
    row("batches", {
      ...base, id: batchId, medicine_id: medicineId, batch_no: `OPEN-${importId.slice(-2)}`,
      expiry_date: "2028-01-01", stock: 0, purchase_price: 600, sale_price: 800,
      is_discounted: false, original_price: null, oversold_at: null,
    }),
    row("inventory_movements", {
      ...base, id: `${importId.slice(0, -2)}a4`, batch_id: batchId,
      change_qty: 30, reason: "csv_import", ref_id: importId, created_by: actor,
    }),
    row("audit_logs", {
      ...base, id: `${importId.slice(0, -2)}a5`, actor_id: actor,
      action: "inventory_opening_stock_added", target: importId,
      meta: JSON.stringify({ medicineId, batchId, quantity: 30 }),
    }),
  ];
  return { importId, medicineId, batchId, rows };
}

async function grantInventoryAdd() {
  await h!.exec(`insert into user_permissions(id,shop_id,user_id,key,allowed,created_at,updated_at)
    values('99000000-0000-4000-8300-000000000001','${SHOP_A}','${STAFF_A}','inventory_add',true,'${T0}','${T0}')`);
}

async function stage(operationId: string, rows: unknown[], actor = STAFF_A) {
  return h!.one<{ result: { status: string } }>(
    `select sync_stage_operation_chunk(
       $1,$2,'inventory_import',$3,'device-open',$4,'open-payload-hash-0001',
       0,'open-chunk-hash-0001',$5::jsonb
     ) result`,
    [SHOP_A, operationId, actor, rows.length, JSON.stringify(rows)],
  );
}

async function written(importId: string, batchId: string) {
  return h!.one<{ imports: number; batches: number; stock: number | null; movements: number; audits: number }>(
    `select
       (select count(*)::int from inventory_imports where id=$1) imports,
       (select count(*)::int from batches where id=$2) batches,
       (select stock from batches where id=$2) stock,
       (select count(*)::int from inventory_movements where ref_id=$1) movements,
       (select count(*)::int from audit_logs where target=$1::text) audits`,
    [importId, batchId],
  );
}

const NOTHING = { imports: 0, batches: 0, stock: null, movements: 0, audits: 0 };

describe("staff opening stock (migration 45)", () => {
  it("applies a granted staff member's new medicine with its opening stock", async () => {
    await grantInventoryAdd();
    const { importId, medicineId, batchId, rows } = graph();
    expect((await stage(importId, rows)).result.status).toBe("applied");
    expect(await written(importId, batchId)).toEqual({ imports: 1, batches: 1, stock: 30, movements: 1, audits: 1 });
    expect(await h!.one(
      `select m.type, i.created_by from medicines m, inventory_imports i where m.id=$1 and i.id=$2`,
      [medicineId, importId],
    )).toEqual({ type: "capsule", created_by: STAFF_A });
  });

  it("applies opening stock for an existing medicine of the shop", async () => {
    await grantInventoryAdd();
    const { importId, batchId, rows } = graph({ existingMedicineId: EXISTING_MEDICINE });
    expect(rows).toHaveLength(4);
    expect((await stage(importId, rows)).result.status).toBe("applied");
    expect(await written(importId, batchId)).toMatchObject({ batches: 1, stock: 30 });
  });

  it("still refuses a staff member without inventory_add, and writes nothing", async () => {
    const { importId, batchId, rows } = graph();
    await expect(stage(importId, rows)).rejects.toMatchObject({ code: "MU015" });
    expect(await written(importId, batchId)).toEqual(NOTHING);
  });

  it("leaves the Owner's path exactly as it was", async () => {
    const { importId, batchId, rows } = graph({ actor: OWNER_A });
    expect((await stage(importId, rows, OWNER_A)).result.status).toBe("applied");
    expect(await written(importId, batchId)).toMatchObject({ imports: 1, stock: 30 });
  });

  it("leaves the Owner's multi-row CSV import on the old path", async () => {
    const importId = "99000000-0000-4000-8100-0000000000f1";
    const rows: SyncRow[] = [row("inventory_imports", {
      ...base, id: importId, file_fingerprint: "csv-file-hash-0001", row_count: 2,
      status: "committed", created_by: OWNER_A,
    })];
    for (const n of [1, 2]) {
      const medicineId = `99000000-0000-4000-8100-0000000000f${n + 1}`;
      const batchId = `99000000-0000-4000-8100-0000000000e${n + 1}`;
      rows.push(
        row("medicines", {
          ...base, id: medicineId, name: `CSV Medicine ${n}`, generic: null, manufacturer: null,
          type: "tablet", strength: null, category: null, unit_of_measure: "piece",
          requires_prescription: false, barcode: null, threshold: 10, low_stock_threshold_override: null,
        }),
        row("batches", {
          ...base, id: batchId, medicine_id: medicineId, batch_no: `CSV-${n}`, expiry_date: null,
          stock: 0, purchase_price: 100, sale_price: 150, is_discounted: false, original_price: null, oversold_at: null,
        }),
        row("inventory_movements", {
          ...base, id: `99000000-0000-4000-8100-0000000000d${n + 4}`, batch_id: batchId, change_qty: 5,
          reason: "csv_import", ref_id: importId, created_by: OWNER_A,
        }),
      );
    }
    rows.push(row("audit_logs", {
      ...base, id: "99000000-0000-4000-8100-0000000000c9", actor_id: OWNER_A,
      action: "inventory_csv_imported", target: importId, meta: "{}",
    }));
    expect((await stage(importId, rows, OWNER_A)).result.status).toBe("applied");
    expect((await h!.one<{ n: number }>(
      `select count(*)::int n from inventory_movements where ref_id=$1`, [importId],
    )).n).toBe(2);
  });

  it.each<[string, (rows: SyncRow[]) => void]>([
    ["a CSV file (row_count 2)", (rows) => { rows[0]!.payload.row_count = 2; }],
    ["a CSV fingerprint", (rows) => { rows[0]!.payload.file_fingerprint = "csv-file-hash"; }],
    ["a header attributed to the Owner", (rows) => { rows[0]!.payload.created_by = OWNER_A; }],
    ["a batch that already holds stock", (rows) => { rows[2]!.payload.stock = 5; }],
    ["a movement not bound to the header", (rows) => { rows[3]!.payload.ref_id = "99000000-0000-4000-8100-0000000000ff"; }],
    ["a purchase movement", (rows) => { rows[3]!.payload.reason = "purchase"; }],
    ["a negative movement", (rows) => { rows[3]!.payload.change_qty = -3; }],
    ["another audit action", (rows) => { rows[4]!.payload.action = "inventory_csv_imported"; }],
  ])("refuses %s and writes nothing", async (_label, tamper) => {
    await grantInventoryAdd();
    const { importId, batchId, rows } = graph();
    tamper(rows);
    await expect(stage(importId, rows)).rejects.toMatchObject({ code: "MU024" });
    expect(await written(importId, batchId)).toEqual(NOTHING);
  });

  it("refuses a second batch slipped into the graph", async () => {
    await grantInventoryAdd();
    const { importId, medicineId, rows } = graph();
    const extra = row("batches", {
      ...base, id: "99000000-0000-4000-8100-0000000000e9", medicine_id: medicineId, batch_no: "OPEN-2",
      expiry_date: null, stock: 0, purchase_price: 1, sale_price: 2,
      is_discounted: false, original_price: null, oversold_at: null,
    });
    await expect(stage(importId, [...rows.slice(0, 3), extra, ...rows.slice(3)])).rejects.toMatchObject({ code: "MU024" });
  });

  it("refuses a purchase in the audit slot, and writes no purchase", async () => {
    await grantInventoryAdd();
    const { importId, rows } = graph();
    rows[4] = row("purchases", {
      ...base, id: "99000000-0000-4000-8100-0000000000ea", invoice_no: "PUR-X", supplier_id: null,
      total: 0, payment_terms: "credit", paid_amount: 0, invoice_date: null, source: "manual",
      voided_at: null, voided_by: null,
    });
    await expect(stage(importId, rows)).rejects.toMatchObject({ code: "MU024" });
    expect((await h!.one<{ n: number }>(`select count(*)::int n from purchases`)).n).toBe(0);
  });

  it("refuses stock for another shop's medicine", async () => {
    await grantInventoryAdd();
    const { importId, batchId, rows } = graph({ existingMedicineId: OTHER_SHOP_MEDICINE });
    await expect(stage(importId, rows)).rejects.toMatchObject({ code: "MU003" });
    expect(await written(importId, batchId)).toEqual(NOTHING);
  });

  it("refuses a batch number the medicine already has", async () => {
    await grantInventoryAdd();
    const { importId, rows } = graph({ existingMedicineId: EXISTING_MEDICINE });
    await h!.exec(`insert into batches(id,shop_id,medicine_id,batch_no,expiry_date,stock,purchase_price,sale_price,created_at,updated_at)
      values('99000000-0000-4000-8100-0000000000c1','${SHOP_A}','${EXISTING_MEDICINE}','${String(rows[1]!.payload.batch_no)}',null,0,1,2,'${T0}','${T0}')`);
    await expect(stage(importId, rows)).rejects.toMatchObject({ code: "MU024" });
  });

  it("keeps the commercial gate in the path", async () => {
    await grantInventoryAdd();
    await h!.exec(`update shops set commercial_status='read_only' where id='${SHOP_A}'`);
    const { importId, batchId, rows } = graph();
    await expect(stage(importId, rows)).rejects.toMatchObject({ code: "MU035" });
    expect(await written(importId, batchId)).toEqual(NOTHING);
  });

  it("never lets a staff header in outside its validated operation", async () => {
    await grantInventoryAdd();
    const { rows } = graph();
    await expect(h!.one(
      `select sync_apply_row('inventory_imports','insert',$1::jsonb,$2,$3,'device-open') r`,
      [JSON.stringify(rows[0]!.payload), SHOP_A, STAFF_A],
    )).rejects.toMatchObject({ code: "MU010" });
    // A finished operation leaves nothing armed behind it.
    const done = graph({ importId: "99000000-0000-4000-8100-0000000000d1" });
    expect((await stage(done.importId, done.rows)).result.status).toBe("applied");
    expect((await h!.one<{ v: string }>(
      `select coalesce(current_setting('muthoy.staff_opening_stock', true),'') v`,
    )).v).toBe("");
  });
});
