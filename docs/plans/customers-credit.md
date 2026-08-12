Customers + Credit Ledger (Volume 4 CUSTOMER, Day 9)
Context
Volume 4's CUSTOMER spec calls for a customer directory (name/phone/address/notes) and a per-customer credit ledger with a running balance, per the Volume 6 "Customer Prompt." This isn't greenfield: the customers and credits tables are already migrated, db/customers.ts already has two live functions (listCustomers, createCustomer) and three throwing TODO stubs, domain/credit.ts has a stubbed pure balance function, and app/credit/credit-sales.tsx / app/credit/customer-detail.tsx exist as placeholder screens at the correct expo-router paths. The suppliers/ feature (list + detail screen, SQL-derived running total, atomic transaction writes) is a near-exact structural precedent already shipped in this repo and is the pattern to mirror.

Goal: complete the existing stubs and screens so a shop can record credit sales (already working via checkout), view each customer's ledger and running balance, and collect payments against that balance — with collections correctly feeding the cash drawer's fixed cash formula.

Decisions confirmed with the user:

Credit screens are open to any active staff session (not owner-gated) — matches checkout's existing credit-sale flow, which is not owner-gated either.
Collecting more than a customer's current outstanding balance is blocked with a clear error (no store-credit/negative-balance concept).
recordCreditSale (a stub for giving credit directly to a customer, not tied to a checkout sale) stays a TODO stub — out of scope. Checkout's createSaleTransaction already handles credit sales end-to-end atomically and is untouched by this plan.
Design
domain/credit.ts — implement the pure balance calc
export function remainingBalance(entries: CreditLedgerEntry[]): Paisa
Sum credit_sale amounts minus sum collection amounts via addPaisa/subtractPaisa from @muthoy/types. Pure aggregate (order-independent) — matches the existing CreditLedgerEntry { type, amount } interface exactly, no new fields needed here.

New domain/credit.test.ts (vitest, mirrors domain/purchases.test.ts): empty ledger → 0; single credit_sale → equals amount; credit_sale + partial collection → exact remainder; multiple credit_sales + multiple collections → correct net; fully collected → 0.

