// Runtime invariants — enforce P1 traceability rules.
// In dev: throw. In prod: log + skip the bad write so a single corrupt record can't brick the store.
const DEV = typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

function fail(msg: string, ctx?: any) {
  const err = new Error(`[invariant] ${msg}`);
  if (DEV) {
    console.error(err, ctx);
    throw err;
  }
  console.warn(err, ctx);
}

export function assertInvoiceValid(inv: any): boolean {
  if (!inv || typeof inv !== "object") { fail("invoice not object", inv); return false; }
  if (!inv.supplierId) { fail("invoice missing supplierId", inv); return false; }
  if (typeof inv.total !== "number" || inv.total < 0) { fail("invoice total invalid", inv); return false; }
  return true;
}

export function assertBatchValid(batch: any): boolean {
  if (!batch || typeof batch !== "object") return false;
  if (batch.legacy) return true; // grandfathered
  if (!batch.invoiceId) { fail("batch missing invoiceId", batch); return false; }
  if (!batch.supplierId) { fail("batch missing supplierId", batch); return false; }
  if (!(Number(batch.purchasePrice) > 0)) { fail("batch purchasePrice must be > 0", batch); return false; }
  return true;
}
