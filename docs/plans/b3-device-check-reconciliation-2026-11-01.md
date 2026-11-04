# Batch 3 — reconciling "twenty device checks" with the six documented cases

Asked for: reconcile the earlier *twenty device checks* against the six
high-level acceptance cases the repository documents, without inventing a
twenty-item authoritative matrix, and separate completed from unverified.

## 1. There is no twenty-item matrix, and there never was one

Searched every `.md` under `docs/` plus `DECISIONS.md`. The number **twenty**
appears as a **bare count with no list attached**:

| Where | Text |
|---|---|
| `muthoy-batch-3-operational-closure-readiness-2026-10-30.md:1225` | §16 Two-device mobile acceptance — *"Zero of twenty cases executed."* |
| `muthoy-batch-3-final-closure-execution-2026-10-31.md:399` | *"None of the twenty Batch 3 …"* |
| `muthoy-batch-3-final-operational-closure-2026-10-31.md:894` | *"The device scenarios …"* |

No file enumerates twenty device cases. The **only** enumerated set is
`muthoy-batch-3-hosted-and-device-gate-packages-2026-10-30.md` §3.3,
*"What to test, and why these six"*, with six numbered cases and an explicit
acceptance rule: *"each case recorded with the device, the build revision and
the observed result. A case that cannot be run is recorded as not run."*

An earlier correction of mine claimed "the twenty" appeared **only** in my two
2026-10-31 documents. That was also wrong: it predates them, at line 1225 above.

**Conclusion: six is authoritative. Twenty was never a matrix.**

## 2. The individual checks, derived from the requirements

The six cases are aggregates. Decomposing each into the atomic assertions its own
text and the cited CLAUDE.md rules actually require yields the table below.

This decomposition is **derived here**, from requirements — it is not a recovered
original list. It happens to total twenty, which may be where the number came
from, but nothing in the repository supports treating that as more than a
coincidence, and it is recorded as a derivation rather than a discovery.

| # | Check | Source | Status |
|---|---|---|---|
| 1.1 | A new owner can register on a device a previous owner used | §3.3 case 1 | NOT RUN |
| 1.2 | The new owner sees **no** trace of the previous owner's shop | CLAUDE.md r7 | NOT RUN |
| 1.3 | Every shop has a unique, non-hardcoded id | CLAUDE.md r7 | NOT RUN |
| 2.1 | Shop A's rows never reach Shop B | §3.3 case 2 | NOT RUN |
| 2.2 | Shop B's rows never reach Shop A | §3.3 case 2 | NOT RUN |
| 2.3 | Isolation holds while both devices sync concurrently | §3.3 case 2 | NOT RUN |
| 3.1 | A sale completes with no network at all | §3.3 case 3 | **PASS** |
| 3.2 | The queue drains on reconnect | §3.3 case 3 | **PASS** (client-side) |
| 3.3 | It drains **once** — no duplicate | §3.3 case 3 | **PASS** (client-side) |
| 3.4 | Totals match after the drain | §3.3 case 3 | **PASS** (client-side) |
| 3.5 | Same, with the app killed during the sync window | §3.3 case 3 | **PASS** (client-side) |
| 3.6 | No sync conflicts are produced | §3.3 case 3 | **PASS** |
| 4.1 | A refund is recorded on its **own** processing business date, and the original sale stays on its own | §3.3 case 4 | **PASS** (2026-11-03) |
| 5.1 | Opening cash defaults to 0 | CLAUDE.md r5 | **PASS** |
| 5.2 | The user can set opening cash | CLAUDE.md r5 | **PASS** (2026-11-03) |
| 5.3 | It resets at midnight and never inherits yesterday | CLAUDE.md r5 | **PASS** (2026-11-03) |
| 6.1 | The expiry day-count is correct for the day it is read | CLAUDE.md r3 | **PASS** |
| 6.2 | Ordering uses the real expiry date, not a stored day-count | CLAUDE.md r3 | **PASS** (2026-11-02, re-run) |
| 6.3 | The earliest-expiring batch **within one medicine** is selected | CLAUDE.md r3 | **PASS** (2026-11-02, re-run) |
| 6.4 | A sale larger than one batch spills to the next by expiry | CLAUDE.md r3 | **PASS** (2026-11-02, re-run) |

**14 PASS, 6 NOT RUN.** (An earlier draft said 10 and 10, and before that 11 and 9, which
did not match the rows above it.)

The † qualification these three carried is **withdrawn**: the second run of
2026-11-02 excluded the batch-id confound directly. See §7.

### 2.1 How 6.2, 6.3 and 6.4 were closed, 2026-11-02

Build `47c9f0aa` (from `9ed99b4`) was installed in place over the existing test
shop. Package, versionCode and signer certificate (`3b1ee9f3…`) all matched the
installed app, so it was an upgrade and no application data was cleared; the
shop's existing rows were still present afterwards. The bytes on the device
after installing hash `6239d705…`, identical to the verified EAS artifact.

The fixture is a **synthetic** product, `ZZFEFOProbe / Testgeneric / TestMfr`,
built through CSV import — which is not premium-gated and, unlike the restock
form, was reachable on this Free shop. Three batches under **one** medicine:

| Batch | Expiry | Inserted | Opening qty |
|---|---|---|---|
| `FEFO-A` | 2026-12-15 (43 d) | 1st | 5 |
| `FEFO-B` | 2027-06-30 (240 d) | 2nd | 20 |
| `FEFO-C` | 2026-11-20 (18 d) | **3rd, last** | 7 |

`FEFO-C` is deliberately the **last inserted** and holds the **middle**
quantity, which excludes insertion order, quantity order and name-tie order at
once. The earlier Case 6 claim failed exactly because that control was missing.

**It does not exclude everything, and the status is qualified accordingly.**
Independent review found a fourth variable the fixture leaves open: **batch id
order**. The batch ids were never recorded, so an allocator that sorted by id
ascending would reproduce every number below if the ids happened to sort
C < A < B — a 1-in-6 coincidence, not a negligible one. The reviewer executed
that counterexample successfully. What closes it is source, not this device
run: `domain/fefo.ts:55` compares the real `expiryDate`, and `db/sales.ts:578`
is what checkout allocates through. So these three checks are **observed
behaviour plus source inspection**, not device-conclusive on their own. The
device-only way to close it is to repeat with the expiry order changed while
the batch ids stay fixed.

The midnight countdown change (below) likewise shows the displayed value is
recomputed; it does not by itself prove which field the ordering reads.

- **6.2** — the batch table ordered 18 / 43 / 240 days, and the medicine-level
  expiry moved 43 → 18 when `FEFO-C` was added and back 18 → 43 once it was
  drained. Separately, the sale list read 75 and 406 days at 23:56 and 74 and
  405 days at 00:02 **in the same running app**, so the day-count is recomputed
  at read time rather than stored.
- **6.3** — selling 1 took `FEFO-C` 7 → 6 and left `FEFO-A` (5) and `FEFO-B`
  (20) untouched. Total 32 → 31.
- **6.4** — selling 8 drained `FEFO-C` 6 → 0 and took the remaining 2 from
  `FEFO-A` 5 → 3, leaving `FEFO-B` at 20. Total 31 → 23. The active badge then
  moved to `FEFO-A`.
- **Offline leg** — with Wi-Fi and mobile data off (`Active default network:
  none`, ping unreachable; the IMS network was left up so calls still arrive) a
  further sale of 1 completed and took `FEFO-A` 3 → 2, **skipping** the
  zero-stock `FEFO-C` rather than selecting it. On reconnect the totals read
  ৳30.00 across 3 transactions (৳3 + ৳24 + ৳3) and the sync-conflict screen
  reported none. That last point is still the **client's own** assertion —
  without a DEV service-role read, server-side arrival remains unconfirmed, the
  same limit as checks 3.2–3.5.

Invoices: `INV-2026-000003-7A79D60F5116`, `INV-2026-000004-0D1D6F31208F`,
`INV-2026-000005-20D6BC5F06AA`. The synthetic product and these three sales are
still in the shop — see §6.

## 3. Why each NOT RUN is not a software defect

| Checks | Blocker |
|---|---|
| 1.1–1.3 | Requires registering a second owner, i.e. signing out of the only configured test shop. Those credentials are the founder's. |
| 2.1–2.3 | Requires a second physical handset. One is attached. |
| 4.1 | ~~Requires a sale dated to a previous business day.~~ **Retired 2026-11-03**: a real midnight boundary passed between sessions, leaving sales dated 2026-11-01 and 2026-11-02 refundable from 2026-11-03. No clock was altered. |
| 5.2–5.3 | ~~Same clock limitation.~~ **Retired 2026-11-03** by the same real rollover: the shop carried a 2026-11-02 drawer of ৳93.00 into a new business day. |
| 6.3–6.4 | **Closed 2026-11-02** — see §2.1. |

## 4. Caveat on the six that did pass

Checks 3.2–3.5 are marked *client-side*. Every observation came from the device's
own store; no DEV credential was available, so it was never confirmed that either
sale reached the hosted database, nor that it arrived once. "The queue drains
once" is shown for the **local** queue only. Settling it needs a service-role
read of DEV.

Check 3.5 is additionally weaker than its name suggests: the app was force-stopped
2.5 s after the radios were re-enabled, and nothing was captured proving a request
was in flight at that instant. The defensible claim is restart recovery, not
mid-flight interruption.

Check 6.2's **original** device evidence was wrong: the sale list is ordered
`ORDER BY m.name COLLATE NOCASE, m.id`, so the order observed on 2026-11-01 was
a tiebreak on `m.id`, not FEFO. Recorded in the 2026-11-01 `DECISIONS.md` entry.
It was re-run on 2026-11-02 against a purpose-built fixture and now passes on
the qualified basis set out in §2.1 — device-observed plus source-verified,
with batch-id order the one variable the fixture does not exclude.

## 5. Build status for checks 6.3 and 6.4

The restocking correction is `9ed99b4` (CI `41313642939`, success). A Preview
build carrying it exists and is verified:

| | |
|---|---|
| EAS build | `47c9f0aa-34e9-4655-a24e-31af8dfcbed3` |
| Commit | `9ed99b4fc457d96458dea2d9ac355b5008a58e38` |
| Status | FINISHED |
| Size | 215,951,244 bytes |
| sha256 | `6239d705335b8799db5462c786248fdf47a0cc430461e318fc68c618774ac61d` |
| Validator | `Mobile environment validation PASS` (archive + identity), exit 0 |

