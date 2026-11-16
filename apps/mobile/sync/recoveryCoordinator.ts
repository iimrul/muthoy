import {
  getOwnerRecoveryStatus, readOwnerRecoveryKeyForWorker, readOwnerRecoveryJob,
  saveOwnerRecoveryJob, finishOwnerRecoveryJob,
  type RecoveryOwner, type RecoveryJob,
} from "../db/recoveryCustody";
import { getLastRecoveryBackup } from "../db/recoveryArchive";
import { RECOVERY_SCHEMA_VERSION, openRecoverySnapshot, recoveryHex, recoveryUtf8, type RecoveryCipher, type RecoveryHeader } from "../domain/recoveryArchive";
import type { RecoveryStorage } from "./recoveryStorage";

export type RecoveryRunState = "protected" | "pending" | "disabled" | "offline" | "cancelled" | "incomplete" | "oversize" | "credentials_pending" | "unavailable";
export interface RecoveryRuntime {
  online(): Promise<boolean>;
  cipher: RecoveryCipher;
  storage(): RecoveryStorage;
  archiveId(): string;
  prepare(header: RecoveryHeader, code: string, live: () => boolean, cipher: RecoveryCipher): Promise<string>;
  publish(archive: string, code: string, shop: string, storage: RecoveryStorage, live: () => boolean, cipher: RecoveryCipher): Promise<unknown>;
}
const jobs = new Map<string, Promise<RecoveryRunState>>();
const listeners = new Map<string, Set<() => void>>();
const states = new Map<string, RecoveryRunState>();
export function subscribeToRecoveryStatus(shopId: string, listener: () => void): () => void {
  const set = listeners.get(shopId) ?? new Set(); set.add(listener); listeners.set(shopId,set);
  return () => { set.delete(listener); if (!set.size) listeners.delete(shopId); };
}
export function getRecoveryRunState(shopId: string): RecoveryRunState | null { return states.get(shopId) ?? null; }
function classify(error: unknown): RecoveryRunState {
  const message = error instanceof Error ? error.message : "";
  if (/credential changes/i.test(message)) return "credentials_pending";
  if (/large|64MiB|size limit/i.test(message)) return "oversize";
  if (/complete Owner|materialized scope|hydration/i.test(message)) return "incomplete";
  return "unavailable";
}
/** Local C5 runtime is injected by synthetic tests only. Hosted activation is separately gated. */
export function runOwnerRecoveryBackup(actor: RecoveryOwner, deviceId: string, supplied?: RecoveryRuntime): Promise<RecoveryRunState> {
  const key = actor.shopId + ":" + deviceId;
  const existing = jobs.get(key);
  if (existing) return existing.then(() => actor.isStillActive() ? runOwnerRecoveryBackup(actor, deviceId, supplied) : "cancelled");
  const live = () => { if (!actor.isStillActive()) throw new Error("cancelled"); };
  const promise = (async (): Promise<RecoveryRunState> => {
    try {
      live();
      const status = await getOwnerRecoveryStatus(actor, deviceId); live();
      if (!status.enabled) return "disabled";
      // No default SDK/runtime: ordinary sync never loads the factor or touches Storage.
      if (!supplied) return "unavailable";
      const io = supplied;
      const code = await readOwnerRecoveryKeyForWorker(actor); live();
      if (code === null) return "disabled";
      let job: RecoveryJob | null = await readOwnerRecoveryJob(actor, deviceId); live();
      if (!job && status.verifiedAt && status.unprotectedChanges === 0) return "protected";
      if (!await io.online()) { live(); return "offline"; } live();
      if (!job) {
        const previous = await getLastRecoveryBackup(actor.shopId, actor.ownerId, deviceId); live();
        const header: RecoveryHeader = {version:1,schemaVersion:RECOVERY_SCHEMA_VERSION,shopId:actor.shopId,ownerId:actor.ownerId,deviceId,
          archiveId:io.archiveId(),watermark:0,previousSha256:previous?.archiveSha256 ?? null,createdAt:new Date().toISOString()};
        const archive = await io.prepare(header,code,actor.isStillActive,io.cipher); live();
        await openRecoverySnapshot(archive,code,actor.shopId,io.cipher); live();
        const sha = recoveryHex(await io.cipher.sha256(recoveryUtf8(archive))); live();
        job = await saveOwnerRecoveryJob(actor,deviceId,archive,sha); live();
      }
      const snapshot = await openRecoverySnapshot(job.ciphertext,code,actor.shopId,io.cipher); live();
      const sha = recoveryHex(await io.cipher.sha256(recoveryUtf8(job.ciphertext))); live();
      if (sha !== job.archiveSha256 || snapshot.header.ownerId !== actor.ownerId || snapshot.header.deviceId !== deviceId || snapshot.header.archiveId !== job.archiveId || snapshot.header.watermark !== job.watermark)
        throw new Error("Invalid durable recovery job");
      if (await readOwnerRecoveryKeyForWorker(actor) !== code) throw new Error("Recovery custody changed"); live();
      await io.publish(job.ciphertext,code,actor.shopId,io.storage(),actor.isStillActive,io.cipher); live();
      await finishOwnerRecoveryJob(actor,job); live();
      const current = await getOwnerRecoveryStatus(actor,deviceId); live();
      return current.unprotectedChanges === 0 ? "protected" : "pending";
    } catch (error) { return actor.isStillActive() ? classify(error) : "cancelled"; }
  })().then(state => {
    if (actor.isStillActive()) {
      states.set(actor.shopId,state);
      for (const listener of listeners.get(actor.shopId) ?? []) { try { listener(); } catch { /* Observer cannot alter backup state. */ } }
    }
    return state;
  }).finally(() => { if (jobs.get(key) === promise) jobs.delete(key); });
  jobs.set(key,promise);
  return promise;
}
