**Base:** `0f3b40346b2557b709a75f1af53f5a75e8406c08`.
**Verdict:** CLAIM NOT SUPPORTED.

Read-only review of application code. Option A, per-shop gross, and conservative
k=5 remain accepted. No proposal to remove gross or accept refund disclosure.
No application, schema, migration, sync, auth, or money implementation changed.
Existing unrelated working-tree changes were left untouched.

Evidence command: `node scripts/review/admin-privacy-round1b.cjs` — exit 0.
The script transpiles actual TypeScript in memory without esbuild/Vitest, uses
an in-memory Supabase read transport, and exercises actual readers, report
builders, CSV/PDF serializers, and four server-rendered pages. Page permissions,
feature flags, Next Link, and the client chart loader are stubbed for rendering.
No hosted requests, credentials, real database, RLS, or physical device involved.
Fixtures enforce full-refund/source-sale equality; backend acceptance of entire
rows/claims is not asserted. A second agent independently reviewed the source
and evidence, then reran the final script (exit0, 712 memory reads). Its fixture
and denominator corrections were taken. This is evidence review, not acceptance.

**Part One — corrections, before the privacy verdict**

- **C2 sound.** `adminSession.ts:263` preserves `iat` and `exp`. One hundred
  touches with a lastSeen 60 seconds forward leave it exactly 60 seconds
  forward; they cannot repeatedly add skew. Absolute expiry still rejects at
  `now >= exp` before refreshing. Maximum idle allowance can include the
  existing 60-second clock tolerance; this is not a new ratchet. A stolen copy
  that is actively used can refresh until the original absolute expiry, as
  before; another browser touching its copy does not update the stolen bytes.
  Minting 31 minutes ago now reaches `idle`, while lastSeen before iat reaches
  `malformed`. The replacement middleware construction exercises the right rule.
- **C1 LOW is reasonable with the documented host-bound residual.** Accepted
  native fields need at most 2,899 URL-encoded bytes under the server's 64-unit
  username/256-unit password bounds. The harness submits real 4,096/4,097-byte
  bodies: 303/413 respectively. The 413 leaves the source counter unchanged;
  its audit entry has actor `unknown` and source only. No credentials or body.
  The handler checks declared length, not streamed bytes. Omitting it accepts
  the same 4,097-byte body. Invalid/non-finite lengths also miss the predicate;
  acceptance of dishonest HTTP framing by a deployed server was not assumed.
  Native form encoding does not establish a universal Content-Length guarantee
  across all HTTP transports. There is no application byte ceiling on that path.
- **C3 sound cleanup.** The removed argument was unread. The RETIRED comment at
  `adminReports.test.ts:1025` accurately identifies duplicate sales-only-month
  coverage at line 1037. The October-through-September/October equality property
  is appropriate for fixed data. It does not prove that a remembered October
  answer stays safe when stored rows change.
- **C4 containment sound; actionability incomplete.** The username was not found
  flowing into browser props, client configuration, or response bodies. The
  actual converter is `toDisplayMessage`; middleware/login/export failures use
  fixed text. Ordinary matched legacy account configuration hits the earlier
  generic account-parser error instead of the new roles diagnostic; see C4-L.
- No concrete unintended accepted Batch 1/2/3 behavior regression found in the
  production diff, including mobile pending-link/refund-pull/shop-switch changes.
  This is source review, not native/mobile runtime acceptance.
- The two accepted behavior changes are safely implemented on inspection:
  logout verifies signed identity/iat, uses a forward-only cutoff, preserves
  disabled/narrowed assignments, clears the cookie even when revocation fails,
  and distinguishes unconfirmed revocation. Newer cookies survive when their
  iat is strictly later. Username validation is shared with account/revocation
  boundaries and fails closed.

**Part One LOW findings**

