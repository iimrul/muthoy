# Batch 3 — Independent Review Coverage Matrix

**Date:** 2026-10-29
**Base SHA examined:** `c36f261` (56 commits ahead of `origin/main` at `c25924e`)
**Author:** Claude (Opus 5), answering the founder directive of 2026-10-29 §3
**Status of this document:** evidence, not acceptance. Nothing here is a verdict.

---

## 0. Why this document exists, and what it is allowed to claim

The founder directive says, in terms:

> Before launching another narrow financial-integrity review, examine all
> existing Codex review reports, execution logs, acceptance matrices, and commit
> records from the previous fifteen rounds.
> […] Do not infer full coverage from the number of rounds, test counts or the
> existence of FINAL ACCEPT instructions.

So nothing below is inferred from a round count or a passing suite. Every
classification is derived from **what Codex actually executed**, recovered from
the fourteen saved review transcripts by extracting the command line of every
`exec` block and collecting the repository paths named in it. A path that
appears only in my brief, only in Codex's prose, or only because `CLAUDE.md` was
echoed into the transcript does **not** count as coverage here.

Transcripts, in order, with the finding count each returned:

| # | Transcript | Findings | Verdict |
|---|---|---|---|
| 1 | `gate5-result.txt` (27 637 lines) | 17 (5 P1, 12 P2) | REVISE |
| 2 | `gate5-delta-result.txt` | 8 (3 P1, 5 P2) | REVISE |
| 3 | `gate5-delta2-result.txt` | 3 (1 P1, 2 P2) | REVISE |
| 4 | `gate5-delta3-result.txt` | 1 | REVISE |
| 5 | `gate5-delta4-result.txt` | 2 | REVISE |
| 6 | `gate5-delta5-result.txt` | 6 | REVISE |
| 7 | `gate5-delta6-result.txt` | 1 | REVISE |
| 8 | `gate5-round9-result.txt` | 1 (redesign required) | REVISE |
| 9 | `gate5-round10-result.txt` | 3 | REVISE |
| 10 | `gate5-round11-result.txt` | 8 | REVISE |
| 11 | `gate5-round12-result.txt` | 10 | REVISE |
| 12 | `gate5-round13-result.txt` | 9 | REVISE |
| 13 | `gate5-round14-result.txt` | 12 | REVISE |
| 14 | `gate5-round15-result.txt` | 7 | REVISE |

Fifteen rounds is the count I have been using; the saved transcripts number
**fourteen**, because two of my numbered rounds map to one Codex session. The
round numbers in the briefs are therefore not a reliable index and the
transcript list above is.

---

## 1. The seven questions, answered with evidence

### Q1. Did Codex independently inspect ALL original Batch 3 deliverables?

**No.** Four route files in the Batch 3 surface were never named in a single
`exec` command across all fourteen transcripts:

| File | Rounds in which Codex executed against it |
|---|---|
| `apps/admin/app/login/page.tsx` | **none** |
| `apps/admin/app/api/admin/session/route.ts` | **none** |
| `apps/admin/app/accounts/page.tsx` · `accounts/[id]/page.tsx` | **none** |
| `apps/admin/app/payments/page.tsx` | **none** |

The first two are the **authentication boundary** — the sign-in form and the
session-cookie route. The libraries behind them *were* reviewed
(`lib/adminSession.ts` transcripts 9/10/12, `lib/adminLogin.ts` 1/9,
`middleware.ts` 4/9/10), so the boundary is not unexamined; its two HTTP entry
points are. `accounts` and `payments` are inherited Batch-2/B4 pages, but Batch
3 changed their behaviour through `lib/adminOutcomes.ts` §8.9d, and that module
was likewise never executed against.

Four library modules were also never named in an `exec`: `lib/env.ts`,
`lib/supabaseAdmin.ts`, `lib/basicAuth.ts`, `lib/adminOutcomes.ts`. The first
three were reviewed *indirectly* — transcript 1 reasons explicitly about
`lib/env.ts` being the only module naming `SUPABASE_SERVICE_ROLE_KEY`, which it
could only know from a tree-wide grep whose command names a pattern and not a
file. `basicAuth.ts` is a retired module retaining only `constantTimeEquals`,
which both `adminLogin.ts` and `adminSession.ts` depend on.

### Q2. Which files, modules, routes and security boundaries were reviewed?

Measured by `exec`-command appearance, by area:

| Area | Distinct files Codex executed against | Transcripts |
|---|---|---|
| `apps/admin/lib` | 58 of 67 | all 14 |
| `apps/admin/app` | 22 | all 14 |
| `apps/admin/components` | 11 | 1, 4, 6, 8, 9, 10, 11, 13 |
| `apps/admin/middleware.ts` | 1 | 4, 9, 10 |
| `backend/supabase` | 27 (migrations, pgtest, sync function) | 1–4, 9–14 |
| `packages/utils` | 11 | 1, 2, 4, 6, 8, 9, 10, 12, 13 |
| `packages/validation` | 6 | 1, 2, 9, 10, 11, 13 |
| `packages/types` · `packages/config` | 5 · 3 | several |
| `apps/mobile/db` | 19 | 1, 2, 8, 9, 10, 12 |
| `apps/mobile/sync` | 4 | **10 only** |
| `apps/mobile/domain` | 4 | 1, 9, 10 |
| `apps/mobile/tests` | 3 | 1, 10 |
| `scripts/h9` | 1 | 1 |

### Q3. Which areas were reviewed only indirectly through unit tests?

Areas where Codex read a *test* file but little or no production code:

- **W2-03 shop medicine search.** `w203-shop-medicine-search.sqlite.test.ts`
  (1, 2, 9, 10) and `medicineSearchKeyBackfill.test.ts` (2) carry most of the
  coverage; the migration `0033_medicine_search_key.sql` was read in 1, 9, 10
  and the backfill module in 1, 2, 9, 10, 12.
- **Mobile offline-first integrity.** Reviewed through `db/*.ts` reads and the
  SQLite harness, never by running a SQLite test — see Q4.
- **E4 evidence manifest.** `scripts/e4-evidence-manifest.mjs` 1 and 10;
  `apps/mobile/tests/e4-evidence-manifest.test.ts` 1 and 10.

### Q4. Which areas have not received meaningful adversarial review?

1. **No Codex round ever executed the test suite.** `spawn EPERM` appears in
   every one of the fourteen transcripts (4–8 occurrences each; 46 in the last,
   where Codex also tried a native-loader fallback). **Every test-count,
   exit-code and pass/fail figure in every brief and every handoff document is
   my measurement alone and has never been independently reproduced.** This is
   the single largest verification gap in the batch and it is structural, not an
   oversight: the Codex sandbox on this machine cannot spawn the vitest worker.
2. **`/login` and `/api/admin/session`** — see Q1.
3. **`apps/mobile/sync/{push,pull,merge,serializers}.ts`** — one transcript.
   W4-05's authorization story rests on
   `backend/supabase/pgtest/w405-shop-identity.pgtest.ts` (9, 10) and the
   migration SQL, not on the client sync path.
4. **`/settings` (§8.11)** — three transcripts (1, 9, 10), the thinnest of the
   eleven.
5. **H-9 reconciliation.** One `scripts/h9` file, transcript 1. H-9 is a prior,
   signed deliverable and the directive asks only that it be *reconciled*, not
   re-reviewed — but no Codex round has verified that reconciliation.
6. **Durable audit at scale, and privacy-safe logging**, were examined from
   transcript 9 onward and produced findings each time; the last one still found
   two (the request ceiling and the support-note overflow). This area has been
   reviewed adversarially and has **not yet gone a round without a finding.**

### Q5. Were all eleven Admin pages independently tested for real functionality?

**Partly.** Codex rendered pages with `renderToStaticMarkup` in ten of the
fourteen transcripts (3, 4, 4, 5, 17, 21, 18, 2, 16, 2 occurrences), ran
read-only Node probes that imported production modules in all fourteen, and ran
`next build` and `tsc --noEmit` in all fourteen. So "a route exists" was never
the evidence. But the rendering was concentrated on the money pages — `/`,
`/revenue`, `/analytics`, `/reports` — no transcript rendered `/login`,
`/accounts` or `/payments`, and only 1, 9 and 10 reached `/settings`.

### Q6. Were W4-04, W4-05, W2-03, H-9, E4, RBAC, audit, reporting, export and integration paths all included?

| Deliverable | Included? | Strongest evidence |
|---|---|---|
| W4-04 refund-net revenue | **Yes, heavily** | `app/revenue/page.tsx` in all 14; `packages/utils` net modules in 9 |
| W4-05 shop sync security | **Partially** | `pgtest/w405-shop-identity.pgtest.ts` 9–10; client sync one transcript |
| W2-03 medicine search | **Yes** | migration + backfill + SQLite test, 1, 2, 9, 10, 12 |
| H-9 | **No** | one file, transcript 1 |
| E4 migration 35 | **Yes** | `20261023000000_e4_batch3_admin_platform.sql` 1, 9, 10, 11; `e4_postmigration_checks.sql` 10 |
| RBAC / revocation / session cutoff | **Yes, heavily** | `adminIdentityStore.ts` 1–4, 6, 7, 9, 10 — three successive P1s |
| Audit trail | **Yes** | `adminAuditStore.ts` from 9 on, a finding every time |
| Reporting + CSV/PDF export | **Yes, heavily** | `adminReports.ts`, both export routes, 1, 2, 9–14 |
| Integration (security × db × sync × reporting × admin) | **Partially** | exercised within the admin app; the admin↔mobile seam only through `packages/utils` |

