// db/suppliers.ts — the ONLY file that will touch Drizzle/SQLite for
// Suppliers (DEVELOPMENT_RULES.md). P1 (post-beta fast-follow, Volume 0's
// scope lock). The Drizzle schema doesn't exist yet (Day 2) either way —
// these are signature-only stubs.

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  email?: string;
  contactPerson?: string;
}

// TODO(P1): list suppliers with outstanding payable per supplier.
export async function listSuppliers(_shopId: string): Promise<(Supplier & { payable: number })[]> {
  throw new Error('TODO: implement supplier list query (P1 — post-beta, Volume 4 SUPPLIER)');
}

export async function createSupplier(_shopId: string, _supplier: Omit<Supplier, 'id'>): Promise<Supplier> {
  throw new Error('TODO: implement supplier creation (P1 — post-beta, Volume 4 SUPPLIER)');
}

// TODO(P1): purchase history + outstanding payables for one supplier
// (Volume 4 SUPPLIER: "its own detail view showing purchase history and
// outstanding payables").
export async function getSupplierDetail(_supplierId: string): Promise<{ supplier: Supplier; payable: number }> {
  throw new Error('TODO: implement supplier detail query (P1 — post-beta, Volume 4 SUPPLIER)');
}
