> Integration note — 2026-11-15: the approved source now lives in D:/Muthoy.
> Workspace paths, approvals, tests and restrictions below describe the historical external run.
> This phase authorizes source integration and isolated tests only; no hosted/device/credential operations.

# Claude review remediation: exact Rule 10 scopes

Status: Founder APPROVED groups A-D, including optional F-11, on 10 November 2026.
Separate follow-up approval permits one new pgtest include entry in vitest.config.ts.
The actual-writer F-06 amendment at the end supersedes scope C's initial three-key payload premise.
Baseline: D:/md, remediation/android-metro-20261109, a23ca61262497474bf85ede78948ca831657c8db.
Authoritative inputs: private FINDINGS_FOR_CODEX.md and CODEX_FIX_HANDOFF.md.
REVISE; RC/pilot/Production NO GO. Existing Staff receipt-less access is preserved.
No hosted changes, migration edits, sealed files, native patch, domain formula,
fromTaka, credentials, or application data changes under any group below.
Each rollback restores only that group's new patch, preserving previous work and evidence.

## A — F-01: server authorization, tenant isolation and replay tests only

Files: new backend/supabase/pgtest/receiptless-restock.pgtest.ts;
apps/mobile/db/receiptless-restock.sqlite.test.ts. Existing harness.ts, sync/push.ts,
RPC SQL, permissions and migrations are READ ONLY. Initial automatic-discovery assumption was wrong: pgtests are individually listed.
Founder separately approved one include entry; all prior tests and settings stay intact.

Exercise the real ungrouped pushRows path with an SQL-backed test adapter and
existing PGlite harness applying real active migrations; use real sync_row_permitted
and sync_apply_row rather than mocked authorization decisions. Use newly seeded
synthetic shops/users/medicines only. Assert exact batch +N / purchase movement
with ref_id NULL, no supplier invoice/payment/drawer, Free Owner and authorized
Staff acceptance. Assert no-grant, explicit deny, revoked grant, inactive/deleted
actor, wrong-shop actor/medicine/batch denial with unchanged row snapshots.
Replay identical rows and changed-payload/reused IDs; assert no duplicated row,
stock increment or unauthorized overwrite. SQLite tests deny inactive/revoked
Staff atomically, and preserve the authorized route.

Risk: tests may reveal a real backend or local writer defect. Record FAIL and
submit a separate exact source-fix plan; this approval does not authorize backend,
permission, stock-writer or hosted changes. Local test PASS cannot establish
hosted or Staff hardware acceptance. T20 stays PARTIAL until those are verified.

## B — F-05: exact invariant attribution and independent oracle controls

Files: scripts/generate-history-fixture.mjs; apps/mobile/tests/history-fixture.test.ts.
Add a read-only failing-invariant-name export reused by the validator; preserve
all existing invariant SQL and metadata checks. Each of nine disposable-copy
mutations asserts its exact failing-name set; add sale_items.qty +1 with the
related line/parent invariants explicitly enumerated. Preserve stock=sum(movements).

Run each fixture mutation independently. In a NEW scratch generator copy only,
replace the ORACLE query with an always-empty query; demonstrate that positive-sign,
orphan-sale and wrong-shop assertions now fail, while the original validator still
rejects the valid controls correctly. Do not weaken or edit repository oracle SQL.
Risk: false confidence from unrelated invariants; exact-set assertions and this
negative control address it. No historical evidence or seals rewritten.

## C — F-06 and optional F-11: production-shaped synthetic refund fixture

Files: scripts/generate-history-fixture.mjs; apps/mobile/tests/history-fixture.test.ts.
Read apps/mobile/db/refunds.ts only. Emit refund cash_drawer UPDATE payload with
exactly closingExpected at refund time, isDirty and updatedAt; remove post-close
rewrite. Independently derive expected refund-time cash from eligible dated sales,
collections, expenses, refunds, supplier payments and withdrawals, rather than
copying final drawer values or generator outputs. Validate drawer identity/shop/date,
operation membership, exact payload keys, amount and timestamp. Later sales/close
must leave the original sent payload unchanged. Include wrong amount, extra/missing
keys, wrong drawer/shop/time and post-close overwrite negative controls.

