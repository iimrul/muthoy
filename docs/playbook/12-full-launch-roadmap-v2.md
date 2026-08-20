# MUTHOY POS --- AI ENGINEERING PLAYBOOK

## VOLUME 12 --- Full Product Launch Roadmap & UI/UX Parity Gate

### Extends Volumes 0--11. This volume changes the target from "Day-15 Beta" to a complete launch candidate.

### Functional correctness remains the source of truth; `apps/prototype-web` is the visual/interaction source of truth only.

------------------------------------------------------------------------

## 1. PURPOSE

Muthoy is not considered launch-ready merely because the Day-15 core
sprint is complete.

For the founder's current target, the product must reach all of the
following before launch:

1.  Complete approved mobile feature set.
2.  Offline-first SQLite operation.
3.  Cloud sync, Supabase Auth, RLS, backup, and recovery.
4.  Full prototype functional parity for approved production flows.
5.  Full production UI/UX parity pass against `apps/prototype-web`.
6.  Production security hardening.
7.  Monitoring and crash/usage telemetry.
8.  Real-device reliability testing.
9.  Admin/support capability required to operate the product.
10. A signed-off release candidate with no unresolved Critical defects.

**Day 15 is therefore a CORE ENGINEERING MILESTONE, not the final
product launch.**

Do not remove or weaken the correctness rules in Volumes 0--10. This
volume only extends the release path.

------------------------------------------------------------------------

## 2. SOURCE-OF-TRUTH RULE

Use two separate sources of truth:

### Functional source of truth

-   `apps/mobile`
-   database/schema/migrations
-   domain rules
-   sync/RLS/auth design
-   Volumes 0--11
-   `CLAUDE.md`, `PROJECT_CONTEXT.md`, `TECH_STACK.md`,
    `DEVELOPMENT_RULES.md`
-   durable decisions in `DECISIONS.md`

### Visual/interaction source of truth

-   `apps/prototype-web`
-   its screens, spacing, hierarchy, navigation feel, card patterns,
    typography, status treatments, bottom navigation, scan affordance,
    language controls, empty/loading/error states, and interaction
    patterns.

**Never copy React-Web architecture, CSS, state management, or business
logic from the prototype.** Reproduce the intended experience natively
in React Native while preserving the already-correct production logic.

------------------------------------------------------------------------

## 3. REVISED RELEASE PHASES

``` text
Days 1–15     Core engineering milestone
              Local POS foundation + core workflows + P0 engineering.

Days 16–25    Full approved feature completion
              Sync hardening, scan/OCR, remaining role/subscription/admin/report/
              multi-shop work from Volume 11.

Days 26–28    Production UI/UX Parity Pass
              Transform the functional React Native UI into the approved
              prototype-quality product experience.

Day 29        Security + Observability + Production Hardening
              SQLCipher, secrets/auth/RLS review, Sentry/PostHog, recovery,
              migration and release-security checks.

Day 30        Release Candidate Validation
              Full regression, low-end Android, offline/online transitions,
              fresh-install/upgrade testing, EAS release candidate.

After RC      Controlled pilot → fixes → production rollout.
```

These are sequencing labels, not promises that every phase takes exactly
one calendar day. Correctness gates take priority over dates.

------------------------------------------------------------------------

## 4. ALREADY-BUILT P1 FEATURES

If a feature from Volume 11 was deliberately implemented early, **do not
rebuild it just because its numbered day appears later**.

At the start of each remaining phase:

1.  Inspect current production code.
2.  Compare it with the relevant Volume 11 acceptance criteria.
3.  If complete and verified, mark it `DONE / REVIEW ONLY`.
4.  If partially complete, implement only the missing gap.
5.  Never replace working money/stock/auth logic merely to match an old
    prompt.

This rule exists because Purchases/Suppliers, Customers/Credit,
Notifications, or other P1 work may have been pulled forward
intentionally.

------------------------------------------------------------------------

# PHASE A --- COMPLETE THE PRODUCT FUNCTIONALLY

## 5. SYNC / CLOUD / AUTH MUST LAND BEFORE MULTI-DEVICE PILOT

Complete the finalized sync/OTP plan before treating cloud backup as
available.

Required outcome:

-   SQLite remains the mobile screen source of truth.
-   Every synced local write enters the outbox/sync queue.
-   Push is retryable and idempotent.
-   Pull/full hydration is shop-scoped.
-   RLS is proven with negative cross-shop tests.
-   Synced timestamps use one canonical representation suitable for LWW
    comparison.
