# Independent Round 4 review — 6547710

Base: `65477104c50594a3710986295f65af5f41d565b9`.
Reviewed: `git diff 01a9947..6547710`, commit account, integrated output paths.
Verdict: **REVISE**.

Evidence: `node scripts/review/admin-privacy-round4.cjs`, exit 0, 777 in-memory
read queries. This is an independent Node probe, **not a Vitest result**.
Assertions reproduce defects as well as controls; exit 0 does not mean acceptance.
The script reuses only the prior script's transport/TS-loader prelude and cleanup.
The Round 3 assertions are not run. Actual readers, builders, serializers,
CSV/PDF GET handler and server components run. Supabase transport, authorization,
settings, Link and client chart loader are substituted. Full refunds equal
their distinct source sales. No backend acceptance, RLS, hosted or device claim.

## Findings

### R4-1 — HIGH | apps/admin/lib/adminReports.ts:880 | Omitted refund-only buckets still change the published withholding tally

The revision branch filters rows into `publishable`, but returns
`suppressedBuckets: rows.length` from the pre-filter set. The floor branch also
increments `suppressedBuckets` before skipping the refund-only row at lines
940–943. Line 1300 puts that count in the subtitle. The screen, CSV notes and
PDF subtitle publish it.

Actual reproduction with the shipped policy and actual export GET:

1. One pharmacy, one September 30 sale of 8,000 paisa, gross remembered from
   before Option B; one completion in the intact audit. No October sales.
2. Whole-October report: no data rows, zero suppressed buckets, subtitle includes
   `0 rows` and has no `1 withheld`.
3. Fully refund that sale on October 20.
4. Repeat: still no data rows and `0 rows`, but now **`(1 withheld)`** appears
   in the page, CSV and PDF. Both export responses return HTTP 200.

The omitted bucket is observable through its tally. With no October sales and
one eligible prior sale, that transition identifies the full **8,000-paisa
refund**. Current shop detail and the redacted audit page/count are unchanged.
The same 0-to-1 tally transition occurs with `revisionSafe: true` on the floor
path. The new row-omission regression asserts only row arrays, so misses it.

Required: apply refund-independent shape to all public metadata, including the
withholding tally and its presence/absence. Count surviving public buckets only,
or use an independently defined calendar/unavailable state consistently.

### R4-2 — HIGH | apps/admin/app/analytics/page.tsx:223 | Analytics still publishes refund-only month labels in TWO regions

`analyticsOverview` creates months from sales plus refunds at
`lib/adminPlatformQueries.ts:867`. The net series maps all of those months;
`NetSalesTrend` retains labels and counts withheld buckets. The sales-volume
series at `analytics/page.tsx:189` independently uses the same month list and
retains the same refund-only label, despite counting only sale rows.

On the same one-sale fixture, actual October Analytics SSR changes:

- Net region: empty series to **`2026-10 —`**, plus `1 bucket was withheld`.
- Volume region: empty series to **`2026-10 —`**, plus `1 bucket was withheld`.

No October sale occurred. Either region announces a refund and reconstructs the
same remembered 8,000-paisa full refund, under the unchanged false revision
policy. Fixing just the money series leaves the volume region as a publisher.

Required: make both regions' keys, row counts, empty states and withholding
counts independent of suppressed refunds. Preserve raw input records.

### R4-3 — MEDIUM | apps/admin/lib/adminReports.test.ts:360 | Three negative floor regressions still stop before the floor

The two edited negative tests now explicitly enable `revisionSafe`. Three
previously identified negative tests still omit it:

| Build call | Test subject |
|---|---|
| line 360 | MANY ROWS from ONE shop |
| line 1196 | Sales-only month / protected zero refunds |
| line 1230 | One refunding pharmacy anywhere in a month |

AST inspection confirms all three call `buildReportTable` with only three
arguments. They return from global revision refusal before exercising the
distinct-contributor/day floor they claim to test.

The Node probe bypasses the entire k/day stage in an in-memory copy of the
report module. One hundred sales of 150,000 paisa from one shop still export
blank by default; with `revisionSafe: true`, the broken copy exports
**150000.00 BDT**. The unchanged negative assertion is masked. Other updated
tests would detect this broad mutation; **no claim is made that the whole suite
survives it**.

The test at line 1297 named "by DEFAULT" also still calls only `build(true)`
and `build(false)`, not an omitted-option build. The actual default was checked
separately in Node.

Required: remove unrelated global refusal from negative floor tests; keep
explicit default-policy tests separately. Use controls which also clear other
floor predicates when testing one particular floor.

