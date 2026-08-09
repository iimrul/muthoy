# MUTHOY POS — AI ENGINEERING PLAYBOOK
## VOLUME 0 — 15-Day Execution Roadmap & Sprint Management

## BETA DEFINITION (governs everything in this volume)
Beta Launch = a complete working MVP with BOTH offline AND online functionality:
SQLite offline-first architecture, Sync Queue, Supabase backend, RLS, cloud
backup/synchronization, a Basic Admin Panel, real-device testing, and critical
pharmacy workflows working end-to-end. Cloud sync, RLS, and the Basic Admin
Panel are NOT post-beta — they are built within these 15 days.

## SCOPE CALIBRATION — how 15 days at 8-10 hrs/day fits ALL of this
Fitting offline core + Supabase + RLS + sync + a basic admin panel into 15 days
is only achievable by being ruthless about what's P0. This is de-risked the
same way as before — the full schema, architecture, and brand system are
already finalized (schema.ts, supabase-schema.sql, muthoy-architecture-v3.md,
muthoy-system-design.md), so Cursor Pro/Claude Code are implementing a
finished spec, not discovering one — but it ALSO requires deferring every
feature that isn't strictly required for a critical pharmacy workflow to run
end-to-end, online and offline. The P0/P1/P2 scope lock below is what makes
that deferral disciplined instead of accidental.

---

## THE P0 / P1 / P2 SCOPE LOCK (read first, enforce every day)

**Rule: if a feature is not P0, it does not get built during these 15 days —
no exceptions, no "just this small thing." Any new request during the sprint
gets checked against this table before any code is written.**

### P0 — BETA-CRITICAL (must ship in the 15 days, no negotiation)
```
Monorepo foundation, EAS dev build
Full local SQLite schema (all 23 tables — cheap, already finalized) + WAL
FTS5 medicine search
Registration + PIN setup/login (local)
Navigation shell, standardized header, dashboard
Sale Entry + Cart with FEFO-aware pricing
Checkout + FEFO deduction + Cash Drawer + the cash formula
Basic Inventory + Add Medicine (manual batch entry)
Credit Sales + Customers + Expiry Management
Cash Summary + Expenses + End of Day close
Basic Staff (Owner + Staff roles, PIN-based, simple attribution)
Supabase schema deployed + RLS policies live and verified by hand
Sync Queue: outbox writer + push/pull for P0 tables + real phone OTP
Basic Admin Panel: pharmacy list + simple aggregate dashboard (service-role,
  server-side only)
Real-device testing throughout; full offline+online loop verified Day 15
```

### P1 — POST-BETA FAST-FOLLOW (built immediately after Beta, NOT in the 15 days)
```
OCR + Barcode scanning (ML Kit) — manual entry/search covers Beta
Notifications (low-stock, expiry, 8PM summary, Notification Center)
Full Supplier/Purchase-invoice system (invoice numbering, supplier ledger,
  COD/credit distinction) — Add Medicine's manual batch entry covers Beta
Full Owner/Manager/Staff 3-role permission matrix (Manager nuance)
Full sync conflict resolution: stock-quantity delta-merge, conflict_queue UI
  (Beta ships with straightforward last-write-wins — see the explicit risk
  note under Day 13)
Subscription/billing/payments (Free/Pro/Ultra gating, SSLCommerz/bKash)
Full Admin Panel (MRR dashboard, Leaflet shop map, subscription management,
  role management, Recharts analytics)
Reports polish (Monthly Report, Data Export, Printer Settings)
Multi-shop management (one owner, multiple shops)
```

### P2 — LATER (no committed timeline)
```
Discount-rule automation engine
Public API, web portal, vendor portal (see Volume 10)
Advanced analytics
```

### The one explicit risk this lock accepts, stated plainly
Beta's sync engine (Day 13) uses last-write-wins for ALL fields, including
stock quantity, instead of the fuller delta-merge design. This is safe for the
realistic beta scenario (one phone per pilot shop) but is a genuine risk if two
devices ever edit the same shop's stock offline at the same time before Beta's
sync engine is upgraded. Delta-merge and the conflict_queue UI are P1,
scheduled immediately after Beta — do not run a multi-device pilot before that
upgrade ships.

---

## PROJECT TIMELINE

