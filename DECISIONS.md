# DECISIONS.md — Muthoy POS

## 2026-11-11 - independently reviewed Apple and archive follow-ups

Founder approved B2/B3: installation-scoped Apple Keychain services and excluded
Documents/SQLite, installed MMKV Documents/mmkv, and installation metadata; Expo
startup subscriber initializes before JS. Missing/corrupt marker with existing
artifacts fails closed. A fresh reinstall uses a new marker without deleting old
Keychain items. Authenticated key recovery preserves raw corrupt bytes atomically;
corrupt pending-state inspection returns false while actual Keychain access errors
still throw. Missing-key recovery is one add; marker publication uses a synced temp
and no-clobber rename. Apple BLE retains the connection for a bounded500ms drain.
Native runtime/build/XCTest remain unverified without Xcode; physical iOS deferred.
Vendor LF rules are local to the new vendor folder; sealed root attributes unchanged.

Founder approved C3 after independent review reproduced nested serialized conflict
PIN credentials in business archives. Capture now parses/redacts that exact nested
history; domain validation independently refuses credentials or malformed payloads.
The actual keep-remote writer is unchanged. Regression proves original conflict,
immutable journal, live credentials and financial ledgers remain unchanged while
isolated decrypted/restored archives contain only reauthentication placeholders.
Initial11FAIL44PASS and independent disabled-guard failures are retained. No live
restoration, held SQL activation or automatic backup integration has occurred.

## 2026-11-11 - approved three-priority implementation boundaries

Founder approved DEV31 local prerequisite tests, iOS native/security group,
local encrypted recovery core, HELD wrapper-order guard, and affected fixture
migration setup. Existing DEV private Storage plus an owner recovery code is the
selected independent custody. No hosted/device activation is authorized.
The shared recordChange business-write boundary DOES change: it now appends an
immutable shop/outbox-identity journal within the existing transaction, failing
closed and rolling back the whole writer when the journal cannot persist. New
additive SQLite0034 backfills the prior queue without changing it. This is a local
implementation awaiting final independent review and explicit device activation;
existing financial calculations, stock triggers, auth policies and server sync
contracts are unchanged by the recovery core.

Business-only archives use authenticated AES256GCM, random256bit recovery factor,
exact tenant/owner/device/watermark metadata and original IDs. No automatic key
persistence, setup UI, Staff continuous backup or live restoration is wired.
Only independently downloaded, authenticated copies advance a protection receipt;
new offline writes remain exposed. Archives restore to a fresh isolated database,
using existing movement identities/triggers and comparing exact rows before commit;
no live database swap or enrollment-authority bypass is provided. Credentials and
device secrets are not restored. Authentic recovery and hosted Storage durability
remain unverified. No-loss remains FAIL; a phone-only journal is not an independent
surviving copy.

The HELD role-credit candidate now refuses partial/unknown/later wrapper ordering
instead of overwriting the E4 protection during reapplication. It remains HELD;
active migration ordering/promotion and DEV activation require separate approval.
iOS adds Apple implementations of the existing three native modules, device-only
Keychain, fixed upstream bcrypt, SQLCipher and CoreBluetooth in the SAME app.
Android native code is unchanged. Xcode/native runtime verification is blocked on
this Windows host, and iOS physical testing is explicitly deferred. Baseline
317files7459tests/Claude scopedACCEPT is retained as historical evidence; current
changed source requires new full regression and independent review. Claude review capacity was restored after the scheduled reset. Independent review
accepted local A/A2 and fixture scope C2. Recovery C and Apple source revisions
remain under final re-review; no overall acceptance is inferred.


## 2026-11-11 — Founder three-priority execution scope

Work order is Android missing-data restoration, independently recoverable encrypted
backup protection, then iOS compatibility in the SAME apps/mobile React Native/Expo
app. Existing screens, services, domain logic and design are reused. iOS source and
necessary native implementation are now authorized; no separate app, iOS physical
acceptance, TestFlight/AppStore or release testing. Native build requires actual
macOS/Xcode; this Windows host has none. Earlier iOS-on-hold wording is historical.

Preserve317files7459testsPASS and Claude scopedACCEPT. No Main/Production/Preview
operations or commit/push/merge/deploy. DEV is31migrations while repo is37; do not
automatically apply unrelated migrations. Exact local prerequisite and iOS native
security scopes requested; live activation/device rehydration need separate scope.
Offline records cannot survive complete phone loss without an independent copy;
no-loss remains FAIL. Independent custody/factor and exact recovery implementation
approval precede key/writer/schema/storage changes. Seven remaining readiness groups
stay pending; Batch6medicine data and direct bKash integration remain deferred.


## 2026-11-11 — separately approved F3/F4 read-graph closure

Founder approved local F3 draft projection/FK reconstruction and HELD F4 parent
readability, then separately approved amendment C for reconciliation/customer
closure. Five initial actual SQL/SQLite failures and two C failures are retained.
The HELD pull masks only a hidden sale's completed_sale_id in draft JSON, using
sale ownership/history visibility rather than draft actor. Completed drafts cannot
be edited by the client; server writes already require own actor/origin device.
No new draft write normalization is added on the server.

The local DB apply writer DOES change again: unknown/changed-access full hydration
may restore only an otherwise-identical equal-timestamp null completedSaleId.
Dynamic complete local-column equality includes checkout/prescription data, with
strict remote-key presence and boolean/timestamp normalization. Same-shop parent,
unique-link and pending/failed dependency guards fail closed. A shared guarded
helper retains every existing R1 assertion. Default/same-context LWW, other fields,
queue writes, accounting and stock logic remain unchanged. Pending-ACK limitations
still apply; this is not a general recovery mechanism.

The HELD readable predicate now requires allocation access plus already-readable
credits/payments/customers, and reconciliation access plus already-readable
customers. Narrow credit_view/sale_return-only roles lose inconsistent child
history without gaining financial parent access. Default sales+sale_return keeps
customers/reconciliation but cannot receive allocations without payments. Refund
paths lacking readable parents remain refused; no narrow-role acceptance claimed.
This deliberately makes sync pull narrower than existing RLS for these children;
RLS policies/grants are unchanged. Tests pin the exception, prewarmed callers,
private service-role denial, pagination, revoke/pending behavior and exact ledgers.
Staff inventory_edit receipt-less restock remains enabled. No active migration,
classification/seal, schema, hosted change, device hydration, Metro or deployment.
All release and no-loss gates remain open. No commit/push/merge.


## 2026-11-11 — separately approved HELD server credit-link candidate

Real active-chain PGlite tests confirmed both review hypotheses: a grouped
collection accepted a null sale_id and erased an existing credit link; a Staff
pull returned colleague-credit FKs without readable parent sales, making fresh
SQLite hydration fail atomically. These are confirmed server-contract defects.
Founder separately approved LOCAL HELD SQL and synthetic tests only. The candidate
preserves existing server credit identity when a client sends null, refuses a
different nonnull identity, and masks only unreadable colleague-sale IDs in Staff
pull JSON. Stored credit amounts/balances, permissions, row selection, pagination
and money formulas remain unchanged. Client collection writers are unchanged.
Only the new contract pgtest explicitly applies the held SQL after the active
chain. The SQLite role fixture mirrors this proven candidate projection. Original
active-chain failing evidence is preserved. Public RPCs remain service_role-only. Claude F1 found the renamed internal
functions also need denial to service_role under the newer E4 no-bypass rule;
that local HELD correction revokes all API/service execution on internals while
SECURITY DEFINER wrappers still work. No privilege widening is authorized.

No active migration, classification manifest/seal, hosted function/database or
schema is changed. Activation and real DEV acceptance need separate approval.
A credit protected by pending work can retain a null local sale link after ACK
until the next access change; this known R1 limitation can refuse a later refund,
without miscounting money. No silent repair of that wider lifecycle is implemented.
No automatic historical link reconstruction, data backfill or device hydration.
Metro remains off. Local candidate PASS cannot establish hosted parity or GO.

## 2026-11-11 — separately approved credit-link apply-writer extension

Claude's second review identified a remaining financial relationship defect:
Staff history purge clears credits.sale_id through ON DELETE SET NULL without
changing its timestamp. Equal-timestamp LWW then refuses to restore that link.
Both incremental restart and explicit full hydration reproduce it in real SQLite.
Founder separately approved extending db/sync-helpers.ts and sync/pull.ts.
The DB apply writer DOES change: access-context hydration may restore only the
null credit sale link when timestamps/other business fields agree, its same-shop
sale exists, and pending/failed dependency graphs do not protect the credit.
Amount, balance and other columns are not replaced; normal LWW remains unchanged.
Unknown old access metadata also triggers a one-time full fetch on every existing
installation after update. This can increase network/time costs for large shops.

Founder also approved temporary synthetic H-A/H-B server/SQLite tests only. Any
confirmed server or fresh-hydration defect needs its own exact repair approval.
No hosted changes or device restoration were authorized; Metro remains off.
The earlier statement that DB apply writers were unchanged describes only the
previous two-source-file repair, before this separately approved extension.

## 2026-11-11 — approved review follow-ups and role-switch mirror repair

Founder separately approved Manager opening-cash blank refusal/disabled Save with
existing EN/BN feedback; explicit zero remains valid. Money tests now instrument
actual unchanged writers, settle submit before snapshots and put writer/ledger
assertions before presentation assertions. Six scratch precision controls fail at
real writer-call assertions. Scanner caller mocks include the native status-bar
export; existing OCR/retake assertions remain intact. Fixture-only stable-cost and
single-device assumptions are explicit. No formula or money writer changes here.

Physical Manager and cashier Staff status contrast passed after private logins.
After returning Owner, the DEV mirror contained zero sales/items while the DEV
server retained eleven/fifteen; stored drawer close2150 differed from live450paisa.
No device business transaction, clearing or recovery command caused this review
round's history loss. Existing access purge removed colleague rows under Staff;
the shop-wide watermark then skipped those older rows on return to Owner.

Founder first approved a synthetic test-only reproduction (one restoration failure,
three isolation/pending controls), then separately approved local source repair in
sync/cursorStore.ts and pull.ts plus scoped tests/mocks. New device-local materialized
access metadata binds the watermark to server actor/scope/readable tables. Unknown
or different context restarts through existing atomic full hydration before any
incremental page apply; unchanged context stays incremental. Metadata persists
before access purge. Existing DB apply writers, pending protection, permissions,
server SQL/schema, accounting and hosted data remain unchanged. Role/scope changes
can cost a full fetch. Existing remote insert dirty-flag defaults are pinned in
synthetic tests rather than silently changed by this sync repair.

Metro was confirmed stopped before source edits. Local synthetic validation is
authorized; loading this repair onto the connected Dev and performing hydration
requires separate bounded approval after verification. No hosted writes or device
restoration have run. No-loss FAIL; Production/RC/pilot NO GO; Java dialog crash,
complete hardware/hosted/recovery/Admin gates remain open. No commit/push/merge.

## 2026-11-09–10 — isolated Android remediation, scoped approvals retained

The Founder approved the Android Metro Development Build baseline and routine
local fixes. Work is isolated in `remediation/android-metro-20261109` at `D:/md`;
Main, Production and Preview applications and their data are preserved.

The domain cash formula is unchanged. Business writers DID change under separate
Founder approvals; the earlier blanket claim that they were unchanged was wrong.
The approved groups implemented during 9–10 November 2026 are:

- **T04/T05:** synthetic-only sale/movement identity, sign, quantity and shop
  oracles, deterministic refund/return/allocation/conflict/group fixtures and
  negative controls. Existing evidence and sealed artifacts remain preserved.
- **T23:** all seven cash terms including refunds and supplier payments; additive
  read-only `db/cash.ts` refund projection from the existing formula. No formula,
  SQL, money writer or ledger calculation was changed in this group.
- **T20:** receipt-less new-batch route for Free Owners and Staff authorized by
  `inventory_edit` (server key `inventory_write`), distinct from the premium
  Owner supplier-receipt route. Separate approvals added a transaction-local
  medicine/shop/nondeleted guard in `db/inventory.ts::addBatchToMedicine`, then
  converted its async Drizzle callback to synchronous `.get()`/`.run()` calls so
  invalid quantity or movement failure cannot commit partial batch/outbox rows.
- **Seventeen additional transaction boundaries:** separately approved synchronous
  callbacks in `db/auth.ts`, `commercial.ts`, `inventory.ts`, `settings.ts`,
  `staff.ts` and `suppliers.ts`. Together with the T20 callback this changes
  eighteen writer transaction boundaries. The callables are `createShopAndOwner`,
  `setOwnerPin`, `recordSuccessfulLogin`, `getEffectiveEntitlementForShop`,
  `cacheShopSummaries`, `createMedicineWithBatch`, `createMedicineOnly`,
  `addBatchToMedicine`, `updateShopProfile`, `changeOwnPin`, `createStaff`,
  `resetStaffPin`, `deactivateStaff`, `removeStaff`, `writeAuditLog`,
  `createSupplier`, `updateSupplier` and `archiveSupplier`. Checks, hashing and domain formulas
  remain as before; transactional rollback behavior deliberately changes.
- **T16:** read-only shop-scoped pending/failed outbox counts and exposure UI;
  no sync writes, recovery journal or schema change.
- **Decimal editing:** separately approved `components/forms/FormField.tsx`
  retains editable numeric strings such as `1.` and `1.00` while emitting numeric
  RHF values. This changed input behavior, not integer-paisa conversion or writers.
  Claude F-08 subsequently found excess precision still needs explicit validation.
- **T03 dependency groups:** Next and eslint-config-next 15.5.29; Vitest 5.1.0
  (major test-tool upgrade), Node type compatibility, Zod 4.6.6 with Zod 3
  unchanged; scoped PostCSS/sharp/shell-quote and compatible xmldom, js-yaml,
  brace-expansion, node-forge, source-map-js, compression, Vite,
  postcss-selector-parser and test-only Undici pins/overrides. XLSX moved from
  mobile runtime dependencies to devDependencies for the independent export
  test. Expo 57/RN 0.86.2 and disabled dependency build scripts remain unchanged.
- **Android system bars:** `plugins/withAndroidLightSystemBars.js`, Expo plugin
  wiring and shell/modal presentation corrections alter native theme defaults
  and status-area presentation. No navigation or permission changes in this group.
- **10 November native approval:** upstream react-native-screens PR #4413
  backported to 4.26.2 as four C++ files in the pinned patch, workspace and
  lockfile. This changes native listener lifetime synchronization. A separately
  approved exact-hash Dev APK update preserved Dev data/session; finite cold-start
  checks do not establish universal crash freedom or release performance.

Approval provenance: Founder approvals are retained in the private execution
record and conversation for 9–10 November. Exact individual timestamps for the
above early groups are not retained; this entry does not invent day-specific
approval times. The native backport/build/install receipts are dated 10 November.
The Founder approved this disclosure correction on 10 November (Claude F-02).

**Claude review, 10 November: REVISE.** Staff receipt-less restocking stays enabled,
but T20 is PARTIAL: local SQLite and Free Owner device/server evidence do not
prove Staff server or hardware acceptance. F-01 server tests, F-05/F-06/F-11 fixture corrections and F-08 money validation
received separate scoped Founder approvals on 10 November; one additional pgtest
include and the actual-writer F-06 amendment were approved separately that day.
The amendment corrects the review premise: recordChange rereads complete rows
and serializes snake_case. Refund fixtures now snapshot those rows at refund
time, with real SQLite writer tests and independent cash/line invariants.
Money FormFields keep raw editing strings while invalid excess precision becomes
an explicitly rejected form value; shared taka schemas reject sub-paisa input.
fromTaka, accounting formulas and production writers are unchanged in this round.
The Founder separately approved the four custom cash inputs (OpeningCashModal,
WithdrawSheet, ManagerDashboard and cash-summary) to validate raw precision before
Number conversion, plus real SQLite regression tests. Current FormField handling
also consumes delayed native numeric echoes without replacing the latest raw draft;
Android exposed this defect and focused tests reproduced it before the fix.
The Founder approved F-03 Staff/Manager status contrast, F-04 non-destructive Dev
scanner inspection and F-13 consistent seven-term cash presentation with the
supplier-payments row always visible, including zero, as a deliberate T23
presentation decision. This supersedes the prototype's conditional supplier row;
the domain formula and financial ledgers remain unchanged.

No blanket authority covers hosted migrations, sync/auth/money/stock/recovery
changes, destructive device operations, real SMS/payments, deployment or paid
resources. No iOS or Batch 6 integration is implemented. No-loss remains FAIL;
full physical, hosted, recovery and Admin gates remain open. RC/pilot/Production
remain NO GO. Changes are uncommitted pending independent review and approval.
See [implementation record](docs/plans/android-remediation-2026-11-09.md) and
[Claude remediation scopes](docs/plans/claude-review-remediation-2026-11-10.md).


## 2026-10-18 — H-9 F1–F8 local remediation (hosted gates pending)

Founder authorized one coordinated local remediation batch. Canonical H1 tooling is
`scripts/h9/`; the external WS1 package uses an owner-protected allowlist/hash manifest,
native startup-environment bootstrap, pinned Node and unchanged pinned F12 evaluator/SQL.
Role/database/read-only/fingerprint continuity and deployed-state checks now fail closed;
source checkpoint remains pending even when local source-file hashes match: no
local manifest can establish hosted download provenance or produce full A5 PASS.
A2 stages 1–33 before
fresh gated 34. A3 uses strict catalog-v1 input/comparison and exact reviewed normalization,
not nested F12 snapshots. H5 requires real isolated PG17 restore proof; PG18 is supplemental.
Post-deploy rollback retains DEV ref and explicit legacy mode with compatible redeploys.
Execution/dependency details: `backend/supabase/deploy/H9-LOCAL-REMEDIATION.md` and
`backend/supabase/checks/h9_pg17_restore.md`. D1 prefers a new Free org only after eligibility
and $0 capacity verification; D2 password already held; D5 scratch retained. No hosted
authorization, password retrieval, project creation, migrations, deploy/build/SMS/device
operations, commit or push. The narrow F12 rehearsal hosted-evidence closure and
original E2 deviation stay unchanged. The separate N0 inspection record stopped
after CLI startup EPERM; eligibility/capacity/cost remain UNVERIFIED. This local
remediation conveys no hosted authorization, including N0 account reads.
Historical classifier remains separate. Final local evidence is recorded in
`docs/plans/h9-local-remediation-report-2026-10-18.md`.
### A running log of real decisions made during the build, dated, with a why.
### Read alongside CLAUDE.md, PROJECT_CONTEXT.md, TECH_STACK.md, and
### DEVELOPMENT_RULES.md.

---

## 2026-08-09 — Expo SDK 52 → current stable (SDK 57)

**What changed:** TECH_STACK.md originally locked "React Native 0.76+ / Expo
SDK 52." Day 1 foundation work instead targets **Expo SDK 57** (React Native
0.86, React 19.2), the current stable release as of this build date.

**Why:** SDK 52 (Nov 2024) was significantly behind current stable by the
time this repo's Day 1 was actually built. Greenfield Day 1 — before any app
code exists — is the cheapest possible point to absorb an SDK upgrade, rather
than starting already several majors behind.

**Tradeoff considered:** SDK 56 (2026-05-21), one release behind current
stable at build time. Rejected in favor of 57 given the short gap and that
no app code existed yet to make upgrading later costly.

**Follow-up:** TECH_STACK.md's Client section updated in the same change.

---

## 2026-08-09 — Shared design tokens shipped as JSON, not TypeScript

`packages/constants`'s actual values live in `src/tokens/*.json`, re-exported
by thin `.ts` wrappers. `apps/mobile/tailwind.config.js` is `require()`'d by
NativeWind's Metro plugin with no TypeScript transform active at that point;
JSON is readable by both that plain Node `require()` and normal TypeScript
`import` (via `resolveJsonModule`) — one source of truth, not two.

---

## 2026-08-09 — Internal package scope `@muthoy/*`

All `packages/*` (and `apps/mobile`) are scoped `@muthoy/<name>`. Purely an
internal-clarity choice — every package is `private: true` and never
published to a registry.

---

## 2026-08-09 — `formatMoney` uses `en-IN` digit grouping

Bangladeshi convention groups digits as lakh/crore (`১,০০,০০০` /
`1,00,000`), not the Western `1,000,000`. JavaScript's `Intl` has no `en-BD`
locale with this grouping, but `en-IN` produces the identical grouping
pattern, so `packages/utils/src/formatMoney.ts` and `formatNumber.ts` use it.
Flagged for founder review — a one-line constant change if this isn't
actually wanted.

---

## 2026-08-09 — Tailwind preset is a factory function, not a direct `require`

`packages/config/tailwind/native-preset.js` originally did
`require('@muthoy/constants/...')` directly, which created a workspace
dependency cycle (`packages/constants` already depends on `packages/config`
for its shared tsconfig/eslint base — `pnpm install` warned about exactly
this). Fixed by making the preset a factory function that takes tokens as a
parameter; callers (`apps/mobile/tailwind.config.js`) import
`@muthoy/constants` themselves and pass its exports in. `packages/config` now
has zero runtime dependencies, matching its role as the dependency-free base
every other package extends.

---

## 2026-08-09 — Metro's `disableHierarchicalLookup` must stay off with pnpm

`apps/mobile/metro.config.js` initially set `resolver.disableHierarchicalLookup
= true` (a commonly-suggested Expo monorepo setting). This broke bundling —
`@expo/metro-runtime` (nested inside `expo-router`'s own pnpm-resolved
dependency tree, not hoisted to a flat top-level `node_modules`) could no
longer be found. That option guards against wrong-version hoisting in
npm/yarn-classic flat `node_modules`; pnpm's symlinked, content-addressed
store doesn't have that failure mode, so the option isn't needed and actively
breaks resolution here. Removed — `unstable_enableSymlinks` + explicit
`watchFolders`/`nodeModulesPaths` alone are sufficient. Confirmed via
`npx expo export --platform web` after the fix.

`unstable_enableSymlinks: true` was also removed after `expo-doctor` flagged
it as a deviation from `expo/metro-config`'s defaults. Rather than keep an
override on the assumption it was needed, tested removing it: the bundle
still exports cleanly. SDK 57's Metro already handles pnpm's symlinks
correctly out of the box — the earlier `disableHierarchicalLookup` bug was
the actual (and only) necessary fix. `expo-doctor` now reports 20/20 checks
passing.

---

## 2026-08-09 — `apps/mobile`'s lint script is `eslint .`, not `expo lint`

`expo lint` auto-detects and explicitly passes conventional directories
(`components/`, etc.) to ESLint. Volume 2's skeleton folders (`components/`,
`db/`, `state/`, `domain/`, `sync/`, `native/`) currently hold only a
`README.md` each — zero `.ts`/`.tsx` files — and ESLint 9's flat config
treats an explicitly-passed directory with no matching files as a hard error,
not a no-op. Plain `eslint .` does its own broad discovery instead and
doesn't hit this; switched to it for robustness against empty
not-yet-populated folders. Revisit once these folders have real code — either
form will work then, but `eslint .` has no known downside either way.

---

## 2026-08-09 (Day 2) — Money is stored as INTEGER PAISA, not floating-point taka

**What changed:** the finalized `schema.ts` declared every money column as
`real` (floating point). All 23 money columns are instead `integer`, holding
a whole number of paisa (1 taka = 100 paisa). Approved explicitly by the
founder before implementation, per CLAUDE.md rule 10.

**Why:** floating point cannot represent decimal fractions exactly. Verified
during implementation: `10.10 + 20.20` evaluates to `30.299999999999997` in
float, while `1010 + 2020` is exactly `3030` paisa. A cash drawer that must
reconcile to the paisa (Volume 0's Day 7/Day 10, the project's highest-risk
work) cannot be built on a representation that drifts when summed.

**How the 100x mistake is prevented:** `Paisa` (packages/types/src/money.ts)
is a *branded* type — a number at runtime, but distinct from `number` to
TypeScript. Reading a paisa value as taka is therefore a compile error, not a
runtime surprise found while counting a real shop's cash. Conversion happens
only through `fromTaka()` / `toTaka()` / `asPaisa()`.

**Two columns deliberately NOT converted:**
- `shops.latitude` / `longitude` — geographic, not money; stay `real`.
- `sale_items.discount_value` — a discount RULE, not an amount (`10` means
  either 10% or ৳10, per `discount_type`). A percentage expressed in paisa is
  meaningless. The resolved money lives in `discount_amount`, which IS integer
  paisa.

**Coupled change in the same commit:** `packages/utils/src/formatMoney.ts` now
takes `Paisa` and converts at the display boundary. Had it been left taking
taka, every amount in the app would have rendered 100x too small.

### ⚠ HARD PRECONDITION FOR DAY 12 (Supabase schema)
`supabase-schema.sql` mirrors this schema for sync. Its money columns MUST be
integer (`BIGINT`), matching paisa. If the cloud side stays `numeric`/float
while the phone sends paisa, **every synced amount is wrong by 100x** —
silently, on real pharmacy money. This must be verified before Day 13's sync
engine moves a single row.

---

## 2026-08-09 (Day 2) — Local foundation schema is 24 tables, not 23 (historical baseline)

The playbook said 23 in five places; the finalized `schema.ts` defines 24.
The extra table is `conflict_queue` (P1 — the conflict-resolution UI is
post-beta, but the table ships now so the sync engine has somewhere to write).
Founder confirmed: keep all 24 including `conflict_queue`, correct the docs.
Updated in `00-execution-roadmap.md` (x2), `03-database-backend.md` (x2), and
`06-ai-prompt-library.md`.

> **Current status:** later additive B1/B2 migrations bring `schema.ts` to 36
> SQLite tables. The 24-table count remains correct for migration `0000` only.

---

## 2026-08-09 (Day 2) — First migration + the two PRAGMAs that make it real

**Migration file:** `apps/mobile/db/migrations/0000_open_senator_kelly.sql`
(62 statements, 24 tables, 38 indexes). Generated by `drizzle-kit`, never
hand-written. Never edit it after this commit — a schema change is always a
NEW migration (DEVELOPMENT_RULES.md).

**`PRAGMA journal_mode = WAL`** — crash-safe, concurrent read-while-write.
Persistent: stored in the database file itself.

**`PRAGMA foreign_keys = ON`** — SQLite ships with foreign key enforcement
**OFF by default**. Without this line every `onDelete` policy in schema.ts
parses cleanly and enforces nothing, so `ON DELETE RESTRICT` would silently
fail to protect financial and audit history (CLAUDE.md rule 2 satisfied on
paper, violated in reality). Unlike WAL this is **per-connection and resets to
OFF every time the database is opened**, which is why it lives in
`db/client.ts`'s open path, not in a migration.

**Verified, not assumed:** the generated SQL was applied to a real SQLite
engine (`node:sqlite`) and asserted: 24 tables created; all 46 foreign keys
carry an explicit `ON DELETE` (25 cascade / 19 restrict / 2 set null); an
`INSERT` referencing a non-existent shop was **rejected** — proving FKs are
actually enforced, not merely declared; `medicines.shop_id` = CASCADE,
`sale_items.batch_id` = RESTRICT, `sales.customer_id` = SET NULL.

**Still outstanding (founder, on a real device):** Volume 0 Day 2's own test —
write a row to `medicines`, read it back, in airplane mode.

---

## 2026-08-09 (Day 2) — SQLCipher deferred, but REQUIRED before pilot data

TECH_STACK.md lists SQLCipher (encryption at rest) and it **stays in the
stack** — this is a deferral, not a removal. Not done on Day 2 because it is a
native-build change (`useSQLCipher: true` in `app.json` + `expo prebuild` + a
fresh EAS build) plus a key-management design problem (where the key lives,
how it relates to the PIN) that deserves its own plan under CLAUDE.md rule 10.

**Deadline: before ANY real pharmacy/pilot data is stored.** Encrypting a
database that already holds a live shop's data means migrating that data;
right now the database is empty, so the change is nearly free. The `muthoy.db`
file created today is unencrypted — during development that is fine and can be
deleted and recreated at will.

---

## 2026-08-10 (Days 4-5/11) — Native bcrypt binding, not pure-JS

`react-native-bcrypt-cpp` was chosen over pure-JS options (`bcryptjs`,
`react-native-bcrypt`) for two verified reasons, not a stylistic preference:

1. **Security**: React Native's `crypto.getRandomValues` falls back to
   `Math.random()` unless explicitly polyfilled. Pure-JS bcrypt libraries
   depend on that source for salt generation — an insecure PRNG produces
   guessable salts, defeating the point of hashing at all.
2. **Performance**: pure-JS bcrypt is 3-50x slower than native C++ bindings.
   PROJECT_CONTEXT.md targets a 2GB-RAM Samsung Galaxy A14-class phone, and a
   PIN is entered on every app open — not a rare path. The chosen package's
   own published benchmark: ~14s (JS) vs ~0.3s (native, multithreaded) for
   the same hash.

`bcrypt-react-native` (a same-named, older alternative) was ruled out
specifically: last published 2022, before React Native's New Architecture
became the default — a real compatibility risk against RN 0.86.

**Requires New Architecture.** No `newArchEnabled: false` override exists in
`app.json`, and Expo SDK 57 defaults to it, so this should already be
satisfied — but unlike Day 2's schema work, this can't be proven from a
terminal. **The first EAS dev build after this change is the actual
confirmation point**; if linking fails, that is the signal New Architecture
isn't active.

Cost factor: 12 (a standard modern default). Native + multithreaded, so this
doesn't reintroduce the UI-blocking risk pure-JS bcrypt would have had at the
same cost factor.

> **REVERSED the same day — see "Reverted to bcryptjs" below.** The package
> turned out not to work on Android at all, for reasons no amount of reading
> its README could have revealed. The reasoning above was sound; one of its
> two premises (the `Math.random` claim) was also simply out of date.

---

## 2026-08-10 (Days 4-5/11) — Reverted to bcryptjs; the native package was broken upstream

The dev build failed at runtime with
`TurboModuleRegistry.getEnforcing('BcryptCpp') could not be found`. Root cause,
established by reading the package's own source rather than guessing:
**`react-native-bcrypt-cpp` ships no Android JNI registration whatsoever.** Its
iOS side has a working `ios/onLoad.mm` calling
`registerCxxModuleToGlobalModuleMap`; Android has no equivalent file, and its
`BcryptCppPackage.kt` is a stub whose `getModule()` returns `null` and whose
`getReactModuleInfoProvider()` returns an empty map. The C++ was compiled but
never connected to anything JS could reach — so it could never have worked on
Android, on any build, for anyone. (npm confirms the package was abandoned 8
days after first publish.) Nothing about this project's setup caused it.

Writing the missing bridge was attempted and got genuinely close: 8 distinct
build-configuration defects were found and fixed across 8 EAS builds (missing
`find_package(ReactAndroid)`, missing `prefab true`, static-vs-shared STL,
un-namespaced CMake targets, `react_nativemodule_core` not existing under
plain CONFIG mode, C++17-vs-C++20, codegen output never pulled in via
`add_subdirectory`, and `REACT_NATIVE_DIR` not being an ambient Gradle
property). Each fix was verified against real working packages in this repo
(gesture-handler, reanimated, nitro-modules) and each build got measurably
further. That work is preserved, **unreferenced and no longer applied**, at
`patches/react-native-bcrypt-cpp@0.2.3.patch`.

It was abandoned not because it was failing but because the remaining unknown
count wasn't zero and — critically — **even a successful compile would not
have proven the JNI registration actually works at runtime**, which was the
original bug. Maintaining a hand-written JNI bridge for an abandoned package
is also a long-term liability for a solo-founder project.

**The security premise for rejecting pure-JS was out of date.** `bcryptjs` v3
sources salt entropy from Web Crypto, then Node crypto, and **throws** if
neither is available — it does *not* silently fall back to `Math.random()`.
That was v2 behaviour, and it is the reason pure-JS bcrypt earned its bad
reputation. `native/crypto.ts` sets `setRandomFallback()` to `expo-crypto`'s
`getRandomBytes()` (the platform CSPRNG — `SecRandomCopyBytes`/`SecureRandom`),
so salts come from the OS secure source, exactly as the native module would
have. Without that line RN would throw, not silently weaken — the failure mode
is loud.

**The performance premise was real, and is handled by lowering the cost factor
from 12 to 10.** Cost 12 in JS is roughly 1-3s on the target Galaxy A14-class
hardware — too slow for a POS login on every app open; cost 10 is ~300-600ms.
The `hash`/`compare` async variants are used (not `hashSync`/`compareSync`)
because bcryptjs chunks async work across ticks instead of hard-blocking the
JS thread. Note that for a **4-digit** PIN the real defence against an attacker
holding the database is the 10,000-combination keyspace, not the cost factor —
that is addressed by attempt rate-limiting and by SQLCipher at rest (already
tracked above as a pre-pilot requirement), not by bcrypt tuning.

Because `db/auth.ts` and `db/staff.ts` only ever call `hashPin`/`verifyPinHash`
and never bcrypt directly, this swap changed exactly one file plus docs — no
SQL, no schema, no screens. The hash format is standard bcrypt in both cases,
so any hash already written remains verifiable.

---

## 2026-08-10 (Days 4-5/11) — Two stub signatures corrected against the real schema

Tracing the approved auth work against Day 2's actual `schema.ts` (not just
Volume 4's prose) surfaced two places where the original skeleton-phase stub
signatures couldn't actually implement the required flow:

**`users.pin_hash` is `NOT NULL`, but Registration and PIN Setup are separate
screens** (Volume 0 Day 4). The owner's `users` row is created during
`createShopAndOwner` with a placeholder hash — `hashPin()` of a freshly
generated random UUID, never a 4-digit string, so it can never match a real
PIN attempt through `verifyPin`. `setOwnerPin` overwrites it once PIN Setup
completes. This keeps the original two-call shape
(`createShopAndOwner` → `setOwnerPin`) intact rather than restructuring it
into one combined write.

**`verifyPin(userId, rawPin)` couldn't work as originally stubbed** — PIN
Login has no username step (Volume 4 AUTHENTICATION describes PIN-only
entry), so there is no `userId` to check against until AFTER a match is
found. Corrected to `verifyPin(rawPin)`: checks the PIN against every active
local user's hash and returns whichever one matched. Assumes one shop per
device (Volume 0's P0 scope — multi-shop is P1); revisit this function when
multi-shop ships.

---

## 2026-08-10 (Days 4-5/11) — Owner's `users.name` defaults to the shop name

**Flagged for founder review, not silently decided.** Volume 0 Day 4 is
explicit that Registration collects "shop name + phone only" — there is no
field for the owner's personal name. But `users.name` is `NOT NULL`. Rather
than add an unrequested field to the Registration form, `createShopAndOwner`
defaults the owner's `users.name` to the shop name. One-line change in
`db/auth.ts` if an owner-name field should exist instead.

---

## 2026-08-10 (Days 4-5/11) — react-native-mmkv v4's API is not `new MMKV()`

Caught by `tsc`, not assumed correct: v4 is rebuilt on Nitro Modules.
`MMKV` is now a TYPE only; instances come from `createMMKV(config)`.
Key removal is `remove(key)`, not the `delete(key)` used in v2/v3.
`state/sessionStore.ts` uses the v4 API throughout.

---

## 2026-08-10 (Days 4-5/11) — MMKV holds session only, never a PIN or its hash

Volume 4 STATE MANAGEMENT says "MMKV for PIN hash + session" — read as loose
phrasing for "the fast-storage layer used around PIN auth," not a literal
second copy of the hash living outside SQLite. `state/sessionStore.ts`
persists only `{ shopId, userId, role }`. CLAUDE.md rule 1 makes SQLite the
sole source of truth; duplicating a security-sensitive hash across two
stores needs a reason, and none was found. Flagged explicitly in the
approved plan before implementation — say so if a literal second copy was
actually intended.

---

## 2026-08-10 (Days 4-5/11) — `listStaff` returns staff only, not the owner

Volume 0 Day 11: "List existing staff with active/deactivated status." The
first implementation queried all users joined to roles and only excluded
`manager`, which meant the owner appeared in their own staff list. Caught
before wiring the screen: query now filters to `role.name = 'staff'`
directly in SQL, matching the function's name and the screen's actual intent.

---

## 2026-08-10 (Days 4-5/11) — react-hooks/set-state-in-effect (React Compiler)

Expo SDK 57 runs with React Compiler enabled, which flagged two real
patterns via `react-hooks/set-state-in-effect`:

- `PinPad.tsx`'s `usePinEntry` called `setPin('')` immediately after
  `onComplete(pin)` inside a `useEffect` watching `pin` — two `setState`
  calls chained from one effect run. **Fixed properly**, not suppressed: the
  complete-and-reset logic moved into `handleDigitPress` itself (an event
  handler, not an effect), where React just batches the two calls. No
  external system was being synchronized with, so an effect was never the
  right tool here.
- `app/staff/management.tsx` loads the staff list on mount via
  `useEffect(() => { reloadStaff(); }, [reloadStaff])`. This one keeps a
  scoped, commented `eslint-disable` — Volume 4 STATE MANAGEMENT explicitly
  rules out TanStack Query for local reads ("never used to fetch what a
  screen displays"), so there is no fetching-library hook to delegate a
  load-on-mount to; a plain effect is the correct tool, and the lint rule's
  heuristic (tracing through an async `useCallback` to the eventual
  `setState`) is overly broad for this specific, unavoidable pattern.

---

## 2026-08-10 (Days 4-5/11) — Auth verified in Node without importing db/auth.ts directly

`db/auth.ts` imports `expo-sqlite` (via `db/client.ts`) and the native
bcrypt binding — neither loads in plain Node, so it can't be `import`-tested
the way Day 2 tested raw migration SQL directly. Rather than add a new test
framework or a Node-side SQLite driver (`better-sqlite3`) to work around
this — outside the approved scope — verification mirrors the SAME SQL
operations `db/auth.ts`/`db/staff.ts` perform against a real `node:sqlite`
in-memory database (Day 2's pattern), plus the `verifyPin` search-for-a-match
algorithm proven independent of which library computes the hash. 22/22
checks pass: all 6 Zod schemas (valid/invalid BD phone, PIN shape, all three
confirm-match refinements), shop+3-roles+owner created atomically, `owner_id`
confirmed to have no FK (the placeholder-hash creation order actually works,
not just in theory), staff-role attachment creates no new role row,
`listStaff` returns staff only, deactivation flips `is_active` without
deleting the row, and an audit-log row's `action`/`target`/`meta` fields
contain no PIN-shaped value. **What this does NOT verify**: the actual
native bcrypt call, or the exact SDK-native `expo-sqlite`/Drizzle wiring —
both remain device-only checks (Volume 0 Day 4's own checklist: "PIN is
stored hashed (inspect the DB row directly)").

---

## 2026-08-11 — Explicit PIN completion marker recovers interrupted registration

`users.pin_set_at` is a nullable completion marker. Owner registration writes
the shop/user with the existing unmatchable placeholder hash and leaves the
marker null; `setOwnerPin` replaces the hash and sets the marker in one write.
The root gate can therefore resume an interrupted registration at PIN Setup
with the original `shop_id`/`user_id`, instead of sending the owner to an
impossible PIN Login.

Migration `0002_furry_celestials.sql` is additive: it adds one nullable column
and deletes or replaces no existing rows or hashes. Existing owner rows remain
null and complete PIN Setup once. Existing staff rows are backfilled from
`updated_at` because staff creation has always stored a real PIN hash directly
and never used the owner placeholder. New staff creation and staff PIN reset
set `pin_set_at` with the hash, preserving the Day 11 staff PIN-login flow.

`verifyPin` ignores users whose marker is null. `role-select` remains
unreachable/deferred; owner and staff continue using the same PIN-only login.

---

## 2026-08-12 — Purchases shipped early with owner-only financial access

The full supplier/purchase-invoice feature remains classified P1/post-beta in
the roadmap, but the founder explicitly approved implementing it early. This is
a deliberate scope exception, not a change to the general P0/P1/P2 rule.

Supplier details, payables, and purchase creation are owner-only. The UI guards
all three supplier routes, and every supplier/purchase DB operation that exposes
financial data independently revalidates the active owner against local SQLite;
all reads and writes remain shop-scoped. Purchase invoices use
`PUR-{YYYY}-{6-digit-seq}`.

> **Superseded 2026-08-30:** invoices now add the 12-character UUID-tail suffix.
> General supplier/purchase management remains Owner-only, but the narrow
> explicit `inventory_add` grant may create one new medicine through its opening
> purchase graph. Supplier pay-down and purchase-return credit have shipped.

COD purchases are fully paid at creation, record a cash supplier payment, and
recompute the cash drawer. Credit purchases create no immediate cash movement;
their outstanding supplier payable is derived from
`purchases.total - purchases.paid_amount`, never cached separately.

---

## 2026-08-12 — Customer credit balance is derived; collections are atomic

Customer records retain name, phone, address, and notes, while checkout's picker
reads only id/name/phone. All customer, credit, payment, and drawer operations
are shop-scoped.

Outstanding balance is derived as credit sales minus collections; it is never
maintained as a mutable cached total. Over-collection is rejected. Cash
collections recompute today's expected cash drawer, while non-cash collections
reduce the credit balance without touching the drawer.

`collectPayment` deliberately uses a synchronous/no-await transaction callback:
the balance check and payment insert must remain within one uninterrupted SQLite
transaction. Standalone `recordCreditSale` remains intentionally out of scope;
checkout already creates sale-backed credit rows atomically.

---

## 2026-08-12 — Notifications shipped early; device-local and fail-closed (historical scope classification)

Notifications remain classified P1/post-beta, but the founder explicitly
approved implementing them early as a scope exception. Low-stock alerts use a
resolved marker for threshold-crossing hysteresis; expiry alerts always compute
from the real batch expiry date. Notification history stays device-local and is
excluded from the sync outbox.

One shared OS background task runs all checks, with foreground activation as a
self-heal. Delivery near 8 PM is best-effort because Android Doze and OEM task
killing control actual wake time. Daily cash summaries require a persisted owner
session plus fresh SQLite owner validation; staff sessions cannot create, count,
or list those rows. If staff is last logged in, that day's summary is skipped.

No custom notification icon exists yet. Expo's default remains in use until a
real design asset is supplied. Adding the native modules requires a fresh EAS
development-client build before device validation.

Successful sales start a fire-and-forget notification check only after the sale
transaction commits. Notification failures therefore cannot fail or roll back
the completed sale. Low-stock semantics remain unchanged: stock below the
threshold creates one unresolved alert, recovery at or above the threshold
resolves it, and a later drop can alert again.

Notification permission and channel initialization runs from normal,
authenticated foreground app startup; opening Notification Center is not a
prerequisite. Android also ensures the channel immediately before posting. If
OS permission is denied, the system banner is suppressed, but the in-app row
created before delivery may still exist in Notification Center.

> **Current status:** B1 later completed notification inbox preferences,
> per-user device-local receipts, permission filtering, and overdue-credit/
> closing-time behavior. The device-local/fail-closed decisions above remain.

---

## 2026-08-13 — Beta sync uses row-level last-write-wins (superseded for stock and grouped operations)

The Beta sync engine resolves every competing row version, including stock,
using updated_at last-write-wins. conflict_queue and stock delta-merge stay P1
and must ship before any multi-device shop pilot. Beta remains one active device
per shop.

> **Superseded:** the 2026-08-18 derived inventory ledger replaces LWW stock;
> separate-device login and atomic B2-B3 operation groups now ship in committed
> code. LWW remains only for eligible standalone row fields, never as a
> substitute for stock or a multi-row money/stock transaction. Remote rollout
> of the current schema/functions is still pending.

---

## 2026-08-13 — Synced Postgres rows preserve client edit timestamps

The Postgres mirror does not attach a generic updated_at trigger to synced
tables. Sync writes preserve the canonical client edit timestamp because
replacing it with server arrival time would corrupt LWW ordering.

---

## 2026-08-13 — Supabase shop identity lives in app metadata

Cloud isolation reads app_metadata.shop_id, not client-writable user metadata.
RLS protects direct table access; the Edge Function independently verifies the
same claim for service-role sync calls; sync RPC execution is restricted to the
service role.

---

## 2026-08-13 — Synced SQLite timestamps use canonical ISO strings

All synced write sites stamp created_at and updated_at with Date.toISOString().
Local LWW comparisons parse timestamps to epoch milliseconds instead of
comparing mixed SQLite and ISO strings.

---

## 2026-08-16 — Day 5 Morning Dashboard and navigation shell are complete (historical; superseded by B1)

Volume 0 Day 5's navigation shell, PIN login loop, and MorningDashboard shell
all ship. `app/(tabs)/_layout.tsx` is a minimal 3-tab bar (Dashboard, Sale,
Inventory); MorningDashboard shows the shop-name greeting plus a
permission-filtered tile list (`hasPermissionForRoleName`, see the Day 11
entry below) routing to every implemented P0 screen — this functional P0
navigation is done and exercised by every screen built since.

`StandardHeader` is live and used by most Day 6+ transactional/detail screens
(Sale's cart/checkout/confirmation, Inventory's tab/add-medicine/batches/
expiry, Cash Summary/Expenses/End of Day, Credit, Suppliers, Notifications).
MorningDashboard and Registration are documented in-code as deliberately
exempt (Volume 4 Navigation). Several other screens built since — Settings,
Staff Management, the PIN/OTP auth flow, Reports — do not yet call it; Volume
4's "every screen" framing describes the intended end state, not verified
current coverage.

Visual/UX parity with `apps/prototype-web`'s Figma-level polish is a separate
question from the above. CLAUDE.md rule 15 already keeps the prototype
reference-only for layout/UX ideas — its React Web architecture, styling, and
state management are never ported into React Native, on any timeline, not
just "for now." Beyond that permanent architectural boundary, no day in
`docs/playbook/00-execution-roadmap.md` commits to a specific visual-polish
pass, and neither does the P1/P2 list in that same volume.

> **Current status:** B1 replaced the minimal 3-tab/incomplete-route shell with
> role-correct Owner/Manager/Staff navigation, Scan/More, Quick Links, and
> route/data permission parity. The prototype-reference boundary above remains.

**Audit note:** this entry was written in response to a request to also
record that prototype-level UI parity is "deferred to Days 26–28." That
figure does not appear anywhere in this repo — not in `docs/playbook/`, not
in `apps/prototype-web/`. It is not recorded here because it cannot be
verified against the live docs; if it is a real commitment made outside this
repo, it should be added explicitly with its source, not inferred.

---

## 2026-08-16 — Day 9 Expiry Management is complete; batch/medicine reads are join-isolated per shop (backfilled)

`app/inventory/expiry.tsx` lists every non-deleted batch shop-wide, nearest
real expiry date first, via `db/inventory.ts`'s `listBatchesByExpiry` —
sorted through the same `domain/fefo.ts` `sortByExpiry` the checkout
deduction path uses, never a second hand-rolled sort (CLAUDE.md rule 3: the
real `expiryDate`, recomputed at read time, never a stored day-count).

**Security decision:** the batch→medicine join enforces shop isolation on
BOTH sides. The `INNER JOIN`'s ON clause requires `medicines.shop_id =
shopId`, not only a later `WHERE` on `batches.shop_id`. A batch row whose
`medicine_id` points at another shop's medicine — a corrupted or hostile sync
payload — matches nothing and is dropped, instead of rendering that other
shop's medicine name under this shop's batch row. Filtering only
`batches.shop_id` would have leaked it (CLAUDE.md rule 7: one shop can never
see another's data).

The "Soon" threshold uses the shared repo-wide default
(`domain/notificationRules.ts`'s `EXPIRY_WINDOW_DAYS_DEFAULT = 30`), the same
window the Notifications expiry job alerts on, so the badge on this screen
and the alert the owner receives always agree. A per-shop configurable
threshold does not exist in the schema and needs a real Settings slice
(Volume 4 SETTINGS) before it can be built — intentionally deferred, not
started.

> **Superseded 2026-08-30:** shop settings now persist/sync configurable Near
> and Far bands (defaults 30/60), and all expiry consumers use them against the
> Asia/Dhaka business date.

---

## 2026-08-16 — Day 10 Expenses/Cash Summary/End of Day are complete (backfilled)

`db/cash.ts` implements the full Day 10 slice: `recordExpense` (one
transaction writing both the `expenses` row and its `payments` row,
type='expense'), `setOpeningCash` (CLAUDE.md rule 5 — defaults to 0, set by
the user, written only against the business date passed in, never inherited
from yesterday), `getCashSummary`/`listExpenses`/`getEndOfDaySummary` (every
figure derived from `domain/cashFormula.ts`'s fixed formula — CLAUDE.md rule
4, never re-derived here), and `closeDay` (locks `cash_drawer`, recomputing
`closing_expected` from the ledger rather than trusting whatever the screen
last rendered, and storing `closing_counted` plus the resulting variance).
Money stays integer paisa throughout, consistent with the Day 2 decision.

**Closed-day guard:** `assertBusinessDateOpen` runs first, inside the same
transaction, for every write that could still affect an already-closed
date's locked snapshot — expenses, opening cash, sales (cash and credit),
customer credit collections, and supplier purchases (both COD and
credit-terms; a credit-terms purchase's stock write is blocked too, not just
its payment). A write against a closed date throws `DayClosedError` before
touching any row, so the transaction rolls back with zero partial rows or
outbox entries (proven in `db/closed-day-guard.sqlite.test.ts`).

> **Superseded interface note:** receipt-photo capture remains deferred, but
> `recordExpense` no longer accepts or stores a `receiptPhotoUri`.

**Verification on record:** automated coverage (`db/cash.sqlite.test.ts`,
`db/closed-day-guard.sqlite.test.ts`, `domain/cashFormula.test.ts`) runs a
full simulated day — opening cash, multiple cash/credit sales, an expense, a
credit collection, close — and asserts every Day 10 Validation Checklist line
by hand-calculated value; it is green. Volume 0's required real-device human
verification pass (Human Review Workflow, CLAUDE.md) for Day 10 is not
evidenced anywhere in this repo and should not be read as done from this
entry — automated test coverage is not a substitute for it
(DEVELOPMENT_RULES.md: "'AI said it works' is NOT done").

---

## 2026-08-16 — Day 11's centralized P0 permission model is complete (historical; superseded by the 2026-08-30 B1 baseline)

The SIMPLE two-role model Volume 0 Day 11 specifies (Owner = everything,
Staff = `sales` + `inventory_view` only; the full Owner/Manager/Staff matrix
stays P1) is implemented as one grant table, `domain/permissions.ts`:
`hasPermission(role, permission)` for code already holding a narrowed `Role`,
and `hasPermissionForRoleName(roleName, permission)` — the fail-closed entry
point for code holding a raw/untrusted role string (a persisted MMKV
session, or a `roles.name` read back from SQLite). The latter denies every
permission for anything `toRole` cannot narrow to exactly `'owner'` or
`'staff'`, including the P1 `manager` role every shop already carries from
registration, and any unknown/null/empty value.

Enforcement is two-layer, and both layers resolve through the same table so
they cannot disagree:
- Route guards (`state/usePermission.ts`) decide what renders; a denied role
  sees `components/ui/AccessDenied.tsx`, never a crash.
- Action guards (`db/auth.ts`'s `requirePermission`/`requireOwner`) re-derive
  the actor's role from SQLite — never from the session store — and run
  FIRST, before any query or transaction opens, so a denied direct-navigation
  write leaves zero rows and zero outbox entries. Proven in
  `db/permissions.sqlite.test.ts` by calling the `db/` actions directly, with
  no screen involved.

Fail-closed for manager/unknown extends to login itself: `verifyPin`
resolves the matched user's role through `toRole` and skips a manager/unknown
match entirely — such a PIN mints no session at all, rather than a session
whose role every downstream guard would then have to keep rejecting.

Current P0 permission keys, all owner-only except `sales`/`inventory_view`:
`staff_management`, `cash_management`, `settings_manage`, `credit_management`,
`inventory_write`. This covers cash/expenses/EOD, staff management and PIN
reset, Settings (including an owner's own PIN change — staff self-service PIN
change is NOT allowed; only an owner-driven `resetStaffPin`), and the
early-shipped supplier/purchase surface (still gated via `requireOwner`,
having no P0 permission key of its own) plus standalone customer-credit
management (`credit_management` is deliberately separate from `sales` — a
Staff-made credit SALE at checkout still works, because `createSaleTransaction`
writes the credit row itself). Cash-sensitive and Settings reads are gated at
the API (`getCashSummary`, `listExpenses`, `getEndOfDaySummary`,
`getShopProfile`), not just behind a hidden route — hiding a tile is
convenience, the API call is the enforcement.

Owner-configurable per-staff permissions and the full Manager matrix remain
P1 and are not implemented — `toRole` denying `'manager'` outright is the
explicit placeholder until that matrix ships.

**Verification on record:** automated coverage (`domain/permissions.test.ts`,
`db/permissions.sqlite.test.ts`, plus the permission assertions folded into
`db/cash.sqlite.test.ts` and `db/closed-day-guard.sqlite.test.ts`) proves
owner-allowed / staff-denied / manager-denied / unknown-role-denied for every
P0 permission, with zero side effects on denial, across direct db/-action
calls (the direct-navigation-bypass case) — 289 tests green as of this entry.
As with Day 10 above, Volume 0's required real-device human verification pass
is not evidenced in this repo and is not claimed here.

---

## 2026-08-17 (Day 14) — Basic Admin Panel ships as a server-only Next.js app

`apps/admin` implements Volume 0 Day 14 / Volume 5's P0 scope and nothing more:
**exactly two read-only pages**, both server components.

| Route         | Shows                                                      |
| ------------- | ---------------------------------------------------------- |
| `/`           | Total shops, total sales today (all shops, Asia/Dhaka day) |
| `/pharmacies` | Shop name, phone, registration date, plan                  |

Next.js 15 App Router, TypeScript strict, Tailwind v3. **Zero `'use client'`
files exist in the app** — that is the architecture, not a coincidence: a page
that cannot run in the browser cannot leak a server credential through a hook,
a prop, or a serialized RSC payload. Brand colors/radii come from
`@muthoy/constants` JSON tokens, money renders through `@muthoy/utils`'
`formatMoney` on branded `Paisa` values, and fonts bind through `next/font` CSS
variables (CLAUDE.md rule 6) rather than hardcoded family names.

Deliberately absent, per Volume 5's P1 line: charts/Recharts, maps/Leaflet,
subscription management, MRR/revenue, analytics, audit-log views, reports,
search/filter, per-shop drill-down, admin Users/role management, admin
settings. Note that TECH_STACK.md's Admin Panel section lists shadcn/ui,
Recharts and Leaflet — those are the P1 end state; none are installed today.

### The credential model

Volume 5's one governing rule is that the service-role key lives in server-side
code only. Four independent mechanisms enforce it rather than one:

1. `lib/env.ts` is the **only** module naming `SUPABASE_SERVICE_ROLE_KEY`, and
   the variable is deliberately not `NEXT_PUBLIC_`-prefixed, so Next never
   inlines it into client JavaScript.
2. `lib/env.ts`, `lib/supabaseAdmin.ts` and `lib/queries.ts` each open with
   `import 'server-only'` — importing any of them from a client component is a
   **build failure**, not a runtime surprise.
3. No client components exist to import them from.
4. `lib/errors.ts` sanitises failures: the browser gets a fixed sentence, the
   detail goes to the server log, so a Postgres error can never carry schema or
   connection detail into the page.

`lib/serviceRoleExposure.test.ts` asserts 1-3 on every test run by scanning the
app's own source, so the guarantee degrades loudly rather than silently.

### Basic Auth is a temporary P0 gate, not the P1 auth feature

`middleware.ts` puts HTTP Basic auth (constant-time comparison) in front of
every route and **fails closed** — with `ADMIN_BASIC_AUTH_USER` /
`ADMIN_BASIC_AUTH_PASSWORD` unset, every route returns 503 rather than serving.

This was added because Volume 0 Day 14 specifies no authentication at all for
the admin panel, and a deployed admin URL with no gate publishes every
pharmacy's name and phone number to anyone who finds it. A single shared
credential is the minimum that closes that hole inside P0 scope.

**It is explicitly not production admin authentication.** Real admin identity
(individual accounts), RBAC (Volume 5's P1 super-admin vs support-read-only
split), MFA, session management, and audit of admin access all remain **future
hardening** — none is implemented, and Basic Auth should be replaced rather
than extended when they land.

### Live Supabase verification: FAILED FIRST, fix written, NOT yet re-verified

Run against the live Supabase project, both pages failed:
`permission denied for table shops` (SQLSTATE 42501), and the dashboard's
shop-count query failed the same way.

**Root cause:** `service_role` carries `BYPASSRLS`, which skips row-level
*policies* but confers **no table privileges**. PostgREST still runs
`set role service_role`, so every statement is checked against the table ACL
first — and `20260813000000_initial_schema.sql` creates all 21 business tables
while issuing no table-level `GRANT` for any of them. Only `shop_claims` and
the four sync functions ever received explicit grants. Sync was unaffected
precisely because it goes through the `SECURITY DEFINER` functions
`sync_apply_row` / `sync_pull_changes`, which execute with the definer's
privileges.

**This is corrected by two new additive migrations. Neither edits the applied
initial schema.**

`20260817000000_admin_read_grants.sql`
```sql
grant select on table public.shops to service_role;
grant select on table public.sales to service_role;
```
Why: `shops` backs the pharmacy list and the shop count; `sales` backs today's
platform total. Those are the only two tables `lib/queries.ts` touches, and it
joins nothing. Least-privilege scope: `SELECT` only (the panel never writes),
those two tables only, `service_role` only — `anon` and `authenticated` gain
nothing. `ALTER DEFAULT PRIVILEGES` was deliberately **not** used: it would
silently grant `service_role` access to every future table. New tables must opt
in explicitly.

`20260817000100_sync_roles_read_grant.sql`
```sql
grant select on table public.roles to service_role;
```
Why: auditing the same failure class across the repo found a second instance
outside the admin panel. `functions/sync/push.ts` authorizes an incoming
`permissions` row by reading the owning role's shop **directly** through
PostgREST (`.from("roles").select("shop_id")`) — the one sync database access
that does not go through a `SECURITY DEFINER` function, so it runs as
`service_role` and hits the same empty ACL. Its failure mode is worse than a
visible error: `authorizeRow` maps the error to a *transient* rejection and
`push` then sets `halted = true`, so the permissions row never applies and
every later row in the batch is skipped — the batch retries forever instead of
failing loudly. Least-privilege scope: `SELECT` only, `roles` only,
`service_role` only. A column-level `grant select (id, shop_id)` was considered
and rejected — `roles` holds no sensitive column and `service_role` can already
read every column of it via `sync_apply_row`, so it would buy no
confidentiality while breaking silently the moment that SELECT list changes. A
new `SECURITY DEFINER` lookup function was also rejected as larger, not
smaller: it adds a privileged function to review and requires editing `push.ts`.

Neither migration adds, drops, or alters any policy; RLS stays exactly as the
initial migration left it, as do the `shop_claims` revoke and the sync RPC
`EXECUTE` lockdown. Neither grants any write privilege.

**Status, stated plainly: the migrations are written but NOT deployed.** The
live "permission denied" failure has therefore not been re-tested and the admin
panel is not yet known to work against live Supabase. Deploy with
`supabase db push --dry-run` then `supabase db push` from `backend/`, then
re-run the pages before treating Day 14 as verified.

### Verification actually performed — and what was not

Performed:
- 48 automated tests across `lib/platformStats.test.ts` (14),
  `lib/basicAuth.test.ts` (15), `lib/serviceRoleExposure.test.ts` (8) and
  `lib/adminGrants.test.ts` (11), plus `backend/.../sync/grants.test.ts` (12)
  guarding the sync grant. The two grant guards were checked against the
  pre-fix migration set to confirm they actually fail without the fix, rather
  than passing vacuously.
- `next build`, typecheck and lint clean; production server started and both
  pages loaded.
- Key-exposure check with a **sentinel (fake) credential**: its value appears
  nowhere in `.next/static`, anywhere else in the `.next` output, or in any
  HTTP response body, on both pages, authenticated and unauthenticated.
- Basic Auth fail-closed confirmed (503 with the variables unset).

**NOT performed — do not read this entry as claiming any of it:**
- Volume 0 Day 14's own Human Review item: the founder checking devtools'
  network tab personally, **with the real production key**. The sentinel check
  proves the mechanism, not the deployed secret.
- Day 14's Testing Checklist item: register a test shop on the mobile app, sync
  it, confirm it appears in the admin panel within one sync cycle.
- Any run against live Supabase after the grant migrations (see above).
- Any deployment of `apps/admin` to Vercel.

One unrelated pre-existing test is red and was left alone as out of scope:
`db/permissions.sqlite.test.ts`'s "refuses to log a manager in at all" times
out at 5000ms under full-suite parallel load (it passes alone at ~2.5s, already
half its budget). Confirmed pre-existing — it fails identically with the Day 14
test files excluded.

---

## 2026-08-18 — Multi-device inventory: stock becomes a derived ledger, not a synced column

**The bug this replaces:** `batches.stock` was a plain LWW-synced integer.
Two devices selling from the same batch offline each computed their own new
absolute stock and pushed it; sync then kept whichever write had the later
`updated_at` and silently discarded the other device's sale from the stock
figure. Not a rare edge case — the default outcome of any two-device shop.

**The fix, in both SQLite and Postgres:** `batches.stock` is now a derived
projection — `stock = SUM(inventory_movements.change_qty)` — enforced by a
trigger guard in each store (`batches_stock_guard` / SQLite,
`batches_stock_is_ledger_derived` / Postgres) that rejects any write to
`stock` not equal to `OLD.stock` plus the ledger delta being applied. Every
stock change (sale, purchase, adjustment, opening quantity) is a signed
`inventory_movements.change_qty` row; the apply trigger
(`inventory_movement_applies_delta` / `apply_inventory_movement`) is the only
writer of `stock`, and it **adds**, so two devices' concurrent deltas combine
instead of one clobbering the other.

**New batches start at `stock: 0`, then take an opening movement** through the
same `addStock` path every later sale/purchase uses — never baked into the
insert as a special case. Every batch's history is therefore complete back to
row zero; there is no bootstrap exception for the guard to special-case.

**Movements are append-only.** The existing UPDATE-immutability trigger is
joined this round by a DELETE guard in both stores
(`inventory_movement_is_undeletable` / `inventory_movement_no_delete`,
Postgres errcode `MU007`) — a movement can never be physically removed, only
tombstoned (`is_deleted`), and a tombstoned movement's delta deliberately
stays in the ledger sum because it genuinely happened. No legitimate write
path needs physical deletion.

**Devices/cloud rows that predate the ledger** hold stock with no movement
history at all — the guard would reject every future write to them. Migration
`0006` (SQLite) and `20260818000000`/`20260818000100` (Postgres) backfill one
synthetic `adjustment` movement per gap, using an id **deterministically
derived from the batch's own UUID** (its version nibble set to `8`) so the
device and the cloud, backfilling the same historical gap independently, mint
the identical primary key and reconcile as a no-op instead of doubling the
quantity. Both backfills fail loudly (abort, never skip) on a stock gap in a
shop with no user row to attribute it to.

**Hydration ordering:** `HYDRATION_TABLE_ORDER` now applies to both full and
incremental pulls (previously only full hydration had it — an incremental-pull
gap found and fixed this round). Full hydration for a fresh device runs as one
transaction, so a device is never left observing a partially-applied ledger.

**Offline reconciliation keeps oversells, flagged, never silently drops or
clamps them** — an offline sale that oversells is written with `oversold_at`
set; `displayableStock()` clamps only what the UI renders, never what is
stored or summed.

**Realtime is a signal, not a data channel.** `sync/realtime.ts` subscribes
to `batches` (its `updated_at` moves on every applied delta, covering sales,
purchases, returns, and adjustments alike) per shop; the payload itself is
discarded, and receipt just triggers the existing incremental pull, so there
remains exactly one apply path with FK ordering, LWW, and ledger idempotency
all still enforced normally — no second, forked apply path for CDC payloads.

**Invoice numbers gained a 12-character UUID-tail suffix**:
`{INV|PUR}-{YYYY}-{6-digit-seq}-{12 uppercase hex}` (`domain/invoice.ts`). The
sequence is still counted per-device and two phones can still both reach, say,
document 11 — that is now expected and harmless, because the suffix (the
UUID's own 48-bit node field, taken from the tail, not the fixed-nibble head)
is what `sales_shop_invoice_unique` / `purchases_shop_invoice_unique`
actually rests on. Before this, a same-sequence collision from two offline
devices was silent, permanent data loss for the second sale at sync time.

**Deferred, explicitly:**

> **Status superseded 2026-09-05:** separate-device login, full-sale refund,
> purchase returns, audited adjustment/reconciliation, and the remote ledger
> rollout have shipped and passed their recorded verification. A distinct
> general write-off workflow remains deferred. The ledger rationale above
> remains active.

---

## 2026-08-20 — PIN authentication latency state

Physical Android testing observed an approximately 15–16 second baseline after
PIN confirmation and phone + PIN login. The perceived freeze is fixed: all four
PIN bullets paint and an immediate loading state is shown while the existing
work completes. Actual latency reduction has not yet been proven.

**PHYSICAL TIMING VALIDATION: PENDING.** Development-only timing instrumentation
now separates input validation, local bcrypt work, Edge invocation, server
processing, identity work, session minting/validation, hydration, initial sync,
and navigation/render completion. Mobile timing logs are guarded by `__DEV__`;
server timing additionally requires explicit development environment flags. No
PIN values, phone/account identifiers, tokens, or other sensitive values are
logged.

No bcrypt cost, PIN validation, required server validation, hydration, or other
security guarantee was weakened. The temporary DEV OTP bypass was removed in H-2
(2026-09-06); disabling anonymous sign-in in every Supabase project remains a
hosted setting to apply. Production Owner registration requires a real OTP
provider. Normal Owner and Staff login remains phone + PIN; OTP is used only for
registration and Owner PIN recovery.

---

## 2026-08-20 — Native Android PIN crypto and indexed local login

The physical 30–33 second Staff confirmation was two serial pure-JS bcryptjs
operations on Hermes: one uniqueness comparison against the Owner plus one
hash. Enrolled PIN login was also linear in user order, at approximately
15–16 seconds per comparison. Network sync was fire-and-forget, but could begin
before the destination rendered.

Android now uses a local Expo module wrapping `at.favre.lib:bcrypt` 0.10.2 at
unchanged cost 10. Its standard bcrypt hashes verify existing `$2a$`/`$2b$`/
`$2y$` credentials; no credential rewrite is required. The earlier bcryptjs
decision above remains historical context and is superseded for Android.

Migration 0008 is SQLite-only. It adds a local Android-Keystore HMAC-SHA256 PIN
lookup tag bound to `pin_set_at`. The non-exportable key and tag never sync;
plaintext/recoverable PIN storage was not introduced. Current users get O(1)
device-wide lookup plus one bcrypt compare. Staff uniqueness is one lookup plus
one hash, including when multiple shops exist locally. Legacy
untagged hashes are native-verified and lazily tagged on successful login; that
one-time compatibility scan is the explicit exception.

Hard product rules: enrolled PIN login is local and navigates before any
network work; Staff creation navigates after the SQLite/permissions/outbox
transaction commits; background sync starts only after navigation interactions.
Fresh-device login still awaits Edge verification, session adoption, full
hydration, and one exact-user local bcrypt verification, but not initial sync.

Targets: enrolled login <=2 seconds (ideally <1 second), Staff creation <=2–3
seconds on target Android hardware. Development timings now separate lookup,
bcrypt compare/hash, SQLite/permissions/outbox, Edge/session, hydration,
navigation, and background-sync start. **PHYSICAL TIMING VALIDATION: PENDING.**

---

## 2026-08-21 — Phase B2 sales and inventory contracts

Phase B2 follows `docs/plans/phase-b2-sales-inventory.md`. Locked rules:

- Stock expired before the Asia/Dhaka business date is unsellable; null expiry
  remains sellable and FEFO-last. Checkout allocates and prices every consumed
  batch inside one SQLite transaction, using integer paisa and requiring
  reconfirmation after a changed quote.
- Per-batch percentage promotions apply before one sale-level amount/percentage
  checkout discount. Split tender is cash plus customer credit only. Holds do
  not reserve stock. Prescription metadata and image are optional/non-blocking.
- Refund is full-sale only, reason-required, deterministic/idempotent, and
  reverses the exact original payment components. Before any physical payout or
  local refund mutation, `sync/` must obtain the sale's sole active server claim.
  Offline Refund stays disabled with “Internet required for refund” and changes
  no sale, stock, cash, credit, or ledger state. Claims never auto-expire or
  reassign; only their bound operation/device can resume until server commit.
- Shop low-stock fallback is 10 with a nullable medicine override. Expiry bands
  are Near 0–30 and Far 31–60 days. Duplicate same-shop barcodes are allowed and
  require an ambiguity picker. Archive is soft and requires zero ledger stock,
  no unresolved oversell, and no active promotion. Owner CSV import is previewed,
  validated, and committed as one ledger/outbox operation.

The founder approved the B2 safety gate for local implementation only. This
implementation-status sentence is historical: B2 code was later implemented,
committed, and remotely deployed. See the 2026-09-05 completion entry.

---

## 2026-08-22 — Owner Dashboard functional parity

Follows `docs/plans/owner-dashboard-parity-recovery.md`. The prototype's
`MorningDashboard` is the functional source of truth; production SQLite, the
fixed cash formula, FEFO, the stock ledger, permissions, and sync remain the
implementation authority. Founder decisions, approved 2026-08-22:

1. **Alert previews.** Expiry and Low Stock each show at most 3 rows, and
   "+N more" is computed from the unbounded SQLite COUNT. This supersedes the
   prototype, which rendered 2 rows from a list already capped at 5 and could
   therefore never report more than "+3" however many batches were expiring.
2. **Credit period.** New synced `shop_b2_settings.credit_max_days`, default 7,
   mirroring `max_refund_days`. A credit is overdue once its local creation
   date is older than that many days — `credits` carries no due date — and the
   overdue figure counts distinct customers, not rows.
3. **Expected Cash card.** Shows the exact expected total from
   `domain/cashFormula.expectedCash` plus a Details link into Cash Summary.
   No partial "open + sales − expenses" subtitle: three of the seven fixed
   terms would disagree with Cash Summary the moment a refund, collection,
   supplier payment, or withdrawal existed (CLAUDE.md rule 4).
4. **Complete Day.** The dashboard card routes to the existing `/end-of-day`
   and its real `closeDay`. The prototype's three-step modal, whose success
   step wrote a fake `dailyHistory` archive, is superseded.
5. **New Sale button.** Removed from the Owner Dashboard. The prototype reaches
   Sale through the bottom navigation shell, which B1 already ships.

Two money-correctness defects were fixed ahead of any new surface:
`getStaffPerformance` valued a staff member's credit, split, and free sales at
zero (`CASE WHEN payment_type = 'cash'`) and listed non-selling staff under
"Today's Active Staff"; and the dashboard rendered a blank screen for a
non-owner and swallowed load failures as unhandled rejections.

> **Status superseded 2026-09-05:** the dashboard and B1-B4 product code are
> implemented and committed; the remote migration/function rollout completed.
> See the 2026-09-05 completion entry for the current cutoff.

---

## 2026-08-30 — B1-B3 production baseline and rollout state

This entry moves durable B1-B3 behavior out of temporary plans and supersedes
their implementation-status tables, blocker lists, forecast migration numbers,
and READY-FOR-IMPLEMENTATION conclusions. The plans remain preserved as design
and audit history.

### Authority and architecture

`apps/prototype-web` is the source of truth for product UI/UX, visible flow, and
parity expectations. It is not an implementation source. Production
SQLite/domain/auth/native/sync code plus PostgreSQL migrations/RLS are the
correctness authority. Prototype localStorage, demo data, money/stock math, and
web architecture are superseded wherever they conflict with production
invariants.

SQLite is the only source of truth for mobile screens. `db/` alone touches
SQLite/Drizzle; `sync/` alone talks to Supabase; `domain/` stays pure;
`native/` wraps device modules. Cloud is backup, synchronization, and admin
visibility, never the live screen read path.

All money is whole integer paisa. Every business-day boundary is Asia/Dhaka,
independent of device timezone. Shop ID and live actor checks apply to every
protected read/write, and stale sessions fail closed.

### B1 — navigation, roles, permissions, language, settings, notifications

Owner, Manager, and Staff/Cashier are all operational. Owner routes to the
Owner dashboard; Manager and Staff route to their role branch under Staff Home.
Bottom navigation, Scan, More, Owner Quick Links, and direct-route guards use
the centralized route/data-gate registry.

The current production matrix is 13 keys: the prototype's 12 plus
`inventory_add`. Owner has all permissions and ignores stored denies. Manager
defaults to every operational permission except `staff_manage` and
`inventory_add`; Staff defaults to `sale_entry` and `inventory_view`. Per-user
allow/deny overrides then apply. Unknown roles deny everything.

`inventory_add` is intentionally separate from `inventory_edit` and defaults
OFF for every non-owner. When explicitly granted it permits only Add Medicine
with its atomic opening supplier-purchase, received-line, batch, stock-movement,
audit/outbox graph. It does not grant supplier management, ordinary purchase
creation, receive/void, inventory edit, or other financial authority. The
server validates this narrow graph atomically under the same key.

Global locale is device-local MMKV, Bangla by default, with Bangla/English
catalog and number/date/time/money formatting. Owner profile, inventory/expiry/
refund/credit/closing-hour/tax settings, notification preferences, and own-PIN
change are implemented in committed product code. Settings/profile remain
Owner-only.

Notification rows are local SQLite. Preferences are device-local and
shop-keyed; read/dismiss receipts are local per user/device and do not sync.
Notification listing filters each sensitive type through the live permission
map. Low-stock, expiry, overdue-credit, daily-summary, and sync generators use
production data; daily cash summary remains Owner-only. The `refund` inbox type
and permission/route mapping exist, but no automatic refund notification
generator is currently shipped.

### B2 — sales, inventory, refunds, sync

Sale search/cart/checkout, insights, barcode/OCR, holds, prescription metadata,
discounts, cash/credit/split payment, history/detail, and full-sale refund are
implemented in committed product code. Checkout accepts medicine quantity
intent, then re-reads and prices the actual batch allocation inside one SQLite
transaction. Matching remote grouped-operation migrations/functions are now
deployed; the old pending-rollout warning is superseded by the 2026-09-05 B4
completion entry below.

Stock expired before the Asia/Dhaka business date is unsellable. Null expiry is
sellable and FEFO-last. Transaction-time FEFO allocates the earliest sellable
real expiry first, applies eligible per-batch promotions before the sale-level
discount, and performs all arithmetic in integer paisa.

Displayed quotes are advisory. If transaction-time total, batch, quantity, or
effective unit-price allocation changed, checkout aborts with the refreshed
quote. The cashier must review and confirm that exact quote again; any later
cart edit invalidates the confirmation. No stale quote may silently commit.

`batches.stock` is always the sum of append-only inventory movements. New
batches start at zero and receive an opening movement. Sale, purchase, return,
adjustment, disposal, and reconciliation are ledger operations; direct absolute
stock assignment is rejected. Offline oversells stay recorded and flagged;
display clamping never rewrites ledger truth. Archive is soft and requires
ledger-safe state; late valid movements/refunds can reactivate an invalidated
archive.

Refund is full-sale, reason-required, bounded by the configured refund window,
and requires an online server claim before physical payout or any local
mutation. One active claim is bound to deterministic operation, actor, and
device and never auto-expires/reassigns. Offline, timeout, or claim conflict
changes no sale, stock, cash, credit, or ledger row. Successful refund restores
exact original batches and reverses original cash, outstanding credit, and
collection allocations atomically and idempotently.

Multi-row sale/refund/inventory operations use persisted operation/row IDs,
sequence, expected count, server staging, one-transaction apply, and replay
checks. Refunds additionally derive deterministic operation/child IDs. Full and
incremental hydration share one ordered SQLite apply path; realtime is only a
pull signal.

### B3 — cash, expenses, credit, suppliers, reports, tax, export, printing

Expected cash is fixed and never re-derived by a screen:

`Opening + Cash Sales + Credit Collections - Expenses - Refunds - Supplier Payments - Withdrawals`.

Opening defaults to zero for every new Asia/Dhaka business date and never
inherits yesterday. Withdrawals require a reason. Mid-day reconcile records a
count/variance but does not close the date. End of Day recomputes the expected
amount inside the close transaction and is the only operation that locks the
business date. Closed-day guards cover every money/stock write that would alter
that snapshot.

Expenses are Owner-only, positive integer paisa, and atomically pair an expense
row with its cash payment/outbox group. The canonical categories are Rent,
Salary, Utilities, Conveyance, and Other; legacy categories are migrated.
Expense deletion is a soft, grouped reversal. Receipt-photo capture is not
implemented.

Customer outstanding credit is derived from credit sales minus allocated
collections, never cached as a separately editable total. Over-collection is
rejected. Cash collection changes expected cash; non-cash collection does not.
Unpaid/partial/settled and overdue use the same per-shop credit-period setting.

Supplier position is one pure derivation. Return credit offsets its originating
invoice first, excess pools FIFO across other oldest outstanding invoices, and
any remainder becomes standalone supplier credit. Payment is capped by the
derived effective payable. Supplier archive is blocked by either payable or
credit. Purchase pending lines create no batch/movement/value until Mark
Received; receive applies one movement; void is limited to invoices with no
stock/payment effects. Purchase returns target the original received batch,
are capped by received-minus-returned and current stock, require reason/open
day, write a negative movement plus audit/supplier credit, and never create a
cash refund merely because goods physically left the shop.

Reports are SQLite reads gated by `reports`; Owner and explicitly authorized
Manager/Staff sessions may read them. The Data Export route is Owner-only, but
`services/reportExport.ts` lacks its own top-level Owner guard: sales/refund/
expense export reads accept `reports`, while inventory/credit export reads
re-check Owner. Treat the missing service-level guard as a rollout authorization
risk, not proof that the whole export action is Owner-only. Report/monthly P&L
uses gross sales, discounts, refunds, tax, net revenue, actual-batch COGS,
gross profit, categorized expenses, and net profit. Tax is shop-level,
MRP-inclusive, stored as integer basis points plus label, extracted from the
post-discount total, and snapshotted immutably on each sale so later setting
changes cannot rewrite history. Refund reports reverse the original snapshot.

Export pages permission-checked SQLite reads into UTF-8 CSV or real XLSX in app
cache, preserves Bangla, neutralizes spreadsheet formulas, caps a dataset at
50,000 rows, and shares through the OS. BLE printing is Android-only in Beta:
device-local MMKV pairing, runtime permission/scan/connect, ESC/POS bytes, a
bounded retry, and explicit unsupported/range/disconnect/send errors. A printer
is marked validated only after a real successful write.

B3 money/stock graphs use the same grouped server staging and replay model:
withdrawal, expense create/delete, credit collection, supplier payment,
purchase create/receive/void, purchase return, and `inventory_add_purchase`.
The server re-derives shop, actor, permission, shape, amount, and stock
invariants instead of trusting client totals.

### Migrations and verification

Local SQLite migrations `0000` through `0026` are registered in numeric order.
B1 begins at `0009`; B2 is `0010`-`0014`; B3 is `0015`-`0025`; B4 commercial
cache is `0026`. PostgreSQL has 22 timestamped files in lexical order through
`20260905000000_b4_canonical_onboarding.sql`. Exact order and rollout history
live in `backend/supabase/migrations/README.md`.

The recorded B4 completion suite passed 146 files/1,537 tests, plus typecheck and
lint. It covers migrations, canonical onboarding, hosted ACL/grants, principal
roles, shop isolation, commercial/trial limits, multi-shop, stock, money,
grouped replay, reports, tax, export, and printer contracts.

Founder-reported B3 and B4 physical-device acceptance: **PASS**. At B4 close,
local/remote migration ledgers matched through the 2026-09-05 canonical
onboarding migration and `sync` v10 was ACTIVE. Current deployed H-7 baseline
is 25/25 and `sync` v14 ACTIVE; see the 2026-09-09 entry.

### Deferred items and rollout risks

- Reconfirm the linked project and ledger before every future rollout. Version
  skew can halt or reject queued money/stock groups.
- `public.custom_access_token_hook` is enabled, but remains a manual hosted
  setting that SQL cannot preserve or enable; recheck it after auth changes.
- Expense-category and Asia/Dhaka business-date backfills rewrite existing data
  and need real-data pre/postchecks. Ledger backfill aborts on actorless gaps.
- SQLCipher remains required before pilot data. Production OTP/provider setup,
  DEV OTP bypass removal, and anonymous-auth hardening remain release gates.
- B3 physical PASS does not prove every BLE printer/firmware model and does not
  close the separate recorded PIN-latency timing gate.
- Backup-key restore, expense receipt photos, a distinct general stock-write-off
  workflow, broader receipt-print surfaces, and backup/remote-wipe administration
  remain deferred or out of B1-B4 scope.
- `conflict_queue` remains schema-only with no app writer/resolution UI. Ledger
  stock and grouped operations supersede its old stock-LWW safety rationale, but
  general row-conflict surfacing remains deferred.
- Add a service-level Owner check to the Data Export orchestration before
  rollout; the route guard alone is not the authorization boundary.

## 2026-08-31 — B4 commercial platform locked

- Free is ৳0. Pro is ৳399/month or the prototype annual SKU (৳3,830).
  Ultra is ৳499/month or the prototype annual SKU (৳4,790). Stored as integer
  paisa and priced only from server-owned `plan_offerings`.
- Pro permits 3 active shops and 4 active non-owner users per shop; managers
  count as staff. Ultra and the 14-day one-time launch trial are unlimited.
- SSLCommerz is first provider. Verified provider data plus an exact server
  order match is required before the idempotent payment RPC grants access.
- One owner billing account covers all owned shops. Paid access has 7 days of
  grace; trial has none. Offline premium is bounded by access/grace expiry and
  30 days after the last server verification.
- Downgrade deletes nothing. Deterministically excess shops become read-only;
  excess active staff become plan-suspended. Server entitlement and membership
  are authoritative; SQLite is the fast/offline cache.

---

## 2026-09-05 — B4 complete: canonical onboarding, commercial access, and Multi-Shop

Commit `8d4c503` (`feat: complete B4 commercial flows and canonical onboarding`)
is the completed B4 baseline. Physical Android verification passed. Local and
remote PostgreSQL migration ledgers match through
`20260905000000_b4_canonical_onboarding.sql`; B4 migration/DB parity is clean and
the deployed `sync` Edge Function was v10 ACTIVE at that historical checkpoint
(superseded by v13 on 2026-09-07). The recorded completion suite
passed 146 files/1,537 tests, plus typecheck and lint.

### Commercial and entitlement contract

- Free is ৳0. Pro is ৳399/month or fixed ৳3,830/year. Ultra is ৳499/month or
  fixed ৳4,790/year. All persisted money is integer paisa and server-priced.
- Pro permits 3 active shops and 4 active non-owner staff per shop. Manager
  counts as staff; Owner does not. Ultra is unlimited.
- One Owner/account-level subscription and billing account covers all owned
  shops. Server entitlement is authoritative; SQLite is a verified read cache
  for instant/offline UI and never creates access.
- Paid access has 7 days of grace. Trial has no grace. Offline premium stops at
  paid/grace expiry or 30 days since server verification, whichever comes first.
  Trial is bounded by the stored server trial end. Clock rollback fails closed.
  Transient verification failure does not revoke a still-valid verified cache.
- Downgrade deletes nothing. Deterministic oldest/primary survivors stay active;
  excess shops become commercially suspended/read-only and excess non-owner
  staff become plan-suspended.

### Trial contract

Trial starts automatically after authoritative Owner activation; there is no
Start Trial action. It is granted server-side exactly once per billing account,
lasts 14 days, renders as Trial, and supplies Ultra-equivalent features and
limits. Existing eligible Owners receive the one-time rollout grant. The end is
derived from the original stored grant timestamp; retry, relogin, reinstall, or
device clock cannot reset or extend it. Expiry has no grace and resolves to Free.

### Canonical Owner onboarding and claims

Production follows:

`phone → OTP verify → canonical server Owner/shop onboarding → auth binding → refreshed claims → automatic trial hydration`.

**Superseded 2026-09-06 (H-2):** the DEV Skip-OTP bypass, the anonymous sign-in
it used, and the owner-link repair are removed outright, so the line above is
the only onboarding path in every build. The superseded separate DEV bootstrap
was removed earlier; `devRegistration.ts` is gone. None of them may return, and
DEV must never create a parallel local-authoritative onboarding model.

Fresh Owner success requires `app_user_id`, explicit `principal_user_id`,
`shop_id`, `role=owner`, `permission_version` (including zero), and
`billing_account_id`, with exact requested shop/user identity matches. No
principal fallback is allowed. Missing/mismatched claims fail loudly and cannot
mark the local shop cloud-linked.

`20260905000000_b4_canonical_onboarding.sql` adds two narrow
`SECURITY DEFINER` functions. `b4_onboard_owner(...)` atomically and
idempotently creates the shop, its three system roles, Owner, and settings;
`b4_mutate_owned_shop(...)` performs account-scoped rename/archive/restore.
Execution is service-role-only and no broad service-role INSERT/UPDATE grants
were added. The PG harness represents hosted ACL behavior; grants tests and PG
tests guard direct PostgREST writes to protected tables.

### Multi-Shop contract

Active Trial Owners have effective Ultra access. Pro permits 3 active shops;
Ultra is unlimited; Free/expired accounts are commercially locked. Owner may
create, rename, switch, archive, and restore. A stranded Owner may return to the
primary shop, but the exception grants no secondary-shop operation. Server shop
switch/summaries enforce role, membership, entitlement, and billing account;
session epoch, shop-scoped outboxes/cursors, cache hydration, and volatile-state
clearing prevent cross-shop leakage. Physical Multi-Shop flow passed.

### Connectivity and billing hydration

Google/Android reachability is not an authoritative internet signal. Only
`isConnected === false` is confidently offline; false/null internet reachability
with transport present remains unknown and requests Supabase. Manual Sync, the
sync engine, and billing hydration share this decision.

Billing hydration is attempt-first and independent of push/pull/outbox progress.
Retries are bounded and owned by a session/shop generation. Timer, reconnect,
and foreground triggers coalesce into its single in-flight request. Logout or
shop switch invalidates/aborts the old generation; stale responses cannot write
SQLite or publish success/failure. Config, auth, server/relay, and transport
failures remain distinct.

### Payment reality and environment

Payment initiation/order/provider abstractions and `payment-webhook` source
exist; SSLCommerz is the first planned provider. Real credentials/account and
live provider validation are not configured. Missing provider configuration
fails closed, client/browser/deep-link state cannot unlock a plan, and only
verified server confirmation may activate entitlement. Live payment acceptance
remains Pre-RC/RC work.

Local Expo configuration lives in uncommitted `apps/mobile/.env`; EAS builds
require EAS Environment Variables. `EXPO_PUBLIC_*` is transform-time inlined,
not secret storage. `.env.example` remains non-secret. Runtime/DEV diagnostics
may report config presence and host, never keys, tokens, or identifiers.

### Remaining Pre-RC gates — not done

- Production OTP provider hardening.
- Real SSLCommerz credentials/account and sandbox/live validation.
- SQLCipher production completion.
- `conflict_queue` UI/wiring.
- PIN timing/security hardening.
- Broader printer hardware coverage.
- Export service-level Owner guard, if still pending.
- Admin panel completion and fixed shop location/map support.
- Production observability/release monitoring.
- DEV bypass/debug cleanup.
- Final 39/39 UI parity audit and final security/RLS audit.
- RC fresh-install, upgrade, offline, offline→online, and multi-device testing.

---

## 2026-09-06 — H-1 report exports and external summary sharing are Owner-only

CSV, XLSX, generated report files, and external report-summary text sharing
require the live same-shop SQLite Owner plus the existing export entitlement
check. `services/reportExport.ts` uses one authorization boundary before report
reads, formatting, progress, file writes, or native sharing. Report and End of
Day summary shares use that service; screen visibility is only a UI mirror.

Manager/Staff keep their existing report-reading permissions. Download, CSV,
Excel, and external Share controls are hidden or disabled for non-Owners.
Report calculations, export formats, timestamps, and paging limits are unchanged.
The earlier missing-service-guard warning is superseded by this H-1 change;
physical Android export/share validation remains required before release.

## 2026-09-06 — M-1 Not Found recovery and 39-screen functional accounting

M-1 is DONE functionally: **39/39 functionally accounted for**. The Pre-RC
accounting is DONE 34, PARTIAL 4, MISSING 0, SUPERSEDED 1. Four screens remain
PARTIAL; this is not full completion, physical acceptance, or RC readiness.

`app/+not-found.tsx` uses Expo Router's registered fallback and the existing
role-to-home mapping. Home replaces the dead route; Back is offered only when
history exists. Signed-out recovery targets `/`. NavigationBoundary, the app
shell, permission rules, premium gates, and locale storage are unchanged.

The integration suite discovers actual app files, runs the installed Expo route
parser and StackRouter reducer, and renders the matched Not Found screen with
the real boundary. This is core integration, not a native navigator test:
Vitest/jsdom adapts imperative transport and substitutes nested-layout and
destination bodies. Expo's Jest/native test renderer is not configured here.
Physical Android validation remains PENDING until the founder checks deep links,
role/signed-out recovery, hardware Back, guarded-prefix overlays, nested
navigation, typography, and bottom insets. The screen reuses existing Bangla fonts,
color tokens, and NativeWind shadow/elevation utilities.

---

## 2026-09-06 — H-2: one onboarding path, enforced structurally, not by a flag

**A `__DEV__` guard is not a production boundary.** Metro does not tree-shake,
so a module imported behind a guard still ships inside the release bundle — its
strings, its Supabase calls, and its exported functions all one missing guard
away from being reachable. Anything that can grant access is therefore deleted,
not flagged. This rule is durable and applies to every future DEV affordance.

**Removed:** `dev/DevSkipOtpButton.tsx`, `dev/devAnonAuth.ts` and their two test
files; the owner-link repair affordance; `db/auth.ts`'s
`clearUnverifiedOwnerPhone`; the `isDevPlaceholderPhone` branch in
`app/index.tsx`'s `link_pending` case; and the `DevSkipOtpButton` render in
`app/(auth)/register.tsx`. `devRegistration.ts` was already gone. None may
return. The client can no longer call `supabase.auth.signInAnonymously()` at
all, which matters because RLS keys only on `app_metadata.shop_id` and never
inspects `is_anonymous` — once linked, an anonymous session is indistinguishable
from a real one.

The owner-link repair existed to work around a missing auth binding surfacing as
`hook_not_configured`. `20260905000000_b4_canonical_onboarding.sql` fixed that
at the source, and `linkDeviceToShop` verifies the refreshed token's full Owner
claim set, so a missing binding fails loudly instead of needing a repair button.

**Unchanged:** canonical Owner onboarding, `link-device`, auth binding, strict
token-claim validation, billing/trial hydration, Multi-Shop, the production OTP
path, and phone + PIN login on a fresh device. Registration is one path in every
build: phone → OTP verify → canonical server onboarding → binding → refreshed
full Owner claims → automatic trial hydration.

**Temporary DEV registration harness (same-day adjustment).** Removing the
bypass outright left no way to test a fresh registration before H-5, so
`dev/devRegistrationHarness.tsx` + `dev/devOwnerOnboarding.ts` replace it under
stricter rules. It skips only the SMS code and then runs the canonical path
unchanged — `createShopAndOwner` → `getOwnerOnboardingPayload` →
`linkDeviceToShop` (`b4_onboard_owner` → binding → refresh → strict Owner
claims) → `markShopCloudLinked` → PIN setup. It is not the old architecture:
the session is a real, re-signinable email identity rather than an anonymous
user that could never sign back in and so orphaned its cloud shop; the Owner's
phone is **null** rather than a placeholder claiming a verification that never
happened; and there is no resume and no repair — it refuses to run when the
device already holds a registration, and a failed link stays failed.

`createShopAndOwner` gains `ownerPhone?: null`, typed to admit only `null`. The
shop's contact number is a business field; `users.phone` is a credential with a
global partial unique index, so the only honest alternative to "the number we
just verified" is "none". Production OTP omits the field and is unchanged.

**A `__DEV__` guard still is not a bundle boundary** — the harness gets a real
one. `metro.config.js` resolves `dev/devRegistrationHarness` to an inert stub
whenever Metro's `context.dev` is not exactly `true`, so a release bundle
contains neither the harness nor anything it imports. Unknown means production:
if a future Metro stops passing `dev`, the stub wins.
`dev/devOnlyResolver.test.ts` executes that resolver rather than reading it.

**H-5 removes the harness before RC** and owns the provider, the rate limits,
and the server-side rejection of anonymous callers in `verifyCallerJwt()`;
`dev/README.md` carries the removal checklist. Disabling Anonymous sign-ins in
every Supabase project remains a hosted setting to apply, and the DEV project
additionally needs its Email provider enabled with "Confirm email" off.

**Diagnostics.** Release builds emit one boot line at most: the
missing-configuration warning, which names absent `EXPO_PUBLIC_*` variables and
nothing else — no host, no key, no identifier. The B4 `[muthoy-runtime]`
build-marker line and its `runtimeConfigDiagnostics` object are deleted; the
healthy-config line names the Supabase host and is now `__DEV__`-only.
`dev/runtimeDiagnostics.ts` is a hard no-op in release and deliberately more
than silent: it assembles no user id, shop id, role, or permission count at all,
so there is nothing for a future caller to print or hand to a crash reporter.
`sync/linkDevice.ts`'s failure log stays `__DEV__`-only. Genuine operational
warnings (sync, notifications, billing hydration, inventory) are kept; H-8 owns
turning them into real observability.

**Enforcement.** `tests/dev-production-safety.test.ts` reads the source tree:
the removed files stay absent, no production module references their symbols, no
source anywhere calls `signInAnonymously`, production code imports only
`authTiming` and `runtimeDiagnostics` from `dev/`, no `__DEV__` branch may
navigate/await/return a decision/call Supabase/render UI, and no file under
`app/(auth)/` or `app/index.tsx` contains a `__DEV__` conditional at all.
`tests/dev-production-safety.render.test.tsx` proves production-mode
Registration renders no Skip-OTP, resume, repair, or dev-banner affordance while
still sending a real OTP. Release-bundle grep and native rebuild verification
remain a physical gate, not a claim made here.

## 2026-09-07 — H-7 fix pass A: the database owns cross-shop, and the pull owns nothing RLS would refuse

The H-7 audit ran read-only against a real Postgres (PGlite, the whole migration
ledger) and found two things worth stopping for. Both are fixed here by one
additive migration, `20260907000000_h7_security_hardening.sql`, plus a `sync`
function change. At implementation time neither was deployed; both Pass A and
the later TRUNCATE follow-up are now deployed (see the rollout entries below).

**C-1 — the cross-shop boundary lived in TypeScript, not in the database.**
`sync_apply_row_base`'s insert arm carries its `p_caller_shop_id` predicate only
on the `on conflict do update` branch, and `sync_existing_row_owned_or_missing`
returns true for a missing row by definition. So for any row id the server had
not seen, there was no ownership check at all. Executed as a Shop A caller: a
medicine and a customer both landed in Shop B returning `applied`, and an
invented `shops` row was created outright. Nothing shipped could reach it —
`push.ts`'s `authorizeRow` rejects a foreign `shop_id`, and every
grouped-operation branch re-checks — so this was a latent primitive rather than
a live breach. It is still the wrong place for the boundary: the SECURITY
DEFINER function is what this codebase documents as authoritative, and the B2
dispatcher has always checked it correctly. `h7_row_shop_matches_caller` now
runs before dispatch. `permissions` is exempt because it has no `shop_id`
column; its owning shop is proved through `assert_fk_same_shop('roles', ...)`,
and a test pins that a cross-shop `role_id` is still refused.

**H-1 — the Edge pull was more permissive than RLS.** `sync_pull_changes_b2`
filtered eight tables by permission and gated the other fifteen on nothing but
"is the caller a live user of this shop". Measured on one caller: a default
Staff member's direct read of `expenses` and `payments` returns zero rows, while
the pull handed them every row in the shop, into the device's SQLite. The
migration's own comment claimed the pull "applies the same predicates"; it did
not. Read eligibility now has ONE definition, `sync_table_readable`, and both
the pull and `sync_readable_tables` are expressed through it, so they cannot
drift. `pgtest/h7-security.pgtest.ts` asserts set equality per table for an
Owner, a default Staff member, and a deliberately odd grant mix.

**The client half.** Narrowing the pull cannot un-send what a device already
holds: a cashier who once had `cash_management` keeps every expense row they
were ever given. `sync/pull.ts` now asks for `readableTables` on the first page
of a cycle and `purgeUnreadableTables` drops the rest. Three guards, because
this function deletes a pharmacy's local records: an answer without `shops` is
treated as no answer (an empty array is what a revoked caller gets, and acting
on it would wipe a device on any transient hiccup); a row still in the outbox is
never deleted; deletion runs child-before-parent in one transaction with foreign
keys on. `medicines`, `batches`, `inventory_movements`, `customers`, `sales` and
`sale_items` are deliberately NOT purgeable — losing those means the app cannot
function, and full re-hydration is the right recovery, not a half-empty
catalogue.

**Also closed.** M-1: liveness on the six bare `b2_shop_read` policies, so a
deactivated staff member stops reading `sale_drafts`, `batch_promotions` and the
credit ledger the moment they are revoked rather than when their access token
expires. M-2: the `staff_id = <claim>` branch of the six sale-history policies
was a bare column comparison with no liveness check; the other branch got one
for free from `auth_has_permission`. M-4: the unconditional `return true` for a
null `billing_account_id` is now a bounded onboarding window, and an archived
shop — which previously reached that same `return true` — answers false.
Defence in depth: `DELETE` revoked from the API roles on every tombstone-only
table, the unfiltered legacy `sync_pull_changes(...)` dropped, explicit revokes
on `auth_bindings` and `login_attempts`, and `multiShop.ts`'s unreachable
principal fallback deleted.

**H-2 — anonymous callers are refused by name.** `verifyCallerJwt` now raises
403 `anonymous_session_rejected` before any claim is read. It was already closed
indirectly — no binding means no `app_user_id` claim means 503 — but that is
three accidents reporting an infrastructure fault, and it leaned on a hosted
provider toggle that lives outside this repository. Keep the toggle off anyway.

**M-5 was implemented and then REVERTED, on evidence.** The audit was right that
the token hook's fallback applies a weaker liveness bar than its primary lookup.
Adding the missing checks broke revocation reporting: with no `app_user_id` the
server answers 503 `hook_not_configured`, `sync/requestFailure.ts` classifies
that as `config`, and `isRetriableFailure()` returns false — so a deactivated
cashier would be told the server is misconfigured and sync would halt, instead
of getting 401 `permissions_changed` then 403 "Account is no longer active". The
existing test "carries the CURRENT permission_version, so a refresh picks up a
revocation" caught it. The claims do not authorize the Edge path:
`assertCallerCurrent` re-reads the live user, binding, shop and plan, and hosted
API roles have no direct table data grants. This is not a claim that every SQL
predicate carries every commercial-liveness condition: `auth_is_owner` and
`b2_user_is_owner` are narrower. The behaviour is now
pinned as deliberate by `h7_token_hook_decorates_revoked_principal`, which also
asserts the same caller resolves to `auth_is_live_user() = false`.

**M-3 is NOT DONE and cannot be done from here.** The Supabase CLI in this
environment holds no access token, so the hosted `information_schema` was never
queried. `pgtest/harness.ts` deliberately withholds default privileges from
`service_role`, which is NARROWER than a stock Supabase project — the safe
direction, but unverified. The exact query to run against DEV, and the
instruction to reconcile the harness to whatever it reports rather than widening
production to match the tests, are recorded in `migrations/README.md`.

**Not touched:** SQLCipher (H-3), observability (H-8), `conflict_queue` (H-6),
UI parity, admin, payments.

**Verification.** `h7-security.pgtest.ts` 80/80; `anonymous.test.ts` 5/5;
`access-purge.sqlite.test.ts` 10/10; typecheck and lint clean across all seven
packages. Physical verification after deploy is still required and is listed in
`migrations/README.md`: a Staff device must hold no `expenses`/`payments` rows,
a deactivated Staff member must lose protected reads while their token is still
alive, and Owner/Manager/Staff plus Multi-Shop flows must be re-walked.

## 2026-09-07 — H-7 rollout: the ACL was never what the harness thought, and M-5 stands

H-7 fix pass A is applied to Dev/Test. `20260907000000_h7_security_hardening.sql`
pushed once (ledger now zero-pending, 23/23), `sync` redeployed as v13 ACTIVE.
Nothing else was deployed; `payment-webhook` remains undeployed.

**M-3 is closed, and it did not say what we assumed.** The DEV project's real
`pg_default_acl` shows Supabase's blanket `grant all` living on the
**supabase_admin** default ACL — which governs tables the platform creates, never
the ones our migrations create as `postgres`. Our tables get `anon=Dxtm`,
`authenticated=Dxtm`, `service_role=Dxtm`: TRUNCATE, REFERENCES, TRIGGER,
MAINTAIN. No SELECT, INSERT, UPDATE or DELETE for the API roles anywhere in
`public`. RLS has been a second lock on a door that was already bolted.

The consequential half was **functions**: hosted default is `postgres=X` only, so
every RPC that works in production is carried by an explicit
`grant execute ... to service_role` in a migration. The harness granted EXECUTE
for free, which is the one mismatch that can ship a real defect — a migration
that forgets the grant stays green locally and dies with 42501 on the first
physical call, exactly how the DEV bootstrap's direct INSERT on `shops` shipped
with a passing suite. The harness now models it.

Writing that model taught something worth keeping: the natural spelling,
`alter default privileges ... revoke execute on functions from public`, is a
**silent no-op**. PostgreSQL records a default ACL only where one was granted, so
revoking the built-in PUBLIC EXECUTE leaves `pg_default_acl` empty and every
later function still carries it — verified in PGlite 0.5.5 / PG 18.3, where an
ungranted function stayed executable by `authenticated` with that line in place.
It looked applied and enforced nothing. `revoke execute on all functions in
schema public from public`, run after the migrations, does work. The suite passed
12/12 and 263/263 with it, which is the real evidence that no migration — H-7's
new functions included — was relying on the free grant.

The table half was left deliberately wider than hosted. Modelling production
exactly would mean `authenticated` cannot reach a table at all, so every RLS
isolation test would pass on a privilege error and prove nothing about the policy
it names. Being wider there makes tests harder to pass, not easier.

**M-5: ACCEPTED, on stronger evidence than the original revert.** The audit was
right that the hook's fallback branch decorates a revoked principal. It confers
no Edge authority: the API roles have no direct table data grants (measured
above), and `assertCallerCurrent` re-selects the user/binding/shop/plan on every
request. Permission-backed RLS uses table state too. This boundary is precise:
`auth_is_owner` and `b2_user_is_owner` check active/deleted role state but do not
carry every plan/shop predicate, so they are not evidence for a universal
liveness claim. They remain non-exploitable under the measured hosted ACL and
the Edge caller gate. Nothing authorizes from a decorated token by itself.

The operational argument is also better than previously recorded. Reading
`_shared/auth.ts` again: the liveness branch fires at line 210, *before* the
`permission_version` comparison at line 253. So a deactivated cashier gets 403
"Account is no longer active" on the very first request — not a refresh cycle
first, as the migration's block comment and the test comment both said. Withhold
the claims and that becomes 503 `hook_not_configured`, which
`sync/requestFailure.ts` classifies `config` and `isRetriableFailure()` treats as
non-retriable: the till stops and blames the server. It would also destroy the
one signal that error code exists to carry, making a genuinely unregistered hook
indistinguishable from a routine deactivation. The correction is recorded in
`h7-security.pgtest.ts`; the migration is applied and therefore immutable.

**New finding, not fixed here.** `anon` and `authenticated` hold TRUNCATE on 32
tables, inherited from the platform default ACL and never revoked. TRUNCATE
ignores RLS. It is not reachable today — PostgREST exposes no TRUNCATE verb and
no function in `public` issues one — so this is defence-in-depth, not an open
door. It was left out of this deploy deliberately: the instruction was to deploy
the reviewed migration and nothing else, and widening the change set at push time
would have shipped something the green suite never covered. One line in a
follow-up migration closes it.

**Live verification, on the deployed database rather than PGlite.** A Shop A
caller pushing a new `medicines` row stamped with Shop B is refused with MU003,
as is an invented shop id, while the same caller's own-shop insert still returns
`applied` — run inside a transaction and rolled back, so DEV data was untouched.
`sync_readable_tables` on a real shop gives its Owner 32 tables including
`expenses` and `payments`, and a synthetic default Staff member 27 tables with
both absent, `medicines` and `sales` present. The legacy unfiltered
`sync_pull_changes` is gone, `sync_pull_changes_b2` joins the readable set, and
`anon`/`authenticated` hold zero DELETE.

**Still unverified: everything physical.** No Android device is attached to this
machine (`adb devices` is empty; only a `Pixel_7` AVD exists), so none of the
device-level checks were run — Staff-holds-no-expenses, revoke-mid-token,
role-flow re-walk, Multi-Shop, two-device convergence, post-reconciliation purge.
The server-side halves of those are proven above; the client halves are not.

## 2026-09-07 — TRUNCATE was the last thing RLS could not see

`20260907010000_h7_revoke_api_role_truncate.sql` is applied to Dev/Test. Ledger
24/24, zero pending. Privilege-only: it creates nothing, drops nothing, and
touches no policy.

`anon` and `authenticated` held TRUNCATE on 32 tables. They never had SELECT,
INSERT, UPDATE or DELETE — the platform default ACL for tables our migrations
create as `postgres` is `Dxtm`, and only the D ever mattered. TRUNCATE is the one
verb row level security does not filter: policies simply do not run, so every
guarantee the rest of H-7 spent a migration establishing about who may touch
which shop's rows would have been walked past. It also leaves no tombstone,
which is the whole basis of this system's delete model — a truncated table empties
in the cloud and survives on every device, with nothing to propagate the loss.

It was never reachable, and calling it a breach would have been wrong: PostgREST
exposes no TRUNCATE verb, and no function in `public` issues one, so nothing
could be persuaded to spend the privilege. A loaded primitive with no trigger
attached. Removed anyway, because the argument for leaving it rests on the
absence of a caller rather than the absence of permission, and that is the kind
of reasoning that expires quietly.

The migration is catalog-driven rather than a hand-written table list. A literal
array is exactly how this was missed the first time: a table can acquire the
privilege without anyone writing it down, and the list would have to be right
forever. It also revokes TRUNCATE from the schema's **default privileges**,
because section 1 alone is a one-time sweep — the default still said `anon=Dxtm`,
so the next migration to create a table would have handed it straight back and
the next audit would have found it again. Hosted now reads `anon=xtm,
authenticated=xtm, service_role=Dxtm`.

`service_role` keeps everything, including its own TRUNCATE. It is BYPASSRLS,
held only by the Edge Functions, and disarming the sync path was not the finding.

**A test that failed taught more than the four that passed.** The obvious
assertion — "service_role still holds TRUNCATE" — failed, because the harness
deliberately withholds table default privileges from `service_role` while hosted
grants them. That assertion would have been testing the harness, not the
migration, and TRUNCATE is not a privilege the backend needs in the first place.
It was replaced with what must actually survive: the explicit SELECT grants on
`roles`/`sales`/`shops`, EXECUTE on the three sync entry points, and a real
same-shop write returning `applied`.

Withholding the migration fails exactly the three TRUNCATE assertions and leaves
the three regression controls passing — which is the correct split, since
service_role's grants, the sync write path, and RLS-still-denies-by-policy must
hold both before and after. That last control is the one worth keeping: if a
future privilege revoke went too wide and `authenticated` lost SELECT, every
isolation test in the suite would still pass — on a 42501 — while proving nothing
about the policy it names.

REFERENCES, TRIGGER and MAINTAIN remain with the API roles from the same default
ACL, recorded as known residue rather than fixed. Each deserves its own
reachability argument, and widening this change past the finding would have
shipped privilege edits no test in this pass covers.

Live after the push: API-role TRUNCATE grants 0, API-role DML grants 0,
`service_role` SELECT unchanged at 26 tables, 195 policies and the access-token
hook untouched, cross-shop insert still refused with MU003 while the same
caller's own-shop insert still returns `applied`, and the readable-set split
still gives an Owner 32 tables and a default Staff member 27 without `expenses`
or `payments`.

## 2026-09-07 — H-7 Fix Pass B closes client revocation and the mutable bootstrap clock

Baseline before this fix: hosted migrations **24/24**, zero pending, and `sync`
**v13 ACTIVE**. Pass A plus TRUNCATE hardening are deployed. Fix Pass B is local,
uncommitted, and not deployed pending full H-7 review; `payment-webhook` remains
undeployed. Physical H-7 validation remains pending.

Client reconciliation is now shop-scoped. It preserves the transitive SQLite
FK-parent graph of every pending or failed outbox row before deleting anything,
then purges child-before-parent. Loss of `sale_history` keeps the actor's own
receipts while deleting other staff's cached sale graphs in that shop; other
shops on a shared device are untouched. A malformed, mixed, duplicate, or
unknown `readableTables` answer is treated as no reconciliation answer.

Every pull page now carries the authoritative permission version. A version
change restarts from the cycle's original cursor/page one; a second change
halts after one bounded restart. Stable first-page access metadata carries the
exact actor and `all`/`own` sale-history scope.

Authoritative inactive/deleted/plan-suspended/binding/shop failures, plus a
permission version that cannot be revalidated, synchronously clear the local
session/cart and set the exact user's device-only `access_locked_at` marker
without changing `is_active`, timestamps, or the outbox. Remote user hydration
preserves that local marker, including when another Owner hydrates the shared
device. Protected offline actions then fail through their existing live SQLite
gates. The marker clears only after phone+PIN server authentication and a
successful full hydration for that exact actor; real SQLite/client integration
coverage pins the ordering and every denial path. Data is retained for safe
recovery. SQLite migration `0027_h7_local_access_lock.sql` adds the marker and is
registered in the runtime journal and migration bundle.

`20260907020000_h7_fix_pass_b.sql` creates an RLS-enabled, API-unreachable
server timestamp anchor for each shop. The 24-hour null-billing window no longer
reads client-writable `shops.created_at`; future dates cannot extend it, stale
unbilled shops fail, missing pre-creation shops still allow canonical onboarding,
and archived/deleted shops fail. Direct `service_role` EXECUTE on
`sync_apply_row_pre_h7(...)` is revoked; the guarded wrapper remains functional.

M-5 remains **ACCEPTED**, on the narrow authoritative boundary: decorated claims
do not pass `assertCallerCurrent`, and hosted API roles have no direct table data
grants. Do not generalize this to every SQL predicate. `auth_is_owner` and
`b2_user_is_owner` are narrower than the complete user/binding/shop/plan check.

Mandatory Android checks before Wave 1 sign-off: Staff SQLite excludes
expenses/payments; deactivated Staff loses protected data/actions; normal
Owner/Manager/Staff flow; Multi-Shop/shared-device flow; two-device sync
convergence.

## 2026-09-09 — H-7 physical blockers: bind sync to its JWT actor; reactivate only on the server

Fix Pass B is deployed to DEV: hosted migrations **25/25**, zero pending before
this fix, and `sync` **v14 ACTIVE**. Physical validation reproduced two blockers.
A revoked Staff JWT survived a local device handover and the old revocation
fallback locked the active Owner. Separately, the generic users sync path
correctly kept `is_active=false` monotonic, so the client-side Activate action
could never restore the server row.

The client now compares the persisted cloud token's actor/shop with the active
local actor/shop before any sync work. A mismatch blocks sync but does not block
offline PIN login and never locks either identity from unverified decoded
claims. Locking requires actor/shop metadata attached by the Edge function only
after JWT verification; the active session/cart clear only when that verified
actor is the active local actor. Fresh server authentication, exact claim
matching, full hydration, and the existing live-row postcondition repair the
session.

Staff reactivation is now server-first through additive migration
`20260909000000_h7_actor_binding_staff_reactivation.sql`. The SECURITY DEFINER
RPC is executable only by `service_role`; it revalidates a live same-shop Owner,
rejects deleted/non-staff/plan-unsafe targets, serializes the staff-slot check,
bumps the existing permission version through the users trigger, writes an
audit row, and uses an operation ledger for replay safety. The client changes no
local activation state until RPC success and a full authoritative hydration.

This 26th migration and matching Edge source are local, uncommitted, and **not
deployed**. SQLite migrations are registered through `0028`. Physical retest
and Wave 1 sign-off remain pending. `payment-webhook` remains undeployed.

## 2026-09-12 — H-7 final state: everything decidable without a second phone is now decided

H-7 is code complete and validated to the limit of the hardware available.

Automated and security validation is **PASS**. The full suite is **170 files /
2,058 tests PASS**, with `pnpm typecheck`, `pnpm lint`, and `git diff --check`
all clean. That includes the H-7 security pgtests (cross-shop insert guard on
both `sync_apply_row` overloads, Edge-pull vs direct-RLS parity, revoked-user
reads, the bounded null-billing window, TRUNCATE removal from the API roles),
the device-lock suites, and the actor-binding/reactivation coverage.

Single-device physical validation on Android is **PASS**: the SQLite
`0027`-`0029` upgrade applied on the real, already-populated device database;
Multi-Shop cold restart restored the correct shop without falling into
OTP/link-repair; and the Owner/Manager/Staff PIN and role flows behaved. The
earlier "0028 will not apply on device" observation is resolved — `0028` and
`0029` are validated on hardware. **No known H-7 application defect remains.**

Two client-side defects found during that physical pass were fixed and pinned.
`0028_shop_scoped_pin_lookup.sql` moved PIN uniqueness from device-global to
`(shop_id, pin_lookup_tag)`, because B4 Multi-Shop gives one Owner a separate
actor row per shop and the global index refused them their own PIN in their own
second shop. `0029_pin_reserved_while_inactive.sql` then removed `is_active`
from both the application check and the index predicate: deactivating a staff
member had been releasing their PIN, so a colleague could take it, and
`reactivateStaffOnServer` — which only flips `is_active` and never re-checks —
would produce two live rows sharing one PIN. `verifyPin` fails closed on an
ambiguous match, so reactivation locked out both people. Reservation and login
eligibility are now separate predicates on purpose; deletion is the only state
that releases a PIN, and `0029` deduplicates legacy collisions before creating
the widened index so it cannot abort on an already-affected device.

A convergence coverage audit found one real gap and it is now closed. The stock
effect of another device's sale was already covered; the sale RECORD was not.
`sale-graph-hydration.sqlite.test.ts` hydrates a complete remote graph — two
sales, three sale items, a customer, two credits, a collection payment — through
the real `applyRemoteRows` on real SQLite with every trigger live, in deliberately
hostile wire order (children ahead of parents, which is the true server page
order, since `sale_items` sorts before `sales` under
`order by updated_at, table_name, row_id`). It then reads the figures back
through the production read models: sale history, sale detail, EOD and monthly
report totals, the cash drawer inputs, and the customer's credit balance. Replay
is idempotent (`skipped_stale`, unchanged totals) and a newer-timestamp
redelivery overwrites in place without duplicating. Removing the
`HYDRATION_TABLE_RANK` re-ranking fails 10 of its 11 tests, so the coverage is
not vacuous.

**Physical two-device convergence was NOT RUN.** Only one Android device is
available and the emulator cannot run Muthoy. It is deferred to post-RC/pilot
field validation and **must not be described as verified anywhere.** Automated
coverage substitutes only where convergence is decidable offline — both
directions and order-independence in `inventory-ledger.sqlite.test.ts`, replay
and page-split behaviour in `hydration-ledger`, the receiving-device read models
above, two devices against one server balance in `credit-convergence.pgtest.ts`,
and cross-shop isolation in `h7-security.pgtest.ts`. Real transport, the hosted
RLS round-trip, clock skew between handsets, and genuinely simultaneous push
remain unexercised, and accepting Wave 1 means accepting that.

Deploy state is unchanged by this pass: the hosted ledger remains **25/25** with
`sync` **v14 ACTIVE**. Migration `20260909000000_h7_actor_binding_staff_reactivation.sql`
and its matching Edge source are still local and **not deployed**;
`payment-webhook` remains undeployed. Redeploying `sync` is a precondition for
any later field convergence check, since a client/function version skew would
measure the skew rather than convergence.

One non-blocking follow-up: `apps/mobile/tests/staff-management-pin.test.tsx`
still stubs `activateStaff`, which production no longer exports now that
reactivation is server-first. The mock is inert and the suite is green; it is
dead scaffolding to remove separately.

## 2026-09-12 — Correction: the actor-binding follow-up was already deployed when the entry above said it wasn't

The deploy-state paragraph in the entry above ("Deploy state is unchanged by
this pass: the hosted ledger remains 25/25 with sync v14 ACTIVE... still local
and not deployed") was wrong at the moment it was written. It was produced by
reading this repo's own status docs, which were themselves stale, instead of
independently querying the hosted project.

Direct hosted verification — `supabase migration list --linked` and
`supabase functions list` against project `btfprhticjgeihcngpif` — shows:

- Remote migration ledger: **26/26**, through
  `20260909000000_h7_actor_binding_staff_reactivation.sql`. Matches the local
  migration file count and tip exactly; no drift.
- Deployed `sync`: **v16 ACTIVE**, function last updated **2026-09-10 07:28:21
  UTC**.

So the actor-binding/reactivation follow-up — the Owner-authorized
reactivation RPC, replay ledger, and JWT-actor-bound revocation — was deployed
**2026-09-10**, two days before the entry above claimed it was still local.
`payment-webhook` is unaffected and remains undeployed.

Not independently re-verified here: that the deployed `sync` v16 source
matches the local `functions/sync/` implementation byte-for-byte. The version
number and update timestamp are consistent with it, but no function-body diff
was pulled.

`backend/supabase/README.md` and `backend/supabase/migrations/README.md` are
corrected in place to match (26/26, v16); `docs/plans/pre-rc-master-plan.md`'s
baseline table is corrected too. This entry does not rewrite the one above —
DECISIONS.md is append-only — it stands as the correction of record.

## 2026-09-17 — H-3 SQLCipher: SIGNED OFF

The local SQLite database is encrypted at rest. `app.json` sets the
`expo-sqlite` plugin prop `android.useSQLCipher: true`, which is the single
line that makes the build compile `vendor/sqlcipher`; delete it and every test
in this repo still passes while the database is silently plaintext again, which
is why `tests/h3-sqlcipher-config.test.ts` asserts it as text.

**Key handling.** 32 bytes from `SecureRandom`, wrapped AES-256-GCM by a
non-exportable AndroidKeyStore key (`modules/muthoy-db-key`), persisted with
`commit()` so the key is durable before anything is encrypted with it. Applied
as SQLCipher's raw-key form `PRAGMA key = "x'<64 hex>'"` — no KDF, no salt to
keep in sync — always as the FIRST statement on a connection, followed by a
forced `sqlite_master` read so a wrong key fails at open rather than deep in a
screen. The key is deliberately independent of every PIN: PINs change and are
per-user, so deriving from one would force a re-key on every PIN change for no
security gain. `setUserAuthenticationRequired(false)` is deliberate — the
headless notification task must reach SQLite with the screen locked.

**Device evidence** (Samsung Galaxy A04s / SM-A047F, scratch package
`com.muthoy.pos.h3scratch`, a populated clone of Device A's database; Device A
itself was never touched and its hashes were re-verified unchanged throughout):

- Populated-clone migration: **PASS**, end to end, repeated on the final code.
- **Independent 0-diff verification.** The migrated database was decrypted via
  `sqlcipher_export` to a plaintext copy and fingerprinted by a standalone
  script — not by the migration's own verification code. Against the
  pre-migration baseline: 249 rows / 43 tables, `allPayloadsHash`
  `faf69ff0f96bcea0`, `schemaHash` `85c8993551ece391`, 73 indexes / 44 tables /
  25 triggers, Drizzle journal 30 migrations hash `247ebbb7ba5df4a6`, integrity
  ok, 0 FK violations — **all exact, 0 diffs**.
- Stock/ledger: batch total 9 = movement total 9, 0 ledger mismatches. Money:
  sales 3/4200, sale_items 2/4000, payments 1/200, purchases 1/10000 — exact.
  FTS: `MATCH` proven on the encrypted file itself, not only the decrypted copy.
- Crash/restart: SIGKILL with a hot 28,872-byte WAL, then restart — WAL
  replayed, integrity ok, 249 rows, no re-migration, no leftover artifacts.
- Key failure, both modes **fail closed with the file byte-identical**: missing
  key (key blob deleted) and a genuine wrong key (database encrypted under a
  previous key, opened with a newly minted one). Both reach
  `startup-action: fail-unrecoverable` and the "Local database is locked" screen
  offering a server restore. Restoring the key blob reopened normally — the
  locked state is fully reversible and destroys nothing.
- Ciphertext: random header, `-rw-------`, zero plaintext matches in the main
  file **and the WAL** for `SQLite format 3`, `medicines`, `sqlite_master`,
  `CREATE TABLE`, `__drizzle`.
- Timing: migration 4.3–5.0 s for 249 rows / 811 KB; steady-state DB open
  281–408 ms; Drizzle no-op migrate 11–16 ms. **PIN login max 319 ms** across 15
  samples on three boots — well inside the §16 2 s budget.

**`finalizeUnusedStatementsBeforeClosing: false` — scope and reason.** Closing a
written, encrypted, checkpointed candidate never returned on-device: first as a
permanent 100%-CPU spin, then, once the close was made async, as an
uninterruptible block that ART aborted the process over. Two earlier diagnoses
recorded during the investigation — "redundant re-verification" and a
"JS-GC livelock" — were both **wrong**, and the async-close refactor they
motivated did not fix it. The actual cause is inside expo-sqlite:
`closeDatabase` runs `sqlite3_finalize_all_statement()` across every statement
still registered on the connection BEFORE `sqlite3_close()`, and that walk was
what hung. Setting the option skips the walk and close returns in 3 ms.

It is applied ONLY to the short-lived migration/recovery connections, via
`MIGRATION_OPEN_OPTIONS` in `db/encryptionEnvironment.ts`, alongside
`useNewConnection: true` so expo can never hand one of them back as the app's
live connection. The **live connection keeps expo's defaults** and still runs
the walk. That boundary is what makes skipping it safe: `MigrationConnection`
exposes only `execSync`/`getAllSync`/`getFirstSync`, each of which finalizes its
statement in a `finally` inside expo-sqlite, so nothing is left for the walk to
sweep — whereas Drizzle sits on the live connection and may hold prepared
statements. Nothing at runtime would report that boundary being crossed: a
leaked statement surfaces only as `sqlite3_close()` returning `SQLITE_BUSY`,
which `closeQuietly` deliberately swallows so the original error stays
authoritative. `tests/h3-sqlcipher-config.test.ts` therefore pins the scope in
both directions, and the guard was mutation-checked — adding the option to
`openKeyedDatabase()` makes it fail.

Backup/device-transfer are closed off by `plugins/withAndroidBackupProtection.js`:
`allowBackup="false"` plus both rule files (Android 12+ `data-extraction-rules`
and ≤11 `full-backup-content`), excluding the `SQLite` directory, `mmkv/`, and
`muthoy_db_key_v1.xml`. Without this, Android would upload the app-private
directory to Google Drive — and after H-3 a restored device would receive
ciphertext it can never open, because the AndroidKeyStore wrapping key does not
travel. That is silent, total, unrecoverable loss that looks like a successful
restore.

**Scope boundary.** H-3 covers SQLite at rest and nothing else. MMKV, generated
exports/reports, and attachments are separate scope and remain unencrypted.

**Carried forward, not closed by this sign-off:**

- Post-migration sales/report **UI** smoke test remains **pre-RC**. The data
  layer beneath those screens is proven exactly equal, but no screen was
  exercised against an encrypted connection — DEV onboarding/Metro is still
  unavailable on the scratch build.
- **Large-database migration timing** remains pre-wide-rollout validation. The
  4.3–5.0 s figure is for 249 rows / 811 KB on one device; migration cost scales
  with database size and a shop with a year of history has not been measured.
- The Vitest **worker RPC timeout** (`Timeout calling "onTaskUpdate"`) is a
  separate CI-hygiene issue, not an H-3 defect: 167/167 files and 1984/1984
  tests pass with zero assertion failures, and the identical error appears in
  full-suite logs predating this work. It does make the process exit 1, so any
  pipeline gating on exit code will fail until it is addressed.

## 2026-09-22 — Wave 2 Batch 1 (H-4, H-10 A2.1/A2.2/A2.4, H-11 docs + tooling, UI Pass 1): SIGNED OFF

Verified on a physical Samsung SM-A047F (Android 14), scratch package
`com.muthoy.pos.h3scratch`, against the DEV/Test Supabase project. No production
package, no real pharmacy data: every shop used was a throwaway DEV Test Shop
created through the DEV OTP skip.

**H-4 — PIN timing and offline brute-force guard.** Lock fires on the fifth
consecutive wrong PIN with canonical state (`lastFailureAt == lockedAt`,
`lockedUntil - lockedAt == 30000`); the failure count survives cooldown expiry so
the next miss escalates instead of buying five fresh attempts; the lockout
survives force-stop on disk with the process dead. The headline fix holds: a
valid **Staff** PIN login leaves the shop-wide budget untouched
(`failures:5`, identical `lastFailureAt`), closing the cross-role reset bypass.
Owner recovery is reachable from the pad **during an active lock**. Response
shaping verified: offline PIN login min 827 ms / median 1176 ms / max 1676 ms
across four samples — inside the §16 two-second gate.

**H-10 — auth/device/session.** Fresh online authority validation gates app
entry; the pre-navigation gate renders and holds the authenticated tree closed
until the lease confirms. Deactivating a staff account server-side quarantines
that actor on reconnect (`actor_inactive`) and clears the session; the
quarantine survives force-stop; a correct local PIN **cannot** bypass it.
Recovery is deliberately two-stage — re-enabling the account server-side is not
enough on its own; only the authoritative device login (credential proof) clears
the quarantine. Quarantine is per-actor, not per-device. A deliberate network
drop wrote **no** quarantine (`confirmedAtMs` unchanged, offline high-water
advanced) and reconnect produced a fresh confirmation.

**H-11 — rollback documentation and restore tooling.** Classification corrected
to **A 6 · B 13 · C 7 of 26** from `rollback-classification.json`, generated into
three documents and drift-guarded by test. Restore fingerprint covers 16 tables
with ordered `md5` digests plus summed paisa, and its corrupt → detect → restore
cycle executes for real in PGlite. That is automated SQL validation only and is
**not** the C5 rehearsal.

**UI Pass 1 + sale/stock/cash.** One end-to-end sale on a fresh owner-only shop:
starting stock 100 → **99** exact, amount discount ৳10.00 − ৳2.00 = **৳8.00**,
change ৳2.00, today's sales ৳8.00 / 1 transaction, expected drawer **৳1,008.00**
= ৳1,000 opening + ৳8 cash. Opening cash prompted and defaulted to 0 (rule 5).
Toast, Discount UI, BaseSheet dismissal (X and Android Back) and Bangla/English
all verified on device.

**Carried forward, not closed by this sign-off:**

- **D8 / D9 — two screens are hardcoded English.** The sale-complete screen and
  Sales History render English under `locale=bn` (proven by toggling and
  diffing: only the tab bar changed). Both sit **outside** the UI Pass 1 file
  set, so they were deliberately not fixed here. A Bangla-first POS showing
  English after every sale is a real product issue — schedule into the next UI
  pass.
- **D10 — inventory list does not refresh after adding a medicine.** It still
  read "ইনভেন্টরি খালি" until navigating away and back. Data was correct
  throughout; presentation only.
- **D11 — the বাং/ENG toggle hit area sits under the status bar.** Taps at
  y ≤ 45 px are swallowed by system UI.
- **D4 — one unexplained native crash.** `SIGSEGV (SEGV_ACCERR)` in
  `libreactnative.so` at `MountingCoordinator::pullTransaction`, Fabric thread,
  ~42 s after JS start on a clean data dir. Never reproduced across many
  subsequent launches. No diagnosis; recorded so it is not lost.
- **H-11 C5 remains owed.** The operational restore drill has still not been
  executed against a real backup provider, and every result row in
  `backend/supabase/checks/restore_drill.md` still reads `_not run_`. PGlite
  execution does not discharge it.
- **DEV-harness limits (die with H-5).** The harness Owner has no phone, so once
  a Staff device-logs-in on the same handset the Owner cannot re-link and is
  locked out of that device; and the harness persists its identity before the
  account exists, so a network failure mid-onboarding wedges it until app data
  is cleared.
- The Vitest **worker RPC timeout** still makes the process exit 1 while
  180/180 files and 2333/2333 tests pass. Unchanged CI-hygiene issue, not a
  Batch 1 defect.

**Next Wave 2 sub-batch: A2.3 device registry** — deliberately deferred out of
Batch 1 and unstarted. It is the remaining piece of H-10; H-10 is not fully
closed until it ships.

---

## 2026-09-23 — A2.3: the server-side device registry

**Implemented, tests green, NOT yet validated on a physical device.** H-10
remains open until that validation is done.

### What the server did not know

Until this batch "device" meant nothing to the server. A random id in plain
MMKV (`native/deviceId.ts`) tagged held sales and refund claims and was never
transmitted; the only thing binding a handset to a shop was whichever Supabase
session happened to be stored on it. Two things followed.

**There was no way to revoke one handset.** A lost phone could only be answered
by deactivating the people who used it — which also locks them out of every
other device they own.

**A shared till could not hold two identities.** Because the session *is* the
binding and a session names one actor, handing the phone from Owner to Staff
sent the incoming person to `/device-login` to retype a phone number, which per
Volume 4 Staff are never given. That is the "DEV-harness limit" recorded at the
end of the Batch 1 sign-off, and it was never really a harness limit: it was
this.

### What it now knows

`shop_devices` (one row per installation per shop), `shop_device_bindings` (one
per actor on it, independently revocable) and an append-only
`device_registry_events`, all behind SECURITY DEFINER functions with RLS on and
no permissive policy — no API role touches the tables in either direction.

**A PIN-only handover.** On an installation already registered to the shop, the
device secret issued at enrolment plus the target actor's PIN is enough for the
server to mint that actor's session. Both are verified server-side; the secret
constant-time, the PIN with bcrypt, behind a two-key rate limiter. A handover
now costs four digits.

### Decisions worth recording

**Device identity is INSTALL-scoped, and every surface says so.** Clearing app
data or reinstalling produces a new `device_public_id` and therefore a new row.
Android offers no identifier both stable across a data clear and scoped to this
app: `ANDROID_ID` resets on factory reset and is keyed to the signing key, and
Keystore entries die with app data. Hardware attestation would close it and was
explicitly deferred. The UI calls these *registered installations* and the
Owner gets a list so orphans can be pruned. A later policy pass added an
actor+shop enrolment hold, so a revoked actor cannot use a new install id to
erase the meaning of revocation; the hold rule is recorded below.

**Deny by revocation, never allow by enrolment.** An unknown installation for a
non-held actor is adopted on credential-proven first contact. Existing legacy
sessions do not become illegal until enforcement is explicitly enabled, so
deploying the migration alone cannot lock a live shop out of its own till.

**Revocation does not heal itself.** Re-enrolling a revoked device or binding
is refused even with perfect credentials — whoever holds a lost phone usually
also knows a PIN. Only an explicit, audited Owner/Manager restore brings it
back, and restoring a device does *not* restore the people who were cut off
with it; each account is restored on its own evidence.

**The mirror is SQLite, not MMKV.** The locked design says the MMKV quarantine
is not authoritative, so the newest security state does not go in the one store
that is plaintext and trivially clearable. H-3 already encrypts SQLite with a
Keystore-wrapped key. A monotonic version guard discards replayed snapshots, an
"unknown device" answer never clears a revocation, and a failed request writes
nothing at all — the D1 lesson: an outage is not a revocation.

**A revoked binding spends no H-4 attempt budget.** The credential matched, so
the refusal is commercial, not a guess. Charging for it would let one revoked
account burn the shop-wide budget its colleagues still need on the same
handset. It is reported as its own error rather than "Incorrect PIN", because a
refusal nobody can act on reads as the app being broken.

**SHA-256, not bcrypt, for the device secret.** bcrypt's work factor exists to
slow guessing of low-entropy human input; against 32 CSPRNG bytes it buys
nothing and costs ~300ms on the handover path. The PIN in the same request
stays bcrypt, because a PIN is exactly what bcrypt is for.

**Owner and Manager by ROLE, not by the `staff_manage` permission.** A Manager
is usually the person standing in the shop when a handset goes missing. An
Owner may grant `staff_management` to an individual Staff member, and that must
not silently confer device revocation — the server enforces the role, and the
screen checks the same thing so a permission-granted Staff member never sees a
screen the server would then refuse.

### Review pass, same day — ten blockers, all fixed

The first cut of this batch recorded device standing and then told the DEVICE
about it, trusting the app to act on what it had been told. Every guarantee
above rested on the client choosing to cooperate, and a revoked handset holding
a still-valid access token — the exact artefact a thief walks away with —
cooperates only until somebody modifies the app. What follows is what changed.

**The registry is now a server-side gate.** `deviceGuard.ts` runs once in
`index.ts`, after JWT verification and before any handler, on every action that
carries shop data. The JWT proves *who*; the device secret proves *where from*.
One guard, one call site, and `deviceRegistryPolicy.ts` holds two lists —
guarded and explicitly-exempt — that a test reads back against the router, so a
route added later cannot arrive ungated. The exempt list is short and each
entry carries its reason: they are the paths by which an installation
establishes or repairs standing (`device-enroll` *issues* the proof;
`device-authority` is how a refused device learns why), plus cross-shop
navigation the gate cannot key correctly.

**Enforcement became a switch somebody throws.** The first cut stamped
`devices_enforced_at` on first enrolment. That reads as harmless and is not: in
a three-till pharmacy the first handset to update would enforce the whole shop,
and the two tills still on the previous build — which send no proof because
they have none — would stop syncing mid-trading. Enrolment now only adds a
registration. `a23_set_device_enforcement` is the sole writer of that column,
demands a live Owner or Manager, and refuses unless the installation asking is
itself registered and bound, so throwing the switch cannot be the act that
locks you out of the screen holding it. Turning it *off* is deliberately not
symmetric — that is how somebody undoes a mistake, and requiring a registered
device to do it would make the mistake permanent.

The two halves stay separate on purpose. Revocation bites always, enforced or
not. Absence — no device id, an unknown one, a missing secret — bites only when
enforced. In the unenforced state a tampered client can still dodge revocation
by not naming its device, which is precisely the pre-A2.3 world; enforcement is
what removes that move, and it is the shop's decision to make. Stated plainly
because it is the one place where "server-side enforcement" is conditional.

**The limiter reserves instead of recording.** The old shape asked "are you
locked?", spent ~300ms of bcrypt, then recorded the failure — three statements
with two windows in them. Twenty parallel requests all read the same
pre-increment count and all passed, and because the lock armed only once the
count *exceeded* the budget, a budget of five bought six guesses. Nothing
counted attempts that rotated the device or actor id, both of which arrive in
the request body, so an attacker who never reused a key spent unlimited server
bcrypt. `a23_reserve_attempts` now charges every budget first, in one plpgsql
function holding a row lock per key, locks at `>=` the limit, and adds an
IP-or-global dimension the caller does not choose. Every lockout answers with
the same refusal a wrong PIN gets — a 429 on one key and a 401 on another told
an attacker which identifier they had guessed right.

**Reconnect ordering.** A cycle used to push first and learn its own standing
from the pull that followed, so a handset revoked while offline reconnected,
uploaded every sale it had rung up, and was told afterwards. Now
`validateDeviceBeforePush` fetches the authoritative answer, writes it to the
encrypted mirror, runs H-10's quarantine if it objects, and only a device that
survives all three reaches the outbox. A revocation arriving mid-pull raises
`DeviceAccessRevokedDuringSyncError` and closes the session there rather than
letting the remaining pages land.

**A revocation learned with no session persists anyway.** The actor switch is
unauthenticated by necessity, so its refusal body is the only channel there is.
The server attaches the authority snapshot to `device_revoked` /
`binding_revoked`, and the client writes it to SQLite before raising. It
previously depended on a follow-up authenticated refresh — the one thing a
device in that state cannot reliably do — so the quarantine lasted exactly as
long as the screen did. The same snapshot rides the gate's 403, which is how
the push path, with no response body of its own, learns the same thing.

**One snapshot, one SQLite transaction.** Device row and every binding commit
together. Written separately, a crash between them left `registry_version`
already advanced while a binding the same snapshot revoked was still stored as
active — and the monotonic guard would then reject the re-sent snapshot as
stale, leaving the device permanently holding a revoked account as live.

**An unreadable mirror no longer reads as permission.** `read_failed` is a
third state, not null. These two tables are the only local evidence a handset
was cut off, so returning "no objection" on a read fault made corrupting them
the way to undo a revocation. Callers fail closed; nothing persists a
quarantine on evidence that could not be read, which is the D1 lesson pointing
the other way. A database predating migration 0030 stays a separate, allowed
case.

**Manager access, stated once.** The devices screen was gated on
`staff_manage`, which an Owner can grant to an individual Staff member — so
somebody could pass the route check and then be refused by the screen and by
every server call behind it, and "can edit the rota" implied "can un-revoke a
stolen phone". A `deviceAdmin` gate kind now expresses the same rule the server
does, in `DATA_ACCESS_GATES`, `useDeviceAdminAccess` and
`a23_assert_device_admin`.

Two things the new tests found on their own: the binding-integrity trigger was
not `SECURITY DEFINER`, so it depended on always being fired from inside
another definer function — true today, and an integrity check that fails open
the first time it is not. And `ROLLBACK.md` stated its headline twice, with
only the generated copy checked; the hand-maintained one still read
`A: 6 - B: 13 - C: 7 - of 26`. The drift test now checks every headline-shaped
string in all three documents and every statement count in the hand-written
per-migration table.

### Second review pass — the trust model was wrong, and was replaced

The first two passes hardened a design that asked the wrong question. The
server read `devicePublicId` and `deviceSecret` out of the REQUEST BODY and
checked them against the registry — which is to say, it asked the caller which
device it was, then verified that answer against a credential stored in the
same app storage the caller controlled. A revoked handset could send a
different id, send none at all, or send the id of a device it had watched a
colleague use. Everything built on top was sound; the foundation was not.

**The session is now the device identity.** An auth session is bound to an
installation at the moment it is minted, by the flow that proved the
credential, and `auth_session_devices` records the mapping. A protected request
derives its device and its binding from the `session_id` claim of its own
verified JWT. There is no parameter a caller can supply —
`assertDeviceAuthority` takes the caller and nothing else, and a test asserts
it is never handed the body.

Two consequences, and they are the whole design:

**Revocation is immediate, always.** Revoke a device or a binding and every
session bound to it is refused on the next request — no enforcement flag, no
client cooperation, no waiting for a sync cycle.

**Enforcement only decides the fate of the UNBOUND.** A session with no binding
is legacy: minted before this shipped, or by a flow that proved nothing. It
keeps working until the shop enforces and is refused afterwards.
`devices_enforced_at` means exactly "unbound legacy sessions are no longer
accepted" — never "revocation starts working". The previous pass had the two
conflated, which is why revocation needed the flag in order to bite.

**The JWT-only enrolment bypass is gone.** There was an authenticated
`device-enroll` route: any live access token could call it and register a
brand-new trusted installation, so a stolen token did not merely inherit a
device — it could mint itself one. The route no longer exists.
`a23_enroll_device` is granted to NOBODY and is reachable only through
`a23_bind_auth_session`, which cannot run without binding the session that just
proved a credential. Registration now happens inside device-login, OTP
registration, OTP PIN recovery and the device-secret actor switch, and the
installation travels with the credential rather than in a later call.

**Recovery survives enforcement for non-revoked actors.** A fresh handset
proves a PIN, which binds it, which admits it. A revoked actor is intentionally
different: its hold requires approval from another active administrator
installation or the future manual recovery path.

**Cross-shop stopped checking the wrong shop.** `shop-summaries` returns every
shop's takings and `shop-mutate` renames and archives shops the caller is not
standing in, so validating either against the CURRENT shop was meaningless — a
handset revoked in shop B sailed through while looking at shop A. Both now go
through `a23_blocked_shops`, which resolves this session's installation and
looks it up again under each target shop by its public id, because one handset
in two shops is two independently revocable rows. A blocked shop is omitted
from the summary and named, so the owner is told which till needs signing in
again rather than quietly shown a smaller day.

**Reconnect fails closed on silence.** `validateDeviceBeforePush` used to fall
through to the local mirror when the refresh failed, so a device that could not
reach the registry pushed anyway on whatever it last heard — exactly what a
stolen handset would arrange to be stale. Fresh remote validation is now
mandatory before push, attachments, pull or billing, and an unreachable
registry yields `unverified`: nothing goes out, nothing is persisted, the next
cycle retries. An outage may not manufacture a revocation any more than it may
excuse one.

**Revocation persistence moved to the shared invoker.** It lived in the sync
engine's catch block, so it ran only for work the engine drove; a revocation
arriving on a device-list, a billing check or a refund claim was surfaced as a
generic failure and the mirror left untouched. `handleDeviceRevocation` now
hangs off `invokeSyncWithClaimRefresh` and runs before the error escapes, so
any guarded call is enough to close the session — and a caller that swallows
the error is still safe.

**The SQLite monotonic comparison moved inside the transaction.** It sat
outside, with awaits between the read and the write, so two snapshots in flight
— an ordinary overlap of a pull page and a refresh — could interleave: the
stale one read version 1, lost the thread while the revocation committed
version 9, then wrote ACTIVE back over it. Verified by regressing the
implementation: the burst test ends on version 2 instead of 12.

**Abuse controls stopped trusting a client header.** `x-forwarded-for` is a
list whose first hop the client writes, so keying a rate limit on it let an
attacker mint a fresh budget per request. `cf-connecting-ip` is what Cloudflare
sets from the connection it accepted; when it is absent the fallback is a
server-controlled global bucket, never a request field. And the abuse bucket is
no longer cleared on success — it counts requests rather than failures, and
resetting it would hand anybody holding one valid PIN an unlimited budget for
guessing the rest. That last one was a real bug the new test caught: the edit
meant to fix it in the previous pass had silently failed to apply.

**Enforcement enablement verifies the session.** Owner or Manager, from a
session that is bound, to an active installation, with an active binding, whose
recorded secret digest still matches the device's current one. The last
condition matters: a colleague signing in on the same handset rotates the
secret, and a session left holding the old one could otherwise throw a switch
that immediately locked it out.

**Manager UX.** Managers never see `/settings`, so the devices screen existed
for them in policy and nowhere in the UI. A `deviceAdminOnly` More-menu entry
now shows it to Owner and Manager by ROLE — deliberately not hung off
`staff_manage`, which an Owner can grant to a Staff member.

One structural note: session binding lives in its own `deviceBinding.ts` rather
than in `deviceRegistry.ts`, because that file imports `npm:bcryptjs` for the
actor switch and a runtime npm: specifier cannot be loaded by the Node test
runner even transitively. Importing it from the three login flows broke all
three suites at collection. Same split, same reason, as `deviceLoginPolicy.ts`.

### Final security pass — credential freshness is an event, not an account flag

`phone_confirmed_at` says only that this account proved a phone sometime in its
history. It grants no device authority. OTP enrolment and recovery now require
the current verified JWT to carry a `session_id` plus a signed `amr` entry whose
method is `otp`, whose timestamp is within five minutes (with a small clock-skew
allowance), and whose signed phone matches the authoritative Auth user. Missing,
stale, future, magic-link or mismatched evidence is refused before onboarding or
binding. A bound session is also checked for device/binding revocation before
the credential flow may rotate or reissue installation authority.

The final pass also made the RPC boundary typed and fail-closed: null or malformed
authority/gate/blocked-shop answers are `device_gate_unavailable`, while a legacy
unbound session is represented explicitly. `shop-switch` and `shop-create` now
run through the shared session-bound gate, and target-shop checks resolve known
device and binding revocation before considering enforcement. Therefore
`devices_enforced_at` controls only acceptance of an unknown legacy session.

An unauthenticated actor-switch revocation now accepts only a complete,
well-formed authoritative snapshot, commits its device and binding rows in one
SQLite transaction under the monotonic version guards, and only then applies
the H-10 quarantine. If the snapshot write fails, quarantine is not fabricated;
if it succeeds, no later authenticated refresh is required.

### Final enrolment policy — revocation survives reinstall

Explicit device or binding revocation now creates an actor+shop enrolment hold.
The hold survives a fresh `device_public_id`, OTP, PIN recovery and historical
or current phone verification. Those prove the person, but do not overrule an
administrator's explicit decision that the actor may no longer add an
installation.

The credential flow records the exact replacement installation being
requested. Only another active, session-bound Owner or Manager installation
may approve that exact id; the source installation cannot approve its own
replacement. Enrolment consumes the approval. A changed id invalidates it.
The sole-admin revoked-device case therefore remains blocked until the future
dedicated/manual recovery path exists; A2.3 deliberately does not invent one.

A2.3-capable clients always send `deviceRegistryVersion` and
`devicePublicId`. Omission is a malformed current flow, not permission to mint
an unbound session. Only an explicitly legacy client in an unenforced shop may
retain the old unbound behavior; enforcement fails that case closed.

Hard deletion of a device row is blocked by explicit RESTRICT references from
session mappings, bindings, audit events and enrolment holds. A bound revoked
session therefore cannot be transformed into a legacy unbound session by
deleting the registry row.

### Verified

`backend/supabase/pgtest/a23-device-registry.pgtest.ts` (76) executes the real
migration against real Postgres: the session gate across bound / unbound /
revoked / mismatched, revocation biting with enforcement OFF, a revoked session
unable to name a different device, legacy sessions before and after
enforcement, the absence of any reachable enrolment entry point, fresh-device
recovery into an enforced shop, cross-shop blocking per target shop, the
enforcement switch refusing unbound and stale-secret sessions, the limiter's
off-by-one and its behaviour under 20 parallel guesses, and the complete
API-role / table / function grant matrix across all five tables, including the
internal trigger/function surface and the actor+shop enrolment hold.

`apps/mobile/db/a23-device-registry.sqlite.test.ts` (30) proves the local half
on real SQLite: the zero-budget guarantee, an aborted snapshot rolling back
whole, a forced read failure refusing the login without spending budget, a
revocation surviving with no session anywhere, and concurrent old/new snapshots
resolving to the newest regardless of completion order.

`backend/supabase/functions/sync/deviceRegistryPolicy.test.ts` (61) drives the
gate through every combination of enforced x bound x device x binding status,
proves as a PROPERTY that enforcement changes the answer only for unbound
sessions, proves no routed action escapes classification using a parser that
handles both quote styles, and executes the requester-IP rule against a spoofed
`x-forwarded-for`.

`backend/supabase/functions/sync/deviceBinding.test.ts` (9) executes the
credential-flow preflight: missing capable-client identity, held replacement
ids, malformed RPC responses, enforced legacy sessions and bind failures all
fail without silently returning an unbound session.

`apps/mobile/sync/invoke.test.ts` (13) proves revocation is persisted by the
shared invoker on any guarded call, before the error escapes, and not for a
merely unbound session.

`apps/mobile/sync/index.test.ts` covers reconnect ordering: validation before
the first pushed row, nothing at all leaving a revoked device, and nothing
leaving — or being quarantined — when the registry cannot be reached.

### Owed

**Real-device validation has not been done.** The acceptance test is a shared
handset switching Owner → Staff → Owner by PIN alone with no phone prompt,
plus binding revoke, device revoke, restart persistence, reactivation, and a
WiFi-drop that writes no quarantine. The review pass adds two more: throwing
the enforcement switch from an enrolled handset and confirming an unenrolled
one stops syncing, and confirming the switch refuses to arm from a handset that
is not itself registered. Until that passes on hardware, A2.3 is implemented,
not signed off, and **H-10 stays open**.

**Enforcement ships OFF for every existing shop**, by construction — nothing in
this migration sets `devices_enforced_at`. That is deliberate and is the reason
deploying this cannot strand a till.

What it costs is now much smaller than it was, and the earlier version of this
note was wrong about it. Revocation no longer depends on the switch: any
session BOUND to a revoked device or binding is refused whether or not the shop
enforces, and it cannot dodge that by declining to name its device, because the
device is read from the session id inside its own token. What the switch still
decides is only the fate of sessions that were never bound — minted before this
shipped, or by a flow that proved nothing. Those keep working until an Owner or
Manager turns enforcement on, which is what makes the rollout additive.

The Vitest **worker RPC timeout** still surfaces as one unhandled error on a
full run. Pre-existing CI-hygiene issue, present in the baseline before any
A2.3 test existed; not an A2.3 defect.

---

## 2026-09-27 — A2.3 device registry: SIGNED OFF on hardware; H-10 CLOSED

Two real defects surfaced between the design above and a working till, both
found against a live shop rather than inferred. Both are fixed, tested, and
now confirmed on hardware. **H-10 is closed.**

### Defect 1 — a deployed hosted migration took the whole backend down

`assertCallerCurrent`'s caller lookup embedded `shops!inner(...)` off `users`
with no constraint named. That is fine while `users -> shops` is one
relationship. A2.3's migration added four tables carrying a foreign key to
BOTH `users` and `shops` — `shop_devices`, `shop_device_bindings`,
`auth_session_devices`, `device_enrollment_holds` — and PostgREST reads any
such table as a junction. `users -> shops` became five relationships, not one,
and the unqualified embed started failing PGRST201, "more than one
relationship was found."

That embed runs on every authenticated action, and the function reported the
failure as "Could not verify caller" — HTTP 500. **Applying the migration on
hosted DEV took the sync backend down for every user at once**, and that is
exactly how it was found: on a real handset, against the real project, after
a real deploy. No pgtest could have caught it — PGlite speaks SQL; PGRST201 is
PostgREST's own relationship resolver, which only exists in the hosted stack.

Fixed by naming the constraint everywhere the ambiguity could reach:
`shops!users_shop_id_fkey!inner(...)` in `_shared/auth.ts`'s
`assertCallerCurrent` and in `deviceLogin.ts`, plus a defensive hint on the
`shop_memberships`-rooted embed in `multiShop.ts`. `grants.test.ts` now scans
the deployed function source for any remaining unqualified `shops!inner(`/
`shops!<anything but a real constraint>!inner(` form and fails the build if
one exists, and separately asserts the four junction tables still carry both
foreign keys — so the hint's reason for existing cannot silently stop being
true while the hint itself gets "cleaned up" later.

Independently reconfirmed while writing this entry: `supabase functions list`
shows `sync` at **version 20, ACTIVE**; `supabase migration list` shows all 28
local migrations, including both `20260923000000_a23_device_registry` and
`20260926000000_a23_persistent_enrollment_holds`, matched exactly against
remote. Not re-derived from notes — checked live against the hosted project
while writing this sign-off.

### Defect 2 — first-time Staff device-login: server 200, UI "Something went wrong"

Found on the hardware retest, deterministic across three attempts: a Staff
member's first phone+PIN device-login enrolled correctly server-side (200,
active binding, rotated device secret persisted) and then the app showed a
generic failure screen. Retrying re-enrolled and rotated the secret again,
every time, and the next PIN-only login worked anyway — the credential had
landed; the client just didn't know it.

**Root cause**, proven with a real-SQLite scratch reproduction, not inferred:
`pullChanges` applies the pull's own attached authority snapshot first — that
snapshot carries no secret and advances the stored `registryVersion`. The
device-login response then arrives for the SAME version, carrying the newly
rotated secret, and `applyDeviceAuthority`'s credential guard read
"equal version, different secret" as a replayed response and discarded it.
`recordBoundInstallation` turned that discard into a thrown
`DeviceRegistryError`, which the UI rendered as "Something went wrong." It hit
only Staff, and only on a till the Owner had already registered, because that
is the one case where a secret is already stored under the version the pull
just wrote.

The guard was never a real safeguard against this shape. The server
increments `registry_version` on every bind, revoke and restore — two
credential responses can never legitimately share a version. Equal-version
can only mean a secretless snapshot got there first; a genuinely stale
response is strictly lower, and the monotonic version check above it already
discards that. Removed the branch entirely
(`apps/mobile/db/deviceRegistry.ts`) rather than special-casing it, and added
`deviceEnrolmentMatches()` — a plain post-condition read — so a discarded
snapshot that turns out to already match what's stored is treated as success,
not failure (`apps/mobile/sync/deviceRegistry.ts`'s `recordBoundInstallation`).

A second, related defect found by the same reproduction: the guard also
compared `current.devicePublicId !== devicePublicId`, which can never fire in
an actual replay attack (the value is always this device's own id, by
construction) but silently blocked a legitimate re-enrolment after a
reinstall. Removed with the rest of the branch.

`apps/mobile/sync/deviceAuth.ts`'s `hydrateAuthenticatedDevice` now names each
mandatory post-authentication step (`commercial_identity_hydration`,
`device_enrollment_persistence`, `local_access_unlock`,
`local_enrollment_write`, `hydrated_exact_user_validation`) through a
`requireLoginStep` wrapper: an authoritative refusal
(`DeviceLoginError`/`StaleSessionError`/`SyncHaltedError`) still throws and
fails the login exactly as before; anything else — a disk I/O fault, a thrown
string — is normalized to one typed `DeviceLoginError` naming the step, never
the raw fault, so a merely-local failure can no longer be mistaken for an
authoritative one and no login step's real error message leaks past this
boundary into raw form.

Eight new tests on real SQLite
(`apps/mobile/db/a23-staff-first-login.sqlite.test.ts`) pin the fixed
behaviour: rotated secret survives being pulled first; PIN-only sign-in works
immediately after; the enrolment survives a force-stop; a reinstalled
installation can still receive a credential naming the previous id; a
repeated response is idempotent; a strictly-older response is still
discarded; a revocation cannot be talked out of by a replay; a revoked
installation is never reported enrolled even while still holding its old
secret. Two assertions in the existing `a23-device-registry.sqlite.test.ts`
that had encoded the bug itself (asserting `false` for exactly the two cases
above) were corrected and relabelled with the reasoning. `deviceAuth.test.ts`
gained an exact 8-stage ordering assertion, a completes-exactly-once case, an
`it.each` over three faulting steps proving the raw fault never surfaces, and
a case proving an authoritative access refusal is still denied.

### Hardware evidence — Samsung Galaxy A04s (SM-A047F), Android 14, scratch packages only, `com.muthoy.pos` untouched, DEV-only, WiFi only

All PASS: Owner PIN-only after restart · first Staff phone+PIN enrollment ·
immediate Staff PIN-only · restart persistence · Owner → Staff → Owner
PIN-only · binding revoke · device revoke · persistent re-enrolment hold ·
exact A2 replacement approval, granted on-hardware with the specific refusal
text "Another active Owner or Manager must approve this device." shown first
· A3/new installation remains blocked · a consumed approval does not
authorize a different id · Manager device administration confirmed by ROLE,
not by `staff_manage` · enforcement ON · unauthorized installation blocked
under enforcement · reconnect/offline regression.

Sale/stock/cash regression, run before any revocation touched the till, and
reconciled twice against the server's own paisa figures: stock 20 → **17**
(`cash_applied: 7500`), sale **৳75.00**, drawer ৳1,000 → **৳1,075.00**
(`closing_expected: 107500`) — exact.

Final automated evidence: focused A2.3/device-login/H-4/H-7/H-10 — 19 files /
432 tests; full non-PG suite — 186 files / 2,529 tests, zero failures;
pgtests sequential — 16 files / 319 tests; typecheck + lint — 14/14 tasks;
`git diff --check` clean. All PASS.

### Not closed by this sign-off — carried forward, not A2.3 defects

**Permission-scoped hydration on a shared till.** A cashier's full hydration
sends `saleHistoryScope: "own"` and a narrower `readableTables` set
(`backend/supabase/functions/sync/pull.ts`), and the client correctly drops
rows outside that scope from the shared local mirror — by design, per H-7/H-1,
and observed on hardware: the Owner's dashboard read ৳0.00 after a cashier
signed in, while the server still held the real figures. Nothing was lost.
But the Owner returns to the same handset via `device_actor_switch`, which
does no full hydration, so the incomplete dashboard can persist until one
happens. Worth a product decision; not something A2.3 introduced or can fix
by itself.

**Enrolment-hold requested-id re-arm.** A later replacement attempt from a
different installation id overwrites the hold's recorded requested id and
voids any prior approval for the old one; approving an id that is not the
currently requested one returns 403 `device_approval_required`. Correct and
intentional per-request, but operationally sharp: a stray retry from the
wrong device can re-lock an installation an admin had just approved, requiring
a second approval. Documented, not fixed — no client-visible defect exists to
fix.

**Still deferred, unchanged:** H-5 production OTP provider + real OTP E2E
(OTP-dependent device-replacement cases remain untested against a live
provider); H-11 C5 operational restore rehearsal; the pre-existing Vitest
worker-RPC-timeout flakiness under full-suite load; sole-owner manual account
recovery UX.

### H-10 status

**CLOSED.** A2.1/A2.2/A2.4 signed off 2026-09-22; A2.3 signed off above. Every
item in this batch's original acceptance test — shared-handset Owner ↔ Staff
handover with no phone prompt, binding revoke, whole-device revoke, restart
persistence, authoritative reactivation, a WiFi drop writing no quarantine,
the enforcement switch itself, and an unenrolled installation refused under
it — has now run and passed on real hardware.

## 2026-09-27 — Auth UI/UX parity (prototype-web): implemented, NOT signed off

**Status:** implemented and automated-tested; awaiting a separate read-only
review, then Phase E (device + screenshot parity on a scratch package, never
`com.muthoy.pos`). Nothing committed.

**Sequencing (founder decision).** Auth parity is done now, ahead of UI Passes
2–4 in `docs/plans/pre-rc-master-plan.md` (it was Pass 5 / Wave 5). Reason: the
auth surfaces are the first thing every owner and staff member meets, most of
them were English-only in a Bangla-first product, and the H-10 gate had two
dead ends (below). Passes 2–4 keep their order after this.

**Locked decisions applied.** prototype-web is the UI truth, production the
auth truth. Gen A look for Role Select / Registration / OTP, Gen B ("Muthoy
Secure") for the PIN surfaces; the two generations are NOT unified yet.
Last-digit reveal (~400 ms) only while creating/confirming a PIN, never on a
sign-in or shared-till pad. No "attempts left" count anywhere. "PIN" stays
"PIN" in Bangla (all `পিন` in the catalog replaced). Muthoy branding, not
"Portable POS". No Terms/Privacy links, no fingerprint, no Owner-name field.
`StandardHeader` changes are additive (`tone="auth"`, `subtitle`,
`safeAreaTop`); app headers are not restyled.

**Deliberate deviations from the prototype** (security/architecture wins):
Role Select shows a third door (register) and only on an empty device; no
staff avatar picker (S-1 — the PIN identifies the person); no pre-OTP "account
exists" check (enumeration oracle); OTP keeps the single hidden input (paste,
SMS autofill, one field for TalkBack); no artificial PIN delays (H-4
quantised timing only); H-4's shop-wide escalating lock instead of 5 tries /
60 s; the prototype's "PIN stays on this device" copy replaced (the hash syncs
for new-device login); logout always returns to the PIN pad.

**Security-relevant changes (approved, behaviour-narrow):**
- *Typed refusal.* `verifyPin` now throws `PinAccountRefusedError`
  (`role_unavailable` | `staff_limit`) when a CORRECT PIN belongs to a row that
  cannot open a session, instead of returning null ("Incorrect PIN"). Same
  footing as A2.3's `DeviceAccessRevokedError`: only reachable with a matched
  credential, spends no H-4 budget, thrown inside `withQuantizedPinTiming`.
  Proven in `db/pin-hardening.sqlite.test.ts`.
- *Reason-specific H-10 gate.* The gate state now carries WHY it is closed
  (`authority_absent`, `offline_window_expired`, `clock_rolled_back`,
  unreadable records, a thrown check) and shows an explanation with "Try
  again" (re-runs the same check) and "Switch user" (`switchUser()`, clears the
  active actor only). Neither can set the gate to allowed; the navigator stays
  unmounted (`tests/app-layout.test.tsx` asserts the Stack is absent). The
  authority decision logic (`sync/sessionAuthority.ts`) is unchanged.
- *Credential-cleanup screen was unreachable.* `signOutDevice` clears the
  local session before its cloud call; that clear re-ran the layout effect, so
  the `disposed` guard swallowed the `CredentialCleanupError` and the "Signed
  out of this device" screen never appeared. It now keys on "no session", and
  offers retry (`retryCloudCredentialCleanup`, refuses while anyone is signed
  in) or continue (reaches the PIN pad with no session).
- *One-time sign-out notice.* `enforceSessionAuthority` and the two sync
  revocation paths record a CATEGORY (access changed / session ended / device
  removed / removed from this device) in memory; PIN Login shows it once.
- *`device_session_unbound`* now raises an in-app "sign in again" banner
  (`state/deviceRelinkStore.ts`) instead of only halting sync silently; it
  sends the person to Device Login (phone + PIN binds the installation).
- `DeviceLoginError` carries a `code` so screens translate refusals; the
  server's `otp_required` (stale OTP proof) is mapped and sends the owner back
  for a new code instead of reading as a network error. Messages unchanged.
- Registration/Device Login/Forgot PIN/DB recovery emit the canonical
  `+880…` phone (was: as typed). `sendOtp` now receives E.164 — required by a
  real SMS provider; verify under H-5.
- H-3 recovery takes the PIN on the secure pad, not a text field.
- Switch user / logout uses one localized `LogoutConfirmSheet` (the four
  Alerts disagreed; three asked "Shift Summary") and clears the stack under
  the PIN pad (`navigation/endShift.ts`).

**Deferred to H-5:** real SMS delivery and provider error codes, SMS autofill
on device, resend abuse limits, OTP freshness E2E, Forgot-PIN and
duplicate-phone restore E2E, DEV harness removal.

**Read-only review P1 fixes (2026-09-28).**
- *Relink ordering.* The unbound-session banner now tears the actor down
  FIRST and synchronously (`endShiftForDeviceRelink` in
  `navigation/endShift.ts`: `switchUser()` → clear the relink requirement →
  dismiss the stack → replace with Device Login). It was navigate-first with a
  lazily imported `switchUser`, so an import failure left the old session live
  on Device Login with the notice already gone. A teardown that throws now
  navigates nowhere and keeps the banner.
- *OTP accessibility.* The hidden input is the ONE accessible OTP control; the
  tap-to-focus wrapper is `accessible={false}` and the six boxes are hidden
  from the tree. The input is 1% opaque, not 0: Android's
  `View.isVisibleToUser()` treats alpha 0 as invisible and TalkBack skips it.
- *Phone canonicalization at every boundary.* `normalizeBdPhoneInput`
  (`packages/validation/src/phone.ts`) accepts 017…, 17…, 880… and +880… and
  emits `+8801…`; `normalizeBdPhone` (storage / lookup / lockout key) is
  unchanged. Route params (Forgot PIN prefill, OTP Verify, resumed
  registration) and submit handlers canonicalize; `sync/otp.ts` refuses a
  non-Bangladeshi number (`OtpPhoneError`) before touching the provider or the
  local auth session.
- *Localization.* "Cloud Ready" is catalog copy now (`authCloudReady`). The
  only non-catalog literals left on auth surfaces, kept as not-copy and
  listed for the re-review to confirm: the wordmark "Muthoy"; the Gen B chips, each "Muthoy <Role>" (a
  test pins that shape); the language switch's "ENG"; the phone mask
  "1XXX XXX XXX". The English-text scan now covers the shared auth components,
  not only `app/(auth)`.

**Final review P1 fixes (2026-09-28).**
- *Relink teardown is durable first.* zustand's persist middleware commits
  memory and then writes MMKV, so a failed write inside `clearActiveUser()`
  left the session gone from memory but still on disk (back on next launch).
  The relink now uses `switchUserDurably()` → `clearActiveUserDurably()`
  (`state/sessionStore.ts`): the signed-out state is written first, through
  the middleware's own storage and format; a failed write throws with memory,
  disk, cart and sync unchanged, and nothing navigates. Once that write lands,
  memory is cleared; the middleware's identical repeat write failing leaves
  memory and disk agreeing, so the teardown stands. Session before cart here
  (the cart is memory-only; clearing it first would lose a sale on a failed
  relink). Normal logout (`switchUser()`) is deliberately unchanged: a till
  handover fails closed in memory even if the disk write fails. Tests inject
  the failure at the real MMKV `set`, not as a stubbed teardown.
- *A foreign number is never re-read as Bangladeshi.* `normalizeBdPhoneInput`
  takes an explicit '+' country code as written (`+880…` or rejected — so
  `+1712345678`, `+91…`, `(+1) …` are rejected) and accepts only digits and
  ordinary separators; only 017…/17…/880… are rewritten to `+8801…`. A Forgot
  PIN prefill is kept only if it is a valid Bangladeshi number or a half-typed
  `+880…` exactly as a PhoneField reports it; anything else prefills nothing.
  PhoneField shows and reports a typed, pasted or autofilled foreign code
  exactly as written (the schema then rejects it), and folds an explicit
  `+880` into its fixed prefix. Numbers are formatted for display only when
  valid.
- *PhoneField follows the same rules, not looser ones (2026-09-28).* The
  field still stripped every non-digit, so `+88001712345678`,
  `+880+1712345678` and `017abc12345678` came out as a valid `+8801…`. There
  is now ONE rule set, `parseBdPhoneInput` (packages/validation): a number as
  far as it has been typed, in one of the four accepted forms, dropping only
  separators. `normalizeBdPhoneInput` is that parse, completed (accepted set
  unchanged); PhoneField reports `+880` + the subscriber digits so far when
  the parse succeeds, and the text exactly as typed when it does not.
  Typing past a complete number is refused (the key never lands) instead of
  cut off — the old 11-digit cut also turned a pasted `017123456789` into a
  valid number.

## 2026-09-28 — Auth UI/UX parity (prototype-web): SIGNED OFF

**Status:** signed off. Implemented A→D→B→C (2026-09-27), read-only reviewed
across three fix rounds — 4 P1s, then 2, then 1, all recorded above — then
validated on real hardware across two Phase E rounds (device pass, then a
gap-closure pass). Nothing outstanding blocks this sign-off.

**Hardware evidence** (the same Samsung Galaxy A04s / SM-A047F used
throughout H-3/H-4/H-10/A2.3; scratch packages `com.muthoy.pos.h3scratch` and
`com.muthoy.pos.h3scratch2` run as two independent installations;
`com.muthoy.pos` never started, cleared, or otherwise touched; DEV/Test
Supabase project only):

- Fresh flow, Bangla: Role Select → Registration (DEV harness) → PIN Setup
  (mismatch, then success) → Dashboard. A real, non-DEV registration attempt
  correctly fails closed with a localized error when no SMS provider is
  configured, instead of hanging.
- Returning flow, English: restart, PIN Login, wrong PIN, the H-4 30 s
  lockout (keypad disabled, recovery still reachable from it), Forgot PIN —
  including a live on-device confirmation that malformed input
  (`+88001712345678`, embedded letters) is rejected rather than cleaned into
  a valid number.
- Staff and Manager actors created from Owner → Staff Management; each signs
  in through the existing first-time device+phone+PIN confirmation
  (`cloud_relink_required`, no SMS) and lands on a correctly role-scoped
  home — Cashier, Manager and Owner are visibly distinct, and permission-gated
  tabs and Cash Drawer visibility match the actual grants. Owner ↔ Staff ↔
  Manager handover exercised repeatedly via Logout/End Shift → PIN.
- A2.3 binding/revoke exercised as a genuine two-installation scenario: a
  staff actor bound to a second device with enforcement off; "Only
  registered devices" turned on and confirmed to gate resync of an
  already-*removed* device, not a fresh legitimate registration; a binding
  removed from the admin screen (reversible via "Restore") produced an
  automatic, safe sign-out on the affected device with no authenticated
  screen left showing and no crash; a fully deactivated staff account drew
  the same generic "wrong phone number or PIN" refusal as any bad
  credential — anti-enumeration held under a real revoke, not only the unit
  tests.
- Language toggle confirmed working and persisted app-wide on auth-tone
  screens.
- TalkBack: no audio capture, but a real accessibility-tree dump on Role
  Select confirmed the primary buttons each expose one correct label, and
  the language toggle exposes its full name plus selection state rather than
  the abbreviated on-screen text.
- One native SIGSEGV surfaced once, during the first Phase E round's own
  initial device/Metro setup churn; explicitly watched for across a full
  second round of cold starts and force-stops afterward and never recurred.
  Treated as an artifact of that setup, not the app.

**Deferred — H-5 (real OTP provider, real OTP E2E).** Neither Phase E round
added or configured an OTP/SMS provider, per standing instruction. The
OTP-entry screen itself, real SMS delivery, and OTP-provider error handling
remain unverified against a live provider and stay deferred to H-5, unchanged
from the carry-forward already recorded when A2.3/H-10 closed.

**P2 carried forward, not blocking this sign-off:**
- The "Only registered devices" enforcement toggle's copy reads more
  restrictively than it behaves (above) — worth a one-line clarification
  later, not a defect.
- The soft, tap-to-relink `DeviceRelinkBanner` path — as opposed to the
  automatic hard sign-out on an outright revoke/deactivate, which *was*
  exercised — has no in-app way to reach from a "relink requested but not
  yet revoked" server state, so it was not directly exercised on hardware.
- Unrelated dashboard/POS UI issues noticed in passing (the app-tone header
  bell label is English; one capture showed an icon-font glyph not
  rendering in the dashboard's "More" grid) belong to UI Passes 2-4 and are
  out of scope here.

**No P0/P1 reopened.** Every P1 raised across the three fix rounds — relink
teardown ordering and atomicity, OTP accessibility, phone normalization at
every boundary including PhoneField itself, localization — stayed fixed
through both Phase E rounds; none reproduced.

## 2026-10-01 — H-5 REVE SMS: code phases 1–4 implemented, NOT signed off

**Status:** implemented and automated-tested; awaiting read-only review.
Nothing deployed, no hosted setting changed, the Send SMS hook is NOT enabled,
no SMS sent, nothing committed. The DEV registration harness is unchanged.

**Locked decisions applied (2026-09-29):** Supabase generates and verifies
every OTP; REVE only delivers. Six digits, 300 s expiry, 60 s resend cooldown,
ten provider calls per number per rolling 24 h, English GSM-7 text
`Muthoy code: NNNNNN. Valid 5 minutes. Never share this code.`, the
verified-phone ↔ onboarding-Owner-phone binding, and the harness kept until
REVE passes DEV end to end (then Supabase test OTP numbers replace it).

**Built:**
- `20261001000000_h5_auth_sms_dispatch.sql` (class B): `auth_sms_dispatches`
  (no FKs, RLS on, no grant to any API role) behind service-role-only
  `h5_claim_sms_dispatch` / `h5_record_sms_dispatch`. One row per provider
  call, claimed before it and settled once after; per-number cap counted
  under one ledger-wide advisory lock; phone and code stored only as HMAC
  keys, each row tagged with the key's fingerprint (`key_id`).
- `functions/auth-send-sms/` (`verify_jwt = false`): Standard Webhooks
  signature first, then a strict Bangladeshi destination and six-digit code,
  fail-closed config, ledger claim, ONE REVE call (3 s timeout, never
  retried), outcome recorded. REVE transport and endpoint allowlist isolated
  in `reve.ts`: only REVE's two documented HTTPS endpoints, only the
  documented GET; plain-HTTP and raw-IP endpoints are unrepresentable.
- `sync/link-device`: in OTP mode the onboarded Owner's phone must equal the
  OTP-verified phone (canonical, full-length) or 403
  `onboarding_phone_mismatch`, checked before anything is claimed; the
  verified number is what gets stored.
- Mobile: `sync/otpPolicy.ts` (constants + typed errors by status/code),
  60 s cooldown on both OTP screens, wrong vs expired told apart by send time,
  "could not check" never shown as "incorrect", a rate-limit message.

**Supabase's hook contract, read from supabase/auth source 2026-10-01 —
three facts the plan had open or wrong:**
1. GoTrue mints a NEW `webhook-id` for every retry attempt
   (`internal/hooks/hookshttp`). Webhook-id idempotency alone only stops an
   exact replay, so the ledger also dedupes on HMAC(number, code) inside the
   code's five-minute life — that is what stops a GoTrue retry from becoming a
   second SMS.
2. GoTrue reads the hook's error object only from an HTTP 200/202 reply;
   every other status becomes a generic 500. Every decided outcome therefore
   answers 200 + `{"error":{"http_code","message"}}` — how the per-number cap
   reaches the app as 429 — and no reply carries `retry-after`, so GoTrue
   never re-sends a decided request.
3. The destination is `sms.phone` (every OTP type), `user.phone` only as a
   fallback. When the hook fails, GoTrue does not save the OTP — so an SMS
   from an AMBIGUOUS attempt (timeout, 101) that arrives late carries a code
   that will not verify. **Locked 2026-10-02:** a REVE timeout or status
   101 answers failure (503); an ambiguous send is never reported as success,
   and a late SMS's code may be invalid. *Superseded 2026-10-04 (live DEV
   finding — "First real send, and the fix it forced", below): an ambiguous
   send now answers success, so its code stands.*

**Review fix pass, 2026-10-02 (five P1s; still NOT signed off, nothing
deployed or committed):**
1. *Hash-key rotation.* Optional `SMS_DISPATCH_HASH_KEY_PREVIOUS`: claims read
   rows under the current and previous key and write under the current only,
   so a rotation neither resets the cap nor reopens a duplicate. While any row
   from the last 24 h was written under a key the caller does not hold, the
   claim answers `unknown_key` and nothing is sent (hook: 503,
   `ledger_key_unknown`) — dropping the previous key early, or an instance
   still on the old key, stops sends instead of doubling them. Procedure: set
   the new key and the old one as previous together; remove the previous key
   no sooner than 24 h later. The lock became ledger-wide because the same
   number has a different `phone_key` under each key. An unreadable previous
   key, or one equal to the current, fails closed.
2. *Webhook secret.* Only `whsec_<base64>` or `v1,whsec_<base64>`, canonical
   base64, 24–64 bytes; bare base64, other prefixes, whitespace, URL-safe or
   non-canonical encodings fail closed.
3. *Concurrency.* `pgtest/h5-sms-dispatch.concurrency.pgtest.ts` runs the
   migration on a throwaway PostgreSQL server (`pgtest/serverPostgres.ts`;
   machine binaries, no npm driver), each claim its own backend: a second
   claim is seen queued on the lock in `pg_locks`; a lock-stripped copy of
   the function double-sends (negative control); barrier-released stampedes
   hold one code to one send, the cap to ten, one webhook id to one send, and
   a mixed-key rotation to one send. Skips where no PostgreSQL binaries exist.
4. *REVE evidence.* `auth-send-sms/testdata/reve-sendtext-statuses.json`,
   sanitized; `reve.test.ts` is pinned to it. Statuses 0, 1, 101, 108, 109
   and 114 are in REVE's PDF (page 2). **Closed 2026-10-02:** all eleven,
   136, 137, 151, 170 and 5400 included, are in REVE's Postman collection
   ("SMSServer", supplied by the founder as REVE's official collection), each
   with the reply body REVE returns; nothing rests on a relayed instruction
   any more. The collection's REVE origin is the founder's attestation — the
   file does not name REVE and its samples use raw-IP endpoints — but its API
   surface and its six shared codes agree with the PDF. None of its sample
   credentials, numbers or addresses is in the repo.
5. *OTP fallback.* Only an explicit `otp_expired` code reads as incorrect or
   expired. A 400/401/403 with no code, or with any other code, is "could not
   verify".

**Final review fixes, 2026-10-02 (two P1s; still NOT signed off, nothing
deployed or committed):**
1. *Destination.* A present `sms.phone` is the only destination. Empty,
   blank, null, non-string, foreign or malformed fails closed
   (`phone_unsupported`: no claim, no SMS) and is never replaced by
   `user.phone`, which during a phone change is the OLD number. `user.phone`
   is read only when `sms.phone` is absent altogether — GoTrue omits an empty
   one (`omitempty`), so only an older GoTrue sends none. *Strict format,
   2026-10-02:* the value must be exactly GoTrue's `8801XXXXXXXXX` (its
   `validatePhone` strips "+" and spaces before a number is stored or sent),
   checked on the raw string BEFORE the shared normalizer — which drops every
   non-digit, and so had accepted `abc8801712345678`. Junk, separators,
   whitespace, a "+" anywhere and the local `01…` form now fail closed; the
   same check holds the `user.phone` fallback. The shared normalizer itself
   is unchanged.
2. *REVE HTTP status.* Accepted needs an HTTP 2xx AND `Status "0"`. A
   redirect (still never followed; `provider_redirected`) or any other non-2xx
   (`provider_http_error`) is ambiguous whatever its body says, and that body
   is not read: the hook answers 503 and the ledger records `ambiguous`. One
   call, never retried, as before.

**DEV preparation, 2026-10-02 (Send SMS hook NOT enabled, no SMS sent,
nothing committed):**
- Migration `20261001000000` pushed to DEV (`btfprhticjgeihcngpif`, the only
  pending one). Verified there: RLS on with no policy, no table grant to any
  API role, both RPCs `SECURITY DEFINER` with `search_path=public` and EXECUTE
  for `service_role` only. A rolled-back round trip answered send → duplicate
  → `unknown_key` as designed and left 0 rows.
- `auth-send-sms` deployed (`verify_jwt = false`, bundled server-side).
  Before any secret it answered GET 405 and POST 500 "Hook is not
  configured". No signed probe was run.
- Secrets: `SEND_SMS_HOOK_SECRET` and `SMS_DISPATCH_HASH_KEY` (generated; a
  copy is kept outside the repo on the founder's machine, needed again at
  activation and for rotation) and `OTP_SMS_DAILY_CAP_PER_PHONE=10`. REVE
  credentials not set — awaiting the founder. `REVE_API_URL` and
  `REVE_TRANSPORT` deliberately unset, so the function cannot reach REVE.
- Auth untouched: Email on, Confirm email off, anonymous sign-ins off, and
  `MUTHOY_DEV_ONBOARDING` kept, so the DEV registration harness is intact. The
  Phone provider is OFF and no Send SMS hook is configured.
- Transport: REVE's Postman collection shows POST only on raw-IP servers —
  plain HTTP on 8124, or HTTPS on 8125 with the credentials in the URL path —
  none of them reachable from here and none the same server as REVE's
  hostnames. `smpp.revesms.com:7790` presents a valid certificate;
  `apismpp.revesms.com` refuses connections. Proposed: POST JSON, credentials
  in the body, to `https://smpp.revesms.com:7790/sendtext` — pending REVE's
  confirmation that this host takes it for our account, and its answer on
  source-IP restriction (Edge Functions have no fixed outbound IP).
  *Confirmed 2026-10-04 by live use: the first real DEV send went by POST JSON
  to this host, and REVE answered Status 0 with a message id — no 5400, so no
  source-IP restriction showed.*

**POST transport, 2026-10-02 (not deployed; Send SMS hook NOT enabled; no
SMS sent; nothing committed):**
- `reve.ts` gains `post_json`: a POST to the approved endpoint exactly as
  configured — no query, nothing added to the path — with
  `Content-Type: application/json`, `Accept: application/json` and the body
  `{apikey, secretkey, callerID, toUser, messageContent}` in REVE's order.
  Redirects are never followed; one call, never retried; accepted still needs
  an HTTP 2xx AND Status "0".
- `get_query` is INACTIVE: no configuration may select it
  (`reve_transport_unsupported`). Its builder stays until a live POST is
  confirmed, then goes. *A live POST is confirmed (2026-10-04); removing the
  builder is an open follow-up.*
- Signed DEV smoke, one request with a five-digit code: HTTP 200
  `{"error":{"http_code":400}}` — the payload refusal, reachable only past
  the signature check. The ledger stayed at 0 rows, and DEV holds no REVE
  setting, so no provider call was possible. DEV still runs the earlier build;
  the POST build ships once REVE confirms the host. *Superseded: the POST build
  (v3) reached DEV on 2026-10-04 after a transport probe, and that day's first
  real send confirmed the host (above).*

**DEV activation, steps 1–2, 2026-10-04 (Send SMS hook still NOT enabled; no
SMS sent; nothing committed):**
- Transport probe first: a temporary DEV function (production's `post_json`
  builder, random invalid credentials, called once, deleted) reached
  `smpp.revesms.com:7790` from Supabase Edge over HTTPS. REVE answered HTTP 200,
  Status 109, in 512 ms — no 170, no 5400.
- `auth-send-sms` v3, the reviewed `post_json` build, deployed to DEV.
- All eight function secrets set from the founder's local file: hook secret,
  hash key, cap 10, REVE key, secret and Sender ID,
  `REVE_API_URL=https://smpp.revesms.com:7790/sendtext`,
  `REVE_TRANSPORT=post_json`. The function is now ARMED but idle: Auth does not
  call it until the Send SMS hook is configured, and nothing else holds the
  hook secret. Unsigned requests answer 401.
- Pending, by the founder: DEV Auth — Phone provider on, Send SMS hook →
  `auth-send-sms` with the same secret, OTP expiry 300 s, length 6, resend
  60 s, and confirmation that the access-token hook is still enabled. Then
  exactly one real OTP to the founder's own number.

**First real send, and the fix it forced, 2026-10-04 (fix implemented and
tested, NOT deployed; nothing committed; no SMS since the one below):**
- *What happened.* The founder configured DEV Auth (Phone on, Send SMS hook →
  `auth-send-sms`, six digits, 300 s, 60 s). ONE `POST /auth/v1/otp` answered
  200 in 3.3 s — but the hook ran TWICE, with two different codes. The first
  claim committed and stayed `pending` for good; the second was accepted by
  REVE (Status 0 — no 5400, so no IP restriction) and delivered.
- *Why — inferred; Auth and Edge logs need dashboard access this session did
  not have.* GoTrue's hook client only ever re-sends the SAME payload (same
  code), and `sendPhoneConfirmation` never retries, so a new code means
  `/otp` itself ran twice. `auth.users` holds only the second attempt's user,
  created after the first claim, so the first attempt was rolled back. Best
  fit: the first claim committed on a cold PostgREST call but its reply
  outran the hook's 750 ms wait → `ledger_unavailable` → hook 503 → GoTrue
  answered `/otp` with 503 → something upstream of GoTrue re-ran `/otp`, warm
  this time. REVE was never called for the first code. To confirm when
  convenient: `auth-send-sms` logs `outcome=ledger_unavailable step=claim` for
  the first webhook; Auth logs two `POST /otp`, a 503 then a 200.
- *Fix 1 — the claim is waited for, and asked again under its owner.*
  `20261004000000_h5_sms_dispatch_claim_owner.sql` (additive —
  `20261001000000` is applied to DEV and stays untouched; first called class
  B, *class C since 2026-10-05, below*) adds
  `claim_owner uuid not null`; existing rows get an owner nobody holds, so
  they can be neither resumed nor settled. The hook makes one random owner
  per invocation, held in memory, never logged. The claim is idempotent for
  its owner: the owner's own pending row answers `send` again
  (`resumed: true`) — no second row, no second cap slot. Anyone else, and the
  owner too once the row is settled, gets the duplicate answer as before;
  only the owner can settle. The hook now waits up to 2 s for a claim (was
  750 ms) and, when no answer came, asks ONCE more under the same owner. REVE
  is called only after `send`.
- *Time budget.* GoTrue allows the hook 5 s, a cold start included. The hook
  keeps 3.5 s of it: up to 2 s per claim ask; a second ask only if REVE would
  still get 0.5 s and the record 0.5 s; REVE gets the rest, at most 3 s. Every
  wait used in full adds up to exactly 3.5 s (tested).
- *Fix 2 — **supersedes the 2026-10-02 lock** in "Supabase's hook contract"
  above.* Once REVE has been called, an outcome nobody can confirm — timeout,
  network failure, Status 101, an unreadable or unconfirmed reply, and,
  through the reviewed adapter, a non-2xx or redirect — is recorded
  `ambiguous` and answers GoTrue SUCCESS: that code stands and is never sent
  again, so a late SMS carries a code that verifies, and a failure can no
  longer start a second `/otp` with a new code and a second SMS. A duplicate
  of an `ambiguous` row also answers success, with no REVE call. Still
  failures: a claim with no answer after the second ask, bad config, bad
  payload, `unknown_key`, the cap (429), and REVE's definite rejections (500;
  TPS 137 → 503). A duplicate of a still-`pending` row stays 503, unchanged.
  *Superseded 2026-10-05 (below): it answers success.* The ledger still never
  records a non-2xx as `accepted`.
- *Deploy order, when authorised:* push the migration, then deploy
  `auth-send-sms` straight after. DEV's hook is live, and the v3 build fails
  closed against the new signatures until the matching build lands. The
  first send's orphaned `pending` row needs nothing: it counts against that
  number's cap for 24 h and is purged after 7 days. *Superseded 2026-10-05 by
  the six-step order below.*

**Consolidated review fixes, 2026-10-05 (three P1s; implemented and tested,
NOT deployed; nothing committed; no OTP or SMS sent):**
1. *A pending replay answers success.* A claim that finds this request or
   this code already `pending` under ANOTHER invocation's owner now answers
   GoTrue success, not 503. That owner may have called REVE already — its
   outcome lost before it was recorded, or still on the way — and a failure
   could start a second `/otp` with a new code and a second SMS. Nothing else
   changes: REVE is not called for that number and code again, the row stays
   `pending` (a replay never records anything, and only the owner can settle
   it), and the owner's own lost-reply resume works as before. Only a
   definite rejection (`rejected`) still fails a replay. Cost, accepted: if
   that owner died before calling REVE, the code never arrives and the user
   resends after the 60 s cooldown — a new code, a new claim, sent normally.
2. *Neutral OTP copy.* A successful send only means Supabase took the
   request; the SMS may be late, its outcome unknown, or — for a number with
   no account — lead nowhere. The OTP screens no longer say a code was sent:
   "Check your messages for a verification code. It may take a moment to
   arrive." / "যাচাই কোডের জন্য আপনার মেসেজ দেখুন। কোডটি আসতে একটু সময় লাগতে
   পারে।" (registration and forgot-PIN alike), and the resend toast reads "New
   code requested" / "নতুন কোডের অনুরোধ করা হয়েছে" — short enough for a
   1.8 s toast, with the full line still on screen. Keys renamed to match
   (`otpSentTo` → `otpCheckMessages`, `otpResent` → `otpResendRequested`).
   Same copy for every number and every provider outcome.
3. *`20261004000000` is class C.* Its `gen_random_uuid()` default writes a
   fresh owner into every existing row — a backfill, which the classifier
   missed. `scripts/classify-migrations.mjs` now counts an `ADD COLUMN` whose
   DEFAULT is volatile as a data write; it reclassifies this migration and no
   other. Headline A 6 · B 16 · C 8, of 30.
- *DEV rollout, in this order and no other (migrations/README.md):* (1)
  disable DEV's Send SMS hook; (2) take the schema and data backups — class C,
  so the backup is the way back (the repo's "Required sequence", step 2) — and
  push the migration; (3) deploy the matching `auth-send-sms` at once; (4)
  verify the column, the two owner-taking functions (definer, pinned
  `search_path`, `service_role` only, old signatures gone) and an unsigned
  401; (5) re-enable the hook; (6) send one controlled OTP and check its single
  ledger row. *Superseded the same day by the locked ten-step plan ("Final
  gates", below): the pause is the Phone provider, never the Send SMS hook.*
- *Hygiene.* Seventeen git-ignored `bash.exe.stackdump` crash dumps removed
  (Git Bash leftovers, 2026-08-16 to 2026-10-05). Statements that the POST
  host was unconfirmed are corrected where they stood (`reve.ts`, above).

**Final gates, 2026-10-05 (no H-5 logic change; nothing deployed or committed;
no OTP or SMS sent; DEV harness kept):**
- *Hygiene.* The repo-root `bash.exe.stackdump` — re-created by Git Bash
  crashes after the sweep above, last at 10:33 during the suite run below,
  which still exited 0 — removed from PowerShell; no stackdump remains
  anywhere in the tree, `node_modules` included.
- *Full suite.* `pnpm test --maxWorkers=2 --minWorkers=1` — Vitest's own
  worker cap; no timeout raised, nothing skipped, no code or test changed:
  **216 files, 3,751 tests passed, exit 0** (753 s). The review's earlier full
  run had failed only on H-7 load timeouts and Vitest worker-RPC noise, each
  file passing alone; with two workers neither recurred. Typecheck, lint and
  `git diff --check` pass.
- *DEV rollout, locked.* The maintenance pause is the Phone provider — never
  the Send SMS hook, whose configuration and secret stay untouched: (1) Phone
  provider OFF; (2) confirm a phone OTP request is refused — the fictional
  `+15555550100`, no ledger row, no SMS; (3) schema and data backup; (4) push
  `20261004000000`, dry run first; (5) deploy the matching `auth-send-sms` at
  once; (6) verify the owner column, both RPCs and their grants, the live
  function and an unsigned 401; (7) confirm the Send SMS hook is still
  configured as before; (8) Phone provider ON; (9) re-check the OTP settings —
  6 digits, 300 s, 60 s; (10) exactly one controlled OTP. Detail and expected
  results: `backend/supabase/migrations/README.md`. Not executed.

**DEV redeploy and first verified OTP, 2026-10-05 (DEV only; nothing
committed; DEV harness kept):**
- *Pause.* The Phone provider needed a second dashboard save and a hard
  reload, each way, before Auth applied it. Checked every time with Auth's
  public settings and the fictional `+15555550100`: switched off, Auth itself
  refused it (`phone_provider_disabled`) and the hook never saw it; switched
  on again, the hook received it and refused it (400), which proves the hook
  URL and secret match the new build. No probe made a claim, a user or an SMS.
- *Backup.* Schema, data and roles, taken with the CLI's own `pg_dump`
  scripts run through the local `pg_dump` 18 (Docker is off), kept outside
  the repo in the founder's private folder: 53 public tables; 86 tables of
  data, both ledger rows and `auth.users` included; roles without passwords.
- *Migration.* The dry run listed only `20261004000000`; pushed and recorded.
- *Function.* `auth-send-sms` v5 deployed straight after (the CLI listed the
  build it replaced as v4).
- *Verified.* `claim_owner uuid not null`, no default; only the owner-taking
  RPCs, definer, `search_path=public`, `service_role` only, bodies identical
  to the migration's; RLS on, no policy, no API-role grant; the old `pending`
  row answers `duplicate` to a new owner and cannot be settled by one; an
  unsigned POST answers 401.
- *Baseline.* The two 2026-10-04 test rows — the orphaned `pending` and the
  `accepted` Status 0 — deleted (both are in the backup); the ledger was
  empty.
- *Real OTPs.* Two sends to the founder's number, each exactly one request:
  06:21Z (Message_ID 1315099211), left to expire, then 06:29Z (Message_ID
  1315116919). Each: Auth 200 `{}` in 2.2–2.6 s; exactly one ledger row,
  `accepted`, REVE Status 0 (no 5400, so no IP restriction), settled
  648–670 ms after its claim; nothing `pending`, no second code. The second
  SMS arrived and its code verified at 06:30Z: session issued (`amr` otp),
  then revoked.

**DEV E2E matrix, 2026-10-05 (DEV only; one real SMS; nothing committed;
harness kept):**
- *Hosted hook, no SMS — 22/22.* Signed requests to the deployed hook: a
  wrong key, a ten-minute-old signature and no signature all answer 401; a
  non-Bangladeshi number, a five-digit code and seven malformed numbers are
  refused before any claim; an invalid PRESENT `sms.phone` (non-BD, empty,
  null) is refused even beside a valid `user.phone`. A replayed accepted
  webhook id, and pending or ambiguous rows replayed exactly or as a GoTrue
  retry, answer success with no new row; a rejected row's replay still fails.
  The ledger never grew. Synthetic rows (`h5-e2e-` prefix) were removed.
- *Hosted OTP — one real SMS* (07:05Z, Message_ID 1315177540, Status 0): a
  resend seconds later → 429 `over_sms_send_rate_limit`; a wrong code → 403
  `otp_expired`, which the app reads as incorrect; with the number's 24 h
  count filled to ten by synthetic rows, a resend after 60 s passed Auth,
  reached the hook and was refused by the cap (429, no row, the first code
  still in force); the correct code after 300 s → 403 `otp_expired`, read as
  expired; a request without a token → 400 `validation_failed`, read as
  "could not verify".
- *Automated:* 64 files, 1,476 tests — H-5, OTP screens, binding, forgot PIN,
  H-4/H-7/H-10/A2.3, the DEV harness.
- *Found, both blocking harness removal:* (1) DEV's server-side SMS interval
  is about 5 s, not the locked 60 s — Auth said "after 2 seconds" four
  seconds after a send — so the 60 s cooldown is the app's alone; (2) DEV's
  `sync` (v22, deployed 2026-09-26) predates the H-5 onboarding binding:
  `bindOnboardingOwnerPhone` exists only in the working tree, so the binding
  and the OTP forgot-PIN path were validated by tests only.

**DEV rollout gaps, 2026-10-05 (DEV only; nothing committed; harness kept):**
- *SMS interval — fixed and proven.* DEV Auth's `sms_max_frequency` was 5 s;
  the "60 s" the dashboard showed was the EMAIL interval
  (`auth.email.max_frequency`). Set to 60 s by `supabase config push` from a
  scratch workdir whose `config.toml` declares only
  `[auth.sms] max_frequency = "60s"`: CLI 2.119 pushes declared properties only
  and writes nothing without a piped "y". `config diff` before and after: that
  one property moved, the 15 undeclared ones did not (OTP expiry 300, length 6,
  both hooks, email settings). On a real send, Auth itself refused at +9 s and
  +35 s ("after 50 / 24 seconds", ≈60 s); at +74 s the request passed Auth and
  met the hook's daily cap — no second SMS, the first code still in force.
- *`sync` v23 deployed to DEV.* Live v22 was byte-identical to HEAD (the earlier
  "five files differ" was line endings); the delta was exactly the H-5 binding
  in `linkDevice.ts` and `onboarding.ts`. `verify_jwt` stays true; the
  downloaded v23 equals the working tree (29/29); unauthenticated → 401.
- *Registration, on one OTP session* (08:10Z, Message_ID 1315256471): an
  owner.phone that is not the verified number → 403 `onboarding_phone_mismatch`
  with nothing written (no shop, roles, users, claim, binding, device, billing
  account or auth link); the verified number sent as `01…` → 200, stored as the
  canonical verified `+880…` form, every onboarding row created, the device
  bound, and the refreshed token carries the full Owner claim set. The same
  session's recover-pin was refused while the Owner was held
  (`device_enrollment_held`), for another number (403), and at +331 s
  (`otp_required`) — none changed the PIN or cut a session.
- *Device* (Samsung SM-A047F, `h3scratch2` cleared, working tree via Metro):
  Owner sign-in by phone + PIN enrolled the handset in the test shop (A2.3
  binding, initial sync, dashboard); five wrong PINs; Forgot PIN sent one SMS
  (09:20Z, Message_ID 1315384706) and the code verified; setting the new PIN
  then failed with "Could not reach the server". A first attempt went through
  Register by mistake (09:00Z SMS): a number that already owns a shop was
  refused with nothing written.
- *Found — Owner PIN recovery can never complete.* `recoverPin.ts` calls
  `supabaseAdmin.auth.admin.signOut(caller.authUserId, "global")`, but
  auth-js's admin `signOut` takes a JWT, not a user id; GoTrue answers 403
  `bad_jwt`, so recover-pin returns 500 after the OTP is spent and before the
  PIN changes, and the app shows its generic network message. The same call
  with a user id sits in `_shared/identity.ts` (auth-account rebind → 500) and
  `_shared/auth.ts` `signOutAppUser` (result ignored, so the sign-out meant to
  follow deactivation, a role change or a PIN reset never happens). It predates
  H-5 (already in v22): unit tests mock the call and server recover-pin is only
  checked as source text. Not fixed here — a `sync` change needs its own
  approved plan (CLAUDE.md rule 10).
- Real SMS today: six (06:21, 06:29, 07:05, 08:10, 09:00, 09:20Z), all accepted,
  Status 0. Synthetic ledger rows removed.

**Session revocation fixed (local, 2026-10-05; not deployed, no SMS, nothing
committed):**
- *Recovery* logs out with the caller's OWN verified JWT
  (`revokeCallerSessionsGlobally`). The token is held in a module-private
  WeakMap beside the Caller verifyCallerJwt returned — never a field of it — so
  no handler can read, log or forward it, and a copied Caller carries no
  credential at all. Order unchanged: identity, binding and PIN-collision
  checks → global sign-out → PIN write → mint and bind a fresh session.
- *Rebind and signOutAppUser* hold no JWT of the user they cut off, so they call
  `h5_revoke_auth_user_sessions(uuid)` (migration `20261005000000`, class B):
  SECURITY DEFINER because hosted service_role has no DELETE on auth.sessions
  (measured on DEV), `search_path=''`, service_role only, one user, sessions
  only — refresh tokens and AMR claims cascade; legacy session-less refresh
  tokens are deleted by user; the user and identities are never touched. A
  rebind still fails hard before the identity moves; signOutAppUser stays
  best-effort but now actually executes, and reports a failure without naming
  anyone. Access JWTs already issued stay signature-valid until expiry (as
  everywhere on Supabase); GoTrue — and therefore every sync request — refuses
  them once their session is gone, and they cannot refresh.
- *Recover-PIN errors are typed.* The server tags its refusals
  (`recovery_refused` — one code for every way a number fails to qualify —
  `pin_in_use`, `recovery_failed`, `pin_format_invalid`,
  `recovery_request_invalid`). The app reads them through its own mapping, not
  device-login's: no answer at all → `recovery_uncertain` (the PIN write may
  have committed); PIN collision → PIN in use;
  stale or rejected proof (incl. 401) → new code; number or account refusal →
  one generic refusal; device refusals as before; any 5xx → "Could not reset
  PIN. Try again." Device-login's mapping is unchanged.
- *Tests that execute it.* `pgtest/session-revocation.pgtest.ts` runs
  recoverPin, the rebind and signOutAppUser for real — supabase-js and auth-js
  unmodified, GoTrue answered by `authServerDouble.ts` from GoTrue's own tables
  (added to the harness bootstrap with hosted's cascades and ownership),
  PostgREST by `restDouble.ts` as service_role against the real migrations.
  Restoring the old user-id call fails 2, 1 and 2 of its tests in the three
  places. The source-text tests that asserted the user-id call now assert the
  fix.
- *To reach DEV:* push `20261005000000`, then deploy `sync`; then one device
  forgot-PIN run (one SMS).

**Recovery commit-point correction (local, 2026-10-06; not deployed, no SMS,
nothing committed; DEV harness kept):** A confirmed PIN write is a credential
success even when fresh-session setup fails. The server's 422
`pin_changed_login_required` carries `recoveryShopId` from the proven Owner row,
not the caller's possibly different active `shopId`; the verified caller
identity in the error body remains protected. The device validates that target
before clearing its H-4 budget. A valid 200 response also clears the recovered
shop's budget immediately; later mobile setup faults keep the same confirmed
success code and direct the owner to normal login with the new PIN. Any minted
session cleanup targets that attempt's JWT with local scope, never whichever
session is current later. Returned and thrown cleanup errors log only a fixed
message and cannot undo the committed-PIN result. A true no-response remains
`recovery_uncertain` and clears no attempt budget.

**DEV deploy and hardware Forgot PIN, 2026-10-06 (DEV only; one real SMS;
nothing committed; DEV harness kept):**
- *Preflight.* Only `20261005000000` was pending (30/31 applied). Live `sync`
  v23 differed from the working tree in exactly the four reviewed files
  (`recoverPin.ts`, `_shared/auth.ts`, `_shared/identity.ts`,
  `errorResponse.ts`); nothing in the deploy path changed after the review's
  test run; no native or app-config diff, so the `h3scratch2` dev client with a
  cache-cleared Metro bundle of the working tree is the current mobile build.
- *Migration.* Schema, data and roles backup (`dev-20261006-pre-revoke-sessions`,
  founder's private folder); the dry run listed only `20261005000000`; pushed.
  `h5_revoke_auth_user_sessions(uuid)`: SECURITY DEFINER, `search_path=""`,
  owner `postgres`, ACL exactly `postgres` + `service_role`, no PUBLIC grant;
  anon and authenticated cannot execute it (anon through PostgREST: 401
  `42501`); body identical to the file. Ledger invariant PASS.
- *Function.* `sync` v24, `verify_jwt` true, byte-identical to the working tree
  (29/29) with the H-5 onboarding binding; no auth header → 401, anon key →
  401. All 17 secrets (by digest) and the Auth settings unchanged.
- *Hardware* (Samsung SM-A047F, `h3scratch2`, H-5 E2E Test Shop;
  `com.muthoy.pos` untouched): five wrong PINs locked the pad (first 30 s rung;
  the five failures outlived it). Forgot PIN sent one SMS (08:30:02Z,
  `accepted`, REVE Status 0, settled 0.75 s later). Android's SMS auto-fill
  entered the real code, so the wrong-code step was NOT exercised. New PIN
  saved 08:30:37Z; the app removed the shop's H-4 record before any further
  setup and opened the Owner home. After logout the old PIN was refused with
  the pad still open at one failure — had the budget not been cleared it would
  have been the sixth and locked — and the new PIN signed in.
- *Server.* PIN hash changed (bcrypt) and the old PIN no longer matches it.
  Every pre-run Owner session and its refresh tokens are gone — the handset's
  stale one by `sendOtp`'s local sign-out, the rest by recovery's global
  sign-out — and one fresh session (08:30:37Z, in use) is bound to the phone's
  device record. The other principals' 91 sessions, auth users, identities,
  the Owner's binding, claims and device rows are unchanged; no holds. Metro's
  client log held no error and no credential; Edge logs are not readable from
  here.
- *Gate.* 80 files, 1,852 tests (recovery/session revocation, H-4, H-7, H-10,
  A2.3, Multi-Shop, H-5 SMS, DEV-harness safety), all pass.
- *Open:* the wrong-code screen on hardware — it needs one more real SMS.
  (Closed the same day without one: see the next entry.)

**DEV registration harness removed; Supabase test OTP numbers on DEV,
2026-10-06 (DEV + local code; zero REVE calls; nothing committed):**
- *Why now.* The harness existed only because no SMS provider did; real REVE
  OTP has passed DEV end to end, so DEV and production now onboard through the
  same proof. The founder accepted the real-REVE hardware run as passed.
- *Client.* Deleted the eight harness files in `apps/mobile/dev/` (the
  Registration button, its flow, the "Dev: Restore test owner session" gate
  control, their inert stubs, the Metro resolver and its test), the
  Registration footer, the gate control in `app/_layout.tsx`, the
  `metro.config.js` swap (plain `withNativeWind` export again) and
  `RegisterShopInput.ownerPhone`. `dev/` now holds instrumentation only, pinned
  by `tests/dev-production-safety.test.ts`, which also bans the harness
  symbols, its identity store and email domain, `MUTHOY_DEV_ONBOARDING` and any
  email-password sign-in or sign-up; the render suite proves Registration has
  no DEV control even with `__DEV__` on.
- *Server.* Deleted `sync/_shared/devOnboarding.ts`. `link-device` admits an
  Owner only with a fresh phone OTP (`requireFreshOwnerOtp`) and never writes
  the `dev_harness` stamp; a guard test proves the old switch grants nothing.
  `sync` v25 deployed (byte-identical to the working tree, 28 files, no harness
  marker; JWT verification unchanged); `auth-send-sms` untouched (v5).
  `MUTHOY_DEV_ONBOARDING` unset on DEV; the other 16 secrets are
  digest-identical, `MUTHOY_ENVIRONMENT` kept for server auth timing.
- *Test OTP numbers.* Four fictional numbers configured on DEV
  (`[auth.sms.test_otp]` via `config push` from a scratch workdir; only those
  four properties changed — OTP length 6, expiry 300 s, resend 60 s, the Send
  SMS hook and the access-token hook unchanged). GoTrue skips the SMS hook and
  provider for a test number (read in its source). The numbers and codes live
  in the founder's `.muthoy-secrets/dev-test-otp.env` only — never in Git or the
  app. None existed on DEV beforehand.
- *Verified, test numbers only, zero REVE* (a tripwire filled each number's
  daily cap with synthetic ledger rows so a hook call could not reach REVE;
  the real ledger stayed at 7 rows throughout; tripwire removed): server E2E —
  wrong OTP refused, right OTP verifies, registration refused for an unproven
  Owner phone and accepted for the proven one, full Owner claims, A2.3 binding,
  device login (wrong PIN refused), Forgot PIN (every older session revoked,
  fresh one bound, old PIN refused, new PIN accepted), revoked installation
  refused, enrolment hold refused, a harness-shaped email identity refused
  onboarding on DEV. On the Samsung (`h3scratch` wiped first; `com.muthoy.pos`
  untouched): registration through the real screens with no DEV control, the
  wrong-code screen ("ভুল কোড — আবার চেষ্টা করুন"), PIN setup, five wrong PINs
  → H-4 lock, Forgot PIN → new PIN → H-4 record removed, old PIN refused at one
  failure with no lock, new PIN signs in. Release JS bundle (`expo export`):
  zero harness strings in UTF-8 and UTF-16.
- *Observed, by design:* revoking an installation creates the Owner's
  enrolment hold, which `a23_prepare_enrollment` checks first, so a login from
  the revoked installation is refused as `device_enrollment_held`, not
  `device_revoked` (its live session gets `device_revoked`).
- *Residual DEV data at the time:* DEV held 14 harness-stamped accounts (14
  shops, 33 live sessions) with email+password credentials; nothing admitted
  them to onboarding or recovery. No cleanup was run. The proposed deletion
  was later rejected; see the 2026-10-07 decision below.

**Residual DEV harness data retained, 2026-10-07 (no deletion, deploy, SMS or
commit):** The founder's read-only DEV preflight found 14 stamped historical
identities, but only 12 matched the original strict shop/Owner/account proof.
One excluded identity had a renamed shop and populated Owner phone (repurposed);
the other had a renamed shop and possible reuse (ambiguous). A second,
twelve-target preflight returned `safe_to_delete_12 = 0`: those scopes contain
business, device, membership or other unrelated data. Both destructive cleanup
plans are closed as unsafe and not required for H-5. All 14 identities and their
stamps remain intentionally untouched. They are DEV data-retention debt, not an
H-5 P1: the mobile harness code and server onboarding bypass are gone,
`MUTHOY_DEV_ONBOARDING` is unset on DEV, and the live app/server path neither
reads the stamp nor offers email/password harness sign-in. The stamps do not
re-enable the removed harness. Any future disposal requires separate
data-retention work, with its own scope, backup and approval, outside H-5.

**Pre-existing, not H-5 — fixed in this change set, test fixtures only:**
`db/b4-billing-hydration.sqlite.test.tsx` (7) and
`db/b4-multi-shop-entitlement.sqlite.test.ts` (2) started failing on
2026-10-01: their fixtures verified the entitlement at `2026-09-01T06:00Z`, and
the 30-day offline ceiling (`domain/entitlements.ts`) passed at 06:00 UTC that
day. Reproduced identically on clean `08ba2fa`. Fixed 2026-10-02 without
touching the ceiling or any production code: billing-hydration's `T0` is now
one day before each run (relative, not frozen — those tests drive real timers
and three install fake ones); multi-shop-entitlement freezes the Date, no
timers, nine days after its `T0`, checks that each denial is for the plan
itself (`free` / `trial_ended`) rather than a stale cache, and adds a test
pinning the 30-day ceiling to the millisecond.

**H-9 Batch A — Phase 2–4 local work, 2026-10-14 (uncommitted; nothing hosted,
deployed, built or installed; no SMS):**
- *Phase 1* is on main as `a407c83` (signed off, CI green). Plan:
  `docs/plans/H-9-production-environment-eas-secrets.md`; results:
  `docs/plans/h9-verification-report.md`.
- *Edge keys.* `functions/sync/_shared/supabaseKeys.ts` resolves keys once per
  cold start. `MUTHOY_SUPABASE_PROJECT_REF` is required and must match
  `https://<ref>.supabase.co` exactly; `MUTHOY_SUPABASE_KEY_MODE` is `modern`
  (default: the `default` entry of each JSON dictionary, never the first value)
  or `legacy` (explicit rollback). No downgrade, no mixed pair, fixed refusal
  codes that never echo input. supabase-js pinned to 2.112.3 in Edge code.
- *Transport.* `sync` keeps gateway `verify_jwt = true`, now declared. The
  mobile fetch adapter removes only `Bearer <the publishable key>` on this
  project's `/functions/v1/sync` (SDK 2.112.3 already omits it); user JWTs,
  the legacy bearer and all Auth/REST/Storage traffic pass unchanged.
- *Dispatch.* `sync/handler.ts` holds the verbatim route table; `index.ts` is
  wiring only. A matrix test executes every route against key-only, forged,
  expired, foreign, revoked and anonymous credentials.
- *Migrations 32/33.* 32 converges the A2.3 consumption CHECK by stored parse
  tree (drops only the fresh-bootstrap duplicate `_check1`; aborts on any other
  shape). 33 verifies or creates the B2 staging-cleanup cron job only where
  pg_cron exists — DEV gets a notice and no change. Classes: 32 B, 33 A
  (`A 7 · B 18 · C 8 — of 33`).
- *Finding, not acted on.* The H-11 classifier strips `DO` bodies, which run
  at migration time; exposing them reclassifies `20260818000000` from B to C
  (its backfill block). Fixing the tool needs separate approval.
- *Phase 3/4 prepared, not run.* Runbook `backend/supabase/deploy/README.md`;
  read-only checks `backend/supabase/checks/h9_postmigration_checks.sql`;
  `scripts/h9-prod-preflight.mjs` refuses while the production policy is unset
  and its GET-only `--remote` mode has never run. Phase 4 was prepared before
  G2 on the founder's instruction and must be re-validated after it.
- *Codex fix pass, 2026-10-15 (FIX REQUIRED → fixed locally, re-review
  pending).* (1) Migration 33 and the **cron** check now require the job's
  `nodename`/`nodeport` to be this server's own pg_cron target —
  `current_setting('cron.host')` and `current_setting('port')`, the values
  `cron.schedule` records; no endpoint literal. A job aimed elsewhere
  (`foreign-db.invalid:6543`) aborts; an unset/empty `cron.host` aborts as
  "target cannot be established". (2) `--remote` refuses Auth settings that do
  not report every security field (`auth-metadata-missing`); `sms_test_otp`
  passes only as `''`. `null` refuses as `test-otp-map-unverifiable`, because it
  cannot prove there is no map (Codex final P1). Any other type is malformed.
  (3) The preflight requires the checkout's
  `apps/mobile/config/environmentPolicy.js` to equal the approved revision's
  blob byte for byte (`policy-matches-revision`), so an edited, later-committed
  or re-encoded policy cannot pass with a valid backend revision; a refused
  manifest's revision no longer reaches git at all (self-review hardening).

**H-9 F12 — migration 34, API-role table privileges, 2026-10-15 (local only,
uncommitted; nothing hosted, no DEV change; Codex review pending).**
- *Why.* The Phase 3 rehearsal ran the reviewed chain on a project created with
  the platform's current default privileges: anon and authenticated ended with
  SELECT on 32 public tables and INSERT/UPDATE on 9. DEV holds none. RLS
  refused every row, so nothing was exposed, but PROD built from the repository
  would not match what DEV testing proved. The founder approved a guarded
  forward migration (2026-10-15) rather than relying on project settings.
- *What.* `20261015000000_h9_api_role_table_privileges.sql`, one guarded DO
  block. For anon and authenticated in public: every table-wide SELECT, INSERT,
  UPDATE, DELETE or TRUNCATE they actually hold, revoked one by one; every
  sequence right; and postgres's default privileges for future tables (those
  five), sequences and functions (EXECUTE). DEV's `xtm` stays. On DEV it is a
  no-op.
- *Per-privilege, not blanket.* A table-wide `REVOKE INSERT/UPDATE` also strips
  the column-level grants of that type, and 20260819000000's column grants on
  `users` (authenticated: 13 INSERT and 12 UPDATE columns) are part of DEV's
  baseline. So 34 revokes only what each role holds table-wide, and aborts if an
  API-role column grant shares a type with a table-wide one.
- *Guards and proof.* It aborts, changing nothing, unless it runs as postgres,
  the three roles exist, every public relation is postgres-owned, every table
  has RLS and nothing is granted to PUBLIC. It then verifies the effective end
  state (`has_table_privilege`), and that every other ACL entry, column grant,
  default, function ACL, the schema ACL and the RLS flags are unchanged.
- *Deliberately not changed.* service_role stays broader on fresh projects than
  on DEV (instruction: preserve service_role). PostgreSQL's built-in PUBLIC
  EXECUTE on new functions stays, as on DEV. DEV's `rls_auto_enable` (F13) is
  not replicated. The 0819 column grants stay; whether authenticated needs them
  at all is a separate review.
- *Consequence.* authenticated has no SELECT on `public.batches` on any
  project, so the `postgres_changes` signal in `apps/mobile/sync/realtime.ts`
  cannot deliver: the same as DEV today. Pull stays the data path. Restoring
  the signal needs a separate, reviewed, RLS-scoped grant.
- *Tests.* `h9-api-role-privileges.pgtest.ts` (24):
  - On a fresh-project model, F12 is reproduced exactly (32/9/9) and closed by 34.
  - The required RPCs, the access-token hook and service_role reads still work.
  - Direct API-role table access is refused with 42501.
  - Future objects give the API roles nothing.
  - On the DEV model, 34 is a no-op.
  - Each of the five guards aborts 34, and a second run is a no-op.
  - The new read-only `api_role_privileges` check section is tested: each check fails alone on its own drift.

  `createHarness` runs 34 for real, then restores the API roles' pre-34 table grants, test-only, so the RLS suites keep testing policies. Skipping that restore fails 5 RLS tests.
- *Ripple.*
  - Classification A (`A 8 · B 18 · C 8 — of 34`), forward-only by choice.
  - `history_post_h9` → 34 versions.
  - The preflight chain → 34.
  - Runbook sections A2, A3, A6, B3, B4, B7 and B9.
- *Hosted proof pending.* Applying 34 to the rehearsal project (A2 again) and to
  DEV (A-D3) each needs a separate approval.
- *Codex review, 2026-10-16: FIX REQUIRED (three P2s), fixed locally; re-review pending.*
  Each finding was reproduced against the reviewed bytes first.
  1. **PUBLIC column privileges.** `grant select (pin_hash) on users to public` passed 34 and every check. Once 34 had run, Staff A could read the Owner's PIN hash, because a column grant is invisible to `has_table_privilege`. Fixed in two places:
     - 34 now refuses any relation or column granted to PUBLIC. After acting, it compares the API roles' effective column access (`has_column_privilege`, so PUBLIC and inherited memberships count) with the reviewed set.
     - The checks gain `no_public_grants` and `api_roles_effective_column_access_exact`.
  2. **Exact column grants.** Count-only verification passed a swapped `UPDATE(phone)` → `UPDATE(permission_version)`. 34 and the check `api_role_column_grants_exact` now require 20260819000000's 25 grants exactly, as a multiset of table, column, role, privilege and grant option. A test derives that set from the SQL of migrations 1–33 and matches it to the chain.
  3. **Owner-only sequence.** A blanket `revoke all on all sequences` wrote out a NULL ACL, and the snapshot then saw "a privilege outside anon/authenticated changed". 34 now:
     - revokes only privileges the API roles hold;
     - skips default-ACL entries that already give them nothing;
     - reads NULL ACLs as `acldefault` in its snapshot.

     An owner-only sequence keeps its NULL ACL.
- *Decision: membership without INHERIT is not exposure.* **Superseded the same day (Codex round 3, below).** The API roles are NOINHERIT, as on hosted. A plain `grant role to authenticated` passes them nothing and could be used only through SET ROLE, which no API client can issue, so it is not flagged. A membership granted `with inherit true` is flagged, by both 34 and the check.
- *Codex round 3, 2026-10-16: FIX REQUIRED (SET ROLE, inherited grant options, PUBLIC defaults), fixed locally; re-review pending.* All three were reproduced against the reviewed round-2 bytes, and 34 applied in every case.
  - **SET ROLE through a plain membership.** A PostgREST-style session (session user = an authenticator, SET ROLE authenticated) could SET ROLE into a member role holding `SELECT(pin_hash)` and read the Owner's PIN hash. SET ROLE into a role it is not a member of is refused.
  - **Inherited grant option.** `UPDATE(phone) WITH GRANT OPTION`, inherited by authenticated, let it grant `UPDATE(phone)` to anon.
  - **PUBLIC default.** A PUBLIC default on future tables gave anon SELECT on the next table postgres created.

  The fix is one effective-privilege model. An API session can act as PUBLIC, as anon or authenticated, and as any role those two reach by membership — directly or transitively, by inheritance or by SET ROLE. In public, none of them may hold a data privilege, a grant option, or a default privilege that hands over future tables or sequences. The one exception is 0819's exact column grants to authenticated. 34 enforces it with three new pre-change guards, so refusal changes nothing:
  - a PUBLIC table or sequence default of any role that can create in public;
  - any grant option of the API roles, held directly, inherited, or in defaults;
  - any reachable role holding such privileges or defaults. This uses a recursive walk of `pg_auth_members` with every membership option counted, so a NOINHERIT role in the middle of a chain hides nothing.

  The checks section gains `no_public_default_privileges`, `api_roles_no_grant_options` and `memberships_reach_no_privileges`. Memberships, other roles' privileges and other creators' defaults are never changed.
- *Decisions in round 3.*
  - **Memberships are judged by what they reach, not by their existence.** Hosted evidence does not record the API roles' memberships, and the brief forbids changing required ones. So a membership of a role that holds nothing in public passes, and the read-only check reports how many roles are reachable.
  - **Function EXECUTE for PUBLIC stays deferred.** Default entries for functions are excluded from the PUBLIC-default rule.
  - **supabase_admin's public defaults are not enforced.** They give anon/authenticated full table rights on objects *it* creates; this is unchanged and identical on DEV and fresh projects. Enforcing it would fail on both projects and needs founder approval.
  - **One check is now defense in depth only.** The migration's post-change effective-column check has no independent witness, because every path to an extra column privilege is refused earlier.


## H-9 F12 R4 — local implementation, 2026-10-16

Founder authorized the complete local R4 workflow and the remaining verification corrections. D1 stays exactly 48 semantic supabase_admin public default items, never modified. API roots and conservative Reach refuse six unsafe attributes; pg_roles supplies readable metadata. rolconfig is inventoried for hosted review and is outside F12 enforcement. Mandatory hosted preflight separates enforced predicates from observations and rejects unexpected platform absence/drift. B13/M15 now require real revocable grants and drift before canary activation; C11 expects checks 3 and 10. Shared RLS restoration and all prior security contracts remain. No hosted access or production authorization. C4, Data API disabling, F14 and H-11 remain out of scope. Details: [R4 implementation](docs/plans/h9-f12-r4.md). Local sign-off not yet granted; final verification evidence follows in the verification report.

## 2026-10-19 — H-9 N0 final focused acceptance and single inventory

Founder retained authorization for the three GET-only account endpoints. Focused
independent Codex verdict ACCEPT preceded separate N0 staging and one successful
inventory. Original A5-only launcher and all 131 sealed H1 files remain unchanged.
Both known projects are ACTIVE_HEALTHY in the returned free organization; proven
visible active Free count is 2. Capacity remains UNVERIFIED because account coverage,
Owner/Administrator membership, other-member quotas and creation eligibility are
not proven by these endpoints. A2/A3 allocation stays on hold; no new endpoint,
project mutation, migration, deployment, installation, commit, push or device action.
New runtime metadata records the actual base commit and uncommitted reviewed hashes;
historical SOURCE_REVISION and stale installer audit hash were retained as history.
Details: docs/plans/h9-n0-final-acceptance-2026-10-19.md.
## 2026-10-19 — PG17 local environment start; image pull withheld

Founder approved Docker Desktop startup and one verified digest-pinned official
Supabase PG17 image download only. Docker Desktop/WSL2 started; official
supabase/postgres:17.6.1.136 source, platform and immutable digests were verified from
public metadata. Pull withheld: retained A5 evidence lacks the complete installed
DEV extension inventory required to establish recovery compatibility. No alternative
image downloaded. Docker auto-resumed the old local restore stack; those containers
were stopped again, with all container/image/volume identities retained. Volume byte
identity after that automatic startup is not asserted. No new container, hosted call,
backup, migration, installation, device action, commit or push was issued.
Founder confirms DEV and rehearsal consume both Free slots; preserve both, no paid
upgrade or deletion. Next obtain trusted extension metadata under separate read-only
authorization if no retained inventory exists; existing image-pull approval persists.
Details: docs/plans/h9-pg17-local-setup-2026-10-19.md.
## 2026-10-19 — DEV extension read and conditional PG17 image pull completed

Founder approved one DEV-only catalog inventory and clarified the fixed project SQL
endpoint is permitted; no account inventory endpoints. A separate one-use protected
launcher executed one read_only=true request. Same-query role/session/database/PG17,
READ ONLY state and H1 instance fingerprint matched. Installed: pg_stat_statements
1.11, pgcrypto 1.3, plpgsql 1.0, supabase_vault 0.3.1, uuid-ossp 1.1; schemas/owners
retained in protected evidence. Exact source/version/schema compatibility for the
previously verified official supabase/postgres:17.6.1.136 linux/amd64 image passed.
One image pulled by manifest digest sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b;
post-pull digest/platform verified. Existing Docker objects preserved; all 12
containers remain exited, no old-stack restart. No new container, restore, backup,
migration, upgrade, deployment, account listing, device action, commit or push.
A5/N0 and sealed H1/F12 evidence unchanged. Image selection PASS does not close H5
runtime/extension-owner/ACL or restore proof. Next separately authorize isolated
local verification container; no real DEV data or outbound network.
Details: docs/plans/h9-pg17-extension-verification-2026-10-19.md.

## 2026-10-19 — isolated PG17 runtime verification PARTIAL

Founder approved one disposable synthetic-only container on the existing pinned
Supabase PG17 image. Image defaults were inspected and bypassed; fresh initdb,
include-free config, network none, no ports/binds/existing volumes, tmpfs storage,
workers/schedulers disabled. Actual server/client tools are PostgreSQL 17.6;
server accepted a Unix-socket connection. My isolation assertion incorrectly
expected an empty archive_command display; PG17 reports (disabled) with archiving
off. The guard stopped before extension installation/schema/owner and synthetic
SQL tests, so compatibility remains unverified at runtime. Original failure
evidence retained; separate correction prepared but not executed. The one owned
container was cleanly stopped/removed. Existing 12 containers remain exited;
3 volume names, 14 image IDs and 131 protected H1 hashes match baseline.
No hosted calls, real backup/restore, downloads, old-stack start, install,
migration, deployment, device action, commit or push. H1/F12 and historical evidence
unchanged. Next authorize one replacement isolated container because the approved
ONE was removed; real H5 acceptance and its A5/A2/A3 gates remain pending.
Details: docs/plans/h9-pg17-runtime-verification-2026-10-19.md.

## 2026-10-19 — final isolated PG17 runtime PASS; H5 restore still pending

Founder approved exactly one replacement after the previous cleanup. Narrow
archive guard correction tested 21/21 before creation; live startup/final snapshots
confirmed archive_mode off, actual applied command/library empty, approved sources,
no pending restart or archive activity. One container used the existing pinned
Supabase 17.6.1.136 Linux/amd64 image, network none, no ports/binds/volumes, tmpfs,
disabled healthcheck/restart and bypassed image bootstrap/config hooks.
Actual PG server/client tools 17.6; all five DEV extension versions, schemas and
owner names installed and matched exactly. Synthetic SQL/FK/rollback checks passed;
no schedulers, external network, archiver or unsafe preloads. Owner-name compatibility
does not prove authentic DEV role attributes/ACLs; Vault encryption/key recovery
was not exercised. The owned container and tmpfs were removed cleanly. Existing
12 stopped containers and their start/stop timestamps, 3 volumes, 14 images,
131 protected hashes and 47 previous runtime evidence hashes matched baseline.
No hosted access, real backup/restore, download/install, old-stack start, migration,
deployment, device action, commit or push. Prior PARTIAL report and historical
evidence retained. Runtime prerequisite PASS; real H5 acceptance remains pending
separate scope/approval and A5/A2/A3/recovery gates. Next prepare run-specific H5 plan.
Details: docs/plans/h9-pg17-final-runtime-verification-2026-10-19.md.

## 2026-10-19 — H5 real backup/restore stopped at security preflight

Founder approved the scoped DEV read-only backup and isolated PG17 restore, then
confirmed no approved direct-PG password workflow or writer-pause/RPO/RTO/retention
agreement has been identified. One focused independent Codex review returned
BLOCKED: A5's fixed Management API token path cannot be used as a DB password or
retargeted; no reviewed direct-PG17 credential/client/encrypted backup executor was
found in the checked H9 paths. Existing H5/H11 docs describe controls, not concrete
approved operating values. No credentials, live source identity/data, hosted API,
backup, restore, traffic pause or new container accessed/executed. No privilege
escalation, install, deployment, device action, commit or push. PG17 runtime PASS
remains intact. Existing 12 stopped containers/3 volumes/14 images, timestamps,
131 protected hashes and 30 final-runtime evidence/source hashes matched baseline.
Founder requested one proposal: separate reviewed masked-prompt/tmpfs-passfile H5
launcher, immediate authenticated encryption with founder-held recovery custody;
90-minute scheduled writer-pause window, RPO zero committed checkpoint loss,
RTO 60 minutes, 7-day minimum encrypted retention, founder Imrul as custodian.
These are proposed, NOT approved. Host/WSL persistence protection, private storage,
source privileges, authentic role/ACL/RLS and Vault/full recovery remain unverified.
Existing task approval stays valid; real execution remains stopped pending all
mandatory gates. H-11 C5 not ready or signed off. No historical evidence rewritten.
Details: docs/plans/h9-h5-preflight-and-recovery-proposal-2026-10-19.md.

## 2026-10-19 — H5 approved policy retained; unchanged Windows host blocked

Founder approved the proposed Imrul custody, scheduled 90-minute writer pause,
zero committed checkpoint-loss RPO (offline/unpushed work excluded), RTO at most
60 minutes, minimum seven-day encrypted retention with no automatic deletion,
and separate protected password/recovery-passphrase workflow. The earlier report's
unapproved proposal remains historical; current parameters are recorded in
scripts/h9/h5-approved-policy.json. No writer pause or retention clock has started.

Founder now reports administrator BitLocker results: C: and D: both Off, 0 percent,
FullyDecrypted; no agent privileged recheck. Together with the retained disabled
pagefile-encryption observation, this blocks plaintext backup/restore processing
on the unchanged Windows/Docker Desktop host. Streaming encryption protects the
stored archive, but cannot alone exclude pagefile/swap/dump/log persistence.
Founder prohibits Windows/BitLocker changes; none were made. No execution guard
was weakened, no real data/credential accessed, no Docker resource touched.

Proposed smallest alternative: trusted native Linux host or separately prepared
nonpersistent bare-metal live USB session, Windows not running, internal disks
unmounted, no disk-backed swap/dumps/hibernation, RAM-only isolated pinned PG17
restore, authenticated streaming encryption and distinct founder-held passphrase.
Environment/tool acquisition and boot remain proposals, not actions or security
PASS. All H5 identity/privilege/traffic/recovery gates remain; H-11 C5 is pending.
Historical H1/F12/N0 evidence and prior reports were not rewritten. No install,
backup/restore, hosted call, reboot, device action, commit or push.
Details: docs/plans/h9-h5-encrypted-workflow-assessment-2026-10-19.md.

---

## 2026-10-20 — Batch 1 (nine tasks): five decisions

Delivery batch, not a wave. Nine of eleven assigned tasks shipped; **W4-04 and
W4-05 are BLOCKED — DEFERRED TO BATCH 3**, never DONE (see
`docs/plans/muthoy-five-batch-delivery-ledger.md`). Full suite
**243 files / 5,062 tests / 0 failures / exit 0** on
`pnpm test --maxWorkers=2 --minWorkers=1` (1393 s, 2026-10-21). The Gate 3
figure (238 / 4,937) is historical — Gate 5 remediation changed the tree, so
the result was re-established by a fresh run rather than carried forward.
Codex reviewed the plan over eight rounds (31 findings, all fixed) before any
code was written.

**1. A conflict is only recorded where it is PROVABLE.** H-6 detects two cases
and is deliberately silent otherwise. `pull_local_pending` compares the arriving
remote row against the **queued outbox payload**, not the local row: the row is
merely whichever side last-write-wins happened to write, so once a remote change
lands the disagreement looks resolved while the outbox still holds an edit that
will overwrite it on the next push. `push_superseded` fires only on **exact**
timestamp equality plus a difference on a client-owned field — that is
`sync_apply_row`'s strict-`<` predicate writing nothing while still answering
`'applied'`. `remote > pushed` is ordinary LWW and `remote < pushed` is a stale
pull page; flagging either would queue noise an owner cannot act on. **Residual,
stated:** if a dropped row's server timestamp never advances past this device's
pull cursor the row is never re-sent, and no client-side mechanism can see it.
That closes only with a server-side `'stale'` return — a migration *and* a
function redeploy.

**2. Which columns the server owns is DERIVED FROM SOURCE, not declared.** Four
drafts of that list were wrong, every one in the same direction — excluding a
field that is actually client-owned, which blinds the detector *silently*, since
an absent conflict notice looks exactly like no conflict. `cash_drawer`'s
reconcile columns are a fill-only-if-absent fallback (the client's value always
wins, because `recordChange` always sends a complete row), and
`users.address/email` carry the client's values through `applyUserProfileFields`
— both are client-owned. `sales`' tax snapshot is pinned on update and
`expenses.category` is canonicalised in TypeScript, so both are server-owned.
`tests/server-owned-fields.test.ts` now parses `upsertRemoteRow`,
`toSyncPayload`, the migration SQL's pin-vs-conditional forms, **and**
`functions/sync/push.ts`, and fails on drift against any of them.

**3. Monitoring DISCARDS message, cause and stack — it does not redact them.**
Rule 8 is absolute, and a scrubber has to anticipate every shape a secret can
take. `error.name` is caller-assignable (`e.name = pin` is legal) so it maps
through a closed table and anything unrecognised becomes `'unknown'`; a stack's
first line *is* the message, so Batch 1 ships **no stack capture at all**. The
provider interface accepts only a DTO of enums and integers, which means there
is no code path by which caller text could reach a provider. `dev/runtimeDiagnostics.ts`
keeps its DEV-only raw context and a test asserts `monitoring/` never imports it.
**H-8 itself stays NOT DONE** — no provider, no payment/auth/crash coverage, no
device proof.

**4. "Keep the server's copy" deletes the superseded outbox rows.** Two earlier
designs were wrong. Routing it through `applyRemoteRow` would have been a silent
no-op on **100% of real conflicts**, because `applyToTable` returns
`skipped_stale` the moment the local row is newer or equal — which is true of
every row a detector flags. Marking the outbox rows `failed` instead of deleting
them would have re-raised the same conflict on every pull, warned the owner
about a row they discarded on purpose, and — the security point —
`protectedOutboxGraph` shields `pending|failed` rows from
`purgeUnreadableTables`, which never deletes `sync_queue` rows under *any*
status. So: a dedicated force-apply that reuses the pull path's own
`preservedLocalFields`, then a delete whose exact bytes live in
`conflict_queue.superseded_payloads`, which the ACL purge *does* remove. A row
belonging to an atomic operation group refuses `keep_remote` outright — a torn
money operation is worse than an unresolved notice.

**5. A success confirmation is a Toast; a failure stays an Alert.** Only one
Alert changed — "Refund committed" in Sales History. `components/ui/Toast.tsx`'s
own contract says a toast is never how a failure is reported, because it
disappears before it can be acted on, and a destructive confirmation needs a
button. The other 26 `Alert.alert` call sites are confirmations or failures and
were left alone.

**Why W4-04 and W4-05 did not ship.** Both need a Postgres migration, and adding
any file to `backend/supabase/migrations/` breaks three H-9 gates — including
`backend/supabase/checks/h9_postmigration_checks.sql`, which asserts
`count(*) = 34` and "nothing after `20261015000000`" and is **pinned
`text eol=lf` in `.gitattributes` as hash-recorded H-9 evidence**, executed by
`h9-cron-cleanup.pgtest.ts`. A draft that re-expressed
`scripts/h9-prod-preflight.mjs`'s chain check to allow later migrations was
rejected in review for weakening a signed-off invariant to unblock ourselves.
Batch 3 owns extending the chain and its checks in one reviewed step, which is
where the migration would be applied anyway. **Until then the admin dashboard
still reports GROSS sales and must not be labelled net**, and no shop-location
or permission-dependent shop-profile feature may be released.

**W5-15: no exposure found.** Four passes over the tracked tree, the full public
history, a entropy-and-proximity hunt for *partial* fragments, and the published
surface. All six credential-shaped hits are fabricated test fixtures; all 137
partial-fragment candidates are identifiers or SHA-256 content hashes; no token
decodes to `role: service_role`. **No rotation performed** — it needs separate
founder authorization and is not recommended on this evidence. Sanitized verdict
in `docs/plans/muthoy-w5-15-dev-credential-assessment-2026-10-20.md`; no secret
material was printed or committed.

**Not claimed:** H-6's physical two-device conflict (synthetic only, with both
devices' timestamps simulated), H-8 completion, migration `0031` on a real
device, and any D8–D11 verification by physical tap.

---

## 2026-10-21 — Batch 1, Gate 5: decisions forced by the Codex final review

The independent final review of the staged Batch 1 scope returned REVISE with
11 findings. Seven of them required a decision rather than just a patch, and
those decisions are recorded here because each one is a place where the obvious
move would have been to overstate what shipped.

**D1 — No Batch 1 task is DONE; all are CODE-COMPLETE.**
`DEVELOPMENT_RULES.md`'s Definition of Done requires, as clause 2, a test on a
real Android device while offline, and clause 3 a passing Validation Checklist.
This batch is authorized for local code, tests, docs and a conditional push
only; device work needs separate approval and the founder's Galaxy A04s install
is off-limits. A green 5,032-test suite does not satisfy clause 2. Every task is
therefore labelled **CODE-COMPLETE — pending device validation** in the ledger
and the implementation record. *Why it matters:* the rule ends "AI said it works
is NOT done", and labelling these DONE is exactly the failure it names.

**D2 — W3-08 is partial, and says so.**
The static ratchet written for this finding found real hardcoded strings that
were then fixed — and then kept finding more. `sale/confirmation.tsx` (D8),
`reports/sales-history.tsx` (D9) and the new `sync-conflicts.tsx` are fully
localized and asserted as such. `inventory/batches.tsx`, `inventory/expiry.tsx`
and `sale/held.tsx` have their **verified** defects fixed (error dialogs, empty
states) but their wider surface — field labels, section titles, some
placeholders — was never localized and still is not. W3-08's assigned scope was
"D8/D9 and other **verified** hardcoded-English UI defects", so finishing those
three is a larger pass than this batch was asked to make. *Decision:* fix the
verified defects, pin them with a ratchet so they cannot come back, and record
the remainder as owed work rather than loosening the test to hide it. A
Bangla-first POS showing English field labels is a real defect; it is now
visible instead of implied.

**D3 — A corrupt queued payload records NO conflict.**
The detector compares the remote row against the **queued payload**, not the
local row, because once a remote change has been applied the row equals the
remote and a real pending edit looks resolved. The first version fell back to
the local row when the payload would not parse. That invents conflicts: the row
is whatever last-write-wins wrote, so the difference belongs to no queued
intent. *Decision:* an unparseable payload reports
`sync.conflict_detector.failed` and records nothing. A missing notice we can see
in monitoring beats a fabricated one the owner has to adjudicate.

**D4 — `attempt` ships as a bucket, never a number.**
An arbitrary integer field in a monitoring report is a channel out of the app.
The first version proved the point against itself: its own test asserted that
`129900` survived redaction — a paisa amount. *Decision:* `ATTEMPT_BUCKETS`
(0/1/2/5/10). A maintainer still learns "first try" vs "retrying" vs "stuck",
and the field can no longer carry a value. CLAUDE.md rule 8's spirit is that the
reporter cannot leak, not that we remember not to.

**D5 — No-double-charge is a database guarantee; the handler test proves its
half of the contract.**
`b4_apply_verified_payment` upserts the event row `on conflict (provider,
validation_id)` and then short-circuits on `if v_order.status = 'verified' then
… return` — so the guarantee is the ORDER STATUS, not the event key.
`backend/supabase/pgtest/b4.pgtest.ts` proves against real Postgres that a
replay advances `version` exactly once and leaves one event row. The handler
test had been asserting `toHaveBeenCalledTimes(2)`, which passes even if the
handler sends a *different* key each delivery. *Decision:* assert the outcome —
three identical redeliveries produce one grant — and assert the mirror case,
that two different ORDERS stay two payments, since a client-side dedup bug
could otherwise swallow a second real purchase and bill the shop twice for one
credit. Also assert the handler sends no amount, so a tampered callback cannot
raise it.

*Corrected after the delta review:* the first version of this entry, and the
test it described, said the dedup key was `p_event_key` and treated two
validations against **one** order as two payments. The database grants that case
once. Modelling the wrong guard made the test agree with a mistake, which is the
failure mode worth recording: a fake that is not read off the real statement
proves whatever its author already believed.

**D6 — W3-11 was extended, not narrowed.**
The review was right that the record claimed coverage the suite did not have.
Narrowing the claim would have been honest but would have quietly shrunk an
assigned deliverable, since the brief named purchases, returns/refunds and
accounting explicitly. *Decision:* extend to 18 tests — supplier invoice with a
pending line that adds no stock until received, credit sale and the payment that
clears it, a refund asserted in both directions (gross unchanged, net reduced),
a purchase return, close-day with the drawer identity, and a
failed-then-successful push replay. Cash figures are asserted against
`getCashSummary`'s own output, never re-derived here (rule 4).

**D7 — `/sync-conflicts` is reachable by every role, via an explicit opt-in.**
The screen was only linked from owner-only Settings, so a staff member permitted
to resolve a conflict could never reach one. The fix was NOT to relax the
permission-less default in `visibleMoreRoutes` — that default is what keeps
unlabelled routes hidden — but to add an explicit `allRoles` flag the route must
set deliberately. Row-level filtering still happens in `db/conflicts.ts`, so
reachability and authority stay separate.

**D8 — No screen renders an `Error` message.**
Three delta rounds kept finding the same leak in different places: `caught.message`
rendered straight to the user. Every message in `db/` is written in English, so a
Bangla-first POS showed English at exactly the moment a shopkeeper most needs to
understand what happened — and it is the least-tested path on any screen, so it
stayed broken while the happy path was fully translated. A literal-scanning test
cannot see it either, because the English lives in a different file.

*Decision (SUPERSEDED BY D10 — the module was a duplicate and is deleted; the
map now lives in `i18n/display.ts` as `ERROR_NAME_KEYS`):*
`domain/errorMessages.ts` maps `error.name` to a catalog key, every
screen calls that, and `tests/localization-and-ui-consistency.test.ts` forbids
`.message` outright in the fully-localized screens. Names are stable where
sentences are not, and the map is checked for completeness against the error
classes `db/conflicts.ts` actually declares and throws. An unmapped error falls
back to a screen-specific generic key rather than leaking the original text.

A related rule came out of the same round: **our vocabularies get translated,
the shopkeeper's do not.** `sales.status`, `expenses.category` and
`conflict_queue.table_name` are ours, so they are mapped; `medicines.unit_of_measure`
is free text the shopkeeper typed, so it is passed through untouched — only the
value the schema supplies by default (`piece`) is translated.


**D9 — W3-08's partial gap closed; and the payment provider question is a
founder decision, not an engineering fix.**

*Localization.* The three screens Batch 1 left partial are now fully localized,
and the ratchet's two-tier list is gone — a tier that holds some screens to a
weaker standard becomes the place defects collect. Closing it surfaced three
shapes a literal scan structurally cannot see: an enum slug rendered from a
dynamic expression (the expiry bands), prose sitting between two interpolations
(`{qty} in stock · {expiry}`), and an English error delivered through
react-hook-form's `setError({ message })`. Each now has either a
source-derived completeness check or its own detector pass, and the detector no
longer flags `className` strings — noise in a ratchet trains people to ignore it.
A control-byte test was also added, because a shell heredoc turned an intended
`\b` into a literal 0x08 SIX times in one session. The sixth was caught by
this very guard, in the sentence of this record describing the bug — which is the
point: inspection missed five, an assertion caught the next one, each time producing a green
test that matched nothing. See [[batch-1-complete]].

*Payments.* A bKash-only requirement was raised at closure. It is not recorded
anywhere in the repository, and the locked 2026-08-31 B4 decision says the
opposite: *"SSLCommerz is first provider."* W3-06's shipped tests exercise
SSLCommerz because **no bKash gateway implementation exists** — the bKash
references are the customer `payments.method` enum (unrelated to subscriptions)
and the legacy `subscriptions.payment_provider` enum (`db/schema.ts:92`), while
the path that actually creates an order types `provider` as `["sslcommerz"]`
only (`db/schema.ts:325`). *Decision:* do NOT deactivate SSLCommerz. Doing so
would change money code, contradict a signed-off decision, and leave no
subscription payment path at all. The posture is already safe — absent
credentials, the provider throws `payment_not_configured` and fails closed, so
no money can move while this is settled. Recorded as gate E5 in the delivery
ledger for a founder decision between keeping SSLCommerz first with bKash as a
later provider, or making bKash exclusive and superseding the B4 decision.


**D10 — one error-to-text map, not two. (A duplicate I introduced and then removed.)**

While closing W3-08 I wrote `domain/errorMessages.ts` with an `ERROR_MESSAGE_KEYS`
map so screens could turn a thrown error into a catalog key instead of rendering
`caught.message`. The mechanism was right and the module was redundant:
`i18n/display.ts` already did exactly this, via `userFacingError`, keyed on
`error.name`, and it already had `duplicateBatchErrorLabel` and
`batchExpiryMismatchErrorLabel` in both locales.

Two maps for one job is how dialogs and field errors drift apart — and they
already had: my version put already-translated text into react-hook-form, where
`FormField` ran it through `localizeValidationMessage` a second time, failed to
recognise it, and showed the generic "invalid value". **Adding a translation made
that message worse than the English it replaced.**

*Decision:* delete `domain/errorMessages.ts`. Hoist the existing map to a
module-level `ERROR_NAME_KEYS` in `i18n/display.ts`, add the four H-6 conflict
classes to it, and have BOTH `userFacingError` (dialogs, toasts) and
`localizeValidationMessage` (field errors) read that one map. Screens call
`userFacingError(err, 'fallbackKey', t)`; `batches.tsx` puts `err.name` into
react-hook-form so the single translation happens in one place. A test asserts
the two surfaces agree, which is what fails if a second map reappears.

*Why it is worth recording:* the duplicate was not a typo. I reached for a new
module without first checking whether the codebase already solved it, in a repo
whose own rules say to search before writing. The review caught it; the test now
does.

## 2026-10-22 — Batch 2 (seven tasks): four decisions

### 1. bKash supersedes SSLCommerz as the subscription provider — and that leaves no provider at all

The 2026-08-31 decision recorded at line 1308 said: *"SSLCommerz is first
provider. Verified provider data plus an exact server-side amount match are what
grant entitlement."* That text stands as the record of what was true then, and
the second half of it is still the rule. The first half is superseded.

The founder's locked decision (2026-10-21) is that **SSLCommerz is no longer
approved** and **direct bKash is the only approved subscription gateway**. W4-10
therefore retires SSLCommerz from active selection and routing: `resolveProvider`
refuses every `PAYMENT_PROVIDER` value — including `'sslcommerz'` itself — with
503 `payment_not_configured`, and the device refuses before it writes a local
attempt row.

*The consequence, stated plainly because it must not be discovered later:* bKash
is BLOCKED on gate E8 (three undocumented contract surfaces — the callback
request contract, the `Authorization` value format, and the signature/IPN
verification procedures). So after W4-10 the product has **no active
subscription payment path at all**.

*Decision:* ship the retirement anyway, and fail closed. It changes nothing
operationally — the system already failed closed with no credentials
configured — but it removes a provider that is no longer approved from every
path that could select it, and it does so without touching a single historical
payment: `payment-webhook/handler.ts` still verifies and applies a late
callback, `_shared/sslcommerz.ts` and its 47 tests stay, no privilege is
revoked, no payment function is dropped, and no migration was added.

*Why it is worth recording:* the safe state and the complete state are not the
same state. This is the safe one, and nothing anywhere — product copy, release
notes, a pilot sign-off — may describe subscriptions as functional until E8 and
E4 clear. The screen says so in both languages.

### 2. The medicine catalogue does not violate rule 9 — and ships empty anyway

CLAUDE.md rule 9 is *"No seed/demo data ships — every fresh shop starts
empty."* A 21,000-row medicine catalogue looks like exactly the thing that rule
forbids, so the reconciliation is recorded rather than assumed.

*Decision:* a licensed medicine catalogue is **reference data, not seed data**,
and rule 9 does not forbid it. The distinction is ownership: rule 9 exists so a
new owner never sees a previous owner's *shop* data — invented sales, invented
stock, invented customers. A catalogue of what medicines exist in Bangladesh is
not any shop's data. It is owner-scoped on import, it creates no inventory, no
batch and no sale, and selecting from it only **prefills a form the user then
saves themselves**.

*And it ships empty regardless*, for an unrelated reason: gate E7. No licensed
source exists. DGDA, the authoritative registry, reports ~34,000 allopathic
products behind an expired TLS certificate and publishes no bulk licence; the
~21,000 figure in the original scope line traces to a Kaggle scrape of
medex.com.bd with no stated licence. **Zero rows ship, and the count is not
claimed.** `docs/plans/medicine-catalog-provenance.md` records the four
conditions a verified count requires.

*Why it is worth recording:* the rule-9 question and the licensing question have
different answers, and conflating them would have produced either a wrongly
blocked feature or a wrongly shipped scrape.

### 3. The admin session is a signed stateless cookie, not a session table

W4-06 needed real admin identity: per-account login, roles, logout, lockout and
an audit trail. The obvious shape for sessions is a `admin_sessions` table with
per-row revocation.

*Decision:* use a **signed, stateless cookie** — HMAC-SHA256 over
`{ sub, role, iat, exp, lastSeen, epoch }`, with an 8-hour absolute TTL and a
30-minute idle TTL — and take revocation from an `ADMIN_SESSION_EPOCH`
environment integer.

The reason is the H-9 migration seal (E4). A session table is a Postgres
migration, and adding one to the chain breaks three H-9 gates including a
hash-pinned check file. The choice was therefore: a session table and a broken
seal, or no table and a weaker revocation story. The weaker revocation story
wins, because it is weaker in a way that is bounded and stateable.

*The limits, which the panel's own README and `/audit` page both state:*
revocation is all-or-nothing (no per-user revoke until the Batch 3 table) and
environment-bound (it takes effect once the new environment is live, which on a
host like Vercel means deployment propagation, not instantly); the two login
throttles are per-instance module state, so N instances allow N times the
attempts; and the in-app audit view is per-instance and non-durable, with
**stderr as the record of account**.

*Why it is worth recording:* each of those three is a real operational
constraint that someone will otherwise discover during an incident. The sink is
an interface precisely so the Batch 3 Postgres sink changes no call site.

### 4. Barcode stays EXCLUDED, and the contradiction in the older documents is resolved here

Older planning documents treat barcode scanning as part of the OCR work, and
`docs/plans/ocr.md` describes barcode candidates and an ambiguity picker as
shipped behaviour. The Batch 2 scope question Q1 resolved the other way:
**barcode is EXCLUDED.**

*Decision:* implement no barcode scanning and no barcode fallback. OCR must work
independently, with manual confirmation. The barcode code that already shipped
is **neither deleted nor extended** — deleting working shipped code to satisfy a
scope decision would be a regression dressed as tidiness.

So the confirmation gate W2-01 added covers the paths where a MISREAD can reach
the cart, on both scanners. It deliberately does **not** cover tapping a search
result or tapping a barcode candidate: both are explicit user choices, not a
machine's reading of a blurry strip.

*Why it is worth recording:* two documents disagreed about whether barcode was
in scope, and the disagreement is now resolved in the place that is read first.
`docs/plans/ocr.md` carries a header pointing at
`docs/plans/ocr-and-multilingual-search.md` for current status.

## 2026-10-23 — the delivery roadmap becomes SIX batches

*Decision (founder):* the delivery grouping extends from **five batches to
six**. A new **Batch 6** holds **exactly two deliverables and no third**:

- **B6-01 — the real ~21,000-medicine dataset.** Obtain and verify a legally
  usable, appropriately licensed dataset: provenance, actual record count,
  duplicates, quality and update rights all verified; the records integrated
  through the **existing Batch 2 architecture** (catalogue schema, JSONL
  importer, search provider, offline lookup); offline availability, integrity,
  updates and device performance verified. **No unlicensed scraping, and no
  fabricated entries to reach 21,000** — that number is a product target, not
  permission to invent records, and whatever count is verified is the count that
  gets reported. Existing shop medicine, inventory, purchase and sales records
  are preserved.
- **B6-02 — the direct bKash merchant payment gateway.** bKash is the **only**
  approved subscription gateway and **SSLCommerz is never reactivated for new
  subscription payments**. Built on the verified official merchant API and
  security contracts, with secure initiation, callback verification,
  idempotency, reconciliation, failure recovery, and the required sandbox and
  live acceptance. Historical payment data and the legacy reconciliation that
  still settles pre-retirement orders are preserved. **No invented API
  contract, credential or live payment evidence.**

*What this supersedes, and what it does not:* it supersedes the five-batch
**delivery grouping** only. The original **Waves 1–5 development roadmap is
unchanged** — a wave says what the work is, a batch says when it ships. Every
completed implementation, signed-off review and piece of historical evidence
stands as written; the Batch 1 and Batch 2 records keep their original
statements and carry dated ownership addenda instead of being rewritten.

*Ownership moved:* gate **E7** (licensed dataset) → **B6-01**; gates **E8** and
task **W4-09** (direct bKash), plus the live payment acceptance previously
pencilled into Batch 4/5 → **B6-02**. These are owned in Batch 6 and **nowhere
else**, so no batch double-counts them.

*Ownership deliberately NOT moved:* W2-03 stays **PARTIAL** and its remaining
Bangla/Banglish search over **existing shop medicines** stays in **Batch 3**,
together with its SQLite folded-key migration, FTS rebuild and
data-preservation verification. W4-04, W4-05, the H-9 migration dependencies
(E4) and the durable admin audit table also stay in Batch 3. **Barcode scanning
remains EXCLUDED.**

*Release dependency, stated so the regrouping cannot be read as a shortcut:*
Batch 5 may prepare the pilot, the release checklist and its other launch
activities, but **final public launch and full-feature production sign-off stay
BLOCKED until both Batch 6 deliverables and every other applicable release gate
are accepted.** Neither B6-01 nor B6-02 may be marked DONE before real evidence
exists — a licensed dataset with a measured count, and an actual sandbox/live
payment run.

*Why it is worth recording:* the two things this product most visibly lacks —
real medicine data and a way to take money — were each blocked on an external
dependency no amount of engineering could clear from inside the repository
(E7's licensing, E8's undocumented contract). Scattering them across Batches 3,
4 and 5 as "remaining work" is how they stayed everyone's problem and nobody's
deliverable. Giving them their own batch, with exactly two items and an explicit
bar for DONE, is what makes them schedulable.

---

## 2026-10-26 — Batch 3: the Admin Panel's P1 build-out, E4, W4-04, W4-05, W2-03

*Decision:* Batch 3 is **CODE-COMPLETE** on every local axis and **verified on
nothing hosted and no device**. The two axes stay separate words, and this entry
says which applies to each claim.

*What was decided, and why it is worth recording:*

**1. The entitlement-refresh action was withdrawn from the panel, not fixed.**
`b4_refresh_entitlement_snapshot` sets `verified_at = now()`, and
`apps/mobile/domain/entitlements.ts:143-146` makes `verified_at` the offline
access ceiling. So the button shipped in Batch 2 (`a2c196a`) extended a device's
premium access by the full offline window **with no payment behind it**. The
conservative response was taken: the surface is gone and the RPC is forbidden by
name, so re-adding it fails the build. **The RPC itself is unmodified** —
rewriting money-path SQL needs its own approved plan (CLAUDE.md rule 10). That
is gate E11.

**2. Three figures that cannot be computed are reported BLOCKED, not estimated.**
The MRR trend and churn need a subscription history that does not exist, because
a renewal overwrites the same row (gate E12). A collected-payments series ships
in their place, labelled as itself. Calling it the MRR trend would have been the
mislabelling the metric manifest exists to prevent.

**3. No pharmacy location is plotted, although the map is built.** A
`location_captured_at` timestamp is a capture record, not an affirmative,
versioned, revocable consent record (gate E13), and no tile provider is
configured, so no viewport around a pharmacy leaves the browser (gate E14).
Leaflet is wired behind both predicates, so enabling it later is a data and
policy change rather than new code. This costs nothing today: nothing in the
mobile app writes a coordinate.

**4. Lifecycle overrides are rendered unavailable WITH THEIR REASON, not as
disabled buttons.** A greyed-out control says "this exists and you may not use
it". The truth is that the extend-trial / force-status design was superseded and
unapproved, and its replacement needs a separately approved audited server API
(gate E10). Those are different facts and only one is true.

**5. W2-03 is complete, and one limit of the fold is recorded rather than
hidden.** SQLite migration 0033 adds a folded `search_key`, a chunked
transactional backfill fills it, and the query permanently unions the raw and
folded terms so a row whose key is still NULL stays findable. The fold has no
`c`/`k` rule, so the English spelling "seclo" does not reach a row stored as
"সেক্লো" — a gap in W2-02's shipped fold, asserted by a test that will fail the
day somebody fixes it. Widening the fold would change the national catalogue's
index semantics and require a re-import, so it was not done here.

**6. A test that compared copies to copies is replaced by one that reads the
database.** `packages/validation`'s admin schemas had drifted from hash-sealed
migration 35 on five value spaces, and the test asserting "the keys are
identical in three places" passed because all three TypeScript copies had
drifted together. Every support and settings write would have passed validation
and then failed at the CHECK constraint. The lesson is recorded in
`docs/plans/admin-architecture-rbac.md`: **compare against the database, not
against another copy.** The same class recurred in this batch's own test
fixture, where a missing `maybeSingle()` made a page's error notice look like a
passing assertion.

**7. Every guard that fired on new code was made stronger, never relaxed.** That
happened repeatedly — the metric label scan, the net-figure provenance chain,
the server-owned-fields evidence table, the rollback classification, the E4
evidence manifest, and the route-contract fixture. Each widening is an exact
needle with a negative control proving the guard still catches what it is for.

*Boundaries honoured without exception:* no hosted SQL executed, no hosted
project altered, no credential retrieved, no production deployment, no real
payment, no EAS build, no physical-device operation. The founder's Galaxy A04s
is untouched. No `audit-artifacts/**` file was modified and the H-9 baseline
hashes are unchanged and still asserted. Both Supabase Free projects are
untouched.

*What Batch 3 did NOT close:* E1, E4-H, E5, E10, E12, E13, E14 and E15, plus
H-11's C5 restore rehearsal. Each is enumerated with its owner in
`docs/plans/release-readiness-checklist.md`. **No admin page is DONE until E15 —
the deployed devtools check Volume 5 calls "a hard-spot verification, not a
formality" — has been performed.**

## 2026-10-31 — Batch 3: the six consolidated founder decisions, and five records that were missing

*Decision:* Batch 3 stays **TECHNICALLY ACCEPTED — OPERATIONAL GATES PENDING**.
One of the six decisions is **delivered**, one came back **NO on a prerequisite**,
one is **refused with evidence**, and three are **prepared and waiting on
authorisation or hardware**. Execution detail:
`docs/plans/muthoy-batch-3-founder-decision-execution-2026-10-31.md`.

*The six, with what actually happened:*

**1. Migration 37 (E11) — the read-only preflight is prepared; the apply is not
available as specified.** The founder asked that 37 be applied while 35 and 36
remain held, and warned against treating functional independence as proof the
hosted ledger supports that order. The warning was right and the answer is no.
This project's only sanctioned applier is `supabase db push --linked`, whose
unit of selection is every local migration absent from the remote ledger, in
version order; the captured CLI 2.117.0 help receipt shows no per-migration
flag. DEV's ledger tail is 34, so one push applies **35, 36 and 37 together**.
The two ways to apply 37 alone — a repair row, or out-of-band SQL plus a repair
row — are both forbidden by this project's own written policy ("Never use
`--include-all` ... or migration repair"), and the second leaves an out-of-order
ledger that only the forbidden flag could later push. **So Decision 1 and
Decision 2 cannot both be executed as written, and Decision 1 is gated on
Decision 3**: any push carrying 37 also carries class-C migration 35, whose
recovery depends on the restore that has never been rehearsed.

**2. E4-H — 35 and 36 are held.** Order 35 then 36 preserved; both applied to no
hosted project; the E4 evidence manifest and the E4-B successor manifest show no
drift and the five sealed declaration files are unchanged. Nothing was executed,
which is the decision.

**3. H-11 C5 — the minimum safe action is a capability READ, not a restore.**
Checking the provider's documentation found **Supabase contradicting itself**:
its Free-plan FAQ says there are no automatic backups, its Database Backups
guide says every Free project is backed up daily, and nothing in its own
documentation confirms that a restore can target a **separate** project. PITR is
a paid add-on (about $100/month per 7 days). So the drill cannot be designed
yet, which is what the repo's own prerequisite 1 has said all along. The
recommended rehearsal is on a **disposable project seeded with the synthetic
97,165-row fixture** — it exercises the provider's real restore path with zero
pharmacy data, satisfying the data-protection constraint by construction rather
than by procedure. If DEV itself is ever rehearsed, only `restore_baseline.sql`'s
**per-table digests** leave the provider; no row does. A dump of DEV onto the
Windows host is explicitly not the minimum safe action.

**4. The Android Preview build is prepared and costed, and not submitted.** The
Preview identity resolves from the current revision — `com.muthoy.pos.preview`,
scheme `muthoy-preview`, "Muthoy POS Preview" — and the pinned `eas-cli@21.8.0`
matches `eas.json` exactly. The account's entire build history is **three
builds**, which also confirms from the provider's own record that the existing
Preview APK is `bd0fa4d` on profile `internal`. Against the Free plan's 15
Android builds a month, October used two, so **quota is not a constraint and one
`internal` build costs $0**. Two corrections to earlier records: the local JDK 8
blocks only a local build, not a cloud one; and `eas env:list` timed out, so
whether EAS's `preview` environment carries the DEV Supabase configuration is
**unconfirmed** and must be checked before any build. Zero devices are
available, so the ten-step two-device checklist is PENDING, not failed.

**5. The Admin Dashboard's entitlement counts — DELIVERED, by deletion.** The
panel's TypeScript transcription of the status/date rule and its three exported
predicates are **gone**, not patched: migration 37 made every server decision
additionally require the snapshot to agree with the subscription behind it, and
that is not transcribable because the evidence is in another table. The counts
now consume `b4_effective_tier` by RPC, once per account, for the page's single
instant — and `entitlementCounts` **takes no clock at all**, which is the real
fix, because a function with no date in reach cannot drift from the rule that
reads them. Evidence at three layers, none sufficient alone: real PostgreSQL for
the 13-case matrix and the three reproductions, a new query-layer suite proving
the RPC is asked at all and that a failure raises rather than answering with the
half that replied, and the route contract proving the **rendered figure** moves
when the verdict moves and the snapshot does not. A mutation probe narrowing one
arm of the SQL failed exactly two tests and no others. **One honest limit:
against a project where 37 is not yet applied, `b4_effective_tier` is the
pre-E11 function, so the figures still over-report there.** Decision 5 does not
close the misstatement by itself; applying 37 does.

The independent review of this pass returned **four findings, all mine, two
blocking**, and the first is worth recording for what it says rather than what
it cost. `status` came from the snapshot read and the verdict from a later round
trip, so an account that moved between them was reported as `trialing/pro` — a
pair the SQL cannot produce, counting a paying customer as a trial. The
reviewer's diagnosis: *"`p_now` fixes the clock, not the database snapshot."* I
had spent the whole fix arguing clock-independence and introduced **snapshot**
incoherence while doing it. The panel now re-reads the verdict-relevant columns
and **refuses the page** if any of them moved, while deliberately ignoring the
`verified_at`/`version` stamp that every device poll bumps — with a test for the
refusal and a second for the non-refusal, because a check that is too strict
fails as badly as one that is too loose. The reviewer could **not execute
Vitest** (esbuild `spawn EPERM`, zero tests run) and said so; its findings came
from its own PostgreSQL probes.

**6. The logout wording was NOT shipped, because the behaviour it describes does
not exist.** The founder approved the sentence "Signing out signs this shop out
on every device", on a premise that came from my own closure report — which I
wrote without opening the logout code. The code is the opposite, deliberately
and with tests: the Logout button runs the narrowest possible clear and does not
even drop the cloud token; `signOutDevice` uses `scope: 'local'` with a comment
saying "on purpose" and a test asserting it, precisely so one handset's sign-out
does not sign the owner out of their other phone; and a second device signing in
inserts its own binding and revokes nothing. Sessions are cut across every
device by four paths, none of them a logout: staff **deactivation** and a
**role change** (`signOutAppUser`), a **PIN reset**
(`revokeCallerSessionsGlobally`), and **rebinding an auth identity** — and for
PIN reset the app already says so correctly. An Owner revoking a **device** is a
different and TARGETED operation for live sessions: it cuts that handset and its
bindings while a second handset keeps its own, but it also leaves a persistent
enrollment hold, so enrolling the same actor on a fresh handset afterwards
raises `MU070` and needs a second administrator. Two review rounds corrected
this entry: the first because I had listed device revocation among the global
paths, the second because "that device only" and a three-item list were both
still incomplete. So there is no all-device logout to keep. Preserving the behaviour is
satisfied by changing nothing; three wording options are in the execution record
and the choice is the founder's. `ADMIN_ROLES` verification remains
unperformable because nothing is deployed, but the validator already fails the
panel closed at boot, and the staging procedure records only a count, a set of
roles and a verdict — never a username or a value.

*Five decisions that were made earlier and never recorded here:*

**A. The Batch 3 financial privacy policy.** A pharmacy money figure is released
only as an **immutable published snapshot**, never as a recomputation, because a
recomputed figure can change and the change itself discloses the difference. On
top of that sits a **k=5 floor on every trading day**, on both the selling and
the refunding side. The consequence is stated rather than discovered later: at
ten pharmacies the expected production behaviour is to **publish nothing**. No
pharmacy coordinate is plotted at all — a capture timestamp is not an
affirmative, versioned, revocable consent record, and no tile provider is
configured — so no viewport around a pharmacy leaves the browser.

**B. The publication snapshot (migration 36 / E4-B), and why it is class B
rather than C.** It was the first migration whose rollback class was a **design
constraint rather than an outcome**. Publication evidence is written to
`admin_audit_log` — already class C — inside the same transaction, and
`financial_publications` is only the serving copy. So discarding the serving
table loses what the panel reads, not the record of what was published, and a
later republication at a different value would contradict the audit log. The
guard is exactly as strong as audit retention, which is an operator decision
taken outside the application. This deliberately avoided creating a second
class-C migration whose only recovery is the restore H-11 C5 has never
rehearsed.

**C. Migration succession after the H-9 seal.** H-9 sealed the chain at 34. Every
later migration is a **successor with its own acceptance check**, never an edit
to a sealed one — which is why `e4_postmigration_checks.sql` exists beside the
byte-identical `h9_postmigration_checks.sql` rather than replacing it.
`POST_E4_MIGRATIONS` in `backend/supabase/pgtest/checkFile.ts` is the
authoritative successor list, the production preflight carries the same list, and
a test asserts the two agree — so the declaration cannot drift from the files
without a gate failing. A successor that is not declared makes the preflight's
refusal lie, which is why 36 and 37 were declared on the day they were written
and before either was applied anywhere.

**D. The dual-agent acceptance process.** No revision is accepted on one
reviewer's word: Claude and an independent Codex review must both ACCEPT **the
same final source revision**, and the loop repeats until they do. Passing tests
that do not exercise the claimed behaviour are not acceptance — which is the
rule that produced this batch's mutation probes and negative controls. **Codex's
inability to execute Vitest is disclosed whenever it persists** rather than
smoothed over: across Batch 3's E11 review it ran the suite in one round out of
eight, on a subset, and the report says so in those words. Eight rounds produced
thirteen findings, every one of them mine, five of them defects in my own fixes.

**E. iOS becomes B6-03 — and this supersedes a clause, which is recorded rather
than rewritten.** The 2026-10-23 entry above gives Batch 6 "**exactly two
deliverables and no third**". That clause is now **SUPERSEDED**: iOS delivery is
approved as a third Batch 6 deliverable, **B6-03**. The 2026-10-23 entry keeps
its original wording and this is its addendum, per that entry's own rule that
records carry dated addenda instead of being rewritten. B6-03's scope is **not
yet specified** and nothing in the repository implements it; the two existing
bars still apply — no deliverable is DONE before real evidence, and final public
launch stays blocked until every Batch 6 deliverable and every applicable
release gate is accepted.

*What this entry supersedes:* the closure report's §4 claim that migration 37
"depends on B4 only" (it also needs migrations 23/25 for
`h7_shop_billing_bootstrap_allowed`, now measured in both directions); the
Decision 5 deferral recorded hours earlier, which is now delivered; and the
premise behind Decision 6's wording. The historical entries above are unchanged.

*Boundaries honoured without exception:* no hosted SQL executed, no hosted
project altered, no migration applied anywhere, no credential retrieved or
printed, no production deployment, no EAS build submitted, no paid resource
consumed, no device operation, no `audit-artifacts/**` file modified. The
mutation probe on migration 37 was reversed and its blob verified byte-identical
(`d27580c8`), leaving `backend/supabase/migrations/` clean. The Preview worktree
`D:\Muthoy-Preview-Test` is untouched at `bd0fa4d`. Both Supabase Free projects
are untouched.

*Batch 4 is not begun.*

## 2026-10-31 (closure run) - Batch 3 stays OPEN, and the reason is hardware

*Decision:* the one-pass closure run is complete and Batch 3 is **NOT closed**.
It remains **TECHNICALLY ACCEPTED, OPERATIONAL GATES PENDING**. Full record:
`docs/plans/muthoy-batch-3-final-closure-execution-2026-10-31.md`. The earlier
report of the same date keeps its wording and carries a dated addendum pointing
here; nothing above is rewritten.

*The finding that settles it:* **H-11 C5 cannot be closed without a physical
Android device, so no amount of further server-side work can close Batch 3.**
C5 is not only the server restore. `restore_drill.md` Part B is a device restore
and Part C is the encryption migration at 21.8 MiB with a mid-migration kill.
`adb` is not installed and zero devices are attached. This was always true in the
document and is now stated as a conclusion rather than left to be rediscovered.

*What the run did accomplish, with real new evidence:*

**1. The first PG17 restore rehearsal this host could actually execute.** Every
prior record says the Docker daemon was unavailable. It is now up, and
`public.ecr.aws/supabase/postgres:17.6.1.159` was already cached - so an
isolated, Supabase-flavoured PG17 target existed locally with **no new Supabase
project, nothing purchased and no hosted contact**. Two containers on 127.0.0.1
only, each `server_version_num = 170006`, each shipping a **PG17.6 `pg_dump`**,
which is how the PG17-client requirement is met on a host whose own client is
18.6. Synthetic data only; the DEV password was never requested, because by this
project's own written rule it is the founder's.

**2. Four defects in our own written restore procedure**, found for free before
the real maintenance window: the Supabase image's `postgres` database is never
empty (`auth`/`cron`/`vault`/`storage` pre-exist, so step 8's "EMPTY target" plus
step 9's ban on `--clean` cannot both hold); a `pg_cron`-enabled archive cannot be
restored into any database but `cron.database_name`, which is the one that is
never empty - a **configuration requirement** on a local target, where that
setting can be changed with a restart, and a hard stop on a hosted project where
it cannot; owner preservation needs `SET ROLE supabase_admin`, and `postgres` is
neither superuser nor a member, which is all a hosted project ever grants. The
fourth is the good one, stated no wider than it was measured: **a postgres-owned
synthetic SUBSET restores cleanly** - exit 0, rows 2/2, with `SECURITY DEFINER`,
owner and ACLs preserved. That is **not** DEV's shape: DEV carries
`supabase_admin`-owned extensions, exactly the class that fails above, so whether
DEV restores cleanly is still unmeasured. Defect 2 is a **PROD** problem, not a
DEV one, because DEV deliberately has no scheduler.

**3. Migration 33's own `cron.schedule` call ran against real `pg_cron 1.6.4`**,
and the job it created matched the PGlite stand-in in **all seven columns**. A
draft of this entry claimed the branch ran "for the first time anywhere". That
was false - the fourth unenumerated quantifier I have written in this batch, after
"B4 only", "every gate" and "every capacity decision".
`docs/plans/h9-verification-report.md` records the 2026-10-15 hosted rehearsal
applying migrations 32-33 with pg_cron enabled, 0 failures, `cron` checks 5/5,
and finding F10 stating *"migration 33 applied and verified B2's job."* The real,
narrower gain: that rehearsal says *"B2 created cron job 1 itself"*, so 33 took
its `v_jobs = 1` verify branch and never scheduled anything. This run had no
pre-existing job, so 33 took `v_jobs = 0` and scheduled the job itself. Both
halves of the conditional are now covered against a real scheduler rather than a
stand-in.

**4. A correction to my own expectation:** a dump **does** carry the schedule.
`pg_restore --list` contains `TABLE DATA cron job`, because pg_cron marks its job
table for extension config dump. I had expected it to be lost.

*Decisions taken, not deferred:*

**A. The Android Preview build was NOT submitted, and the reason is new.** With
the EAS `preview` environment injected, the gating validator's refusal changed
from `configuration-invalid` to **`native-project-stale`** - so the environment
and the pinned public-key fingerprint validate, and something else refuses. The
cause is `apps/mobile/android/app/build.gradle` carrying `applicationId
'com.muthoy.pos.h3scratch'`. That refusal is **intended and asserted**:
`apps/mobile/tests/environment-policy.test.ts:100` enumerates that very package
among those that must "refuse before build". And `h3scratch` is **retained**
device-testing state, recorded in this file across H-3, H-4, H-10, A2.3 and H-5,
with the H-9 remediation report stating it remains. The remedy therefore deletes
another workstream's state, and the authorisation was explicitly *"after these
checks pass."* They do not pass, so nothing was built and nothing was deleted.
Quota was never the constraint - the build would have cost $0.

This is not a local advisory that could be stepped around: the sanctioned command
`pnpm build:eas` routes through `validate-mobile-environment.mjs --eas-build`,
whose `main()` calls `assertNativeProjects` unconditionally before it ever spawns
`eas build`. A **second** precondition also refuses - `assertCleanRevision` uses
`git status --porcelain=v1 --untracked-files=all` and so refuses on any dirty
tree, and five pre-existing `apps/prototype-web` entries make the revision dirty
regardless of this run's work.

**Then the independent review found that refusing was still wrong, and it was
right.** H-9's own environment document prescribes, for exactly this
`requireCommit=false` problem, *"Use a fresh dedicated checkout, keep inspection
outputs outside it."* A fresh checkout of a committed revision carries no
generated native project and no dirt, so both gates pass without touching
`h3scratch` or the prototype files - and the precedent is already here, since
`D:\Muthoy-Preview-Test` at `bd0fa4d` is how the existing Preview APK was built.
So no founder decision about `h3scratch` is required; that item is withdrawn, and
the refusal was mine rather than the repository's.

**Acting on that, the route was then proven.** A fresh worktree at the delivered
revision shows 0 dirt lines and no native project, and after a frozen-lockfile
install the gating validator returns `Mobile environment validation PASS.` The
full `--eas-build` path produced the archive and its inspection manifest - 440
entries, each with a SHA-256, at cli 21.8.0, profile internal, environment
preview. It then stopped at the submit, which is the control working: the script
spawns `eas build` with inherited stdio and deliberately omits
`--non-interactive`, because the credentials and approval flow is meant to have a
human in it. Verified against the provider: zero builds exist at `4418bbf`, so no
quota was consumed and no remote state created. One mechanical trap is recorded
for next time - the validator must run from `apps/mobile`, since from the
checkout root `eas` writes a stray `{"expo": {}}` stub that is untracked,
un-ignored, and dirties the tree on the following run.

**B. The EAS `preview` environment is confirmed to carry DEV.**
`EXPO_PUBLIC_SUPABASE_URL` = `https://btfprhticjgeihcngpif.supabase.co`, matching
both the resolved config's `supabaseProjectRef` and the policy's pinned
`DEV_PROJECT_REF`; `EXPO_PUBLIC_SUPABASE_ANON_KEY` exists and is marked
SENSITIVE. It was **deliberately never fetched** - `eas env:exec` can feed a
checker a value without displaying it, which is how the fingerprint was validated
without disclosure. This closes the second of the previously outstanding
approvals.

**C. Admin E15 is NOT VERIFIED, and no substitute evidence is offered.** The
production build passes (`1 successful, 1 total`). The service-role key is
confined: six secret-shaped patterns return **0 files** across the client
chunks, with three controls proving the scan is not vacuous - it finds strings
that are there, the identifier **does** appear in the server build, and a planted
canary in a copied chunk is caught. But that proves an identifier's absence from
client chunks, not eleven working routes. No browser driver exists (no
Playwright/Puppeteer; the configured `chrome-devtools` MCP server timed out
connecting) and no DEV service-role credential is in custody. Per the founder's
own fallback instruction, E15 is recorded NOT VERIFIED rather than dressed up in
build or unit-test evidence.

**D. Migrations 35, 36 and 37 remain unapplied**, held by two independent
conditions: the founder's authorisation requires a passed backup-and-restore
acceptance (which C5 is not), and the sanctioned applier is not installed on this
host, so even the read-only `--dry-run` could not be run. Migration 35's class-C
requirement was **not** weakened to manufacture closure.

**E. The logout behaviour was not rewritten.** A normal shift logout stays the
narrowest possible clear and `signOutDevice` keeps `scope: 'local'` with the test
asserting it. Option A wording stands; nothing in this run showed the behaviour
differs from the record.

*New tooling:* `scripts/h11/dev-backup.mjs` with 12 offline contract tests, wired
into CI as "H11 C5 backup executor contracts". It encodes the four defects above
as refusals rather than prose, names the connection only by a libpq service so no
password can reach argv or a log, and hard-wires `hostedRecoveryAcceptance` to
`null` because a tool cannot assert what only the founder can. Four mutation
probes - removing the pg_cron guard, removing the emptiness guard, loosening the
`cron job` match, accepting any client major - were **all killed**.

*What is now owed, consolidated to four items:* read DEV's backup capability in
the dashboard (blocked on nothing, and the root of the chain); decide the
`h3scratch` native project; supply two physical Android devices; then authorise
the ordered 35 -> 36 -> 37 push. Item 3 is the binding constraint.

*Boundaries honoured:* no hosted SQL, no hosted project contacted or altered, no
project created/deleted/paused (the H-9 rehearsal project untouched), **no hosted
migration applied** (migration 33 *was* applied to a disposable local container
holding synthetic rows), no credential requested/retrieved/printed/stored, no EAS
build submitted, no paid resource consumed, no device operation, no production
signing or package identity changed, no `audit-artifacts/**` modification, and no
real pharmacy or customer record read - every row in the rehearsal was synthetic.
The `h3scratch` project was read and left as found.

*Batch 4 is not begun.*

## 2026-11-01 - the device ran the tests, and the record I wrote this morning was wrong

*Decision:* Batch 3 remains **TECHNICALLY ACCEPTED, OPERATIONAL GATES PENDING**.
Three of the six device cases now have real evidence from real hardware. Three
do not, for reasons that are physical rather than technical. No server-side gate
closed.

**1. The installed APK is EAS build `ffab3562`, built from `fdbe8c3`. I said it
was of unknown provenance. That was wrong, and the error was mine.** I compared
the installed APK against build `76ee0fcb` only, found a mismatch, and concluded
it came from outside EAS. I never re-listed the builds. A fresh
`eas build:list` shows `ffab3562-bac0-492b-b78e-538384e31177`, status FINISHED,
`gitCommitHash` `fdbe8c31039b373f89c7b4a9fc69c9876ee00768`, created
2026-11-01T00:41Z and completed 00:59Z. Downloading its artifact gives
215,937,028 bytes, sha256
`686350b773b5ed044acb739dd1b9c590d300297849796c5769d4b7f3dab56500` - and `cmp`
against the APK pulled off the handset reports the two files **identical**.
Signing identity follows from byte equality; `installerPackageName` is
`com.google.android.packageinstaller`, consistent with a downloaded sideload.

This is the sixth unenumerated or unchecked claim I have written in this project,
and the first where the correction arrived within hours rather than sessions. The
lesson is narrower than "re-list before concluding": I had the means to refute
myself cheaply and did not spend it, because the first comparison agreed with
what I already believed about a stale build.

**2. The Babel fix is proven, by the measure the prompt set.** `4418bbf` errored
with "Cannot find module 'babel-preset-expo'". `fdbe8c3` declared the preset and
`@babel/plugin-transform-react-jsx`, and the next real EAS build on that commit
**succeeded**. The standing instruction was not to claim the APK was fixed until
a real build succeeded. One has.

**3. Three device cases ran on `RZ8W40HDRMK` (SM-A047F, Android 14) against the
`fdbe8c3` build. One passes with a stated limit, one is partial, one is
inconclusive - and an independent review downgraded two of the three from what I
first wrote.** My first draft of this entry claimed three passes. It did not
survive review, and the corrections are recorded in place below rather than
quietly amended.

*Case 6, FEFO at read time (rule 3) - **INCONCLUSIVE**, after the review caught
me overclaiming it.* I first recorded this as PASS on the grounds that the sale
list put the earlier-expiring batch first "although it was created later, holds
less stock and sorts after alphabetically - so the order is neither insertion,
quantity nor name." **That elimination was incomplete and the conclusion was
wrong.** The "All Medicine" list is `listSaleInsights(shopId,'all')`, whose SQL
ends `ORDER BY m.name COLLATE NOCASE, m.id LIMIT 20`. Both rows are named
"Progut MUPS", so the name **ties** and the tiebreaker is `m.id` - not expiry.
The order I observed was arbitrary, and I never excluded the key that actually
decided it.

What survives is narrower than a device pass. In source, `domain/fefo.ts`'s
`sortByExpiry` orders by the real `expiryDate` with null last and recomputes on
every call, and `activeSellableBatch` picks the earliest-expiring sellable batch
per medicine - so the *batch shown on a card* is FEFO-selected. On the device
both day counts were exact for the day they were read, 75d and 406d, for a batch
created minutes earlier and one created weeks earlier, which is real evidence
against a day-count stored at creation. Selling three units drew from the cart's
bound batch, `FEFO-EARLY` (50 to 47), leaving `#Baban` at 200.

But **the FEFO selection itself was never exercised**: each medicine held exactly
one batch, so `activeSellableBatch` always had a single candidate, and no
multi-batch ordering or spill-over deduction ran on hardware. Rule 3 governs
batches *within* a medicine, and that path is untested on device. Closing it
needs two batches under one medicine, which this build's UI cannot create - see
the defect in item 5.

*Case 3, offline then online, including a kill mid-sync - **PASS, client-side
only**.* With WiFi and mobile data off and `Active default network: none`, a full
sale completed from local storage alone: `INV-2026-000001-26C9352E610C`, total
9.00, change 1.00 on 10.00 tendered. On reconnect the history showed **exactly
one** sale and no sync conflicts. Repeated: a second sale was taken offline, the
network restored, and the app force-stopped 2.5 seconds later. After relaunch the
history showed **exactly two** sales, `000001` and `000002`, neither duplicated
nor lost, and stock stood at 44 - a single decrement per sale.

Two limits the review was right to insist on, and the gate is not fully closed
without them. First, **every observation is from the device's own store.** No DEV
credential exists here, so I did not confirm that either sale reached the hosted
database, nor that it arrived once. "The queue drains once" is therefore shown
for the local queue only; the server copy is **unverified**. Second, I called the
kill "mid-sync", and I cannot prove it was: 2.5 seconds after re-enabling the
radios is when I sent `force-stop`, but I captured nothing showing a request
in flight at that moment. The honest statement is that the app was killed shortly
after reconnect and the local store survived it intact. Settling both needs a
service-role read of DEV and a captured sync log.

*Case 5, opening cash (rule 5) - PARTIAL.* Opening Cash reads 0.00 today, and the
drawer reconciles exactly: 0 opening plus 0 cash sales plus 0 collections, less 0
expenses, less 0 withdrawals, less 100.00 supplier payments, equals **-100.00**,
which is what the screen shows. That is rule 4's formula checked arithmetically
on hardware. It is **not** proof of the midnight reset: this shop has no
prior-day cash session to inherit from, and without root the device clock cannot
be moved. Recorded as partial rather than passed.

**4. Three cases did not run, and none of the reasons is a software defect.**
Case 4, refund bucketing by business date, needs a sale dated to a previous
business day; sales history was empty when the run began and the clock is not
settable, so no such sale can be made. Case 2, tenant isolation under sync, needs
a second handset. Case 1, owner handover, needs a second owner registration,
which means signing out of the H-5 E2E shop - credentials I do not hold, and a
sign-out I will not perform uninvited on the only configured test shop.

**5. A defect candidate found by accident, and it is worth Batch 4's attention.**
There is no path in the UI to add a batch to an existing medicine. Edit Medicine
offers only "Edit batch" for batches already present, and Manual Entry with an
identical name, generic and manufacturer created a **second, parallel medicine
row** rather than a second batch. FEFO sorts batches within a medicine; stock
split across two medicine rows never enters one FEFO ordering. A pharmacist
restocking the same drug would silently divide their own stock. Not fixed here -
Batch 4 is not begun - but recorded with the reproduction.

**6. An incident on the founder's personal phone, disclosed in full.** Midway
through form entry a Truecaller caller-details screen took focus, and three taps
and three text inputs intended for the app went into that third-party screen
instead. Measured against its layout the taps fall in non-interactive gaps, and
the call log is unambiguous that nothing was dialled - every entry predates the
session by about two hours and `mCallState` was 0 throughout. I cannot prove
nothing changed inside Truecaller. The screenshots that captured caller
information were deleted. A guard now refuses every input event unless
`com.muthoy.pos.preview` holds focus; it was verified to block (exit 90) and then
to allow, and it blocked two further interruptions during the run.

*Device boundaries:* no root, no factory reset, no uninstall, no data cleared, no
personal file touched. Production `com.muthoy.pos` untouched. Two settings were
changed and both restored: `stay_on_while_plugged_in` 0 to 7 to 0, and WiFi and
mobile data off and on again - data and WiFi only, never airplane mode, so calls
kept arriving. Left on the device: one synthetic medicine row, one batch of 50
units less six sold, and two synthetic sales totalling 18.00 in the H-5 E2E test
shop.

*Gates unchanged:* H-11 C5 Part A still needs the DEV password through the
protected prompt. Parts B and C are now unblocked on provenance but unexecuted.
E15 still needs the DEV service-role key server-side. Hosted migrations remain
**HELD**: DEV's tail is `20261005000000` with 31 applied and **six** pending, and
the founder has authorised three.

*Batch 4 is not begun.*


## 2026-11-01 — Batch 3: explicit existing-medicine restocking

Manual Entry previously allocated a fresh medicine ID for every receipt. Identical
brand/generic/manufacturer text therefore fragmented stock across medicine IDs,
preventing those batches from participating in one FEFO ordering. Names remain
review hints, never identity keys: users explicitly select a shop medicine ID or
acknowledge a distinct new product. Existing identities and historical transactions
are preserved. No automatic merge, deletion or historical data repair runs.

Add Stock and Edit Medicine now expose existing-medicine/new-batch entry. The legacy
batch detail route uses the same supplier receipt form. The receipt reuses the
atomic purchase writer, stock movements, supplier credit and COD cash settlement.
It checks inventory_add again inside the transaction, validates shop ownership,
and rejects an already-used batch number. Existing-batch top-ups remain in the
supplier purchase flow. FEFO continues to use real expiry dates at read time;
no FEFO algorithm change or SQLite schema migration is needed.

The existing hosted inventory_add_purchase contract required a medicine INSERT.
Staff restocking therefore needs an additive hosted contract extension. Its SQL
is a local held draft in backend/supabase/held-migrations, outside the active chain;
PGlite tests opt into it explicitly. Hosted migrations remain HELD. Promotion,
chain classification and byte pins, hosted application and client distribution
need their separate release gate. Do not distribute clients emitting the new
graph before that approved activation. No hosted change was executed here.

Historical duplicate reconciliation is a separate, proposed reversible identity
alias procedure in docs/plans/restock-history-reconciliation.md. It needs owner
identity review and separate schema/sync/RLS authorization; it was not implemented
or executed. This correction belongs to Batch 3; Batch 4 is not started.

**Independent review, same day — the warning above is now enforced in code, not
just written down.** The implementation as first written set
`inventoryRestock: Boolean(input.existingMedicineId)`, so every restock staged as
`inventory_add_purchase`. DEV's live constraint is
`check (operation_kind<>'inventory_add_purchase' or expected_row_count in (5,7,8))`
(`20260825000000_inventory_add_purchase_sync.sql:25`), and a restock graph carries
no medicines row. **Staging would have rejected every restock - owners included,
not only staff.** The widening to `(4,5,6,7,8)` exists only in the held draft, and
the chain is HELD, so the client would have shipped ahead of its server. A
sentence in this file is not a gate; the code now is.

My first write-up of the mechanism was itself imprecise, and the re-review caught
it. A restock counts **4** (credit), **6** (COD onto an existing drawer) or **7**
(COD creating one) - not "4 or 6" - and **7 passes** the count constraint. What
actually refuses every shape is the graph validator in the same file (~line 179),
which requires **exactly one `medicines` row**. The count check is real but not
sufficient on its own; the comments and tests now say so.

Two changes. `inventoryRestock` is pinned `false`, so a restock stages as
`purchase_create`, which has no row-count constraint and already expresses
"add a batch to an existing medicine" - it is what the supplier-purchase flow
emits. And restocking is owner-only, because
`20260823050000_b3_groups456_sync_completion.sql:211-213` enforces `r.name='owner'`
for that kind and answers anyone else with **MU015 "% is Owner-only"** - queueing
it for an `inventory_add` staff member would have stranded their outbox: offline
success, online failure, which rule 12 does not permit. One earlier test asserting
staff restocking succeeds was therefore wrong about the hosted contract and now
asserts the refusal, with the migration lines quoted beside it.

**And the re-review found that my own fix carried the same defect class I had just
removed.** Moving restocks onto `purchase_create` pulled them under B4 row
authorization, which requires premium for `purchases` and `purchase_items` - the
exemption is enabled only for `inventory_add_purchase`
(`20260831000000_b4_commercial_platform.sql:429`). My restock path skipped the
premium check that ordinary purchase creation performs, so a **Free owner** would
have committed the receipt locally and then been answered **MU010** by DEV:
offline success, online failure, exactly what I had objected to. The restock
fixture seeds Pro, which is what hid it. A `requirePremiumFeature(shopId,
'supplier_invoices')` gate now runs before any write on the existing-medicine
path, and new-medicine creation keeps its deliberate Free eligibility because it
stages under the exempt kind.

Three guards, each mutation-tested rather than asserted: reverting
`inventoryRestock` kills three tests, removing the owner check kills two, and
removing the premium gate kills one. Revocation coverage moved to the
new-medicine path, because with staff categorically denied for restocking the old
assertion no longer proved revocation - the owner guard threw first. Staff and
Free-plan restocking return in the same change that applies the held extension
and flips the flag; the tests fail loudly if any of it moves without the rest.
Premium owner restocking works online today.

## 2026-11-02 - FEFO proved on hardware, and two defects the unit suite could not see

Build `47c9f0aa` (from `9ed99b4`) installed on SM-A047F, Android 14, in place
over the existing test shop. No application data was cleared and none needed to
be: package and versionCode matched, the signer certificate was identical on
both sides (`3b1ee9f3...`), and there is no local schema change between
`fdbe8c3` and `9ed99b4`. The bytes read back off the device after installing
hash `6239d705...`, the same as the verified EAS artifact. The APK pulled
*before* installing hashed `686350b7...`, byte-identical to the stored
`ffab3562` artifact from `fdbe8c3` - which re-confirms the provenance baseline
from the device itself rather than from the previous session's note.

**Checks 6.2, 6.3 and 6.4 PASS.** The fixture is a synthetic product
(`ZZFEFOProbe`) with three batches under one medicine, built through CSV import
- which is not premium-gated and so was reachable on this Free shop, unlike the
restock form. The batch that expires first, `FEFO-C` (18 d), was deliberately
the **last** inserted and held the **middle** quantity (7, between 5 and 20).
That is the point of the fixture: insertion order, quantity and the name tie
were excluded together. The earlier Case 6 claim was downgraded precisely
because it lacked that control.

It does **not** exclude everything. Review found a fourth variable the fixture
leaves open - **batch id order** - and executed a counterexample: an allocator
sorting by id ascending reproduces every number below if the ids happen to sort
C < A < B, a 1-in-6 coincidence. The ids were never recorded. What closes it is
source, not this device run: `domain/fefo.ts:55` compares the real
`expiryDate`, and `db/sales.ts:578` is what checkout allocates through. So
6.2/6.3/6.4 stand as **observed behaviour plus source inspection**, not
device-conclusive alone; closing it on the device means repeating with the
expiry order changed and the batch ids held fixed.

Selling 1 took `FEFO-C` 7 -> 6 and left the others alone. Selling 8 drained
`FEFO-C` 6 -> 0 and took the remaining 2 from `FEFO-A` 5 -> 3, leaving
`FEFO-B` at 20 - an exact 6+2 split across the expiry boundary. With both
radios off, a further sale took `FEFO-A` 3 -> 2 and **skipped** the zero-stock
`FEFO-C` rather than failing on it; on reconnect the day read Tk 30.00 over 3
transactions and the conflict screen reported none. That last part is still the
client's own assertion - server-side arrival is unconfirmed without a DEV
service-role read, the same limit as checks 3.2-3.5. Separately, the sale list
read 75/406 days at 23:56 and 74/405 at 00:02 in the same running process,
which is direct evidence the day-count is recomputed at read time (CLAUDE.md
rule 3) rather than stored.

**Defect A, fixed here.** `PlanAccessError` appeared in no map in
`i18n/display.ts`. An earlier draft of this entry said all **11** of its call
sites "fell through to a generic fallback". Both halves were wrong, and review
caught it: there are **6** `throw new PlanAccessError` statements
(`db/commercial.ts:241,282,295,305,312,326`) behind **15** guard call sites
(10 x `requirePremiumFeature`, 3 x `requireMultiShopAccess`, 1 x
`requireShopSwitchAccess`, 1 x `requireStaffSlot`) - and they did not all
reach a generic fallback, because only some of those sites route through
`userFacingError` at all. The rest showed something else again:
`components/expenses/QuickLogTab.tsx:154` discards the error in a bare
`catch {}` and shows a fixed expense-save failure. The bypass table below is
the accurate account. On the device a Free owner restocking got "Could not save the
medicine. Please try again." - telling them to retry something that can never
succeed, never mentioning the plan, while the same shop's Home screen showed a
trial-expired Upgrade banner. The mapper now reads the error's `feature`
discriminant, the way `PurchaseNotVoidableError` already did, keeping three
cases apart: a locked premium feature, a full staff seat, and a blocked shop
write. **One of those three is live today; the other two are defensive.**
`staff_limit` is thrown only by `requireStaffSlot`, and `commercial_write`
only by `requireCommercialWrite`, whose sole caller is `requireStaffSlot`
(`db/commercial.ts:318`) - and the single path into it, `createStaff` ->
`components/staff/AddStaffModal.tsx:125`, catches at `:142` **without** the
mapper. `multi_shop` never reaches the mapper either. So the only feature value
that reaches `userFacingError` in the shipped app is the catch-all - which is
exactly the branch the defect below was found in. The branches are worth
keeping, but this entry must not read as three repaired live cases. That third case was a defect in the **first version of this fix**,
caught in review - `commercial_write` is thrown both for an archived or
inactive shop (`db/commercial.ts:305`) and for the plan's shop-count limit
(`:312`), and the first version told both to upgrade, which cannot un-archive a
shop. Two tests pin it and only pass together: a shape-based one in
`i18n/display.test.ts` (commercial.ts needs a SQLite harness) and one in
`db/b2-restock.sqlite.test.ts` that drives a real refusal through the real
class. Mutation: deleting the branch kills 2, swapping the labels kills 2,
and deleting only the `commercial_write` branch kills 1 - the two tests do not
cover the same feature values, so the per-branch numbers differ.

**A second defect in my own fix, found by both reviewers independently, and it
was the worse one.** The catch-all branch said "This needs a Pro or Ultra plan.
Upgrade to use it." That is false for a **paying** owner. `effectiveTier`
degrades to `free` while `commercialTier` stays paid whenever the entitlement
snapshot cannot be trusted: offline past the 30-day verification ceiling
(`domain/entitlements.ts:145`, reason `verification_stale`), an invalid
snapshot (`:139`), or no cached snapshot at all - which
`requirePremiumFeature`'s `!entitlement` arm (`db/commercial.ts:241`) and the
deliberately fail-closed `readMultiShopContext` (`:249`) both treat as not
entitled. An active Ultra shop then throws exactly this error, and "upgrade" is
false twice over: they have already paid, and Ultra is the top tier, so there is
nothing to buy. Reconnecting is what restores access. `state/usePlan.ts:29`
already models this as a separate `unverified` reason and
`components/ui/TrialBanner.tsx:50` warns in as many words that conflating
unverified with Free is a mistake this project has already made once on real
devices - so the first version of my fix made these states **worse** than the
generic "please try again" it replaced, which at least implied a retry would
work.

Both labels now cover the paid case ("If you have already paid, connect to the
internet to refresh your plan"), and `planStaffLimitReachedLabel` too, because
its limit is read off `effectiveTier` as well (`db/commercial.ts:321`).
`planShopWriteBlockedLabel` no longer tells the owner to "check the shop's
status", which has no owner-visible surface for the active shop. A wording-pin
test in `i18n/display.test.ts` fails if either label loses the reconnect
clause, in either language; restoring the old upgrade-only sentence kills it
(verified by mutation, exit 1).

The **correct** fix is for `PlanAccessError` to carry the entitlement reason,
not only the feature, so the mapper can separate "your plan excludes this" from
"we cannot confirm your plan". That edits `db/commercial.ts`, which CLAUDE.md
rule 10 gates behind an approved plan, so it is **not** done here and is listed
as a founder decision. The wording fix is the honest interim: it is true in
both cases rather than precise in one and false in the other.

Also pinned here: `db/b2-restock.sqlite.test.ts` now asserts the real class's
`feature` field by name. Nothing did before - `display.ts` reads it through an
`as` cast, so renaming it produced no type error, and both tests stayed green
while every `staff_limit` and `commercial_write` refusal silently collapsed
into the catch-all. Renaming the field now kills that test (verified, exit 1).

**The fix is not complete, and the limit is specific.** It repairs every
consumer that routes refusals through `userFacingError`, which includes the
restock path observed here and the supplier/purchase screens. Handlers that
never call the mapper still misreport a plan refusal:
`components/expenses/QuickLogTab.tsx:154` and `LedgerTab.tsx:76` discard the
error and show a generic expense failure; `app/end-of-day.tsx:67` reports an
**unknown printer error**, sending the owner to check hardware; and
**six** sites surface the error's **raw untranslated English** into a Bengali
UI - the exact class of leak `display.test.ts` already forbids elsewhere.
An earlier draft of this entry said two. The six are
`components/staff/AddStaffModal.tsx:142`, `app/reports/data-export.tsx:39`,
`app/reports/monthly-report.tsx:54`, `app/reports/report.tsx:94` and `:102`,
and `app/end-of-day.tsx:75`. The four export ones all sit behind
`authorizeExport`, which gates file export *and* summary share with
`requirePremiumFeature(shopId,'export')` (`services/reportExport.ts:93`), so a
plan refusal there renders the literal string "Upgrade to Pro or Ultra to use
this feature." in English. The multi-shop handlers bypass the mapper too.
Left as a founder item rather than swept unverified at the end of this run;
each needs its own fallback-key choice. The count being wrong twice is the
reason it is written out site by site here.

**Defect B, deliberately NOT fixed - and my first write-up of it was wrong.**
I claimed a Free shop had "no route at all". That is false, and this very run
disproved it: the fixture above was built through CSV import, which carries no
premium check and resolves to `add_batch` against the existing medicine
(`db/inventoryImport.ts:142`, `:289`). A Free **owner** does have a route.

What is actually true is narrower and worse in kind - it is a **regression**,
not a gap. Before `9ed99b4`, `app/inventory/batches.tsx:88` called
`addBatchToMedicine` under `inventory_edit`: free, receipt-less and
**staff-eligible**. That commit - which I reviewed and accepted - replaced it
with Edit Medicine -> "Add batch", which posts a supplier receipt and is
therefore premium-gated and Owner-only. So **Staff lost the ability to create
an additional batch under an existing medicine**, and Free owners lost the
manual route. An earlier draft said Staff "lost the ability to add stock
entirely"; review showed that was too broad. A Staff member holding
`inventory_edit` can still raise an existing batch's quantity through Edit
Batch -> post adjustment (`app/inventory/edit-batch.tsx:270` ->
`db/inventory.ts:1197`, which requires only the `inventoryEdit` permission and
carries no premium gate). That is a reason-bearing stock *adjustment*, not a
receipt-bearing restock, and it cannot introduce a new batch number or a new
expiry date - so it is not an equivalent route, but it is not nothing either.
CSV import is owner-only and refuses duplicated identities outright, so
it is no workaround for Staff nor for the very products this defect split.
`addBatchToMedicine` still has no production caller; its `batches` rows remain
outside the server premium set (`20260831000000_b4_commercial_platform.sql:429`)
and need **no** held migration. Left unfixed because the instruction for this
run was "Do not treat Free/Staff restocking as enabled while the hosted
contract extension is held" - restoring the route is the founder's call. The
receipt path's premium guard should stay regardless: removing it recreates
local success followed by server refusal.

A third consequence surfaced on its own: CSV import refuses the duplicated
product outright with "medicine match is ambiguous", because two medicine rows
share name+generic+manufacturer.

**H-11 Part C: still every row `_not run_`, but the blocker moved.**
Prerequisite 4 is now satisfied - the fixture generates at 22,933,504 bytes
(21.87 MiB), matching the documented 21.8 MiB. Steps 17-19 need to write a
pre-migration database into app-private storage and SIGKILL mid-migration, and
the Preview build is non-debuggable with `allowBackup=false`, so there is no
way in short of rooting the founder's phone or replacing the live database.
The two debuggable packages on the device are Expo dev-launcher builds from
2026-10-06 that need a Metro server and do not carry the accepted revision.
Serving the accepted revision's JS into one of them was considered and
rejected: step 18 exists to decide whether the *shipping* upgrade needs a
progress screen, and Nov-2 JS on an Oct-6 native layer cannot answer that. The
blocker is now exactly one thing - **a debuggable build of the accepted
revision** - after which Part C is executable on the handset already in hand.
Executable is not representative, though: a debug build differs from the
shipped release in optimisation and packaging, so whoever runs step 18 must
show the timed build's native dependencies and configuration match the shipping
one, or record the number as diagnostic only.

Left in the shop, undeleted because deleting is the founder's call: medicine
`ZZFEFOProbe` (batches **2**/20/0 - the offline sale took FEFO-A 3 -> 2, which
an earlier draft of this list failed to carry through), three cash sales totalling Tk 30.00
(`INV-2026-000003...`, `...000004...`, `...000005...`), and an unused
`/sdcard/Download/fefo-probe.csv`. Two things were observed and are **not**
claimed as defects: an expiry notification for `FEFO-C` timestamped before that
batch existed, and a Tk -82.00 expected drawer for 2026-11-01, which may simply
be yesterday's COD purchases against an opening of 0.


## 2026-11-11 — Approved local A3/C4/C5 integration; live gates remain held

Migration38 promotes the reviewed role/credit/draft/parent-closure HELD body with
only its header changed. Both wrapper orders and actual E4 field pinning are
verified locally; DEV remains at31 until an explicit history/order and activation
approval. Six unrelated missing migrations must not be pushed automatically.
Founder explicitly approved the sealed classification contract transition to38,
A8/B21/C9 and SQLite0034 through the existing successor mechanism. Old accepted
bytes/evidence and original E4 manifest are preserved.

C5 adds SQLite0035 private Owner custody and immutable encrypted retry jobs.
The confirmed random256bit recovery factor lives only in verified SQLCipher;
it is excluded from outbox, journal, archives, MMKV, logs and clipboard. It is
shown privately for independent retention and cleared on close/background/session
handover. Existing business calculations/writers are unchanged in C5; the earlier
approved recordChange journal hook is a real transaction-boundary modification.
Owner role, tenant, active/locked/deleted state and session are checked again inside
custody transactions. Parent graph membership now uses indexed Sets.

Auto-review rejected a normal lifecycle path to actual DEV Storage because hosted
uploads remain unapproved. The safer implementation has NO default network runtime:
ordinary lifecycle only reports disabled/unavailable. Automated tests inject mocked
Storage and exercise the actual crypto/SQLite/readback/receipt/retry path. No hosted
bucket/policy/upload, phone migration, authentic restoration or key setup has run.
Cloud activation requires a subsequent exact approval; this is not active backup.

No-loss remains FAIL for offline sole copies. Automatic Staff coverage, attachment
files, replacement-device authorization/old refund claims and authentic recovery
are unaccepted. iOS uses the same React Native app; source exports are separate from
native compilation, which remains BLOCKED without macOS/Xcode. Physical iOS tests
remain deferred. Production NO GO; no commit/push/merge/deploy is authorized.

C5 independent review corrections: custody now requires nonempty actual PRAGMA cipher_version in addition to the initialized encryption outcome; genuine plain SQLite is refused. After independent-copy receipt/job completion, the coordinator rereads current journal exposure and returns pending while newer writes remain uncovered. The inactive lifecycle checks only setup status and does not load the factor; prepublish custody is compared again. Each confirmed safeguard has its own disabled-fix negative (1 intended FAIL/18 PASS) alongside the valid full-file control. Actual native at-rest behavior still requires separately authorized platform validation.


## 2026-11-11 — Approved A4 setup progress; Q/H/D remain conditional

Founder approved A4-PG17-R, A4-CRED and A4-ENC. New isolated replacement target
muthoy-q17-restore-20261111-v2 uses the pinned cached Supabase PG17.6 image,
network none/no ports, read-only root/no container logs, new owned RAM mount
noswap and cgroup swap0. Its fresh h9_restore_q_20261111 database is EMPTY after
transactional five-extension checks. The failed initial empty target is retained;
all14 original containers are unchanged. No authentic DEV restore is claimed.

Official portable age1.3.2 ZIP matched the approved hash. Actual public-synthetic
round-trip and wrong-factor/tamper/truncation refusal passed. New external private
connection tooling passed39 synthetic checks, including actual isolated TLS
positive/hostname/untrusted-CA negatives. EFS and owner/SYSTEM ACLs were verified
on the exact new private directory/empty synthetic file before any content write.
No actual password, passfile, DEV connection, archive, upload or restoration exists.
These external tests do not replace the accepted327file/7628test application run.
No application runtime, database, money, stock, auth or sync writer changed here.

Claude review first timed out; final-source retry returned429 with reset00:10
Asia/Dhaka. New credential tooling is NOT independently accepted and cannot collect
a real password until review passes. Existing application scoped ACCEPT remains
limited to its earlier source, not this tooling or operational Q/H/D gates.

Founder requests existing Dropbox/private cloud, independently retained archive
factor,30day/no-auto-delete retention, RPO0 during a verified writer pause and
measured2hour restore target. Destination/access/readback/custody and actual DEV
CA/session route remain unverified. The historical H5 plaintext-processing
restriction remains: EFS, age and container no-swap alone do not prove Windows/VM
paging and dump protection. Host-protection scope is proposed, not implemented.

Q remains BLOCKED. H DEV31 overlay/history exception and D existing Dev hydration/
bounded offline tests remain already approved CONDITIONALLY and NOT RUN. No hosted
mutation, phone operation, Metro, reinstall/clear, old-stack change, commit/push/
merge or Production action occurred. Full-phone-loss no-loss remains FAIL/deferred;
seven unrelated readiness groups stay pending; Production NO GO. Detailed receipts
and private operator steps: D:/MuthoyAudit-20261109/implementation/DEV_BACKUP_PRIVATE_SETUP.md.

## 2026-11-15 — Approved external source integration into Main

Founder approved docs/plans/external-integration-2026-11-15/PLAN.md and
FILE_MANIFEST.json. After verifying the original source/destination hashes,
228 individually allowlisted application/test/documentation/configuration files
were imported from D:/md and D:/cc, plus 13 reviewed historical records/helper
sources at their explicit destinations. Eighteen already identical entries and
two duplicate patch bundles were excluded. There were no overlapping destination
changes between the two workstreams. Existing prototype work is preserved.

Current implementation source now lives in D:/Muthoy. Earlier D:/md source and
Main-preserved statements in dated records describe their historical executions.
All external workspaces, evidence, backups, pinned runtimes and Git history remain
preserved. The source-only backup/host helpers are not activated or executed.

Existing committed migration SQL and the original E4 seal remain byte-identical.
New SQLite 0034/0035 and backend migration 38 are imported source, not applied
migrations. No real database, hosted, device, credential, deployment, commit,
push or deletion action is part of this integration. Tests use isolated synthetic
fixtures only. Current actual test outcomes and remaining validation are recorded
in docs/plans/external-integration-2026-11-15/INTEGRATION_REPORT.md; prior external
PASS receipts are historical and do not establish current integrated acceptance.

## 2026-11-15 — Offline sale retry and Staff credit authorization repairs

Founder approved the current-source Dev/Metro device plan and separately approved
R1 and R2 source repairs in chat. R1 removes the eight-transient-error terminal
cutoff: durable pending rows remain retryable with existing capped backoff; only
acknowledgement or a permanent refusal retires them. Explicit permanent failures
are not automatically revived. Ten lost-response/replay and outage regressions
cover unchanged operation identity and no duplicate writes.

Physical tests passed Owner cash on historical installed Preview and current-source
Dev, plus Staff cash/restart/reconnect. Staff split checkout exposed a separate
server defect: the validated grouped sale's reconciliation exception was rejected
again by the ordinary B2 writer. Seven original queue/business rows remain intact.
R2 adds a guarded forward patch only at the validated sale dispatch boundary;
standalone credit-management permissions and every later wrapper remain intact.
Sales-only Staff cannot clear quarantined history or change existing verifier proof.

R2's DEV31 and full-chain candidate passed 42 PostgreSQL checks after six intended
pre-fix failures. Founder approved DEV activation and the exact seven-row requeue. Hosted migration
20261115172840 changed only the intended function; catalog/ACL/business-state checks
passed. The original split synced once after status-only queue recovery. Details:
docs/plans/offline-sales-2026-11-15/PLAN.md. No unrelated hosted migration is part
of this repair. GitHub publication is authorized for task changes only; unrelated
integrated source remains preserved. Final evidence/status belongs to REPORT.md.

## 2026-11-16 — Admin presentation refresh and platform verification

Admin keeps its existing server-rendered permission-filtered navigation and
data/actions. Presentation now uses a desktop sidebar, phone navigation strip,
shared cards/filters and keyboard-accessible table scrolling. No new client
boundary or security allowlist exception is introduced. Local verification uses
synthetic data; Chromium phone viewport checks do not prove iPhone/Safari or
React Native behavior. DEV catalog drift and printer requirement failures remain
explicit blockers. No protected business/database change is included. Evidence
and remaining platform acceptance are recorded in
`docs/reviews/iphone-admin-2026-11-16/REPORT.md`.

## 2026-11-16 — Approved printer repair and held Admin compatibility candidate

Founder approved local remediation. ESC/POS now preserves builder-owned LF and
the monthly three-line feed; fields retain control-byte sanitization and money
content. Printer requests send once; uncertain completion never triggers an
automatic whole-job replay. Explicit user retry remains possible.

The CLI-generated Admin compatibility candidate stays in held-migrations. It
restores only the missing platform stores/publication contract and required
read-only grants, retaining existing Staff-sale/sync/entitlement functions.
Unknown installations fail preflight. Local PostgreSQL role, replay, audit and
synthetic restore tests do not authorize hosted activation or establish device
acceptance. No migration-history repair or unrelated integration is activated.
Current results and remaining gates: docs/reviews/iphone-admin-2026-11-16/REMEDIATION.md.

## 2026-11-16 — DEV catch-up to the full chain, H1/M1 repairs

Founder approved: "fix H1 and apply 32-38", then "fix every problem so no
backend work remains", on the Free plan. DEV (btfprhticjgeihcngpif) received
pg_cron, then migrations 32-38 in order through the Management API as the
postgres role, each with its history row in one transaction and its file hash
verified against the manifests; migration 34 ran only after a fresh read-only
F12 preflight passed. 39 was already on DEV, so the hosted order is 1-31, 39,
32-38, 40; a PGlite probe proved that order ends byte-identical to 1-40 and
migration 40 refuses to run on any other body.

H1: Postgres SQLSTATE classes 22/23 are permanent (they mean the row can never
apply), and the device reports a pending row with 8+ attempts as stuck. The
Owner warning now counts failed+stuck rows and is resolved after a completed
healthy cycle, so it re-arms; before, the first sync warning silenced all
later ones. Rows still never retire on a transient error.

M1: migration 40 bounds the Staff-supplied reconciliation updated_at by
server time on refresh and insert, so a fast device clock cannot freeze the
Owner out of later last-write-wins updates.

pg_cron on DEV: enabled despite the earlier DEV exception, because the only
staging rows on DEV were applied ones, which the cleanup job never deletes.
The held admin compatibility candidate is superseded by applying 35/36.
Scope deferrals (not bugs): held existing-medicine restock activation, held
recovery storage, recovery-journal growth, full re-hydration cost, and the
two-device first-credit race need their own designs.

Functions on DEV now run the repository code: sync v32 and auth-send-sms v12 (each secrets change also bumps a version),
with MUTHOY_SUPABASE_PROJECT_REF set and MUTHOY_SUPABASE_KEY_MODE=modern. The
first deploy skipped the runbook's A-D2 settings and every request failed for
about ten minutes (02:43-02:53 UTC, OTP failed closed, no SMS sent). Legacy
mode then refused at boot (legacy_anon_key_invalid: the hosted SUPABASE_ANON_KEY
is no longer a legacy-shaped JWT), so DEV moved to modern keys. The no-OTP A7
rows pass, and a device-login for an unused phone returns the generic 401,
which proves the modern secret key works against hosted REST - the item the
runbook listed as unproven. PROD must set both values before its first deploy.

The held admin compatibility test now builds its full-chain case through
migration 39 (createHarness({ through })), the chain that candidate pins; every
assertion is unchanged.

## 2026-11-20 — Live strip scan adds to the cart (PR #3)

Founder decisions: a confident strip match adds one unit with a 3-second Undo;
an ambiguous match asks for a one-tap choice; prescription medicines auto-add
too; an add beep plays (expo-audio). This reverses W2-01's never-skippable scan
confirmation at the founder's request, so ScanConfirmSheet must not come back.
Matching reads only the shop's own inventory and sits under the existing OCR
override.

Checked on the Galaxy A04s: the scanner opens, the permission flow works, frames
are deleted, and real ML Kit output on five strip photos matched. Not verified:
a person holding real strips, the audible beep, and iOS (never built). Merged to
main 2026-11-22 (3b1e3df). Details: docs/plans/ocr-and-multilingual-search.md §7.

## 2026-11-21 — Speed round and the staff side (PR #4)

The founder asked that every page, for Owner and Staff, answer at once. Tabs
now stay mounted: pages open on top and going back returns to the kept tab.
Sale insights use 4 queries instead of 61. The dashboard has no loading screen,
number formatters are cached, and the business-day filters use the created_at
index (53 ms to 0.5 ms per query on 60k synthetic sales). Every date field uses
an in-app calendar.

Live scan moved to frame-processor OCR on react-native-vision-camera 5.2.4 and
ocr-plus 2.1.2 (founder-approved packages). It gives a new reading every
170-190 ms instead of about 600 ms. VisionCamera 5 has no barcode output on
Android, so the Sale scanner keeps frame OCR plus a Barcode button. Android 8.0
is now the minimum (founder decision; the OCR package needs API 26). Release
build 1596518d on the A04s: add-to-cart 54-76 ms, cart +/- 71-111 ms, kept
tabs 117-163 ms, first Home open 1.4 s.

Sign-in asks for the mobile number first, then the PIN (founder decision). This
changes S-1's PIN-only identification, as flagged under rule 11. A locked
account now signs in through the number-and-PIN relink instead of looping
(94e6ff3). The Staff home shows only what the Owner granted. Its first redesign
used a dark card and was rejected as off-brand, so it now matches the brand:
green hero and white cards. Text and dark ink use #1A1A1A.

Admin can grant or extend Pro/Ultra (migration 41, admin_grant_plan). The RPC
is service-role only, writes an audit trail and never stamps verified_at. This
supersedes the earlier rule that no admin action grants paid access, and the
admin grant test now names exactly that RPC. Merged to main 2026-11-22
(99ec980).

## 2026-11-22 — DEV: migrations 41-42, shop-switch binding, function region

Each step was founder-approved. DEV received migration 41 at 06:31Z and
migration 42 at 08:33Z. Each ran as one Management API transaction with its
history row, against a verified file hash. Migration 42 adds the billing cycle
'grant': an admin grant has no price and no next billing date, and is left out
of MRR. One UPDATE corrected the founder's earlier grant row, which had been
stored as 'annual'.

Shop-switch loop: a switch moved the account's active shop but left the
session's device binding on the old shop. The server then refused every
request, and the app re-switched about twice a second. c3d5433 moves the
session's device binding into the target shop. sync v33 was deployed on DEV at
10:00Z.

Speed: DEV's database is in Tokyo, but Edge Functions ran in Mumbai, so every
query crossed regions (median 1.8 s per request). e534e17 sends an x-region
header for DEV calls, which brought the median to 0.6 s. PROD should be created
in Mumbai (ap-south-1).

Also: Windows Metro start-up and EMFILE fixes, a one-sentence sync card
(sent, waiting or failing), and a blinking header sync dot.

## 2026-11-23 — Faster switch, Sentry, multi-shop sign-in repairs (PR #5)

Founder-approved: a shop switch pulls only what changed since that shop's own
cursor, and a cursor is written only after a complete hydration. Sentry crash
reporting is wired behind H-8's privacy contract. Events are rebuilt from an
allowlist, and messages, breadcrumbs, user and request data are always dropped.
Source maps are not uploaded (that needs a Sentry auth token). Native capture
ships in EAS builds from 7e1685f; a device-side crash report is not yet
verified.

The multi-shop Owner lockout was root-caused on the device and has two parts.
First, the Owner's second-shop actor has no phone number, so the number-first
PIN pad refused a correct PIN; the pad now also checks the account the number
belongs to (f5248a9). Second, a sign-in on another install moved the account's
active shop. That quarantined this phone's actor, and nothing could clear it. A
switch into a quarantined shop now forces a full pull and a recovery check
(7d0e132).

## 2026-11-24 — One Owner, many shops, one login (migration 43)

The founder approved the plan on 2026-11-23. Part B: custom_access_token_hook
takes the shop from the session's device binding, which must match an active
membership of the same principal. Only unbound sessions fall back to the
account's active shop. Two installs of one Owner in different shops no longer
evict each other. Part A: an Owner PIN change or recovery is checked against
every person in every one of the Owner's shops. It is then written to all of
the Owner's shop actors at once by owner_set_pin_all_shops, which is
service-role only and writes one audit row per actor. Changing the Owner PIN in
the app is now online-only.

DEV (founder-approved): migration 43 was applied on 2026-11-23 at 16:00Z,
followed by sync v34. A read-only count found 57 live bound sessions; 10 of
them would have been given the wrong shop before migration 43.

Device testing found two defects. The founder approved both fixes:

- 9f89bb7: a PIN change bumps permission_version. The phone that made the
  change kept the old value and signed itself out at the next token refresh.
  The server now returns the new versions and the phone mirrors them (sync v35
  on DEV).
- 7a94ae7: another phone holding an old copy of the PIN refused the new PIN
  without asking the server. Now, when the local check fails and the phone is
  online, the PIN pad asks the server once. A server "no" still shows the
  wrong-PIN message, and an offline phone never asks.

Device results, DEV, Galaxy A04s, 2026-11-24 (Preview build of 7a94ae7 plus the
dev app):
- Two installs in different shops did not evict each other, in both
  directions.
- A PIN change gave both shop actors the same pin_set_at and one audit row
  each.
- The phone that changed the PIN stayed signed in after a restart.
- The other phone signed in with the new PIN through the server, and did so
  again after the PIN was changed back.

The owner-PIN and PIN-login suites pass 109/109. PROD is untouched.

## 2026-11-24 — iOS is authorized

Founder decision: "iOS এখন অনুমতি দেওয়া" (iOS is now authorized). This settles
a conflict in the docs. TECH_STACK.md already recorded the 11 November
authorization to build iOS in this same React Native app, but README, the
delivery ledger and the release-readiness checklist still said iOS was on hold.
All four now agree.

Authorization is not verification. iOS has never been built here: there is no
Xcode and no Apple developer account, so native build, runtime and
physical-device testing are all still outstanding. The dated 2026-11-12 review
records that say "on hold" are left as written; they were true at the time.

## 2026-11-24 — Pilot decisions: PROD on Free, accepted offline-loss rule, bKash only

The founder answered four pilot questions.

**PROD plan.** PROD starts on the Supabase Free plan, in Mumbai (ap-south-1).
The founder creates the project in the dashboard and keeps the database
password; Claude never sees it. The organization is on Free with DEV active and
the H-9 rehearsal project paused, so PROD takes the second active slot.
Consequences of Free: there are no automatic backups, so pilot item 2 (our own
daily backup plus a restore test on a new phone) stays P0. A Free project also
pauses after a week without activity. Every PROD step still goes through the
H-9 runbook gates (backend/supabase/deploy/README.md, Part B), each with its own
approval.

**Offline data loss (pilot item 6): risk accepted.** A sale that has not reached
the server is lost if the app is uninstalled or its data is cleared. That cannot
be fully prevented: clearing app data also deletes the Keystore key. The pilot
rule is that nobody uninstalls the app or clears its data while the sync dot is
yellow or red. Shop owners are told this in training.

**Payments (pilot item 7).** The founder restated the locked 2026-10-21 decision:
direct bKash merchant is the only subscription gateway, and SSLCommerz stays
retired. A 2026-11-24 pilot list wrongly said "SSLCommerz live test pending"; it
is corrected here. The bKash merchant details are not needed now; the founder
will provide them later (B6-02). The pilot therefore runs with no payment path.
A paid plan can only be given from the Admin panel (migration 41).

## 2026-11-24 — PROD project created; DEV first, Production only with permission

The founder created the PROD project in the dashboard: ref qfhntfxtnjalsxqsvkun,
Mumbai, Free plan. The founder keeps the database password.

Standing rule, founder's words: "আমি/তুমি টেস্ট পারপাসে যা কিছু করবা সব আগে DEV
এ যাবে তারপর আমি অনুমতি দিলে Production এ যাবে" (everything either of us does
for testing goes to DEV first, and to Production only after the founder's
permission). No DEV test data may reach Production. The rule is now CLAUDE.md
rule 16 and AGENTS.md core rule 13, so every agent reads it.

Check, 2026-11-24: the 43 migration files hold only schema, functions and
grants. They contain no DEV row ids, phone numbers or shop data. Their one
top-level data UPDATE (migration 42: admin_grant rows to the 'grant' cycle)
matches nothing on an empty database. So applying the chain to PROD carries no
DEV data. That application is a separate step needing its own approval.

## 2026-11-25 — PROD steps 1-2: read-only inspection and app identity; G2 = DEV

The founder approved steps 1 and 2 of the PROD plan, neither of which changes
PROD. The founder also accepted DEV's full 1-43 chain as the G2 rehearsal. The
separate rehearsal project's G2 review had been left incomplete (insufficient
evidence, 2026-10-17). Since then, DEV has run every migration through 43, and
the app was device-tested against it on 2026-11-24.

Step 1 (read-only, GET plus read_only SELECTs): PROD is empty. It has no
tables, users, migration history, functions or secrets, and runs Postgres
17.12. Phone and anonymous sign-in are OFF and the OTP length is 6. The OTP
expiry (60 s) and resend gap (5 s) differ from the runbook's 300/60 and are set
in step 5. The test-OTP map reads as null, while DEV's (which has one) reads as
text. The preflight refuses null, so step 5 sets the map explicitly to '' and
re-reads it. A proposal to accept null instead was blocked as weakening a
safety check, and it stays that way unless the founder decides otherwise.

Step 2 (code): the production policy now names qfhntfxtnjalsxqsvkun and its
publishable-key fingerprint, and Edge Function calls to PROD pin to ap-south-1.
Development and preview still point at DEV and are unchanged. Tests:
environment, preflight and region suites pass (286 + 86).

Correction, same day: DEV's policy fingerprint turned out to be DEV's legacy
anon key, not its publishable key. The app has only ever run on an anon key. So
the PROD policy lists both PROD public keys (publishable 8d38b574..., legacy
anon cccc0a94...), and the production build carries the anon key, the kind DEV
tested. The publishable path has to be proven on DEV first.

## 2026-11-25 — PROD steps 3-7 executed: schema, checks, Auth, secrets, functions

The founder approved all remaining PROD steps at once ("সব ধাপ শেষ করে ফেলো
আমি অনুমতি দিচ্ছি"). The source is revision 3f0113b (main). Migration bytes were
taken from git blobs (LF); per-migration hashes match DEV's catch-up records
(8 of 8 recorded).

Step 3, migrations:
- Created a history table with DEV's exact shape, then enabled pg_cron (1.6.4,
  pg_catalog, supabase_admin, GMT, host set; identical to DEV).
- Applied migrations 1-33, each with its history row in one transaction.
- Captured a fresh F12 hosted preflight (12/12 mandatory checks PASS). Its
  observations were 2 roles, no memberships, and supabase_realtime publishing
  only public.batches.
- Applied 34, then 35-43. Five files that carry their own outer BEGIN/COMMIT
  had that pair stripped, exactly as DEV's catch-up did.
- Final history: 43, latest 20261123000000.

Step 4, verification (read-only):
- Post-checks: h9 constraints 6/6, cron 5/5, api_role_privileges 15/15, and
  e4 objects, privileges, legacy and functions 65/65.
- e4 history_e4 fails 2 of 5 on PROD and identically on DEV. It asserts a chain
  that ends at 35, so it is stale, not a PROD fault.
- The catalog matches DEV with no differences in relations, columns,
  constraints, indexes, policies, triggers, the cron job, default ACLs or
  history. Only platform items differ: DEV's rls_auto_enable() (F13,
  deliberately not replicated), vault 0.3.1 vs 0.3.2, and DEV's daily realtime
  message partitions.

Step 5, Auth:
- Phone OFF, anonymous OFF, email unchanged.
- OTP 6 digits, 300 s, 60 s apart.
- The test OTP map now reads '' (set explicitly), so the strict preflight
  passes without being relaxed.
- The access-token hook is enabled
  (pg-functions://postgres/public/custom_access_token_hook), and so is the Send
  SMS hook (PROD URL), with a newly generated secret.

Step 6, secrets:
- Set seven function secrets: SEND_SMS_HOOK_SECRET (the same value as the Auth
  hook), SMS_DISPATCH_HASH_KEY (new random), MUTHOY_ENVIRONMENT=production,
  MUTHOY_SUPABASE_PROJECT_REF, MUTHOY_SUPABASE_KEY_MODE=modern, REVE_API_URL
  (DEV's endpoint, matched by digest) and REVE_TRANSPORT=post_json.
- The founder must still enter REVE_API_KEY, REVE_SECRET_KEY and REVE_SENDER_ID.
- No DEV-only or payment secret is present.

Step 7, functions:
- Deployed from a git-archive workdir (D:\Muthoy-deploy\prod\3f0113b):
  auth-send-sms v1 (verify_jwt false) and sync v1 (verify_jwt true).
  payment-webhook was not deployed.
- Smoke results: sync with no headers returned 401; GET with the anon key
  returned 405, which proves the function boots in modern key mode. An
  unsigned Send SMS hook call returned 401 Invalid signature, and the SMS
  ledger stayed at 0.

Also: the EAS production environment now has the two public variables (PROD
URL and PROD anon key, plaintext, project scope).

Not done, and why:
- The production build (step 8) needs this policy commit on main. That commit
  changes apps/mobile/tests/h9-prod-preflight.test.ts, which the E4 evidence
  seal says can never be superseded. Its test asserts that production is
  unset, so widening the allowlist is the founder's decision.
- A clean device (step 9) is also pending a founder decision.
- Phone ON (step 10) waits for the REVE credentials and the self-managed daily
  backup (pilot item 2).
- No DEV data touched PROD at any step.

## 2026-11-25 — Founder decisions: widen the E4 seal by one file; same phone, separate app

**E4 seal.** The founder answered "অনুমতি দিলাম" (approved). The supersession
allowlist (SUPERSEDABLE_EVIDENCE_FILES) gains exactly one path:
apps/mobile/tests/h9-prod-preflight.test.ts. Its sealed copy asserted that the
production policy is unset, which became false once PROD was approved. The
transition was recorded with the official writer (post-e4-source-hashes.json:
e4 6533208977871917... -> now 3597c6e1cdf3ceae...), and the hardcoded allowlist
test now lists eight files. Every other sealed artifact, above all
e4_postmigration_checks.sql, still can never be superseded.

**Test device.** The founder answered "একই ফোন, আলাদা অ্যাপ" (same phone,
separate app). The production app (com.muthoy.pos) may be installed on the same
phone as the dev and preview apps: it is a separate install, and Android gives
each app its own data. A DEV install itself is still never pointed at PROD.
CLAUDE.md rule 16 and AGENTS.md rule 13 now say "app install" instead of
"phone".

## 2026-11-25 — PROD steps 8-9: production APK built, inspected and device-checked

**Build.** The production-smoke build is EAS 5f3cb2b9-cf67-4de9-8b29-462ad57d4bc0,
made from main b931963 through the validator (--eas-build, clean revision). It
used the existing EAS keystore for com.muthoy.pos ("Build Credentials
MEHEvxt620") and the EAS production environment's two public variables.

**Artifact (step 13 of B4).** The package is com.muthoy.pos, labelled "Muthoy
POS", version 0.1.0 (1), minSdk 26. The JS bundle:
- contains the PROD URL once and the DEV URL zero times;
- embeds one JWT, an anon key whose ref is qfhntfxtnjalsxqsvkun;
- contains zero secret-shaped keys, and no service_role, whsec_ or REVE
  secret. The sb_secret_ and sb_publishable_ hits are validation prefixes and
  patterns, not keys.

**Device (step 14).** On the founder's phone, as a separate app beside the
dev and preview apps (founder decision):
- It started on a fresh welcome screen with no adopted data.
- The cloud-ready indicator turned green. Its /auth/v1/health probe returns 401
  without an apikey by design, and connectivity.ts treats any status below 500
  as reachable.
- A registration with a fictional number (Phone OFF) showed "the code could not
  be sent". PROD's auth log recorded POST /otp -> 400 phone_provider_disabled.
- PROD still has 0 auth users, 0 shops and 0 SMS ledger rows. Every request in
  PROD's edge log came from the app to the PROD host.

**Remaining before real shops (P-F):**
- The founder enters REVE_API_KEY, REVE_SECRET_KEY and REVE_SENDER_ID.
- The self-managed daily backup and a restore test (pilot item 2) need their
  own plan and approval.
- Only then is the Phone provider turned on.

## 2026-11-25 — PROD daily backup live; restore and new-phone tests pass (pilot item 2)

The founder chose a free, private GitHub backup ("GitHub প্রাইভেট রিপো, ফ্রি")
over Supabase Pro, and offered this computer's Android emulator as the second
device.

**Backup.**
- Private repository iimrul/muthoy-prod-backups (never public).
- `.github/workflows/backup.yml` runs daily at 03:00 Asia/Dhaka and on demand.
  It runs Supabase's own `supabase db dump` (roles, schema, and data with COPY)
  against PROD's session pooler. The URL is the founder-entered secret
  SUPABASE_DB_URL; Claude never saw the password.
- The data dump leaves out four platform-owned ledgers that the postgres role
  cannot write and a fresh project recreates: auth.schema_migrations,
  storage.migrations, storage.buckets_vectors and storage.vector_indexes.
- On the runner, each dump is encrypted with a fresh AES-256 key, and that key
  is wrapped with the founder's RSA-4096 public key (OAEP-SHA256). Only the
  ciphertext, the wrapped key and a SHA-256 are uploaded, kept 30 days.
- The private key exists only on the founder's computer
  (C:\Users\Imrul\.muthoy-backup-key, current-user ACL). The founder must keep
  an offline copy; without it no backup can be opened.
- First runs succeeded (45549998818, 45553180105).

**Restore tests.**
- Decrypt (local): the artifact opened with the private key, its SHA-256
  matched, and it held roles.sql, schema.sql (60 tables) and data.sql (95 COPY
  blocks including auth.users). The decrypted copies were deleted afterwards.
- Restore (`.github/workflows/restore-test.yml`, monthly on the 1st and on
  demand): it starts a throwaway local Supabase on the runner and restores a
  fresh PROD dump made with the same commands. roles.sql runs tolerantly,
  because its built-in-role settings are refused (permission denied) exactly
  as on a real fresh project; schema and data run strictly in one transaction.
  Run 45552681794: all 87 public and auth tables match PROD's row counts.
- Three issues were found and fixed on the way:
  - built-in role settings in roles.sql;
  - hosted-only `SET (pg_attver=N)` column options, which the latest CLI no
    longer emits; the test still strips them;
  - an older local Auth missing hosted tables, so the restore test now uses
    the latest CLI.

**New phone (DEV first).** The Preview build was installed on the emulator
(Pixel_7, API 37, x86_64) as a brand-new device and signed in with the
founder's DEV number and PIN. The full shop came down from the server:
- the same three medicines with the same stock (42, 199, 3);
- the same expiry alerts, plan (Ultra) and shop name;
- "all changes reached the server".

**Gaps, stated.**
- The backup is daily, so up to a day of server data is at risk, and unsynced
  phone data is not in it (the accepted pilot rule).
- Storage FILES are not backed up; only their metadata is. Today PROD and DEV
  hold 0 objects. If prescription photos come into use, they need their own
  backup.

## 2026-11-25 — Failed sync changes named; OTP fills itself or pastes in one tap

The founder asked for two things after registering the first PROD shop, where
one change would not reach the server and the screen could not say which.
- Failed sync changes should be named, e.g. "একটি বিক্রয় সিঙ্ক হয় নি", in both
  languages, without making the dashboard card larger.
- A modern OTP screen: "ওটিপি আসার সাথে সাথে অটো পেস্ট হয়ে যাওয়া উচিত এবং
  ম্যানুয়ালি ওটিপি পেস্ট করতে পারাও উচিত".

Approved: a details summary, a details sheet and a support copy ("ঠিক আছে, করো");
OTP option A, Android's own one-tap consent prompt ("A: এক চাপে বসা"); and both
EAS builds, Preview on DEV first and then production ("হ্যাঁ, দুটোই").

**Failed changes.**
- The card's title now names what is stuck, for example "1 sale and 1 refund
  didn't reach the server" / "১টি বিক্রয় ও ১টি ফেরত সার্ভারে যায়নি".
- It names at most two kinds and then says "N more", so the card stays one line
  taller at most.
- "View details" opens a sheet listing each stuck change: its kind, when it
  was made, and a plain reason (keeps failing, plan read-only, not allowed,
  incomplete, refused by the server).
- "Copy for support" puts a short report on the clipboard. It holds the kind,
  table, operation, status and the server's error, with long digit runs masked
  and each error cut at 160 characters. It never includes the row's payload.
- The rows are read from local SQLite only (`listUndeliveredSyncRows`, capped
  at 100). Nothing is sent anywhere.

**OTP.**
- Android: the new local module `muthoy-sms-otp` uses Google's SMS User
  Consent API (play-services-auth-api-phone 18.1.0). When the code SMS
  arrives, Android itself asks "Allow Muthoy to read this message?". On Allow,
  the code fills the boxes and verifies as if typed.
- No SMS permission is requested, only that one message is read, and nothing
  is stored. The prompt is launched only if it resolves to Google Play services.
- The wait re-arms for a resent code and stops if the API fails at once.
- "Paste code" under the boxes takes the six digits from a copied SMS. If the
  clipboard has no code, or has two different codes, it says so and changes
  nothing.
- iOS keeps its built-in code suggestion (`oneTimeCode`), with no code of ours.
- New dependency: expo-clipboard ~57.0.2.

**Not yet true.** The behaviour is checked by unit and component tests only. A
Preview build on DEV, then the production build, must show the consent prompt,
the paste button and the details sheet on a real phone. The production sheet
is then expected to show why the PROD shop's one change failed. Any fix that
follows touches sync and needs its own plan (Rule 10).

**Device-verified the same day.**
- DEV, Preview build d3b93ad on the emulator: a test SMS brought up Google's
  "Allow Muthoy POS Preview to read the message…" prompt. Allow filled all six
  boxes and verification started by itself.
- "Paste code" took the code from the clipboard. The emulator was taken
  offline for this check, so the screen tried to verify, which it only does
  with a full six-digit code.
- PROD, the production build installed in place on the founder's phone: the
  card read "১টি দোকানের সেটিং সার্ভারে যায়নি". The sheet showed the reason,
  and the support copy showed the row.

## 2026-11-25 — Shop rows stop sending the server-owned plan and trial date

**Found** with the new details sheet on the first PROD shop. The one stuck
change is `shops.insert`, refused with "Commercial fields are server-owned",
not the login audit row that had been guessed.
- `recordChange` queues the whole local row, so the shop's local defaults went
  with it: `plan` 'free' and `trial_ends_at` null.
- After the shop's first push, the server sets the trial date itself
  (`b4_ensure_owner_billing_account`). Any later send of that row then
  disagrees with the server, and `commercialShopFieldsUnchanged` in the sync
  function refuses it for good.
- Every new shop could hit this. No data was lost: the shop is on the server,
  which is where the app's trial banner comes from.

**Fix, approved by the founder ("হ্যাঁ, এভাবে করো"). The app only; the server
is unchanged.**
- `toSyncPayload` no longer sends `plan` or `trial_ends_at` for shops. Both are
  server-owned and are read back from the server.
- `repairShopCommercialPayloads(shopId)` runs before every push:
  - It strips the two fields from pending shop rows queued by older builds.
  - A shop row refused for exactly that reason goes back to pending with
    attempts at 0.
  - Last-write-wins by `updated_at` means an old row cannot overwrite newer
    server data.
  - Other refusals, other tables and other shops are untouched.
- Tests:
  - the payload no longer carries the two fields (mutation-checked: with the
    fix removed, the test fails);
  - repair covers the refused row, the pending row, everything it must not
    touch, and a second run changing nothing;
  - the push runs the repair first.
- Rollout: DEV first, then Preview and production builds (both approved), then
  the founder's phone should show "all changes reached the server".

**Verified on the device the same day (#12, merged as ca6a95a).**
- DEV: Preview build 383d3ea6, installed in place on the emulator. The app ran
  and sync stayed green ("সব পরিবর্তন সার্ভারে পৌঁছেছে").
  - Only registration ever sends a shop row, so a DEV re-test of the shop row
    itself would have needed a new registration. The unit tests cover it
    instead.
- PROD: production build 7a15e8f1 (same keystore), installed in place on the
  founder's phone. On first open, the stuck shop row was repaired and sent.
  - The card went from "১টি দোকানের সেটিং সার্ভারে যায়নি" to "সব পরিবর্তন
    সার্ভারে পৌঁছেছে".
  - The 14-day trial is unchanged.
- Disk: this computer's C: drive was full (0 MB), which also explains a local
  full-suite run dying of Node out-of-memory. With the founder's approval, old
  APK copies and test temp folders were deleted (about 1 GB freed). New APKs
  now download to D:\Muthoy-deploy\apks.

## 2026-11-26 — Every cloud request gets a deadline

**Found on a DEV device (offline oversell test).** The access check that runs
on every reconnect ("আপনার প্রবেশাধিকার যাচাই হচ্ছে…") stayed up forever, twice
in a row: once when the network went away and once when it came back.
- Bringing the app back to the foreground did not help. Only a force-close did.
- Cause: React Native's fetch has no timeout. A token refresh that was in flight
  when the network changed never answered, and every later auth call queued
  behind it. The refund that hung for about 3 minutes earlier the same day had
  the same cause.

**Fix (approved by the founder, plan "ক").**
- `sync/requestDeadline.ts`: every request through the Supabase client now has
  a deadline.
  - Auth: 20 s. Storage (photos): 120 s. Sync, billing and REST: 60 s.
  - At the deadline the request is aborted and fails with "Network request
    timed out", the same error React Native's own timeout raises. The existing
    classifiers already treat it as "never reached the server" and retry.
  - The promise fails at the deadline even if the transport ignores the abort.
  - A caller's own abort (the refund claim's 20 s limit) still works unchanged.
- The access gate then goes to its existing "retrying" state every 5 s instead
  of hanging. When the phone is really offline, the next check opens the
  offline window as before.
- Tests: deadline unit tests, plus a real-SDK test in which a token refresh that
  never answers ends as a retryable error. With the deadline removed, that
  test hangs and fails (mutation-checked).
- Device check: needs a Preview build (not yet approved).

## 2026-11-26 — Migration 44: a pull follows the server's clock

**Found on DEV (offline oversell test).** The owner's phone and a cashier's
phone (John) each sold 2 of a batch that had 2, both offline.
- The server kept both sales: stock −2, `oversold_at` set, two movements.
- The owner's phone never received John's sale. It was missing from sales
  history, and today's total showed ৳18 instead of ৳22, even after two syncs.
- Cause: the pull pages by `updated_at`, which is the time the row was MADE on
  the device. The owner's phone had already pulled past 15:37 when John's sale
  (made at 15:37) reached the server at 15:48, so it sat behind the cursor
  forever. Every offline row from another device was exposed the same way.

**Fix (approved by the founder, plan "খ").**
- `server_changed_at` on the 32 pulled tables, stamped by a trigger with the
  server's clock on every insert and update. It is stripped from the rows the
  pull sends; devices never see it.
- `updated_at` is unchanged and still decides last-write-wins.
- The pull orders and pages by `server_changed_at`. Its output column keeps the
  name `updated_at`, and the Edge function already passes it through as an
  opaque cursor, so neither the Edge function nor any installed app changes.
- A row is pulled only once it is 2 s old by the server clock, so a row stamped
  inside a not-yet-committed transaction cannot be skipped.
- A cursor is trusted only if the row it names was stamped at or after it.
  Server-made cursors always pass; an old device-clock cursor from a fast phone
  starts over.
- Existing rows get the migration's time (a constant column default: no row is
  rewritten and no trigger fires), table by table in parent-first order. Every
  device's next pull re-sends every row once, which also delivers the rows
  already skipped. Re-applying a row a device has is a no-op (stock moves only
  on a movement's first insert).
- Chain declarations moved together: rollback class B, ROLLBACK.md, README,
  checkFile, h9 preflight, eol=lf, post-E4 hashes. Test harness: no settle wait.
- Tests: `sync-pull-server-clock.pgtest` (11): the late offline row is pulled;
  the device time is kept and the stamp is never sent; an update is re-stamped;
  the settle wait (override and 2 s default); a future cursor restarts; on an
  existing database everything is re-sent once, parents first, and only once;
  a fast-clock cursor restarts; `updated_at` is untouched; re-apply is a no-op;
  an unknown inner pull is refused. With the pull pointed back at `updated_at`,
  6 of them fail (mutation-checked).
- Rollout: DEV first (approved). PROD only with the founder's separate approval.

## 2026-11-26 — Shop name and owner name are separate; the greeting follows them

**Founder's rule (plan "ঘ", approved).**
- The name given at registration is the SHOP's name.
- In Settings the owner can set their own name and can rename the shop. One
  field each, Bangla or English; no separate Bangla/English fields.
- The dashboard greets "শুভ সন্ধ্যা, <shop name>" until the owner sets a name of
  their own, then "শুভ সন্ধ্যা, <owner name>".

**How.**
- No new column. Registration already stores the shop name as the owner's own
  name too, so "the owner has not set a name" means the two are equal
  (`domain/dashboard.ts` `greetingName`; compared trimmed, case-insensitive and
  Unicode-normalised, so a decomposed Bangla spelling still counts as the
  same).
- Settings: a "দোকানের নাম" row next to "ব্যক্তিগত তথ্য"; the profile sheet has
  "দোকানের নাম" and "আপনার নাম" fields (2–80 characters each).
- `updateShopProfile` renames the shop in the same transaction as the owner's
  details: `shops.name` plus one `shops` update in the outbox. Nothing is queued
  when the name is unchanged. Owner only (staff and managers refused, tested).
- Server side nothing changes: the owner may already change the shop identity
  fields (W4-05).
- Known limits, unchanged: an English shop name set in the Multi-Shop screen
  (Ultra) stays as it was and still shows in English mode; the shop switcher
  shows the new name after the next billing snapshot; each shop of a
  multi-shop owner keeps its own owner name.
- Tests: `greetingName` (Bangla and English, spacing/case/normalisation,
  fallbacks), owner rename queues `shops` + `users`, unchanged name queues no
  shop row, staff refused, and the rollback test covers the rename.

## 2026-11-27 — An oversell is shown to the owner

**Founder's rule (plan "গ", approved 2026-11-27).** When offline sales take a
batch below zero, the owner and staff get a notification, the Low Stock card on the
dashboard shows it in red, and Inventory shows the negative stock (−2).

**Why.** The server already kept both sales and marked the batch (DEV test
2026-11-26: batch OS2 at −2, `oversold_at` set), but the owner saw nothing:
the low-stock card only counts medicines with some stock left, so it said
"স্টক ভালো আছে"; Inventory showed the sellable stock (0); no notification.

**How. App only: no migration, no sync or server change.**
- **The test is `batches.stock < 0`, not `oversold_at`.** The server sets
  `oversold_at` once and never clears it, so it would keep flagging a batch
  the owner has already recounted (`db/inventory.ts` `listOversoldBatches`).
- **Dashboard.** Oversold batches lead the Low Stock card in red
  ("বেশি বিক্রি: <medicine> #<batch>", value −2), ahead of the low rows. The
  "+N more" and the list count cover both (`getOversoldSummary`,
  `AlertRow.isAlarm`).
- **Inventory.**
  - `MedicineListRow.oversoldStock` is the sum of the negative batches.
  - The card's badge says "বেশি বিক্রি", and "Current" shows sellable +
    oversold. Example: 10 left in another batch and OS2 at −2 shows 8;
    OS2 alone shows −2.
  - In the batch table, a negative quantity is red.
- **Notification.**
  - A new local type, `oversell`: critical, one per batch.
  - It re-arms after the batch is corrected to zero or above. It is not sent
    again on later days while the batch is still short.
  - It runs after every completed sync, which is when another phone's late
    sale arrives. It also runs with the usual foreground and background
    checks.
  - It is behind the existing stock-alert switch.
  - Who: the owner, and every staff member who may view stock
    (`inventory_view`, on by default for staff), the same gate as low stock.
    The founder first said owner only, then the same day asked for staff
    too ("স্টাফরাও নোটিফিকেশন পাওয়া উচিত"): they sell from that shelf.
  - An oversold medicine does not also get a "low stock: −2 left" alert.
- **Unchanged.**
  - The Sale list still hides a batch with no stock.
  - The owner corrects stock as before: Edit Batch → reconciliation.
  - `notifications.type` is plain TEXT with no CHECK and never syncs, so the
    new value needs no migration.
- **Tests.**
  - On real SQLite: the batch below zero is listed and nothing else is; the
    shortfall reaches Inventory; the batch drops out after a recount; the
    owner and staff see the alert, a staff member with stock view switched
    off sees neither it nor low stock.
  - Notification checks: once, re-arm, not again the next day, staff with
    and without stock view, after-sync path.
  - Inventory card: badge and −2.
  - Mutation run: 12 of 13 caught. The one survivor is the `created` guard
    on the banner, which only matters if two checks race; the check queue
    already prevents that.
