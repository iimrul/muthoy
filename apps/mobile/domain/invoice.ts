// domain/invoice.ts — pure invoice-number formatting. No SQLite, no network.
//
// Why the suffix exists. The sequence is counted from THIS device's local
// table, so two phones working one shop both reach, say, document number 11
// and both mint the same string. The cloud's `sales_shop_invoice_unique` /
// `purchases_shop_invoice_unique` index then rejects the second with 23505,
// which sync/push.ts classifies as a PERMANENT failure — that row never
// reaches the cloud at all. Not a cosmetic clash: silent, per-document data
// loss the moment a second device exists.
//
// The fix keeps the number a shopkeeper can read out over the phone and adds
// twelve characters taken straight from the row's own UUID, which is already
// globally unique and already generated before the row is written. No counter
// table, no device registry, no server round trip — an offline sale or a
// stock-receiving done in a basement still mints its number instantly, which
// is the whole point.

/** Digits in the human-readable running number. */
export const INVOICE_SEQUENCE_WIDTH = 6;

/**
 * Hex characters lifted from the row's UUID: INV-2026-000011-A1B2C3D4E5F6.
 *
 * Twelve, not four. Four hex characters is 16 bits, so a shop doing a few
 * thousand documents a year crosses a ~1% chance of two of them landing on the
 * same suffix (birthday bound), and a collision that DOES happen is silent
 * cloud data loss, not a cosmetic clash. Twelve characters is the UUID's whole
 * 48-bit node field, which drops that to negligible for any real shop while
 * still fitting on a printed slip.
 */
export const INVOICE_SUFFIX_LENGTH = 12;

/**
 * The last twelve hex characters of the row's UUID, uppercased.
 *
 * The TAIL, not the head, and that is load-bearing. expo-crypto's randomUUID
 * returns a v4 UUID whose leading characters include the fixed version and
 * variant nibbles, while the trailing node field is fully random. Taking from
 * the front would hand back near-identical suffixes and defeat the purpose.
 *
 * Deterministic by construction: the same id always yields the same suffix, so
 * a number can be re-derived from the stored row and never has to be persisted
 * separately or looked up.
 */
export function invoiceSuffix(id: string): string {
  const hex = id.replace(/-/g, '');
  if (hex.length < INVOICE_SUFFIX_LENGTH) {
    throw new Error(`Cannot derive an invoice suffix from id "${id}"`);
  }
  return hex.slice(-INVOICE_SUFFIX_LENGTH).toUpperCase();
}

/**
 * `{prefix}-{year}-{sequence padded to 6}-{12 hex from the row id}`.
 *
 * `sequence` stays exactly what it was: this device's count of the shop's
 * documents so far this year, plus one. It is deliberately NOT made globally
 * unique — two devices sharing a number is expected and fine, because the
 * suffix is what the uniqueness constraint actually rests on.
 */
function buildInvoiceNo(prefix: string, year: number, sequence: number, rowId: string): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Invoice sequence must be a positive integer, received ${sequence}`);
  }
  const padded = String(sequence).padStart(INVOICE_SEQUENCE_WIDTH, '0');
  return `${prefix}-${year}-${padded}-${invoiceSuffix(rowId)}`;
}

/** A customer-facing sale: INV-2026-000011-A1B2C3D4E5F6. */
export function buildSaleInvoiceNo(year: number, sequence: number, saleId: string): string {
  return buildInvoiceNo('INV', year, sequence, saleId);
}

/** Stock received from a supplier: PUR-2026-000011-A1B2C3D4E5F6. */
export function buildPurchaseInvoiceNo(year: number, sequence: number, purchaseId: string): string {
  return buildInvoiceNo('PUR', year, sequence, purchaseId);
}