### Overall 15-Day Roadmap
```
Days 1-3   Foundation + local database + search
Days 4-5   Auth (local) + navigation shell
Days 6-7   Sale Entry + Checkout (the core transaction)
Days 8-10  Inventory + Credit/Expiry + Cash/EndOfDay
Day 11     Basic Staff & permissions
Day 12     Supabase schema + RLS (deployed and verified)
Day 13     Sync engine (P0 scope) + real phone OTP
Day 14     Basic Admin Panel
Day 15     End-to-end integration hardening + Beta Readiness Checklist
```

### Sprint Calendar
Same daily rhythm as before: morning assign, midday review/iterate, afternoon
test on a real phone, evening commit + docs + tomorrow's plan.

### Milestones
- **End of Day 3:** app boots, database complete, search works offline.
- **End of Day 7:** a full sale works offline with correct FEFO and cash math.
- **End of Day 11:** every offline P0 workflow works end to end.
- **End of Day 13:** a sale made offline correctly appears in Supabase after
  sync, and RLS is proven to block cross-shop access.
- **End of Day 15:** BETA — the full offline+online loop, Basic Admin Panel,
  real-device tested, zero seed data.

### Beta Launch Timeline
Day 15 = the actual Beta build, per the Beta Definition above. Real pharmacy
pilot onboarding (10-50 shops, Volume 9) begins once Day 15's build passes its
own checklist AND the P1 fast-follow items you judge safety-critical for a
multi-device pilot (at minimum: sync delta-merge, per the risk note above) are
in place.

### Critical Path
Local schema (Day 2) → Sale/Checkout (Days 6-7) → Cash correctness (Day 10) →
RLS verified (Day 12) → sync proven end-to-end (Day 13) is the critical path.
Everything else can flex; these five cannot slip.

