# MUTHOY POS — AI ENGINEERING PLAYBOOK

## VOLUME 12 V3 — Prototype-Complete Beta Roadmap, Functional Parity & UI/UX Release Gate

**Status:** Governing roadmap for the remaining Beta work  
**Replaces:** Volume 12 V2 where V2 conflicts with this document  
**Date:** 2026-08-21

---

# 1. PURPOSE

Muthoy is not considered Beta-ready merely because the core POS, sync, auth, or earlier numbered sprint work exists.

The Beta target is now:

1. Complete the latest approved prototype feature set.
2. Preserve production-grade offline-first architecture.
3. Preserve correct money, stock, FEFO, auth, permissions, sync, RLS, and recovery behavior.
4. Account for every approved prototype screen and shared interaction.
5. Finish functional parity before the final visual-polish pass.
6. Complete production UI/UX parity after functionality is stable.
7. Pass security, migration, performance, real-device, and release-candidate gates.

The target is not “finish Day 15.”

The target is:

> **A prototype-complete, secure, recoverable, offline-first Muthoy Beta that behaves correctly and looks like the approved product.**

---

# 2. NEW SOURCE-OF-TRUTH RULE

Volume 12 V2 treated `apps/prototype-web` as visual/interaction reference only.

That rule is superseded.

## 2.1 Product / feature / UX source of truth

The **latest approved prototype** is the source of truth for the intended Beta product experience, including:

- screens
- user-visible features
- navigation structure
- information hierarchy
- Owner / Manager / Staff experiences
- dedicated Staff dashboard
- permission-driven actions
- Bangla / English behavior
- bottom navigation
- elevated Scan affordance
- More / secondary navigation
- settings surfaces
- notifications
- plan / trial / payment surfaces
- multi-shop surfaces
- printer / export / reports surfaces
- sheets, modals, states, and user-facing interactions
- icons, imagery, logo usage, and visual intent

If the prototype clearly defines **WHAT the Beta product should do or show**, treat it as in scope unless explicitly superseded by a newer founder decision.

## 2.2 Correctness / implementation source of truth

The following remain authoritative for **HOW** the production app must safely implement the product:

- `apps/mobile`
- SQLite / Drizzle schema
- PostgreSQL migrations
- domain rules
- sync engine
- RLS
- auth/session design
- FEFO
- inventory movement ledger
- money/cash rules
- security invariants
- durable architecture docs
- `CLAUDE.md`
- `AGENTS.md`
- `PROJECT_CONTEXT.md`
- `TECH_STACK.md`
- `DEVELOPMENT_RULES.md`
- `DECISIONS.md`

## 2.3 Conflict rule

When prototype intent and production implementation differ:

- preserve the prototype’s **product behavior**
- preserve production’s **correctness and security invariants**
- never copy unsafe web/localStorage/business logic from the prototype

A prototype deviation is allowed only when:

1. technically impossible on the production stack,
2. it violates a proven money/stock/security/sync invariant, or
3. the founder explicitly approves the deviation.

Record approved deviations in durable documentation.

---

# 3. BETA DEFINITION

The founder’s Beta is **prototype-complete**, not a reduced Day-15 subset.

Before Beta sign-off:

- every approved prototype screen must be accounted for
- every approved prototype feature must be classified
- every `PARTIAL` or `MISSING` item must be completed or explicitly superseded
- UI polishing begins only after functional parity is substantially complete
- security/release gates remain mandatory

Use these statuses:

```text
DONE
PARTIAL
MISSING
SUPERSEDED
NOT VERIFIED
```

Do not use visual mismatch alone to mark a functionally complete screen as `MISSING`.

---

# 4. REQUIRED 39-SCREEN ACCOUNTING

The latest prototype should be audited against the following production screen inventory.

## Auth / onboarding

1. Role Select
2. Registration
3. OTP Verification
4. PIN Setup
5. Owner / PIN Login
6. Staff Login