| Severity | File:line | Defect and reproduction |
|---|---|---|
| LOW (C1-L) | `apps/admin/lib/adminLogin.test.ts:328` | The test named "at the ceiling" submits **60 bytes**, not 4,096. The preceding "budget untouched" check at line 317 submits one later login; spending 1/30 tokens would still pass. Use actual boundary bytes and inspect the unchanged counter or all remaining attempts. The implementation behaves correctly in the new independent probe. |
| LOW (C4-L) | `apps/admin/lib/adminIdentity.ts:123` | Put `Alice Smith` in both ADMIN_ACCOUNTS and ADMIN_ROLES. `loadAdminIdentity` parses accounts first and throws only `ADMIN_ACCOUNTS has an invalid username` (line 95). Middleware discards the detailed roles exception at `middleware.ts:82`. The normal refusal therefore still fails to name the account in logs. Improve the earlier account error or log the roles error server-side; preserve fixed browser text. |

No contradiction found with the supplied successful suite/build counts. Those
commands were not rerun. C1's claimed test evidence is weaker than its prose;
this does not imply a failing suite or an incorrect runtime budget result.

**Part Two — load-bearing justification**

"Per-shop refunds are published nowhere" is false as an inference claim.
No refund amount column is required: a public sale total plus its full-refund
event reconstructs it. Even without refund-event access, k=5 does not prevent
an exact aggregate from encoding a uniquely decodable subset of known sales.
The rule counts contributors to each answer, not contributors to the difference
between remembered answers. These are three independent gaps.

**Findings — most severe first**

**HIGH | apps/admin/lib/adminSuppression.ts:174 | Five contributors can still
identify every refund | Exact amount constraints defeat cardinality alone.**

Reproduction: ten newly registered shops each make one sale. Before refunds,
read gross/count and the complete one-entry sale-completion history for each:
sale amounts are BDT `1,2,4,8,16,32,64,128,256,512`. Shops 1/3/5/7/9 refund
their respective full sales. Both sale/refund sides clear k; monthly net is
682.00, public gross sums to 1,023.00, and refunds therefore total 341.00.
Among all 1,024 full-sale subsets, **exactly one** totals 341: 1+4+16+64+256.
Every shop's refund, including each zero, is recovered. No post-refund audit
read is needed for this attack. The candidate space is justified by observing
new shops' sole completed sales, not by assuming today's count is lifetime count.

Additional suppression: withhold this exact refund/net answer and its parent
totals whenever published sale constraints uniquely determine a protected
shop's refund. A larger k alone cannot close this example. A value-sensitive
inference check must retain k as a separate necessary condition. Without such
a check, these exact outputs cannot support the proposed mathematical claim.

**HIGH | apps/admin/lib/adminPlatformQueries.ts:1814 | Per-shop audit reveals
a withheld refund | Action, target, and count are money side channels.**

Reproduction: shop A has sole sale X, gross80, count1. Its audit shows
`sale_completed -> X`, later `sale_refunded -> X`. The ordinary audit view
renders both action and target (`app/audit/page.tsx:90`). Mobile
`db/refunds.ts:411` fixes `totalAmount = sale.total`; lines 586-587 record the
targeted refund. Therefore A refunded80, while the monthly report is blank
and the Dashboard withholds its money. The harness reads matching targets and
exact count2. Shop `meta` was never selected; redacting it does not fix this.

Additional suppression: hide refund-related audit events and equivalent
markers from this ordinary read surface **before both paging and exact-count
queries**. Keep the raw append-only log intact. Removing target alone fails
the sole-sale case; hiding rows while counting them still exposes the event.
This closes the audit reproduction, not the separate exact-sum attack above.

**HIGH | apps/admin/lib/adminReports.ts:300 | Whole-month requests return
mutable totals | Repeated/historical answers isolate one new refund.**