### Buffer Days
None built in — 15 days is tight by design. If a day overruns, the recovery
move is ALWAYS: cut the day's P0 item down to its leanest correct version
(never cut a P0 item entirely, and never quietly pull in a P1 item to "make
progress feel better").

### Risk Management Timeline
```
Highest risk: Day 7 (Checkout + FEFO + cash) — money/stock correctness proven
  for the first time.
Second highest: Day 12-13 (RLS + sync) — the classic "hard spot": rushed RLS
  or sync is a data-isolation or data-loss risk, not just a schedule risk.
  Budget extra review time here specifically, even if it eats into Day 14's
  admin-panel scope (Basic Admin can be trimmed further before RLS/sync
  correctness is compromised).
Mitigation: Day 1's EAS dev build is set up specifically so native-module
  surprises are caught early, not saved for the end.
```

---

## DAY-BY-DAY DEVELOPMENT PLAN

Each day: ~1 hr prep/review, ~4-5 hrs building, ~2 hrs testing on a real
device, ~1 hr docs/commit/planning tomorrow.

### WHICH AI TOOL, EACH DAY
Per the AI tool roles defined in Volume 2/CLAUDE.md: use **Cursor Pro** for the
actual interactive implementation/debugging on Days 1-11 and 14 (in-IDE, file
by file). Reach for **Claude Code** on Days 2, 12, and 13 specifically —
schema implementation, RLS policy generation, and the sync engine are
repo-wide, architecture-aware tasks that benefit from an agent working across
many files at once, not one-file-at-a-time IDE editing. Use **Claude Chat**
every morning to plan the day and generate/refine that day's exact prompt
before opening Cursor Pro or Claude Code.

---

### DAY 1 — Project Foundation
**Objective:** A running, installable app shell with the design system wired in.

**Preparation Checklist**
- [ ] Read CLAUDE.md, PROJECT_CONTEXT.md, TECH_STACK.md, DEVELOPMENT_RULES.md fully
- [ ] Have schema.ts and the brand tokens ready to reference
- [ ] Google account + Expo account ready for EAS

**AI Prompt (Cursor Pro)**
> "Read CLAUDE.md, PROJECT_CONTEXT.md, TECH_STACK.md, and DEVELOPMENT_RULES.md
> fully. Plan Day 1: initialize the pnpm + Turborepo workspace exactly per the
> monorepo structure, then scaffold apps/mobile (Expo SDK 52 + TypeScript +
> Expo Router + NativeWind with our brand tokens), an empty apps/admin
> placeholder, apps/prototype-web (copy in the existing Figma Make export —
> reference-only, see the Prototype Rule — do not modify it), backend/supabase
> (empty for now), and packages/ui, types, utils, validation, constants,
> config as empty scaffolds. Set up .github/workflows, .vscode, git with
> .gitignore, and an EAS development build I can install on my Android phone.
> Show me your plan and wait for my approval before coding."

**Expected Output:** a bootable Expo app; NativeWind renders brand colors and fonts
correctly; git repo with an initial commit; an EAS dev build link.

**Validation Checklist**
- [ ] `npx expo start` runs with no errors
- [ ] A test screen shows Hind Siliguri and Plus Jakarta Sans correctly
- [ ] Folder structure matches Volume 2 exactly

**Human Review Checklist**
- [ ] Open 3 random generated files, ask Cursor to explain each in plain English
- [ ] Confirm no placeholder/dummy business logic was invented

**Testing Checklist**
- [ ] Install the EAS dev build on a real Android phone, app opens

**Git Commit Message:** `chore: project foundation — Expo Router, NativeWind, EAS dev build`

**Documentation Update:** confirm DECISIONS.md exists in the repo root.

**End-of-Day Deliverables:** installable app shell, git history started.

---

### DAY 2 — Local Database (full schema — repo-wide task)
**Objective:** The full local schema exists, migrated, and readable/writable.

**Preparation Checklist**
- [ ] Have schema.ts (already built) ready to hand over as-is
- [ ] Confirm yesterday's EAS build still installs

**AI Prompt (Claude Code — repo-wide, architecture-aware schema implementation)**
> "Here is our finalized Drizzle schema (paste schema.ts in full). Implement it
> exactly via Drizzle + expo-sqlite with WAL mode at apps/mobile/db/schema.ts.
> Do not modify field names, types, or constraints. Generate the first
> migration. Write a DB init module that runs migrations safely on every app
> start. Also scaffold the sync_queue table structure now, even though the
> sync engine's logic is built Day 13. Plan first."

**Expected Output:** SQLite initializes with all 23 tables; migration file
generated; DB init runs idempotently.

**Validation Checklist**
- [ ] Every table from schema.ts exists with correct columns
- [ ] Foreign key `onDelete` behaviors are present (spot-check 3 tables)
- [ ] App reopens without re-running migrations destructively

**Human Review Checklist**
- [ ] Ask: "Does this match schema.ts exactly? Show me any place it doesn't."

**Testing Checklist**
- [ ] Write a test row to `medicines`, read it back, in airplane mode

**Git Commit Message:** `feat(db): local SQLite schema + Drizzle migrations`

**Documentation Update:** log the migration filename/version in DECISIONS.md.

**End-of-Day Deliverables:** full local database, verified offline read/write.

---

### DAY 3 — Search (FTS5) + State Setup
**Objective:** Instant medicine search; Zustand/MMKV wired for session/cart state.

**AI Prompt (Cursor Pro)**
> "Add a SQLite FTS5 virtual table over medicines(name, generic) with triggers to
> stay in sync on insert/update/delete. Write a search function using it. Then set
> up a Zustand store for cart/session/active-shop state and MMKV for PIN hash +
> session storage. Explain back to me in plain English how a screen will get its
> data, to confirm it's SQLite, not the network. Plan first."

**Expected Output:** FTS5 search returns results by partial name/generic match;
Zustand store scaffolded; MMKV wired.

**Validation Checklist**
- [ ] Search "napa" returns Napa-named entries from a seeded test set
- [ ] Search feels instant (<100ms) with 500+ dummy medicine rows

**Human Review Checklist**
- [ ] Confirm the AI's plain-English explanation shows screens reading SQLite only

**Testing Checklist**
- [ ] Search in airplane mode, multiple partial queries

**Git Commit Message:** `feat(search): FTS5 medicine search + Zustand/MMKV state`

**Documentation Update:** none beyond DECISIONS.md.

**End-of-Day Deliverables:** working instant search, state layer ready.
**MILESTONE: End of Day 3 — app boots, database complete, search works offline.**

---

### DAY 4 — Registration + PIN Setup (local)
**Objective:** A shop owner can register locally and set a PIN, matching the
approved dots+keypad design. Real Supabase OTP is wired in Day 13 — today's
registration works standalone offline first.

**AI Prompt (Cursor Pro)**
> "Build the Registration screen (shop name + phone only) and PIN Setup screen
> using the dots + custom numeric keypad pattern. Use React Hook Form + Zod for
> validation. Write to the users/shops tables via Drizzle, bcrypt-hash the PIN.
> Design the phone field so it will later gate an OTP step (Day 13) without a
> screen rebuild. Plan first."

**Expected Output:** working registration → PIN setup → creates a shop + owner user.

**Validation Checklist**
- [ ] PIN is stored hashed (inspect the DB row directly)
- [ ] Zod rejects an empty shop name / invalid phone

**Human Review Checklist**
- [ ] Ask Cursor to show you the exact bcrypt call and confirm it's not a stub

**Testing Checklist**
- [ ] Register end to end on the real phone, offline

**Git Commit Message:** `feat(auth): registration + PIN setup with bcrypt hashing`

**Documentation Update:** note the PIN hashing library choice in DECISIONS.md.

**End-of-Day Deliverables:** a shop can be created and secured with a PIN.

---

### DAY 5 — PIN Login + Navigation Shell + Dashboard
**Objective:** Full login loop; the app's main navigation and dashboard shell exist.

**AI Prompt (Cursor Pro)**
> "Build PIN Login (checks the bcrypt hash offline) and the main tab navigation
> (Expo Router) with the standardized header component applied to every screen
> except MorningDashboard and Registration. Build MorningDashboard as a shell
> showing shop name and a greeting. Plan first."

**Expected Output:** login works offline; tab navigation renders; dashboard shows
shop context.

**Validation Checklist**
- [ ] Wrong PIN is rejected with a clear message
- [ ] Correct PIN logs in, offline

**Human Review Checklist**
- [ ] Click through every nav tab, confirm the header looks identical across screens

**Testing Checklist**
- [ ] Kill and reopen the app — session persists correctly (MMKV)

**Git Commit Message:** `feat(auth): PIN login + navigation shell + dashboard`

**End-of-Day Deliverables:** full login loop, navigable app shell.

---

### DAY 6 — Sale Entry + Cart
**Objective:** Search, select, and cart medicines for sale.

**Preparation Checklist**
- [ ] Seed 20-30 realistic test medicines with multiple batches for FEFO testing

**AI Prompt (Cursor Pro)**
> "Build the Sale Entry screen: FTS5 search, results capped at 50, each result
> showing the medicine's ACTIVE batch (earliest expiry) with its price in DM
> Mono. Tapping adds to a Cart (Zustand), showing running total. Cart screen
> lists items with qty steppers. Plan first."

**Expected Output:** searchable sale flow with a working cart reflecting correct
active-batch pricing.

**Validation Checklist**
- [ ] For a medicine with 2 batches, the DISPLAYED price is the earlier-expiry
      batch's price
- [ ] Cart total updates correctly on qty change

**Human Review Checklist**
- [ ] Manually verify FEFO active-batch selection against your seeded test data

**Testing Checklist**
- [ ] Add 10 different items to cart, confirm total is arithmetically correct

**Git Commit Message:** `feat(sales): Sale Entry search + FEFO-aware Cart`

**End-of-Day Deliverables:** working sale entry and cart with correct FEFO pricing.

---

### DAY 7 — Checkout + FEFO Deduction + Cash Drawer
**Objective:** Complete a sale: deduct stock correctly, open/track the cash drawer.
**[HIGHEST RISK DAY — budget extra review time]**

**AI Prompt (Cursor Pro, or Claude Code if the domain-logic file set spans many
files and benefits from repo-wide implementation)**
> "Build Checkout: confirm cart, choose cash/credit, on confirm write a `sales`
> row + `sale_items` + deduct stock via FEFO (earliest batch first, spill to
> next when one empties) + write `inventory_movements`. Also build the Cash
> Drawer: opening cash entry (defaults to 0, never inherited), and implement
> Expected Cash = Opening + CashSales + CreditCollections − Expenses − Refunds
> − SupplierPayments − Withdrawals exactly as specified. Write UNIT TESTS for
> both FEFO deduction and the cash formula before considering this done. Plan
> first, flag any ambiguity before coding."

**Expected Output:** a full sale deducts correctly, cash drawer reflects it
accurately, tests pass.

**Validation Checklist**
- [ ] Sell across a batch boundary — spill-over confirmed via `inventory_movements`
- [ ] Cash formula unit tests pass
- [ ] Opening cash defaults to 0, never auto-fills

**Human Review Checklist**
- [ ] Run the unit tests yourself and read the actual pass/fail output
- [ ] Manually hand-calculate expected cash for 5 test transactions, compare

**Testing Checklist**
- [ ] Full offline sale-to-cash-drawer flow, 10 sales, hand-verify the drawer total

**Git Commit Message:** `feat(sales): checkout, FEFO deduction, cash drawer + formula tests`

**Documentation Update:** log the test results in DECISIONS.md.

**End-of-Day Deliverables:** provably correct sale + FEFO + cash math.
**MILESTONE: End of Day 7 — a full sale works offline with correct FEFO and cash.**

---

### DAY 8 — Inventory + Add Medicine (P0 minimal stock-in)
**Objective:** Manual stock management: view, add, edit medicines/batches.
Full supplier/purchase-invoice tracking is P1 — today covers only what's
needed for stock to exist and be sellable.

**AI Prompt (Cursor Pro)**
> "Build Inventory (list medicines with current stock, batch count, active-batch
> expiry) and Add Medicine (React Hook Form + Zod: name, generic, manufacturer,
> strength, category, unit_of_measure, requires_prescription, threshold, and first
> batch: batch_no, expiry, qty, purchase/sale price). Enforce the
> UNIQUE(shop_id, medicine_id, batch_no) constraint with a friendly error, not a
> crash. Plan first."

