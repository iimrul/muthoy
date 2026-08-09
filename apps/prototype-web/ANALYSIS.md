# ANALYSIS.md — Known Issues Already Found In This Prototype
### Read this BEFORE rebuilding any screen it mentions. Every item here was a
### real bug or gap discovered and fixed during prototype iteration — carrying
### the LESSON forward into the native build matters more than the old fix
### itself, since the native code is written fresh.

## Correctness bugs (money/stock — highest severity, apply the fix by design
## from day one in the native build, don't wait to discover these again)

**FEFO staleness bug.** The original sort used a STORED day-count (`expiryDays`)
frozen at stock-entry time, instead of recomputing from the real `expiryDate`.
This silently broke "sell the earliest-expiring batch first" over time.
→ Native rule: always compute expiry days from the real date at read time,
never trust a stored number. See DEVELOPMENT_RULES.md / domain/fefo.ts.

**Inventory edit silently failing.** The batch data model is `medicine.batches[]`,
but the edit-save handlers wrote to phantom top-level fields the display never
read from — edits appeared to succeed but never showed.
→ Native rule: batch edits must write inside the actual batches array/table row,
matched by medicine id + batch number, never by a positional/derived id.

**Multi-shop data leaking across shops.** Two separate bugs: (1) a cache layer
wasn't shop-aware, so switching shops showed stale data; (2) the audit-log
context used raw storage instead of the shop-scoped storage layer, so staff
sales/activity bled across every shop on the device.
→ Native rule: EVERY scoped table read/write goes through the shop-scoped data
layer (`db/`) with `shop_id` in the query — no exceptions, no "just this once"
raw access, including for audit logs.

**Owner/shop isolation leak.** A hardcoded fallback shop id meant every first-time
registration on a device landed in the SAME namespace — a second owner registering
on the same device saw the first owner's staff and data.
→ Native rule: every shop gets a genuinely unique id at creation; a shop record
is tied to `owner_id`; login resolves the correct shop for that specific owner.
See schema.ts's `shops.owner_id` and `users` design.

**Cash drawer bugs.** Opening cash sometimes inherited yesterday's closing value
instead of defaulting to 0; the "new day" popup triggered on a proxy condition
("opening cash not set today") instead of a genuine midnight rollover.
→ Native rule: opening cash always defaults to 0, always set explicitly by the
user, and the day-rollover check compares real dates, not a proxy flag. See
Volume 3's cash formula documentation.

## Design/consistency issues (lower severity, fix during normal build, not urgent)
- Headers were inconsistent across ~6 different styles before being standardized
  to one pattern (translucent soft-green, back chevron, centered title, language
  toggle) — apply the standard from the FIRST screen built natively, don't
  standardize later.
- Fonts were a mix of hardcoded strings and CSS variables, and money/non-money
  numbers weren't consistently split between DM Mono and Plus Jakarta Sans —
  apply the font-variable rule from day one; see TECH_STACK.md.
- PIN entry originally used plain text-input fields; redesigned to dots + a
  custom numeric keypad — build the native version this way from the start,
  never as text inputs.

## Genuinely missing features (not bugs — never existed in the prototype)
- **Shop location capture** — no GPS logic exists anywhere in the prototype
  (it can't — a web prototype has no reliable native GPS). This is real Day-13-
  adjacent native work (`expo-location`), captured silently post-login per
  Volume 4, never as a registration field.
- **Owner/staff PIN change after initial setup** — the prototype had no way to
  change a PIN once set. Build this from day one (Volume 6's Authentication
  Prompt covers it) rather than retrofitting it.
- **Real payment/subscription enforcement** — the prototype's Plans screens are
  visual only; no backend exists to actually gate anything. This is correctly
  deferred to P1, post-beta (Volume 5, subscriptions table).

## Schema gaps closed since the prototype was designed (already reflected in
## schema.ts / supabase-schema.sql — just noting WHY they exist)
- No `customers` table originally (credit/sales referenced a bare id with no
  actual customer record) — added.
- No sales/purchase returns tracking — added (`sales_returns`, `purchase_returns`).
- No human-readable invoice numbering (only internal UUIDs) — added (`invoice_no`).
- Supplier record was name+phone only — enriched (address/email/contact_person).
- Nothing prevented a duplicate batch number for one medicine — added a unique
  constraint; this is a correctness fix, not just a schema nicety (a duplicate
  batch number would corrupt FEFO's "one identity per batch" assumption).
- No dedicated `subscriptions` table (plan lived only as a flat field) — added,
  with the flat field kept as a fast-read cache, not the source of truth.
- No dedicated `expenses` table, no discount fields on sale line items, a
  narrow payment-method list, no notification severity, no
  opened_by/closed_by split on the cash drawer, and inconsistent/undefined
  `ON DELETE` behavior on foreign keys — all closed; see schema.ts /
  supabase-schema.sql directly for the final shape.

## Scanning architecture correction
An earlier plan split barcode scanning (a separate camera library) from OCR
(ML Kit). The correct design uses ML Kit for BOTH — one on-device engine, two
APIs within it (barcode + text recognition) — not two separate libraries. See
TECH_STACK.md and Volume 4's OCR/Barcode sections.
