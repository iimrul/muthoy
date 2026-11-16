import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sqlite, adapter } from "./test/expo-sqlite";
import { syntheticRecoveryCode, protocolSnapshot, webRecoveryCipher } from "../tests/recoveryTestSupport";
import { recoveryHex, recoveryUtf8, sealRecoverySnapshot } from "../domain/recoveryArchive";
const boundary = vi.hoisted(() => ({ encrypted: true }));
// Only the native SQLCipher verification boundary is mocked. Real SQLite/Drizzle/permissions run.
vi.mock("./test/client",async importOriginal=>({...await importOriginal<object>(),getDatabaseEncryptionOutcome:()=>boundary.encrypted ? "already-encrypted" : null}));
vi.mock("../native/recoveryCrypto",()=>({nativeRecoveryCipher:null}));
const custody = await import("./recoveryCustody");
const { db } = await import("./test/client");
const schema = await import("./schema");
const { captureRecoverySnapshot, recordVerifiedRecoveryBackup } = await import("./recoveryArchive");
const { RECOVERY_BUSINESS_TABLES } = await import("../domain/recoveryArchive");
let seq=0;
beforeAll(()=>{
  const journal=JSON.parse(readFileSync("apps/mobile/db/migrations/meta/_journal.json","utf8")) as {entries:{tag:string}[]};
  for(const {tag} of journal.entries) sqlite.exec(readFileSync("apps/mobile/db/migrations/"+tag+".sql","utf8"));
});
const actualGetFirst = adapter.getFirstSync.bind(adapter);
beforeEach(()=>{
  boundary.encrypted=true;
  vi.spyOn(adapter,"getFirstSync").mockImplementation((query,params)=>query === "PRAGMA cipher_version" && boundary.encrypted
    ? {cipher_version:"synthetic-native-boundary"} as never : actualGetFirst(query,params));
});
function fixture() {
  const n=String(++seq).padStart(4,"0");const id=(slot:number)=>`78000000-${n}-4000-8000-${String(slot).padStart(12,"0")}`;
  const shopId=id(1),ownerId=id(2),staffId=id(3),managerId=id(4),deviceId=id(5);
  db.insert(schema.shops).values({id:shopId,ownerId,name:"Synthetic custody",phone:"01700000000"}).run();
  for(const [user,name] of [[ownerId,"owner"],[staffId,"staff"],[managerId,"manager"]] as const) {
    db.insert(schema.roles).values({id:user,shopId,name}).run();
    db.insert(schema.users).values({id:user,shopId,roleId:user,name:"Synthetic "+name,pinHash:"synthetic",isActive:true}).run();
  }
  sqlite.prepare("insert into cash_drawer(id,shop_id,business_date,opening_cash,opened_by) values(?,?,?,?,?)").run(id(6),shopId,"2026-11-11",11200,ownerId);
  const actor={shopId,ownerId,isStillActive:()=>true};
  const header={...protocolSnapshot().header,shopId,ownerId,deviceId,archiveId:id(7)};
  return {actor,shopId,ownerId,staffId,managerId,deviceId,header};
}
function ledgers() {return ["cash_drawer","payments","inventory_movements","sync_queue","recovery_journal"].map(table=>sqlite.prepare("select * from "+table+" order by id").all());}
async function pending(f:ReturnType<typeof fixture>) {
  const snapshot={...protocolSnapshot(),header:f.header};
  snapshot.tables.shops=[{id:f.shopId,owner_id:f.ownerId}];snapshot.tables.users=[{id:f.ownerId,shop_id:f.shopId}];
  const archive=await sealRecoverySnapshot(snapshot,syntheticRecoveryCode,webRecoveryCipher);
  const sha=recoveryHex(await webRecoveryCipher.sha256(recoveryUtf8(archive)));
  return custody.saveOwnerRecoveryJob(f.actor,f.deviceId,archive,sha);
}
describe("private encrypted Owner custody and durable jobs",()=>{
  it("requires matching confirmation and verified encryption without any ledger write",async()=>{
    const f=fixture(),before=ledgers();
    await expect(custody.confirmOwnerRecoveryCode(f.actor,syntheticRecoveryCode,"b2".repeat(32))).rejects.toMatchObject({reason:"confirmation"});
    boundary.encrypted=false;
    expect(actualGetFirst("PRAGMA cipher_version")).toBeNull();
    await expect(custody.confirmOwnerRecoveryCode(f.actor,syntheticRecoveryCode,syntheticRecoveryCode)).rejects.toMatchObject({reason:"encryption"});
    expect(sqlite.prepare("select * from recovery_owner_custody where shop_id=?").all(f.shopId)).toEqual([]);
    expect(ledgers()).toEqual(before);
  });
  it("confirms idempotently, refuses replacement, never journals/syncs/archives the factor",async()=>{
    const f=fixture(),before=ledgers();
    await custody.confirmOwnerRecoveryCode(f.actor,syntheticRecoveryCode,syntheticRecoveryCode);
    await custody.confirmOwnerRecoveryCode(f.actor,syntheticRecoveryCode,syntheticRecoveryCode);
    await expect(custody.confirmOwnerRecoveryCode(f.actor,"b2".repeat(32),"b2".repeat(32))).rejects.toMatchObject({reason:"configured"});
    expect(await custody.readOwnerRecoveryKeyForWorker(f.actor)).toBe(syntheticRecoveryCode);
    const snapshot=await captureRecoverySnapshot(f.header,{actorUserId:f.ownerId,saleHistoryScope:"all",readableTables:RECOVERY_BUSINESS_TABLES},()=>true);
    expect(JSON.stringify(snapshot)).not.toContain(syntheticRecoveryCode);
    expect(Object.keys(snapshot.tables)).not.toContain("recovery_owner_custody");
    expect(ledgers()).toEqual(before);
  });
  it.each(["staff","manager","foreign","inactive","locked","deleted","stale"])("refuses %s without revealing custody or changing ledgers",async kind=>{
    const f=fixture();await custody.confirmOwnerRecoveryCode(f.actor,syntheticRecoveryCode,syntheticRecoveryCode);
    let actor=f.actor;
    if(kind==="staff" || kind==="manager") actor={...actor,ownerId:kind==="staff"?f.staffId:f.managerId};
    if(kind==="foreign")actor={...actor,shopId:fixture().shopId};
    if(kind==="stale")actor={...actor,isStillActive:()=>false};
    if(kind==="inactive")sqlite.prepare("update users set is_active=0 where id=?").run(f.ownerId);
    if(kind==="locked")sqlite.prepare("update users set access_locked_at='2026-11-11' where id=?").run(f.ownerId);
    if(kind==="deleted")sqlite.prepare("update users set is_deleted=1 where id=?").run(f.ownerId);
    const before=ledgers();
    await expect(custody.readOwnerRecoveryKeyForWorker(actor)).rejects.toThrow();
    await expect(custody.getOwnerRecoveryStatus(actor,f.deviceId)).rejects.toThrow();
    expect(ledgers()).toEqual(before);
  });
  it("preserves exact ciphertext across another repository read, refuses replacement and ACK-only cleanup",async()=>{
    const f=fixture();await custody.confirmOwnerRecoveryCode(f.actor,syntheticRecoveryCode,syntheticRecoveryCode);
    const before=ledgers(),job=await pending(f);
    expect(await custody.readOwnerRecoveryJob(f.actor,f.deviceId)).toEqual(job);
    await expect(custody.saveOwnerRecoveryJob(f.actor,f.deviceId,job.ciphertext+" ",job.archiveSha256)).rejects.toMatchObject({reason:"pending_job"});
    await expect(custody.finishOwnerRecoveryJob(f.actor,job)).rejects.toMatchObject({reason:"receipt_missing"});
    expect(await custody.readOwnerRecoveryJob(f.actor,f.deviceId)).toEqual(job);
    expect(ledgers()).toEqual(before);
    await recordVerifiedRecoveryBackup({header:f.header,archiveSha256:job.archiveSha256,verifiedAt:new Date().toISOString()},()=>true);
    await custody.finishOwnerRecoveryJob(f.actor,job);
    expect(await custody.readOwnerRecoveryJob(f.actor,f.deviceId)).toBeNull();
    expect(await custody.getOwnerRecoveryStatus(f.actor,f.deviceId)).toMatchObject({enabled:true,pendingJob:false,protectedWatermark:0,unprotectedChanges:0});
    expect(ledgers()).toEqual(before);
  });
  it("sanitizes an injected SQLite write failure and preserves business rows",async()=>{
    const f=fixture(),before=ledgers();
    sqlite.exec("create trigger synthetic_custody_failure before insert on recovery_owner_custody begin select raise(abort,'private synthetic failure'); end;");
    try {await expect(custody.confirmOwnerRecoveryCode(f.actor,syntheticRecoveryCode,syntheticRecoveryCode)).rejects.toMatchObject({message:"Recovery custody unavailable"});}
    finally{sqlite.exec("drop trigger synthetic_custody_failure");}
    expect(ledgers()).toEqual(before);
    expect(sqlite.prepare("select * from recovery_owner_custody where shop_id=?").all(f.shopId)).toEqual([]);
  });
});


