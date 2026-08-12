Plan: Sale Entry, Cart, Checkout (Volume 0 Day 6+7 / Volume 4 SALES) — CORRECTED

Scope: Sale Entry search screen, Cart screen, Checkout screen, Confirmation screen, domain/fefo.ts's deduct(), domain/cashFormula.ts's expectedCash(), domain/discounts.ts's applyDiscount(). Includes the Day 3 FTS5 infra that was never built, a minimal cash_drawer write path pulled forward from Day 10, and a minimal credit-sale customer path pulled forward from Day 9. Full Day 9 Customer Management and full Day 10 open/close-day UI stay out of scope.

Resolved conflicts (superseding the original plan)

1. Search — FTS5, not LIKE. Volume 4 and sale.tsx's own TODO both specify FTS5; db/README.md confirms it was never built (Day 3 skipped, not deferred). Build migration 0001 now as a prerequisite — it is already a committed P0 deliverable, not new scope.

2. Cash drawer — checkout must update it. Volume 4: "updates the cash drawer." checkout.tsx's own sequence comment already names domain/cashFormula.expectedCash as step 2. Decision (founder-approved): if today's cash_drawer row does not exist at first checkout, auto-create it with openingCash = ZERO_PAISA and openedBy = current staffId — temporary/default operational path standing in for Day 10's full open-day UI. Never inherit yesterday's opening cash (CLAUDE.md rule 5) — the auto-create path only ever writes ZERO_PAISA, never copies or carries forward a prior row. Each cash checkout then recomputes and writes closingExpected via expectedCash().

3. Credit sale — must create a credits row. Volume 4 CUSTOMER section: "credit sales create a credits row." credits.customerId is NOT NULL. Decision (founder-approved): checkout's credit path supports both selecting an existing customer and creating a minimal new customer inline. Inline creation is limited to schema-required + minimally useful fields only: name (required by schema) and phone (optional, nullable, but useful for a future collections flow) — no address/notes at checkout, no edit/list/history UI. Full Customer Management (Day 9) stays out of scope.

4. Confirmation screen — required, not skippable. checkout.tsx's existing approved comment names it as step 7. Build a minimal app/sale/confirmation.tsx.

File-level plan

