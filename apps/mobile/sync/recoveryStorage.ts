import {
  supabase,
  supabaseUrl,
  ensureCloudStartupAllowed,
} from "./supabaseClient";
import {
  recoveryUtf8,
  validateRecoveryHeader,
  type RecoveryHeader,
} from "../domain/recoveryArchive";
import { DEV_PROJECT_REF } from "../config/environmentPolicy";

export const DEV_RECOVERY_BUCKET = "muthoy-recovery-dev";
/** Derived from the environment policy, so a DEV project change cannot drift here. */
const DEV_RECOVERY_ORIGIN = `https://${DEV_PROJECT_REF}.supabase.co`;
export interface RecoveryStorage {
  putImmutable(path: string, archive: string): Promise<void>;
  download(path: string): Promise<string>;
}
export function recoveryObjectPath(
  header: RecoveryHeader,
  sha256: string,
): string {
  validateRecoveryHeader(header);
  if (!/^[a-f0-9]{64}$/.test(sha256))
    throw new Error("Invalid recovery object digest");
  return `${header.shopId}/${header.deviceId}/${header.archiveId}.${sha256}.mr1`;
}
/** Explicit DEV-only adapter. No automatic startup, bucket creation or deletion. */
export function createDevRecoveryStorage(): RecoveryStorage {
  const url = new URL(supabaseUrl);
  if (
    url.origin !== DEV_RECOVERY_ORIGIN ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Recovery storage requires the approved DEV project");
  const bucket = supabase.storage.from(DEV_RECOVERY_BUCKET);
  function checkPath(path: string) {
    if (
      !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.[a-f0-9]{64}\.mr1$/i.test(
        path,
      )
    )
      throw new Error("Invalid recovery storage path");
  }
  return {
    async putImmutable(path, archive) {
      checkPath(path);
      await ensureCloudStartupAllowed();
      const bytes = recoveryUtf8(archive);
      const { error } = await bucket.upload(path, bytes.buffer as ArrayBuffer, {
        contentType: "application/octet-stream",
        upsert: false,
        cacheControl: "0",
      });
      // Duplicate is a retry candidate, not proof of success. The caller MUST
      // download and authenticate the exact bytes before recording protection.
      if (
        error &&
        String(error.statusCode) !== "409" &&
        !/already exists|duplicate/i.test(error.message)
      )
        throw new Error("Recovery upload refused");
    },
    async download(path) {
      checkPath(path);
      await ensureCloudStartupAllowed();
      const { data, error } = await bucket.download(path);
      if (error || !data)
        throw new Error("Independent recovery copy unavailable");
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.byteLength > 64 * 1024 * 1024)
        throw new Error("Independent recovery copy too large");
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    },
  };
}
