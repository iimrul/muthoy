# Independent Round 3 review — 01a9947

Base: `01a99472aecdc0adad035df05ff7ba19f30bb8dd`.
Reviewed: `git diff 7115604..01a9947` and the integrated production paths.
Verdict: **REVISE**.

Evidence: `node scripts/review/admin-privacy-round3.cjs`, exit 0, 226 memory
reads. These are independent Node probes, including reproductions of defects;
this is **not** a Vitest result. TypeScript is transpiled in memory. Actual
readers, builders, serializers, report export handler and server components
run; Supabase transport, SSR authorization/settings, Link and the client chart
loader are substituted. No hosted request, credential, real database or device.
Full-refund fixtures use distinct source sales with exactly matching amounts.
Backend acceptance/security is not asserted by this transport.

Only the review script and this document were added. No production change,
migration, sealed artifact, commit or push. Existing dirty files are untouched.

## Findings

### R3-1 — HIGH | apps/admin/lib/adminReports.ts:1124 | Withholding the cell still publishes the refund-only bucket

The month list is derived from sales **and refunds**, before suppression.
`suppressRows` at line 853 replaces money cells but preserves month keys, row
counts and the existence of rows. Those are financial publishers too.

Reproduction through the shipped default and the actual report CSV GET:

1. The platform has one pharmacy, newly registered in September, with one
   completed September 30 sale. The attacker remembers its previously published
   gross, 8,000 paisa. Its complete one-entry sale-completion audit establishes
   the sole sale. There are no October sales.
2. Read the whole-October report: no data rows.
3. That sale is fully refunded on October 20. The per-shop audit continues to
   show just the original completion, because the refund action is redacted.
   Today's sale count remains zero.
4. Repeat the report: `[['2026-10', '']]`. Both CSV requests return HTTP 200.
   A blank October row has appeared. No October sales exist, so the row proves
   a refund occurred. There is exactly one eligible sale, and a refund is full:
   the pharmacy refunded **8,000 paisa**.

`PUBLICATION_IS_REVISION_SAFE` remains false throughout. No override, numeric
cell, current gross card or refund audit row is needed. Analytics also derives
its month keys from the combined inputs, so this shape issue needs attention
across output paths, not just the CSV writer.

Required: while revision-sensitive money is unavailable, make its observable
shape independent of confidential refund activity. A fixed unavailable state
or independently determined calendar shape must cover month keys, row counts,
withheld counts, captions and exports. Dropping only a numeric field is not
sufficient. Preserve the raw records.

### R3-2 — HIGH | apps/admin/app/page.tsx:205 | The changing withholding reason is a historical refund oracle

The active-count tile publishes the refund-side predicate even though the
revision policy withholds the amount for everyone. With fewer than five
refunders it says "fewer than five pharmacies recorded a refund"; at five it
says "immutable snapshots" instead.

Reproduction: five newly registered pharmacies each have one completed sale
on the cutover business date. The observer remembers their gross amounts from
before Option B: 100, 200, 400, 800 and 1,600 paisa. Registration and complete
sale-completion histories bound the candidate universe to these five sole
sales. Four shops refund. Read the active tile; it gives the refund-floor
reason. The fifth refunds. Read it again; it gives the revision reason. The
sale counts, shop-detail result and redacted audit result do not change.

The new reason proves at least five distinct refunders. Only five pharmacies
and five eligible sales exist. Therefore all five refunded their sole sales:
each exact amount is recovered, including the newly arrived **1,600 paisa**.
The amount card is blank in both observations.

Required: the global revision refusal must not branch its public explanation
on private refund activity. Use a stable revision reason and gate the activity
count on its own approved activity policy. Correct the money-card composition
at line 339 as well. Removing the sale count alone would not close the leak:
the retained completion audit and remembered disclosures also bound candidates.

### R3-3 — MEDIUM | apps/admin/lib/adminSuppression.ts:182 | No-sale days bypass the refund floor; day/month rules disagree

`refundSideReleasable` returns true whenever the sales list is empty, including
nonempty refund lists. Actual results:

| Sellers | Refunders | dayReleasable | daysReleasable([day]) | withheldSide |
|---|---|---|---|---|
| 0 | 1 | true | true | null |
| 1 | 5 | false | true | sale |

Refunds against earlier sales are valid here. In the production report builder
with `revisionSafe: true`, five October 20 sellers and five October 20 refunders
publish 457.00. One extra, full 7.00 refund on October 21, with no sales that
day, changes the same report to 450.00. The second day passes the helper despite
having one refunder. The default global refusal currently blocks these numeric
amounts; it does not repair the floor. R3-1 is a separate live metadata leak.

Required: distinguish both-sides-empty from sale-side-empty. Nonempty refunds
still need their own distinct-contributor floor. Reconcile day and month
policies explicitly now that sale amounts are no longer public. Keep a real
quiet-day positive control. A snapshot must not make this broken floor safe
merely by setting the revision flag.

### R3-4 — MEDIUM | apps/admin/app/page.tsx:272 | Every active-today count is over-withheld

`netTodayWithheld` includes `!PUBLICATION_IS_REVISION_SAFE`, and the count uses
that money verdict. The constant is false, so this tile can never show a
count, even with ten sellers and five refunders. The actual activity report
for that fixture shows **10**; the Dashboard tile shows an em dash and cites
immutable financial snapshots. This contradicts Decision 2's money-only scope
and removes legitimate support functionality.

Required: give the count its own seller/contributor verdict. Do not simply
remove all its existing activity protections. The source assertions in
`netSalesProvenance.test.tsx:693` and `:755` currently pin this coupling and
need to change with the implementation.

### R3-5 — MEDIUM | apps/admin/lib/adminReports.test.ts:296 | Negative floor regressions can pass without any floor

The positive money-floor tests pass `revisionSafe: true`, but negative cases
at lines 281, 296, 345, 1165 and 1204 omit it. They return at the earlier
revision-policy block, before the k/side stage.

The Node probe compiles an in-memory copy that bypasses the entire k/side
stage after the revision block. The five-seller/one-refunder negative fixture
still produces an empty default cell. With `revisionSafe: true` it wrongly
publishes 400.00. The positive tests would also keep publishing under this
mutation. Thus pairing those current tests does not detect the removed stage.

Also, the test named "by DEFAULT" at line 1221 calls only `build(true)` and
`build(false)`, both passing an explicit option. It does not exercise omission
of the option. Actual default withholding was independently checked by Node.

Required: negative floor fixtures must reach the floor, with controls that
clear unrelated policies. Keep separate tests for the actual omitted-option
default. Add production-output regressions for the row-existence and caption
attacks. The retained suite does not demonstrate that all historical inference
attacks remain closed.

### R3-6 — MEDIUM (stated cohort criterion) | apps/admin/lib/adminReports.ts:838 | The billing exemption also publishes a one-pharmacy billing cohort

The report's monetary derivation is sound: it reads only `payment_orders`,
not sales/refunds. But the brief separately says identification of a small
pharmacy cohort disqualifies the classification. It does not meet that test.

Reproduction: one verified 123.45 payment yields `['2026-10', '123.45', '1']`.
The actual payment reader labels that account "Pharmacy 1". The account reader
maps the same account to that pharmacy's primary-shop ID. The monthly payment
cohort is therefore the one named pharmacy. This is **billing membership**, not
an inferred pharmacy sales, refunds or net amount; those amounts do not follow
from a fixed subscription charge.

Under the brief's literal criterion, exempting the entire mixed report is
misclassified. The boundary must explicitly permit already identified billing
cohorts or consistently protect them across the corresponding detail and
aggregate surfaces. Reinstating a floor only on this report cannot hide a
cohort that `/payments` already names. Nor would blanking just "Verified
payments" suffice when the total and known fixed tariff imply the count.

### R3-7 — LOW | apps/admin/app/page.tsx:339 | The new policy is displayed as a floor failure that did not happen