**Expected Output:** working inventory list + add/edit medicine and batch flow.

**Validation Checklist**
- [ ] Duplicate batch number for the same medicine shows a friendly error
- [ ] New medicine appears immediately in Sale Entry search

**Human Review Checklist**
- [ ] Confirm Zod schema matches the field constraints exactly

**Testing Checklist**
- [ ] Add 5 medicines with multiple batches, confirm FEFO ordering in Inventory

**Git Commit Message:** `feat(inventory): inventory list + add medicine with batch constraints`

**End-of-Day Deliverables:** full manual stock-in and stock-view flow.

---

### DAY 9 — Credit Sales + Customers + Expiry
**Objective:** Customer credit (বাকি) tracking and expiry alerting — merged
into one day to protect the backend/sync/admin days later in the sprint.

**AI Prompt (Cursor Pro)**
> "Build Customers (name, phone, address, notes) with a credit ledger view.
> Wire Checkout's 'credit' payment type to create a `credits` row against a
> selected/new customer. Build 'collect payment' against an existing credit
> balance (adds to cash drawer as a CreditCollection). Build Expiry Management:
> list batches sorted by nearest real expiry date, flag anything inside a
> configurable threshold. Plan first."

**Expected Output:** working credit sales, collections, and an expiry watch list.

**Validation Checklist**
- [ ] A credit sale does NOT touch cash; collecting it later DOES
- [ ] Expiry list correctly sorts nearest-first using real dates, not stored day-counts