-   Queue ordering is deterministic.
-   Device linking refreshes the Supabase session before the first
    authenticated sync.
-   OTP verification never creates a duplicate shop when the verified
    identity is already linked to one.
-   Existing-shop hydration is an engine/data-recovery path; do not
    invent unrelated restore UX unless separately approved.
-   Device-local data such as local notification history stays excluded
    from cloud sync where the finalized plan says so.

**Launch blocker:** any unresolved cross-shop leakage, duplicate-shop
path, lost-write path, or non-recoverable sync corruption.

------------------------------------------------------------------------

## 6. COMPLETE REMAINING VOLUME 11 FEATURES

Use Volume 11 as the detailed prompt library.

Before implementation, classify each feature:

``` text
DONE
PARTIAL
NOT STARTED
SUPERSEDED BY A NEWER APPROVED IMPLEMENTATION
```

Then build only `PARTIAL` and `NOT STARTED` items.

Full-launch target includes all production-approved features needed for
the intended Muthoy release, including the relevant:

-   OCR/barcode flows
-   supplier/purchase flows
-   customer/credit flows
-   notifications
-   full permission matrix
-   subscriptions/plan gating/payment flows
-   reports/export/printer settings
-   multi-shop flows
-   required Admin Panel operations

P2 features remain optional unless the founder explicitly promotes them
into launch scope.

------------------------------------------------------------------------

# PHASE B --- PRODUCTION UI/UX PARITY

## 7. WHY THIS IS A SEPARATE PHASE

Feature parity does **not** guarantee prototype-quality UI.

A screen can be functionally complete while still looking like an
engineering scaffold. Therefore visual parity is a release gate of its
own.

Do not perform major UI reconstruction while core sync/auth/schema
behavior is still unstable. Complete the core architecture first, then
run this pass systematically.

------------------------------------------------------------------------

## 8. UI/UX PARITY IMPLEMENTATION ORDER

Implement in this order so the highest-frequency workflows stabilize
first:

### Pass 1 --- Shared design foundation

-   production font loading: Hind Siliguri, Plus Jakarta Sans, DM Mono
-   colors/tokens/radius/shadows/spacing
-   8pt spacing discipline
-   48×48dp minimum touch targets
-   shared header variants
-   bottom navigation
-   floating Scan affordance
-   Bangla/English language control
-   buttons, chips, cards, inputs, badges, empty states
-   skeleton/loading/error states
-   keyboard/safe-area handling

### Pass 2 --- Main navigation surfaces

1.  Morning Dashboard
2.  Sale
3.  Inventory
4.  More / primary secondary-navigation surface

### Pass 3 --- Transaction-critical flows

5.  Cart
6.  Checkout
7.  Sale confirmation/history/detail
8.  Add/Edit Medicine + Batch
9.  Purchase creation
10. Credit collection

### Pass 4 --- Management flows

11. Expiry management
12. Customers + customer detail
13. Suppliers + supplier detail
14. Cash / expenses / end-of-day
15. Staff/permissions
16. Notifications

### Pass 5 --- Account/platform flows

17. Registration / OTP / PIN
18. Settings
19. Reports/export/printer
20. Subscription/payment
21. Multi-shop
22. remaining approved screens

------------------------------------------------------------------------

## 9. UI/UX PARITY PROMPT

**Tool:** Claude/Codex may plan/review; implementation agent works one
bounded screen group at a time.

**Prompt:**

> "Run a production UI/UX parity pass for \[SCREEN/GROUP\].
>
> Treat `apps/prototype-web` as the visual and interaction reference
> only. Treat the existing React Native production code, domain logic,
> SQLite DB layer, auth, sync, money rules, FEFO, permissions, and
> navigation contracts as the functional source of truth.
>
> First inspect both implementations and write a short parity plan. Do
> not rewrite correct business logic to imitate prototype code. Do not
> copy web CSS/React architecture into React Native.
>
> Match the prototype's hierarchy, spacing, typography, cards, chips,
> status treatments, navigation feel, scan affordances,
> empty/loading/error states, Bangla/English behavior, and touch
> ergonomics as closely as practical on native.
>
> Preserve: - offline behavior - shop isolation - owner/staff permission
> boundaries - FEFO and stock rules - money/cash correctness - sync
> behavior - accessibility/touch targets
>
> Reuse shared production components/tokens instead of duplicating
> styles. STOP if visual parity requires changing a
> money/stock/auth/schema contract.
>
> Verify on Android at 360dp-class width and at least one larger screen.
> Do not commit."