### R4-4 — LOW | apps/admin/app/revenue/page.tsx:411 | The one-reason fix reaches only Dashboard

Ten sellers and five same-day refunders clear every floor. The real builder
with `revisionSafe: true` publishes 500.00 BDT; the shipped default withholds.
Actual SSR still says:

- Revenue composition: `Withheld: fewer than five pharmacies contributed`.
- Analytics money-region note and tooltip: fewer than five contributed
  (`components/charts/ChartPanel.tsx:82/:115`).
- Report withheld-cell tooltip: `Withheld: fewer than five contributors.`
  (`app/reports/page.tsx:271`), despite the revision reason in the subtitle.

These are false reasons when all floors clear. Their fixed wording does not
recreate Dashboard's old threshold-dependent sentence oracle; the metadata
channels above are separate. Required: carry the actual refusal reason through
all four surfaces, including notes, composition and tooltips.

## What changed

Only these review artifacts were added:

- `scripts/review/admin-privacy-round4.cjs`
- `docs/plans/admin-privacy-round4-review-2026-10-30.md`

No production, schema, sync, money implementation, sealed artifact, H-9 file,
commit or push. Existing dirty/untracked files remain untouched.

## What checked out

- **Flag trust, current code:** `AggregateRow` is internal; the sole pharmacy
  money builder derives `existsWithoutRefunds` from the filtered sales list.
  It does not copy a caller-supplied flag. No current builder was found missing
  a required flag. The five other builders use `undefined` and keep existing
  behavior. The optional default is an extension risk, not a reproduced current
  bypass by an external reader.
- **Report row fix:** refund-only rows really disappear on the shipped and
  floor paths. Sales-backed months retain explicit withholding. The remaining
  report disclosure is its count/caption, not a failure of the row filter.
- **Omission transitions:** with sales fixed, toggling refunds in a sales-backed
  month leaves report rows/subtitle and both Analytics regions identical under
  the shipped policy. A sale arriving in a previously refund-only month creates
  a sales-backed row whether or not the refund exists; that transition alone
  reveals already approved sale activity. Present/absent shape must still be
  checked on every surface, as R4-1/R4-2 demonstrate.
- **Dashboard:** 25 SSR fixtures crossing seller counts 0/1/4/5/10 with
  refunder counts 0/1/4/5/10. Money note and composition consistently state the
  revision policy. For a fixed seller set, both money and active-count sections
  are identical across all refund variations. Counts show at five or more
  sellers, withhold one through four, and show zero for the empty sale side.
- **Seller-count threat:** no additional refund or monetary equation found
  while all pharmacy money is withheld. Approved per-shop sale counts and
  completion histories already expose sale activity. This is bounded review,
  not an anonymity proof against arbitrary external knowledge.
- **Both-sides rule:** 25 helper combinations agree between `dayReleasable`
  and `daysReleasable([day])`; empty month and quiet day pass; refund-only one
  fails; refund-only five passes; duplicate IDs cannot satisfy the floor.
  No new unsupported over-withholding was demonstrated under the accepted
  conservative policy and retained historical disclosures.
- **Numeric publication:** a floor-clearing month publishes only with the
  explicit in-process override; the real export URL parameter cannot enable it.
- **Billing framing:** one verified order still publishes 123.45 BDT and count
  1, joined to Pharmacy 1. The report reads only `payment_orders`; exactly one
  definition is exempt. This identifies billing membership but supplies no
  pharmacy sales/refund equation. The operational-money framing is sound;
  founder resolution of the separate small-billing-cohort criterion remains
  distinct. No production re-flooring performed.

## Execution and limits

- `node scripts/review/admin-privacy-round4.cjs` — exit 0; 777 memory reads;
  live defect reproductions and controls above.
- `node scripts/e4-evidence-manifest.mjs --check` — exit 0; no drift.
- `git diff --check 01a9947..6547710` — exit 0.
- `git diff --check` — exit 0; existing CRLF checkout warnings only.

The initial probe stopped on an incorrect fixture heading, corrected to the
actual `Pharmacy sales volume, by month`; the completed rerun is the evidence
above. No Vitest, compiler, lint, build, hosted operation or physical-device
validation was run. The supplied full-suite measurements remain the author's
measurements. Hosted publication snapshots/integration are still unresolved;
this review neither implements nor enables them.

Suggested artifact-only commit: `test(admin): record round 4 privacy review`.

ROUND 4: REVISE
