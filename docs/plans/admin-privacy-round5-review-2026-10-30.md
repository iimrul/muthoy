# Independent Round 5 review — 46663e1

Base: `46663e1097d480ca0b424095af082e16e3287b5e`.
Reviewed: `git diff 6547710..46663e1`, commit account, integrated output paths.
Verdict: **REVISE**.

Evidence: `node scripts/review/admin-privacy-round5.cjs`, exit 0, 576 in-memory
read queries. Assertions reproduce defects and controls; this is **not a Vitest
or repository-suite result**. No Vitest import/runtime runs. The independent
review agent also ran this script and confirmed its findings.

The script reuses only Round 3's memory transport/TypeScript loader and cleanup;
older checks do not run. Actual readers, report builders, CSV/PDF export GET,
serializers and server components execute. Authorization, settings, Supabase
transport, Link and client chart loading are substituted. Network access is
forbidden inside the probe. Full refunds equal distinct source sales. The
concurrent-write reproduction inserts a real fixture row between the two actual
reader calls; it does not forge a count, page or error response.

## Findings

### R5-1 — HIGH | apps/admin/lib/adminReports.ts:130 | Completeness errors disclose omitted refunds

The normal successful omission is now complete in the checked surfaces. Its
error path still publishes the protected source count before omission runs.

`adminPlatformQueries.ts:979-985` awaits an exact count, then independently
pages the source. A pharmacy syncing a refund between those reads produces a
real mismatch. `assertCompleteRead` formats the source table and exact counts
into its exception. `app/reports/page.tsx:83` forwards the exception text to
SSR, and `app/api/reports/export/route.ts:115` appends it to the HTTP 409 body.

Reproduction using unchanged production modules:

1. One known September 30 sale of 8,000 paisa; no October sales or refunds.
2. Whole-October report/export: no rows, no withholding count, HTTP 200.
3. During another read, the refund count returns 0. Before the page read, the
   pharmacy syncs that sale's full October 20 refund. The page returns 1 row.
4. The report page publishes `sale_refunds read 1 of 0 rows`. Both CSV and PDF
   requests return HTTP 409 with:

   ```text
   The export was not produced because the read could not be proved complete. sale_refunds read 1 of 0 rows. The export is incomplete and has not been produced.
   ```

5. Repeat after sync settles: all four successful pages and both export bodies
   and headers again exactly equal the pre-refund outputs.

The error announces precisely the refund that successful output omits. With one
remembered eligible sale, its full **8,000-paisa refund** follows; mobile
`db/refunds.ts:411` sets `totalAmount: sale.total`. The probe reproduces the
interleaving separately for SSR, CSV and PDF, with three genuine 0/1 mismatches.
No false tally or partial-data response was injected.

Required: protected source counts must stay out of public diagnostics, and
protected-only updates must not turn a stable omitted answer into an observable
success/error transition. Generic text alone leaves the 200-to-409 channel.
Keep completeness enforcement for data that would actually be published; do
not solve this by silently exporting incomplete publishable data. A consistent
read/retry strategy or avoiding irrelevant protected reads under the withholding
policy needs separate implementation review.

### R5-2 — LOW | apps/admin/components/charts/ChartPanel.tsx:120 | The net chart's cell tooltip still reaches the floor sentence

Actual Analytics SSR, ten sellers and five refunders on October 20: all k/day
floors clear. The report with `revisionSafe: true` answers `500.00`; the shipped
policy withholds it. The chart's note now correctly says immutable snapshots,
but the same cell still has the literal tooltip:

```text
Withheld: fewer than five pharmacies contributed.
```

This is the same false reason Round 4 finding 4 sought to eliminate, one output
within the chart panel later. The new helper never controls this tooltip. It is
fixed text, so no refund-dependent sentence oracle was demonstrated here.

Required: use the actual money withholding reason for the money cell as well
as its note.

### R5-3 — LOW | apps/admin/components/charts/ChartPanel.tsx:84; apps/admin/app/reports/page.tsx:273 | The money reason is now incorrectly applied to nonmoney counts