------------------------------------------------------------------------

## 10. VISUAL ACCEPTANCE CHECKLIST

A screen is not visually complete until:

-   [ ] hierarchy matches the prototype's intent
-   [ ] Bangla typography renders correctly
-   [ ] money uses DM Mono
-   [ ] non-money numbers follow the production font rule
-   [ ] spacing is intentional and consistent
-   [ ] cards/chips/buttons have shared styling
-   [ ] status colors mean the same thing everywhere
-   [ ] touch targets are usable on a low-end Android phone
-   [ ] keyboard never hides the active input/action
-   [ ] loading state exists
-   [ ] empty state exists
-   [ ] error/retry state exists where failure is possible
-   [ ] long medicine/customer/supplier names do not break layout
-   [ ] large prices/quantities do not overflow
-   [ ] Bangla and English both fit
-   [ ] safe areas/notches are handled
-   [ ] no screen looks like a Day-1 smoke-test/scaffold
-   [ ] functional regression checklist still passes

Do screenshot comparisons against the prototype during review.

------------------------------------------------------------------------

# PHASE C --- SECURITY & OBSERVABILITY

## 11. SQLCIPHER --- REQUIRED BEFORE REAL PHARMACY DATA

SQLCipher may be deferred during early architecture work, but **must be
resolved before storing real pilot/production pharmacy data**.

Required design review before implementation:

-   encryption library/native compatibility with the current Expo/EAS
    stack
-   database migration strategy for existing unencrypted dev DBs
-   encryption-key generation
-   secure key storage
-   key-loss/recovery behavior
-   reinstall/device-change behavior
-   performance impact on low-end Android
-   backup/sync interaction

Never hardcode the database key in source, env shipped to the client,
logs, AsyncStorage, or plain MMKV.

**Launch blocker:** real pharmacy financial/inventory data stored
locally without the approved at-rest protection decision being completed
and documented.

------------------------------------------------------------------------

## 12. AUTH / RLS / SECRETS SECURITY GATE

Before RC:

-   [ ] cross-shop RLS negative tests pass
-   [ ] service-role key exists only server-side
-   [ ] anon/client keys have only intended capability
-   [ ] OTP/device-link flow cannot claim another shop
-   [ ] stale JWT handling is tested
-   [ ] PINs remain bcrypt-hashed
-   [ ] no PIN/OTP/token/secret appears in logs
-   [ ] soft-delete and sync behavior cannot resurrect forbidden data
    incorrectly
-   [ ] staff cannot reach owner-only DB operations through direct calls
-   [ ] production `.env` handling is documented
-   [ ] dev/test credentials are absent from the repository

------------------------------------------------------------------------

## 13. SENTRY + POSTHOG

Before launch, wire the observability stack already selected by the
project.

### Sentry

Capture: - crashes - unhandled exceptions - failed native startup - sync
engine failures with safe metadata - migration failures

Never attach: - PIN - OTP - auth tokens - customer-sensitive free text -
full pharmacy financial payloads

### PostHog

Track only useful product events, for example: - registration
completed - sale completed - medicine added - purchase completed -
credit collection completed - sync success/failure category - feature
usage

Do not treat analytics as a second business database.

**Launch blocker:** production crashes/sync failures have no operational
visibility.

------------------------------------------------------------------------

# PHASE D --- RELEASE CANDIDATE

## 14. DATA & MIGRATION TEST MATRIX

Test all of:

### Fresh install

-   empty DB
-   registration/OTP/PIN
-   first medicine
-   first sale
-   first sync

### Upgrade

-   install previous dev/beta DB
-   run all migrations
-   confirm existing medicines, batches, customers, suppliers, sales,
    purchases, staff, cash data remain intact

### Offline

-   launch/login
-   sale
-   stock
-   credit
-   purchase where supported
-   app restart
-   queued writes preserved

### Offline → online

-   queued writes push
-   pull completes
-   no duplicate financial rows
-   no duplicate stock movement
-   queue drains safely

### Multi-device

-   same shop on authorized devices
-   changes reconcile correctly
-   conflict behavior follows the finalized sync rules

### Isolation