1. db/migrations/0001_*.sql (new, hand-authored — FTS5 virtual tables aren't expressible via schema.ts/drizzle-kit generate): medicines_fts virtual table over name, generic; AFTER INSERT/UPDATE/DELETE triggers on medicines to keep it synced.

2. domain/fefo.ts — implement deduct(): filter batches for the medicine with stock > 0, sortByExpiry, consume earliest-first, spill to next batch when one empties. Add InsufficientStockError (medicineId, requested, available) — thrown, never silently clamped. Pure, no mutation of input.
   Tests (fefo.test.ts): single batch, 2-batch spill, 3+ batch spill, exact-match stops without touching next batch, null-expiry batch skipped last, insufficient stock throws with correct fields, ignores other medicines/zero-stock batches, no mutation.

3. domain/cashFormula.ts — implement expectedCash(): addPaisa(opening, cashSales, creditCollections) minus addPaisa(expenses, refunds, supplierPayments, withdrawals). No rounding (integer paisa throughout).
   Tests (cashFormula.test.ts): zero case, each term's sign verified independently, a combined realistic scenario checked against a hand-computed value, negative (shortfall) result allowed.

4. domain/discounts.ts (new) — applyDiscount(unitPrice: Paisa, quantity: number, discount?: {type: 'percentage'|'flat'; value: number}): { discountAmount: Paisa; lineTotal: Paisa }. Percentage uses multiplyPaisa; flat converts via fromTaka. Discount clamped to [0, subtotal].
   Tests (discounts.test.ts): no discount, percentage, flat, over-large discount clamps to zero.

5. db/sales.ts — implement all three stubs:
   - searchMedicinesForSale(shopId, query): MATCH query against medicines_fts, capped at 50, shop-scoped, is_deleted=false, filtered to medicines with a currently in-stock active batch.
   - getActiveBatchForMedicine(shopId, medicineId): shop-scoped, delegates to domain/fefo.activeBatch.
   - createSaleTransaction(input): one db.transaction. SaleTransactionInput gains staffId (required), amountTendered?: Paisa (cash only, computes paid/change), customerId?: string (required when paymentType='credit'), newCustomer?: { name: string; phone?: string } (alternative to customerId — created first in the same transaction, its id then used). Per batch, updates stock via UPDATE batches SET stock = stock - ? WHERE id = ? AND stock >= ? with an affected-row check (race guard). Writes sales (invoice INV-{YYYY}-{shop's per-year count + 1}), one sale_items row per batch actually touched (FEFO spill across batches splits a cart line into multiple rows; cogs per sub-row uses that batch's own purchasePrice; unitPrice/discount/lineTotal use the cart's locked-in price, apportioned by quantity), inventory_movements (reason: 'sale', refId: saleId). If paymentType='credit': inserts a credits row (customerId, saleId, amount=total, balance=total). If paymentType='cash': ensures today's cash_drawer row exists (auto-create per decision #2 above if missing) and writes closingExpected = expectedCash(getCashSummary(shopId, today)). No sync_queue write (Day 13, deferred, matching every other db/ write today).
   Not unit-tested (touches Drizzle/expo-sqlite, outside vitest.config.ts's scope) — verified via real-device manual testing per the Human Review Workflow.

6. db/cash.ts — implement getCashSummary(shopId, businessDate) only: today's opening cash (0 if no row, per rule 5) + cash sales + credit collections + expenses + refunds + supplier payments + withdrawals, queried from sales/credits/expenses/payments. recordExpense and closeDay stay stubbed (Day 10, untouched).

7. db/customers.ts — implement listCustomers(shopId, query?) (name/phone search, for the credit-checkout picker) and createCustomer({ shopId, name, phone? }) only. No update/delete/detail/history — that is full Day 9 scope, deferred.

8. state/cartStore.ts — wire real Zustand (in-memory, not persisted). addItem merges qty by batchId; updateQuantity removes at 0; clear; total sums each line through applyDiscount. CartLine.unitPrice becomes Paisa (was a bare number). CartLine gains medicineName: string (Cart must render from the store alone, per its existing comment).

9. Screens:
   - app/(tabs)/sale.tsx: search box → searchMedicinesForSale, each row shows name + active-batch price (formatMoney, font-mono), tap adds to cart; EmptyState for no query/no results; cart-count affordance to /sale/cart.
   - app/sale/cart.tsx: renders cartStore.items (qty steppers, per-line total via applyDiscount), running total via cartStore.total(), "Checkout" → /sale/checkout.
   - app/sale/checkout.tsx: cash/credit toggle. Cash: tendered-amount field, computed change. Credit: customer picker (search existing via listCustomers, or a minimal inline "new customer" form — name required, phone optional) — must resolve to a customer before confirming. On confirm: fetch fresh batches per line (db/inventory.ts's listBatchesForMedicine), run fefo.deduct per line (catch InsufficientStockError → inline error, no write, cart untouched), resolve discounts, call createSaleTransaction, then cartStore.clear() and navigate to /sale/confirmation.
   - app/sale/confirmation.tsx (new): invoice number, total, payment type, change (if cash), "New Sale" button back to Sale Entry.

Tests required

- fefo.test.ts, cashFormula.test.ts, discounts.test.ts as specified above — pure logic, must pass, including the spill-over-across-a-batch-boundary case from Volume 0's Day 7 checklist.
- tsc --noEmit clean.
- No new pure-logic surface from the FTS5/cash-drawer/credits additions — they are db/ writes, outside vitest.config.ts's scope, verified on-device instead (same precedent as the rest of db/).

Manual device verification

- Search returns FTS5-matched results (partial name, generic name) capped at 50.
- Add 2 medicines to cart (one whose sale spans 2 batches), adjust qty, checkout cash with a tendered amount: confirm inventory_movements shows the spill-over split, cash_drawer row is auto-created on first sale of the day with openingCash=0, closingExpected updates correctly.
- Checkout credit with an existing customer: confirm a credits row is created with correct amount/balance.
- Checkout credit with a new inline customer: confirm the customer row is created (name only, and again with phone) and the credits row references it.
- Repeat a second cash sale same day: confirm cash_drawer is NOT re-created, closingExpected accumulates correctly, opening cash is untouched.
- Attempt checkout after another sale depletes stock: confirm InsufficientStockError blocks the whole sale, no partial writes, cart stays intact.
- Confirmation screen shows correct invoice/total/change; "New Sale" returns to Sale Entry with an empty cart.
