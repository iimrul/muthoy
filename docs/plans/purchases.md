Purchases (Volume 4) — implementation plan
Context
Volume 4's PURCHASE spec (docs/playbook/04-mobile-development.md:60-77):

"Suppliers (name/phone/address/email/contact_person) → Purchase creation (invoice_no auto-generated, line items create/update batches) → COD pays cash immediately, credit updates the supplier payable only."

Scope-lock note (CLAUDE.md rule 13): Volume 0's roadmap classifies the full Purchases/supplier-invoice system as P1 (post-beta fast-follow) — Beta's stock-in path is "Add Medicine"/"Add Batch" only. The user has explicitly approved building this now anyway, overriding that scope lock. Recorded here per rule 11.

The feature is not unstarted: domain/purchases.ts, db/purchases.ts, db/suppliers.ts, and three screens (app/suppliers/list.tsx, detail.tsx, purchase-create.tsx) already exist as signature-only stubs, already wired into Expo Router. This plan implements those stubs, reusing the atomic-transaction pattern already proven in db/sales.ts.

Invoice format (approved): PUR-{YYYY}-{6-digit-seq}, mirroring Sales' INV-{YYYY}-{6-digit-seq}.

Deliberate deviations from the frozen stub signatures
CreatePurchaseInput gains staffId: string. inventory_movements.createdBy/payments.createdBy are NOT NULL FKs; nothing else supplies it. Despite the field name (carried over from the Sales precedent), the id it holds must resolve to the owner's role — see the OWNER-ONLY enforcement decision below, which reuses this same field as the DB-boundary actor check rather than adding a separate parameter.
CreatePurchaseInput.invoiceNo dropped; return type gains invoiceNo/total. Invoice numbering must be computed inside the write transaction (race-safe). domain/purchases.ts's generateInvoiceNumber is removed entirely for the same reason — Sales has no equivalent pure function either.
getSupplierDetail(supplierId) → getSupplierDetail(shopId, actorUserId, supplierId). The frozen signature has no shop scoping, unlike every other db/ getter — shipping it as-is would violate CLAUDE.md rule 7 (cross-shop data leakage). shopId is required regardless; actorUserId is an additional new parameter needed for the OWNER-ONLY enforcement decision below.
listSuppliers(shopId) → listSuppliers(shopId, actorUserId). createSupplier(shopId, supplier) → createSupplier(shopId, actorUserId, supplier). Neither had an owner-only requirement when first stubbed; actorUserId is added for the same DB-boundary enforcement as getSupplierDetail.
Everything else — resolvePaymentEffect's signature, all three screen routes — is implemented as already typed.

Design decisions
resolvePaymentEffect(paymentType, amount): COD → {cashDrawerDelta: -amount, payableDelta: 0}; credit → {cashDrawerDelta: 0, payableDelta: amount}. paidAmount = total - payableDelta.

OWNER-ONLY access (Purchases + supplier payable), enforced at two independent boundaries, resolving a Codex STOP conflict against the earlier draft (which had no explicit access-control decision at all):
Screen/navigation boundary: app/suppliers/list.tsx, detail.tsx, and purchase-create.tsx each add the exact guard app/staff/management.tsx already uses — `if (!session || session.role !== 'owner') return <View>...<Text>Owner access only.</Text></View>` — rendered before any data load or form. No new component; this is the established repo pattern for owner-only screens (Volume 0 Day 11).
DB boundary (defense-in-depth — a screen guard alone is bypassable by any future direct db/ call site, so the check is re-derived from SQLite, never trusted from a caller-passed role string): every db/purchases.ts and db/suppliers.ts function that creates or reads purchase/supplier-payable data calls the existing db/auth.ts's getActiveSessionRole(actorUserId, shopId) — which already re-derives the caller's role from SQLite's users→roles join, ignoring anything the caller claims — and requires the result to be exactly 'owner'. On failure, throws a new NotAuthorizedError (added to db/errors.ts, same shape/UX precedent as DuplicateBatchError). This deliberately does NOT route through domain/permissions.ts's hasPermission/Permission matrix, which remains an unimplemented Day-11 stub with no purchases/supplier key — coupling this plan's shippability to unblocking that unrelated stub is out of scope; a direct role==='owner' check mirrors staff/management.tsx's existing precedent exactly.
Scope of the DB-boundary check: createPurchase (via its existing staffId field — no new parameter), listPurchasesForSupplier, listSuppliers, createSupplier, and getSupplierDetail (all four via a new actorUserId parameter, since none had an actor parameter before). searchMedicinesForPurchase is explicitly NOT owner-gated at the DB boundary — it exposes only medicine name/generic, no purchase or payable data, and staff already have inventory-view visibility into medicines elsewhere; it is reachable only via the already owner-gated purchase-create screen. Stated explicitly here to avoid re-litigating it as a gap.