### Q7. Did previous reviews cover the complete implementation or only incremental financial-integrity changes?

**Transcript 1 was a genuine full-scope review** of the whole local commit range
— 17 findings spanning all eleven pages, both authorization directions, W2-03,
the deferred validations, and preservation of `audit-artifacts/**`. It is the
only round scoped that way.

**Transcripts 2–8 were narrow by construction.** Each brief says so in its own
words ("a targeted delta review of the fixes, not a fresh review of the batch"),
and 5–8 were almost entirely one artefact: the `net` provenance guard in a
single test file.

**Transcripts 9–14 were financial-integrity-led but not
financial-integrity-only.** Every brief from 9 on carried an explicit item —
"the rest of Batch 3: name anything unimplemented, half-implemented, or
implemented only in a document" — and Codex answered it with findings that were
*not* net-provenance: the Dashboard k-floor, the durable audit read, the
`audit.export` endpoint, the snapshot period, the keyset cursor, the district
pager, the support-note overflow, the plan-offering price. Thirteen of the
thirty-nine findings in transcripts 10–13 are outside the money-provenance
class.

**But the direction of attention was mine, and it was narrow.** I chose each
round's subject. Fourteen of fourteen centred on money or privacy, so the areas
named in Q4 drifted out of view — not because Codex refused to look, but
because I never asked.

---

## 2. The coverage matrix

Classification rules, applied mechanically:

- **REVIEWED** — Codex executed against the production code in ≥2 transcripts,
  *and* at least one both rendered or imported it and produced or cleared a
  finding about it.
- **PARTIALLY REVIEWED** — executed against in 1 transcript, or only via its
  tests, or only via adjacent modules.
- **NOT REVIEWED** — never named in any `exec` command.