describe("actual SQLite coordinator and authenticated independent copy",()=>{
  async function integration() {
    const f=fixture(); await custody.confirmOwnerRecoveryCode(f.actor,syntheticRecoveryCode,syntheticRecoveryCode);
    const {runOwnerRecoveryBackup}=await import("../sync/recoveryCoordinator");
    const {publishPreparedRecoveryArchive}=await import("../sync/recoveryBackup");
    const copies=new Map<string,string>();const sent:string[]=[];let refuseReadback=true,offline=false;
    const runtime={cipher:webRecoveryCipher,archiveId:()=>f.header.archiveId,online:async()=>!offline,
      storage:()=>({putImmutable:async(path:string,archive:string)=>{sent.push(archive);if(!copies.has(path))copies.set(path,archive);},download:async(path:string)=>{if(refuseReadback)throw new Error("synthetic offline readback");return copies.get(path)!;}}),
      prepare:async(header:typeof f.header,code:string,live:()=>boolean)=>sealRecoverySnapshot(await captureRecoverySnapshot(header,{actorUserId:f.ownerId,saleHistoryScope:"all",readableTables:RECOVERY_BUSINESS_TABLES},live),code,webRecoveryCipher),
      publish:publishPreparedRecoveryArchive};
    return {f,runtime,runOwnerRecoveryBackup,copies,sent,allowReadback:()=>{refuseReadback=false;},setOffline:()=>{offline=true;}};
  }
  it("retains a durable identical-ciphertext job after ACK without readback, then verifies and cleans it on restart",async()=>{
    const i=await integration(),before=ledgers();
    expect(await i.runOwnerRecoveryBackup(i.f.actor,i.f.deviceId,i.runtime)).toBe("unavailable");
    const job=await custody.readOwnerRecoveryJob(i.f.actor,i.f.deviceId);expect(job).not.toBeNull();
    expect((await custody.getOwnerRecoveryStatus(i.f.actor,i.f.deviceId)).verifiedAt).toBeNull();
    i.allowReadback();expect(await i.runOwnerRecoveryBackup(i.f.actor,i.f.deviceId,i.runtime)).toBe("protected");
    expect(i.sent).toEqual([job!.ciphertext,job!.ciphertext]);expect(i.copies.size).toBe(1);
    expect(await custody.readOwnerRecoveryJob(i.f.actor,i.f.deviceId)).toBeNull();
    expect((await custody.getOwnerRecoveryStatus(i.f.actor,i.f.deviceId)).verifiedAt).not.toBeNull();
    expect(ledgers()).toEqual(before);
  });
  it("refuses a corrupt surviving copy and keeps its durable retry job and unchanged ledgers",async()=>{
    const i=await integration(),before=ledgers();i.allowReadback();
    const storage=i.runtime.storage();i.runtime.storage=()=>({...storage,download:async()=>"corrupt"});
    expect(await i.runOwnerRecoveryBackup(i.f.actor,i.f.deviceId,i.runtime)).toBe("unavailable");
    expect((await custody.getOwnerRecoveryStatus(i.f.actor,i.f.deviceId)).verifiedAt).toBeNull();
    expect(await custody.readOwnerRecoveryJob(i.f.actor,i.f.deviceId)).not.toBeNull();expect(ledgers()).toEqual(before);
  });
  it("offline or inactive hosted runtime makes no upload and does not claim protection",async()=>{
    const i=await integration();i.setOffline();
    expect(await i.runOwnerRecoveryBackup(i.f.actor,i.f.deviceId,i.runtime)).toBe("offline");
    expect(await i.runOwnerRecoveryBackup(i.f.actor,i.f.deviceId)).toBe("unavailable");
    expect(i.sent).toEqual([]);expect((await custody.getOwnerRecoveryStatus(i.f.actor,i.f.deviceId)).verifiedAt).toBeNull();
  });
  it("cancels at a handover before upload without losing its durable encrypted job",async()=>{
    const i=await integration();let active=true;const actor={...i.f.actor,isStillActive:()=>active};
    const prepare=i.runtime.prepare;i.runtime.prepare=async(...args)=>{const archive=await prepare(...args);active=false;return archive;};
    const before=ledgers();expect(await i.runOwnerRecoveryBackup(actor,i.f.deviceId,i.runtime)).toBe("cancelled");
    expect(i.sent).toEqual([]);expect(ledgers()).toEqual(before);
  });
});


