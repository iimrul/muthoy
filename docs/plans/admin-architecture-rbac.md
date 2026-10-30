# Admin Panel — architecture, RBAC, and the per-page acceptance record

**Batch 3. Written for the founder and for an independent reviewer.**

Two axes are kept apart throughout this document, and they never collapse into
one word:

- **CODE-COMPLETE** — the functionality exists, is authorized, and is proved by
  automated tests that run on every commit.
- **DEVICE / PRODUCTION-VERIFIED** — somebody opened the deployed panel in a
  browser, signed in, and saw it work against real data.

**Everything below is CODE-COMPLETE. Nothing below is PRODUCTION-VERIFIED.**
No admin page is DONE until gate **E15** is met: the deployed browser check
Volume 5 demands in its own words — *"verify this explicitly (check devtools'
network tab) before considering ANY admin feature done — a hard-spot
verification, not a formality."*

---

## 1. How the panel is built

| Layer | What it is | Rule |
|---|---|---|
| Routes | Next 15 App Router, `apps/admin/app/**/page.tsx` | every page's **first statement** is `await requireAdminPermission(...)` |
| Reads | `apps/admin/lib/admin*Queries.ts`, each starting `import 'server-only'` | a client file importing one is a **build failure**, not a review miss |
| Logic | pure modules in `apps/admin/lib/` — metrics, filters, suppression, geo, support, settings, dashboard, subscription views, audit views | no React, no database, no clock: testable against a fixture |
| Writes | four module families only, enumerated in a manifest | §8.12, reproduced below |
| Client | `components/charts/*`, `components/map/*` only | receive already-aggregated, k-suppressed arrays — never a row, never a credential |

### The service-role key

The key is protected by `import 'server-only'` on `lib/env.ts`. A `'use client'`
file that reaches it — directly or **transitively** through any module whose
first line is `server-only` — fails the build. `serviceRoleExposure.test.ts`
additionally asserts: an allowlist of exactly four client files; that no *page*
is a client component; that no client file reaches a server-only module through
the import graph; and that no client component's props name a raw row type.

**That is a build-time and test-time claim, not a deployed one.** The deployed
devtools check is gate **E15**.

### Why charts and maps are the only client components

`TECH_STACK.md:95-98` locks Recharts and Leaflet. A `'use client'` boundary is
**not** an SSR boundary — Next still server-pre-renders a client component — so
a module-scope `import 'leaflet'` throws `window is not defined` during the
build. Three things make the build pass, all required:

1. `MapCanvas.tsx` imports Leaflet with `await import('leaflet')` **inside
   `useEffect`**;
2. `MapLoader.tsx` is a client file containing nothing else, because
   `next/dynamic(..., { ssr: false })` is rejected inside a Server Component in
   Next 15;
3. `MapLoader`'s props carry a **required** `tileUrl: string`, so the
   unconfigured state cannot reach it and the dynamic import is never triggered.

**The gate is a real `next build`, not a unit test.** A unit test cannot catch
this class of failure.

---

## 2. Roles and permissions

### 2.1 The four roles

Set by the `ADMIN_ROLES` environment variable, which maps a username to one of
`super_admin`, `billing`, `support`, `read_only`. The variable is parsed by a
hand-written parser in `lib/adminIdentity.ts` whose every rejection is
enumerated in tests — it parses an environment variable, not a write payload,
which is why it is not a Zod schema.

### 2.2 The matrix

Rendered on `/admins` **from `ROLE_PERMISSIONS` itself**, so the page cannot
drift from the code. Notable scoping decisions:

| Permission | Who holds it | Why |
|---|---|---|
| `revenue.read` | super_admin, billing | money is not a support concern |
| `admins.read` / `admins.write` | super_admin | role management is not delegated |
| `shop_audit.read` | super_admin, support | Volume 5 scopes the per-shop view to *"support/debugging use only"*; billing has no reason to read a pharmacy's internal history |
| `maps.read` | super_admin, billing, support — **not** read_only | a coordinate is outside the scope of plain read access |
| `audit.export` | super_admin | an export is the one way the audit leaves the system |

### 2.3 The intersection model

A request's authority is the **intersection** of its environment role's
permissions and its assignment row's, or the environment role's alone when no
row exists.

```
effective = env_role_permissions  ∩  assignment_row_permissions
```

Three consequences, each tested:

- a narrowing row **takes a permission away at the gate**, not merely from the
  navigation — `requirePermission` reads `session.permissions`, never
  `hasPermission(role)`, because asking the role would read straight past the
  intersection and hand a narrowed account its full environment authority;
- a **disabled** assignment row refuses every permission, including the ones it
  names;
- the assignment role is **shown** on `/admins` beside the effective set, so the
  difference between the two is visible rather than inferred.

### 2.4 The fail-closed trade-off, stated

If the assignment store is unreadable, the request is **refused** and
`role_store_unavailable` is audited. The alternative — falling back to the
environment role — would mean a database outage silently restores authority
somebody deliberately narrowed. The cost is that an outage locks every admin
out of the panel, including the founder. **That is the intended trade: an
unavailable panel is recoverable, an un-narrowed one is not.**

---

## 3. Bounded write power

Direct table writes are permitted in a small, asserted set of modules, and
every write is enumerated by `(module, table, operation)` in a manifest
`adminGrants.test.ts` compares against the parsed sources.

| Module | Table | Operations |
|---|---|---|
| `lib/adminActions.ts` | `payment_orders` | `update` (the guarded stale-order transition) |
| `lib/adminAuditStore.ts` | `admin_audit_log` | `insert` **only** |
| `lib/adminIdentityStore.ts` | `admin_role_assignments` | `insert`, `update` |
| `lib/adminSupport*` | `admin_support_cases` | `insert`, `update` |
| `lib/adminSupport*` | `admin_support_notes` | `insert` **only** |
| `lib/adminSettings*` | `admin_platform_settings` | `insert`, `update` |

- `shops`, `sales`, `sale_refunds`, `users`, `audit_logs`,
  `entitlement_snapshots`, `billing_subscriptions`, `billing_accounts` and
  `plan_offerings` appear in **no** write entry.
- `delete` and `truncate` appear in **no** entry at all.
- The only RPC any admin module may call is `b4_reconcile_plan_limits`.
  **`b4_refresh_entitlement_snapshot` is forbidden by name**, so re-adding it
  fails the build.

### Why that RPC is forbidden (E11)

Its whole body sets `verified_at = now()`. And
`apps/mobile/domain/entitlements.ts:143-146` makes `verified_at` the **offline
access ceiling**. So an admin pressing "Refresh entitlement snapshot" extended a
device's premium access by the full offline window **with no payment behind
it**. It shipped in Batch 2 (`a2c196a`) and Batch 3 **removed the surface
entirely**. The RPC itself is not modified — rewriting money-path SQL needs its
own approved plan. That is gate **E11**, and the panel no longer offers it.

**No Batch 3 action creates or extends a paid entitlement without verified
payment evidence.** That is enforced structurally, not by review.

---

## 4. The per-page acceptance record

**All eleven pages are CODE-COMPLETE. None is PRODUCTION-VERIFIED.**

Every page is covered by `app/adminRoutes.contract.test.tsx` (81 tests), which
**invokes and renders** each page in four states: a session the environment does
not know, a real role lacking the permission, no session at all, and an
authorized empty platform — plus a query-failure state asserting no driver
message, connection string or stack reaches the browser, and a column check
that reads the **migration SQL** so a renamed column fails the test rather than
production.

### 1. Dashboard — `/` · `shops.read`

| | |
|---|---|
| **Code status** | COMPLETE. Nine metrics, five computed alert classes, a 30-day registration trend and a 30-day activity trend, a subscription-status distribution, a recent-registrations table, and a link from each card to its detail page. |
| **Test evidence** | `adminDashboard.test.ts` (35), plus contract tests asserting all nine captions render, all five alerts are listed, every source table is reached by an authorized role, and the run rate is **absent** for a role without `revenue.read` while the page stays correct. |
| **Missing** | Nothing from §8.1. |
| **Hosted** | NOT VERIFIED. |
| **External** | E15. |

The run rate is computed only when it will be shown — a figure nobody may see
is not fetched either. The activity trend is k-suppressed; the registration
trend is registration metadata and is not.

### 2. Pharmacy Management — `/pharmacies` + `/shops/[id]` · `shops.read`

| | |
|---|---|
| **Code status** | COMPLETE. Search over name, Latin-script name and phone; district, plan and status filters; sort; `.range()` paging with an **exact count carrying the same filters**. The drill-down adds owner/account detail, contact, subscription status, latest activity, the support-notes block and the consent-gated location block. |
| **Test evidence** | `adminFilters.test.ts`, `adminQueries.test.ts`, plus contract tests proving a search + plan filter + page all reach the query, that a malformed filter is reported with **no query issued**, that the support block renders the shop's own case, that the location block withholds the coordinate and names E13, and that a role without `maps.read` is told so while the rest of the page still works. |
| **Scope change** | **FOUNDER DECISION, 2026-10-30 — OPTION B.** Per-pharmacy **Gross sales today is REMOVED** from the drill-down, and `getShopDetail` no longer computes it. `saleCountToday` stays: a count is not an amount, and it is what answers "is this pharmacy trading?" for support. Two guards that used to assert the page says "Gross sales today" out loud now assert the page renders **no per-pharmacy money at all**, checked at the page AND at the reader. See §6n. |
| **Missing** | Nothing from §8.2 — **as of the Gate 5 corrections**, and as amended above. The block headed "Support notes" previously read no notes, only case summaries, and the owner information and latest activity were not even selected. All three are now read: notes per case id (so there is no path to a note without a case belonging to this shop), the owner resolved by id from `users`, and `updated_at` labelled "Last synced change" rather than "last seen". A **real marker** needs E13. |
| **Hosted** | NOT VERIFIED. |
| **External** | E13 (location consent), E15. |

