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

export async function removePreparedPrescriptionAttachment(localUri: string): Promise<void> {
  try {
    const file = new File(localUri);
    if (file.exists) file.delete();
  } catch {
    // Best-effort orphan cleanup; sale correctness never depends on it.
  }
}