Include F-11 independent sale-line COGS=qty*batch purchase_price and
line_total=qty*unit_price-discount_amount invariants, with separate mutations and
legitimate repeated-batch-line controls. These are fixture invariants, not changes
to application accounting. Verify compatibility with actual writer allocation and
historical batch cost assumptions before asserting; record FAIL rather than
normalizing invalid data to satisfy the test.

Regenerate full fixture into a NEW path; record SHA256, bytes, rows/tables,
migrations, invariant names/count and validator result. Preserve old e4ed4101 fixture
and all original acceptance evidence. Re-run real-Drizzle migration/schema checks.
Risk: fixture shape/semantics and hash change; synthetic data only.

## D — F-08: explicit monetary precision validation

Files: apps/mobile/components/forms/FormField.tsx;
new packages/validation/src/money.ts and money.test.ts;
packages/validation/src/{index,inventory,sales,purchases,expenses,customers,b2}.ts;
existing corresponding validation tests; apps/mobile/i18n/{catalog,display}.ts;
apps/mobile/tests/inventory/form-field-numeric.test.tsx;
apps/mobile/components/inventory/receiptless-batch.test.tsx;
apps/mobile/tests/inventory/inventory-remediation.test.tsx;
new apps/mobile/tests/inventory/money-persistence.sqlite.test.tsx.
Read ManualEntryForm, ReceiptlessBatchForm and database writers only.

Preserve the exact editable money string; reject raw strings with more than two
fractional digits through explicit form validation before any writer invocation.
Keep existing numeric RHF output for valid input, empty-field behavior, validation
bounds and reset behavior. Add shared precision validation to taka money schemas
for non-UI callers; require finite valid values without silent rounding/truncation.
Keep fromTaka, integer-paisa conversion, formulas, writers and schemas unchanged.

Test 12.345,0.005,0.004,1.000 rejection; 1.15->115,0.10->10,1.->100,
1.00->100; trailing zeros, deletion, external reset and empty behavior, in EN/BN.
Both receipt-less and ManualEntry forms must refuse save without writer calls or
ledger/outbox changes. Positive tests submit through real forms and existing writers
into real SQLite, verifying stored integer prices and exact movements/no unwanted
cash/invoice effects. Negative controls deliberately remove precision enforcement
in scratch copies and must fail. Physical current Metro invalid-save refusal may
run under existing non-destructive scope; any new successful Android stock write
requires its own exact synthetic record/date approval because H-5 day is closed.
Risk: resolver can overwrite Controller errors; test actual handleSubmit behavior,
not only displayed error text. No hidden conversion to rounded valid values.

## Already approved, independent work

F-02 documentation disclosure; F-03 status route contrast; F-04 Dev scanner
non-destructive inspection only (fix scope documented only if reproduced);
F-07 Admin final-tree build/browser checks; F-09 comment; F-10 catalog;
F-12 count/privacy; F-13 seven-term presentation including zero supplier row.
No Staff/Manager session fabrication or credential changes for physical captures.

## Final checks and independent review

After approved patches: focused regressions and negative controls; new source hash
checkpoint; complete unfiltered pnpm test; pnpm lint/typecheck; Admin build plus
28-check local HTTP/browser harness; current Metro captures where authorized and
available. Verify source hashes after checks; retain prior receipts separately.
Update reports per finding with PASS/FAIL/BLOCKED/NOT RUN. Request Claude final
independent re-review; no commit/push/merge or release-gate closure.


## F-04 reproduced: bounded JS presentation fix (Founder conditional approval)

Confirmed on current Metro Dev, camera permission denied:
android-claude-scanner-denied-settled-20261110.png shows dark status icons on
richBlack. The earlier animation capture is provisional and excluded as proof.
Files: components/scanner/MedicineTextScanner.tsx and its existing component test.
Use the existing native dark-icon default with a white status-area surface,
reserving StatusBar.currentHeight above the black scanner body so Close remains
below the system icons. Set existing Modal statusBarTranslucent explicitly.
Native dialog copies activity appearance at show time; no unverified JS light-icon
call is claimed to control the dialog. No native/plugin/patch/build/permission,
scanner/camera/OCR behavior, navigation or business handler change.
Test the visible surface/inset and absent hidden scanner, retain all existing
permission/capture/error tests, then physically verify settled denied-state contrast
and Close. Rollback only this bounded UI patch. No camera capture or permission grant.