| Deliverable | Actual reviewed files | Tests | Codex evidence | Claude evidence | Findings | Status |
|---|---|---|---|---|---|---|
| **§8.1 Dashboard `/`** | `app/page.tsx`, `lib/queries.ts`, `lib/platformStats.ts`, `components/NetSalesCard.tsx` | `adminDashboard.test.ts` (35), contract tests | transcripts 1, 2, 7, 8, 9, 10, 11, 12, 13, 14; rendered in 9–13 | 1450 admin+utils tests at `c36f261` | k-floor absent, union floor, per-side floor, MRR completeness | **REVIEWED** |
| **§8.2 Pharmacies + `/shops/[id]`** | `app/pharmacies/page.tsx`, `app/shops/[id]/page.tsx`, `lib/adminFilters.ts`, `lib/adminQueries.ts` | `adminFilters.test.ts`, `adminQueries.test.ts`, contract | 1, 2, 9, 10, 11, 13 | same | support-notes block read nothing; gross-sales disclosure | **REVIEWED** |
| **§8.3 Subscriptions** | `app/subscriptions/page.tsx`, `lib/adminSubscriptionViews.ts` | `adminSubscriptionViews.test.ts` (23), contract | 1, 9, 10, 12, 13 | same | status filter; offering price → ৳0 | **REVIEWED** |
| **§8.4 Revenue (W4-04)** | `app/revenue/page.tsx`, `packages/utils/src/netSales*.ts`, `lib/adminReports.ts` | `netSales.test.ts`, `netSalesProvenance.test.tsx`, `adminReports.test.ts` | **all 14** | same | the five-round provenance class; billing exceptions | **REVIEWED** |
| **§8.5 Analytics** | `app/analytics/page.tsx`, `lib/adminPlatformQueries.ts`, `components/NetSalesTrend.tsx` | contract, `adminPlatform*.test.ts` | 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13 | same | four §8.5 figures; chart sink; caption; whole-month period | **REVIEWED** |
| **§8.6 Maps** | `app/maps/page.tsx`, `components/map/MapCanvas.tsx`, geo lib | contract | 1, 2, 3, 4, 6, 7, 9, 10, 11 | same | district/status filters | **REVIEWED** |
| **§8.7 Support** | `app/support/page.tsx`, `lib/adminSupportStore.ts` | `adminSupport.test.ts`, contract | 1, 2, 9, 10, 11, 12 | same | search + notes; `INSERT … RETURNING`; note overflow | **REVIEWED** |
| **§8.9 Audit** | `app/audit/page.tsx`, `lib/adminAuditStore.ts`, `app/api/audit/export/route.ts` | `adminAuditStore.test.ts`, contract | 1, 2, 9, 10, 11 (route: 10, 11) | same | durable read; export endpoint; fallback label; cursor; ceiling | **REVIEWED** |
| **§8.10 Admins** | `app/admins/page.tsx`, `lib/adminIdentity*.ts`, `lib/adminRoles.ts` | `adminIdentityStore.test.ts`, `adminRoles.test.ts`, contract | 1, 2, 3, 4, 6, 7, 9, 10 | same | three successive revocation P1s | **REVIEWED** |
| **§8.11 Settings** | `app/settings/page.tsx` | contract | 1, 9, 10 only | same | none specific to it | **PARTIALLY REVIEWED** |
| **§8.12 Reports + CSV/PDF** | `app/reports/page.tsx`, `app/api/reports/export/route.ts`, `lib/adminReports.ts`, `lib/adminCsv.ts`, `lib/adminPdf.ts` | `adminReports.test.ts`, `reportExportRoute.test.ts` | 1, 2, 9, 10, 11, 13 | same | export boundary, four times; snapshot period | **REVIEWED** |
| **Authentication boundary — `/login`, `/api/admin/session`** | `lib/adminSession.ts`, `lib/adminLogin.ts`, `middleware.ts` reviewed; **the two route files never** | `adminSession.test.ts`, `adminLogin.test.ts`, `basicAuth.test.ts` — none ever read by Codex | libs: 1, 4, 9, 10, 12; routes: none | same | none | **PARTIALLY REVIEWED** |
| **`/accounts`, `/accounts/[id]`, `/payments` (B4 inherited, changed by §8.9d)** | none | — | **none** | same | none | **NOT REVIEWED** |
| **`lib/adminOutcomes.ts` (§8.9d three-outcome reporting)** | none | `adminActions.test.ts` never read | **none** | same | none | **NOT REVIEWED** |
| **W4-05 shop sync security** | `pgtest/w405-shop-identity.pgtest.ts`, migrations; `apps/mobile/sync/*` one transcript | pgtest (never executed by Codex) | 9, 10 | same | barrier roles corrected pre-Gate-5 | **PARTIALLY REVIEWED** |
| **W2-03 shop medicine search** | `db/medicineSearchKeyBackfill.ts`, `db/migrations/0033_*.sql`, `domain/ftsQuery.ts`, `db/sync-helpers.ts` | `w203-*.sqlite.test.ts`, `medicine-search.sqlite.test.ts` | 1, 2, 9, 10, 12 | same | `search_key` fold on ordinary writes | **REVIEWED** |
| **E4 migration 35 + evidence manifest** | `20261023000000_e4_batch3_admin_platform.sql`, `e4_postmigration_checks.sql`, `e4-source-hashes.json`, `scripts/e4-evidence-manifest.mjs` | `e4-evidence-manifest.test.ts` | 1, 9, 10, 11 | 48-artifact manifest regenerated and verified at `c36f261` | `.gitattributes` path led nowhere | **REVIEWED** |
| **H-9 reconciliation** | one `scripts/h9` file | `scripts/h9/test/*` never read | 1 | H-9 pins verified unchanged this session | none | **PARTIALLY REVIEWED** |
| **Mobile offline-first integrity** | `db/{init,inventory,sales,purchases,schema,sync-helpers}.ts`, `domain/*` | SQLite suites read, never run | 1, 2, 9, 10, 12 | full suite 289 files / 6667 tests at `dbeba30` | none in Batch 3 | **PARTIALLY REVIEWED** |
| **Independent test execution** | — | — | **`spawn EPERM` in all 14 transcripts; zero suites ever run** | all figures measured by me | — | **NOT REVIEWED** |

---

## 3. What this means for the next step

Three gaps are worth closing before any acceptance, and one cannot be closed
here:

1. **Closeable.** `/login`, `/api/admin/session`, `lib/adminOutcomes.ts`,
   `/accounts`, `/accounts/[id]`, `/payments`, `/settings`, and the mobile sync
   client path — these need a round whose subject is *them*, not money.
2. **Closeable.** W4-05's client side and the admin↔mobile seam.
3. **Not closeable on this machine.** Codex cannot run vitest. Dual acceptance
   can therefore rest on dual *code* review and on Codex's own read-only Node
   probes — which have reproduced real defects in every round — but **not** on
   two independent test executions. Any final report must say so in those words
   rather than implying two parties measured the suite.

## 4. One thing this document deliberately does not say

It does not say the previous fourteen rounds were poor value. Every round
returned findings that were right, including twenty-seven calls of the form "a
previous fix is incomplete", and the money-provenance class took five rounds to
reach its cause. The gap is one of **attention**, and the attention was directed
by me.