-   shop B cannot read/write shop A data locally or remotely

------------------------------------------------------------------------

## 15. MONEY/STOCK REGRESSION GATE

Before RC, manually and automatically re-verify:

-   FEFO
-   batch-boundary sale
-   stock race handling
-   COD purchase
-   credit purchase
-   supplier payable
-   customer credit
-   partial collection
-   over-collection rejection
-   expenses
-   refunds if implemented
-   cash drawer
-   end-of-day
-   low-stock threshold/re-arm
-   expiry date calculations
-   sync replay/idempotency

Any discrepancy involving money or stock is a **release blocker**.

------------------------------------------------------------------------

## 16. REAL-DEVICE MATRIX

Minimum:

-   low-end Android profile / approximately 2--3 GB RAM class
-   current mainstream Android device
-   at least one physical phone, not emulator-only
-   offline/poor network
-   background/foreground transitions
-   notification permission allow/deny
-   camera/scanner permissions
-   force-stop/relaunch
-   battery optimization behavior where relevant
-   long session with repeated sales

A passing emulator run is necessary but not sufficient.

------------------------------------------------------------------------

## 17. PERFORMANCE GATE

Verify:

-   medicine search remains responsive with realistic inventory size
-   Sale screen does not re-render unnecessarily
-   cart operations feel immediate
-   DB migrations do not freeze startup unacceptably
-   sync does not block local sale/checkout
-   large customer/supplier histories remain usable
-   Dashboard/report queries do not repeatedly scan avoidable full
    tables
-   images/assets do not cause memory pressure

Optimize only measured problems; do not rewrite stable architecture
speculatively.

------------------------------------------------------------------------

## 18. RELEASE-CANDIDATE PROMPT

> "Audit Muthoy as a production release candidate, not as a sprint demo.
>
> Read Volumes 0--12, CLAUDE.md, PROJECT_CONTEXT.md, TECH_STACK.md,
> DEVELOPMENT_RULES.md, DECISIONS.md, current migrations, and the
> current production code.
>
> Do not implement first.
>
> Produce a launch-gate matrix: PASS / FAIL / NOT VERIFIED for: -
> functional feature completeness - prototype UI/UX parity - offline
> operation - sync/recovery - RLS/shop isolation - auth/OTP/PIN
> security - SQLCipher/local data protection - money/stock correctness -
> subscriptions/payments - admin/support readiness - Sentry/PostHog -
> migrations/upgrades - performance - low-end Android - real-device
> testing - EAS production configuration
>
> For every FAIL/NOT VERIFIED, cite the exact repo evidence and propose
> the smallest corrective task.
>
> Do not call the product launch-ready while any Critical launch gate
> remains FAIL or NOT VERIFIED."

------------------------------------------------------------------------

# PHASE E --- PILOT & LAUNCH

## 19. CONTROLLED PILOT

Only after the RC gates pass:

1.  Start with a very small controlled set of pharmacies.
2.  Monitor crashes, sync failures, data inconsistencies, and support
    requests.
3.  Do not add speculative features during the stabilization window.
4.  Fix correctness/reliability issues first.
5.  Preserve backward-compatible migrations.
6.  Maintain a rollback/recovery procedure.

The pilot is for proving the production system under real use, not for
discovering whether core money/stock logic works.

------------------------------------------------------------------------

## 20. PRODUCTION LAUNCH GATE

Muthoy may be called production-launch-ready only when:

``` text
[ ] Approved launch-scope features complete
[ ] Prototype UI/UX parity pass signed off
[ ] No Critical defects
[ ] Money/stock regression clean
[ ] Offline-first workflows clean
[ ] Sync + hydration + retry + idempotency proven
[ ] Cross-shop RLS/isolation proven
[ ] OTP/PIN/device-link security proven
[ ] Local data-at-rest protection decision implemented
[ ] Subscription/payment production flow proven if launch requires paid plans
[ ] Required Admin Panel/support operations available
[ ] Sentry live
[ ] PostHog live with privacy-safe events
[ ] Fresh-install test passes
[ ] Upgrade/migration test passes
[ ] Low-end Android test passes
[ ] Physical-device test passes
[ ] EAS release candidate installed and smoke-tested
[ ] Backup/recovery path tested
[ ] Pilot blockers resolved
```

**No date overrides this checklist.**

------------------------------------------------------------------------

## 21. DOCUMENTATION RULE