Ten sellers and five refunders clear both floors, yet the actual Dashboard
composition says fewer than five pharmacies recorded a refund. Analytics'
ChartPanel note/tooltip says fewer than five contributed; Revenue at line 411
also says fewer than five contributed. The report cell tooltip at
`app/reports/page.tsx:271` says fewer than five contributors even when its
subtitle correctly identifies revision withholding.

Required: carry the actual refusal reason through each renderer. The shared
predicate does not fix a caption that still reconstructs its own reason.
R3-2 separately explains why some reason transitions disclose private data.

## Three verdicts on the successor migration

1. **YES, locally implementable without changing sealed H-9 evidence.** The
   35-version lineage and both H-9 baseline hashes check out. E4 demonstrates
   that baseline checks can remain byte-identical while a successor describes
   the new chain. A hash-recorded E4 artifact is not automatically an immutable
   H-9 baseline artifact. However, the proposed file inventory is incomplete:
   `e4-chain-succession.pgtest.ts:53` passes the full `migrationFiles()` into
   the 35-version check; adding migration 36 makes its "accepts the live
   35-version chain" assertion false. Production preflight at
   `scripts/h9-prod-preflight.mjs:290`, environment-parity tail assertions and
   rollback tests also pin the current chain. They need deliberate successor
   scoping/updates and refreshed generated evidence. A new check plus one
   unrecorded test is insufficient. Preserve the old migrations, sealed SQL,
   H-9 pins and local `audit-artifacts/**` throughout.
2. **NO to the blanket claim that building locally has no value yet.** An
   unapplied migration has no hosted runtime effect; that fact is correct.
   Local implementation can still establish compatibility, least privilege,
   immutability, concurrent-publisher behavior and late-sync behavior before
   anyone authorizes a hosted operation. That is concrete value and fits the
   founder's bounded local authorization. A candidate should contain an
   append-only publication ledger keyed by canonical period/metric/policy,
   atomic once-only publication with concurrency control, immutable payload
   and withholding decisions, explicit source cutoff/as-of semantics, integer
   paisa constraints, explicit FK deletion policies where applicable, RLS and
   explicit grants denying API writers and panel mutation, plus successor
   checks and local adverse tests. All money views must compose the same
   approved publication cells. Late rows must not revise a released cell or
   create an independently differencable overlapping release. Historical
   gross knowledge and previously withheld periods remain binding. A table
   alone is not this mechanism. No candidate exists here to certify its
   security/impact, so this review does not implement or approve one.
3. **PARTLY: suppression now is right; hosted apply is not the only blocker.**
   The missing work is a jointly reviewed, locally verified publication
   mechanism, integration that actually reads its releases, closure of the
   output side channels above, and separately authorized hosted application
   and validation. Applying an empty snapshot table would not complete those
   requirements. Do not enable the revision flag on that basis.

## Sound checks by decision

| Decision | What checked out |
|---|---|
| 1 | The gross tile, view field and returned computation are removed. `getShopDetail` returns a sale count without a money field. A positive sale count alone does not determine a nonzero amount: the unknown prices/totals still have multiple solutions. Status, tier, staff, location and last-sync metadata supply no deterministic price equation. Counts/completion histories do constrain candidate sets, which R3-1/R3-2 exploit with remembered gross. Support notes remain free text and can contain amounts entered by a human; this is not a structural guarantee that arbitrary note text contains no money. |
| 1, audit | Actual `shopAuditPage` filters refund actions before both the page and exact count. The Node fixture includes the raw refund audit row; it remains stored but does not appear or affect the count. No log deletion/rewrite. |
| 1, surface sweep | `/pharmacies`, `/accounts`, `/accounts/[id]` and maps emit no computed pharmacy money. `/payments` and `/subscriptions` emit platform billing prices/orders. All six report definitions were checked: only the refund-net report uses pharmacy money. Report CSV/PDF use the same builder/default; the separate audit export reads platform `admin_audit_log`, not per-shop `audit_logs`. No additional computed pharmacy-money detail field found. |
| 1, history | The diff does not relax a pharmacy-money suppression rule to release old figures after gross removal. The remaining leaks are metadata/reason releases, not a newly rendered historical numeric cell. |
| 2 | All four specified numeric surfaces consult the false revision policy. The production report builder call omits the override. The actual GET ignores a `revisionSafe=true` URL parameter, and CSV/PDF contain withheld cells. Report identities and opaque-cell provenance remain enforced. |
| 3 | Ten sellers/zero refunders are refused by the helper; both-sides-empty remains releasable. Contributor IDs are deduplicated. These valid cases do not cover refund-only days or the monthly sale-side disagreement. |
| 4 | Exactly one report is exempt. `subscriptions` and `plan_distribution` retain their floors; the latter retains the real status-complement rule. Payment totals come from verified billing orders and do not algebraically determine pharmacy takings. The extra no-small-cohort condition fails as described above. |

