import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Caller } from "../functions/sync/_shared/auth.ts";
import { claimsFor, createHarness, seedShops, SHOP_A, SHOP_B, OWNER_A, OWNER_B, STAFF_A, T0, type Harness } from "./harness";
import { restDouble } from "./restDouble";

// Only the transport boundary is replaced. Real push, assertCallerCurrent,
// sync_row_permitted, sync_apply_row and active migrations execute unchanged.
const transport = vi.hoisted(() => ({ client: {} as Record<string | symbol, unknown> }));
vi.mock("../functions/sync/_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: new Proxy({}, { get: (_target, key) => transport.client[key] }),
}));
const { push } = await import("../functions/sync/push.ts");
let h: Harness;
const MED = "f0100000-0000-4000-8000-000000000001";
const FOREIGN_MED = "f0100000-0000-4000-8000-000000000002";
const BATCH = "f0100000-0000-4000-8000-000000000003";
const MOVEMENT = "f0100000-0000-4000-8000-000000000004";
const GRANT = "f0100000-0000-4000-8000-000000000005";
const NOW = "2026-11-10T12:00:00.000Z";

beforeEach(async () => {
  h = await createHarness(); await seedShops(h);
  await h.exec(`
    insert into medicines(id,shop_id,name,created_at,updated_at) values
    ('${MED}','${SHOP_A}','Synthetic receipt-less','${T0}','${T0}'),
    ('${FOREIGN_MED}','${SHOP_B}','Synthetic other shop','${T0}','${T0}');
    insert into auth_bindings(app_user_id,auth_user_id) values
    ('${OWNER_A}','${OWNER_A}'),('${OWNER_B}','${OWNER_B}'),('${STAFF_A}','${STAFF_A}');
  `);
  const rest = restDouble(h);
  transport.client = {
    rpc: rest.rpc,
    from(table: string) {
      if (table !== "users") return rest.from(table);
      // PostgREST relation projection only; all authority remains in real SQL.
      let id: unknown;
      return {
        select(columns: string) {
          expect(columns).toBe("id, shop_id, permission_version, is_active, is_deleted, plan_suspended_at, roles!inner(name), shops!users_shop_id_fkey!inner(billing_account_id, commercial_status, archived_at, is_deleted)");
          return this;
        },
        eq(column: string, value: unknown) { expect(column).toBe("id"); id = value; return this; },
        async maybeSingle() {
          const data = await h.as("service_role", null, () => h.one(`
            select u.id,u.shop_id,u.permission_version,u.is_active,u.is_deleted,u.plan_suspended_at,
              json_build_object('name',r.name) roles,
              json_build_object('billing_account_id',s.billing_account_id,'commercial_status',s.commercial_status,'archived_at',s.archived_at,'is_deleted',s.is_deleted) shops
            from users u join roles r on r.id=u.role_id join shops s on s.id=u.shop_id where u.id=$1`, [id]));
          return { data: data ?? null, error: null };
        },
      };
    },
  };
}, 60_000);
afterEach(async () => { await h?.close(); });

async function caller(id: string): Promise<Caller> {
  const claims = (await claimsFor(h, id)).app_metadata as { shop_id: string; role: string; permission_version: number };
  return { authUserId:id,appUserId:id,principalUserId:id,billingAccountId:null,
    shopId:claims.shop_id,role:claims.role,permissionVersion:claims.permission_version,
    authSessionId:null,freshPhoneOtp:null,isAnonymous:false,email:null,emailConfirmedAt:null,
    raw:{ id } as Caller["raw"] };
}
async function grant(allowed = true) {
  await h.one(`insert into user_permissions(id,shop_id,user_id,key,allowed,created_at,updated_at)
    values($1,$2,$3,'inventory_write',$4,now(),now())
    on conflict(id) do update set allowed=excluded.allowed,updated_at=excluded.updated_at`, [GRANT,SHOP_A,STAFF_A,allowed]);
}
function rows(actor = OWNER_A, medicine = MED) {
  const base = { shop_id:SHOP_A,created_at:NOW,updated_at:NOW,is_deleted:false };
  return [
    { queueId:BATCH,tableName:"batches",rowId:BATCH,op:"insert",payload:{...base,id:BATCH,medicine_id:medicine,batch_no:"SYNTH-F01",expiry_date:null,stock:0,purchase_price:115,sale_price:200,is_discounted:false,original_price:null,oversold_at:null} },
    { queueId:MOVEMENT,tableName:"inventory_movements",rowId:MOVEMENT,op:"insert",payload:{...base,id:MOVEMENT,batch_id:BATCH,change_qty:7,reason:"purchase",ref_id:null,created_by:actor} },
  ];
}
async function ledger() {
  const result: Record<string, unknown> = {};
  for (const table of ["batches","inventory_movements","purchases","purchase_items","payments","cash_drawer"]) result[table]=await h.all(`select * from ${table} order by id`);
  return result;
}
async function submit(actor: string, values = rows(actor), identity?: Caller) {
  return push(identity ?? await caller(actor), {shopId:SHOP_A,deviceId:"synthetic-f01",rows:values});
}
async function assertAccepted(actor: string) {
  const result=await submit(actor);
  expect(result.results.map(row=>row.status)).toEqual(["applied","applied"]);
  expect(await h.one('select medicine_id::text,shop_id::text,stock,purchase_price,sale_price from batches where id=$1',[BATCH]))
    .toEqual({medicine_id:MED,shop_id:SHOP_A,stock:7,purchase_price:115,sale_price:200});
  expect(await h.all('select batch_id::text,shop_id::text,change_qty,reason,ref_id,created_by::text from inventory_movements where batch_id=$1',[BATCH]))
    .toEqual([{batch_id:BATCH,shop_id:SHOP_A,change_qty:7,reason:"purchase",ref_id:null,created_by:actor}]);
  for (const table of ["purchases","purchase_items","payments","cash_drawer"]) expect(await h.all(`select id from ${table}`)).toEqual([]);
}

