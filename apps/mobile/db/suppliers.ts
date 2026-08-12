// SQLite-backed supplier directory. Payables are always derived from purchase
// headers; a future pay-down flow must update purchases.paid_amount.

import { asPaisa, type Paisa } from '@muthoy/types';
import { generateId } from '../native/id';
import { getActiveSessionRole } from './auth';
import { db, sqliteConnection } from './client';
import { NotAuthorizedError } from './errors';
import { suppliers } from './schema';

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  email?: string;
  contactPerson?: string;
}

interface SupplierPayableRow {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  email: string | null;
  contactPerson: string | null;
  payable: number;
}

async function requireOwner(shopId: string, actorUserId: string): Promise<void> {
  if (await getActiveSessionRole(actorUserId, shopId) !== 'owner') {
    throw new NotAuthorizedError();
  }
}

function mapSupplier(row: SupplierPayableRow): Supplier & { payable: Paisa } {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? undefined,
    address: row.address ?? undefined,
    email: row.email ?? undefined,
    contactPerson: row.contactPerson ?? undefined,
    payable: asPaisa(row.payable),
  };
}

export async function listSuppliers(
  shopId: string,
  actorUserId: string,
): Promise<(Supplier & { payable: Paisa })[]> {
  await requireOwner(shopId, actorUserId);
  const rows = sqliteConnection.getAllSync<SupplierPayableRow>(
    `SELECT s.id, s.name, s.phone, s.address, s.email,
            s.contact_person AS contactPerson,
            COALESCE(SUM(CASE WHEN p.is_deleted = 0
              THEN p.total - p.paid_amount ELSE 0 END), 0) AS payable
       FROM suppliers AS s
       LEFT JOIN purchases AS p
         ON p.shop_id = s.shop_id AND p.supplier_id = s.id
      WHERE s.shop_id = $shopId AND s.is_deleted = 0
      GROUP BY s.id, s.name, s.phone, s.address, s.email, s.contact_person
      ORDER BY s.name`,
    { $shopId: shopId },
  );
  return rows.map(mapSupplier);
}

export async function createSupplier(
  shopId: string,
  actorUserId: string,
  supplier: Omit<Supplier, 'id'>,
): Promise<Supplier> {
  await requireOwner(shopId, actorUserId);
  const id = generateId();
  await db.insert(suppliers).values({
    id,
    shopId,
    name: supplier.name,
    phone: supplier.phone ?? null,
    address: supplier.address ?? null,
    email: supplier.email ?? null,
    contactPerson: supplier.contactPerson ?? null,
  });
  return { id, ...supplier };
}

export async function getSupplierDetail(
  shopId: string,
  actorUserId: string,
  supplierId: string,
): Promise<{ supplier: Supplier; payable: Paisa }> {
  await requireOwner(shopId, actorUserId);
  const row = sqliteConnection.getFirstSync<SupplierPayableRow>(
    `SELECT s.id, s.name, s.phone, s.address, s.email,
            s.contact_person AS contactPerson,
            COALESCE(SUM(CASE WHEN p.is_deleted = 0
              THEN p.total - p.paid_amount ELSE 0 END), 0) AS payable
       FROM suppliers AS s
       LEFT JOIN purchases AS p
         ON p.shop_id = s.shop_id AND p.supplier_id = s.id
      WHERE s.id = $supplierId AND s.shop_id = $shopId AND s.is_deleted = 0
      GROUP BY s.id, s.name, s.phone, s.address, s.email, s.contact_person`,
    { $supplierId: supplierId, $shopId: shopId },
  );
  if (!row) {
    throw new Error('Supplier does not belong to this shop');
  }
  const mapped = mapSupplier(row);
  const { payable, ...supplier } = mapped;
  return { supplier, payable };
}
