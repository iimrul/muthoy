import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createHarness, migrationFiles, migrationSql, OWNER_A, seedShops,
  SHOP_A, STAFF_A, T0, type Harness,
} from "./harness";

// M1 (2026-11-16 review). Migration 39 let a Staff sale refresh a verified
// credit_reconciliation_states row with `greatest(updated_at, <device clock>)`
// and insert a new one with the device's updated_at verbatim. A handset whose
// clock reads 2999 then wins every later last-write-wins comparison, and the
// Owner's own downgrade to blocked/pending is silently dropped. Migration 40
// bounds that Staff-supplied clock by server time, and changes nothing else.

const MIGRATION_40 = "20261116020000_staff_reconciliation_server_clock.sql";
const FUNCTION = "public.sync_apply_operation_pre_b3_withdrawal(uuid,uuid,text,uuid,text,jsonb)";
const id = (n: number) => `f2160000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CUSTOMER = id(1), MED = id(2), BATCH = id(3), SALE = id(4), RECON = id(7);
const NOW = "2026-11-15T10:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";
let h: Harness;

type OperationRow = { tableName: string; rowId: string; op: "insert" | "update"; payload: Record<string, unknown> };

function rows(reconUpdatedAt: string | null): OperationRow[] {
  const base = { shop_id: SHOP_A, created_at: NOW, updated_at: NOW, is_deleted: false, deleted_at: null, deleted_by: null };
  const row = (tableName: string, n: number, payload: Record<string, unknown>): OperationRow =>
    ({ tableName, rowId: id(n), op: "insert", payload: { ...base, id: id(n), ...payload } });
  return [
    row("credit_reconciliation_states", 7, {
      customer_id: CUSTOMER, status: "verified", canonical_hash: null,
      verified_by: STAFF_A, verified_at: NOW, updated_at: reconUpdatedAt,
    }),
    row("sales", 4, {
      invoice_no: "SYNTH-CLOCK", business_date: "2026-11-15", staff_id: STAFF_A, customer_id: CUSTOMER,
      subtotal: 300, total: 300, paid: 0, change: 0, discount_type: null, discount_value: null, discount_amount: 0,
      payment_type: "credit", cash_applied: 0, credit_amount: 300, free_reason: null, tax_rate_bp: 0, tax_amount: 0, tax_label: null,
    }),
    row("sale_items", 5, {
      sale_id: SALE, medicine_id: MED, batch_id: BATCH, qty: 1, unit_price: 300, discount_type: null, discount_value: null,
      discount_amount: 0, line_total: 300, cogs: 100, promotion_bps: 0, promotion_amount: 0,
    }),
    row("credits", 6, { customer_id: CUSTOMER, sale_id: SALE, amount: 300, balance: 300 }),
    row("inventory_movements", 8, { batch_id: BATCH, change_qty: -1, reason: "sale", ref_id: SALE, created_by: STAFF_A }),
  ];
}

async function stage(values: OperationRow[]) {
  return h.as("service_role", null, () => h.one<{ result: { status: string } }>(
    "select sync_stage_operation_chunk($1,$2,'sale',$3,'synthetic-clock',$4,'clock-sale-hash-0001',0,'clock-sale-hash-0001',$5::jsonb) result",
    [SHOP_A, SALE, STAFF_A, values.length, JSON.stringify(values)],
  ));
}

async function seedOwnerVerified(): Promise<OperationRow[]> {
  await h.exec(`insert into credit_reconciliation_states(id,shop_id,customer_id,status,verified_by,verified_at,canonical_hash,created_at,updated_at)
    values('${RECON}','${SHOP_A}','${CUSTOMER}','verified','${OWNER_A}','${T0}','owner-proof','${T0}','${T0}')`);
  const values = rows(FUTURE);
  values[0]!.op = "update";
  Object.assign(values[0]!.payload, { verified_by: OWNER_A, verified_at: T0, canonical_hash: "owner-proof", created_at: T0 });
  return values;
}

async function reconClock() {
  return h.one<{ updated_at: string; beyond_server: boolean }>(
    "select updated_at::text, updated_at > now() as beyond_server from credit_reconciliation_states where id=$1",
    [RECON],
  );
}

describe("Staff sale reconciliation is bounded by server time (migration 40)", () => {
  beforeEach(async () => {
    expect(migrationFiles()).toContain(MIGRATION_40);
    h = await createHarness();
    await seedShops(h);
    await h.exec(`
      insert into user_permissions(id,shop_id,user_id,key,allowed,created_at,updated_at) values
        ('${id(10)}','${SHOP_A}','${STAFF_A}','sales',true,'${T0}','${T0}'),
        ('${id(11)}','${SHOP_A}','${STAFF_A}','credit_management',false,'${T0}','${T0}');
      insert into customers(id,shop_id,name,created_at,updated_at) values('${CUSTOMER}','${SHOP_A}','Synthetic clock','${T0}','${T0}');
      insert into medicines(id,shop_id,name,created_at,updated_at) values('${MED}','${SHOP_A}','Synthetic clock medicine','${T0}','${T0}');
      insert into batches(id,shop_id,medicine_id,batch_no,stock,purchase_price,sale_price,created_at,updated_at)
        values('${BATCH}','${SHOP_A}','${MED}','SYNTH-CLOCK',0,100,300,'${T0}','${T0}');
      insert into inventory_movements(id,shop_id,batch_id,change_qty,reason,created_by,created_at,updated_at)
        values('${id(12)}','${SHOP_A}','${BATCH}',10,'opening_balance','${OWNER_A}','${T0}','${T0}');
    `);
  }, 60_000);
  afterEach(async () => { await h?.close(); });

  it("a Staff refresh cannot move a verified row's clock past server time", async () => {
    expect((await stage(await seedOwnerVerified())).result.status).toBe("applied");
    const clock = await reconClock();
    expect(clock.beyond_server).toBe(false);
    expect(clock.updated_at).not.toContain("2999");
  });

  it("a new Staff reconciliation stores server time instead of a future device clock", async () => {
    expect((await stage(rows(FUTURE))).result.status).toBe("applied");
    const clock = await reconClock();
    expect(clock.beyond_server).toBe(false);
    expect(clock.updated_at).not.toContain("2999");
  });

  it("keeps the Owner's later decision effective after a Staff refresh", async () => {
    await stage(await seedOwnerVerified());
    const current = await h.one<{ row: Record<string, unknown> }>(
      "select to_jsonb(r.*) row from credit_reconciliation_states r where id=$1", [RECON],
    );
    const ownerEdit = { ...current.row, status: "blocked", updated_at: new Date(Date.now() + 60_000).toISOString() };
    await h.as("service_role", null, () => h.one(
      "select sync_apply_row('credit_reconciliation_states','update',$1::jsonb,$2,$3,'synthetic-owner') result",
      [JSON.stringify(ownerEdit), SHOP_A, OWNER_A],
    ));
    expect(await h.one("select status from credit_reconciliation_states where id=$1", [RECON])).toEqual({ status: "blocked" });
  });

  it("leaves a past device clock exactly as migration 39 stored it", async () => {
    const values = await seedOwnerVerified();
    values[0]!.payload.updated_at = NOW;
    await stage(values);
    expect(await h.one("select updated_at = $2::timestamptz as same from credit_reconciliation_states where id=$1", [RECON, NOW]))
      .toEqual({ same: true });
  });

  it("leaves the row's clock alone when a refresh carries no timestamp", async () => {
    const values = await seedOwnerVerified();
    values[0]!.payload.updated_at = null;
    await stage(values);
    expect(await h.one("select updated_at = $2::timestamptz as same from credit_reconciliation_states where id=$1", [RECON, T0]))
      .toEqual({ same: true });
  });

  it("is exactly migration 39's dispatcher body plus the two server-time bounds", async () => {
    // Reversing the two replacements must give back 39's body byte for byte,
    // which proves nothing else in the function moved.
    const refreshOld = "set updated_at=greatest(updated_at,(v_payload->>'updated_at')::timestamptz)";
    const refreshNew = "set updated_at=greatest(updated_at,\n            case when v_payload->>'updated_at' is null then null\n                 else least((v_payload->>'updated_at')::timestamptz,now()) end)";
    const insertOld = "select * from jsonb_populate_record(null::public.credit_reconciliation_states,v_payload);";
    const insertNew = "select * from jsonb_populate_record(null::public.credit_reconciliation_states,\n            case when v_payload->>'updated_at' is null then v_payload\n                 else jsonb_set(v_payload,'{updated_at}',\n                   to_jsonb(least((v_payload->>'updated_at')::timestamptz,now()))) end);";
    const source = (await h.one<{ s: string }>(
      `select replace(prosrc,chr(13)||chr(10),chr(10)) s from pg_proc where oid='${FUNCTION}'::regprocedure`,
    )).s;
    expect(source.split(refreshNew)).toHaveLength(2);
    expect(source.split(insertNew)).toHaveLength(2);
    const restored = source.replace(refreshNew, refreshOld).replace(insertNew, insertOld);
    expect(await h.one("select md5($1) hash", [restored])).toEqual({ hash: "d4f8a9bfbeaa410244089594c7757cdc" });
  });

  it("refuses a second application and leaves the catalog untouched", async () => {
    const catalog = `select p.oid::text, p.proname, p.proowner::text, p.prosecdef, p.proconfig::text, p.proacl::text
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid`;
    const before = await h.all(catalog);
    const body = await h.one(`select md5(prosrc) hash from pg_proc where oid='${FUNCTION}'::regprocedure`);
    await expect(h.exec(migrationSql(MIGRATION_40))).rejects.toThrow("Staff reconciliation clock: unexpected original function");
    await h.exec("rollback");
    expect(await h.all(catalog)).toEqual(before);
    expect(await h.one(`select md5(prosrc) hash from pg_proc where oid='${FUNCTION}'::regprocedure`)).toEqual(body);
  });
});