## F-06 scope amendment APPROVED — actual queue serialization

The Founder approved the actual-writer correction after source tracing showed
recordChange rereads a complete row and serializes snake_case for insert/update.
The three-key/camelCase premise was wrong. Prior fixture patches, first 31-invariant
artifact and their passes are SUPERSEDED, retained under new evidence names.
Implement full refund-time row snapshots, real-writer shape regression in
apps/mobile/db/b2-refunds.sqlite.test.ts, independent time-bounded cash checks,
valid timestamp lag and immutable old queue payload after later sale/close.
No application writer, schema, sync implementation or hosted changes.


## F-08 four custom cash inputs extension APPROVED

Founder approved OpeningCashModal.tsx, WithdrawSheet.tsx, ManagerDashboard.tsx,
app/cash-summary.tsx, new tests/cash-input-precision.test.tsx and its sole explicit
Vitest include. Replace Number(raw) with moneyDraftValue before schemas erase
third trailing decimals. Keep editable text, permissions, bounds, domain/writers,
integer conversion and sync unchanged. Show existing EN/BN precision message.
Verify invalid drafts/no callback or ledger writes and valid exact paisa persistence
through real SQLite. No hosted or Android business writes. Rollback only this group.

Actual Android also exposed delayed native/RHF echoes replacing 12.345 with NaN.
Two focused delayed-echo regressions failed before the approved FormField repair.
Consume pending own numeric echoes without overwriting current raw text; retain
external resets. Preserve the interrupted full-suite receipt and rerun unfiltered
against a new frozen source checkpoint after all approved patches.


## Follow-up review — approved execution 11 November

Claude D1: strengthen already approved money tests with call-through spies on actual
cash/inventory writers. Flush submit microtasks and a zero-delay macrotask before
no-write assertions; check writer/ledger before message. Positive paths prove spy
wiring. Scratch 1.000 controls must fail at writer assertions on all four custom
cash inputs and both real forms. No production writer changes. D6 Modal property
assertion and D7 response length assertion strengthen existing approved tests.
Document fixture-only stable-cost/single-device assumptions (D4/D5), no oracle change.

Founder separately APPROVED D2: ManagerDashboard.tsx + cash-input-precision.test.tsx,
blank opening remains refused, Save disabled, existing EN/BN invalid-amount message;
explicit0 valid. Test empty no-writer/no-ledger and zero real SQLite persistence.

Founder separately APPROVED role-switch TEST ONLY: new db/role-switch-rehydration.sqlite.test.ts
and one Vitest include; real pull/apply/purge/cursor with mocked network and temporary
synthetic SQLite. Owner->Staff->Owner restoration, Staff isolation, pending retention,
server fixture unchanged. No sync/auth implementation or device restoration writes.
Preserve failing proof and request separate exact fix plan. Observed H-5 server still
has11sales/15items while local Owner after role switches has0/0; no hosted changes.


## Role-switch mirror repair — APPROVED separately 11 November

Reproduction: role-switch-reproduction-first-20261111.log:1 expected restoration
failure/3 passing isolation/pending controls. Existing code purges clean colleague
sales under Staff scope but persists only a shop-wide pull watermark; Owner's old
rows then remain below since and never return. DEV server11sales/15items intact;
local Owner mirror0/0. No restoration has been attempted.

Exact source scope: apps/mobile/sync/cursorStore.ts and pull.ts only. Add a separate
shop-scoped materialized-access checkpoint (server actor ID, saleHistoryScope,
canonical readableTables) alongside the existing watermark. On the first valid
access answer of an incremental pull, missing or different access context restarts
through the existing full-hydration path from null BEFORE applying/advancing the
incremental page. Same context keeps incremental behavior. Record access checkpoint
before access purge so failed MMKV persistence cannot purge rows without the durable
context needed to rehydrate later. Keep existing all-or-nothing hydration, dirty/
pending protection, permissions, server SQL, ledger calculations and schema unchanged.
Older server answers lacking access remain compatible and do not invent authority.

