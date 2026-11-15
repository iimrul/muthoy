import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBareHarness, createHarness, HOSTED_FUNCTION_EXECUTE_MODEL,
  migrationFiles, migrationSql, OWNER_A, OWNER_B, seedShops,
  SHOP_A, SHOP_B, STAFF_A, T0, type Harness,
} from "./harness";

const PATCH = "backend/supabase/held-migrations/staff-sale-credit-reconciliation.sql";
const id = (n: number) => `f2150000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CUSTOMER=id(1), MED=id(2), BATCH=id(3), SALE=id(4),
  CREDIT=id(6), RECON=id(7);
const NOW="2026-11-15T10:00:00.000Z";
let h: Harness;

async function setup(dev31: boolean) {
  h=dev31 ? await createBareHarness() : await createHarness();
  if (dev31) {
    const files=migrationFiles().filter(n=>n<="20261005000000_h5_revoke_auth_user_sessions.sql");
    expect(files).toHaveLength(31);
    for (const file of files) await h.exec(migrationSql(file));
    await h.exec(HOSTED_FUNCTION_EXECUTE_MODEL);
  }
  await seedShops(h);
  await h.exec(`
    insert into user_permissions(id,shop_id,user_id,key,allowed,created_at,updated_at) values
      ('${id(10)}','${SHOP_A}','${STAFF_A}','sales',true,'${T0}','${T0}'),
      ('${id(11)}','${SHOP_A}','${STAFF_A}','credit_management',false,'${T0}','${T0}');
    insert into customers(id,shop_id,name,created_at,updated_at) values
      ('${CUSTOMER}','${SHOP_A}','Synthetic Staff credit','${T0}','${T0}');
    insert into medicines(id,shop_id,name,created_at,updated_at) values
      ('${MED}','${SHOP_A}','Synthetic Staff medicine','${T0}','${T0}');
    insert into batches(id,shop_id,medicine_id,batch_no,stock,purchase_price,sale_price,created_at,updated_at)
      values('${BATCH}','${SHOP_A}','${MED}','SYNTH-STAFF',0,100,300,'${T0}','${T0}');
    insert into inventory_movements(id,shop_id,batch_id,change_qty,reason,created_by,created_at,updated_at)
      values('${id(12)}','${SHOP_A}','${BATCH}',10,'opening_balance','${OWNER_A}','${T0}','${T0}');
  `);
}

function rows(cash=100) {
  const base={shop_id:SHOP_A,created_at:NOW,updated_at:NOW,is_deleted:false,deleted_at:null,deleted_by:null};
  const row=(tableName:string,n:number,payload:Record<string,unknown>,op="insert")=>({tableName,rowId:id(n),op,payload:{...base,id:id(n),...payload}});
  return [
    row("credit_reconciliation_states",7,{customer_id:CUSTOMER,status:"verified",canonical_hash:null,verified_by:STAFF_A,verified_at:NOW}),
    row("sales",4,{invoice_no:"SYNTH-STAFF-SPLIT",business_date:"2026-11-15",staff_id:STAFF_A,customer_id:CUSTOMER,subtotal:300,total:300,paid:cash,change:0,discount_type:null,discount_value:null,discount_amount:0,payment_type:cash?"split":"credit",cash_applied:cash,credit_amount:300-cash,free_reason:null,tax_rate_bp:0,tax_amount:0,tax_label:null}),
    row("sale_items",5,{sale_id:SALE,medicine_id:MED,batch_id:BATCH,qty:1,unit_price:300,discount_type:null,discount_value:null,discount_amount:0,line_total:300,cogs:100,promotion_bps:0,promotion_amount:0}),
    row("credits",6,{customer_id:CUSTOMER,sale_id:SALE,amount:300-cash,balance:300-cash}),
    row("inventory_movements",8,{batch_id:BATCH,change_qty:-1,reason:"sale",ref_id:SALE,created_by:STAFF_A}),
    ...(cash?[row("cash_drawer",9,{business_date:"2026-11-15",opening_cash:0,opened_by:STAFF_A,opened_at:NOW,closed_by:null,closed_at:null,closing_expected:null,closing_counted:null})]:[]),
  ];
}
type Rows=ReturnType<typeof rows>;
async function stage(values=rows(), actor=STAFF_A, kind="sale") {
  return h.as("service_role",null,()=>h.one<{result:{status:string}}>(
    "select sync_stage_operation_chunk($1,$2,$3,$4,'synthetic-staff', $5,'staff-sale-hash-0001',0,'staff-sale-hash-0001',$6::jsonb) result",
    [SHOP_A,SALE,kind,actor,values.length,JSON.stringify(values)],
  ));
}
async function snapshot() {
  const result:Record<string,unknown>={};
  for(const table of ["sales","sale_items","credits","credit_reconciliation_states","inventory_movements","batches","cash_drawer","sync_operation_staging","sync_operation_chunks"])
    result[table]=await h.all(`select to_jsonb(t.*) row from ${table} t order by 1::text`);
  return result;
}
async function seedReconciliation(status="verified") {
  await h.exec(`insert into credit_reconciliation_states(id,shop_id,customer_id,status,verified_by,verified_at,canonical_hash,created_at,updated_at)
    values('${RECON}','${SHOP_A}','${CUSTOMER}','${status}','${OWNER_A}','${T0}','owner-proof','${T0}','${T0}')`);
  const values=rows();
  values[0]!.op="update";
  Object.assign(values[0]!.payload,{verified_by:OWNER_A,verified_at:T0,canonical_hash:"owner-proof",created_at:T0});
  return values;
}
async function denied(values:Rows,code:string,actor=STAFF_A,kind="sale") {
  const before=await snapshot();
  await expect(stage(values,actor,kind)).rejects.toMatchObject({code});
  expect(await snapshot()).toEqual(before);
}

describe.each([true,false])("Staff split/credit atomic sale — DEV31=%s",dev31=>{
  beforeEach(async()=>{
    await setup(dev31);
    expect(readFileSync(PATCH,"utf8")).toBe(migrationSql("20261115172840_staff_sale_credit_reconciliation.sql"));
    if(dev31) {
      const catalog=`select p.oid,p.proname,p.proowner,p.prosecdef,p.proconfig,p.proacl::text,
        case when p.proname='sync_apply_operation_pre_b3_withdrawal' then null else md5(p.prosrc) end body
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid`;
      const before=await h.all(catalog);
      await h.exec(readFileSync(PATCH,"utf8"));
      expect(await h.all(catalog)).toEqual(before);
    }
  },60_000);
  afterEach(async()=>{await h?.close();});

  it.each([100,0])("uploads cash=%i paisa with sale-linked credit and exactly one stock delta",async cash=>{
    const values=rows(cash);
    expect((await stage(values)).result.status).toBe("applied");
    const before=await snapshot();
    expect((await stage(values)).result.status).toBe("applied");
    expect(await snapshot()).toEqual(before);
    expect(await h.one("select total::int,cash_applied::int,credit_amount::int from sales where id=$1",[SALE]))
      .toEqual({total:300,cash_applied:cash,credit_amount:300-cash});
    expect(await h.one("select sale_id::text,amount::int,balance::int from credits where id=$1",[CREDIT]))
      .toEqual({sale_id:SALE,amount:300-cash,balance:300-cash});
    expect(await h.one("select stock from batches where id=$1",[BATCH])).toEqual({stock:9});
    expect(await h.all("select change_qty from inventory_movements where ref_id=$1",[SALE])).toEqual([{change_qty:-1}]);
  });
  it("retains the existing Owner verifier/hash while accepting Staff metadata refresh",async()=>{
    const values=await seedReconciliation();
    await stage(values);
    expect(await h.one("select verified_by::text,canonical_hash,status from credit_reconciliation_states where id=$1",[RECON]))
      .toEqual({verified_by:OWNER_A,canonical_hash:"owner-proof",status:"verified"});
  });
  it("keeps standalone reconciliation editing denied",async()=>{
    const value=rows()[0]!;
    await expect(h.as("service_role",null,()=>h.one("select sync_apply_row($1,$2,$3::jsonb,$4,$5,'synthetic-staff')",[value.tableName,value.op,JSON.stringify(value.payload),SHOP_A,STAFF_A])))
      .rejects.toMatchObject({code:"MU010"});
    expect(await h.all("select id from credit_reconciliation_states")).toEqual([]);
  });
  it.each(["pending","blocked"])("never clears existing %s state",async status=>{
    await denied(await seedReconciliation(status),"MU024");
  });
  it("rejects forged new verifier",async()=>{const v=rows();v[0]!.payload.verified_by=OWNER_A;await denied(v,"MU011");});
  it("rejects changing an existing verifier/hash",async()=>{const v=await seedReconciliation();v[0]!.payload.canonical_hash="forged";await denied(v,"MU024");});
  it("rejects a foreign-shop reconciliation customer",async()=>{
    const v=rows();await h.exec(`insert into customers(id,shop_id,name) values('${id(20)}','${SHOP_B}','Foreign')`);
    v[0]!.payload.customer_id=id(20);await denied(v,"MU024");
  });
  it("rejects metadata tombstones",async()=>{const v=rows();v[0]!.payload.is_deleted=true;await denied(v,"MU024");});
  it("rejects a forged operation actor",async()=>{await denied(rows(),"MU010",OWNER_B);});
  it("rolls back metadata when a later credit row fails its customer FK gate",async()=>{
    await h.exec(`insert into customers(id,shop_id,name) values('${id(20)}','${SHOP_B}','Foreign')`);
    const v=rows();v[3]!.payload.customer_id=id(20);
    await denied(v,"MU003");
  });
  it.each([SHOP_B,null,undefined])("rejects reconciliation shop=%s",async shop=>{
    const v=rows();v[0]!.payload.shop_id=shop;await denied(v,shop===SHOP_B?"MU003":"MU024");
  });
  it("rejects changing the existing verification timestamp",async()=>{
    const v=await seedReconciliation();v[0]!.payload.verified_at=NOW;await denied(v,"MU024");
  });
  it("never marks unverified historical credit clean",async()=>{
    await h.exec(`insert into credits(id,shop_id,customer_id,amount,balance) values('${id(21)}','${SHOP_A}','${CUSTOMER}',100,100)`);
    await denied(rows(),"MU024");
  });
  it("refuses a second application without replacing the accepted function",async()=>{
    const before=await h.one("select md5(prosrc) hash,proacl::text acl from pg_proc where oid='public.sync_apply_operation_pre_b3_withdrawal(uuid,uuid,text,uuid,text,jsonb)'::regprocedure");
    await expect(h.exec(readFileSync(PATCH,"utf8"))).rejects.toThrow("Staff sale patch: unexpected original function");
    await h.exec("rollback");
    expect(await h.one("select md5(prosrc) hash,proacl::text acl from pg_proc where oid='public.sync_apply_operation_pre_b3_withdrawal(uuid,uuid,text,uuid,text,jsonb)'::regprocedure")).toEqual(before);
  });
  it("requires a complete sale graph",async()=>{await denied(rows().filter(v=>v.tableName!=="credits"),"MU024");});
  it("cannot use a non-sale kind to carry the exception",async()=>{await denied([rows()[0]!],"MU004",STAFF_A,"draft_hold");});
  it("refuses unknown original function bodies before patching",async()=>{
    await h.exec("create or replace function public.sync_apply_operation_pre_b3_withdrawal(p_shop_id uuid,p_operation_id uuid,p_operation_kind text,p_actor_id uuid,p_device_id text,p_rows jsonb) returns text language sql security definer set search_path=public as 'select ''changed''::text'");
    await expect(h.exec(readFileSync(PATCH,"utf8"))).rejects.toThrow("Staff sale patch: unexpected original function");
    await h.exec("rollback");
  });
});