Both generic renderers unconditionally use `moneyWithholdingReason` for
withheld cells/notes. The helper correctly selects a constant sentence, but
revision suppression applies only to pharmacy money. Count-only charts and
reports reach k suppression without consulting revision safety.

Actual reproduction under the unchanged false revision policy:

- One selling pharmacy: the Analytics sales-volume chart's note blames offline
  revision and immutable snapshots; the plan-distribution report's blank count
  gets that same tooltip. Independent review also reproduced the active-count
  chart's incorrect note.
- Five selling pharmacies: the chart and report both publish `5` with no
  immutable snapshots, under the same publication policy.

The stated reason is therefore false: k alone withholds these counts. This is a
new regression from generalizing the money explanation to generic renderers.
No additional data withholding or confidential disclosure was demonstrated by
the wording itself.

Required: choose the withholding reason by the metric/cell's actual policy.
Keep nonmoney floor reasons while using the revision reason on pharmacy money.

## What changed

Added only:

- `scripts/review/admin-privacy-round5.cjs`
- `docs/plans/admin-privacy-round5-review-2026-10-30.md`

No production fixes, schema/security changes, commits, pushes, hosted calls,
sealed-artifact changes or changes to existing dirty paths.

## Checked and sound

- On consistent reads, a new refund-only October month changes none of the
  Dashboard, Revenue, Analytics or Reports HTML. CSV and PDF response bodies and
  headers are byte-identical. The CSV remains 402 bytes; PDF remains 1,050 bytes,
  one page; report rows and withholding count stay zero. No successful route
  `meta.rowCount` is emitted. Raw source tallies stay internal on success.
- The revised floor path likewise omits the one-refunder month without
  incrementing its tally. The revision path counts surviving public buckets.
- A zero-paisa sale retains October's withheld row and chart label. At the
  shipped policy, removing/adding refunds leaves successful public output
  unchanged. Independent review checked all 16 seller/refunder combinations
  from `{0,1,4,5}`: `saleCount > 0` exactly matches sales-backed month existence;
  refund-only months disappear from both regions. No current predicate-related
  over-withholding demonstrated.
- `moneyWithholdingReason` itself reads only the module constant, and its
  sentence does not depend on protected data. Dashboard, Revenue composition
  and report-money tooltip correctly cite revision safety. The chart-note
  money explanation is correct; the two generic-renderer errors are above.
- **All five requested floor negatives now exercise the floor.** AST inspection
  confirms literal `revisionSafe: true` on each build call. The Node probe
  extracts their actual setup/helper/callback AST bodies and uses a small
  `node:assert` adapter; it never imports Vitest. All assertions hold against
  production. Bypassing the entire k/day stage in an in-memory module causes
  **each of the five** to throw an assertion failure:

  | Build line | Negative |
  |---|---|
  | 286 | Money below k |
  | 310 | k sellers, one refunder |
  | 360 | 100 rows, one shop |
  | 1200 | Sales only, protected zero refunds |
  | 1238 | One refunding pharmacy anywhere in month |

  This is a five-assertion mutation probe, not a test-runner result or a claim
  about whole-suite mutation survival.
- An export `revisionSafe=true` query parameter cannot override the shipped
  policy. Actual route output stays withheld.
- No other material finding established in the reviewed Round 5 diff and
  correlated Batch 3 paths. Hosted immutable publication remains the previously
  recorded unresolved blocker, not an implementation completed by this review.

## Commands and limits

- `node --check scripts/review/admin-privacy-round5.cjs` — exit 0.
- `node scripts/review/admin-privacy-round5.cjs` — exit 0; 576 memory reads.
- `git diff --check 6547710..46663e1` — exit 0.
- `git diff --check` — exit 0; existing checkout CRLF warnings only.

Independent reviewer also completed additional Node predicate/wording controls
(637 memory reads) before reviewing and rerunning the shared reproduction.
No Vitest, compiler, lint, build, backend/RLS, hosted or physical-device
validation ran. The user-supplied suite/build measurements remain the author's
measurements. Browser/deployed E15 and hosted snapshot behavior remain unverified.

Suggested artifact-only commit: `test(admin): record round 5 privacy review`.

ROUND 5: REVISE