## Dashboards

7. Morning Dashboard / Owner Home
8. Staff Home

> Manager behavior may be implemented through role-aware components or a dedicated surface, but it must be explicitly accounted for during parity audit.

## Sale / transaction

9. Sale Entry
10. Cart
11. Checkout
12. Sales History
13. Staff Sales View

## Inventory

14. Inventory
15. Add Medicine
16. OCR / Scan
17. Expiry Management

## Credit / customers

18. Credit Sales
19. Customer Credit Detail

## Cash / daily operations

20. Cash Summary
21. Expense Tracking
22. End of Day

## Reports

23. Reports
24. Monthly Report
25. Data Export

## Suppliers / purchases

26. Suppliers
27. Supplier Detail
28. Supplier Invoices / Purchase History
29. Supplier Invoice Create / Purchase Create
30. Supplier Invoice Detail

## Staff / account

31. Staff Management
32. Settings
33. Notification Center
34. Printer Settings

## Plans / billing

35. Plans
36. Plan Payment
37. Plan Success

## Shop / platform

38. Multi-Shop Management
39. Not Found / route fallback

The audit may rename routes to match production naming, but **39/39 must be accounted for**.

---

# 5. SHARED COMPONENT / INTERACTION PARITY

Screen count alone is not enough.

Audit shared prototype behavior including:

- Main layout / app shell
- Standard headers
- bottom navigation
- elevated center Scan action
- More surface
- language toggle
- logout confirmation
- staff logout / lock behavior
- shop switcher sheet
- add staff modal
- reset staff PIN modal
- staff detail sheet
- staff active/deactivated handling
- permission controls
- Add/Edit Medicine modal/screen
- Add/Edit Batch flows
- Manufacturer picker
- Supplier picker
- CSV import
- Discount modal
- cash cards/modals
- notification cards/states
- plan badge
- trial banner
- premium lock
- form sheets
- skeletons
- toasts
- empty states
- error/retry states
- loading states
- virtualized long lists where needed
- responsive keyboard/safe-area behavior

If a shared component drives multiple prototype screens, build it once in production and reuse it.

---

# 6. NON-NEGOTIABLE PRODUCT REQUIREMENTS

## 6.1 Dedicated Staff experience

Staff must not receive the Owner dashboard with buttons merely hidden.

Staff Home must be role-specific and show appropriate staff context such as:

- today’s sales
- transaction count
- average bill
- recent transactions
- shift/start context where approved
- permission-based quick actions

Staff Sales View remains a separate staff-focused reporting/history surface where the prototype requires it.

## 6.2 Language

Global Bangla / English switching is Beta scope.

Do not treat language control as optional polish.

Both languages must fit the production UI without broken layout.

## 6.3 Permissions

The prototype permission vocabulary must map to production permission enforcement.

UI hiding alone is insufficient.

Permissions must be enforced at the correct DB/server/domain layers.

## 6.4 Offline-first

Production screens use SQLite/local state as the operational source of truth.

Network availability must not block normal enrolled-device workflows that are designed to work offline.

Background sync must not block local sale/checkout/navigation where local durability is already guaranteed.

## 6.5 Auth

Normal Owner and Staff login:

```text
phone + PIN
```

No OTP during normal enrolled/fresh-device login.

OTP is reserved for approved Owner registration/recovery flows.

Temporary DEV OTP bypass must be removed/disabled before production.

## 6.6 PIN performance

Enrolled/offline PIN login should feel immediate on target Android hardware.

Target:

- enrolled PIN login: <= 2 seconds
- Staff local creation/PIN confirm: <= 2–3 seconds where device-local work is sufficient
- fresh-device cloud login: network-dependent, but must always show immediate progress and avoid unnecessary blocking work

Use secure native PIN hashing/verification; do not lower security merely for speed.

---

# 7. CURRENT FOUNDATION — DO NOT REBUILD

Before planning any remaining work, inspect the repo.