Durable architecture/product decisions belong in durable docs:

-   `DECISIONS.md` --- why a consequential choice was made
-   `TECH_STACK.md` --- actual installed/approved stack
-   `apps/mobile/db/README.md` --- DB behavior/invariants
-   `apps/mobile/native/README.md` --- native integration behavior
-   `backend/supabase/README.md` --- cloud/RLS/Edge Function operational
    notes
-   playbook volumes --- reusable development/release rules

Temporary implementation plans under `docs/plans/` may be deleted after
the feature is implemented, reviewed, committed, and all durable
decisions/invariants have been moved to the appropriate permanent
documentation.

Do not keep stale plan files merely as history; Git already provides
history.

------------------------------------------------------------------------

## 22. FINAL PRINCIPLE

The target is not:

> "Finish Day 15."

The target is:

> **A complete, secure, recoverable, offline-first, visually polished
> Muthoy product that can safely handle real pharmacy stock and money.**

Schedule is flexible.

Correctness, isolation, recoverability, security, and product quality
are not.


---

# APPENDIX A — TOKEN-EFFICIENT CLAUDE → CODEX WORKFLOW

## A1. RULE

Use this workflow for every remaining feature:

```text
Claude: plan only
→ save compact plan to docs/plans/<feature>.md
→ Codex: implement that file
→ Claude: targeted review only
→ manual/device test
→ commit
→ move durable facts to permanent docs
→ delete temporary plan file when no longer needed
```

Do not paste the full repo context repeatedly. Agents must read the repo rules themselves.

---

## A2. GLOBAL CLAUDE PLANNING TEMPLATE

Use this for any remaining feature when a day-specific prompt below does not add anything special:

```text
Read CLAUDE.md + relevant playbook/docs + current code.

Plan only for: [FEATURE].

Inspect current implementation first.
Reuse working code; do not rebuild completed behavior.
Flag only real conflicts/decisions.
Keep plan compact.

Save final plan to:
docs/plans/[feature].md

Do not implement.
```

---

## A3. GLOBAL CODEX IMPLEMENT TEMPLATE

```text
Implement docs/plans/[feature].md.

Read AGENTS.md first.
Inspect current code before editing.
Preserve unrelated dirty work.
Do not expand scope.
STOP on a real schema/security/money/stock/sync conflict; do not guess.
Run required tests/typecheck/lint/diff checks.
Do not commit.

Return only:
Built
Checks
Files changed
Risks/deviations
Manual tests
READY FOR REVIEW / BLOCKED
```

---

## A4. GLOBAL CLAUDE TARGETED REVIEW TEMPLATE

```text
Review only the just-implemented [FEATURE] against:
- docs/plans/[feature].md
- current repo rules
- touched code

Focus on correctness, regressions, security, money/stock/data risk, scope drift,
missing tests, and durable docs.

Do not edit.

Return only:
VERDICT: PASS / CHANGES REQUIRED
Critical:
Important:
Docs:
Manual tests:
Safe to commit: YES/NO
```

---

# APPENDIX B — DAY 16 TO LAUNCH: CLAUDE PROMPT PACK

## DAY 16 — Sync / OTP / Supabase / RLS

Use only if the finalized sync plan is not already complete.

```text
Read CLAUDE.md, Volume 12, current sync/auth/db code, and the latest sync decisions.

Plan only the remaining Sync + OTP + Supabase/RLS work.

Must verify:
- canonical timestamps for LWW
- deterministic queue order
- push/pull/idempotency
- cross-shop RLS
- device link + refreshSession before first sync
- existing linked shop never creates a duplicate shop
- device-local notifications excluded from cloud sync
- permissions-table RLS/pull design is explicit
- full hydration is engine-level, not new restore UX unless already approved

Inspect current work first; plan only missing gaps.
Save to docs/plans/sync-otp.md.
Do not implement.
```

Codex: use **A3** with `[feature]=sync-otp`.

---

## DAY 17 — OCR + Barcode

```text
Read current mobile scan code, Volume 11 scan scope, and prototype only for UX.

Plan only missing OCR + barcode work.
Barcode first; OCR fallback.
Never auto-save scanned data.
Use dev-client/native config correctly.
Do not rewrite inventory/sale business logic.

Save to docs/plans/scan.md.
Do not implement.
```

Codex: A3 → `scan`.

---

## DAY 18 — Notifications