The route parameter is UUID-validated **before** it reaches a query, and a
malformed one reaches no query at all. The support block filters on `shop_id`
**in the query**, not in JavaScript.

### 3. Subscriptions — `/subscriptions` · `subscriptions.read`

| | |
|---|---|
| **Code status** | COMPLETE. All six statuses as a filter, plus tier and cycle; paging with an exact count; plan/tier detail, start, expiry, **next billing date with the field it came from**, **renewal history from verified payment orders**, upcoming expirations, grace end, and the change history from the audit log. |
| **Test evidence** | `adminSubscriptionViews.test.ts` (23), plus contract tests proving the next-billing basis renders in words, the renewal column comes from the verified order, all three filters reach the query, and the E10 notice survives even a malformed-filter refusal. |
| **Missing** | **Lifecycle overrides are deliberately not built** — see below. |
| **Hosted** | NOT VERIFIED. |
| **External** | E10 (an approved audited override API), E15. |

**Trial extension and status override are rendered as a notice with gate E10,
not as disabled buttons.** A greyed-out control says "this exists and you may
not use it"; the truth is that the design was superseded and unapproved
(`docs/playbook/05-admin.md:47`). A test asserts the page contains no such
control and no reference to the withdrawn refresh action.

### 4. Revenue & Billing — `/revenue` · `revenue.read`

