# MUTHOY POS — AI ENGINEERING PLAYBOOK
## VOLUME 11 — Post-Beta (P1/P2) Advanced Prompt Library
### Extends Volume 0's 15-day Beta sprint with a numbered continuation
### (Days 16-25) for every P1 feature, plus P2 prompts with no committed
### timeline. Same 7-field format as Volume 6. Does not change or redesign
### Volume 0 — Beta stays exactly Days 1-15 as already defined.

---

## WHEN YOU GET FULL PROTOTYPE PARITY — the direct answer

Beta (end of Day 15) does NOT show you everything the original `apps/
prototype-web` has — it deliberately covers only the P0 subset (roughly 24 of
the prototype's 39 screens/flows). **Full parity with the complete prototype
— every one of the 39 screens, matching functionality end to end — is reached
at the end of Day 25, immediately after running the Multi-Shop Management
Prompt (the last prompt in this volume).**

Here's the exact mapping so it's not a vague claim:
```
P0 (Days 1-15) already covers: Registration, PIN Setup/Login, RoleSelect,
  StaffLogin, OTPVerification, MorningDashboard, SaleEntry, Cart, Checkout,
  Inventory, AddMedicine, ExpiryManagement, CreditSales,
  CustomerCreditDetail, CashSummary, EndOfDay, ExpenseTracking, SalesHistory
  (basic), basic StaffManagement, StaffHome, StaffSalesView, Settings (basic),
  NotFound — 22 of 39.

P1 (Days 16-25, this volume) adds the rest: OCRScan (Day 17), Suppliers +
  SupplierDetail + SupplierInvoices + SupplierInvoiceCreate +
  SupplierInvoiceDetail (Day 19), full StaffManagement matrix (Day 20),
  Plans + PlanPayment + PlanSuccess (Day 21), NotificationCenter (Day 18),
  MultiShopManagement (Day 25), MonthlyReport + DataExport +
  PrinterSettings + the richer Report screen (Day 24) — 17 more, reaching 39/39.
```
So: **Day 15 = Beta, a real working subset. Day 25 = full prototype parity.**
Everything after Day 25 in the P2 list goes BEYOND what the original
prototype ever had — those are genuinely new capabilities, not parity work.

Two honest caveats: this assumes each P1 day lands roughly on schedule, which
is less certain than the Beta sprint since P1 hasn't been pressure-tested the
way Volume 0 was. Days 16 (sync delta-merge) and 21 (real payment webhooks)
are the most likely to run long — budget slack there specifically, the same
way Volume 0 flagged Days 7/12/13 as its highest-risk days.

---

## THE P1 ROADMAP (Days 16-25 — numbering added here, not in Volume 0)
```
Day 16  Sync delta-merge + conflict_queue UI [HARD SPOT — do this FIRST,
        before any multi-device pilot, per Volume 0's explicit risk note]
Day 17  OCR + Barcode scanning (ML Kit, both screens' contexts)
Day 18  Notification system (low-stock, expiry, 8PM summary, Notif. Center)
Day 19  Full Supplier & Purchase-invoice system
Day 20  Full Owner/Manager/Staff permission matrix
Day 21  Subscription & payments (Free/Pro/Ultra gating, SSLCommerz/bKash)
Day 22  Full Admin Panel — analytics & pharmacy management
Day 23  Full Admin Panel — shop map, subscription mgmt, role mgmt
Day 24  Reports polish (rich Report, MonthlyReport, DataExport, PrinterSettings)
Day 25  Multi-shop management  ← FULL PROTOTYPE PARITY REACHED HERE
```

---

## 22. SYNC DELTA-MERGE & CONFLICT QUEUE PROMPT

**Purpose:** Upgrade Beta's simplified last-write-wins sync to real stock-
quantity delta merging, and surface true conflicts to the owner instead of
silently picking a winner.
**When to Use:** Day 16 — FIRST thing after Beta, before anything else in
this volume, and strictly before any multi-device pilot begins. **Tool:
Claude Code** (repo-wide — touches db/, sync/, and the conflict UI at once).
**Prompt:**
> "Our Beta sync engine (sync_queue → Edge Function, built Day 13) currently
> resolves ALL conflicts with last-write-wins, including stock quantity —
> this was an accepted Beta-only risk. Upgrade it now: stock-quantity fields
> on `batches`/`inventory_movements` must merge as DELTAS (sum the net change
> from each device, never overwrite one device's number with another's).
> Everything else stays last-write-wins by `updated_at`. Any conflict that
> can't be resolved automatically (e.g. the same batch's price edited
> differently on two devices) goes into the `conflict_queue` table and
> surfaces as a simple resolution UI for the owner. Plan first, and show me
> exactly which fields will use delta-merge vs last-write-wins before
> building it."

