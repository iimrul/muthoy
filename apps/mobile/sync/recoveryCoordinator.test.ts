import { beforeEach, describe, expect, it, vi } from "vitest";
import { protocolSnapshot, syntheticRecoveryCode, webRecoveryCipher } from "../tests/recoveryTestSupport";
import { sealRecoverySnapshot } from "../domain/recoveryArchive";
const mocks=vi.hoisted(()=>({key:vi.fn(),status:vi.fn(),job:vi.fn(),save:vi.fn(),finish:vi.fn(),previous:vi.fn()}));
vi.mock("../db/recoveryCustody",()=>({readOwnerRecoveryKeyForWorker:mocks.key,getOwnerRecoveryStatus:mocks.status,readOwnerRecoveryJob:mocks.job,saveOwnerRecoveryJob:mocks.save,finishOwnerRecoveryJob:mocks.finish}));
vi.mock("../db/recoveryArchive",()=>({getLastRecoveryBackup:mocks.previous}));
const {runOwnerRecoveryBackup}=await import("./recoveryCoordinator");
let seq=10;
function fixture() {
  const snapshot=protocolSnapshot();snapshot.header.deviceId=`79000000-0000-4000-8000-${String(++seq).padStart(12,"0")}`;
  const actor={shopId:snapshot.header.shopId,ownerId:snapshot.header.ownerId,isStillActive:()=>true};
  const io={cipher:webRecoveryCipher,online:vi.fn(async()=>true),archiveId:()=>snapshot.header.archiveId,storage:vi.fn(()=>({putImmutable:vi.fn(),download:vi.fn()})),prepare:vi.fn(async()=>sealRecoverySnapshot(snapshot,syntheticRecoveryCode,webRecoveryCipher)),publish:vi.fn(async()=>undefined)};
  return {snapshot,actor,io,run:()=>runOwnerRecoveryBackup(actor,snapshot.header.deviceId,io)};
}
beforeEach(()=>{vi.resetAllMocks();mocks.key.mockResolvedValue(syntheticRecoveryCode);mocks.status.mockResolvedValue({enabled:true,verifiedAt:null,unprotectedChanges:1});mocks.job.mockResolvedValue(null);mocks.previous.mockResolvedValue(null);});
describe("bounded local backup coordinator",()=>{
  it("does not touch network when disabled",async()=>{const f=fixture();mocks.status.mockResolvedValue({enabled:false});expect(await f.run()).toBe("disabled");expect(mocks.key).not.toHaveBeenCalled();expect(f.io.online).not.toHaveBeenCalled();expect(f.io.storage).not.toHaveBeenCalled();});
  it("has no production runtime and cannot activate Storage by ordinary lifecycle calls",async()=>{const f=fixture();expect(await runOwnerRecoveryBackup(f.actor,f.snapshot.header.deviceId)).toBe("unavailable");expect(f.io.storage).not.toHaveBeenCalled();expect(mocks.key).not.toHaveBeenCalled();});
  it.each([["Complete Owner materialized scope required","incomplete"],["Recovery archive too large","oversize"],["Pending credential changes require authenticated sync","credentials_pending"]])("surfaces %s without uploading",async(message,state)=>{const f=fixture();f.io.prepare.mockRejectedValue(new Error(message));expect(await f.run()).toBe(state);expect(f.io.publish).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();});
  it("never advances an archive when current authority has been withdrawn",async()=>{const f=fixture();mocks.key.mockRejectedValue(new Error("Owner recovery authority changed"));expect(await f.run()).toBe("unavailable");expect(f.io.prepare).not.toHaveBeenCalled();expect(f.io.publish).not.toHaveBeenCalled();});
  it("does not create another object when its persisted receipt covers all journal changes",async()=>{const f=fixture();mocks.status.mockResolvedValue({enabled:true,verifiedAt:"2026-11-11",unprotectedChanges:0});expect(await f.run()).toBe("protected");expect(f.io.prepare).not.toHaveBeenCalled();});
});
