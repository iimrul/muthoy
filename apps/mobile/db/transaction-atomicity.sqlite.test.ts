import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { asPaisa } from "@muthoy/types";
import { db } from "./client";
import { sqlite } from "./test/expo-sqlite";
import * as schema from "./schema";
import * as auth from "./auth";
import * as inventory from "./inventory";
import * as staff from "./staff";
import * as settings from "./settings";
import * as suppliers from "./suppliers";
import { cacheShopSummaries, getEffectiveEntitlementForShop } from "./commercial";
import { hashPin } from "../native/crypto";

const now = new Date().toISOString();
const live = () => true;
let number = 0, ownerHash: string, staffHash: string;
function fixture(withStaff = true) {
  const shopId = "atomic-" + (++number), ownerId = shopId + "-owner", staffId = shopId + "-staff";
  db.insert(schema.shops).values({id:shopId,ownerId,name:"Synthetic atomicity",phone:"01700000000",createdAt:now,updatedAt:now}).run();
  for (const name of ["owner","staff","manager"] as const)
    db.insert(schema.roles).values({id:shopId+"-"+name+"-role",shopId,name,isSystem:true,createdAt:now,updatedAt:now}).run();
  db.insert(schema.users).values({id:ownerId,shopId,name:"Owner",pinHash:ownerHash,pinSetAt:now,roleId:shopId+"-owner-role",isActive:true,createdAt:now,updatedAt:now}).run();
  if(withStaff) db.insert(schema.users).values({id:staffId,shopId,name:"Staff",pinHash:staffHash,pinSetAt:now,roleId:shopId+"-staff-role",isActive:true,createdAt:now,updatedAt:now}).run();
  const supplierId=shopId+"-supplier";
  db.insert(schema.suppliers).values({id:supplierId,shopId,name:"Synthetic supplier",createdAt:now,updatedAt:now}).run();
  return {shopId,ownerId,staffId,supplierId};
}
const tables=["shops","shop_b2_settings","roles","users","user_permissions","medicines","batches","inventory_movements","suppliers","audit_logs","sync_queue","shop_summary_cache","entitlement_cache"];
function snapshot() {
  return tables.map(table=>({table,rows:sqlite.prepare("SELECT * FROM "+table+" ORDER BY rowid").all()}));
}
async function failOutbox(operation:()=>Promise<unknown>) {
  const before=snapshot();
  sqlite.exec("CREATE TEMP TRIGGER atomic_outbox_failure BEFORE INSERT ON sync_queue BEGIN SELECT RAISE(ABORT, 'synthetic outbox fault'); END");
  try {
    await expect(operation()).rejects.toThrow("synthetic outbox fault");
    expect(snapshot()).toEqual(before);
  } finally {sqlite.exec("DROP TRIGGER atomic_outbox_failure");}
}
beforeAll(async()=>{
  const journal=JSON.parse(readFileSync("apps/mobile/db/migrations/meta/_journal.json","utf8")) as {entries:{tag:string}[]};
  for(const {tag} of journal.entries) sqlite.exec(readFileSync("apps/mobile/db/migrations/"+tag+".sql","utf8"));
  ownerHash=await hashPin("1414");staffHash=await hashPin("2525");
});
describe("synchronous SQLite transaction boundaries",()=>{
  it("rolls back registration instead of leaving a shop without roles/owner/outbox",async()=>{
    await failOutbox(()=>auth.createShopAndOwner({shopName:"Synthetic registration",phone:"01710000001"}));
  });
  it("rolls back a medicine plus first batch when the outbox fails",async()=>{
    const f=fixture();
    await failOutbox(()=>inventory.createMedicineWithBatch({
      shopId:f.shopId,actorUserId:f.ownerId,isStillActive:live,name:"Synthetic medicine",unitOfMeasure:"piece",requiresPrescription:false,
      firstBatch:{batchNo:"A",quantity:3,purchasePrice:asPaisa(100),salePrice:asPaisa(200)},
    }));
  });
  it("rolls back medicine-only creation when the outbox fails",async()=>{
    const f=fixture();await failOutbox(()=>inventory.createMedicineOnly({shopId:f.shopId,actorUserId:f.ownerId,isStillActive:live,name:"Synthetic medicine only"}));
  });
  it("rolls back initial Owner PIN fields when the outbox fails",async()=>{
    const f=fixture();await failOutbox(()=>auth.setOwnerPin(f.ownerId,"3636"));
  });
  it("rolls back the local login audit if its outbox insert fails",async()=>{
    const f=fixture();await failOutbox(()=>auth.recordSuccessfulLogin({shopId:f.shopId,userId:f.ownerId,role:"owner",permissions:{}}));
  });
  it("rolls back the Owner profile and dirty state when the outbox fails",async()=>{
    const f=fixture();await failOutbox(()=>settings.updateShopProfile(f.shopId,f.ownerId,{name:"Changed synthetic profile",shopName:"Changed synthetic shop"},live));
  });
  it("rolls back Owner PIN change plus its audit and outbox",async()=>{
    const f=fixture();await failOutbox(()=>settings.changeOwnPin(f.ownerId,"1414","3636",live));
  });
  it("rolls back staff creation before any permission/audit/outbox can be left",async()=>{
    const f=fixture(false);await failOutbox(()=>staff.createStaff(f.shopId,f.ownerId,{
      name:"Synthetic cashier",phone:"01710000002",rawPin:"3636",permissions:{inventory_edit:true},
    },live));
  });
  it("rolls back staff PIN reset",async()=>{
    const f=fixture();await failOutbox(()=>staff.resetStaffPin(f.staffId,"3636",f.ownerId,live));
  });
  it("rolls back staff deactivation",async()=>{
    const f=fixture();await failOutbox(()=>staff.deactivateStaff(f.staffId,f.ownerId,live));
  });
  it("rolls back staff removal including tombstone fields",async()=>{
    const f=fixture();await failOutbox(()=>staff.removeStaff(f.staffId,f.ownerId,live));
  });
  it("rolls back append-only audit creation if enqueue fails",async()=>{
    const f=fixture();await failOutbox(()=>staff.writeAuditLog(f.shopId,f.ownerId,"synthetic_test",null));
  });
  it("rolls back supplier creation",async()=>{
    const f=fixture();await failOutbox(()=>suppliers.createSupplier(f.shopId,f.ownerId,{name:"Another synthetic supplier"},live));
  });
  it("rolls back supplier edits",async()=>{
    const f=fixture();await failOutbox(()=>suppliers.updateSupplier({shopId:f.shopId,actorUserId:f.ownerId,isStillActive:live,supplierId:f.supplierId,fields:{name:"Changed synthetic supplier"}}));
  });
  it("rolls back supplier archive fields",async()=>{
    const f=fixture();await failOutbox(()=>suppliers.archiveSupplier({shopId:f.shopId,actorUserId:f.ownerId,isStillActive:live,supplierId:f.supplierId}));
  });
  it("preserves the previous summary snapshot when replacement insertion fails after deletion",async()=>{
    const f=fixture(),accountId=f.shopId+"-account";
    db.insert(schema.billingAccounts).values({id:accountId,principalOwnerUserId:f.ownerId,primaryShopId:f.shopId,createdAt:now,updatedAt:now}).run();
    const row={shop_id:f.shopId,sales_paisa:1234,outstanding_credit_paisa:200,low_stock_count:1,expiring_count:2,transaction_count:3,average_sale_paisa:411};
    await cacheShopSummaries(accountId,"2026-11-09",now,[row]);const before=snapshot();
    sqlite.exec("CREATE TEMP TRIGGER atomic_summary_failure BEFORE INSERT ON shop_summary_cache BEGIN SELECT RAISE(ABORT, 'synthetic summary fault'); END");
    try {
      await expect(cacheShopSummaries(accountId,"2026-11-09",now,[{...row,sales_paisa:9999}])).rejects.toThrow("synthetic summary fault");
      expect(snapshot()).toEqual(before);
    } finally {sqlite.exec("DROP TRIGGER atomic_summary_failure");}
  });
  it("returns the entitlement and persists its monotonic observation in the synchronous callback",async()=>{
    const f=fixture(),accountId=f.shopId+"-account";
    db.insert(schema.billingAccounts).values({id:accountId,principalOwnerUserId:f.ownerId,primaryShopId:f.shopId,createdAt:now,updatedAt:now}).run();
    db.insert(schema.shopDirectory).values({shopId:f.shopId,billingAccountId:accountId,name:"Synthetic",commercialStatus:"active",createdAt:now,updatedAt:now}).run();
    const earlier="2026-11-09T00:00:00.000Z",later="2026-11-09T01:00:00.000Z";
    db.insert(schema.entitlementCache).values({billingAccountId:accountId,tier:"free",status:"active",verifiedAt:earlier,lastObservedAt:earlier,version:1,updatedAt:earlier}).run();
    expect(await getEffectiveEntitlementForShop(f.shopId,new Date(later))).toMatchObject({effectiveTier:"free"});
    expect(sqlite.prepare("SELECT last_observed_at FROM entitlement_cache WHERE billing_account_id=?").get(accountId)).toEqual({last_observed_at:later});
    await getEffectiveEntitlementForShop(f.shopId,new Date(earlier));
    expect(sqlite.prepare("SELECT last_observed_at FROM entitlement_cache WHERE billing_account_id=?").get(accountId)).toEqual({last_observed_at:later});
  });
});