Reproduction on October20: five shops each have 90+10 of sales and a full10
refund. A also has an already recorded additional7 sale. Whole-October query
returns457.00. A refunds that7 sale after the first read. Identical query now
returns450.00. Both releases pass: the same five refunders still satisfy the
same day's k. Difference7 is one shop's new refund; the per-shop audit tells
which shop changed. Dashboard refunds likewise change50 ->57 while both
verdicts pass. Future month-end and open bounds are allowed. Late sync into an
already released closed period presents the same problem: no immutable release
or release-history guard exists.

Additional suppression: withhold live refund/net answers; serve one immutable
release per approved period and do not expose silently revised historical
totals. Any revision, overlapping aggregate, or new release must be checked
against **all remembered releases**, suppressing any answer whose difference
isolates a protected contribution. Calendar completion alone does not freeze
offline arrivals. Align daily/monthly/parent releases to the same snapshot.
This temporal suppression also needs the audit/value checks above.

**MEDIUM | apps/admin/lib/adminSuppression.ts:106 | Empty refund sides disclose
per-shop zeros | Nonnegative totals of zero identify every component.**

Reproduction: five shops each sell100 today and nobody refunds. Dashboard
publishes gross500, net500, refunds0; the day and monthly rule both allow it.
The reader learns each named shop refunded0. The comment that zero is a fact
"about nobody" (`app/page.tsx:173`) is wrong under the requested strict claim.
This is the committed zero exemption, not an accidental nonzero leak.

Additional suppression: treat zero-refund answers/complements as protected,
withholding net/refund answers and parent differences that imply those zeros.
Do not merely change the helper: monthly day construction currently includes
only days with rows, so absent calendar days also need consideration. Under
that strict zero-secret interpretation, the accepted cost rises further.

**MEDIUM | apps/admin/app/payments/page.tsx:25 | Non-gross account money is
published without k | The billing report withholds an already public sum.**

Reproduction: one account has one verified123.45 payment in October. Its
collected-payments report cell is withheld. `/payments` publishes123.45 with
the account label and verified status; `/revenue` publishes123.45 both monthly
and all-time (`revenue/page.tsx:241`). `/subscriptions` also exposes per-account
offering price (`subscriptions/page.tsx:86`), without a k floor. Account labels
link to named shops. This disproves the literal "gross is the only per-shop
money" inventory. These are Muthoy billing figures, not pharmacy refunds; no
equation between those money families is claimed.

Additional suppression: if billing is within the confidentiality claim, apply
the account-based k policy to its detail/aggregate publishers and their counts
consistently. If billing detail is already approved public account data, the
report floor provides no confidentiality gain and is over-withholding; state
that narrower privacy boundary explicitly. No unilateral scope change made.

**MEDIUM | apps/admin/lib/adminReports.ts:1239 | CSV hides the withholding
state itself | A detached empty amount reads as absent activity.**

Reproduction: the Beta net report exports a month key and empty money cell.
`reportToCsvDocument` includes headings/rows only; its subtitle and withholding
reason do not enter CSV. The harness confirms no `withheld`/`suppres` marker
and no real net in the CSV. PDF retains a generic subtitle; the page adds an
em dash/tooltip. The money is not leaked or zero-filled, but the explicit
withholding requirement does not hold for the detached CSV.

Correction: retain empty numeric cells for spreadsheet behavior, and add a
machine-readable withholding state/reason per row/cell. The numeric blank
alone cannot distinguish suppression from no observation.

**LOW | apps/admin/app/page.tsx:244 | Active count over-withheld on refund
activity, with a false reason | The same page can already show the count.**

Reproduction: ten sellers, two refunders. Active-today tile is withheld with
"fewer than five pharmacies recorded a sale". That is false: ten sold. The
activity chart's own sale-contributor gate permits10, as does enumeration of
shop counts. The harness server-renders the false caption. Gate the count on
its own selling contributors; keep refund suppression on money. On the Beta
month Revenue/Analytics/report captions also refer only to a five-contributor
bucket although the month has ten contributors and fails a daily refund rule.
Carry the actual suppression reason through every renderer.