**Expected Output:** stock quantities never lose data across two-device
offline edits; genuine conflicts appear in a resolvable queue instead of
silently picking one side.

**Validation:** run two phones offline, each selling from the same shared
batch, sync both — confirm the resulting stock is `starting − sale1 − sale2`,
not just one sale's deduction.

**Human Review:** this is a hard spot — do not sign off on "it looks right."
Force a genuine price-conflict (edit the same batch's price differently on
two offline devices) and confirm it lands in `conflict_queue`, not silently
resolved.

**Recovery Prompt:** "Two-device stock sync lost data in this exact scenario
[describe]. Explain the root cause in the delta-merge logic before patching
it."

---

## 23. OCR + BARCODE SCANNING PROMPT (combined — one ML Kit session)

**Purpose:** Add camera-based lookup and assisted entry, replacing Beta's
manual-search-only workflow.
**When to Use:** Day 17. **Tool: Cursor Pro.**
**Prompt:**
> "Integrate ML Kit — one engine, two APIs (barcode scanning AND text
> recognition), not two separate libraries. On Sale Entry: tap Scan opens the
> camera, reads a barcode OR the medicine name off a strip in the same
> session, matches against local inventory — found, add to cart at the
> active batch price; not found, a clear message, never a crash. On Add
> Medicine: tap Scan prefills form fields but the user MUST confirm before
> saving — never auto-commit a scanned value. Confirm this needs an Expo
> development build, not Expo Go. Plan first."

**Expected Output:** working barcode + text scanning in both contexts, one
camera session, no separate scan-mode toggle needed.

**Validation:** scan a real barcode → correct item added to cart; scan
unrecognized text → clear not-found message, no crash.

**Human Review:** test with 2-3 real physical medicine boxes in imperfect
lighting, not just clean printed test barcodes.

**Recovery Prompt:** "A misread on Add Medicine got saved without
confirmation. Add the confirmation step back — it must never be skippable."

---

## 24. NOTIFICATION SYSTEM PROMPT

**Purpose:** Build local, offline-capable alerts and the Notification Center.
**When to Use:** Day 18. **Tool: Cursor Pro.**
**Prompt:**
> "Build low-stock alerts (fires once per threshold crossing, never re-fires
> on every screen open), expiry alerts (using the Day 9 Expiry Management
> data), the 8PM owner-only 'cash in drawer now' notification, and a
> Notification Center screen with unread count and severity styling
> (info/warning/critical). All must work fully offline. Plan first."

**Expected Output:** working local alerts and a notification history screen.

**Validation:** force a low-stock condition once, reopen the app 5 times,
confirm it fired exactly once, not five times.

**Human Review:** open the Notification Center and confirm severity styling
is visually distinct at a glance (info vs warning vs critical).

**Recovery Prompt:** "The low-stock alert re-fires every app open. Add
de-duplication keyed to the threshold-crossing event, not the screen visit."

---

## 25. FULL SUPPLIER & PURCHASE-INVOICE SYSTEM PROMPT