**Installed 2026-11-02** on SM-A047F (Android 14, arm64-v8a), in place over the
previous build, with no data cleared. Provenance was re-established end to end
rather than assumed:

| Check | Result |
|---|---|
| Downloaded artifact sha256 | `6239d705…`, 215,951,244 bytes |
| Package / versionCode | `com.muthoy.pos.preview` / 1 — same as installed |
| Signer cert sha256 | `3b1ee9f3…` — **identical** on both, so an in-place upgrade |
| Bytes on device after install | `6239d705…` — **matches the artifact** |
| Local schema change `fdbe8c3…9ed99b4` | none, so the existing shop DB stays compatible |

Case 6 is closed on the qualified basis set out in §2.1 — not
unconditionally. As a by-product, the APK pulled off the device *before*
installing hashed `686350b7…`, byte-identical to the stored `ffab3562`
artifact from `fdbe8c3` — which independently re-confirms the §1 baseline
rather than relying on the earlier session's record of it.

---

## 6. What this run found, and what is still sitting in the shop

Two defects, both in the **restock** path that `9ed99b4` added. The existing
unit suite did not catch either, because both are about what the owner reads
rather than what the database does, and nothing asserted on the rendered
message. That is a gap in the suite, not a limit of it — an earlier draft of
this section said no unit suite "could have" caught them, which overstated it:
the fix below is pinned by exactly such a mapper-level unit test.

**A. A blocked owner is told to "try again" forever.** `PlanAccessError` was in
no map in `i18n/display.ts`. On the device, a Free owner restocking got "Could
not save the medicine. Please try again." — an invitation to retry something
that can never succeed, with no mention of the plan, while that same shop's
Home screen was showing a trial-expired **Upgrade** banner.

The mapper now reads the error's `feature` discriminant and returns a
plan-specific message, keeping three cases apart: a locked premium feature, a
full staff seat, and a blocked shop write. That third case was a defect in the
**first version of this fix**, caught in review: `commercial_write` is thrown
both for an archived or inactive shop (`db/commercial.ts:305`) and for the
plan's shop-count limit (`:312`), and the first version told both to upgrade —
which cannot un-archive a shop. Pinned by two tests that only pass together.
Mutation, per branch — the two tests do not cover the same feature values, so
the numbers differ: deleting the whole `PlanAccessError` branch kills 2,
swapping the two labels kills 2, and deleting just the `commercial_write`
branch kills 1.

**Only one of those three cases is live in the shipped app.** `staff_limit` is
thrown only by `requireStaffSlot`, and `commercial_write` only by
`requireCommercialWrite`, whose sole caller is `requireStaffSlot`
(`db/commercial.ts:318`); the single path into it, `createStaff` ->
`components/staff/AddStaffModal.tsx:125`, catches at `:142` **without** the
mapper, and `multi_shop` never reaches the mapper either. So the catch-all is
the only branch a user can actually reach today. The three branches are worth
keeping, but this section must not read as three repaired live cases.

**And the catch-all had the worse version of the same defect.** It said
"This needs a Pro or Ultra plan. Upgrade to use it." — false for a **paying**
owner. `effectiveTier` degrades to `free` while `commercialTier` stays paid
whenever the snapshot cannot be trusted: offline past the 30-day verification
ceiling (`domain/entitlements.ts:145`), an invalid snapshot, or no cached
snapshot at all, which `requirePremiumFeature`'s `!entitlement` arm
(`db/commercial.ts:241`) and the fail-closed `readMultiShopContext` (`:249`)
both treat as not entitled. An active Ultra owner then gets told to buy a plan
they already own, at the top tier, when reconnecting is what restores access —
and the app elsewhere already knows better (`state/usePlan.ts:29` has a
separate `unverified` reason; `components/ui/TrialBanner.tsx:50` warns against
exactly this conflation). Both labels now cover the paid case, a wording-pin
test fails in either language if the reconnect clause is dropped, and restoring
the old sentence kills it. The **correct** fix — carrying the entitlement
reason on `PlanAccessError` — edits `db/commercial.ts` and is therefore gated
behind CLAUDE.md rule 10, so it is a founder decision, not done here.

**This fix is not complete, and the limit is specific.** It repairs every
consumer that routes refusals through `userFacingError` — which includes the
restock path observed here and the supplier/purchase screens. It does **not**
reach handlers that never call the mapper. Those still misreport a plan
refusal, and are left as a founder item rather than swept unverified at the end
of this run:

**FIXED on 2026-11-02** — every row below now routes through the mapper; the
table is kept as the record of what each screen used to show. See §7.4.

| Handler | What a blocked user saw before the fix |
|---|---|
| `components/expenses/QuickLogTab.tsx:154` | generic expense-save error (`catch {}` discards the error) |
| `components/expenses/LedgerTab.tsx:76` | generic expense-delete error |
| `app/end-of-day.tsx:67` | **"unknown printer error"** — sends them to check hardware |
| `components/staff/AddStaffModal.tsx:142` | **raw untranslated English** |
| `app/reports/data-export.tsx:39` | **raw untranslated English** |
| `app/reports/monthly-report.tsx:54` | **raw untranslated English** |
| `app/reports/report.tsx:94` (share summary) | **raw untranslated English** |
| `app/reports/report.tsx:102` (CSV download) | **raw untranslated English** |
| `app/end-of-day.tsx:75` (share summary) | **raw untranslated English** |

