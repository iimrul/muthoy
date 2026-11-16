import {
  captureRecoverySnapshot,
  getLastRecoveryBackup,
  recordVerifiedRecoveryBackup,
  type VerifiedRecoveryReceipt,
} from "../db/recoveryArchive";
import { getLastPulledAccess } from "./cursorStore";
import { nativeRecoveryCipher } from "../native/recoveryCrypto";
import {
  canonicalRecoveryJson,
  openRecoverySnapshot,
  recoveryHex,
  recoveryUtf8,
  sealRecoverySnapshot,
  type RecoveryCipher,
  type RecoveryHeader,
} from "../domain/recoveryArchive";
import { recoveryObjectPath, type RecoveryStorage } from "./recoveryStorage";

function live(isStillActive: () => boolean): void {
  if (!isStillActive())
    throw new Error("Recovery operation cancelled by session handover");
}
/** Returns encrypted bytes only. Persistent key custody/automatic wiring is gated. */
export async function prepareOwnerRecoveryArchive(
  header: RecoveryHeader,
  code: string,
  isStillActive: () => boolean,
  cipher: RecoveryCipher = nativeRecoveryCipher,
): Promise<string> {
  live(isStillActive);
  const coverage = getLastPulledAccess(header.shopId);
  if (!coverage) throw new Error("Verified complete Owner hydration required");
  const previous = await getLastRecoveryBackup(
    header.shopId,
    header.ownerId,
    header.deviceId,
  );
  if (header.previousSha256 !== (previous?.archiveSha256 ?? null))
    throw new Error("Recovery anchor changed");
  live(isStillActive);
  const snapshot = await captureRecoverySnapshot(
    header,
    coverage,
    isStillActive,
  );
  const archive = await sealRecoverySnapshot(snapshot, code, cipher);
  live(isStillActive);
  return archive;
}
/** Retry with the SAME prepared ciphertext. An upload ACK alone never protects. */
export async function publishPreparedRecoveryArchive(
  archive: string,
  code: string,
  expectedShop: string,
  storage: RecoveryStorage,
  isStillActive: () => boolean,
  cipher: RecoveryCipher = nativeRecoveryCipher,
): Promise<VerifiedRecoveryReceipt> {
  live(isStillActive);
  const snapshot = await openRecoverySnapshot(
    archive,
    code,
    expectedShop,
    cipher,
  );
  const sha = recoveryHex(await cipher.sha256(recoveryUtf8(archive)));
  const path = recoveryObjectPath(snapshot.header, sha);
  live(isStillActive);
  await storage.putImmutable(path, archive);
  live(isStillActive);
  const downloaded = await storage.download(path);
  live(isStillActive);
  if (recoveryHex(await cipher.sha256(recoveryUtf8(downloaded))) !== sha)
    throw new Error("Independent copy digest mismatch");
  const verified = await openRecoverySnapshot(
    downloaded,
    code,
    expectedShop,
    cipher,
  );
  if (canonicalRecoveryJson(verified) !== canonicalRecoveryJson(snapshot))
    throw new Error("Independent copy content mismatch");
  const receipt = {
    header: snapshot.header,
    archiveSha256: sha,
    verifiedAt: new Date().toISOString(),
  };
  live(isStillActive);
  await recordVerifiedRecoveryBackup(receipt, isStillActive);
  return receipt;
}