describe("recovery boundary negatives",()=>{
  it("rechecks actual Owner authority inside the transaction after the async authorization check",async()=>{
    const f=fixture(),auth=await import("./auth"),original=auth.requireOwner;
    const spy=vi.spyOn(auth,"requireOwner").mockImplementationOnce(async(...args)=>{await original(...args);sqlite.prepare("update users set is_active=0 where id=?").run(f.ownerId);});
    try{await expect(custody.confirmOwnerRecoveryCode(f.actor,syntheticRecoveryCode,syntheticRecoveryCode)).rejects.toMatchObject({reason:"unavailable"});}
    finally{spy.mockRestore();}
    expect(sqlite.prepare("select * from recovery_owner_custody where shop_id=?").all(f.shopId)).toEqual([]);
  });
  it("does not mark a new local journal row covered by an older verified copy",async()=>{
    const f=fixture();await custody.confirmOwnerRecoveryCode(f.actor,syntheticRecoveryCode,syntheticRecoveryCode);const job=await pending(f);
    await recordVerifiedRecoveryBackup({header:f.header,archiveSha256:job.archiveSha256,verifiedAt:new Date().toISOString()},()=>true);
    await custody.finishOwnerRecoveryJob(f.actor,job);
    const medicineId=f.header.archiveId;db.insert(schema.medicines).values({id:medicineId,shopId:f.shopId,name:"Synthetic later change"}).run();
    const {recordChange}=await import("./sync-helpers");db.transaction(tx=>recordChange(tx,{shopId:f.shopId,table:"medicines",rowId:medicineId,op:"insert",payload:{}}));
    expect(await custody.getOwnerRecoveryStatus(f.actor,f.deviceId)).toMatchObject({protectedWatermark:0,unprotectedChanges:1});
    expect(sqlite.prepare("select count(*) n from sync_queue where shop_id=?").get(f.shopId)).toEqual({n:1});
  });
});