The multi-shop handlers bypass it too. **Six** of these leak raw English, not
two — an earlier draft of this table listed two and alluded to a third in
prose. The four export rows all sit behind `authorizeExport`, which gates file
export *and* summary share with `requirePremiumFeature(shopId,'export')`
(`services/reportExport.ts:93`), so a plan refusal renders the literal
"Upgrade to Pro or Ultra to use this feature." in English. Those are the worst
of the set: `display.test.ts` already carries a test forbidding exactly that
class of leak into a Bengali UI. Having miscounted this table twice, it is now
written out site by site.

### 7.4 What the fix changed, and the one thing it deliberately did not

All nine sites now route through the mapper, and `DuplicatePhoneError` /
`DuplicatePinError` are mapped by name so Add Staff's whole catch collapses
into one call. End of Day no longer reports a plan refusal as an unknown
printer error. `Refund window` and `Refund window (days)`, hardcoded English
found by reading the running app, are catalogued.

The first attempt was too broad and the suite caught it. Two tests in
`tests/reports-final-fixes.test.tsx` pin that the export and share screens show
a **real** failure verbatim — "disk full", "Owner access only" — so a failure
is never hidden behind fake progress. A blanket catalog fallback threw that
away. `userFacingErrorKeepingDetail` now translates what the mapper knows
(plan refusals included) and keeps the real message when it does not.

**Still open, deliberately:** an unmapped operational error still reaches the
owner in English at those five sites. Translating them means mapping each error
by name, which trades diagnostic detail for translation — a founder decision,
not a mechanical fix.

### 7.5 The suite is flaky under parallel load

Three full runs on this date produced three different failing sets — 6, 16 and
5 failed tests — and **every** failure passed when re-run in isolation, except
the two `reports-final-fixes` cases, which were a real regression and are
fixed. `eas-archive.test.ts` alone takes 130 s and passes 45/45 on its own.
Treat a single red full-suite run as unproven until the named files are re-run
individually; read the `Test Files` line rather than the exit code, because
vitest also exits 1 on a reporter RPC timeout with every test passing.

**B. The manual-entry route for restocking an existing medicine was removed by
`9ed99b4`, and for Staff nothing replaced it.** An earlier draft of this
section claimed Free owners had "no route at all". That was **wrong**, and this
run disproved it in passing: the §2.1 fixture above was built through CSV
import, which carries no premium check, matches on
name+generic+manufacturer and resolves to `add_batch` against the existing
medicine (`db/inventoryImport.ts:142`, `:289`). So a Free **owner** does have a
route.

What is true, and is a regression rather than a gap:

- Before `9ed99b4`, `app/inventory/batches.tsx:88` called `addBatchToMedicine`
  under `inventory_edit` — free, receipt-less, and **staff-eligible**. That
  commit replaced it with Edit Medicine → "Add batch", which posts a supplier
  receipt and is therefore premium-gated and Owner-only.
- `addBatchToMedicine` still exists and still has no production caller; it is
  reachable only from tests. Its rows (`batches`) are outside the server's
  premium set and its premium RLS loop
  (`20260831000000_b4_commercial_platform.sql:429`).
- CSV import is **owner-only** and refuses duplicated identities outright, so
  it is not a workaround for Staff, nor for the very products this defect
  created.
- Trial expiry makes Free the default steady state, which is what this device
  was in.

**Deliberately not fixed here.** The instruction for this run was "Do not treat
Free/Staff restocking as enabled while the hosted contract extension is held",
and restoring the route is the founder's call. The receipt path's premium guard
should stay either way: removing it recreates local-success-then-server-refusal.
`addBatchToMedicine` itself needs **no** held migration — it stages a plain
`batches` insert, not a new operation kind.

A third, smaller consequence of the duplicate-medicine defect surfaced on its
own: CSV import refuses the affected product outright with "medicine match is
ambiguous", because two rows share name+generic+manufacturer. That is also why
CSV import cannot serve as the workaround for products this defect already
split.

## 7. Second run, 2026-11-02: the FEFO confound closed, and a clear executed

### 7.1 FEFO is driven by the expiry date — a controlled swap, not an inference

§2.1 could not exclude batch-id order. This run excluded it by **changing only
the expiry dates**, in place, on the same batch rows.

`app/inventory/edit-batch.tsx` writes through `updateBatch`
(`db/inventory.ts:1151`), which updates the existing row. No batch was deleted
or recreated, so **every batch id, and the insertion order, stayed fixed**.
Batch numbers, unit prices and per-batch quantities also stayed fixed. The
only variable changed was the date.

| Stage | FEFO-C | FEFO-B | FEFO-A | App's selected batch |
|---|---|---|---|---|
| Before | 2026-11-20, qty 0 | 2027-06-30, qty 20 | 2026-12-15, qty 2 | **A** |
| After swapping A and B's dates | 2026-11-20, qty 0 | **2026-12-15**, qty 20 | **2027-06-30**, qty 2 | **B** |

The selection followed the dates. That single flip excludes four explanations
at once:

- **batch id / insertion order** — unchanged by construction;
- **alphabetical batch number** — `FEFO-A` < `FEFO-B`, so it would still pick A;
- **smallest quantity first** — the selected batch went from qty 2 to qty 20;
- **largest quantity first** — excluded by the before state.

Confirmed by real sales, not just the list ordering:

- a sale of 1 took **B 20 → 19**; A stayed at 2 (**6.3**);
- a sale of 20 took **B 19 → 0 then spilled 1 to A 2 → 1** (**6.4**). The
  spill ran B → A, the reverse of both alphabetical and insertion order;
- `FEFO-C`, earliest of all at 18 days but holding 0 stock, was correctly
  skipped throughout;
- the displayed day-count moved with the date (43 → 240 and back), which is
  **6.2**: it is recomputed at read time, not stored.

Two behaviours worth recording as correct-and-deliberate, both observed here:
the checkout refused an over-sell naming the true available figure, and a sale
whose basis had shifted was refused with "price or stock has changed" — it
fails closed and asks for re-confirmation. That guard needed three confirm
presses before it passed, which is a UX wrinkle, not a dead end.

### 7.2 The authorized app-data clear, and what it did and did not establish

The founder authorized clearing `com.muthoy.pos.preview` data on
`RZ8W40HDRMK`. Executed. Production `com.muthoy.pos` and both `h3scratch`
packages were untouched and still installed afterwards; the helper refuses any
package but the Preview one.

**What it established:**

- The clear is effective: relaunch shows the first-run chooser, with no trace
  of the previous owner — no pre-filled phone, no shop name.
- Entering the previous owner's phone goes straight to a returning-owner PIN
  prompt, so the account exists server-side.

**What it did NOT establish, and why — an error of mine.** Authorization step 4
required verifying that re-entry credentials were available. I checked that the
custody file contained an `H5_TEST_PIN` **key** and did not check that it held
a **value**. It is empty, and none of the four stamped DEV OTP accounts matches
that phone. So I cannot sign back in, and **H-11 Part B's recovery measurement
is not complete**. The data is not destroyed — the server recognises the
account, and two forced syncs ran while the device was online — but recovering
it needs the founder's PIN.

**Part B step 11 is independently not performable on this artifact.** It says
"count the outbox before losing it". The release build exposes no sync-queue
depth anywhere in the UI, and `run-as` is unavailable because the build is not
debuggable. So step 14's "the difference must equal exactly the step 11 outbox
count" cannot be evaluated on the accepted build by anyone, regardless of the
credential problem.

**One unexplained observation, recorded as unexplained.** After the first clear,
the shop appeared fully restored — owner, the day's five transactions, all
batches — without a PIN ever being entered. Two deliberate reproductions
(clear → phone → PIN screen → force-stop → relaunch, and the same with a BACK
exit) both returned the first-run screen. It did not reproduce, so **this is
not reported as an authentication bypass**; it is an anomaly that needs a
debuggable build and logs to diagnose, and it is the second reason to want one.

### 7.3 The foreground guard earned its place

An ADB foreground-package guard ran before every automated interaction. When a
BACK press dropped the app to the Samsung launcher, the guard **refused** the
next tap rather than sending it to a home-screen icon — the Truecaller-class
incident, prevented automatically rather than noticed afterwards.

## 8. Third run, 2026-11-03

### 8.1 Opening cash across a real midnight boundary (5.1, 5.2, 5.3 — PASS)

No clock was altered and the device was never rooted. A genuine business-day
boundary passed between the 2026-11-02 and 2026-11-03 sessions, which is the
one thing these three checks needed and the one thing a session cannot
manufacture.

| Observation | Value |
|---|---|
| 2026-11-02 closing drawer | ৳93.00, 5 transactions |
| 2026-11-03 on open | sales ৳0.00, **0 transactions**, drawer **৳0.00** |
| Prompt shown unprompted | "আজকে ড্রয়ারে কত টাকা দিয়ে দোকান শুরু করছেন?" |
| After setting ৳500 | drawer **৳500.00** |

Yesterday's ৳93.00 was **not** inherited (5.3), the default before any entry
was zero (5.1), and the owner could set it (5.2) — CLAUDE.md rule 5 in full.

As a by-product the expiry day-counts stepped 74/405/240 -> 73/404/239 across
the same boundary, which re-proves rule 3's "recompute at read time" against a
real date change rather than against a single reading.

### 8.2 Refund accounting (4.1) — the contradiction, and the contract

The check as originally written said a refund "lands in that day's period",
meaning the original sale's day. **That wording was wrong**, and it
contradicted this product's own architecture.

Observed on device: refunding INV-2026-000002, a **2026-11-01** sale of
৳9.00, posted -৳9.00 to the **2026-11-03** period and moved that day's drawer
৳500.00 -> ৳491.00. Stock returned correctly to the originating batch
(FEFO-EARLY 44 -> 47). The original sale row was not rewritten; it is still
dated 2026-11-01 and simply shows as ফেরত.

That is what the code does (`db/refunds.ts:251` takes
`dhakaBusinessDate(new Date())`) and what
`muthoy-batch-3-gate-7-handoff-2026-10-30.md:87` already stated as
architecture: *"refunds are bucketed by their own business date"*, a property
that handoff relies on to argue a month is final only once every device has
synced.

