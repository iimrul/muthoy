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
| **Missing** | Nothing from §8.2 — **as of the Gate 5 corrections.** The block headed "Support notes" previously read no notes, only case summaries, and the owner information and latest activity were not even selected. All three are now read: notes per case id (so there is no path to a note without a case belonging to this shop), the owner resolved by id from `users`, and `updated_at` labelled "Last synced change" rather than "last seen". A **real marker** needs E13. |
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
| **Test evidence** | `adminSuppression.test.ts` (16, at the k−1/k boundary with a mutation check for a 4-shop bucket left visible), `adminReports.test.ts`, plus four contract tests rendering all four of the figures below against a POPULATED fixture and asserting the three source tables are reached. |
| **Missing** | Nothing from §8.5 — **as of the Gate 5 corrections.** This page previously claimed four figures it did not render: trial-to-paid conversion, subscription growth, the recorded-cancellation series and the sales-volume count. All four are now built. Conversion is NULL rather than 0% when no trial was ever granted; the cancellation series states in its own description that it is not churn and can only under-report (E12); the volume count excludes refunds. The date range is validated through the shared schema before any read, so the 400-day cap is a rule rather than a caption. |
| **Hosted** | NOT VERIFIED. |
| **External** | E15. |

**k = 5, on distinct contributing shops.** No customer, sale line or medicine
ever appears.

### 6. Maps — `/maps` · `maps.read`

| | |
|---|---|
| **Code status** | COMPLETE **as specified**, which means it plots nothing in the shipped state and says exactly why. Leaflet is wired behind the consent predicate, with plan-tier marker colour, a selection summary, drill-down navigation, and district/status filters — **the filters were claimed and absent until the Gate 5 corrections**, and are now built in the pure geo library, applied BEFORE the consent gate so the withheld count describes the same population the map does. |
| **Test evidence** | `adminGeo.test.ts` (30), plus a contract test asserting that with no tile provider configured **`MapLoader` is never rendered** — so the dynamic import, and therefore Leaflet, is never reached — and that the page names E14. |
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
| **Test evidence** | `adminIdentityStore.test.ts` (including the three revocation regression cases below), `adminRoles.test.ts` (36), `adminAuthz.test.ts` (50), `adminAuditViews.test.ts`'s seven security-history cases, contract tests including a `read_only` denial. |
| **Missing** | **Account creation completes outside the panel** by design — §4.3's hash-and-fragment flow, labelled as such on the page. §8.8's **security history was claimed and absent** until the Gate 5 corrections; it is now built, filtered to `admins.*`, `login` and `session.*` through the same library the Audit page uses. |

**A security defect was found here by the Gate 5 review and fixed.** Revoking an
admin's sessions wrote the environment role and `isActive: true`
unconditionally, so revoking a **disabled, narrowed** account replaced the
narrowing with its environment role — possibly `super_admin` — and re-enabled
it. A security action that widens authority is worse than no action. The stored
row's role and enabled state are now preserved and only the revocation point
moves.
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
| **Missing** | Nothing from §8.10. |
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