Batch upsert, inline inside db/purchases.ts's transaction (not a db/inventory.ts export — atomicity requires it). Per line item, SELECT existing (shopId, medicineId, batchNo) ignoring is_deleted, then:
Active batch, expiry matches → same lot: stock += qty only. purchasePrice/salePrice untouched — overwriting would silently re-price already-in-stock units.
Active batch, expiry differs → reject with new BatchExpiryMismatchError (mirrors DuplicateBatchError) — prevents corrupting FEFO ordering for existing stock.
Soft-deleted batch found → REJECT, do not revive (resolves a second Codex STOP conflict against the earlier draft, which auto-revived it as a fresh lot). Throw the existing DuplicateBatchError — no new error type needed; db/inventory.ts's addBatchToMedicine already treats a soft-deleted match as a DuplicateBatchError for the identical underlying reason (the UNIQUE(shop_id, medicine_id, batch_no) index does not exclude soft-deleted rows, so the slot is still occupied), so this makes Purchases' soft-deleted case consistent with that existing precedent instead of introducing a new resurrection behavior. No stock, price, or expiry field is touched — the row is left exactly as it was.
No row at all → plain insert.
Multiple line items sharing a batch in one purchase work correctly without pre-aggregation (transaction sees its own uncommitted writes).
Payable is derived: SUM(purchases.total - purchases.paidAmount) per supplier. Invariant flagged in comments: a future "pay down a credit purchase" feature must update paid_amount, not just insert a payments row.
New-supplier creation is a separate pre-step, not inlined into the purchase transaction.
Invoice sequence, race-guarded stock, cash-drawer auto-create/recompute — copied verbatim in shape from db/sales.ts.
Files to write
apps/mobile/domain/purchases.ts (replace stub)
Pure. Keeps only resolvePaymentEffect. Removes generateInvoiceNumber entirely — obsolete because invoice numbers are generated inside createPurchase's DB transaction (race-safe count-then-format), not by a pure function fed a lastInvoiceNumber. Sales sets the precedent: no domain/sales.ts equivalent exists either.

apps/mobile/domain/purchases.test.ts (new)
Vitest, mirrors domain/cashFormula.test.ts: COD/credit branches, zero-amount edge case, and that subtractPaisa(total, effect.payableDelta) reproduces paidAmount.

apps/mobile/db/errors.ts (extend)
Add BatchExpiryMismatchError extends Error, same shape as DuplicateBatchError. Add NotAuthorizedError extends Error (new, for the OWNER-ONLY decision above), same shape/UX precedent as DuplicateBatchError — a friendly, typed, inline-renderable error, never a raw crash. DuplicateBatchError itself is unchanged, and is now also reused (not extended) by db/purchases.ts's batch-upsert for the soft-deleted-match case.

apps/mobile/db/purchases.ts (replace stub)
createPurchase(input): Promise<{ purchaseId, invoiceNo, total }> — one transaction: validate staff belongs to shop AND resolve staffId's role via db/auth.ts's getActiveSessionRole, requiring 'owner' (throw NotAuthorizedError otherwise) → validate supplier → compute total/effect/paidAmount → race-safe invoice number → insert header → per line item (validate medicine → three-way batch upsert: same-lot increment / expiry-mismatch reject (BatchExpiryMismatchError) / soft-deleted-match reject (DuplicateBatchError, no revive) / plain insert when no row at all → insert purchase_items + inventory_movements) → if COD, insert payments + cash-drawer auto-create/recompute.

Additive: listPurchasesForSupplier(shopId, actorUserId, supplierId) — same getActiveSessionRole owner check as createPurchase, then plain SELECT, newest-first; searchMedicinesForPurchase(shopId, query) — reuses the existing FTS5 medicines_fts MATCH pattern from searchMedicinesForSale/toFtsPrefixQuery, stays shop-scoped and soft-delete-safe, but does not require stock > 0 since purchasing is a stock-in flow. Deliberately NOT owner-gated (see OWNER-ONLY decision's scope note above).

apps/mobile/db/suppliers.ts (replace stub)
listSuppliers(shopId, actorUserId), createSupplier(shopId, actorUserId, supplier), getSupplierDetail(shopId, actorUserId, supplierId) (corrected + owner-gated signature) — payable derived via raw SQL. All three call db/auth.ts's getActiveSessionRole(actorUserId, shopId) and require 'owner', throwing NotAuthorizedError otherwise, before doing any other work.

packages/validation/src/purchases.ts (new) + index.ts export
supplierFieldsSchema, purchaseLineItemFieldsSchema (required expiry, unlike inventory's optional one). Unchanged by this update.

Screens
app/suppliers/list.tsx, detail.tsx, and purchase-create.tsx each start with the owner-only screen guard described above (`if (!session || session.role !== 'owner') return <Text>Owner access only.</Text>`, mirroring app/staff/management.tsx) before any load or form renders. detail.tsx calls the corrected getSupplierDetail(session.shopId, session.userId, supplierId) and listPurchasesForSupplier(session.shopId, session.userId, supplierId). purchase-create.tsx: supplier picker, COD/credit toggle, line-item form with BatchExpiryMismatchError shown inline under the expiry field and DuplicateBatchError shown inline under the batch-number field (soft-deleted-match case, no silent revive), running total, save — full detail in the file.

Verification
Unit: domain/purchases.test.ts. db/ writes verified on-device (matches Sales precedent, no unit tests).

On-device walkthrough (11 steps): staff-role login cannot reach any of the three supplier/purchase screens (owner-only screen guard) → a direct call to createPurchase/listSuppliers/createSupplier/getSupplierDetail/listPurchasesForSupplier with a staff actorUserId throws NotAuthorizedError, not a partial write (owner-only DB boundary) → create supplier as owner → COD purchase full write-set → same-batch-same-expiry restock leaves price unchanged → same-batch-different-expiry rejected inline with BatchExpiryMismatchError → same-batch matching a SOFT-DELETED row is rejected inline with DuplicateBatchError, batches row is untouched (no revive, no stock/price/expiry change) → credit purchase → sequential invoice numbers under race → cross-shop medicine rejected → cross-shop getSupplierDetail blocked → tsc/expo lint clean.