If already shipped and reviewed, do not rebuild.

```text
Audit current Notifications against Volume 11 + durable decisions.

If complete: return DONE / REVIEW ONLY and do not create a plan.
If gaps exist: plan only those gaps.

Preserve:
- low-stock dedup/re-arm
- expiry real-date logic
- owner-only 8PM summary
- startup permission/channel behavior
- post-commit sale trigger
- device-local notification storage

If needed, save gap plan to docs/plans/notifications-gap.md.
Do not implement.
```

---

## DAY 19 — Purchases + Suppliers

If already shipped, do not rebuild.

```text
Audit current Purchases/Suppliers against Volume 11.

Check:
- owner-only
- shop isolation
- COD cash effect
- credit payable
- invoice uniqueness
- batch expiry mismatch safety
- soft-deleted batch safety
- supplier history/payable math

If complete: return DONE / REVIEW ONLY.
Else save only missing gaps to docs/plans/purchases-gap.md.
Do not implement.
```

---

## DAY 20 — Staff / Permissions / Roles

```text
Read current roles/staff code and Volume 11.

Plan only the remaining production permission matrix.
Verify owner/manager/staff boundaries at both UI and DB layers.
No role may gain access merely because a screen is hidden.
Preserve existing PIN behavior.

Save to docs/plans/roles-permissions.md.
Do not implement.
```

---

## DAY 21 — Reports / Export / Printer

```text
Inspect current reports/export/printer code and prototype UX.

Plan only missing production work for:
- reports
- sales history/detail
- CSV/PDF export if approved
- printer settings/receipt flow

Keep money calculations sourced from existing DB/domain logic.
Prototype is UI reference only.

Save to docs/plans/reports-export-printer.md.
Do not implement.
```

---

## DAY 22 — Subscription / Plan Gating

```text
Read current subscription schema/code, plan rules, and Volume 11.

Plan only missing subscription + plan-gating behavior.

Verify:
- FREE/PRO/ULTRA limits
- trial behavior
- downgrade archives/deactivates, never deletes
- feature gating enforced beyond UI
- cached shop plan never becomes the authoritative billing history

Save to docs/plans/subscriptions.md.
Do not implement.
```

---

## DAY 23 — Payments

```text
Read current payment/subscription design and server-side rules.

Plan only the approved payment flow.
Never expose service-role secrets to mobile/browser.
Keep payment verification server-side.
Do not alter cash drawer logic unless the approved payment flow requires it.

Save to docs/plans/payments.md.
Do not implement.
```

---

## DAY 24 — Multi-Shop

```text
Inspect current shop/session/isolation code and Volume 11.

Plan only production multi-shop work:
- owner shop list/switch
- active-shop context
- strict local + cloud isolation
- no stale data after switching
- plan limits enforced

Do not weaken single-shop safety to add multi-shop.

Save to docs/plans/multi-shop.md.
Do not implement.
```

---

## DAY 25 — Functional Parity Audit

```text
Audit production functionality against:
- Volume 11
- prototype screen inventory
- current routes/screens

Do not implement.

Return a compact matrix:
DONE / PARTIAL / MISSING / SUPERSEDED

For every PARTIAL/MISSING item, give the smallest next task.
Do not count visual mismatch as functional failure here; UI parity is Days 26-28.
```

No Codex handoff unless the audit finds a real functional gap.

---

# APPENDIX C — UI/UX PARITY PROMPT PACK

## DAY 26 — Dashboard + Navigation + Shared UI

```text
Plan only a production UI/UX parity pass for:
- shared tokens/components
- bottom navigation
- headers
- scan affordance
- Dashboard
- primary navigation shell

Use apps/prototype-web as visual/interaction reference only.
Preserve all production business/auth/sync/navigation contracts.
No web CSS/architecture copying.

Save to docs/plans/ui-parity-1.md.
Do not implement.
```

Codex: A3 → `ui-parity-1`.

---

## DAY 27 — Sale + Inventory + Transaction UI

```text
Plan only UI/UX parity for:
- Sale
- Cart
- Checkout
- Confirmation
- Inventory
- Add/Edit Medicine/Batch

Do not change FEFO, money, stock, DB, sync, or transaction behavior.
Match prototype hierarchy/spacing/cards/chips/scan/search states natively.

Save to docs/plans/ui-parity-2.md.
Do not implement.
```

Codex: A3 → `ui-parity-2`.