| | |
|---|---|
| **Code status** | COMPLETE. Current run rate with its priced-subscription count, collected payments (total and 12-month series), order status across all five values, recorded cancellations, expired-without-cancellation, billing exceptions, a link to the order-level view, and W4-04's refund-net pharmacy section as a **separately labelled family**. |
| **Test evidence** | `adminMetrics.test.ts` (the canonical-predicate fixture and four mutation checks), `adminLabels.test.ts` (including §5.2's two mutation checks, which require this page), `platformStats.test.ts`, contract tests. |
| **Missing** | **The MRR trend and churn are BLOCKED, not missing** — E12. |
| **Hosted** | NOT VERIFIED. |
| **External** | E12 (immutable lifecycle events), E15. |

This is the only page exempt from the `revenue` word scan, and the exemption is
**backed**: a test asserts every `MetricTile` on it resolves through
`requireMetric`, so no figure can be captioned by hand.

### 5. Analytics — `/analytics` · `analytics.read`

| | |
|---|---|
| **Code status** | COMPLETE. Daily active pharmacies, new registrations over time, trial-to-paid conversion, subscription growth, plan distribution, the recorded-cancellation series, platform usage, and aggregated pharmacy sales volume — with a date range capped at 400 days. |
| **Test evidence** | `adminSuppression.test.ts` (16, at the k−1/k boundary with a mutation check for a 4-shop bucket left visible), `adminReports.test.ts`, plus contract tests rendering all four of the figures below against a POPULATED fixture, asserting the three source tables are reached, and — after the DELTA review — asserting the conversion figure at ONE trialed account (withheld, counts and all) and at FIVE (published), that refund-only shops do not lift the sale count over the floor, and that the growth and cancellation series carry the queried period. |
| **Missing** | Nothing from §8.5 — **as of the Gate 5 DELTA corrections.** This page previously claimed four figures it did not render: trial-to-paid conversion, subscription growth, the recorded-cancellation series and the sales-volume count. All four are now built. Conversion is NULL rather than 0% when no trial was ever granted; the cancellation series states in its own description that it is not churn and can only under-report (E12); the volume count excludes refunds. The date range is validated through the shared schema before any read, so the 400-day cap is a rule rather than a caption. **Three of those four figures were then wrong in ways the delta review caught** (§6c, P1 2 and 3, P2 5): the conversion tile bypassed the k=5 floor entirely and published "1 of 1" for a single account; the sale count was gated on contributors to the refund-net total rather than on sellers; and the growth and cancellation series ignored the validated range, so an October query drew January growth. All three are fixed. |
| **Hosted** | NOT VERIFIED. |
| **External** | E15. |

**k = 5, on distinct contributing shops.** No customer, sale line or medicine
ever appears.

### 6. Maps — `/maps` · `maps.read`

| | |
|---|---|
| **Code status** | COMPLETE **as specified**, which means it plots nothing in the shipped state and says exactly why. Leaflet is wired behind the consent predicate, with plan-tier marker colour, a selection summary, drill-down navigation, and district/subscription-status filters — **the filters were claimed and absent until the Gate 5 corrections, and the status half then filtered the WRONG COLUMN until the delta review** (§6c, P2 6): it matched the shop's commercial status under a "Subscription status" label, so a trialing pharmacy answered to "active" and four of the six lifecycle cohorts could not be asked for. The page now carries each shop's real subscription status from its entitlement snapshot and offers all six, plus "no subscription" as its own cohort. Both filters are applied BEFORE the consent gate, so the withheld count describes the same population the map does. |
| **Test evidence** | `adminGeo.test.ts` (40), plus a contract test asserting that with no tile provider configured **`MapLoader` is never rendered** — so the dynamic import, and therefore Leaflet, is never reached — and that the page names E14. After the delta review: a fixture in which every shop is commercially `active` and they differ only in subscription status, so a filter on the wrong column is visible; the six statuses asserted against `entitlement_snapshots`' own CHECK constraint; and page-level tests on the withheld count, since no pharmacy NAME is observable through the consent gate. |
| **Missing** | Nothing. **Markers** need E13; **tiles** need E14. |
| **Hosted** | NOT VERIFIED. |
| **External** | E13, E14 (an approved tile provider), E15. |

A capture timestamp is **not consent**. Both halves of the tile configuration —
URL **and** attribution — gate readiness, because a provider configured without
its required attribution is one being used outside its own terms. **No
coordinate is invented and no address is geocoded.** Nothing in the mobile app
writes a latitude or longitude today, so the real state is zero coordinates
either way.

### 7. Support Management — `/support` · `support.read`, writes `support.write`

| | |
|---|---|
| **Code status** | COMPLETE. Search and status filters, queue counts, case detail, append-only notes, category/status/assignee transitions, case history, and the account and shop context. |
| **Test evidence** | `adminSupport.test.ts` (including the search-escaping and context-shape cases), `adminValidation.test.ts`, `adminGrants.test.ts`, contract tests. |
| **Missing** | Nothing from §8.7 — **as of the Gate 5 corrections.** This page previously had a status filter and nothing else: the search, the case history and the account context were all claimed and absent. The search is an `ilike` on one column with the pattern escaped by the shared helper; the history IS this case's audit trail rather than a second record that could disagree with it; the context carries no account id, because whether one exists is the support question and which one belongs to the drill-down. |
| **Hosted** | NOT VERIFIED — the tables exist in **unapplied** migration 35. |
| **External** | E4-H (applying migration 35 to a hosted project), E15. |

**No support history is fabricated.** The tables ship empty and the page's empty
state says so. A note is a row in an admin table, not a shop write: support
gains no `subscriptions.write` and no unrestricted shop access.

### 8. Admin Users & Roles — `/admins` · `admins.read`, writes `admins.write`

| | |
|---|---|
| **Code status** | COMPLETE. Directory with environment role, assignment role, effective intersected permissions, enabled state and last revocation; the §4.2 matrix rendered from `ROLE_PERMISSIONS`; role narrowing, account disable and per-user session revocation all functional; security audit history filtered to `admins.*`, `login` and `session.*`. |
| **Test evidence** | `adminIdentityStore.test.ts` (61, including the revocation regression cases below and nine on the dedicated revocation writer), `adminRoles.test.ts` (36), `adminAuthz.test.ts` (50), `adminAuditViews.test.ts` (35, including the security-history cases and the delta review's de-duplication mutation), contract tests including a `read_only` denial. |
| **Missing** | **Account creation completes outside the panel** by design — §4.3's hash-and-fragment flow, labelled as such on the page. §8.8's **security history was claimed and absent** until the Gate 5 corrections; it is now built, filtered to `admins.*`, `login` and `session.*` through the same library the Audit page uses. **That history then dropped real events** until the delta review (§6c, P2 7): its de-duplication key was `at + actor + action`, so two revocations of different targets in one millisecond became one row and a DENIED attempt collapsed into the success beside it. The concatenation that made de-duplication necessary is gone. |

**A security defect was found here by the Gate 5 review, and the first fix for
it was itself wrong.** Revoking an admin's sessions wrote the environment role
and `isActive: true` unconditionally, so revoking a **disabled, narrowed**
account replaced the narrowing with its environment role — possibly
`super_admin` — and re-enabled it. A security action that widens authority is
worse than no action.

The first fix READ the row and wrote those two values back. The delta review
rejected that correctly: it is a lost update, and a disable committed between
the read and the write is overwritten by stale values. **Preserving a value
read a moment ago is not the same as not touching it.** The revocation now
writes exactly `sessions_revoked_at` and `updated_at`, names neither authority
column, and enforces forward-only in the WHERE clause rather than from a read
— see §6c, P1 1. `writeRoleAssignment` no longer writes the revocation column,
so the two writers cannot overwrite each other.
| **Hosted** | NOT VERIFIED. |
| **External** | E4-H, E15. |

### 9. Audit Logs — `/audit` · `audit.read`, export `audit.export`

| | |
|---|---|
| **Code status** | COMPLETE, in two views. **(a)** the platform admin audit: actor, `actor_verified`, role, action, target, outcome, timestamp and redacted context, with failed and **denied** operations included, filters on actor/action/outcome/date, free-text search and paging. **(b)** the per-shop `audit_logs` view, gated on `shop_audit.read`, scoped to one validated shop id, read-only, newest first, paged. |
| **Test evidence** | `adminAuditViews.test.ts` (19, including the Dhaka-day mutation check), `adminAudit.test.ts`, `adminAuditStore.test.ts`, plus contract tests proving the filters render, that **no shop id means no `audit_logs` read at all**, that a permitted role reads exactly one shop's log, that `billing` — which holds `audit.read` but not `shop_audit.read` — reads none, and that a malformed id is refused before any query. |
| **Missing** | Nothing from §8.9. |
| **Hosted** | **NOT VERIFIED, and durability is NOT claimed.** |
| **External** | E4-H, E15. |

**View (a) is not the record, and the page says so.** It holds this server
instance's ring buffer: a restart clears it and another instance has its own.
The record of account is the structured line written to stderr. The Postgres
audit table ships in **unapplied** migration 35.

View (b) is read-only **in the database**: §3.5 revokes every privilege on
`audit_logs` from the panel's role and grants back `SELECT` alone.

### 10. Reports — `/reports` + `/api/reports/export` · `reports.read`, export `reports.export`

| | |
|---|---|
| **Code status** | COMPLETE. Six platform reports, date-range and status filters, CSV and PDF export. |
| **Test evidence** | `adminCsv.test.ts` (23, with a planted `=cmd\|…` payload and a legitimate negative number that must survive readable), `adminPdf.test.ts` (output parsed back, with a corrupted-`xref` mutation check), `adminReports.test.ts`, `reportExportRoute.test.ts`, contract tests. |
| **Missing** | Nothing from §8.10. The Gate 5 corrections made each report declare whether it can honour a status filter, and **that fix then broke the activity report** until the delta review (§6c, P2 4): restricting its sales half to the shops in the report data dropped every pharmacy that traded in the period but registered before it, with or without a filter. That report now reads every shop while the period still bounds the sales, with a reader-level test on the recorded filter arguments and a non-vacuity test that the registration report still IS bounded. |
| **Hosted** | NOT VERIFIED. |
| **External** | E15. |

Exports page through `readAllPages` with an explicit cap and a **hard assertion
that the exported row count equals the counted row count**, proved against a
fixture larger than one page. The export route **re-checks `reports.export`
itself**: a `reports.read`-only role gets 403, an unauthenticated caller gets
401 from the middleware. **No per-shop financial export is provided**, and a
test asserts no report row carries a sale, a customer or a medicine.

### 11. Settings — `/settings` · `settings.read`, writes `settings.write`

| | |
|---|---|
| **Code status** | COMPLETE, with three sections of deliberately different status. |
| **Test evidence** | `adminSettings.test.ts` — which **parses the migration SQL** and compares all four places the key list appears. |
| **Missing** | Notification templates are **read-only by design**. |
| **Hosted** | NOT VERIFIED. |
| **External** | E4-H, E15. |

| Section | Status | Why |
|---|---|---|
| Feature flags (3) | **editable and genuinely consumed** — `isFeatureEnabled` is read by the Analytics, Maps and Reports-PDF routes themselves, and a mutation check asserts a disabled flag actually hides the feature | a real server-side consumer inside this app |
| Notification templates (3) | **read-only, visibly unavailable, with the reason** | no admin notification dispatcher exists anywhere in the product; a test asserts no write path accepts a `notification.template.*` key |
| Environment diagnostics | **read-only, names and presence only** — "set" or "not set", **never a value** | a test asserts no rendered string contains a value from the environment |

**Nothing here can change production infrastructure.**

---

## 5. Pages that left the top navigation and lost nothing

`/accounts`, `/accounts/[id]` and `/payments` are not in the eleven-entry nav,
per §8.4, and **lost no functionality**: `/payments` is linked from Revenue &
Billing as its order-level view, and `/accounts/[id]` from the drill-down.

---

## 6. A drift found in this batch, and why it matters

`packages/validation/src/admin.ts` had drifted from the hash-sealed migration 35
on five value spaces — support statuses, support categories, settings keys,
`shop_id` nullability, and the summary/body length caps. §8.11's test asserting
"six keys in three places are identical" **passed**, because all three
TypeScript copies had drifted *together* and the test only compared copies to
copies.

Had it shipped, every support-case write and every settings write would have
passed validation and then failed at the database CHECK constraint.

`adminSettings.test.ts` now **parses the migration SQL** and compares all four
places. The lesson generalises and is recorded here on purpose: **compare
against the database, not against another copy.**

A second instance of the same class turned up in this session's own test
fixture: the route-contract fake had no `maybeSingle()`, so the pharmacy
drill-down threw, rendered its error notice, and every assertion about what
that page *shows* passed while the page was broken. **A fake that is broken for
everybody makes every denial test pass.** The fixture now implements the
one-row envelope, and nineteen new contract cases assert the positive direction:
an authorized role reaches the business tables and the fixture's own values
appear on screen.

---

## 6b. What the Gate 5 review changed, and why this record is now trustworthy

The first version of this document **overstated five pages**. Analytics claimed
four figures it did not render; Support claimed a search, a case history and an
account context it did not have; Admins claimed a security history that did not
exist; the shop drill-down's "Support notes" block read no notes; and Maps
claimed district and status filters that were absent.

**The founder's decision was that the functionality is implemented, not that
the document is corrected to match a smaller product.** All five are now built,
each with positive and negative tests, and the entries above say where each one
previously overstated and what closed it.

Two defects the same review found were not scope gaps but bugs, and both are
fixed with regression tests:

- **revoking an admin's sessions restored their access** — see §4, page 8;
- **the k=5 privacy floor was bypassed** on the activity report, which gated a
  row on the UNION of its registration and sales contributors, so a day on
  which five shops registered and one traded published that one shop's
  activity. The test that should have caught it asserted the bypass and
  rationalised it as "safe BECAUSE five shops stand behind the row". Each value
  is now gated by its own contributors.

**The lesson this document already carried is the one that applied again: a
test that compares the wrong two things passes for the wrong reason.** Three
separate instances in this batch — the validation drift, the missing
`maybeSingle()`, and that suppression test.

---

## 6c. What the Gate 5 DELTA review changed — four of those fixes were wrong

The delta review of §6b's fixes returned **REVISE with eight findings: three P1
and five P2**. Four of them said a fix from the first round was *incomplete*,
which is a more serious result than the first round's: a wrong fix is harder to
see than a missing feature, because the record already says it is done.

They are listed here by what was actually wrong, because "resolved" is not a
finding count.

### The three P1s

1. **Revoking sessions could still restore access.** §6b records this as fixed.
   It was not. The first fix READ the assignment row and wrote the stored
   `role` and `is_active` back, which is a lost update: a disable or a
   narrowing committed between the read and the write is overwritten by stale
   values. **Preserving a value read a moment ago is not the same as not
   touching it.** The revocation now issues an UPDATE over exactly
   `sessions_revoked_at` and `updated_at` and names neither authority column,
   so neither can be lost; forward-only moved from a `Math.max` over that read
   into the WHERE clause, because a point computed from a stale read can move
   BACKWARDS under concurrency and revive sessions an earlier revocation
   killed. `writeRoleAssignment` no longer writes the revocation column at
   all, so the two writers cannot overwrite each other.

2. **Analytics published one account's payment activity.** The trial-to-paid
   conversion tile was added in the first round with no k=5 gate at all — on a
   page whose own header comment claims every figure goes through the floor. A
   single trialed account rendered `100.0%` and, worse, the note `1 of 1
   accounts granted a trial later held a verified payment`. Both are now behind
   the floor, counted on distinct billing accounts.

3. **Refund-only shops lifted the sale count over the floor.** The monthly
   bucket carries every shop behind the refund-NET total, which legitimately
   spans sales and refunds. The sale COUNT was gated on that same list, so one
   selling shop beside four refund-only shops cleared k=5 and published that
   one shop's count. The count now has its own contributor list.

### The five P2s

4. **The activity report silently omitted established pharmacies** — caused by
   §6b's own status-filter fix. Restricting the sales half to `data.shops` is
   only correct if that is every shop, and the reader narrows the `shops` read
   by registration date. Five shops that sold in October but registered in
   August vanished from an October report, with or without a status filter.
   That report now reads every shop; the period still bounds the sales.

5. **Two Analytics series ignored the validated range**, so an October query
   drew January growth and February cancellations beside October activity.
   Four charts on one page, each about a different period.

6. **Maps' "Subscription status" filter filtered commercial status**, offering
   only `active` and `suspended`. A trialing pharmacy answered to "active", and
   the trialing, past_due, grace, canceled and expired cohorts could not be
   asked for at all. The map now carries each shop's real subscription status
   from its entitlement snapshot, and offers all six lifecycle statuses plus
   "no subscription" — which is its own cohort, not an expired one.

7. **The Admins security history dropped real events.** Its de-duplication key
   was `at + actor + action`, which is not an identity: two revocations of
   different targets in the same millisecond became one row, and a DENIED
   attempt collapsed into the success beside it. The per-prefix concatenation
   that made de-duplication necessary is gone, so nothing needs removing.

8. **The `net` provenance guard still accepted fabricated figures.** §6b's fix
   required a derivation token but tested CO-OCCURRENCE over the whole file.
   `netSalesToday`'s required token was its own name, so `const netSalesToday =
   42` passed trivially; and a fabricated pharmacy anchor passed in any file
   that mentioned `pharmacySalesByMonth` anywhere, for any reason. The check is
   now per BINDING: wherever an anchor is assigned a value, the derivation must
   be in the same statement.

### What this round changes about how to read this record

§6b closed by saying "a test that compares the wrong two things passes for the
wrong reason". This round adds the sharper version: **four of its fixes had
tests, and the tests passed, because they asserted what the fix did rather than
what the requirement was.** The revocation test asserted that the right role
was written — which is exactly the behaviour that was wrong. The provenance
guard asserted that two names appeared — which a fabrication satisfies.

So each fix in this round is accompanied by a test that is **run against the
previous behaviour** and fails on it:

- the revocation's regression test applies the recorded UPDATE to a
  concurrently-disabled row, and a negative control applies the FIRST FIX's
  shape to the same row and shows it coming back as an enabled `super_admin`;
- the k=5 tests assert the figure at k-1 AND at k, so a page that simply never
  shows the figure fails;
- the provenance mutation runs all three fabrications through the guard, and
  asserts the old co-occurrence check accepted one of them;
- the audit-history mutation runs the old de-duplication key and shows it
  returning one row where two events happened.

Nothing in this round is device-verified or hosted-verified. **Gate E15 remains
open and no page here is DONE** — see §7.

---

## 6d. The SECOND delta review — three more, two of them again mine

The review of §6c's fixes returned **REVISE with three findings** (1 P1, 2 P2).
**Two said a §6c fix was still incomplete**, and one was a new regression §6c
had introduced. The reviewer reproduced all three in memory against the real
files.

1. **P1 — the revocation could report success without revoking.** §6c's fix
   made the UPDATE safe, and then mishandled the zero-row case: finding ANY row
   afterwards was taken as "already revoked at or past this point". A
   concurrent first INSERT lands a row whose cutoff is `null` or earlier, so
   the function returned `already_later`, the caller audited **success**, and
   every existing session stayed valid. A revocation that reports success
   without revoking is the worst outcome this operation has. It now returns a
   success effect only when it moved the cutoff itself, inserted the row
   itself, or **read a cutoff at or past the one requested**; anything else is
   retried, and exhausting the attempts throws. Failing closed is right: the
   caller turns a throw into an audited failure, which is true, where
   `already_later` was false.

2. **P2 — §6c's report fix unbounded the Analytics registrations chart.**
   Widening `activity_summary`'s shops read (so the report stopped dropping
   established sellers) also widened what the registrations series grouped,
   because that series never reapplied the period. An October query drew an
   August bucket with five contributors. There is now ONE period predicate on
   that page, used by every bucket, so a read that widens again cannot silently
   unbound a chart.

3. **P2 — the provenance guard still accepted fabricated money.** §6c's
   per-binding check exempted "a right-hand side starting with a capital" as a
   type annotation — which `GROSS_TOTAL` satisfies. The reviewer took the real
   Revenue page, replaced only the derivation with `const GROSS_TOTAL = 42;
   const pharmacyNetSalesPaisa = GROSS_TOTAL;`, and the guard **and** link 2b
   both passed it. Only a `:` can introduce a type and a `=` never can, so the
   binding operator is now captured, and the `:` case is an explicit list of
   declarable types rather than a shape. Link 2b now also requires the page's
   binding to be clean, instead of merely containing two names.

**Three rounds, and the same shape each time:** the fix was sound where I was
looking and wrong one step to the side. Round 1 fixed the write and left the
read-then-write race. Round 2 fixed the race and left the zero-row branch.
Round 2 fixed the report and broke the chart that shares its read. Round 2
required a derivation token and left an exemption that any SCREAMING_CASE
constant satisfies.

Each of the three is mutation-verified: reverting the cutoff check fails three
tests, reverting the registrations filter fails one, and the two new fabricated
money mutants fail against the old exemption.

---

## 6e. The THIRD delta — one finding, and a method that was wrong

The review of §6d's fixes returned **REVISE with one P2**. The P1 revocation
fix and the registrations fix were accepted. The provenance guard was not, for
the **fourth** time, with two new bypasses the reviewer reproduced against the
real Revenue page:

- `const { totalPaisa: pharmacyNetSalesPaisa } = { totalPaisa: 42 };` — in a
  destructuring RENAME the anchor sits after the colon, so a regex looking for
  the anchor followed by `:` or `=` found **no binding at all** and had nothing
  to check;
- `const pharmacySalesByMonthGross = 42; const pharmacyNetSalesPaisa =
  pharmacySalesByMonthGross;` — `String.includes` is a substring test, and
  that identifier **contains** the required derivation token.

Four attempts at one guard, each closing the form in front of it and leaving
the one beside it: co-occurrence over a file; an anchor whose token was its own
name; an uppercase initializer read as a type; and now a rename and a substring.

**The lesson is not "write a better regex".** A regex over source text cannot
soundly answer *is this value derived from that expression* — the question is
about syntactic structure, and a pattern match is the wrong instrument for it.
The guard now parses, with the TypeScript compiler that already builds this
project:

- a binding is a `VariableDeclaration`, a `BindingElement` (which is what a
  destructuring rename **is**), a `PropertyAssignment`, or an assignment
  expression whose target is the anchor;
- a `PropertySignature` declares a type and binds no value, so
  `netSalesToday: Paisa;` needs no derivation — and the allow-list of
  "declarable types" that §6d introduced is **gone**, because the parser knows
  the difference without being told;
- the derivation must appear in the initializer as a whole IDENTIFIER or
  property name. `pharmacySalesByMonthGross` is simply a different identifier
  from `pharmacySalesByMonth`, which no substring test can know.

Three things are asserted about this rather than claimed. The reviewer's two
replacements are applied to the **real** `app/revenue/page.tsx` source and the
guard refuses both while accepting the page as shipped. The regex finder is
reconstructed and **run**, showing it returns zero bindings for the rename —
so "a regex cannot do this" is demonstrated, not asserted. And the substring
collision is shown explicitly: `includes` says yes, the whole-identifier
comparison says no.

---

## 6f. The FOURTH delta — and the guard was inverted

Two more P2s, both on the same guard, both reproduced against the real Revenue
page:

- `42 as (typeof result.pharmacy.pharmacySalesByMonth)[number]['totalPaisa']`
  — the identifier walk descended into the TYPE node, so a type annotation
  supplied the derivation token for the literal `42`;
- `totals.pharmacyNetSalesPaisa = 42` — only an assignment to a bare
  identifier was modelled, so a write through a MEMBER escaped entirely.

That is five rounds, and §6e's "change the instrument" was only half the
lesson. Parsing was the right instrument; **the logic was still a blacklist.**
Four of the five breaks were me enumerating ways to fabricate a number — and
that set is unbounded, while the set of LEGITIMATE derivations in this entire
repository is **two**:

| Anchor | Where | Derivation |
|---|---|---|
| `netSalesToday` | `lib/queries.ts:156` | `netSalesPaisa(grossSalesToday, refundsToday)` |
| `pharmacyNetSalesPaisa` | `app/revenue/page.tsx:176` | the `reduce` over `pharmacySalesByMonth`'s tallied totals |

So the question is **inverted**. A binding passes only if its initializer is
one of those two pinned expressions, compared whitespace-insensitively.
Everything else fails by default — including forms nobody has thought of yet.
That is fail-closed by construction instead of by exhaustive enumeration, and
it is the only version of this guard that does not invite a sixth round.

Detection still has to be complete, because an unmodelled binding SITE is now
the only way past. The modelled sites are: a variable declaration, a binding
element (destructuring, including a rename), an object-literal property, and an
assignment under any assignment operator to a bare identifier, a member, or an
element access with a literal name.

Two further things were fixed in the test itself, both found by writing it:

- the mutant loop asserted one fabrication at a time, so the **first** failure
  aborted the test and a newly-opened bypass could hide behind an older one. It
  now collects every accepted fabrication and reports them together — which is
  how the two new bypasses were confirmed to be bypasses of the previous check
  (it accepts exactly 2 of the 11; the whitelist accepts 0);
- the "real shapes still pass" cases were source FRAGMENTS, which are
  meaningless against a whitelist comparing complete initializers. They are now
  four real FILES, plus a non-vacuity check that every pin is actually matched
  by a binding somewhere in the tree — so a pin that silently stops protecting
  anything fails this test rather than passing quietly.

**The cost, stated:** a legitimate change to either derivation fails this test
until its pin is updated. That is the correct friction for the one guard
standing between a fabricated number and the word "net".

---

## 6g. The FIFTH delta — six holes in detection, and the answer that ends it

I asked the reviewer to attack DETECTION, since a whitelist of derivations
makes fabrication FORMS irrelevant but leaves an unmodelled binding SITE as the
only way past. He found six immediately:

1. **the scanner's own input was corruptible** — comments were stripped with a
   regex that deleted everything after `//` on a line, so a string literal
   CONTAINING those two characters truncated the line and hid the code after
   it: `{ pharmacyNetSalesPaisa, note: "//" }; totals.pharmacyNetSalesPaisa =
   42;` vanished before any check ran;
2. quoted and computed property names (`{ "pharmacyNetSalesPaisa": 42 }`);
3. class fields and enum members;
4. parenthesised, asserted and non-null-asserted assignment targets;
5. array/object destructuring targets and for-of loop writes;
6. prefix and postfix updates (`totals.x++`).

Finding 1 is the serious one, and it is a repeat: **this repository already
learned in the H-9 source scanner that a regex cannot tell a comment from a
string**, and the fix there was the same fix as here. Comments now come from the
PARSER's own trivia ranges. A raw `ts.createScanner` loop was tried first and
desynchronised partway through a file — `reduce<Paisa>(` under the JSX variant
was enough — after which later comments were handed back as ordinary tokens;
that near-miss is recorded in the code, because it passed 36 tests while
silently scanning comment prose as code.

Findings 2-6 are six more write syntaxes, and TypeScript has more. So rather
than keep enumerating, the guard gained a second layer that **no write syntax
can dodge**: the anchors' OCCURRENCES are pinned, file by file, count by count.

| Anchor | File | Occurrences |
|---|---|---|
| `netSalesToday` | `lib/platformStats.ts` | 1 (the type) |
| | `lib/queries.ts` | 1 (the assignment) |
| | `app/page.tsx` | 1 (the read) |
| `pharmacyNetSalesPaisa` | `app/revenue/page.tsx` | 2 (the binding, the read) |

Five mentions in four files. Every fabrication, whatever its shape, must
mention an anchor in order to bind it — so any NEW mention anywhere fails, and
any mention that DISAPPEARS fails too, which is what would have caught finding
1 on its own. Eleven write forms are run through this check and each is shown
to add an occurrence; a comment mentioning an anchor is shown NOT to.

The classifier was also extended for the cheap cases (2, 3, 4 and 6), so the
failure message names the construct. Findings 5's exotic targets are caught by
the occurrence pins rather than the classifier, and that division is stated in
the code rather than left as a silent gap.

**The whole guard now has two independent layers:** what a binding may be
(pinned derivations) and where an anchor may appear at all (pinned
occurrences). Both are whitelists; both fail closed; neither requires anyone to
predict the next syntax.

---

## 6h. ROUND 9: the guard FAILED and needs redesign. Batch 3 is NOT accepted.

Round 9 was a focused adversarial review of the write-position invariant.
**Verdict: REVISE, with three accepted financial substitutions confirmed by
React SSR, and a redesign requirement.** This section exists so the state is
recorded as it is, not as I had hoped.

### What renders wrong money

| Reproduction | Renders |
|---|---|
| Dashboard: `const s = stats; Object.assign(s, { ['net' + 'SalesToday']: s.grossSalesToday });` | **৳100.00 gross** where ৳80.00 net belongs |
| Revenue: suppression input becomes `((_amount: number) => Number(collectedTotalPaisa))(pharmacyNetSalesPaisa)` | **৳230.00 collected payments** under the pharmacy-net label |
| Dashboard: `value={((_: string) => formatMoney(stats.grossSalesToday))(formatMoney(stats.netSalesToday))}` | gross under the net caption |

All three leave the occurrence counts and the pinned derivations intact, pass
**all 45 guard tests**, and produce **zero TypeScript diagnostics**.

### Why, and the claim of mine that was false

I stated in the review brief that all three layers fail closed. **Layer 3 does
not.** `roleOfOccurrence` ends in `return 'read'`, so a path it does not
recognise is treated as a READ -- default-allow, not default-deny. That is the
precise failure mode I had asked the reviewer to hunt for, while asserting the
opposite about my own code.

The deeper reason is not a missing case. Two of the three reproductions are not
exotic syntax at all:

- `'net' + 'SalesToday'` constructs the property name from two string literals,
  so **no name-based scan can see it**. Not with more layers.
- an identity-shaped function call launders the value across a boundary, which
  a local syntactic check cannot follow.

**Local syntactic occurrence checks cannot establish rendered-value
provenance.** Nine rounds is now evidence rather than opinion, and my belief
that layer 3 was "different in kind" was wrong.

### A false positive, too

```ts
const cache: Record<string, string> = {};
cache[formatMoney(stats.netSalesToday)] = 'cached';
```

Only `cache` is written; the anchor supplies its key. Layer 3 reports a write,
because the ancestor walk does not distinguish "I am the assignment target"
from "I am inside the target's key expression". So the guard is simultaneously
too weak and too strict.

### Status

**Batch 3 is NOT accepted and nothing has been pushed.** The remediation plan
is in §6i. Per CLAUDE.md rule 10, the plan touches money and therefore waits
for the founder's explicit approval before any code is written.

---

## 6i. The bounded remediation plan

The reviewer's plan, which I agree with, in the order that each step closes a
specific reproduction:

1. **An opaque, immutable net amount.** `netSalesPaisa` becomes the only
   producer of a branded net value, preserved through `lib/queries.ts`, the
   monthly totals in `lib/adminPlatformQueries.ts`, and `suppressBelowK` (which
   is already generic and should carry it unchanged). This closes
   reproductions 2 and 3 **at compile time**: `Number(collectedTotalPaisa)` and
   a plain formatted string are not that type.
2. **A dedicated net renderer** that accepts only that type, owns its own
   formatting and caption, and **verifies authenticity at runtime** -- a
   module-private registry, so a value substituted into the field by
   `Object.assign` is not a registered net amount and the renderer fails
   closed. This is what closes reproduction 1, which no static check can.
3. **Compile-negative and render regressions.** Assert that each gross,
   collected and helper-laundered substitution produces TypeScript
   diagnostics, and assert the rendered money through SSR on both real pages.
   The source scans stay as supplementary checks, not as the guarantee.
4. **The false positive**, separately and cheaply: distinguish the assignment
   TARGET from an expression inside the target's computed key.

Scope: `netSalesPaisa`'s home package, `lib/platformStats.ts`,
`lib/queries.ts`, `lib/adminPlatformQueries.ts`, the money renderer in
`components/`, `app/page.tsx`, `app/revenue/page.tsx`, plus the new tests.
**This is money-path production code, so it is a rule-10 approval gate.**

---

## 6j. ROUND 10: the redesign was right, and I had applied it to ONE of three sinks

Round 10 reviewed the §6i remediation as committed in `8efd8bf`, `6d1f432` and
`84bfac5`. It did not accept it. It found three further ways to publish the
wrong money under a pharmacy-net caption, reproduced through the real pages,
and all three are the SAME defect one step to the side of where I had looked.

| # | Sink | What the reviewer substituted | What the page published |
|---|---|---|---|
| 1 | the Analytics chart series | the generic `toPoints` selector, `(bucket) => number`, became `((_: number) => 230)(netSalesAmount(bucket.totalPaisa))` | a net month of ৳80.00 plotted as ৳230.00 |
| 2 | the Reports CSV export | `sumPaisaOf(monthSales)` -- a GROSS sum -- placed between `netSalesAmount` and `exportTaka` | ৳400.00 exported as ৳500.00 |
| 3 | `NetSalesCard`'s `metric` prop | the resolved manifest entry spread, with only `label` replaced | an authentic net figure captioned "Monthly recurring run rate" |

The diagnosis, in one sentence: **provenance has to end at the OUTPUT, not at
the unwrap.** `netSalesAmount` returns a plain `Paisa`, so every line after
that call is outside the guarantee. §6i put the unwrap inside the card and
stopped there -- the chart and the export still unwrapped into an open
expression, and the card still took an OBJECT, which is an indirect caption
prop. Findings 1 and 2 are the shape of the original reproduction C; finding 3
is the shape of reproduction B. Neither was fixed, only moved.

### What changed

- `netChartPoints` and `netExportTaka` in `packages/utils/src/netSalesSinks.ts`
  take the opaque amount and own the ÷100 and the decimal formatting
  themselves. There is no numeric selector to substitute, and a suppressed
  bucket is `null`, never zero. The net series no longer goes through
  `toPoints`; the gross and collected series still do, correctly.
- `NetSalesCard` takes `metricId: NetSalesMetricId` -- one of two literal ids --
  and resolves the canonical entry itself with `requirePharmacySalesMetric`.
  A caller cannot supply a label, cannot edit one, and cannot name a metric
  outside the pharmacy-takings family: the union rejects it at compile time and
  the resolver re-checks the family at runtime. `NET_SALES_METRIC_IDS` is
  asserted equal to the manifest's `pharmacy_sales` family, so the union cannot
  silently drift from the thing it claims to describe.
- `netSalesAmount` stays, for the one deliberate boundary that needs it:
  `apps/mobile/db/reports.ts` unwraps immediately into SQLite-backed local
  arithmetic, which is outside the admin money path.

### Two flaws in my own evidence, corrected rather than worked around

1. The "the card has no caption prop" assertion scanned the WHOLE card file and
   fired on the private `ProvenanceFailure`'s own `label: string` -- a prop no
   caller can reach. A guard that cannot tell a public prop from a private one
   is not checking what it claims to. It now reads `NetSalesCardProps` only,
   and checks more: no label, no value, no metric object, and the entry
   resolved internally.
2. The compile-negative harness built one `ts.createProgram` per case. A single
   program costs about 5.5s because it loads `lib.d.ts` and the real packages
   -- which is the point, a stubbed fixture would not be testing the shipped
   type -- so seven meant roughly 38s against Vitest's 5s default and the first
   test timed out. One shared program over seven fixture files, diagnostics
   mapped back per file: 1.33s. No assertion changed, and the per-test timeout
   now declares the compiler's real cost instead of hiding it.

### Evidence on `ac8c9bd`

| Check | Result |
|---|---|
| `apps/admin` + `packages/utils` | 39 files, 1348 tests, 0 failed |
| full repository suite | 289 files, 6567 tests, 0 failed, exit 0 |
| `tsc --noEmit` (admin, utils) | 0 errors |
| `eslint .` | 0 problems |
| `turbo run lint typecheck` | 14/14 |
| `next build` | exit 0 |

---

## 6k. ROUND 11: five HIGH and three MEDIUM, and the lesson applied a third time

Round 11 reviewed `ac8c9bd`. It did not accept it. Eight findings, all real,
all fixed in `5f36b3d` and `de95ebb`. The reviewer's own summary of the net
work was exact: *"Card fix holds. Chart/export helpers still stop before
output."*

### The two that are §6i again

| # | Sink | What the reviewer substituted | What was published |
|---|---|---|---|
| 3 | the Analytics chart | `netChartPoints(salesBuckets).map((point) => ({ ...point, value: 230 }))` -- and, separately, `format={(_value) => "230.00"}` and a heading swapped for `requireMetric('mrr').label` | ৳80.00 plotted as ৳230.00; the table beside it falsified; authentic net money captioned "Monthly recurring run rate" |
| 4 | the CSV **and PDF** export | `((_: string) => exportTaka(sumPaisaOf(monthSales)))(netExportTaka(total))` | ৳400.00 exported as ৳500.00 under "Pharmacy sales, net of refunds (BDT)", zero diagnostics, no forged box |

Round 10's sinks took opaque amounts and owned the conversion. They then
handed back a **plain array** and a **plain string**, and the caller owned
everything after that. The boundary had moved one step three times running, so
"the output" had to be defined as the thing a human actually reads:

- the EXPORT cell is now opaque. `netExportCell` mints a registered, frozen
  cell; `netCellText` is the only reader and it verifies first. A report column
  the definition declares as refund-net money is resolved through that function
  on the rows that **become the bytes**, so a plain string standing there
  throws. Suppression mints `withheldNetCell()` rather than `''`: accepting a
  bare empty string would have meant teaching the verifier to accept plain
  strings, which is the hole it exists to close.
- the CHART goes through `components/NetSalesTrend.tsx`, shaped exactly like
  the card this same review confirmed holds. Opaque buckets and a metric ID in;
  no prop for a number, a formatter or a caption.

**What is still not enforced, stated rather than implied away.** No type stops
a page from rendering some other component and captioning it by hand. What is
enforced: the canonical net caption resolves in exactly one place per renderer,
and a `NetSales` cannot become a number or a string anywhere else. The source
scan is a review aid, not the guarantee — that distinction is the whole history
of §6i.

### The two privacy findings, which were worse

**Finding 1 — the Dashboard had no k floor at all.** With one contributing
pharmacy it rendered ৳80.00, and its composition line carried gross ৳100.00
and refunds ৳20.00, while Analytics withheld that same bucket. One verdict now
gates three outputs, because each discloses the others: the headline, the
composition (gross less refunds **is** the amount), and today's active-pharmacy
count (a count of 1 beside a withheld figure names the pharmacy whose takings
were withheld — Gate 5 finding 4 restated). The contributor set is collected
from the same two reads that produce the figure, and counts the refund side as
well as the sales side.

**Finding 2 — overlapping periods defeated the floor.** Five pharmacies take
৳500 on October 1; one takes ৳80 on October 2.

```
October 2 alone  -> withheld (one contributor)
October 1 alone  -> 500.00
October 1 to 2   -> 580.00        580 - 500 = the withheld 80.00
```

Both requests are individually legitimate, so per-request suppression could
never have stopped this. The fix is that **a published bucket no longer depends
on the request**: a month-grained report answers only for whole months and
refuses a part-month range, rather than snapping outward and contradicting its
own caption. And a total is gated by **composition**, not by its union of
contributors — Revenue's all-time total was released while a month inside it
was withheld, and a visible total minus the visible months is the withheld
month.

The residual is recorded in `adminSuppression.ts` rather than hidden:
differencing along dimensions other than the period — two status-filtered
queries whose difference is a small group — is the general query-auditing
problem and is **not** solved. The period dimension is closed.

### The audit pair, which were scope rather than safety

**Finding 5.** §8.9's durable sink was written and never read. `/audit`,
`/admins`, `/support` and `/subscriptions` all rendered the in-process ring, so
the history a reader saw was whatever that process had done since it started:
different on another instance, empty after a restart. Applying migration 35
could never have supplied the missing reader. `readAdminAuditLog` reads the
table, bounded at 500, newest first, filtering by action prefix server-side —
one query per prefix, because a dotted pattern inside a PostgREST `or` filter
is exactly how Gate 5 finding 6 made the Action filter unusable. A failed read
**throws**; the pages fall back to the ring only behind a visible notice that
names gate E4-H, never silently.

**Finding 6.** `audit.export` was declared in the permission list, granted to
`super_admin` alone, documented in §4.4 — and checked by nothing. A permission
with no enforcement point is not an access control. `app/api/audit/export/route.ts`
re-checks the permission itself, audits its own export and awaits that write
before sending any bytes, and returns 503 rather than exporting a short file
that would look complete. The guard written for it asserts the **class**: every
name in `ADMIN_PERMISSIONS` must be enforced by shipped code, and it would have
failed at the previous HEAD.

### The two reporting-honesty findings

**Finding 7.** Snapshot reports printed whatever range was requested while
their builders ignored dates entirely, so five subscriptions begun in October
2026 appeared beneath "2020-01-01 to 2020-01-02" and read as historical
evidence. They refuse a period now instead of claiming one.

**Finding 8.** Collected payments bucketed on the **UTC** month. Five payments
verified at `2026-09-30T20:00:00Z` are October 1 in Dhaka, and an October
report exported `2026-09,500.00,5`. Both the totals and the contributor
grouping use the Dhaka month, derived from `dhakaDayLabel` so a month can never
disagree with the day inside it.

### Three flaws of my own, and one wrong number

1. Two assertions fired on my own explanatory **comments** — the third time.
   Those comments document each exploit by quoting it, so rewording them was
   the wrong fix; the "this call is gone" assertions now read code only,
   through the parser's own trivia ranges.
2. One test asserted that `2026-02-29` reached the month-end gate. It does not:
   the shared query schema rejects an impossible calendar date first, which is
   the better layer. The test now records the division of labour.
3. I told the reviewer that `vitest.config.ts` had gained "exactly one line"
   across §6i. It gained **six** — one `include` entry and a five-line comment.
   The substantive change is the one entry, but the number I gave was wrong.

Also corrected while checking the outgoing range: `.gitattributes` claimed the
E4 source hashes live in `audit-artifacts/e4/`, a path that cannot exist
because `.gitignore` ignores `audit-artifacts/` wholesale. The manifest is at
`backend/supabase/migrations/e4-source-hashes.json`, and
`scripts/e4-evidence-manifest.mjs` already recorded why. A comment nothing
reads had been pointing an auditor at nothing.

---

## 6l. ROUNDS 12-15, and the founder decision that closed the privacy question

Four more rounds followed §6k, and the shape of all four was the same defect
class: **verification that stops one step short of the output.**

| Round | Findings | What the money defect actually was |
|---|---|---|
| 12 | 10 | `netChartPoints` and `netExportTaka` handed back a plain array and a plain string; the page owned everything after them |
| 13 | 9 | the public `ReportTable.rows` was plain text, substitutable at the handler, so both serializers returned 200 with a forged figure |
| 14 | 12 | `reportId` drove verification while `title` and `columns` carried the caption independently, so one could be replaced and the other kept |
| 15 | 7 | the k-anonymity composition rule was keyed to days the Dashboard publishes, and the disclosure came from a different page entirely |

Round 14 produced the structural answer rather than a fifth position for the
same check. A report table is now **minted**: `buildReportTable` freezes it,
registers it in a module-private `WeakSet`, and records what the module itself
computed in a `WeakMap`. Every output path - the CSV, the PDF and the
on-screen table - reads the `WeakMap`, so the public `table.rows` is a
convenience that nothing trusts. A symbol-keyed brand would not have done
this: a brand survives spread, `Object.assign` and `structuredClone`, and a
`WeakSet` membership does not.

### The disclosure round 15 found, and why no further patch could fix it

Codex reproduced this against the real pages:

> Five pharmacies each sell 100.00 today; one refunds 80.00. The Dashboard
> withholds its net figure. The five shop drill-downs each publish **Gross
> sales today = 100.00** (`app/shops/[id]/page.tsx:196`; `shops.read` is held
> by all four roles). The monthly report publishes **420.00**, in CSV and PDF.
> 500 - 420 = **80.00**: the withheld refund, recovered through ordinary page
> access.

And then the second half, which is the part that cannot be patched: a figure
published **yesterday** is still remembered. Keying any rule to "today" was
never sound, because midnight does not erase a disclosure.

Stated precisely, because it decides the rule: **per-shop GROSS is visible by
design** (accepted 8.2 functionality). **Per-shop REFUNDS are visible
nowhere.** Net = gross - refunds. So a published net figure, standing beside
visible gross figures, can only disclose refunds.

The rule is therefore: a month publishes only if **every day's refund side**
has at least k distinct refunding pharmacies.

### FOUNDER DECISION, 2026-10-29: Option A

Three options existed and only one of them was a code decision:

| | Option | Consequence |
|---|---|---|
| **A** | Keep the refund-side rule | No disclosure. Monthly net figures mostly withheld until the platform has enough pharmacies |
| **B** | Remove "Gross sales today" from the drill-down | Net aggregates publish freely - but deletes accepted 8.2 functionality |
| **C** | Accept the disclosure | Aggregates publish freely; an admin can derive any single pharmacy's refunds, and k=5 stops being a confidentiality claim |

**The founder approved Option A** on 2026-10-29, directing that per-shop Gross
Sales Today be preserved and that conservative k=5 suppression be maintained.
B and C are refused.

### The Beta-scale limitation, stated as the founder required

At Beta scale - about ten pharmacies - almost no single day has five distinct
**refunding** pharmacies, because refunds are much rarer than sales. The
consequence, expected and accepted:

- the **W4-04 monthly net report** (`refund_net_pharmacy_sales`, CSV and PDF)
  will be **withheld on most months**;
- the **Analytics net series** will be **withheld on most months**;
- the Dashboard's net-today figure is withheld whenever either side of the day
  is below k.

This is not a malfunction. It is k-anonymity returning the correct answer for a
population in which five contributors genuinely do not exist. Each withheld
figure is rendered as an explicit withholding with its reason, never as a zero
and never as a blank that could be mistaken for no activity.

### What is NOT claimed

Per the same founder directive: **no claim of mathematical anonymity is made
here.** The rule is a conservative suppression policy. Cross-page inference,
historical release, repeated querying and differencing have been examined
adversarially across rounds 11-15 and each round found something, which is
precisely why the claim is withheld until an independent review of those four
attack classes comes back without a finding.

---

## 6m. The DUAL-AGENT round, and the four decisions it leaves with the founder

The founder replaced the review process on 2026-10-29: Codex reviews **and
implements**, Claude independently reviews and corrects, Codex reviews the
corrections, and neither agent may accept code it wrote without the other's
subsequent review. What follows is the first full pass of that protocol.

### What the coverage measurement found first

Before any new review, the fourteen saved Codex transcripts were measured by
extracting the command line of every `exec` block and collecting the repository
paths in it (`docs/plans/muthoy-batch-3-independent-review-coverage-2026-10-29.md`).
Three things came out of that:

1. **Four route files had never been named in a single `exec` command** in any
   round: `app/login/page.tsx`, `app/api/admin/session/route.ts`,
   `app/accounts/page.tsx` with `accounts/[id]`, and `app/payments/page.tsx` --
   plus `lib/adminOutcomes.ts`, the module the last two render.
2. **No Codex round ever executed a test.** `spawn EPERM` appears in all
   fourteen transcripts; a probe found the cause, which is that esbuild cannot
   spawn its service binary inside that sandbox, in read-only and in
   workspace-write alike. Every test figure in this batch is Claude's
   measurement alone and has never been independently reproduced.
3. The direction of attention had been Claude's, and it was narrow: fourteen of
   fourteen rounds centred on money or privacy.

### Round 1A: the auth boundary, and a test that never tested

Codex returned 13 findings (2 HIGH, 9 MEDIUM, 2 LOW) and implemented all of
them. The two HIGH were in the area the measurement had just named: logout
cleared the browser cookie and left copied sessions usable, and mobile
hydration and device linking continued after an owner handover.

Claude then ran the tests Codex cannot run, and the first thing they did was
fail -- which is the protocol working. `middleware.test.ts`'s
"a cookie idle for more than 30 minutes is refused" had built its cookie by
back-dating `lastSeen` through `touchedSessionPayload`, leaving `lastSeen`
before `iat`; `adminSession.ts` refuses that pair as `malformed` eleven lines
above the idle check. **The 303 it asserted came from the nonsense rule, and
the idle rule was never once exercised through the middleware.** Codex's
monotonic refresh turned that construction into a valid cookie and the test
finally said so.

Three further corrections from Claude: a 4 096-byte body ceiling, because
moving the source budget below the logout branch left `readFields` reachable
without spending budget; removal of `publishedMoneyDays`, which had been
**dead on a money path** since round 15 and was still threaded through
`buildReportTable` and still passed by both pages; and a config refusal that
names the offending username, because it now fails the whole panel closed at
boot on a value that previously logged in.

### Round 1B: the four attack classes, and CLAIM NOT SUPPORTED

The founder required that no claim of mathematical anonymity be made until
cross-page, historical-release, repeated-query and differencing attacks had
been independently examined. Codex examined all four and returned **CLAIM NOT
SUPPORTED**, with seven disclosures and executable evidence
(`scripts/review/admin-privacy-round1b.cjs`; its own write-up is
`docs/plans/admin-privacy-round1b-review-2026-10-30.md`).

Two were closed immediately, because they needed no decision:

- **THE AUDIT LOG WAS A MONEY PUBLISHER.** `apps/mobile/db/refunds.ts` writes
  `action: 'sale_refunded'` naming the refunded sale, and `shopAuditPage` shows
  it per shop beside a published gross. Refunds are full refunds of one sale,
  so the row IS the refund amount. Fifteen rounds of money suppression never
  looked, because the read was classified as an AUDIT surface and audit
  surfaces were reviewed for authorization and redaction, never for arithmetic.
  Now excluded from the page AND the count, since a count would publish how
  many refunds a pharmacy made.
- **A DOWNLOADED CSV COULD NOT STATE ITS OWN WITHHOLDING**, and the caption for
  a withheld activity count named the side that had NOT failed. Both fixed. The
  CSV fix also exposed that `parseCsv` could not read this panel's own BOM-
  prefixed exports, which is the shape Excel writes into the inventory import.

### The four that remain, and the exact decision each needs

**These are not deferred defects. They are decisions that change the meaning of
an approved guarantee, and the authorization to make them is the founder's.**

**1. k on contributor count is the wrong control while per-shop gross is
public.** Ten shops with distinct known gross -- 1, 2, 4 ... 512 -- publish
1 023; a published net of 682 gives refunds of 341; exactly one of the 1 024
subsets sums to 341. k counts how many shops refunded and says nothing about
which. **Raising k does not close this.** Three approved things collide:

| | Approved requirement |
|---|---|
| §8.2 | per-shop gross is published (and Option A kept it) |
| W4-04 | refund-net revenue is PUBLISHED |
| §8.10 | k=5 confidentiality |

Any two can hold. The decision is which one yields. The measured cost of
withholding refund-derived aggregates outright is near zero today: at beta
scale **0 of 5 monthly net outputs already answer**, while per-shop gross stays
310/310.

**2. Mutable releases.** The same whole-month query answered 457, then 450
after one further refund; the difference is that refund. Refunds bucket by
their own `businessDate` (`adminReports.ts:1049`), so a month is stable once it
ends -- **except** that offline-first sync delivers late rows carrying their
original dates, so a past month can still move until every device has synced.
Closing it completely needs either the published figure STORED so it can be
frozen -- new state, therefore a migration, therefore blocked by the H-9
migration-chain seal -- or a freshness lag before a month may publish. The lag
is a product decision about how current these reports are allowed to be.

**3. A zero refund side.** `sideReleasable` treats an empty side as releasable,
so the Dashboard can publish "refunds 0.00" beside ten sellers, which tells a
reader that every one of them refunded nothing. Recorded here as a KNOWN EDGE
rather than withheld: at beta scale withholding it would blank the Dashboard's
money card on most days, and "no pharmacy had a refund today" is the most
common state there is. This is consistent with §6l's withdrawal of any
anonymity claim -- it is stated, not claimed away -- and if the founder wants it
withheld, that is a one-line change.

**4. Is k meant to cover Muthoy's OWN billing money?** `/payments` publishes a
verified payment order that its own report withholds, and subscription prices
are visible per account. The inconsistency is the defect either way. §8.10
reads as pharmacy confidentiality, and a payment order is Muthoy's record of
its own revenue, which would make the page right and the report
over-withholding. But resolving it that way REMOVES suppression from a money
report, and this document does not get to weaken a stated control to tidy an
inconsistency.

### What acceptance can and cannot mean here

Dual acceptance in this environment means two independent **code** reviews plus
Codex's read-only Node probes, which have reproduced real defects in every
round including this one. It does **not** mean two parties measured the test
suite, because Codex cannot execute one. Any final report must say that in
those words.

---

## 6n. THE FOUR FOUNDER DECISIONS of 2026-10-30, and what each one changed

§6m left four questions with the founder. All four came back decided. This
section records what was decided, what the code now does, and the one blocker
that survives.

### DECISION 1 — Option B approved: per-pharmacy gross is removed

The founder approved changing accepted §8.2 scope. Removed:
`app/shops/[id]/page.tsx`'s **Gross sales today** tile, the
`grossSalesTodayPaisa` field on the shop-detail view, and its computation in
`lib/adminQueries.ts` — the figure is not produced, not only not shown, because
a value this reader still returned would be one a future caller could render.

**Preserved**, as the decision requires: pharmacy owners see their own sales in
their own POS; W4-04 refund-net reporting still exists and still computes;
§8.10 confidentiality is unchanged; and the per-shop **sale COUNT** stays,
because a count is not an amount and it answers an operational question support
genuinely has. That last one is a judgement, stated as one in the code so the
next reviewer can attack it.

**The correlated-surface sweep** the decision asked for found that the
drill-down was the only per-pharmacy money surface in the panel:
`/pharmacies` renders no money at all, both money reports are platform
aggregates, and the two guards in `lib/adminLabels.test.ts` that previously
pinned the gross LABEL now assert the absence of money at both the page and the
reader layer.

**`sale_refunded` is now in the financial privacy threat model**, not filed as
an audit-authorization matter. The audit rows are NOT deleted or rewritten —
`shopAuditPage` applies `not('action','in','(sale_refunded)')` to the page and
to the count, which is presentation redaction and data minimisation over an
intact record, exactly as the decision directs.

**Historical gross disclosures still bind.** Figures published before today are
part of what a reader may already know, so no previously suppressed period is
released on the strength of the gross card having been removed. The suppression
rules were not relaxed anywhere in this change.

### DECISION 2 — stable publications, and the blocker that remains

A freshness delay was explicitly ruled insufficient, and the investigation
confirms it cannot be made sufficient here: refunds bucket by their own
business date, so a month is stable once it ends **only if every device has
synced**, and Muthoy is offline-first by design. `shops.updated_at` is a
last-write-wins client timestamp and cannot prove a device had nothing older
queued.

So the interim posture is **suppression**, stated once in
`lib/adminSuppression.ts` as `PUBLICATION_IS_REVISION_SAFE = false`, and
applied to pharmacy **money** at four surfaces: the report layer's refund-net
columns, the Dashboard's net today, the Analytics net series and the Revenue
all-time total. **Money only** — a registration or activity COUNT is not a
"confidentiality-sensitive financial aggregate", and withholding those would
hide operational facts for no privacy gain.

`buildReportTable` regained an options parameter carrying `revisionSafe`. It is
worth being explicit that I deleted an options parameter from this same
function earlier the same day for being dead: this one is **read on every
build**, and the tests that pass `true` are precisely the ones whose subject is
the k floor — without that, every floor assertion in the file would pass by
withholding, which is the vacuity this batch has been caught by three times.

**THE MIGRATION LINEAGE, inspected rather than assumed** (the decision required
this):

| Fact | Evidence |
|---|---|
| The chain is **35** migrations, ending `20261023000000` | `e4-source-hashes.json` `expectedChain`, `counts.migrations` |
| H-9's sealed checks assert **nothing after migration 34** | `backend/supabase/checks/h9_postmigration_checks.sql:380` — `not exists (… where version > '20261015000000')` |
| Which is why E4 added a **successor** checks file rather than editing it | `e4_postmigration_checks.sql:7` says so in its own words |
| E4's successor in turn refuses any migration not in its expected list | `e4_postmigration_checks.sql:81-83`, list ends `20261023000000` |
| `h9BaselineUnchanged` pins two hashes, and a NEW migration changes neither | `postmigrationChecks` `361a400a…`, `migration34` `0b949fa9…` |
| `apps/mobile/tests/e4-evidence-manifest.test.ts` is **not** hash-recorded | absent from the 48 keys in `e4-source-hashes.json` |
| `backend/supabase/pgtest/e4-chain-succession.pgtest.ts` **is** recorded, and pins the tail | line 69 pins `history_has_no_missing_version` to `20261023000000` |

**Conclusion: a successor migration is implementable locally without modifying
any sealed artifact** — add the migration, add its own successor checks file and
successor pgtest, update the one non-recorded test, regenerate the manifest, and
both H-9 baseline pins stay byte-identical. It was not implemented, for one
reason:

> **THE BLOCKER. An unapplied migration protects nothing.** The panel reads
> hosted Supabase. A snapshot table that exists only as a migration file gives
> zero runtime immutability, so suppression would have to be retained anyway —
> and each successor consumes a chain succession and churns hash-recorded gate
> files for a mechanism that cannot run. **Hosted apply requires separate
> founder authorization, which Decision 2 withholds.** That is the exact
> unresolved acceptance blocker, and it is the only thing standing between the
> withheld figures and publication.

### DECISION 3 — a zero refund side is protected

`sideReleasable`'s empty-set exemption is gone from the refund side. Ten
pharmacies sold and none refunded used to publish; it discloses that every one
of those ten refunded nothing, and unlike five-of-ten the set is **fully
identified because it is all of them** — there is no crowd for k to hide anyone
in.

**But emptiness alone is not the test.** A day on which nobody traded discloses
nothing about anybody, so `refundSideReleasable` asks the sale side whether
there is anything to protect before asking the refund side whether it is
protected. Keying the rule to an empty list alone would have withheld every
month containing one quiet day — the over-withholding round 14 was reproduced
for.

The Dashboard also stopped keeping its own inline copy of the side rule. It now
calls the shared `withheldSide`, which answers the **caption** as well as the
gate, so a page can no longer withhold for one reason and say another (round 1B
finding 7) or publish what the report layer would withhold (round 14 finding 2).

### DECISION 4 — the k=5 scope, classified before anything was changed

`ReportDefinition` gained `confidentiality`, and every report declares it. The
pharmacy floor applies to `pharmacy_operational`; `platform_billing` passes
through.

**Exactly one report is `platform_billing`:
`subscription_revenue_and_renewals`.** I first classified `subscriptions` and
`plan_distribution` as billing too, and the test suite caught it: round 12
finding 3's status-filter complement is reproduced on `plan_distribution`
itself. Those two count **pharmacies** per tier and per plan — the money may be
Muthoy's, but the subjects are pharmacies, and a filtered count plus its
complement identifies a small group of them. Decision 4 exempts "Muthoy's own
subscription-billing **revenue**", and that is the collected-payments report
alone.

The `/payments` field classification the decision required, before any
presentation changed: account label, plan tier and cycle, **order amount**,
status, provider, failure code, event count, latest event status, created
timestamp. Every one is Muthoy's own billing record; the amount comes from the
operator-maintained `plan_offerings` price list and is **not derived from any
pharmacy's sales or refunds**, so it cannot be an inference channel into
protected pharmacy data. No secrets, tokens or unnecessary billing details are
exposed, and the RBAC in front of the page is unchanged. That derivation test is
written into the code as the condition to re-apply if a billing report ever
starts joining to `sales`.

The subtitle follows the classification: a billing aggregate no longer
advertises a pharmacy floor it does not honour, which would have been Gate 5
finding 9's defect in the other direction.

---

## 7. What would make these pages DONE

| Gate | What it needs | Who |
|---|---|---|
| **E15** | the deployed panel opened in a browser, devtools network tab inspected, no service-role key in any response or bundle | founder, after a deployment |
| **E4-H** | migration 35 applied to a hosted project, so the audit, support and settings tables exist | founder-authorized hosted operation |
| **E10** | an approved, audited server API for a subscription lifecycle override | a separate approved plan |
| **E11** | `b4_refresh_entitlement_snapshot` rewritten to derive entitlement from verified evidence, or dropped | a separate approved plan (money-path SQL) |
| **E12** | an immutable subscription-lifecycle-event table | a separate approved plan |
| **E13** | an explicit, versioned, revocable location-consent record | product and legal decision |
| **E14** | an approved map tile provider, with its attribution | founder decision |

Until each is met, this document states the page as CODE-COMPLETE and says
plainly that the hosted half is not done.