describe("Claude C5 confirmed-defect regressions",()=>{
  it("refuses a genuine plain-SQLite connection even when the old outcome flag says encrypted",async()=>{
    const f=fixture();
    vi.spyOn(adapter,"getFirstSync").mockImplementation((query,params)=>actualGetFirst(query,params));
    expect(actualGetFirst("PRAGMA cipher_version")).toBeNull();
    const before=ledgers();
    await expect(custody.confirmOwnerRecoveryCode(f.actor,syntheticRecoveryCode,syntheticRecoveryCode)).rejects.toMatchObject({reason:"encryption"});
    expect(sqlite.prepare("select * from recovery_owner_custody where shop_id=?").all(f.shopId)).toEqual([]);
    expect(ledgers()).toEqual(before);
  });
  it("returns pending for a real journal write committed during independent-copy verification",async()=>{
    const f=fixture();await custody.confirmOwnerRecoveryCode(f.actor,syntheticRecoveryCode,syntheticRecoveryCode);
    const {runOwnerRecoveryBackup}=await import("../sync/recoveryCoordinator");
    const {publishPreparedRecoveryArchive}=await import("../sync/recoveryBackup");
    const {recordChange}=await import("./sync-helpers");
    const copies=new Map<string,string>();const medicineId=f.header.archiveId;
    const runtime={cipher:webRecoveryCipher,online:async()=>true,archiveId:()=>f.header.archiveId,
      storage:()=>({putImmutable:async(path:string,value:string)=>{copies.set(path,value);},download:async(path:string)=>copies.get(path)!}),
      prepare:async(header:typeof f.header,code:string,live:()=>boolean)=>sealRecoverySnapshot(await captureRecoverySnapshot(header,{actorUserId:f.ownerId,saleHistoryScope:"all",readableTables:RECOVERY_BUSINESS_TABLES},live),code,webRecoveryCipher),
      publish:async(...args:Parameters<typeof publishPreparedRecoveryArchive>)=>{
        const receipt=await publishPreparedRecoveryArchive(...args);
        db.insert(schema.medicines).values({id:medicineId,shopId:f.shopId,name:"Synthetic concurrent local write"}).run();
        db.transaction(tx=>recordChange(tx,{shopId:f.shopId,table:"medicines",rowId:medicineId,op:"insert",payload:{}}));
        return receipt;
      }};
    expect(await runOwnerRecoveryBackup(f.actor,f.deviceId,runtime)).toBe("pending");
    expect(await custody.getOwnerRecoveryStatus(f.actor,f.deviceId)).toMatchObject({protectedWatermark:0,unprotectedChanges:1,pendingJob:false});
    expect(sqlite.prepare("select count(*) n from sync_queue where shop_id=?").get(f.shopId)).toEqual({n:1});
    expect(sqlite.prepare("select opening_cash from cash_drawer where shop_id=?").get(f.shopId)).toEqual({opening_cash:11200});
  });
});


describe("non-secret recovery status projection",()=>{
  it("does not select code_hex when the inactive lifecycle or UI reads setup status",async()=>{
    const f=fixture();await custody.confirmOwnerRecoveryCode(f.actor,syntheticRecoveryCode,syntheticRecoveryCode);
    const spy=vi.spyOn(sqlite,"prepare");
    try{
      expect(await custody.getOwnerRecoveryStatus(f.actor,f.deviceId)).toMatchObject({enabled:true});
      const reads=spy.mock.calls.map(([query])=>query).filter(query=>query.includes('recovery_owner_custody'));
      expect(reads).toHaveLength(1);expect(reads[0]).toContain('confirmed_at');expect(reads[0]).not.toContain('code_hex');
    }finally{spy.mockRestore();}
  });
});