**Inventory — ordinary authorized pages and exports**

Permission checks below are access controls; they do not constitute k gates.
The reproductions use an ordinary super_admin session, with no database access.

| Surface | Identified/per-shop? | Money? | Suppression actually applied |
|---|---|---|---|
| `/shops/[id]` | Named shop, owner, sale count, memberships, support notes | Gross today | `shops.read`; no k. Location separately needs maps permission and consent, currently withheld. No refund field. |
| `/subscriptions` | Account label mapped to primary shop | Offering price, not collected cash | `subscriptions.read`; no k; exact status/tier/cycle count and rows. Renewal count/time also visible. |
| `/payments` | Account label and order | Order amount/status | `payments.read`; no k. Historical orders remain visible. |
| `/accounts`, `/accounts/[id]` | Account/shop/membership identities and current subscription | No amount columns | `accounts.read`; no k; supplies joins to named shops. |
| `/pharmacies` | Registration, district, plan, status, last synced change | No amount | `shops.read`; exact filtered membership counts, same predicates as rows. No protected financial row is hidden behind this pager. |
| `/analytics` | Aggregates, not named money rows | Monthly pharmacy net | `analytics.read` + feature flag; monthly contributor k plus every represented day's refund-side rule. Separate count gates for sales, activity, registration, plan, growth, cancellations, conversion. Only dates are passed into its data range. |
| `/revenue` | Aggregate; tier groups | MRR, collected total/monthly, pharmacy net | `revenue.read`; subscription money ungated by k. Pharmacy all-time total composes monthly k and day-refund verdicts. |
| `/` | Aggregate nine metrics/five alerts, recent identified registrations | MRR; today's gross/refunds/net | `shops.read`; MRR also revenue permission. Today's money jointly gated by each nonempty side; empty side permitted. Activity chart has a separate sales-only gate. Subscription status distribution/operational alerts are exact metadata counts. |
| `/reports`, CSV/PDF endpoint | Metadata or aggregate | Two money report definitions | `reports.read` / `reports.export`; same builder and serializers, no alternate unsuppressed money export. See six definitions below. |
| `/audit`, audit CSV | Platform actors/targets; separate named-shop action/target/time view | No current automatic amount writer found; indirect full-refund disclosure | Platform `audit.read` / `audit.export`; shop `shop_audit.read`. Shop meta excluded at select. Current platform writers' allowlist contains no amount key; persisted legacy rows were not inspected, and the stored-row scalar reader is not another allowlist. |

The six reports: registrations are unsuppressed registration metadata;
subscriptions are k-gated tier/cycle/status account counts; collected payments
are monthly k-gated accounts; plan distribution is k-gated shop counts with
status complements; activity has independently gated sale-derived counts and
exempt registration counts, with status complements; pharmacy net has monthly
shop k and daily refund-side gating. No customer/medicine/sale-line export.

**Four attack classes — sound limits and failures**

- Cross-page: enumeration above finds raw billing publishers and audit target
  inference. Known gross/counts also constrain possible refund assignments.
- Historical releases: month/day contributor floors do not audit changes
  between releases. A released number remains usable after midnight, after a
  cell later becomes withheld, and after late sync changes the underlying rows.
- Repeated queries: for fixed data, whole-month rows are independent of the
  surrounding window. The harness includes a withheld September, visible
  October, and visible November; wider windows retain the identical October
  row. Subtracting October from October+November only recovers an already
  releasable November. Partial-month requests refuse. Money reports refuse
  status; district/tier/cycle are not honored report filters. Subscription
  status selects whole already status-keyed buckets. Plan/activity status
  complements are present; six-unfiltered/five-active/one-read-only yields
  visible6, withheld, withheld. Same query/data has the same result, independent
  of dhakaTodayLabel after C3. Data changes, not midnight alone, defeat it.