Already-complete or recently-hardened areas must be reused, not rebuilt.

Examples include:

- offline-first SQLite foundation
- sync queue / outbox
- hydration
- multi-device inventory ledger
- Owner/Staff separate-device auth
- PIN session handling
- permission-version stale-claim handling
- revocation/deactivation protections
- native PIN crypto/performance work
- Switch User / lock semantics
- existing sale/inventory/cash/purchase/credit foundations

If existing implementation passes current acceptance criteria:

```text
DONE / REVIEW ONLY
```

Do not rebuild it because an older numbered day says to implement it.

---

# 8. REVISED DEVELOPMENT SEQUENCE

The remaining work should follow this order.

## PHASE A — Functional Prototype Gap Audit

Do not implement first.

Compare:

- latest prototype
- current React Native routes/screens
- current domain/DB/sync/auth implementation

Produce a compact matrix:

```text
SCREEN / FEATURE
STATUS: DONE / PARTIAL / MISSING / SUPERSEDED
PROTOTYPE EXPECTATION
CURRENT PRODUCTION STATE
SMALLEST NEXT TASK
```

This audit decides the actual remaining workload.

---

## PHASE B — Functional Completion

Build only `PARTIAL` and `MISSING` items.

Recommended grouping:

### B1. Navigation + role/platform completeness

- Staff Home
- Manager behavior
- More surface
- language switching
- complete permission surfaces
- Settings gaps
- Notification Center gaps

### B2. Transaction / inventory completeness

- Sale/history/detail gaps
- returns if approved
- OCR/barcode gaps
- Add/Edit Medicine/Batch gaps
- expiry flows
- CSV import where approved

### B3. Customer / supplier / finance completeness

- credit/customer details
- supplier invoice flows
- purchases
- cash/expenses/EOD
- reports/monthly report
- export
- printer settings

### B4. Commercial / platform completeness

- Plans
- trial state
- premium gating
- payment
- payment success
- multi-shop
- shop switching

After this phase:

> **39/39 screens must be functionally accounted for.**

Do not begin the final screenshot-level polish while meaningful product functionality is still missing.

---

# 9. FUNCTIONAL GAP AUDIT PROMPT

Use this before implementing the remaining screens.

```text
Audit current Muthoy functional parity against the latest approved prototype.

Read repo rules + current mobile code + prototype.

Do not implement.

For every prototype screen and shared feature, return:
DONE / PARTIAL / MISSING / SUPERSEDED.

Account for all 39 screens plus shared components:
navigation, Staff Home, language, permissions, settings, notifications,
printer, reports/export, plans/trial/payment, multi-shop, sheets/modals/states.

Prototype defines WHAT the Beta must do/show.
Production DB/auth/sync/domain code defines HOW it must be implemented safely.

Do not count visual mismatch as a functional failure.

For each PARTIAL/MISSING item give only the smallest next task.

Save:
docs/plans/prototype-functional-gap-audit.md
```

---

# 10. FUNCTIONAL IMPLEMENTATION WORKFLOW

Use one bounded feature group at a time.

## Claude / reviewer — plan only

```text
Read repo rules + prototype gap audit.

Plan only: [FEATURE/GROUP].

Inspect existing production code first.
Reuse completed behavior.
Do not copy prototype web business logic.
Stop on schema/security/money/stock/sync conflicts.

Save:
docs/plans/[feature].md
```

## Codex — implement

```text
Implement docs/plans/[feature].md.

Read AGENTS.md.
Preserve unrelated dirty work.
Do not expand scope.
Reuse existing production logic.
Run relevant tests + typecheck/lint/diff checks.
Do not commit.

Return:
Built
Checks
Files changed
Risks
Manual tests
READY FOR REVIEW / BLOCKED
```

## Claude — targeted review

```text
Review only the just-implemented [FEATURE].

Check:
correctness
regressions
security
money/stock/data risk
prototype functional parity
tests
durable docs

Do not edit.

Return:
VERDICT
Critical
Important
Docs
Manual tests
Safe to commit: YES/NO
```