**Purpose:** Replace Beta's manual Add-Medicine stock-in with a proper
supplier/invoice workflow.
**When to Use:** Day 19. **Tool: Cursor Pro.**
**Prompt:**
> "Build the full Suppliers directory (name, phone, address, email,
> contact_person, purchase history, outstanding payable total) and the
> Purchase-invoice flow: invoice_no auto-generated (PUR-YYYY-NNNNNN), line
> items that create/update batches, COD purchases reduce cash immediately,
> credit purchases only update the supplier payable. This supersedes (does
> not remove) Add Medicine's manual batch entry from Day 8 — both remain
> valid stock-in paths. Plan first."

**Expected Output:** a full supplier/purchase-invoice system tied correctly
to cash and payables.

**Validation:** one COD and one credit purchase — confirm cash drops only
for the COD one; the credit one shows as a supplier payable.

**Human Review:** hand-verify one supplier's payable total against their
actual unpaid purchase history.

**Recovery Prompt:** "A credit purchase incorrectly reduced cash immediately.
Fix the payment_terms branching so credit never touches the drawer at entry."

---

## 26. FULL STAFF PERMISSION MATRIX PROMPT

**Purpose:** Upgrade Beta's simple 2-role check to the full Owner/Manager/
Staff matrix with owner-configurable Manager permissions.
**When to Use:** Day 20. **Tool: Cursor Pro.**
**Prompt:**
> "Upgrade the 2-role permission check from Day 11 to the full 3-role
> matrix: Owner (everything), Manager (owner-configurable per-permission
> toggles — discount, void/refund, expenses, reports), Staff (sales/scan/
> inventory-view only, unchanged from Beta). Store each Manager's specific
> permissions per shop. Plan first."

**Expected Output:** a working Manager role with owner-toggleable
permissions, without breaking existing Owner/Staff behavior.

**Validation:** toggle one Manager permission off, confirm that specific
Manager is blocked from that one action while retaining the rest.

**Human Review:** confirm existing Staff-role users are unaffected by this
change — re-run Day 11's original validation checklist.

**Recovery Prompt:** "Toggling a Manager permission also affected [unrelated
role/user]. Scope the permission check strictly to the role_id it targets."

---

## 27. SUBSCRIPTION & PAYMENTS PROMPT

**Purpose:** Build real Free/Pro/Ultra gating and payment processing.
**When to Use:** Day 21. **Tool: Cursor Pro for gating/UI; the payment
webhook specifically benefits from Claude Code (server-side, security-
sensitive).**
**Prompt:**
> "Wire PremiumGate + a usePlan hook to the `subscriptions` table (cached on
> `shops.plan` for fast reads). Enforce limits at creation time — Free: 1
> store/1 staff; Pro ৳399/mo: max 2 stores, max 3 staff/store; Ultra ৳499/mo:
> unlimited — with an upgrade prompt, never a crash, when a limit is hit.
> 14-day trial unlocks everything, badge shows 'Trial' not 'Ultra'. Build
> /subscribe with SSLCommerz + direct bKash, and a payment webhook Edge
> Function that verifies the provider's signature before writing a
> subscriptions row — the phone must NEVER self-declare its own premium
> status. On trial-end/downgrade, archive extras (first-created stays
> active) rather than deleting anything. Plan first, flag the webhook
> signature verification specifically before building it."

**Expected Output:** working plan gating and a real payment flow.

**Validation:** hit a Pro limit (3rd staff on a 2nd store) — confirm an
upgrade prompt, not a crash; complete a sandbox payment, confirm the plan
updates only after the webhook confirms it, not before.

**Human Review:** attempt to manually flip a local plan flag without a real
payment — confirm it has no effect, since the phone never self-declares.

**Recovery Prompt:** "The app unlocked premium without a confirmed webhook
payment. This is a security gap — trace exactly where the plan got set and
remove any client-side path to setting it."

---

## 28. FULL ADMIN PANEL — ANALYTICS & PHARMACY MANAGEMENT PROMPT

