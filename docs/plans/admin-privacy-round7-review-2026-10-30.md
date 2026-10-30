# Independent Round 7 review — 0f6398e

Base: `0f6398ed5934f572b7cf935c4db6fae914321ba1`.
Reviewed: full `git diff bc0be16..0f6398e`, commit account, report dependencies,
builder options, publication/serialization boundaries, Analytics, Revenue,
Dashboard and the six report definitions. Verdict: **REVISE**.

Evidence: `node scripts/review/admin-privacy-round7.cjs` — exit 0,
**703 in-memory read queries**. An independent review agent also ran the probe
and separately reproduced both Dashboard cases. No Vitest runtime or suite,
hosted request, credential, database, deployment or device operation.

The probe reuses only Round 3's in-memory transport, TypeScript loader and
cleanup; older assertions do not run. Production readers, builders, CSV/PDF
serializers, export GET and server components execute unchanged. Authorization,
settings, Supabase transport, Next Link and client chart loading are substituted.
Network requests throw. This demonstrates local behavior, not database or
browser acceptance.

## FINDINGS

**HIGH | apps/admin/lib/queries.ts:145 | Dashboard still reads protected refunds
while its money is withheld | The same refund-specific refusal oracle survives
on `/`, and its failure removes unrelated counts and alerts.**

The new gate covers `platformReportData`. The Dashboard also calls the separate
`getPlatformStats` (`app/page.tsx:74`). That reader unconditionally pages
`sale_refunds` at `queries.ts:145`, counts it at `:174`, and submits its tally
to `assertCompleteRead` at `:191`. The shared cap is **100,000**, even though
the pager's own cap is 200,000. The page catches the refusal and renders only
an ErrorNotice (`app/page.tsx:123`), before reaching its publication policy.
This is a remaining Batch 3 defect, not a regression introduced by `0f6398e`.

Deterministic reproduction at the actual cap, without a concurrent write:

1. Clock October 30. One shop has a known complete eligible set of 100,001
   September source sales, outside the Dashboard's October 1–30 trend window.
   The sole September 29 source is the remembered 8,000-paisa sale; all others
   are September 30 sources. No October sales exist. The fixture specifies a
   31-day refund window, valid under `shop_b2_settings.max_refund_days >= 0`
   (migration `20260821010000_phase_b2_sales_inventory_sync.sql:67`; the
   window check is at `:723`). This setting is a fixture precondition, not
   an admin read or write performed by the probe.
2. Exactly 100,000 distinct source sales have full October 30 refunds. All
   count/page pairs agree. Actual Dashboard SSR renders the ordinary metrics;
   its pharmacy money is withheld.
3. Refund the remaining 8,000-paisa source in full. The complete refund tally
   becomes 100,001. Dashboard SSR now returns only the generic error, and a
   repeated request returns the same error. Nothing in the error names refunds
   or counts; the observable normal/error transition is the disclosure.
4. Public shop sale-count-today stays zero and its completion-audit count stays
   100,001. The independently queried `dashboardOverview` is exactly unchanged.
   With the known complete eligible set, crossing the cap establishes that
   every source was refunded, including the remembered 8,000-paisa source.

Small race reproduction also succeeds: one known October 19 sale for 8,000
paisa, no October 20 sales/refunds. Insert its full October 20 refund after the
Dashboard's empty refund page resolves but before its count. The count is one,
loaded rows zero, and the Dashboard becomes an error. Once the read settles,
the entire Dashboard HTML again equals its pre-refund HTML. This case uses
the default seven-day refund window.

The same root cause also over-withholds the Dashboard's registration, activity,
subscription and billing figures and its alert list, whose useful inputs are
complete. Avoid reading/tallying refunds that cannot contribute to a published
value while the policy is false; retain all required sales/count checks and
mint withheld money. Better error wording cannot close this channel.

No second material finding confirmed in the inspected scope.

## WHAT CHANGED

Added only this review and `scripts/review/admin-privacy-round7.cjs`.
No production implementation changed; unrelated working-tree files preserved.
Suggested evidence commit: `docs(review): record round 7 dashboard refund oracle`.

## CHECKED AND FOUND SOUND

- The report refund gate reaches the real query layer. All six definitions
  avoid `sale_refunds` while policy is false, including with a transport that
  throws on any attempted refund read. The old report cap fixture now returns
  200 before and after 100,000 → 100,001 refunds, with identical response.
- Unread refunds do not become published zero refunds. Both the default and
  `buildReportTable(..., { revisionSafe: true })` yield minted withheld cells.
  For the option path, each sales-bearing day's empty refund contributor set
  fails `daysReleasable`. A bare empty string fails `netCellText`. A non-vacuous
  fully loaded fixture under the option publishes the correct 400.00 net,
  while the actual unread fixture never publishes its 500.00 gross.
- HTTP `revisionSafe=true` cannot override publication. Actual CSV and PDF GET
  return withheld money and never publish either fixture amount.
- Analytics and Revenue inherit the gate through `analyticsOverview`'s two
  `platformReportData` calls (`adminPlatformQueries.ts:728` and `:729`). Their
  numeric publication checks remain. Actual page rendering succeeds with a
  refund-read bomb; sales-volume count remains five.
- No additional over-withholding from the report gate found. The activity
  report retains its 5/5 sales/registration row and zero withheld buckets.
  Refund-only months remain omitted; sales-bearing month keys, suppression
  counts, subtitles, four normal page renders and CSV/PDF bodies and headers
  remain identical after a settled protected refund.
- `(BDT)` exactly identifies the existing two money columns. All four nonmoney
  definitions have none; both money definitions have only column one. Billing
  amount 123.45 retains DM Mono, while verified-payment count one uses its
  regular font. Definitions and their column arrays remain frozen.
- E4 evidence manifest: no drift.

Commands actually run: the Node probe above; `node --check
scripts/review/admin-privacy-round7.cjs`; `git diff --check bc0be16..0f6398e`;
`node scripts/e4-evidence-manifest.mjs --check`; read-only git/source checks.
No Vitest, repository suite, lint, tsc or build was run. Supplied gate results
remain the author's measurements. Hosted/browser/device E15 acceptance remains
outstanding.

ROUND 7: REVISE
