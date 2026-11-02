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
| 4.1 | A refund for a sale from another day lands in that day's period | §3.3 case 4 | NOT RUN |
| 5.1 | Opening cash defaults to 0 | CLAUDE.md r5 | **PASS** |
| 5.2 | The user can set opening cash | CLAUDE.md r5 | NOT RUN |
| 5.3 | It resets at midnight and never inherits yesterday | CLAUDE.md r5 | NOT RUN |
| 6.1 | The expiry day-count is correct for the day it is read | CLAUDE.md r3 | **PASS** |
| 6.2 | Ordering uses the real expiry date, not a stored day-count | CLAUDE.md r3 | **PASS** (2026-11-02) † |
| 6.3 | The earliest-expiring batch **within one medicine** is selected | CLAUDE.md r3 | **PASS** (2026-11-02) † |
| 6.4 | A sale larger than one batch spills to the next by expiry | CLAUDE.md r3 | **PASS** (2026-11-02) † |

**11 PASS, 9 NOT RUN.** (An earlier draft of this line said 10 and 10, which
did not match the rows above it.)

† Qualified, not device-conclusive on their own — see §2.1. Batch-UUID order
was never excluded as a confound, so these three rest on observed device
behaviour **plus** source inspection. Read the † before quoting the PASS.

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
| 4.1 | Requires a sale dated to a **previous business day**. Sales history was empty at the start of the run, and the device clock is not settable without root — which is prohibited. |
| 5.2–5.3 | Same clock limitation: no day boundary can be crossed, and this shop has no prior-day cash session to inherit from. |
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

| Handler | What a blocked user sees today |
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