**Agreed contract, recorded here as the single source of truth:**

- a refund is recorded on its **own** processing business date;
- the **original sale stays on its original business date** and is never
  rewritten;
- the cash drawer therefore falls on the day the money physically leaves.

The check row above is reworded to that contract and passes. Nothing in the
code changed.

**One presentation issue is left open, deliberately.** With the contract above,
2026-11-03 displays *"today's sales -৳9.00"* alongside *"0 transactions"*.
Sales and refunds are being summed into one figure, so a day with no sales
reads as negative sales. Separating a day's sales count from its refunds, and
from refund-net sales, is a change to money presentation and therefore needs a
scoped CLAUDE.md rule 10 plan and approval before any edit. It is recorded, not
taken.

### 8.3 The 2026-11-02 restoration, reconciled as far as the evidence allows

The founder has confirmed logging into Preview personally on **2026-11-03**,
which explains the shop being present at the start of this session. That part
is closed.

It does **not** explain the 2026-11-02 observation, which sat inside a
five-minute window of this session's own ADB activity: clear -> first-run ->
phone entered -> PIN pad left empty -> app backgrounded to the launcher ->
relaunch -> fully populated shop.

Everything testable is excluded. `recoverDatabaseFromServer` takes
`(phone, pin)` and proves credentials with the server as its first
state-changing step, pinned by `sync/databaseRecovery.test.ts:65,88`;
`allowBackup=false` is confirmed in the **installed** APK's manifest alongside
explicit `fullBackupContent` and `dataExtractionRules`; the session lives in
MMKV holding only shop/user/role and is wiped by `pm clear`; there is no
`expo-secure-store` anywhere. Two deliberate reproductions - one force-stop
variant, one BACK variant - both returned first-run.

**No bypass mechanism has been identified, and none is claimed.** The precise
residual concern is narrow: one unattributable, unreproducible restoration.

**Why it cannot be settled retrospectively, which is itself worth fixing:**
`audit_logs` records settings-shaped actions (`pin_changed`, `sale_voided`,
`discount_given`) and **does not record logins or session establishment**. The
device therefore holds no timestamp evidence either way. An auditable
login/session event would have closed this in one query.

### 8.4 The eight CI skips, identified

Both are environment-conditional and intentional; neither is a coverage gap
that can be closed by enabling the test unconditionally.

| Where | Count | Gate | Why CI skips |
|---|---|---|---|
| `tests/eas-archive.test.ts:213-306` | **7** | `describe.skipIf(!pinnedEas)` | Needs the EAS CLI installed at **exactly** `PINNED_EAS_CLI_VERSION` = `21.8.0` (`scripts/validate-mobile-environment.mjs:14`), resolved from `$EAS_CLI_PATH`, a local `require.resolve('eas-cli/bin/run')`, or `%APPDATA%/npm/...`. `eas-cli` is **not** a workspace dependency, so `pnpm install --frozen-lockfile` never provides it. These tests drive EAS's own copy/workflow code; without the pinned CLI they would test nothing. |
| `pgtest/h9-environment-parity.pgtest.ts:460-462` | **1** | runtime `server_version_num < 170000` | CI runs PostgreSQL 16; migration 32 requires 17+. Correctly recorded as a `skipReason` rather than passing silently. |

Actionable only by provisioning the environment (a pinned EAS CLI, a PG17
service). Enabling either unconditionally would fake coverage.

### Left in the shop, for the founder to remove or keep

Nothing was deleted, because deleting is the founder's call:

- medicine `ZZFEFOProbe` with batches `FEFO-A` (**2**), `FEFO-B` (20),
  `FEFO-C` (0) — 2, not 3: the offline sale took `FEFO-A` 3 → 2, which an
  earlier draft of this list failed to carry through
- three cash sales totalling ৳30.00 — `INV-2026-000003…`, `…000004…`,
  `…000005…`, all dated 2026-11-02
- a CSV file at `/sdcard/Download/fefo-probe.csv` (not used in the end — the
  import screen takes pasted text, not a file)

Also observed, outside this scope and **not** investigated: an expiry
notification for `FEFO-C` timestamped 2026-11-01 18:14, before that batch
existed; and a cash-summary notification for 2026-11-01 reading an expected
drawer of **৳-82.00**, which may simply be yesterday's COD purchases exceeding
cash sales against an opening of 0. Neither is claimed as a defect.

## 9. Fourth run, 2026-11-03: H-11 Part B, and two corrections

### 9.1 Part B is BLOCKED, and two of my own claims about why were wrong

The 2026-11-03 Part B attempt ended at a refusal, correctly reported as BLOCKED
rather than PASS: no recovery assertion was exercised and no outbox depth was
measured. That verdict stands. The *explanation* given for it did not.

Independent review put the contract plainly: a truly new Owner and shop with no
prior `device_enrollment_holds` row should not need a second device for its
first enrolment. That is right, and the code says so.

The refusal path is exact and traceable:

`recoverPin.ts:159` -> `prepareInstallationEnrollment` (`deviceBinding.ts:82`)
-> `a23_prepare_enrollment` -> `{allowed:false, held:true}` ->
`enrollmentFailure("MU070")` -> `device_enrollment_held` -> `otp-verify.tsx:42`
-> `authErrorEnrollmentHeld`.