- Differencing: upward composition exists in Revenue; downward refund-day
  composition exists in reports and Analytics. Dashboard hides both side
  captions with a withheld net. These static pathways are sound for the
  checked additive attack. They do not protect release deltas, uniquely
  decodable values, zero implications, or audit events. Counts can constrain
  membership; a count is not inherently harmless simply because it is not money.
- Fixed-row paging/count predicates and audit keyset `(at,id)` are sound on
  source inspection for their intended pagination problem. Keyset paging is
  not a financial release-history mechanism. Exact counts must share any
  future event suppression; otherwise row hiding still discloses membership.

**Beta measurement — denominators stated**

Fixture: ten pharmacies, October31 days, BDT100 gross/shop/day as two actual
sale rows90+10. On days3/9/15/22/28, shops1 and2 each fully refund a10 sale.
620 sales, ten refunds, gross31,000, refunds100, actual monthly net30,900.
Other months absent. Billing history absent; billing money is a separate
family and is not mixed into these pharmacy-money percentages.

| Pharmacy-money observation | Answered/possible | Fraction |
|---|---:|---:|
| Final monthly net outputs: Analytics, Revenue total, report preview, CSV, PDF | 0/5 | 0% |
| Dashboard gross/refunds/net, one observation per day | 78/93 | 83.87% |
| Per-shop gross, shop by day | 310/310 | 100% |
| Unique period outputs: above shop/day cells plus five final monthly outputs | 388/408 | 95.10% |
| October31 snapshot: ten shop gross + three Dashboard + five monthly | 13/18 | 72.22% |
| Chronological daily panel snapshots, querying five current-month outputs daily | 398/558 | 71.33% |

Chronological simulation truncates source rows to each day's arrivals before
building the report. The current-month output publishes on October1 and2,
then is withheld from day3 onward. Thus ten monthly output observations are
already remembered. The earlier candidate denominator388/558 was rejected in
independent review because it mixed final-month suppression with daily repeats.

"Almost none" is supported for this month's final net outputs, not for all
pharmacy-money surfaces. Most remain visible by accepted gross design and the
empty-refund-side exemption. On the five refund days, all three Dashboard
money cells withhold. A running sum of the other26 days alone does not recover
the five missing refund-day nets. Audit/value/release attacks remain separate.

Smallest nonempty monthly release under the committed rule: five distinct
shops, each refunding a prior-month10 sale on October1. October has five
refund rows and no sales; net **-50.00 publishes**. Removing one refund makes
the same month withhold. Prior source sales and earlier shop registration are
explicit in the fixture. The rule is non-vacuous.

Actual SSR on Dashboard/Revenue/Analytics/report preview confirms monthly
30,900 never appears in the withheld displays, and serializers omit it too.
Pages show em dash/gap/withholding text rather than0.00. The inaccurate reasons
and CSV's detached unexplained blank are findings above, not counted as sound.

**Changes / verification / remaining validation**

Added this review and `scripts/review/admin-privacy-round1b.cjs` only. No
remediation applied: suppressing these protected paths requires a concrete
approved security/money plan. Candidate additional suppression is listed per
finding; together those fixes require another composition review before any
mathematical claim. The current implementation cannot simply gain that claim
by increasing k or preserving the current per-day rule.

Commands actually run: git status/show/diff, targeted source reads/rg;
`node scripts/review/admin-privacy-round1b.cjs` (exit0); standalone second-agent
Node session/config probes; `node --check scripts/review/admin-privacy-round1b.cjs`;
whitespace and final working-tree checks. No Vitest, build, lint, mobile suite,
hosted operation, or E15 acceptance rerun. Supplied gates remain attributed to
the founder, not reproduced here. Manual deployed/browser/native/RLS validation
remains outstanding. Suggested commit: `test(admin): reproduce round1b privacy disclosures`.

ROUND 1B: CLAIM NOT SUPPORTED