---

# 11. PHASE C — FINAL UI/UX PARITY

Begin only after functional parity is complete enough that screens will not require major structural rework.

The prototype is the visual and interaction reference.

Production React Native remains the implementation platform.

Never copy prototype CSS/web architecture.

## Pass 1 — Shared design foundation

- fonts
- tokens
- spacing
- radius
- shadows
- colors
- shared headers
- buttons
- cards
- chips
- inputs
- badges
- bottom navigation
- Scan affordance
- language control
- loading/skeleton/empty/error states
- safe area
- keyboard behavior

## Pass 2 — Main navigation

- Owner Dashboard
- Staff Home
- Sale
- Inventory
- More/navigation shell

## Pass 3 — Transaction-critical

- Cart
- Checkout
- confirmation/history
- medicine/batch
- OCR/scan
- credit collection
- purchase creation

## Pass 4 — Management

- expiry
- customers
- suppliers
- cash
- expenses
- EOD
- staff/permissions
- notifications

## Pass 5 — Platform/account

- auth/onboarding
- settings
- reports
- export
- printer
- plans
- payment
- multi-shop

---

# 12. UI PARITY PROMPT

```text
Run UI/UX parity for [SCREEN/GROUP].

Use latest prototype as visual/interaction reference.
Preserve production DB/domain/auth/sync/navigation behavior.

Match:
hierarchy
spacing
typography
cards/chips
status treatment
navigation feel
icons/assets
language behavior
loading/empty/error states
touch ergonomics

Reuse shared React Native components/tokens.
Do not copy web CSS or prototype business logic.
Do not change money/stock/auth/schema contracts.

Verify on Android at ~360dp width and one larger screen.
Do not commit.
```

---

# 13. VISUAL ACCEPTANCE GATE

A screen is not visually complete until:

- hierarchy matches prototype intent
- Bangla typography renders correctly
- English layout also fits
- money typography follows production rules
- spacing is consistent
- shared components are reused
- touch targets are usable
- keyboard does not hide active controls
- safe areas work
- loading state exists
- empty state exists
- error/retry state exists
- long medicine/customer/supplier names do not break layout
- large prices/quantities do not overflow
- status colors are consistent
- no engineering-scaffold appearance remains
- Android screenshot comparison has been reviewed
- functional regression still passes

---

# 14. PHASE D — SECURITY / OBSERVABILITY / PRODUCTION HARDENING

UI completion does not override launch gates.

Before real pharmacy data / production:

## Local data protection

Complete the approved at-rest protection strategy.

Do not ship real pharmacy financial/inventory data with an unresolved local-data encryption decision.

## Auth / RLS / secrets

Verify:

- cross-shop negative RLS tests
- service-role secrets server-only
- stale claims
- Owner/Staff permission enforcement
- no PIN/OTP/token leakage
- revocation/deletion cannot be resurrected incorrectly
- production env handling
- DEV bypass removed
- real OTP provider configured for production registration/recovery

## Observability

Production needs operational visibility for:

- crashes
- startup failures
- migration failures
- sync failures
- safe product events

Never send secrets or sensitive business payloads to telemetry.

---

# 15. PHASE E — RELEASE CANDIDATE

Run a complete matrix:

## Fresh install

- registration
- OTP
- PIN
- first medicine
- first sale
- first sync

## Upgrade

- migrations preserve existing data

## Offline

- login
- sale
- inventory
- credit
- purchase where supported
- restart
- queued writes preserved

## Offline → online

- queue drains
- no duplicate financial rows
- no duplicate stock movement
- pull/hydration remains correct

## Multi-device

- same shop on authorized devices
- inventory reconciliation
- permissions/revocation
- no cross-shop leakage

## Money / stock

Re-verify:

- FEFO
- stock boundaries
- movement ledger
- COD/credit purchase
- supplier payable
- customer credit
- partial collection
- expenses
- returns/refunds where approved
- cash drawer
- EOD
- low stock
- expiry
- sync replay/idempotency

Any money or stock discrepancy is a release blocker.

---

# 16. REAL-DEVICE / PERFORMANCE GATE

Minimum:

- low-end Android class
- mainstream Android
- physical device
- offline
- poor network
- background/foreground
- force-stop/relaunch
- camera/scanner permissions
- notification permissions
- long session with repeated sales

Performance checks:

- enrolled PIN login <= 2s target
- Staff local creation <= 2–3s target
- search responsive with realistic inventory
- cart immediate
- sync does not block local checkout/navigation
- dashboard/report queries avoid unnecessary full scans
- large histories remain usable
- no unacceptable startup freeze

Optimize measured bottlenecks only.

---

# 17. PROTOTYPE-COMPLETE BETA GATE

Muthoy Beta may be called prototype-complete only when:

```text
[ ] 39/39 approved prototype screens accounted for
[ ] Every prototype feature DONE or explicitly SUPERSEDED
[ ] Dedicated Staff Home complete
[ ] Role/permission behavior complete
[ ] Bangla/English behavior complete
[ ] Navigation / Scan / More parity complete
[ ] Sale / Inventory / Credit / Supplier / Cash workflows complete
[ ] Reports / Export / Printer complete
[ ] Plans / Trial / Payment complete if approved Beta scope
[ ] Multi-shop complete if approved Beta scope
[ ] Functional parity audit signed off
[ ] UI/UX parity signed off
[ ] Offline-first regression clean
[ ] Sync/hydration/idempotency clean
[ ] Auth/PIN/device flow clean
[ ] Cross-shop RLS clean
[ ] Money/stock regression clean
[ ] Local data protection gate resolved
[ ] Production OTP path ready
[ ] Observability ready
[ ] Fresh-install and upgrade tests pass
[ ] Physical-device tests pass
[ ] EAS release candidate passes smoke test
```

No date overrides this checklist.

---

# 18. DOCUMENTATION RULE

Durable facts belong in durable docs:

- `DECISIONS.md`
- `TECH_STACK.md`
- `PROJECT_CONTEXT.md`
- `apps/mobile/db/README.md`
- `apps/mobile/native/README.md`
- `backend/supabase/README.md`
- relevant playbook volumes

Temporary plans under `docs/plans/` should be removed after:

1. implementation,
2. review,
3. manual test,
4. commit,
5. durable decisions moved to permanent docs.

Git already preserves historical plan versions.

---

# 19. TOKEN-EFFICIENT AGENT RULES

1. Do not paste repo files agents can read.
2. One feature group per plan.
3. Inspect current code before planning.
4. Reuse completed behavior.
5. Claude/reviewer plans or reviews; Codex implements.
6. Use targeted re-review after the first full review.
7. Keep return schemas short.
8. Do not reread all prototype code for unrelated backend tasks.
9. For UI parity, inspect only the current screen group + shared components.
10. Token saving never overrides security/money/stock/sync STOP rules.
11. Mark already-complete later work `DONE / REVIEW ONLY`.
12. Do not rebuild stable auth/sync/ledger logic merely to match an old roadmap.

---

# 20. IMMEDIATE NEXT ACTION

Do **not** begin final UI polishing yet.

Run the functional prototype gap audit first.

Sequence:

```text
Current hardened foundation
→ 39-screen functional gap audit
→ complete PARTIAL/MISSING screens/features
→ verify 39/39 functional accounting
→ final UI/UX parity pass
→ security/observability
→ RC
→ controlled pilot
```

This sequence minimizes rework and preserves the production architecture while still making the final Beta match the approved prototype.

---

# 21. FINAL PRINCIPLE

Prototype defines the intended Beta product.

Production architecture defines the safe implementation.

Neither may casually override the other.

The finished product must satisfy both.