**Human Review Checklist**
- [ ] Confirm the expiry sort uses the shared FEFO/date logic, not a new
      hand-rolled sort

**Testing Checklist**
- [ ] Give credit, collect partial payment, confirm remaining balance is correct

**Git Commit Message:** `feat(credit): customer credit ledger + collections + expiry watch list`

**End-of-Day Deliverables:** correct credit and expiry tracking.

---

### DAY 10 — Cash Summary + Expenses + End of Day
**Objective:** Full daily financial close — also merged into one day.

**AI Prompt (Cursor Pro)**
> "Build Expense Tracking (category, amount, description, optional receipt
> photo — stored locally for now) creating both an `expenses` row and a
> `payments` row with type='expense', ref_id pointing at the expense. Build
> Cash Summary (live expected-cash view) and End of Day (locks the day: total
> sales, cash/credit split, profit via COGS, expenses, new credit given,
> credit collected, expected vs counted cash, opened_by/closed_by). Plan
> first."

**Expected Output:** a complete, correct daily close screen.

**Validation Checklist**
- [ ] An expense reduces expected cash by exactly its amount
- [ ] End of Day's numbers match a hand calculation for a full test day

**Human Review Checklist**
- [ ] Hand-calculate one full test day's numbers yourself, compare line by line

**Testing Checklist**
- [ ] A full simulated day: open cash, 8 sales, 1 expense, 1 credit collection,
      close — verify every EOD number

**Git Commit Message:** `feat(cash): expenses, cash summary, end-of-day close`

**Documentation Update:** log the hand-verification results in DECISIONS.md.

