# Independent Round 6 review — bc0be16

Base: `bc0be16c314801c54da1ee57661418802749886d`.
Reviewed: full `git diff 46663e1..bc0be16`, commit account, integrated readers,
report/export/SSR boundaries, money classification and other string outputs.
Verdict: **REVISE**.

Evidence: `node scripts/review/admin-privacy-round6.cjs` — exit 0, **902 memory
read queries**. Assertions reproduce findings and controls; this is not a
Vitest or repository-suite result. No Vitest runtime, hosted request,
credential, database, deployment or device operation. The script reuses only
Round 3's memory transport, TypeScript loader and cleanup; old checks do not run.
Production readers/builders/serializers/export GET/server components execute
unchanged. Permissions, settings, Supabase transport, Next Link and client chart
loading are substituted. Network requests throw. An independent review agent
also inspected and executed the probe, confirming its observations.

## Findings

### HIGH | apps/admin/lib/adminReports.ts:145 | A generic refusal still discloses protected refunds

**The residual remains HIGH.** There are fixtures that attribute it to refunds,
and a deterministic cap fixture needs no concurrent write at all.

The net report's dependency list is `['sales']`
(`adminPlatformQueries.ts:1128`). That branch reads sales and refunds, but
**never shops**. Shops therefore cannot explain a failure of this report.
Public completion audit and sale-count controls can also exclude new sales.

Small race reproduction:

1. One known September sale, 8,000 paisa. No October sales or refunds. Public
   shop evidence is zero sales today and one lifetime completion audit entry.
2. Successful whole-October SSR and CSV/PDF omit the month entirely.
3. Insert the full October refund after its real count returns zero and before
   its real page read. The report page announces incompleteness; CSV/PDF return
   409. Their messages contain neither table names nor digits, as intended.
4. Both public sale controls remain unchanged; the completion audit excludes
   refunds. After the read settles, all four pages and both exports again equal
   their pre-refund outputs exactly.

Removing attribution text does not remove the observable protected-only
success/failure transition in this otherwise constrained fixture.

Stronger deterministic reproduction at the actual, unmodified cap:

1. One shop has a known complete set of **100,001 September source sales**,
   corroborated by its completion-audit count. The September 29 source is its
   sole sale that day, 8,000 paisa, so its amount may be remembered from the
   historical per-shop gross disclosure. The other sources are September 30
   sales. No October sales exist.
2. Exactly 100,000 distinct sources have full October refunds. The production
   reader returns matching counts/pages: sales `0/0`, refunds
   `100000/100000`. The net export returns 200 with no month row.
3. Refund the remaining September 29 sale in full. Now both reads remain
   complete and consistent: sales `0/0`, refunds `100001/100001`. The same
   export returns 409, and a repeated request still returns 409. Its body says
   `Narrow the date range.` Public sale evidence is unchanged.
4. With sales far below the known cap and shops not queried, the cap refusal
   identifies the refund source. Given the complete eligible source set,
   more than 100,000 refunds out of 100,001 possible unique full refunds means
   **every source was refunded**, including the known 8,000-paisa sale.

Uniqueness and full amounts match the actual product rules: migration
`20260821010000_phase_b2_sales_inventory_sync.sql:158` has
`unique(shop_id, sale_id)`, its line 996 checks refund/source total equality,
and mobile `db/refunds.ts:411` assigns `totalAmount: sale.total`. The probe
also asserts distinct sources and exact amount equality. It does not claim
to submit these fixtures to a real database.

**Closure without an incomplete financial answer:** under the shipped
`PUBLICATION_IS_REVISION_SAFE = false` policy, no net amount is publishable.
Read and verify the public sales-derived row shape, retain withheld money
cells, and avoid reading/tallying protected refund inputs that cannot affect
any permitted output. Represent unread inputs explicitly so they cannot later
be interpreted as zero refunds when publication becomes possible. Preserve
completeness enforcement for every input actually used in a published value.
A consistent snapshot or retry can address the race, but cannot address the
deterministic cap channel by itself. No hosted apply is needed for this
interim, withheld-output path.

### MEDIUM | apps/admin/lib/adminPlatformQueries.ts:1273 | Unused refunds can refuse a complete activity report

`activity_summary` needs shops and sales (`:1127`). Its builder
(`adminReports.ts:1108`) never consumes refunds. Nevertheless the shared
`needed.includes('sales')` branch also reads and tallies `sale_refunds`.

Reproduction: five shops register and sell on October 20; the complete activity
row is `['2026-10-20', '5', '5']`. One shop also has a September sale.
Insert its October refund between the refund count/page reads. The activity
CSV returns **409**, although both inputs used for its two published counts
are complete. Once the refund read settles, the exact same 5/5 row returns.

This is over-withholding of an operational report for an input its builder
does not use. Separate refund dependencies from sales dependencies; this
report needs no refund read or refund tally.

### LOW | apps/admin/app/reports/page.tsx:265 | The report-level money test styles an existing count column as money

`hasMoneyColumn` correctly identifies reports containing money, but
`hasMoneyColumn && cellIndex > 0` treats every value column in those reports
as money. `subscription_revenue_and_renewals` has both an amount and a
`Verified payments` count.

Reproduction: one verified 12,345-paisa order renders **both** `123.45` and the
count `1` with `font-mono tabular-nums`. CLAUDE rule 6 requires the count to use
the normal number font. Identify money per column. There is no current wrong
withholding tooltip in this mixed report: its platform-billing count never
suppresses, so that conditional is not reached for it.

## What changed

Added only:

- `scripts/review/admin-privacy-round6.cjs`
- `docs/plans/admin-privacy-round6-review-2026-10-30.md`

No production implementation changed. Existing unrelated changes preserved.
Suggested evidence commit: `docs(review): record round 6 refund refusal oracle`.

## Checked and found sound

- Changed completeness messages contain no digits or source table names;
  detailed counts/table remain in server logs. No server-log-to-response path
  was found for those details.
- Stable protected-only omission: all four pages, CSV/PDF bodies and headers,
  row count and suppression count are exactly unchanged after a settled refund.
- The export URL cannot override the revision policy.
- Corrected net chart note/cell tooltip and net report tooltip use the revision
  explanation. Count chart/report tooltips retain the k-floor explanation.
- All existing chart callers classify money/count correctly. Both money
  reports and all four nonmoney reports are identified correctly at report
  level; the mixed-column font defect is listed separately above.
- E4 manifest check reports no drift.
- Refund audit redaction covers both count and page; raw shop audit `meta` is
  unselected. General errors use fixed display text. Filenames depend on parsed
  request parameters, and page metadata is static. No additional protected-data
  string disclosure was confirmed in the inspected routes, captions,
  tooltips, aria labels, export headers or audit paths.
- Registration suppression differs between Analytics and Dashboard/reports.
  The original Analytics plan's blanket floor conflicts with the newer metric
  document's registration exemption; this is not counted as an unambiguous
  implementation finding.

Commands actually run: Node probe above; `node --check
scripts/review/admin-privacy-round6.cjs`; `git diff --check
46663e1..bc0be16`; `node scripts/e4-evidence-manifest.mjs --check`; scoped final
diff/working-tree checks. No Vitest, repository
suite, lint, tsc or Next build was executed in this round. Supplied gate counts
remain the author's measurements. Hosted/browser/device acceptance remains
outside this local review.

ROUND 6: REVISE
