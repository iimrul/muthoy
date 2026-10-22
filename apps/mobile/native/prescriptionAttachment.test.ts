// W2-01 section 6.2.2: the capture-cleanup contract.
//
// `removeTemporaryCapture` is called from `MedicineTextScanner`'s `finally` on
// the OCR path, where the scan has usually just SUCCEEDED. A cleanup that
// rejects there would turn a working scan into a failed one, so the one
// property this file pins is that it never rejects — not on a missing file, not
// when `delete()` throws, and not when even the `exists` getter throws.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
  files: new Set<string>(),
  throwOnDelete: new Set<string>(),
  throwOnExists: new Set<string>(),
  deleted: [] as string[],
}));

vi.mock('expo-file-system', () => {
  class Directory {
    constructor(..._parts: unknown[]) {}
    create() {}
  }
  class File {
    readonly uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map(String).join('/');
    }
    get exists() {
      if (fs.throwOnExists.has(this.uri)) throw new Error('unreadable path');
      return fs.files.has(this.uri);
    }
    get extension() {
      return '.jpg';
    }
    delete() {
      if (fs.throwOnDelete.has(this.uri)) throw new Error('permission denied');
      fs.files.delete(this.uri);
      fs.deleted.push(this.uri);
    }
    async copy() {}
  }
  return { Directory, File, Paths: { document: 'file:///documents' } };
});

const { removeTemporaryCapture, removePreparedPrescriptionAttachment } = await import(
  './prescriptionAttachment'
);

const CAPTURE = 'file:///cache/strip-1.jpg';

beforeEach(() => {
  fs.files.clear();
  fs.throwOnDelete.clear();
  fs.throwOnExists.clear();
  fs.deleted.length = 0;
});

describe('removeTemporaryCapture', () => {
  it('deletes the capture and reports success', async () => {
    fs.files.add(CAPTURE);

    await expect(removeTemporaryCapture(CAPTURE)).resolves.toBe(true);

    expect(fs.deleted).toEqual([CAPTURE]);
    expect(fs.files.has(CAPTURE)).toBe(false);
  });

  it('succeeds when the file is already gone — the OS may evict a cache file', async () => {
    await expect(removeTemporaryCapture(CAPTURE)).resolves.toBe(true);
    expect(fs.deleted).toEqual([]);
  });

  it('resolves false instead of rejecting when the delete fails', async () => {
    fs.files.add(CAPTURE);
    fs.throwOnDelete.add(CAPTURE);

    await expect(removeTemporaryCapture(CAPTURE)).resolves.toBe(false);
  });

  it('resolves false instead of rejecting when the existence check itself throws', async () => {
    fs.throwOnExists.add(CAPTURE);

    await expect(removeTemporaryCapture(CAPTURE)).resolves.toBe(false);
  });
});

describe('removePreparedPrescriptionAttachment', () => {
  it('still removes a prepared attachment and still never rejects', async () => {
    const prepared = 'file:///documents/prescriptions/shop-1/sale-1/att-1.jpg';
    fs.files.add(prepared);
    await expect(removePreparedPrescriptionAttachment(prepared)).resolves.toBeUndefined();
    expect(fs.files.has(prepared)).toBe(false);

    fs.files.add(prepared);
    fs.throwOnDelete.add(prepared);
    await expect(removePreparedPrescriptionAttachment(prepared)).resolves.toBeUndefined();
  });
});