**End-of-Day Deliverables:** provably correct financial close.
**MILESTONE: End of Day 10 — every offline P0 workflow works end to end.**

---

### DAY 11 — Basic Staff & Permissions
**Objective:** Owner + Staff roles (simple), PIN-based staff login,
attribution. Full 3-tier Owner/Manager/Staff nuance is P1 — today ships the
minimum needed for a real pharmacy to have more than one person selling.

**AI Prompt (Cursor Pro)**
> "Build Staff Management (owner adds staff with name + PIN), a SIMPLE
> two-role permission check (Owner = everything, Staff = sales/inventory-view
> only), staff PIN login, sales/cash attribution to the logged-in user, and the
> owner's ability to reset a staff PIN or change their own PIN — reuse the
> dots+keypad component. Write to audit_logs for PIN changes and staff
> deactivation, never logging the PIN value. Plan first."

**Expected Output:** working two-role login with enforced permissions and audit trail.

**Validation Checklist**
- [ ] A Staff-role login cannot access owner-only screens
- [ ] audit_logs never contains a raw PIN anywhere

**Human Review Checklist**
- [ ] Grep the database directly for PIN-looking strings in audit_logs — confirm none

**Testing Checklist**
- [ ] Log in as each role, confirm each sees only what it should

**Git Commit Message:** `feat(staff): basic roles, PIN management, audit logging`

**End-of-Day Deliverables:** working two-role access control.

---

### DAY 12 — Supabase Schema + RLS (backend goes live)
**Objective:** The cloud database exists, and shop isolation is PROVEN, not
assumed. **[HARD SPOT — do not rush, cutting Day 14's admin scope is
preferable to rushing this]**

**Preparation Checklist**
- [ ] Re-read the RLS section of muthoy-architecture-v3.md / supabase-schema.sql
      before starting

**AI Prompt (Claude Code — repo-wide, architecture-aware: this is exactly the
kind of task Claude Code should own rather than Cursor Pro's file-by-file mode)**
> "Here is our finalized Postgres schema with RLS (paste supabase-schema.sql
> in full). Deploy it to a fresh Supabase project exactly as given — do not
> modify policies or constraints. Confirm every table has RLS enabled and a
> shop_id-scoped policy. Set up phone OTP via Supabase Auth. Plan first, flag
> anything that looks risky before applying it."

**Expected Output:** live Supabase project matching supabase-schema.sql exactly.

**Validation Checklist**
- [ ] Every table from supabase-schema.sql exists in the live project
- [ ] RLS is enabled on every table (check the Supabase dashboard directly)

**Human Review Checklist — do this yourself, do not accept a summary**
- [ ] Create TWO test shops/accounts. Using shop A's credentials, attempt to
      read/write a row belonging to shop B on at least 5 different tables.
      Confirm every attempt is rejected.

**Testing Checklist**
- [ ] The cross-shop access test above, run and recorded

**Git Commit Message:** `feat(backend): Supabase schema deployed + RLS verified`

**Documentation Update:** log the RLS verification results in DECISIONS.md —
this is exactly the kind of decision that must be traceable later.

**End-of-Day Deliverables:** a live, RLS-isolated Supabase backend.

---

### DAY 13 — Sync Engine (P0 scope) + Real Phone OTP
**Objective:** Offline writes reach the cloud; the app's registration/login
uses real OTP. **[HARD SPOT, continued — see the explicit risk note in the
scope lock above]**

**AI Prompt (Claude Code — repo-wide: touches db/, sync/, and auth screens
across the app; not a single-file task)**
> "Build the sync_queue writer (every local write on a P0 table also enqueues
> a row) and a MINIMUM VIABLE sync engine for Beta: push queued rows to a
> Supabase Edge Function when online, retry with backoff on failure, pull
> other changes for this shop. For Beta, resolve ALL conflicts (including
> stock quantity) with last-write-wins by updated_at — do NOT build the fuller
> delta-merge or conflict_queue logic yet, that's explicitly deferred. Wire
> real phone OTP into Registration/Login, replacing the local-only flow from
> Day 4. Plan first, and flag anything risky before building it."

**Expected Output:** a working (intentionally simplified) sync engine; real OTP
registration/login.

