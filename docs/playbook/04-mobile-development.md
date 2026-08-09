# MUTHOY POS — AI ENGINEERING PLAYBOOK
## VOLUME 4 — Mobile Development
### Feature-by-feature specification. Build order and exact prompts are in
### Volume 0 (Days 1-15) and Volume 6 (reusable prompt library).

---

## EXPO
SDK 52, Expo Router (file-based navigation), EAS for builds. Development builds
required from Day 1 (not Expo Go) because native modules (camera/ML Kit,
local-auth, location) don't run in Expo Go.

## NAVIGATION
Route groups `(auth)` and `(tabs)` per Volume 2. Standard header component
(translucent soft-green, back chevron, centered title, language toggle) applied
to every screen except MorningDashboard and Registration.

## AUTHENTICATION
Owner: phone number (OTP via Supabase, built Day 13 — P0 for Beta; Days 1-11
use local-only registration as the interim step) → sets a PIN → future logins are
PIN-only, fully offline (bcrypt hash checked locally). Staff: created by the
owner with a name + PIN, never needs a phone number. Both converge on a session
carrying `shop_id` + `role`. PIN entry UI: 4 dots + custom numeric keypad
(skip bottom-left, backspace bottom-right) — reused everywhere a PIN is entered
(setup, login, owner change-PIN, staff PIN-reset).

## STATE MANAGEMENT
Zustand for session/cart/active-shop/UI flags — never the source of truth.
TanStack Query exclusively for the sync layer's mutations (built Day 13, P0
for Beta) — screens
never use it to fetch what they display. MMKV for PIN hash + session (fast,
synchronous).

## LOCAL DATABASE
SQLite + WAL via Drizzle, per Volume 3. The only code that imports Drizzle lives
in `db/`.

## OCR (P1 — post-beta fast-follow; manual search covers Beta)
ML Kit's text recognition API. Used two ways: Sales screen (read-only lookup —
matches scanned text against local inventory), Add Medicine (prefills form
fields, requires user confirmation before saving). See Volume 6's OCR Prompt.

## BARCODE (P1 — post-beta fast-follow, same engine as OCR above)
ML Kit's barcode scanning API — the SAME engine as OCR, a different API within
it, not a separate library. Same two usage contexts as OCR above.

## INVENTORY
List view: medicine name, current total stock, batch count, active-batch
expiry countdown. Add Medicine: React Hook Form + Zod, strength/category/
unit_of_measure/requires_prescription/barcode fields, first batch entry.
Batch uniqueness enforced with a friendly error (Volume 3's constraint).

## SALES
Sale Entry: FTS5 search capped at 50 results, each showing the FEFO active
batch's price in DM Mono. Cart: Zustand-backed, qty steppers, running total.
Checkout: cash/credit choice, writes `sales`+`sale_items`, deducts stock via
FEFO with spill-over, writes `inventory_movements`, updates the cash drawer.
Discount support (percentage/flat) per line item, resolved before save.

## PURCHASE (P1 for the FULL supplier-invoice system — Beta ships manual
## batch entry via Add Medicine instead, see Volume 0 Day 8)
Suppliers (name/phone/address/email/contact_person) → Purchase creation
(invoice_no auto-generated, line items create/update batches) → COD pays cash
immediately, credit updates the supplier payable only.

## REPORTS
Sales History, Report (date-range totals), Monthly Report, Data Export. All
read-only aggregations over local SQLite — no network dependency.

## CUSTOMER
Name/phone/address/notes. Credit ledger view per customer. A sale can attach an
existing or new customer; credit sales create a `credits` row; collections
reduce the balance and add to the cash drawer.

## SUPPLIER
See PURCHASE above — Suppliers is the parent entity purchases attach to, with
its own detail view showing purchase history and outstanding payables.

## NOTIFICATION (P1 — post-beta fast-follow)
Local, offline-capable: low-stock (threshold crossing, de-duplicated), expiry
(configurable window), 8 PM owner-only cash-in-drawer summary. Notification
Center: history list, unread count, severity styling (info/warning/critical).

## SETTINGS
Shop profile, security (change own PIN — P0; backup key restore-on-new-phone
is P1), language toggle,
plan/billing entry point (PlanBadge, links to Plans screen).

## SUBSCRIPTION (P1 — entire feature is post-beta per Volume 0's scope lock)
Free/Pro/Ultra gating via `PremiumGate` + a `usePlan` hook reading the cached
`shops.plan` (fast path) while `subscriptions` is the billing source
of truth. 14-day trial unlocks everything, shown as "Trial" not "Ultra". Limits
enforced at creation time with an upgrade prompt, never a crash.

## OFFLINE
The default mode, not a fallback. Every screen above must be fully usable with
zero network. The only thing that changes when offline is that the sync_queue
grows instead of draining — nothing in the UI should block, spin, or degrade.

## ERROR HANDLING
- Zod validation errors: inline, specific, in Bangla-first copy.
- Scan-not-found: a calm message, never a crash.
- Sync failures (P0 from Day 13 — Beta ships with last-write-wins retry/backoff;
  the fuller conflict_queue UI is P1): silent retry with backoff; surfaced to the owner only
  if genuinely stuck (a notification, not a blocking modal).
- Every `try/catch` around a DB write must actually handle the error — no empty
  catch blocks that swallow failures silently (a real bug caught and fixed
  earlier in this project's history; don't reintroduce it).
