import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { asPaisa } from "@muthoy/types";
import { sqlite } from "./test/expo-sqlite";
import { db } from "./client";
import { medicines, roles, shops, userPermissions, users } from "./schema";
import { addBatchToMedicine } from "./inventory";

const now = new Date().toISOString();
let sequence = 0;
function fixture() {
  const shopId = "restock-" + (++sequence), ownerId = shopId + "-owner", staffId = shopId + "-staff", medicineId = shopId + "-medicine";
  db.insert(shops).values({id:shopId,ownerId,name:"Synthetic restock",phone:"01700000000",createdAt:now,updatedAt:now}).run();
  for(const [id,name] of [[ownerId,"owner"],[staffId,"staff"]] as const) {
    db.insert(roles).values({id:id+"-role",shopId,name,isSystem:true,createdAt:now,updatedAt:now}).run();
    db.insert(users).values({id,shopId,name,pinHash:"synthetic",pinSetAt:now,roleId:id+"-role",isActive:true,createdAt:now,updatedAt:now}).run();
  }
  db.insert(medicines).values({id:medicineId,shopId,name:"Synthetic medicine",createdAt:now,updatedAt:now}).run();
  return {shopId,ownerId,staffId,medicineId};
}
function input(f: ReturnType<typeof fixture>, batchNo="NEW") {
  return {shopId:f.shopId,actorUserId:f.ownerId,medicineId:f.medicineId,batchNo,quantity:7,purchasePrice:asPaisa(125),salePrice:asPaisa(250),isStillActive:()=>true};
}
function ledgerSnapshot() {
  return ["batches","inventory_movements","purchases","purchase_items","payments","cash_drawer","sync_queue"].map(table=>({table,rows:sqlite.prepare("SELECT * FROM "+table+" ORDER BY id").all()}));
}
beforeAll(()=>{
  const journal=JSON.parse(readFileSync("apps/mobile/db/migrations/meta/_journal.json","utf8")) as {entries:{tag:string}[]};
  for(const {tag} of journal.entries) sqlite.exec(readFileSync("apps/mobile/db/migrations/"+tag+".sql","utf8"));

});
describe("receipt-less restocking through the existing writer",()=>{
  it("adds exactly one batch and +7 movement for a Free owner, without invoice/payment/drawer effects",async()=>{
    const f=fixture(); const before=ledgerSnapshot();
    const {batchId}=await addBatchToMedicine(input(f));
    expect(sqlite.prepare("SELECT medicine_id,shop_id,stock,purchase_price,sale_price FROM batches WHERE id=?").get(batchId)).toEqual({medicine_id:f.medicineId,shop_id:f.shopId,stock:7,purchase_price:125,sale_price:250});
    expect(sqlite.prepare("SELECT batch_id,shop_id,change_qty,reason,created_by,ref_id FROM inventory_movements WHERE batch_id=?").all(batchId)).toEqual([{batch_id:batchId,shop_id:f.shopId,change_qty:7,reason:"purchase",created_by:f.ownerId,ref_id:null}]);
    const after=ledgerSnapshot();
    for(const table of ["purchases","purchase_items","payments","cash_drawer"]) expect(after.find(x=>x.table===table)).toEqual(before.find(x=>x.table===table));
    expect(sqlite.prepare("SELECT table_name FROM sync_queue WHERE shop_id=? ORDER BY seq").all(f.shopId)).toEqual([{table_name:"batches"},{table_name:"inventory_movements"}]);
  });
  it("denies ungranted staff atomically, then accepts the existing inventory_edit grant",async()=>{
    const f=fixture(), values={...input(f),actorUserId:f.staffId}; const before=ledgerSnapshot();
    await expect(addBatchToMedicine(values)).rejects.toMatchObject({name:"NotAuthorizedError"});expect(ledgerSnapshot()).toEqual(before);
    db.insert(userPermissions).values({id:f.staffId+"-edit",shopId:f.shopId,userId:f.staffId,key:"inventory_write",allowed:true,createdAt:now,updatedAt:now}).run();
    await expect(addBatchToMedicine(values)).resolves.toHaveProperty("batchId");
  });
  it("rejects duplicate submission without another movement",async()=>{
    const f=fixture();await addBatchToMedicine(input(f));const before=ledgerSnapshot();
    await expect(addBatchToMedicine(input(f))).rejects.toMatchObject({name:"DuplicateBatchError"});expect(ledgerSnapshot()).toEqual(before);
  });
  it.each([0,-1,1.5])("rejects invalid stock quantity %s atomically",async quantity=>{
    const f=fixture(),before=ledgerSnapshot();await expect(addBatchToMedicine({...input(f),quantity})).rejects.toThrow();expect(ledgerSnapshot()).toEqual(before);
  });
  it("rejects stale sessions atomically",async()=>{
    const f=fixture(),before=ledgerSnapshot();await expect(addBatchToMedicine({...input(f),isStillActive:()=>false})).rejects.toMatchObject({name:"StaleSessionError"});expect(ledgerSnapshot()).toEqual(before);
  });
  it("rejects a medicine owned by another shop atomically",async()=>{
    const a=fixture(),b=fixture(),before=ledgerSnapshot();await expect(addBatchToMedicine({...input(a),medicineId:b.medicineId})).rejects.toThrow();expect(ledgerSnapshot()).toEqual(before);
  });
  it.each(["missing","archived"])("rejects a %s medicine before writing",async state=>{
    const f=fixture();if(state==="archived")sqlite.prepare("UPDATE medicines SET is_deleted=1 WHERE id=?").run(f.medicineId);
    const before=ledgerSnapshot();await expect(addBatchToMedicine({...input(f),medicineId:state==="missing"?"absent":f.medicineId})).rejects.toMatchObject({name:"NotAuthorizedError"});expect(ledgerSnapshot()).toEqual(before);
  });
  it("rolls back the batch/outbox when a movement insert fails",async()=>{
    const f=fixture(),before=ledgerSnapshot();
    sqlite.exec("CREATE TEMP TRIGGER restock_test_failure BEFORE INSERT ON inventory_movements BEGIN SELECT RAISE(ABORT, 'synthetic movement failure'); END");
    try { await expect(addBatchToMedicine(input(f))).rejects.toThrow("synthetic movement failure"); expect(ledgerSnapshot()).toEqual(before); }
    finally {sqlite.exec("DROP TRIGGER restock_test_failure");}
  });
  it("rolls back when the session expires after the movement",async()=>{
    const f=fixture(),before=ledgerSnapshot();let checks=0;
    await expect(addBatchToMedicine({...input(f),isStillActive:()=>++checks===1})).rejects.toMatchObject({name:"StaleSessionError"});expect(checks).toBe(2);expect(ledgerSnapshot()).toEqual(before);
  });
});


describe("receipt-less Staff grant revocation and deactivation", () => {
  it.each(["inactive", "deleted", "revoked"])("denies %s Staff atomically", async state => {
    const f=fixture();
    db.insert(userPermissions).values({id:f.staffId+"-edit",shopId:f.shopId,userId:f.staffId,key:"inventory_write",allowed:true,createdAt:now,updatedAt:now}).run();
    if(state==="revoked") sqlite.prepare("UPDATE user_permissions SET allowed=0 WHERE user_id=?").run(f.staffId);
    else sqlite.prepare("UPDATE users SET "+(state==="inactive"?"is_active=0":"is_deleted=1")+" WHERE id=?").run(f.staffId);
    const before=ledgerSnapshot();
    await expect(addBatchToMedicine({...input(f),actorUserId:f.staffId})).rejects.toMatchObject({name:"NotAuthorizedError"});
    expect(ledgerSnapshot()).toEqual(before);
  });
});
