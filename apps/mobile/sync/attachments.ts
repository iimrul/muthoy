import { File } from 'expo-file-system';
import { listPendingAttachmentUploads, markAttachmentUploaded, markAttachmentUploadFailed } from '../db/attachments';
import { supabase } from './supabaseClient';

const PRESCRIPTION_BUCKET = 'prescriptions';

export async function uploadPendingPrescriptionAttachments(
  shopId: string,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  for (const attachment of listPendingAttachmentUploads(shopId)) {
    if (isCancelled()) return;
    try {
      const bytes = await new File(attachment.localUri).arrayBuffer();
      if (isCancelled()) return;
      const { error } = await supabase.storage.from(PRESCRIPTION_BUCKET).upload(
        attachment.storagePath,
        bytes,
        { contentType: attachment.mimeType, upsert: false },
      );
      if (isCancelled()) return;
      if (error && !/already exists|duplicate/i.test(error.message)) throw error;
      markAttachmentUploaded(attachment.id, shopId);
    } catch (error) {
      if (isCancelled()) return;
      markAttachmentUploadFailed(
        attachment.id,
        shopId,
        error instanceof Error ? error.message : 'Attachment upload failed',
      );
    }
  }
}