`held` is true only when a hold row exists for `(shop_id, actor_user_id)`. With
no hold row and a device id present, `a23_prepare_enrollment` returns
`allowed: true`. Hold rows are inserted in exactly two places, both deliberate
administrative revocations: `a23_revoke_binding` and `a23_revoke_device`.
Nothing in registration, login, PIN recovery or app-data clearing writes one,
and `onboarding.ts` never calls the enrolment gate at all.

So the gate fired because that DEV identity already carried a hold from earlier
A2.3 testing. It is **not** the general rule for new enrolment, and the earlier
report's generalisation of it was wrong.

### 9.2 Two withdrawn claims

**Withdrawn: "all four stamped DEV accounts are already registered."** Three of
the four were probed by typing the number into Owner Login and observing the
PIN pad appear. That proves nothing. `handlePhoneNext`
(`app/(auth)/device-login.tsx:68`) runs a local Zod check and calls
`setStep('pin')` with **no server call**; the screen's own comment says the
"no account for this number" answer was deliberately not copied from the
prototype, for anti-enumeration. The PIN pad appears for any well-formed
number. A UI transition was reported as a server fact.

**Withdrawn: the "log in again" screen meant "already registered."** That
screen (`pb-08`) is `pin-login.tsx`, identified by its eyebrow
`pinLoginEyebrow` / "দোকানে প্রবেশ" — the local PIN pad that `app/index.tsx`
routes to when local rows exist without a session. No server
`phone_already_registered` response was ever captured.

The `...104` PIN-reset refusal is also now explained rather than mysterious:
`recoverPin`'s `RECOVERY_REFUSED` is deliberately one code for "no such owner",
"not an owner" and "not the number this session proved". There is no account on
that number, so refusing was correct.

### 9.3 Read-only DEV identity inventory, 2026-11-03

Run against DEV `btfprhticjgeihcngpif` with the existing admin service-role key.
Read-only: `GET /rest/v1/...` only, zero writes, no enrolment function called.
Numbers masked to their last three digits; no ids or records reproduced.

| stamped slot | `users` row exists |
|---|---|
| ...101 | yes |
| ...102 | **no — free** |
| ...103 | yes |
| ...104 | **no — free** |

Two of the four are unused. The premise that no identity was available was
false.

**The enrolment holds themselves could not be inventoried, and that is correct
behaviour.** All five A2.3 registry tables answer `403 / SQLSTATE 42501` to the
service role, because `20260923000000_a23_device_registry.sql:329-333` revokes
them from `public, anon, authenticated, service_role`. They are reachable only
through `SECURITY DEFINER` functions. So `...101`'s hold is inferred from the
`MU070` refusal — which is sound, since `MU070` is unreachable without one —
and not read directly.

H-5's server-side data was confirmed intact in the same pass: owner row active,
not deleted, shop present, 7 sales rows server-side. The device clear never put
it at risk.

### 9.4 Account enumeration: assessed, none found

Reviewed without further probing. The login and recovery paths are deliberately
non-enumerating, and the evidence is in the code, not in a claim:

- `deviceLogin.ts` returns one `GENERIC_FAILURE` for unknown phone and wrong
  PIN alike, compares against a `DUMMY_HASH` when no user is found so the
  bcrypt timing does not differ, and uses the *same* message for the phone
  rate-limit branch specifically so a lockout cannot confirm an account.
- `recoverPin.ts` collapses every disqualifying case into one
  `RECOVERY_REFUSED`.
- The phone step makes no server call at all.

The one response that does distinguish is `MU043` ->
`409 phone_already_registered` at registration. It is not an enumeration
oracle: `bindOnboardingOwnerPhone` refuses unless the OTP-verified phone
matches the number being registered, so a caller can only test numbers whose
SMS they can already receive.

**Severity: none / informational.** No change recommended.

### 9.5 Retained finding: logout does not unbind the device

Signing out returns to a PIN pad bound to the previous owner, with only
"forgot PIN" as a route onward. The only on-device way to a different owner is
clearing app data. Recorded as product behaviour, not a defect.

### 9.6 What Part B still needs

One OTP on an unused identity. Registration is a single OTP:
`register.tsx:35` `sendOtp` -> `otp-verify` `verifyOtp` -> shop created ->
`pin-setup`. A new shop has no hold, so the gate that blocked the last attempt
is not on this path.

The separate production concern this surfaced — a sole Owner who revokes their
only installation — is written up for independent review in
`a23-single-owner-device-recovery-concern-2026-11-03.md`. It does not block
Part B.

## 10. H-11 Part B executed 2026-11-04 — NOT PASS

The drill ran end to end under the founder's scoped approval. It is still
**NOT PASS**, and the reason is mine: `backend/supabase/checks/restore_drill.md`
specifies Part B precisely in steps 10-16, and I did not read it before
executing. I improvised a drill instead of running the prescribed one.

### 10.1 What the specification requires, and what this run did

| Step | Required | This run |
|---|---|---|
| 10 | offline cash sale, credit sale, stock adjustment, expense | two cash sales only |
| 11 | read the `sync_queue` row count -- "the number Part B exists to measure" | not read |
| 12 | clear app data | done |
| 13 | wall clock from LAUNCH to usable dashboard | measured from Owner Login tap |
| 14 | per-table counts vs step 10's DEVICE state; difference must equal step 11 exactly | compared server-to-server |
| 15 | `SUM(inventory_movements.change_qty)` per batch = `batches.stock`; seven-term drawer vs server | not done -- those tables are 403 to the admin service role |
| 16 | H-4 budget, pull cursor, printer pairing, locale, business-day state reset; shop id unchanged; no previous owner's data | not done |