Tests: approved role-switch-rehydration.sqlite.test.ts; existing sync/pull.test.ts,
db/hydration-ledger.sqlite.test.ts mocks only if needed; existing or new
sync/cursorStore.test.ts for context validation/roundtrip/shop isolation/failure.
Prove Owner->Staff->Owner and StaffA->StaffB restoration, same-actor permission scope
changes, unknown legacy checkpoint, unchanged context incremental, cancelled/failed
hydration no partial apply/cursor change, metadata-write failure no purge, Staff
isolation, pending/failed graph retention and cross-shop safety. Preserve original
failed reproduction. Run focused sync/auth/real SQLite tests, full suite/types/lint,
independent Claude review. No timeout/assertion relaxation or excluded tests.

Risk: role/access transitions add a full network hydration, potentially slower for
large histories. A new metadata key is device-local and holds no credentials.
Before source modification, stop only the owned Metro process so this change cannot
automatically reach the attached Dev and perform hydration. Source and synthetic
tests ONLY under this approval; separately request exact bounded Dev rehydration
AFTER tests/review. No hosted data changes, migrations, auth writer, app clearing,
install/uninstall, cursor clearing on phone or data restoration command.
Rollback: revert only this source/test group; leave device/data/evidence untouched.

Founder APPROVED the above local role-switch source/test repair on11November.
Metro port8081 had no listener before implementation; no device runtime updated.


## Proposed device validation after local repair — NOT YET authorized

Only existing com.muthoy.pos.dev / approved installed cd649abe5370... APK on
RZ8W40HDRMK, verified synthetic DEV H-5 shop only. No new APK/install/clear or hosted
migration. First finish local tests, full suite and independent review; bind approval
to the final source checkpoint. Before Metro update, Founder disconnects phone
internet privately (USB Metro remains local) so restored source cannot sync before
a baseline is captured. Verify package, camera-denied state, private Owner session,
exact shop and DEV project without reading credentials. Read minimized SQLite
history/movement/batch/outbox counts, original synthetic IDs, Nov10 drawer/ledger
and dirty/pending rows. Do not guess that last night's session is still current.

With later explicit approval, start owned Metro/current approved source, load over
USB and retain data/session. Capture offline baseline; then Founder restores
internet. Use normal existing sync only to rehydrate missing server-backed rows,
no custom SQL/database/cursor writes. Verify server/local IDs and ledger amounts,
idempotent26movements/8batches, expected11sales/15items if server census unchanged,
existing pending records/queue handling, exact historical Nov10 cash2150paisa and
stored close. For current Nov11, opening cash still defaults0; never copy2150 or
create/reopen a drawer. Stop on wrong actor/shop, unknown pending records or mismatch.
No new sale/refund/collection/purchase/restock/payment/expense/recovery operation.

Then bounded read-only scanner-from-green-home checks (camera denied, no capture/OCR/
permission grant), cash7terms/ENBN and invalid-input refusal only; preserve runtime
failures. Successful new Android money/stock transactions remain separately scoped.
Record before/after and hashes; existing Production/Preview untouched. Keep no-loss/
release gates open. Device writes caused by this hydration require separate Founder
approval after the concrete local result is reviewable.


## Claude second re-review R1 — proposed credit-link repair; NOT APPROVED

Independent read-only review: claude-independent-followup-20261111.json, verdict
REVISE. D1/D2 corrections accepted; materialized-access logic accepted. Real SQLite
reproduction role-switch-credit-link-reproduction-20261111.log: ten controls PASS,
two exact credit.sale_id failures (incremental restart and explicit null-cursor full
hydration). Access purge deletes colleague sales; ON DELETE SET NULL changes the
credit link without updating its timestamp. Equal-timestamp LWW then skips repair.
The synthetic split sale has 2000paisa total, 500cash, 1500credit, 450collection,
1050balance, exact allocation and a closed 1070paisa drawer. No device writes ran.

Proposed exact source files: apps/mobile/sync/pull.ts and db/sync-helpers.ts.
Tests: existing approved db/role-switch-rehydration.sqlite.test.ts, existing
sync/pull.test.ts and db/sync-helpers.sqlite.test.ts only if needed. No new include.

