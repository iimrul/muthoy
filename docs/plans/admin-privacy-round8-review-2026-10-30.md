# Independent Round 8 review — ef08537

Base: `ef085374e2591e4aa904e0750ac9ba44c756d820`.
Reviewed: `git diff 0f6398e..ef08537`, full commit account, nullable-field
consumers, card provenance, all admin refund reads and their dependent surfaces.
Verdict: **ACCEPT**. No material finding confirmed in the reviewed scope.

## FINDINGS

None material. No third production admin refund reader found. No additional
Dashboard over-withholding found.

## WHAT CHANGED

Added only this review and `scripts/review/admin-privacy-round8.cjs`.
No production implementation changed. Existing unrelated working-tree changes
were preserved. No commit, push or hosted action performed.

Suggested evidence commit:
`docs(review): record round 8 refund gating acceptance`.

## WHAT WAS CHECKED AND FOUND SOUND

- **Null remains absence.** `getPlatformStats` returns `refundsToday: null`
  and `netSalesToday: null` while refund reads are disabled
  (`lib/queries.ts:224` and `:238`). Source search across apps/packages found
  only the Dashboard consumption: `NetSalesCard` and the composition line.
  Neither field enters an API JSON response, chart point or export. Both
  components are server components; Dashboard chart props are independently
  derived operational counts. Instrumented money formatting observed no null
  or undefined argument. The withheld card shows neither gross, net nor zero.
- **Reordered provenance guard holds.** Across both allowed metric IDs,
  16 forged/absent values and three withholding settings produced **96**
  renders. With `withheld: true`, every forgery rendered a dash without an
  alert, authenticity check, amount unwrap or money formatting. With false
  or omitted withholding, every forgery produced the provenance alert and
  no unwrap/format call. Cases include numbers, strings, null, undefined,
  copied/cloned/proxied authentic boxes, a forged amount getter and hostile
  coercion/serialization methods. Authentic 80.00 and negative -10.00 still
  render normally. An invalid metric ID still rejects while withheld.
- **Rows, COUNT and tally share the gate.** A transport that rejects every
  attempted `sale_refunds` read was never reached by Dashboard, all six
  report definitions, Analytics, Revenue, CSV/PDF GET, shop detail or shop
  audit readers. Sales rows and their exact count are still read. A sales
  count/page mismatch still raises `ReportCompletenessError`.
- **Previous cap and race reproductions are closed.** With 100,001 known
  eligible September sources and a legal 31-day refund-window fixture,
  moving October 30 refunds from 100,000 to 100,001 left actual Dashboard
  SSR identical before, after and on repeat. Every source/count pair agrees;
  there is no concurrent write. The earlier mid-refund-read insertion hook
  is unreachable because no refund query runs. A settled single refund also
  leaves the entire Dashboard unchanged.
- **Other surfaces stay stable.** Adding a prior-month source's full refund
  left the four page renderings, both download responses (including headers
  and bodies), shop detail output and shop audit output identical. CSV/PDF
  GET both return 200. Default report building and the internal
  `{ revisionSafe: true }` option both keep unread money withheld; neither
  publishes gross as net. HTTP `revisionSafe=true` does not change policy.
- **No third reader.** Independent source audit examined admin table/RPC
  calls and production refund references. The only direct readers are
  `getPlatformStats` (`lib/queries.ts:164` and `:198`) and
  `platformReportData` (`lib/adminPlatformQueries.ts:1294` and `:1305`).
  Analytics/Revenue inherit the latter through `analyticsOverview`.
  Shop drill-down reads sale counts, with no refund query; shop audit
  excludes `sale_refunded` from both rows and COUNT and does not select raw
  metadata. Export routing cannot supply a publication-policy override.
- **No new count over-withholding.** All **25** combinations of 0/1/4/5/10
  sellers and 0/1/4/5/10 refunders preserved the sale-floor decision: zero,
  five and ten sellers remain visible; one and four remain withheld.
  Refund activity never changes that decision or causes a page alert.
  Activity report rows retain their sale counts.
- **Dormant branch is non-vacuous.** An in-memory-only policy override
  exercises refund rows and COUNT, returns 10,000 refund paisa and authentic
  40,000 net paisa against 50,000 gross, and renders their correct composition.
  The policy is restored afterward. This control does not establish immutable
  publication or authorize enabling it.
- **Provenance pin remains exact.** Inspected the changed literal conditional
  pin and assignment-shape check. Neither was broadened to arbitrary
  conditionals. These source guards were inspected, not executed as a suite.
- **E4 manifest:** no drift.

## EXECUTION AND LIMITS

Commands actually run:

- `node scripts/review/admin-privacy-round8.cjs` — final exit 0,
  **832 in-memory read queries**; independently rerun by the review agent,
  also exit 0 with 832 reads.
- `node --check scripts/review/admin-privacy-round8.cjs` — exit 0.
- `git diff --check 0f6398e..ef08537` — exit 0.
- `node scripts/e4-evidence-manifest.mjs --check` — exit 0, no drift.
- Read-only git/source inspection.

The probe reuses only Round 3's memory transport, TypeScript loader and cleanup;
previous rounds' assertions do not execute. Production readers, builders,
serializers, export handler and server components execute. Authorization,
settings, Supabase transport, Next Link and client chart loading are substituted;
network requests throw. Shop detail/audit checks exercise reader outputs,
not their complete page rendering. Early probe runs corrected fixture column
order and an expected currency prefix; neither was a production failure.

No Vitest or repository suite, lint, tsc or build was run by this review.
The supplied gate results remain the author's measurements; **two parties
did not measure the suite**. No real database, RLS, hosted, browser or device
validation is claimed. E15 acceptance remains outstanding.

ROUND 8: ACCEPT ef08537
