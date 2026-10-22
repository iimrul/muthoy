import { Directory, File, Paths } from 'expo-file-system';

export interface PreparedPrescriptionAttachment {
  localUri: string;
  storagePath: string;
  mimeType: string;
}

export async function preparePrescriptionAttachment(
  temporaryUri: string,
  shopId: string,
  saleId: string,
  attachmentId: string,
): Promise<PreparedPrescriptionAttachment> {
  const directory = new Directory(Paths.document, 'prescriptions', shopId, saleId);
  directory.create({ intermediates: true, idempotent: true });
  const source = new File(temporaryUri);
  const extension = source.extension || '.jpg';
  const destination = new File(directory, `${attachmentId}${extension}`);
  await source.copy(destination, { overwrite: true });
  return {
    localUri: destination.uri,
    storagePath: `${shopId}/${saleId}/${attachmentId}`,
    mimeType: extension.toLocaleLowerCase() === '.png' ? 'image/png' : 'image/jpeg',
  };
}

export async function prepareDraftPrescriptionAttachment(
  temporaryUri: string,
  shopId: string,
  draftId: string,
  attachmentId: string,
): Promise<PreparedPrescriptionAttachment> {
  const directory = new Directory(Paths.document, 'prescription-drafts', shopId, draftId);
  directory.create({ intermediates: true, idempotent: true });
  const source = new File(temporaryUri);
  const extension = source.extension || '.jpg';
  const destination = new File(directory, `${attachmentId}${extension}`);
  await source.copy(destination, { overwrite: true });
  return {
    localUri: destination.uri,
    storagePath: `${shopId}/drafts/${draftId}/${attachmentId}`,
    mimeType: extension.toLocaleLowerCase() === '.png' ? 'image/png' : 'image/jpeg',
  };
}

/**
 * Deletes a file if it is there, and reports whether that succeeded. Never
 * throws: both callers below are cleanup paths, and a cleanup that throws turns
 * a recoverable situation into a failed sale or a failed scan.
 *
 * `exists` is read inside the try because the getter itself can throw on an
 * unreadable path, not only `delete()`.
 */
function deleteFileQuietly(uri: string): boolean {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
    return true;
  } catch {
    return false;
  }
}

export async function removePreparedPrescriptionAttachment(localUri: string): Promise<void> {
  // Best-effort orphan cleanup; sale correctness never depends on it.
  deleteFileQuietly(localUri);
}

/**
 * W2-01: removes the scanner's temporary capture — the JPEG `captureAsync()`
 * writes into the cache directory, which nothing used to delete on any path.
 *
 * Only the OCR path may call this. There, the URI never leaves
 * `MedicineTextScanner`, so the scanner is unambiguously its owner. On the
 * `captureOnly` (prescription) path the image is the artefact the caller keeps:
 * the durable copy is made much later, at sale/hold/cancel persistence, and on a
 * resumed held draft the URI is already durable — so deleting it there would
 * destroy a real prescription. That cleanup is gate E9 and is deliberately
 * descoped; see plan section 6.2.2 for the five designs that each got it wrong.
 *
 * Resolves `false` instead of rejecting, so the caller can report the failure
 * without a cleanup error ever surfacing as a scan error.
 */
export async function removeTemporaryCapture(temporaryUri: string): Promise<boolean> {
  return deleteFileQuietly(temporaryUri);
}
