import { and, eq } from "drizzle-orm";
import { db, sqliteConnection, getDatabaseEncryptionOutcome } from "./client";
import { requireOwner } from "./auth";
import { assertSessionLive, NotAuthorizedError, StaleSessionError } from "./errors";
import { recoveryOwnerCustody, recoveryBackupJobs, recoveryBackupState } from "./schema";
import { assertOwnerInsideTransaction } from "./recoveryArchive";
import { recoveryCodeBytes, recoveryHex, validateRecoveryHeader, type RecoveryHeader } from "../domain/recoveryArchive";
import type { DbTransaction } from "./sync-helpers";

export interface RecoveryOwner {
  shopId: string;
  ownerId: string;
  isStillActive: () => boolean;
}
export class RecoveryCustodyError extends Error {
  constructor(readonly reason: "confirmation" | "configured" | "encryption" | "disabled" | "pending_job" | "invalid_job" | "receipt_missing" | "unavailable") {
    // Never retain a SQLite exception/cause: it can contain the secret parameter.
    super("Recovery custody " + reason);
    this.name = "RecoveryCustodyError";
  }
}
async function ownerTransaction<T>(actor: RecoveryOwner, action: (tx: DbTransaction) => T): Promise<T> {
  try {
    await requireOwner(actor.shopId, actor.ownerId);
    return db.transaction(tx => {
      assertSessionLive(actor.isStillActive);
      assertOwnerInsideTransaction(actor.shopId, actor.ownerId);
      const cipherVersion = sqliteConnection.getFirstSync<{cipher_version?: string}>("PRAGMA cipher_version")?.cipher_version;
      if (getDatabaseEncryptionOutcome() === null || typeof cipherVersion !== "string" || !cipherVersion.trim()) throw new RecoveryCustodyError("encryption");
      return action(tx);
    });
  } catch (error) {
    if (error instanceof NotAuthorizedError || error instanceof StaleSessionError || error instanceof RecoveryCustodyError) throw error;
    throw new RecoveryCustodyError("unavailable");
  }
}
function keyWhere(actor: RecoveryOwner) {
  return and(eq(recoveryOwnerCustody.shopId, actor.shopId), eq(recoveryOwnerCustody.ownerId, actor.ownerId));
}
/** Stores only in the already-open SQLCipher database. No outbox/journal hook. */
export async function confirmOwnerRecoveryCode(actor: RecoveryOwner, code: string, confirmation: string): Promise<void> {
  let hex: string;
  try {
    hex = recoveryHex(recoveryCodeBytes(code));
    const repeated = recoveryHex(recoveryCodeBytes(confirmation));
    if (hex !== repeated) throw new Error();
  } catch { throw new RecoveryCustodyError("confirmation"); }
  await ownerTransaction(actor, tx => {
    const prior = tx.select().from(recoveryOwnerCustody).where(eq(recoveryOwnerCustody.shopId, actor.shopId)).get();
    if (prior) {
      if (prior.ownerId !== actor.ownerId || prior.codeHex !== hex) throw new RecoveryCustodyError("configured");
      return;
    }
    tx.insert(recoveryOwnerCustody).values({shopId: actor.shopId, ownerId: actor.ownerId, codeHex: hex, confirmedAt: new Date().toISOString()}).run();
  });
}
/** Internal worker boundary. Never put this result into UI/persisted app state. */
export async function readOwnerRecoveryKeyForWorker(actor: RecoveryOwner): Promise<string | null> {
  return ownerTransaction(actor, tx => tx.select().from(recoveryOwnerCustody).where(keyWhere(actor)).get()?.codeHex ?? null);
}
export interface RecoveryJob {
  archiveId: string;
  shopId: string;
  ownerId: string;
  deviceId: string;
  archiveSha256: string;
  watermark: number;
  ciphertext: string;
  preparedAt: string;
}
export async function readOwnerRecoveryJob(actor: RecoveryOwner, deviceId: string): Promise<RecoveryJob | null> {
  return ownerTransaction(actor, tx => tx.select().from(recoveryBackupJobs).where(and(
    eq(recoveryBackupJobs.shopId, actor.shopId), eq(recoveryBackupJobs.ownerId, actor.ownerId), eq(recoveryBackupJobs.deviceId, deviceId),
  )).get() ?? null);
}
export async function saveOwnerRecoveryJob(actor: RecoveryOwner, deviceId: string, ciphertext: string, archiveSha256: string): Promise<RecoveryJob> {
  let header: RecoveryHeader;
  try {
    const envelope: unknown = JSON.parse(ciphertext);
    if (!envelope || typeof envelope !== "object" || !("header" in envelope)) throw new Error();
    header = envelope.header as RecoveryHeader;
    validateRecoveryHeader(header);
    if (header.shopId !== actor.shopId || header.ownerId !== actor.ownerId || header.deviceId !== deviceId || !/^[a-f0-9]{64}$/.test(archiveSha256)) throw new Error();
  } catch { throw new RecoveryCustodyError("invalid_job"); }
  return ownerTransaction(actor, tx => {
    if (!tx.select().from(recoveryOwnerCustody).where(keyWhere(actor)).get()) throw new RecoveryCustodyError("disabled");
    const prior = tx.select().from(recoveryBackupJobs).where(and(eq(recoveryBackupJobs.shopId, actor.shopId), eq(recoveryBackupJobs.deviceId, deviceId))).get();
    if (prior) {
      if (prior.ownerId !== actor.ownerId || prior.archiveSha256 !== archiveSha256 || prior.ciphertext !== ciphertext || prior.archiveId !== header.archiveId) throw new RecoveryCustodyError("pending_job");
      return prior;
    }
    const job: RecoveryJob = {archiveId: header.archiveId, shopId: actor.shopId, ownerId: actor.ownerId, deviceId, archiveSha256, watermark: header.watermark, ciphertext, preparedAt: new Date().toISOString()};
    tx.insert(recoveryBackupJobs).values(job).run();
    return job;
  });
}
/** Delete only this private job, only after the durable verified-copy receipt. */
export async function finishOwnerRecoveryJob(actor: RecoveryOwner, job: RecoveryJob): Promise<void> {
  await ownerTransaction(actor, tx => {
    if (job.shopId !== actor.shopId || job.ownerId !== actor.ownerId) throw new RecoveryCustodyError("invalid_job");
    const receipt = tx.select().from(recoveryBackupState).where(and(eq(recoveryBackupState.shopId, actor.shopId), eq(recoveryBackupState.deviceId, job.deviceId))).get();
    if (!receipt || receipt.archiveId !== job.archiveId || receipt.archiveSha256 !== job.archiveSha256 || receipt.watermark !== job.watermark) throw new RecoveryCustodyError("receipt_missing");
    tx.delete(recoveryBackupJobs).where(and(eq(recoveryBackupJobs.shopId, actor.shopId), eq(recoveryBackupJobs.ownerId, actor.ownerId), eq(recoveryBackupJobs.deviceId, job.deviceId), eq(recoveryBackupJobs.archiveId, job.archiveId), eq(recoveryBackupJobs.archiveSha256, job.archiveSha256))).run();
  });
}
export interface OwnerRecoveryStatus {
  enabled: boolean;
  verifiedAt: string | null;
  protectedWatermark: number | null;
  unprotectedChanges: number;
  pendingJob: boolean;
}
export async function getOwnerRecoveryStatus(actor: RecoveryOwner, deviceId: string): Promise<OwnerRecoveryStatus> {
  return ownerTransaction(actor, tx => {
    const custody = tx.select({confirmedAt: recoveryOwnerCustody.confirmedAt}).from(recoveryOwnerCustody).where(keyWhere(actor)).get();
    const receipt = tx.select().from(recoveryBackupState).where(and(eq(recoveryBackupState.shopId, actor.shopId), eq(recoveryBackupState.deviceId, deviceId))).get();
    const job = tx.select({archiveId: recoveryBackupJobs.archiveId}).from(recoveryBackupJobs).where(and(eq(recoveryBackupJobs.shopId, actor.shopId),eq(recoveryBackupJobs.ownerId, actor.ownerId),eq(recoveryBackupJobs.deviceId, deviceId))).get();
    const count = sqliteConnection.getFirstSync<{count:number}>("select count(*) count from recovery_journal where shop_id=$shop and id>$watermark", {$shop:actor.shopId,$watermark:receipt?.watermark ?? 0})?.count;
    if (count === undefined) throw new RecoveryCustodyError("unavailable");
    return {enabled: !!custody, verifiedAt: receipt?.verifiedAt ?? null, protectedWatermark: receipt?.watermark ?? null, unprotectedChanges: count, pendingJob: !!job};
  });
}
