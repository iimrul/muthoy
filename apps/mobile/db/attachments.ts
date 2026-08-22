import { and, eq } from 'drizzle-orm';
import { db } from './client';
import { saleAttachments } from './schema';

export interface PendingAttachmentUpload {
  id: string;
  shopId: string;
  saleId: string;
  localUri: string;
  storagePath: string;
  mimeType: string;
}

export function listPendingAttachmentUploads(shopId: string): PendingAttachmentUpload[] {
  return db.select({
    id: saleAttachments.id,
    shopId: saleAttachments.shopId,
    saleId: saleAttachments.saleId,
    localUri: saleAttachments.localUri,
    storagePath: saleAttachments.storagePath,
    mimeType: saleAttachments.mimeType,
  }).from(saleAttachments).where(and(
    eq(saleAttachments.shopId, shopId),
    eq(saleAttachments.uploadStatus, 'pending'),
    eq(saleAttachments.isDeleted, false),
  )).all().flatMap((row) => row.localUri && row.storagePath ? [{ ...row, localUri: row.localUri, storagePath: row.storagePath }] : []);
}

export function markAttachmentUploaded(id: string, shopId: string): void {
  db.update(saleAttachments).set({ uploadStatus: 'uploaded', uploadError: null })
    .where(and(eq(saleAttachments.id, id), eq(saleAttachments.shopId, shopId))).run();
}

export function markAttachmentUploadFailed(id: string, shopId: string, error: string): void {
  db.update(saleAttachments).set({ uploadStatus: 'pending', uploadError: error.slice(0, 500) })
    .where(and(eq(saleAttachments.id, id), eq(saleAttachments.shopId, shopId))).run();
}