**Purpose:** Expand Day 14's 2-page Basic Admin into real analytics and a
searchable pharmacy directory.
**When to Use:** Day 22. **Tool: Cursor Pro.**
**Prompt:**
> "Expand the Basic Admin Panel (Day 14): add a Dashboard with active-today
> count, MRR, trial-vs-paid split, recent signups; an Analytics page
> (Recharts time-series: new signups, daily active shops, sales volume,
> aggregated — never per-shop financial detail unless drilled into one
> shop); and a Pharmacy Management page (searchable/filterable by district/
> plan/activity, row click → drill-down: profile, plan status, recent
> activity, support notes). Service-role key server-side only, as before.
> Plan first."

**Expected Output:** a real analytics dashboard and searchable pharmacy list.

**Validation:** confirm the service-role key still never appears in any
browser network request (check devtools directly, every time this file
grows).

**Human Review:** spot-check one chart's numbers against a manual count from
the database.

**Recovery Prompt:** "This chart shows [wrong number]. Trace the aggregation
query and confirm it's not double-counting or missing a shop filter."

---

## 29. FULL ADMIN PANEL — MAP, SUBSCRIPTION MGMT & ROLES PROMPT

**Purpose:** Add the geo shop map and subscription/role administration.
**When to Use:** Day 23. **Tool: Cursor Pro.**
**Prompt:**
> "Add to the Admin Panel: a Leaflet map plotting shops by their captured
> latitude/longitude, marker color = plan tier, click → drill-down; a
> Subscriptions page listing by status (trialing/active/past_due/grace/
> canceled/expired) with due-soon view and manual override actions (extend
> trial, force a status change); an Audit Logs read-only view per shop; and
> simple Role Management for admin-panel users themselves (super-admin vs
> support-read-only), separate from the pharmacy-side Owner/Manager/Staff
> roles. Plan first."

**Expected Output:** a working shop map and subscription/role admin tools.

**Validation:** a shop with a captured location appears correctly plotted;
a manual trial extension immediately reflects in that shop's mobile app on
next sync.

**Human Review:** confirm an admin action (e.g. toggle premium) is itself
logged somewhere traceable — admin actions on other people's data deserve
the same accountability as the pharmacy-side audit log.

**Recovery Prompt:** "An admin override didn't propagate to the mobile app
after sync. Trace whether the override actually wrote to `subscriptions` or
only to a cached admin-side value."

---

## 30. REPORTS POLISH PROMPT

**Purpose:** Build the richer Report screen (with charts, from the original
prototype design) plus Monthly Report, Data Export, and Printer Settings.
**When to Use:** Day 24. **Tool: Cursor Pro.**
**Prompt:**
> "Build the full Report screen matching the prototype's design: a gradient
> hero summary, a Recharts area chart of sales over the selected range, and
> a payment-breakdown donut (cash vs credit) — see apps/prototype-web's
> Report entry in SCREENS.md for the exact layout reference (UI/UX only, per
> the Prototype Rule). Build Monthly Report (month-over-month totals), Data
> Export (CSV of sales/inventory), and Printer Settings (Bluetooth receipt
> printer pairing — this can be a stub if no printer hardware is available
> to test against yet). Plan first."

**Expected Output:** working rich reports and an export path.

**Validation:** the Report screen's chart totals match a hand sum of the
same date range's sales.

**Human Review:** confirm nothing from `apps/prototype-web`'s actual code
was copied in — layout/flow only, per the Prototype Rule.

**Recovery Prompt:** "This report's chart doesn't match a manual total for
[date range]. Check the date-range boundary logic first — that's the most
common source of off-by-one report bugs."

---

## 31. MULTI-SHOP MANAGEMENT PROMPT

**Purpose:** Let one owner hold and switch between multiple shops, per their
plan's limit. **This is the last P1 prompt — full prototype parity is
reached once this ships.**
**When to Use:** Day 25. **Tool: Cursor Pro.**
**Prompt:**
> "Build Multi-Shop Management: an owner on Pro (max 2) or Ultra (unlimited)
> can create additional shops and switch the active shop from a single
> screen. Enforce the plan's store limit at creation time with an upgrade
> prompt. Switching shops must reload EVERY shop-scoped screen (staff,
> inventory, sales, cash drawer, audit log) to that shop's data only — no
> bleed-across, matching the isolation rules already enforced elsewhere in
> the app. Plan first."