db/customers.ts — extend the live functions, implement two stubs
Customer interface: normalize to { id, name, phone: string | null, address: string | null, notes: string | null }.
listCustomers(shopId, query?) — unchanged, still id/name/phone only, limit 50. This is checkout's live customer picker (app/sale/checkout.tsx) — do not alter its behavior or signature.
CreateCustomerInput — extend with address?, notes?; createCustomer persists them (currently silently dropped despite schema support).
getCustomer(shopId, customerId): Promise<Customer> — new, full-field fetch for the detail screen header, throws a plain Error if not found or wrong shop (mirrors suppliers.getSupplierDetail's "does not belong to this shop" convention).
CreditLedgerRow { id, type: 'credit_sale' | 'collection', amount: Paisa, createdAt: string } and getCustomerCreditLedger(shopId, customerId): Promise<CreditLedgerRow[]> — implements the existing stub via UNION ALL between credits (shopId+customerId+isDeleted=0 → credit_sale) and payments (type='customer_payment', partyId=customerId, shopId, isDeleted=0 → collection), ORDER BY created_at DESC. Backed by a shared sync helper (e.g. getCustomerLedgerRowsSync, using sqliteConnection.getAllSync) so the same query can run both as the async public read and inside collectPayment's transaction for the balance check — mirrors db/cash.ts's getCashSummarySync/getCashSummary sync/async split, which relies on expo-sqlite's single shared connection letting a sync read inside an in-progress db.transaction see that transaction's own uncommitted writes.
listCustomersWithBalance(shopId, query?): Promise<(Customer & { balance: Paisa })[]> — new, for the list screen. Must use independent correlated subqueries per metric (COALESCE((SELECT SUM(amount) FROM credits WHERE ...), 0) and COALESCE((SELECT SUM(amount) FROM payments WHERE type='customer_payment' AND ...), 0)), the same style getCashSummarySync already uses — not a LEFT JOIN credits ... LEFT JOIN payments ... GROUP BY (that pattern, copied naively from suppliers.ts's single-child-table aggregate, would fan out N×M rows across the two independent child tables and inflate both sums). This was the one real bug caught during design review.
CollectPaymentInput { shopId, staffId, customerId, amount, method?: 'cash' | 'bkash' | 'nagad' | 'rocket' | 'card' | 'bank' | 'other' } and collectPayment(input): Promise<void> — implements the stub. Validate amount is a positive integer (plain Error, matching sales.ts's validation style — not a typed error class). Inside db.transaction:
Re-validate customer belongs to shop and staff session is active for the shop (mirrors sales.ts's in-transaction re-checks).
Fetch ledger rows via the sync helper, compute current balance via remainingBalance.
If amount > balance, throw a plain Error('Collection amount exceeds outstanding balance') — the exact scenario the Volume 6 Recovery Prompt describes testing.
Insert a payments row: type='customer_payment', partyId=customerId, amount, method: method ?? 'cash', refId: null, createdBy: staffId, shopId.
Only if the resolved method is 'cash': upsert today's cash_drawer row and recompute closingExpected via expectedCash(getCashSummarySync(shopId, businessDate)) — identical pattern to sales.ts's cash-sale branch and purchases.ts's COD branch. A non-cash collection still reduces the ledger balance but must not touch the drawer at all (mirrors purchases.ts only touching the drawer for 'cod', not 'credit'). This requires no special-casing in getCashSummarySync itself — its creditCollections sum already filters method='cash', so a bkash/nagad/etc. payment row naturally doesn't affect closingExpected.
credits.balance stays set to amount at insert (as sales.ts already does) and is never mutated afterward — it's not read anywhere; the real balance is always the aggregate computed by remainingBalance/the correlated subqueries, never a stored/incrementally-updated value (consistent with the project's "recompute at read time" bias for derived numbers).

recordCreditSale is left untouched as a throwing stub per the confirmed decision — out of scope.

packages/validation/src/customers.ts — new
customerFieldsSchema (zod): name required min-length, phone/address/notes optional (reuse the existing optionalText helper pattern from purchases.ts: trims, empty string → undefined). Export types CustomerFieldsInput/CustomerFieldsOutput. Add export * from './customers' to packages/validation/src/index.ts.

Screens — mirror suppliers/list.tsx and suppliers/detail.tsx structurally, no owner gate
app/credit/credit-sales.tsx: replace the placeholder. useSessionStore for session.shopId/session.userId (gate only on an active session existing, not role !== 'owner'). Load via listCustomersWithBalance. Inline "Add customer" form (react-hook-form + zodResolver(customerFieldsSchema), fields name/phone/address/notes via FormField) calling createCustomer. List rows show name, phone, and balance (formatMoney, font-mono className — never a hardcoded font string, per CLAUDE.md rule 6). Row press → router.push({ pathname: '/credit/customer-detail', params: { customerId } }).
app/credit/customer-detail.tsx: replace the placeholder. Reads customerId via useLocalSearchParams. Promise.all([getCustomer, getCustomerCreditLedger]) on load (mirrors suppliers/detail.tsx's Promise.all([getSupplierDetail, listPurchasesForSupplier])). Header shows name/phone/address/notes. Running balance computed via remainingBalance(ledgerRows) from the already-fetched rows (no extra query) and displayed with formatMoney/font-mono. Ledger list shows each row's type (credit sale vs. collection), date, amount. "Collect payment" control: a taka amount input converted via fromTaka before calling collectPayment({ shopId, staffId: userId, customerId, amount }); surface collectPayment's thrown error message inline (never a crash/Alert, per the established db/errors.ts convention), then reload the ledger on success.
No dashboard/tab-bar navigation entry is added — matches the Suppliers precedent, which is also only reachable via direct router.push/file-based routing today; wiring a nav menu is Day 5's (still-unbuilt) dashboard concern, not this task's.

Files
apps/mobile/domain/credit.ts — implement remainingBalance
apps/mobile/domain/credit.test.ts — new unit tests
apps/mobile/db/customers.ts — extend Customer/CreateCustomerInput; add getCustomer, getCustomerCreditLedger (+ sync helper), listCustomersWithBalance, collectPayment
packages/validation/src/customers.ts — new customerFieldsSchema
packages/validation/src/index.ts — add the re-export
apps/mobile/app/credit/credit-sales.tsx — build out (mirrors suppliers/list.tsx)
apps/mobile/app/credit/customer-detail.tsx — build out (mirrors suppliers/detail.tsx)
Verification
Manual, end-to-end on device/simulator (per Volume 6's own validation clause — give credit, then collect a partial payment, confirm the remaining balance is exactly correct):

Create a customer via credit-sales.tsx's add form (name/phone/address/notes) — confirm all four fields persist and reappear on reload.
Run a credit sale through the existing checkout flow against that customer — confirm it appears on customer-detail.tsx as a credit_sale row and the running balance equals the sale total.
Collect a partial cash payment less than the balance — confirm the balance becomes exactly total − partial, and that today's cash-drawer closingExpected (via the existing cash-summary/end-of-day read path) increased by exactly the partial amount.
Collect a non-cash (e.g. bkash) payment — confirm the balance drops further but the cash drawer is unaffected.
Attempt to collect more than the remaining balance — confirm it's rejected with a clear inline message, not a crash.
Confirm a second shop/owner registered on the same device sees none of this customer/credit data (multi-tenancy check per CLAUDE.md rule 7).
Automated: domain/credit.test.ts covers the balance math in isolation (the money logic CLAUDE.md rule 10 requires a passing test for). No new DB-layer integration test harness exists in this repo yet (none of sales.ts/purchases.ts have one either) — matching that existing precedent, this plan does not introduce one for db/customers.ts.