**Validation Checklist**
- [ ] Make 10 sales offline, go online, confirm all 10 appear in Supabase
- [ ] Register with a real phone number, receive and verify a real OTP
- [ ] Confirm last-write-wins behavior is what actually happens (test a
      deliberate edit conflict and observe which value wins)

**Human Review Checklist**
- [ ] This is a hard spot — do not approve based on "it looks like it works."
      Kill the app mid-sync, reopen, confirm it resumes without duplicating or
      losing the queued rows.

**Testing Checklist**
- [ ] Full offline day (per Day 10's test) followed by a sync, confirm the
      cloud copy matches the local copy exactly

**Git Commit Message:** `feat(sync): outbox sync engine (P0/last-write-wins) + real OTP`

**Documentation Update:** log the last-write-wins scope decision and the P1
delta-merge follow-up explicitly in DECISIONS.md.

**End-of-Day Deliverables:** a working offline-to-cloud sync loop, real auth.
**MILESTONE: End of Day 13 — a sale made offline correctly reaches Supabase,
RLS blocks cross-shop access.**

---

### DAY 14 — Basic Admin Panel
**Objective:** A minimal but real admin panel — pharmacy list and a simple
aggregate view. Full analytics/maps/subscription management are P1.

**AI Prompt (Cursor Pro)**
> "Create a Next.js app at apps/admin. Connect to Supabase using the
> SERVICE-ROLE key in server-side code only (API routes/server components) —
> never expose it to the browser. Build exactly two pages: a pharmacy list
> (shop name, phone, registration date, plan — read-only) and a simple
> dashboard (total shops, total sales today, across all shops). No charts, no
> map, no subscription management yet — those are explicitly post-beta. Plan
> first."

**Expected Output:** a working, minimal admin panel.

**Validation Checklist**
- [ ] The pharmacy list shows real data from the live Supabase project
- [ ] The service-role key does NOT appear anywhere in the browser's network
      tab or any client-bundled file (check devtools directly)

**Human Review Checklist**
- [ ] This is a hard-spot verification, not a formality — check the network
      tab yourself.

**Testing Checklist**
- [ ] Register a new test shop on the mobile app, sync it, confirm it appears
      in the admin panel within one sync cycle

**Git Commit Message:** `feat(admin): basic admin panel — pharmacy list + dashboard`

**End-of-Day Deliverables:** a minimal, secure, working admin panel.

---

### DAY 15 — Integration Hardening & Beta Readiness
**Objective:** Prove the FULL offline+online loop end to end, ship a clean
Beta build.

**AI Prompt (Cursor Pro)**
> "Do a hardening pass: remove any remaining seed/demo data so a fresh install
> is empty, confirm the app performs well on a low-end device profile, and
> re-run the FEFO/cash-formula/RLS/sync test suites. Build a new EAS
> internal-distribution build. Plan first."

**Expected Output:** a clean, tested, installable Beta build satisfying the
Beta Definition in full.

**Validation Checklist**
- [ ] Fresh install shows zero medicines/customers/sales
- [ ] Full test suite passes (FEFO, cash, RLS cross-shop, sync round-trip)
- [ ] The FULL loop works on the real device: register with OTP → go offline
      → complete a sale/stock/credit/EOD cycle → go back online → confirm the
      sync landed in Supabase and shows in the Admin Panel

**Human Review Checklist**
- [ ] Run through Volume 9's Beta Checklist in full, item by item, on the
      real device

**Testing Checklist**
- [ ] The full offline+online loop above, executed and observed personally

**Git Commit Message:** `chore: beta hardening — remove seed data, full test suite, EAS build`

**Documentation Update:** finalize DECISIONS.md; write a one-page "what's
built (Beta/P0) / what's next (P1)" summary.

**End-of-Day Deliverables:** a Beta build satisfying the full Beta Definition.
**MILESTONE: End of Day 15 — BETA. Offline + online + sync + RLS + basic
admin, zero seed data, real-device tested.**

---

## AFTER DAY 15 — P1 FAST-FOLLOW
Immediately following Beta, in priority order: sync's full delta-merge +
conflict_queue (do this before any multi-device pilot), OCR/Barcode scanning,
Notifications, the full Supplier/Purchase-invoice system, the full
Owner/Manager/Staff permission matrix, Subscription/billing, and the full
Admin Panel (analytics, map, subscription management). See the P1 list at the
top of this volume for the complete set — nothing here is a surprise, it was
scoped out deliberately on Day 1.