Step 11 is the decisive one. The founder's standing instruction was not to
substitute for actual queue counts; I did not estimate, but I did substitute a
different quantity (unsynced sale headers) and argued the substitution was
acceptable. The specification says the queue count is the point of the
exercise. The authorized clear is now spent, so this run's pre-clear queue
count is unrecoverable.

### 10.2 What the run did legitimately establish

These stand on their own and are worth keeping:

- **Cloud recovery works at the level measured.** Five quantities predicted
  before the clear all matched after it: 1 transaction, Tk 50.00, stock 98,
  drawer Tk 50.00, and exactly 2 sales (Tk 100.00) lost.
- **The clear mutated no cloud state.** All four readable server tables were
  byte-identical before and after (`shops` 4730660e1f52, `roles` 12d61992a9d1,
  `sales` cfb708afd4c4, `users` c8c15b44fe0a).
- **The founder's `linkDevice.ts` correction is confirmed by execution.** Fresh
  onboarding does invoke `prepareInstallationEnrollment` at
  `linkDevice.ts:128`, after `onboardOwner` creates the Owner row. It returned
  allowed and registration completed. The gate is on the path, not absent.
- **The clear guard held.** It refused `com.muthoy.pos` by name before
  clearing `com.muthoy.pos.preview` once; all four packages remained installed.
- **The cash formula is correct in practice.** `cashFormula.ts:26` is
  Opening + CashSales + CreditCollections - Expenses - Refunds -
  SupplierPayments - Withdrawals. Observed: 1000 + 150 - 1000 = 150 pre-clear,
  1000 + 50 - 1000 = 50 post-recovery. The Tk 1,000 debit is the batch bought
  Cash on Delivery (100 x Tk 10).

Independent review's caution on the last two points is accepted: a net drawer
figure cannot prove its components were recovered, because 0 + 50 - 0 also
equals 50. Those are consistency checks, not recovery proofs.

### 10.3 What Part B now needs

The blocking requirement is a way to read `sync_queue` on the device. On a
release build it cannot be read: no UI surfaces it, `allowBackup=false`
(`AndroidManifest.xml:18`), and `run-as` rejects non-debuggable packages. So
Part B needs **a debuggable build** -- the same dependency that blocks Part C.

Then, in one run: the full step-10 workload, the step-11 count, a second
authorized clear, device-side per-table counts both sides of it, the step-15
ledger reconciliation, and the step-16 local-reset checks. Server-side reads of
`inventory_movements`, `batches` and the cash tables also need a credential
that can see them; the admin service-role key cannot.

---

## 11. Unblock preparation, 2026-11-04 — §10.3's diagnosis was incomplete

Full design, evidence and approval gates:
[`b3-partb-partc-unblock-prep-2026-11-04.md`](b3-partb-partc-unblock-prep-2026-11-04.md).
Part B remains **NOT PASS**. Three corrections to the section above.

**"Part B needs a debuggable build" is necessary but NOT sufficient.** The
device database is SQLCipher-encrypted, and
`modules/muthoy-db-key/android/src/main/java/com/muthoy/dbkey/MuthoyDbKeyModule.kt`
wraps the key with an AndroidKeyStore key that **cannot be exported**. `run-as`
on a debuggable build can read the wrapped blob, the IV and the `.db` file, and
none of it can be decrypted off the device. So no shell or PC route to
`sync_queue` exists at any privilege level short of rooting the handset. The
census must run **inside the app process**, which means new instrumentation, not
just a different build. That is now the blocker for both Parts B and C.

**Steps 11 and 14 cannot both be satisfied as written.** Step 11's number counts
*queue rows*; step 14's is a difference of *business-table row counts*. One
one-item cash sale produces 5-6 queue rows against 4-5 business rows
(`db/sales.ts:685-692`), and `update`/`delete` operations produce a queue row
while changing no count at all. The total queue count is also not loss:
`sent` rows are never purged (`db/sync-helpers.ts:1804-1809`; the only
production delete is the conflict path at `db/conflicts.ts:362-383`), so the
lost quantity is `pending + failed`. A corrected, satisfiable interpretation is
proposed in §1.3 of the prep document and needs approval before
`restore_drill.md` is touched.

**The server-side credential gap has a least-privilege answer that needs no new
capability.** `backend/supabase/checks/restore_baseline.sql` already fingerprints
`batches`, `cash_drawer`, `credits`, `expenses`, `inventory_movements`,
`sale_items`, `sale_refunds` and `sales`, and
`backend/supabase/checks/ledger_invariant.sql:29` already computes
`batches.stock` against `sum(inventory_movements.change_qty)`. Both are
SELECT-only and safe to re-run. They need a database session, whose password is
the founder's by this project's own rule — so this is a founder-executed step,
not a widened grant.

The build itself turned out not to be the hard part: it is zero-cost, local, and
needs no environment-policy change or new application ID. See §2 and §3 of the
prep document.