**Expected Output:** working multi-shop creation and switching.

**Validation:** create a second shop, add different staff/stock to each,
switch between them, confirm each screen shows ONLY the active shop's data
— zero cross-shop bleed anywhere.

**Human Review:** this repeats a class of bug found multiple times earlier
in this project (shop-isolation leaks) — test deliberately, don't assume
it's fine because it looks fine.

**Recovery Prompt:** "Switching shops didn't refresh [screen] — it's still
showing the previous shop's data. Add that screen to the shop-switch reload
listener."

---

## P2 PROMPTS — no committed timeline (build only when there's real demand)

## 32. DISCOUNT RULE AUTOMATION ENGINE PROMPT

**Purpose:** Automate discount application (e.g. "10% off anything expiring
within 30 days") instead of manual per-line discounts.
**When to Use:** P2 — only once manual discounts (already P0-capable via
`sale_items.discount_type/value`) prove insufficient in real pilot use.
**Tool: Cursor Pro.**
**Prompt:**
> "Design and build a discount RULES table (condition → discount) that
> auto-suggests a discount at Sale Entry/Checkout time — e.g. batches within
> N days of expiry get an automatic X% suggestion, which the user can accept
> or override. Never auto-apply without the user seeing and confirming it.
> Plan first."

**Expected Output:** a working, owner-configurable auto-discount suggestion
system.

**Validation:** create a rule, confirm it suggests (not auto-applies) at the
right moment.

**Human Review:** confirm the user can always override a suggested discount.

**Recovery Prompt:** "A discount rule applied without user confirmation.
This must always be a suggestion, never automatic — fix the flow."

---

## 33. PUBLIC API / WEB PORTAL / VENDOR PORTAL FOUNDATION PROMPT

**Purpose:** Lay the groundwork for external integrations once real demand
exists (per Volume 10's Future SaaS Direction).
**When to Use:** P2 — only when a concrete external need appears (e.g. an
accounting integration a pharmacy specifically wants). Not speculative work.
**Tool: Claude Code** (new architectural surface, repo-wide).
**Prompt:**
> "We have a real need: [describe the specific external integration need].
> Design a minimally-scoped, authenticated API surface over our existing
> Supabase schema that satisfies ONLY this need — do not build a
> general-purpose public API speculatively. Plan first, and justify why each
> exposed endpoint is necessary before building it."

**Expected Output:** a narrowly-scoped, real-need-driven API, not a
speculative general one.

**Validation:** the API exposes only what the stated need requires — audit
the endpoint list against the original need statement.

**Human Review:** question any endpoint that goes beyond the stated need
before approving it.

**Recovery Prompt:** "This API exposes more than the stated need requires.
Narrow it back down."

---

## 34. ADVANCED ANALYTICS PROMPT

**Purpose:** Deeper platform-level analytics beyond Day 22's basic charts.
**When to Use:** P2 — once there's enough real pilot data (post-500-shops,
per Volume 10's roadmap) for advanced analytics to be meaningful rather than
noise on a small sample.
**Tool: Cursor Pro.**
**Prompt:**
> "Extend the Admin Panel's Analytics page with [specific advanced metric,
> e.g. cohort retention curves, district-level growth comparison]. Use
> materialized views for any heavy aggregate query rather than live
> computation, per muthoy-system-design.md's scaling guidance. Plan first."

**Expected Output:** a working advanced-analytics view that stays fast as
shop count grows.

**Validation:** confirm the query doesn't do a full-table scan — check the
query plan.

**Human Review:** confirm the metric is actually meaningful at current shop
count, not premature.

**Recovery Prompt:** "This analytics query is slow at our current shop
count. Move it to a materialized view refreshed on a schedule instead of
computing live."
