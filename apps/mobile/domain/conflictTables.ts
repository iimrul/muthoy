// domain/conflictTables.ts — who may SEE and who may RESOLVE a conflict.
//
// A conflict row carries snapshots of a business row, so the screen that lists
// conflicts is a data-disclosure surface: a cashier must not learn an expense
// amount or a staff member's details by reading a conflict notice. Visibility
// therefore follows the READ permission for the affected table, and resolution
// follows the WRITE permission — they are separate questions, and a row the
// actor may see but not resolve renders read-only rather than offering a button
// that would be refused.
//
// The write gates mirror the server's own sync_row_permitted
// (20260821010000, as wrapped by 20260831000000). They are expressed with the
// product's permission names via db/dataAccessGates.ts, so client and server
// say the same thing in their own vocabularies instead of drifting.
//
// Pure: no database, no React. Tested against sync-helpers.ts read as source,
// so a new synced table cannot be added without landing here too.

import type { SyncTableName } from "../db/sync-helpers";
import type { AuthorizationPermission } from "./permissions";

/**
 * 'owner' means the shop owner only — not a permission anyone can be granted.
 * Used where the server gates on ownership rather than a permission key.
 */
export type ConflictGate =
  | { readonly owner: true }
  /** Refused for everyone, including the Owner. */
  | { readonly never: true }
  | { readonly permission: AuthorizationPermission }
  /** Every permission must hold — mirrors the server's `and` predicates. */
  | { readonly all: readonly AuthorizationPermission[] };

const owner: ConflictGate = { owner: true };
const never: ConflictGate = { never: true };
const gate = (permission: AuthorizationPermission): ConflictGate => ({
  permission,
});
const all = (...permissions: AuthorizationPermission[]): ConflictGate => ({
  all: permissions,
});

export interface ConflictTablePolicy {
  /** Needed to see that a conflict exists on this table at all. */
  readonly read: ConflictGate;
  /** Needed to choose a side. Always at least as strong as `read`. */
  readonly write: ConflictGate;
}

/**
 * Every LWW-updated synced table. The six append-only tables are absent on
 * purpose — see CONFLICT_EXEMPT_TABLES in domain/serverOwnedFields.ts — and the
 * guard test asserts this map covers exactly the non-exempt set.
 */
export const CONFLICT_TABLE_GATES: Record<
  Exclude<
    SyncTableName,
    | "inventory_movements"
    | "sale_refunds"
    | "refund_tenders"
    | "credit_payment_allocations"
    | "inventory_imports"
    | "audit_logs"
  >,
  ConflictTablePolicy
> = {
  // Shop identity and the commercial envelope: owner-only on both sides. The
  // server gates `shops` on settings_manage, which no non-owner holds.
  shops: { read: owner, write: owner },
  // The effective B4 `sync_row_permitted` (20260831000000:428) returns FALSE
  // for subscriptions — Owner included — and push.ts refuses the table before
  // the permission check even runs. Owner-write here would have been laxer
  // than the server, which is the direction that matters.
  subscriptions: { read: owner, write: never },
  shop_b2_settings: { read: owner, write: owner },

  // The role/permission model and the roster. Readable by anyone who may manage
  // staff; writable on the same gate, except that granting permissions is an
  // owner action server-side (MU015), so user_permissions is owner-write.
  roles: { read: gate("staff_manage"), write: gate("staff_manage") },
  permissions: { read: gate("staff_manage"), write: owner },
  users: { read: gate("staff_manage"), write: gate("staff_manage") },
  user_permissions: { read: gate("staff_manage"), write: owner },

  // Catalogue and stock metadata.
  medicines: { read: gate("inventory_view"), write: gate("inventory_edit") },
  batches: { read: gate("inventory_view"), write: gate("inventory_edit") },
  batch_promotions: {
    read: gate("inventory_view"),
    // The server requires BOTH (20260821010000: `expiry_manage` AND
    // `sale_discount`). A single-permission gate here would have offered a
    // resolve button the server then refused.
    write: all("expiry_manage", "sale_discount"),
  },

  // Customers are reachable from both selling and collecting.
  customers: { read: gate("sale_entry"), write: gate("sale_entry") },

  // The sale graph. sale_history gates reading somebody else's sale; writing is
  // the selling permission.
  sales: { read: gate("sale_history"), write: gate("sale_entry") },
  sale_items: { read: gate("sale_history"), write: gate("sale_entry") },
  sale_drafts: { read: gate("sale_entry"), write: gate("sale_entry") },
  sale_draft_items: { read: gate("sale_entry"), write: gate("sale_entry") },
  sale_attachments: { read: gate("sale_history"), write: gate("sale_entry") },
  sales_returns: { read: gate("sale_history"), write: gate("sale_return") },

  // Supply side: owner-only, matching the B4 premium gate on the server.
  suppliers: { read: owner, write: owner },
  purchases: { read: owner, write: owner },
  purchase_items: { read: owner, write: owner },
  purchase_returns: { read: owner, write: owner },

  // Credit and cash.
  credits: { read: gate("credit_view"), write: gate("credit_manage") },
  credit_reconciliation_states: {
    read: gate("credit_view"),
    write: gate("credit_manage"),
  },
  payments: { read: gate("cash_drawer"), write: gate("cash_drawer") },
  cash_drawer: { read: gate("cash_drawer"), write: gate("cash_drawer") },

  // Expenses are owner-only on the server (B4 premium + cash_management).
  expenses: { read: owner, write: owner },
};

export function conflictPolicyFor(
  table: SyncTableName,
): ConflictTablePolicy | null {
  return (
    (CONFLICT_TABLE_GATES as Record<string, ConflictTablePolicy | undefined>)[
      table
    ] ?? null
  );
}

/**
 * Resolves a gate for an actor.
 *
 * `resolve` is injected rather than imported so this module stays pure and the
 * caller supplies the real resolvePermission with the actor's overrides.
 */
export function satisfiesGate(
  gateToCheck: ConflictGate,
  actor: { readonly isOwner: boolean },
  resolve: (permission: AuthorizationPermission) => boolean,
): boolean {
  // `never` is checked BEFORE the owner shortcut: a server-owned table is
  // refused to everyone, and an Owner is not an exception to that.
  if ("never" in gateToCheck) return false;
  if (actor.isOwner) return true;
  if ("owner" in gateToCheck) return false;
  if ("all" in gateToCheck) return gateToCheck.all.every(resolve);
  return resolve(gateToCheck.permission);
}