Bounded implementation: full hydration compares its authoritative actor/scope/
readable-table answer against the materialized checkpoint. Only an unknown or
changed context enables an optional restoreAccessPrunedCreditLinks apply flag;
normal incremental apply and unchanged-context explicit full retain strict LWW.
This also covers direct null-cursor login/bootstrap, not just incremental restarts.
Within that mode, restore ONLY credits.sale_id when local link is null, remote link
is a nonempty ID, timestamps are exactly equal, all other shared business fields
agree, and the referenced sale belongs to the same shop and is already materialized.
Skip locally newer rows and any credit protected by pending/failed outbox rows or
its dependency closure. Reuse existing protectedOutboxGraph rather than invent a
second pending-work definition. Update only sale_id inside the existing atomic
apply transaction; do not replace credit amount/balance/metadata or emit an outbox
write. Do not widen equal-timestamp updates for any other table. User access locks,
PIN fields, movement-derived stock and existing immutable-ledger handling stay as
before. Source documentation must disclose the DB apply-writer change honestly.

Tests: exact before/after complete credit/allocation/drawer rows and independent
1070paisa formula; refund credit lookup; both incremental-restart and explicit-full
paths; unchanged-context incremental equality remains a no-op; locally newer credit
not overwritten; changed amount/balance prevents repair; parent wrong-shop/missing
not linked; pending/failed direct credit and allocation-parent protection; cancellation/
apply-failure rollback and no queue changes. Scratch disabling ONLY the new repair
must fail specifically at credits.sale_id; preserve first failing proof. Run focused
real SQLite/sync/auth/refund suites, complete lint/types and unfiltered suite, local
Android JS export, and another independent Claude read-only review.

Risk: this changes a sync database writer touching a financial relationship. The
flag is limited to access-context hydration, only reconstructs a server-confirmed
FK and preserves money values. Unknown old metadata causes one full fetch on each
existing installation after update, with history-size/network cost. No schema,
formula, money transaction writer, auth writer, RLS/server/hosted change. Metro stays
OFF. No device hydration/SQL/cursor/data restoration, APK install or transaction.
Rollback: revert only this new option/credit-link restoration/caller/tests group;
retain approved access checkpoint fix, existing evidence, device and server data.
Requires separate Founder approval under CLAUDE.md Rule10 / AGENTS.md Safety Gate.

## Second-review hypotheses H-A/H-B — proposed TEST ONLY; NOT APPROVED

Files: new backend/supabase/pgtest/role-switch-credit-contract.pgtest.ts, its one
explicit include in vitest.config.ts, existing approved role-switch-rehydration.sqlite.test.ts.
Use the existing PGlite harness/active migrations and actual sync_apply_row /
sync_pull_changes_b2 contracts; temporary synthetic database only. H-A: determine
whether a later collection/writeoff-shaped full credit update with sale_id:null
can erase the server's existing link; include valid update, replay, cross-shop and
unauthorized controls, exact before/after ledgers. H-B: inspect actual Staff pull
rows for a colleague credit whose sale is filtered, and reproduce fresh Staff
hydration/role transitions against those real payload shapes in SQLite. Assert
referential consistency/atomic failure and preserve any failures as open defects.
No source server/client implementation fixes, migrations, hosted reads/writes,
device hydration or production data. Every confirmed defect requires a separate
exact repair plan; do not silently broaden R1 to authorization/server contracts.
Rollback only these tests/include; keep failure evidence. Rule10 applies to stock/
money/sync database test tooling. Production/RC/pilot remain NO GO.

Founder APPROVED the R1 credit-link source/test extension and H-A/H-B TEST-ONLY investigation separately on11November. Metro remains OFF; device/hosted changes unauthorized.


## Confirmed H-A/H-B — proposed HELD local server contract; NOT APPROVED

Proof: role-switch-r1-ha-hb-confirmed-20261111.log,3 intended failures/29PASS.
H-A actual grouped collection: server credit amount2000, collection450, balance1550,
but null incoming sale_id overwrites the original server sale link. Positive valid
collection and identical replay pass exact ledgers. H-B actual Staff SQL pull returns
a colleague credit with nonnull sale_id while hiding that sale; matching SQLite
hydration fails FK787 and rolls back without changing rows/cursor/access metadata.
Original first log retains two incorrect error-code assumptions; corrected tests
pin actual MU010 live-shop denial and MU003 row-shop denial, with unchanged ledgers.