## Required regression mapping

These are source/production-path assessments, not claims that Vitest ran.

| Regression | Existing test/path and result of review |
|---|---|
| Correlated shop refund audit | `adminRoutes.contract.test.tsx:1191`, "the per-shop read EXCLUDES refund actions, in the page AND the count", invokes the real page/reader and asserts both query predicates. Its recording transport does not execute filters; the new Node fixture executes them with a planted refund row and proves unchanged audit count/result. The unrelated metadata leaks remain. |
| 30-minute idle | `middleware.test.ts:158` issues a real session 31 minutes ago; `:176` separately asserts `idle` versus `malformed`. Real middleware and verifier are used. Node also verifies the valid old payload yields `idle`. |
| BOM then quoted first field | `adminReports.test.ts:1128`, "a withheld CSV says so IN THE FILE, and still parses", calls the actual writer/parser. Its comma-bearing first note makes the file begin BOM + quote. Node asserts those leading bytes and directly parses a BOM/quoted-comma fixture. |
| Financial substitution/output sinks | `netSalesProvenance.test.tsx` round 9 runtime card overwrite, round 10 chart/export calls, round 11 opaque-cell verification, and `adminReports.test.ts:1486/:1530/:1550` handler-row, identity and appended-column substitutions still call real guards/serializers. Some page-interface checks are static source checks. Node additionally exercises public-row `map` replacement and frozen definition columns against actual output. Do not claim every round 14/15 attack has its own retained Vitest reproduction; the floor negatives identified in R3-5 are masked. |
| Cross-page/historical inference | `adminReports.test.ts:1046` uses the real builder with the override and asserts actual 480.00 equality in wider windows. The status-complement tests at `:1596` remain active on non-money reports. These do not cover temporal reason changes or refund-only bucket existence; the new Node probes reproduce both live leaks. The old `admin-privacy-round1b.cjs` asserts the old gross/release behavior and is historical evidence, not a current green regression runner. |

## Execution and limits

- `node scripts/review/admin-privacy-round3.cjs` — exit 0; 226 memory reads;
  reproductions and controls above.
- `node scripts/e4-evidence-manifest.mjs --check` — exit 0; no drift.
- `git diff --check` — exit 0; existing CRLF checkout warnings only.
- `git diff --check 7115604..01a9947` — exit 0.
- Local Node byte-hash/manifest-key/whitespace probe — exit 0; both H-9
  baseline byte hashes unchanged, 35 migrations, 48 recorded keys, the
  evidence-manifest test unrecorded and chain-succession test recorded.
- No Vitest, TypeScript compiler, lint, build, hosted SQL or physical-device check.

The supplied timeout/red-run, isolated executions and identical-SHA full rerun
are consistent with load-sensitive timeouts. No source evidence here refutes
that explanation; the cause was not independently measured. Those results
remain the other reviewer's execution evidence, not mine. A green rerun does
not exercise missing/masked assertions or rebut the reproduced disclosures.

Production fixes and their independent execution remain required. No
mathematical anonymity claim, hosted acceptance or device acceptance is made.
Suggested artifact-only commit, if retained:
`test(admin): record round 3 privacy review probes`.

ROUND 3: REVISE