---

## DAY 28 — Remaining Screens UI/UX

```text
Plan only UI/UX parity for remaining approved screens:
customers, suppliers, credit, purchases, expiry, cash/EOD, staff,
notifications, settings, reports, subscriptions, multi-shop, auth/OTP/PIN.

Do not rebuild functional logic.
Use shared production components from Days 26-27.

Save to docs/plans/ui-parity-3.md.
Do not implement.
```

Codex: A3 → `ui-parity-3`.

---

# APPENDIX D — SECURITY / OBSERVABILITY / RELEASE

## DAY 29A — SQLCipher

```text
Read current SQLite/Expo/EAS/native stack and the SQLCipher launch gate.

Plan only SQLCipher/local DB encryption.

Must decide:
- compatible library/native setup
- encryption-key generation/storage
- existing unencrypted dev DB migration
- key-loss/reinstall behavior
- performance
- backup/sync interaction

Never hardcode/store the DB key insecurely.

Save to docs/plans/sqlcipher.md.
Do not implement.
```

Codex: A3 → `sqlcipher`.

---

## DAY 29B — Sentry + PostHog

```text
Inspect current observability state.

Plan only production Sentry + PostHog integration.

Sentry: crashes, startup, migration, sync failures.
PostHog: minimal useful product events.

Never send PIN, OTP, tokens, secrets, sensitive free text,
or full financial payloads.

Save to docs/plans/observability.md.
Do not implement.
```

Codex: A3 → `observability`.

---

## DAY 29C — Security Audit

```text
Audit only; do not edit.

Review:
RLS/shop isolation
OTP/device-link
PIN security
secrets/env
staff/owner DB enforcement
sync spoofing/idempotency
soft-delete behavior
SQLCipher status
logging/privacy

Return:
Critical
Important
Verified
Not verified
Launch blockers
```

Fix only blockers with small targeted plans.

---

## DAY 30 — Release Candidate Audit

```text
Read Volume 12 and current repo.

Audit Muthoy as a production release candidate.
Do not implement.

Return PASS / FAIL / NOT VERIFIED for:
features
UI/UX parity
offline
sync/hydration
RLS/isolation
OTP/PIN
SQLCipher
money/stock
subscriptions/payments
admin/support
Sentry/PostHog
migrations/upgrades
performance
real-device tests
EAS production config

For each FAIL/NOT VERIFIED:
- exact repo evidence
- smallest corrective task

Do not call launch-ready while a Critical gate is open.
```

---

# APPENDIX E — TOKEN-SAVING RULES FOR AGENTS

1. Do not paste files the agent can read from the repo.
2. Reference exact paths instead of repeating plan contents.
3. One feature per plan file.
4. Claude plans; Codex implements; Claude targeted-reviews only.
5. After first full review, use targeted re-review prompts, not another full audit.
6. Ask agents to return concise fixed schemas (`Built / Checks / Risks / Manual`).
7. Do not request explanations unless a decision is unclear.
8. Mark already-complete later-day features `DONE / REVIEW ONLY`; never rebuild.
9. Delete temporary `docs/plans/*.md` after implementation/review/commit **only after**
   durable decisions/invariants are captured elsewhere.
10. Do not make agents reread prototype code for non-UI tasks.
11. For UI parity, inspect only the current screen group + shared components, not all ~39 screens at once.
12. For high-risk money/stock/sync/auth tasks, token saving never overrides the STOP/conflict gate.

---

# APPENDIX F — FAST FIX / RE-REVIEW PROMPTS

## Codex targeted fix

```text
Fix only these reviewed issues:
[ISSUES]

Preserve all other behavior.
Do not expand scope.
Do not commit.
Run only relevant tests + typecheck/lint/diff check.
Return concise results.
```

## Claude targeted re-review

```text
Re-review only the fixes from your last review.

Confirm:
[CHECKS]

Do not edit.

Return only:
VERDICT
Remaining blockers
Safe to test/commit: YES/NO
```

## Claude review + commit in one step

Use only after manual tests are done:

```text
Final targeted review for [FEATURE].

If CHANGES REQUIRED:
do not commit; report blockers only.

If PASS:
run final relevant checks,
review git status/diff,
commit only feature-related files/docs,
exclude unrelated dirty work,
do not push.

Commit message:
[COMMIT MESSAGE]

Return:
VERDICT
Checks
Files committed
Commit hash
```