Exact proposed files:
- NEW backend/supabase/held-migrations/role-switch-credit-link-contract.sql;
- held-migrations/README.md documentation only;
- existing backend/supabase/pgtest/role-switch-credit-contract.pgtest.ts;
- existing apps/mobile/db/role-switch-rehydration.sqlite.test.ts;
- source DECISIONS.md and this plan; external evidence/reports.
No active migration files, chain manifests, classification seals, client writers,
Edge Function source, production schema or hosted execution in this group.

H-A: an additive held wrapper around the existing SIX-argument sync_apply_row.
Keep the existing five-argument delegator and its dynamic six-argument target.
For credits already linked to a same-shop sale, incoming null/missing sale_id must
retain the existing server sale identity before ordinary downstream authorization,
FK/LWW and grouped operation processing. A different nonnull sale_id is refused;
standalone null credits and legitimate new inserts keep current behavior. Never
repair old server rows already null, rewrite history, alter amounts/balances, or
change collection/refund/accounting formulas. Preserve current authenticated-shop
checks before normalization, downstream live actor/permissions checks, error
behavior and LWW. The lookup is scoped to credit id AND caller shop. New internal
renamed function has no PUBLIC/anon/authenticated execute; public wrappers retain
current service_role-only ACL. Candidate SQL must be reapplicable without recursive
renames, like the existing H7 wrapper pattern.

H-B: wrap the existing sync_pull_changes_b2 result with a projection only. Preserve
all row selection, ordering, pagination cursors, accessVersion/readable tables,
authorization and exact financial fields. If a returned credit refers to a sale
hidden from this actor by own-history scope, serialize only that row's sale_id as
JSON null. Owner/history-authorized and own-sale links remain intact. This neither
returns hidden sale rows nor changes the stored server credit. Client credits.sale_id
is already nullable. Approved R1 restores the link on later Owner hydration while
ordinary Staff pulls can materialize referentially valid rows. The H-A server guard
retains the real identity when a Staff collection queues this intentionally masked
null. No widened Staff history, RLS policies/grants or monetary access scope.

Tests explicitly apply this HELD candidate only in the new contract pgtest after
the existing active harness; ordinary harnesses remain on the active chain. Verify
raw baseline failures preserved; Owner and own-Staff links; masked colleague links;
exact page/cursor/amount/balance/payload fields; no hidden sales; cross-shop and
revoked/inactive actors; standalone credit; null-link Owner/authorized Staff actual
grouped collections and replay; different-link rejection; old LWW and no changes
to other tables; function ACL/reapplication. SQLite mock must match the proven real
SQL projected payload, then fresh Staff hydration and Owner->Staff->Owner restores
all credit/allocation/drawer rows. Scratch disabling each fix must independently
fail its own FK/link oracle. Preserve the existing assertions except changing the
explicit contract expectation for the now intentionally masked Staff sale_id.
Run focused suites, full unfiltered suite/lint/types, local export, independent
Claude review. No test exclusions, xfail or relaxed timeouts.

Risk: this is a security-sensitive server-contract change, currently LOCAL HELD
ONLY. Until separately promoted/classified/reviewed/applied to verified DEV, live
server behavior remains defective; physical role/hydration acceptance stays BLOCKED.
No Metro/device hydration, deployment, hosted queries/writes, table schema change,
manual data repair/backfill or new business transaction. Publishing/installing is
not authorized. Rollback only this held SQL/test/documentation group; preserve R1,
old evidence and device/server records. Actual activation/remote rollback needs a
separate release plan and approval. Founder Rule10 approval required before code.

Founder APPROVED the H-A/H-B LOCAL HELD contract candidate on11November. No promotion, hosted execution, device or data backfill approved. Existing full run stopped after29.957s with sourceChanged[] before edits; raw log/receipt preserved as interrupted, not a full verdict.


### Independent HELD review F1 — correction inside approved candidate scope

