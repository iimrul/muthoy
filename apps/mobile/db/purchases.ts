// db/purchases.ts — the ONLY file that will touch Drizzle/SQLite for
// Purchases (DEVELOPMENT_RULES.md). P1 (post-beta fast-follow, Volume 0's
// scope lock) — Beta ships manual batch entry via Add Medicine instead. The
// Drizzle schema doesn't exist yet (Day 2) either way — signature-only stubs.

export interface CreatePurchaseInput {
  shopId: string;
  supplierId: string;
  invoiceNo: string; // from domain/purchases.generateInvoiceNumber
  paymentType: 'cod' | 'credit';
  lineItems: { medicineId: string; batchNo: string; expiryDate: string; quantity: number; purchasePrice: number; salePrice: number }[];
}

// TODO(P1): write `purchases` + `purchase_items` in one transaction; line
// items create-or-update the matching `batches` rows (Volume 3 ER diagram:
// "purchase chain mirrors it via suppliers → purchases → purchase_items →
// purchase_returns"). COD/credit effect resolved via
// domain/purchases.resolvePaymentEffect before writing.
export async function createPurchase(_input: CreatePurchaseInput): Promise<{ purchaseId: string }> {
  throw new Error('TODO: implement purchase transaction write (P1 — post-beta, Volume 4 PURCHASE)');
}