describe("receipt-less ungrouped push: actual server contract",()=>{
  it("accepts Free Owner without premium invoice/cash effects",async()=>{
    await h.exec(`update entitlement_snapshots set status='expired',trial_ends_at=now()-interval '1 day',paid_through=null,grace_ends_at=null where billing_account_id=(select billing_account_id from shops where id='${SHOP_A}')`);
    expect(await h.one('select b4_user_has_premium($1) premium',[OWNER_A])).toEqual({premium:false});
    await assertAccepted(OWNER_A);
  });
  it("accepts Staff with inventory_write and identical replay has no second stock increment",async()=>{
    await grant(); await assertAccepted(STAFF_A); const before=await ledger();
    expect((await submit(STAFF_A)).results.map(row=>row.status)).toEqual(["applied","applied"]);
    expect(await ledger()).toEqual(before);
  });
  it.each(["missing","explicit deny","revoked"])("denies Staff permission %s with no writes",async state=>{
    if(state!=="missing") await grant(state!=="explicit deny");
    if(state==="revoked") await grant(false);
    const before=await ledger(); const result=await submit(STAFF_A);
    expect(result.results).toHaveLength(2);
    expect(result.results.every(row=>row.status==="rejected")).toBe(true);
    expect(await ledger()).toEqual(before);
  });
  it.each(["is_active=false","is_deleted=true"])("denies stale Staff after %s before any row",async update=>{
    await grant(); const identity=await caller(STAFF_A);
    await h.exec(`update users set ${update} where id='${STAFF_A}'`);const before=await ledger();
    await expect(submit(STAFF_A,rows(STAFF_A),identity)).rejects.toMatchObject({status:403});
    expect(await ledger()).toEqual(before);
  });
  it("denies a revoked permission version carried by an existing session",async()=>{
    await grant();const identity=await caller(STAFF_A);await grant(false);const before=await ledger();
    await expect(submit(STAFF_A,rows(STAFF_A),identity)).rejects.toMatchObject({status:401,code:"permissions_changed"});
    expect(await ledger()).toEqual(before);
  });
  it("denies a foreign-shop actor",async()=>{
    const before=await ledger();await expect(submit(OWNER_B)).rejects.toMatchObject({status:403});expect(await ledger()).toEqual(before);
  });
  it("denies another shop's medicine and leaves both ledgers unchanged",async()=>{
    await grant();const before=await ledger();const result=await submit(STAFF_A,rows(STAFF_A,FOREIGN_MED));
    expect(result.results[0]?.status).toBe("rejected");expect(await ledger()).toEqual(before);
  });
  it("keeps an equal-timestamp replay a no-op and denies a later immutable movement rewrite",async()=>{
    await grant();await assertAccepted(STAFF_A);const before=await ledger();const changed=rows(STAFF_A);changed[1]!.payload.change_qty=8;
    // Existing sync_apply_row accepts equal-timestamp upsert retries as no-ops.
    // An applied response does not authorize changing the existing movement.
    const sameTimestamp=await submit(STAFF_A,changed);
    expect(await ledger()).toEqual(before);
    expect(sameTimestamp.results[1]?.status).toBe("applied");
    changed[1]!.payload.updated_at="2026-11-10T12:00:01.000Z";
    const later=await submit(STAFF_A,changed);
    expect(await ledger()).toEqual(before);
    expect(later.results[1]?.status).toBe("rejected");
  });
  it("denies a movement naming another shop's batch without changing any ledger",async()=>{
    await grant();
    const otherBatch="f0100000-0000-4000-8000-000000000006";
    await h.one("insert into batches(id,shop_id,medicine_id,batch_no,stock,purchase_price,sale_price) values($1,$2,$3,'FOREIGN',0,100,200)",[otherBatch,SHOP_B,FOREIGN_MED]);
    const before=await ledger(),movement=rows(STAFF_A)[1]!;movement.payload.batch_id=otherBatch;
    const result=await submit(STAFF_A,[movement]);
    expect(result.results[0]?.status).toBe("rejected");expect(await ledger()).toEqual(before);
  });
});