R1 follow-up ACCEPT. H-A/H-B logic accepted; candidate REVISE for internal ACL:
E4 requires renamed functions denied to service_role too. Correct the same held
SQL and ACL test; only public wrappers get service execution. Test direct internal
service calls42501 and successful SECURITY DEFINER public collection/pull. No live
ACL change. Also track F5: pending-protected credit can stay locally unlinked after
ACK until next access change, with refund refused rather than miscounted. The
candidate guarantees the credit graph only; it does not prove all Staff FK graphs.

## Proposed F3/F4 TEST ONLY — NOT APPROVED

Files: existing role-switch-credit-contract.pgtest.ts and
role-switch-rehydration.sqlite.test.ts only. No new Vitest entry, source SQL/client
implementation, schema or hosted/device changes. F3: actual active/held Staff pull
of a colleague-completed sale_drafts.completed_sale_id whose sale is hidden; use
its exact projected payload in temporary SQLite and assert FK integrity/atomic
failure, Staff own-history isolation and Owner restoration. F4: actual allocation
pull with credit_view or sale_return grants while sales/credit_management are
explicitly denied, inspecting referenced credits/payments under the real policies;
materialize exact page shapes in SQLite, verify no dangling parent/FK failure and
unchanged server ledgers. Include positive role/permission controls, replay and
cross-shop denial, no weakened Staff history. Preserve any failures and request a
separate exact repair scope. This is two named hypotheses, not a general audit.
Rollback only these tests; retain existing approval groups/evidence. Rule10 applies
because these are new auth/sync/financial fixture tests. No device hydration.


F1 verification: role-credit-held-f1-fixed-20261111.log20PASS including real
service_role public wrapper execution and function-specific42501 internal denial.
The original compatibility test loaded a second DB inside its5s test and timed
out; fixture construction moved into the pre-existing60s beforeEach hook. All
assertions/timeouts retained; the warmed delegator passes (19PASS v2 before F1).
F2 complete-file controls (no name filters): H-A6FAIL/14PASS, H-B4FAIL/49PASS.
Omitted key, reapply, warm delegator, complete-page equality and live service-RPC
oracles fail at their targeted relationships when disabled. R1 Owner-role-cycle
cases correctly PASS with only H-B removed: they exercise independent R1 recovery
of the already-present credit after access purge, as the original active-chain
29PASS/3FAIL baseline already proved. They are not H-B fresh-insert oracles.
No weakened assertions, xfail, source mutation or exclusions. F3/F4 tests remain
unapproved hypotheses; broad Staff referential-integrity acceptance is BLOCKED.


### 11 November — F3/F4 TEST-ONLY approval and verified baseline

Founder APPROVED the two existing role-switch test files only. Additions were
first staged externally to preserve the active full-suite checkpoint. The frozen
Root run completed317files7414testsPASS, sourceChanged[], then the approved two
files were integrated through exact before-SHA guards. External focused actual SQL
and SQLite reproduction is5FAIL4PASS53unrelatedSKIP; complete Root files running.
No new source repair approved. Exact new F3/F4 proposals are external evidence
f3-f4-repair-proposal-20261111.md; separate approval questions pending. Earlier
NOT APPROVED test-only headings are superseded by this explicit approval record.
No hosted/device/active-migration changes or Metro. General Staff graph acceptance
remains BLOCKED. Original failed evidence is preserved; no test exclusions/xfail.


### 11 November — F3/F4 source and amendment C APPROVED

Founder separately approved exact local F3 and HELD F4 scopes in external evidence
f3-f4-repair-proposal-20261111.md, then approved customer/reconciliation amendment C
following Claude's read-only review. F3 design accepted with richer/strict equality,
uniqueness, actor-vs-sale visibility and two Owner paths. F4 first proposal was
incomplete; C adds required customer readability, explicitly removing additional
inconsistent reconciliation history. No extra parent grants or RLS changes.
Approved files remain existing HELD SQL/README, sync-helpers.ts/pull.ts, the two
existing tests and decisions/evidence docs. Source details/risks in DECISIONS.
Baseline5FAIL57PASS0SKIP and C2FAIL62focusedSKIP preserved. First fixed complete
files88PASS. Final incremental/role/pagination/ACL controls and full checks pending.
No hosted/device/active migration change; Staff receipt-less restock stays enabled.
