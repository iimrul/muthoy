# Muthoy POS — Batch 3 plan (revision 5)

**Status:** **GATE 2 CLOSED — Codex `PLAN ACCEPT` on revision 5** (round 5,
2026-10-24). Five rounds, 48 findings, all applied. Gate 3 implementation is
authorized against this document.
**Date:** 2026-10-23
**Baseline:** `c25924e` on `main`, identical to `origin/main`. Last CI on that
commit: `39939796021` SUCCESS.
**Working tree:** `git status --porcelain=v1 --untracked-files=all` reports **49**
paths — 10 modified, 39 untracked. 48 are pre-existing and protected; the 49th is
this plan file. §16 enumerates them.

> ONE BATCH. No sub-batches, no mini-sprints, no new delivery groups. Internal
> commits are checkpoints inside Batch 3, not deliveries.

### What revision 5 changed

Round 4 confirmed finding 47 and one note resolved, and found one HIGH plus
three notes. All four applied, and two of them corrected claims revision 4 had
got wrong about the code:

1. **`next/dynamic(…, { ssr: false })` cannot live in a Server Component** in
   Next 15 — it fails `next build`. A thin `'use client'` loader owns that call
   and the `/maps` page imports only the loader (§8, §8.6).
2. **The layout does not call `requirePermission`** — `app/layout.tsx:77` uses
   `hasPermission` — and `adminAuthz.test.ts:56-68` is named *"throws AND audits
   the denial"*, so it is not a pure-predicate test and does break. It is
   retargeted rather than left alone (§8.9c).
3. **`refreshEntitlementSnapshot` has six call sites, not three**, including the
   shared table-driven RBAC block at `adminActions.test.ts:125-182` that covers
   all three actions and must be retargeted rather than deleted (§8.3(ii)).
4. "No query" on a denial is qualified to "no **business** query", since durable
   denial auditing performs an insert of its own (§8.9c).

### What revision 4 changed

Round 3 confirmed 10 of 15 resolved and found three HIGH defects, all in the
*mechanism* of revision 3's fixes rather than their intent. All three accepted:

1. **Authorization denials are recorded synchronously inside
   `requirePermission`**, which then throws — so control never reaches the async
   wrapper revision 3 added, and a denial was never going to be awaited (§8.9c).
2. **A `'use client'` boundary does not stop Next from server-pre-rendering the
   map**, so a static `leaflet` import would fail on `window` during
   `next build` (§8.6).
3. **The two retained write actions take hand-validated UUIDs**, not shared Zod
   schemas, contradicting §4.4 row 9 (§8.13 — ten schemas, not eight).

Its two notes are applied too: §8.3(ii) and §8.9d now name the exact call sites
the withdrawal and the three-state result require.

### What revision 3 changed, and why it matters

Round 2 accepted 21 of 29 and raised 15 more. All 15 are accepted; §18 is the
disposition. Five change what Batch 3 ships:

1. **Charts and maps use Recharts and Leaflet after all.** `TECH_STACK.md:95-98`
   locks both, with Leaflet's rationale written out. Revision 2's hand-written
   SVG was a deviation from a locked stack, and its stated reason — that a
   `'use client'` boundary endangers the service-role key — is wrong: the key is
   protected by build-enforced `server-only` on `lib/env.ts`, not by the absence
   of client components. The deviation is **withdrawn** (§8).
2. **`b4_refresh_entitlement_snapshot` is removed from every admin surface.** It
   advances `entitlement_snapshots.verified_at` without rederiving anything from
   payment evidence, and `apps/mobile/domain/entitlements.ts:143-146` makes
   `verified_at` the offline access ceiling — so pressing it extends paid access
   for free. **This is a defect in shipped Batch 2 code** (`a2c196a`), not
   something this plan introduced; §8.3 and gate **E11** handle it honestly.
3. **`sale_refunds` and `audit_logs` are revoked before being granted.**
   `20260821010000:299` already grants `service_role`
   `select, insert, update, delete` on `sale_refunds`, so revision 2's bare
   SELECT grant would have left the panel's key holding DML on a money table
   (§3.5).
4. **Every new admin write gets a shared Zod schema in `packages/validation`**,
   because `docs/playbook/02-system-architecture.md:127` requires it (§8.13).
5. **Volume 5's MRR trend is reported BLOCKED rather than claimed**, because the
   subscription history it assumes does not exist on a mutable row (§8.4, §17).

---

## 1. What is already delivered, and is not rebuilt

| Area | State at `c25924e` | Batch 3 does |
|---|---|---|
| Admin auth, sessions, login throttling, CSRF | W4-06 CODE-COMPLETE (`64c5f4b`) | **extends** — per-user revocation and DB role assignment. PBKDF2, the cookie and the Edge/Node split are untouched |
| Admin RBAC choke point | `requireAdminPermission` on every page | **extends** — more permissions, same choke point |
| Six admin pages + two drill-downs | W4-07 CODE-COMPLETE (`e8455e4`) | **extends** — search/filter/sort/pagination plus the five missing pages |
| Three bounded admin write actions | W4-08 CODE-COMPLETE (`a2c196a`) | **narrows one** — the entitlement-refresh action is withdrawn (§8.3); the other two keep working |
| Admin audit interface + redaction allowlist | W4-06 | **extends** — durable Postgres sink on an awaitable path (§8.9) |
| Medicine OCR | W2-01 CODE-COMPLETE | untouched |
| SQLite catalogue + JSONL importer | W2-02 code-complete, dataset blocked on E7 | untouched. **E7 stays Batch 6 B6-01** |
| Bangla/English/Banglish fold | `packages/utils/src/bengali.ts`, catalogue path only | **completes** — W2-03's shop-medicine half |
| SSLCommerz retirement | W4-10 CODE-COMPLETE | preserved. No new initiation path. **E8/bKash stays Batch 6 B6-02** |
| Six-batch roadmap correction | written in the working tree, uncommitted | preserved and committed as-is; not recreated |

**Barcode (W5-16) stays EXCLUDED.** **B6-01 and B6-02 are not touched.**

---

## 2. Exactly what is missing, per deliverable

### 2.1 Admin Panel — the gap, page by page

| # | Page | Route | Exists | Missing |
|---|---|---|---|---|
| 1 | Dashboard | `/` | partial | 8 of 9 metrics, every chart, recent registrations, alerts, navigation |
| 2 | Pharmacy Management | `/pharmacies` + `/shops/[id]` | partial | search, district/plan/status filters, sort, pagination, support notes, administrative controls |
| 3 | Subscriptions | `/subscriptions` | partial | filters, next billing, renewal history, upcoming expirations, change history. **Lifecycle overrides BLOCKED — §8.3** |
| 4 | Revenue & Billing | — | **no** | whole page. `/payments` becomes its order-level view. **MRR trend BLOCKED — §8.4** |
| 5 | Analytics | — | **no** | whole page |
| 6 | Maps | — | **no** | whole page |
| 7 | Support Management | — | **no** | whole page + persistence |
| 8 | Admin Users & Roles | — | **no** | whole page + per-user revocation + role assignment |
| 9 | Audit Logs | `/audit` | partial | durability, filters, search, pagination, detail view, **and the per-shop `audit_logs` view Volume 5 requires** |
| 10 | Reports | — | **no** | whole page + CSV + PDF + export authorization |
| 11 | Settings | — | **no** | whole page + persistence |

### 2.2 The four blocked tasks

| ID | Blocker today | Cleared by |
|---|---|---|
| **W4-04** | `service_role` holds DML but the panel needs SELECT-only on `sale_refunds`; `packages/utils/src/netSales.ts` was never written (verified absent) | the E4 migration + §6 |
| **W4-05** | neither the owner gate nor the identity pin exists; `backend/supabase/proposed/` does not exist (verified absent) | the E4 migration + §7 |
| **durable admin audit** | SQL staged out of chain at `backend/supabase/deploy/batch2-admin-audit.sql`, never executed | the E4 migration + §8.9 |
| **W2-03 remainder** | `db/sales.ts` and `db/purchases.ts` pass raw input to `medicines_fts` | §9 |

---

## 3. E4 — the migration-chain successor mechanism

### 3.1 The seal — FIVE gates

> **Corrected during implementation, 2026-10-24.** This section said FOUR. The
> full pgtest sweep found a fifth:
> `backend/supabase/pgtest/h9-environment-parity.pgtest.ts:158` asserted
> `migrationFiles().slice(-3)` equals the H-9 trio — i.e. that the trio is the
> chain's *tail*. It pins the chain's shape without ever mentioning the number
> 34, which is why a search for that literal did not find it, and why both the
> plan and three rounds of review missed it. It is now restated as the
> invariant it was always about — the trio is **contiguous** and follows every
> historical migration — plus "only E4 after it", which is strictly stronger
> than `slice(-3)` was. Gate 5 is in the E4 evidence manifest.

| # | Gate | What it asserts | Hash-pinned? |
|---|---|---|---|
| 1 | `scripts/h9-prod-preflight.mjs:232` | `migrations.length !== 34` refuses `migration-chain-unexpected`; the H-9 trio is the chain tail | **No** — `git check-attr` reports `text: unspecified`, and it is absent from `audit-artifacts/h9-remediation/final-source-hashes.json` |
| 2 | `backend/supabase/checks/h9_postmigration_checks.sql:369-382` | `count(*) = 34`, all three H-9 versions, `not exists (version > '20261015000000')` | **YES.** `eol=lf` pinned; SHA-256 `361a400a29025f2d859b4cd3e4f826afcdcd2c134a332b3412b9a2e0af1e2bd9`, re-measured at plan time; founder-signed-off evidence |
| 3 | `backend/supabase/pgtest/h9-cron-cleanup.pgtest.ts:406` | records `migrationFiles()` (the whole directory) and expects `history_post_h9` all-true | **No** |
| 4 | `apps/mobile/tests/migration-rollback-classification.test.ts:138,139,159,166,181` | `pg.length === 34`; distinct names `=== 34`; `classCounts === { A: 8, B: 18, C: 8 }`; `[...FORWARD_ONLY_OVERRIDES] === ['20260813000000_initial_schema.sql']`; and `ROLLBACK_DOC` contains the literal `**A: 8 · B: 18 · C: 8 — of 34.**` | **No** |

Gate 4 holds **five** hardcoded values, not four — revision 2 missed the
`FORWARD_ONLY_OVERRIDES` assertion at line 166, whose comment calls the baseline
override *"its one judgement"* (round-2 finding 30).

`scripts/h9/migration-gate.mjs` is hash-pinned but is **not** a fifth gate: it
names `PRE34_HISTORY` and `M34` explicitly and never scans the directory, so an
A2/A3 rehearsal still applies exactly 34 versions and still satisfies gate 2
unchanged. It is not modified.

### 3.2 The successor design

**Rule: gate 2 is never edited.** Its bytes, its `eol=lf` pin and its SHA-256
stay exactly as signed off. Its *scope* is stated rather than altered:
`history_post_h9` describes the **H-9 baseline** — the chain as it stood at
sign-off, and the state an A2/A3 rehearsal reproduces.

1. **NEW** `backend/supabase/checks/e4_postmigration_checks.sql` — the successor,
   same `check_name / pass / detail` contract, asserting the **exact expected
   version set** rather than a count, because a count plus bounds would accept a
   same-count substitution of a pre-H-9 version:
   - `history_has_no_missing_version` — every one of the 35 expected versions is
     present (a literal `values (…)` of all 35); `detail` lists any absent;
   - `history_has_no_extra_version` — every recorded version is in the expected
     set; `detail` lists any that are not;
   - `history_has_all_h9_versions` — the same three, named;
   - `history_h9_block_is_contiguous` — nothing strictly between
     `20261008000000` and `20261015000000` other than `20261008000100`;
   - `history_e4_immediately_follows_h9` — the single version greater than
     `20261015000000` is exactly `20261023000000`;
   - plus the E4 object, ACL, column-privilege and RLS assertions (§3.3–§3.5,
     §6, §7, §8.9).

   Required negative test: substituting one pre-H-9 version for an unknown
   version of the same count fails `history_has_no_missing_version` **and**
   `history_has_no_extra_version`, and is not masked by any count check.

2. **MOD** gate 3. The pinned-section test records `h9BaselineMigrations()` —
   `migrationFiles()` filtered to versions at or before migration 34 — so it
   exercises gate 2 on the history gate 2 describes. Two tests **added**:
   recording the full current chain makes gate 2 fail on exactly
   `history_has_34_versions` and `history_has_nothing_after_h9` and nothing else;
   and recording the full current chain makes the successor pass everything.

3. **MOD** gate 1. The assertion becomes, in order: set equality against an
   explicit `EXPECTED_CHAIN` of 35 filenames; the H-9 trio is **contiguous**; the
   only file after the trio is the E4 file. The contradictory "H-9 is the tail"
   predicate is removed. `apps/mobile/tests/h9-prod-preflight.test.ts` keeps its
   existing *chain stops before migration 34* refusal and gains four negative
   controls — an extra unknown migration, a missing E4 migration, a renumbered
   E4 migration, and a same-count substitution — each still refusing
   `migration-chain-unexpected`.

4. **MOD** gate 4 and `rollback-classification.json`. One entry for the E4 file;
   the file added to `postgresDeclaredOverrides`; **all five** hardcoded values
   updated: the two `34`s become `35`, `classCounts` becomes
   `{ A: 8, B: 18, C: 9 }`, `[...FORWARD_ONLY_OVERRIDES]` becomes
   `['20260813000000_initial_schema.sql', '20261023000000_e4_batch3_admin_platform.sql']`
   with its "one judgement" comment rewritten to describe **two** named
   judgements and why each is one, and the headline literal becomes
   `**A: 8 · B: 18 · C: 9 — of 35.**` in both the generated `ROLLBACK.md` and the
   assertion. `scripts/render-rollback-docs.mjs` regenerates the documents; the
   existing "detects a mutated count/reference in each generated document" test
   is the drift guard and must pass.

   **Class: C (forward-only), declared.** Mechanically it scores **B** — it ships
   `create or replace function` and performs no DML
   (`scripts/classify-migrations.mjs:116-124`). The override is the honest
   classification: reversing it would mean dropping `admin_audit_log`, and an
   audit log you roll back by deleting is not evidence.

5. **NEW** `audit-artifacts/e4/e4-source-hashes.json` — the E4 evidence manifest.
   The ledger requires E4's hash-recorded evidence to be *re-established*. It
   records, at the Batch 3 commit: the SHA-256 of all 35 migration files, of
   `e4_postmigration_checks.sql`, of the four modified gate files, of
   `rollback-classification.json`, `ROLLBACK.md` and the new pgtests; the
   expected version list; and the measured check counts. A test asserts the
   manifest matches the tree. `audit-artifacts/h9-remediation/final-source-hashes.json`
   is **not touched** — it is a snapshot at `b8ca5d8` and stays one.

### 3.3 Exactly ONE migration

`backend/supabase/migrations/20261023000000_e4_batch3_admin_platform.sql`. One
file, because every additional file multiplies the gate churn in §3.2 for no
benefit. Idempotent throughout (`if not exists`, `create or replace`, guarded
`alter … rename` inside `do` blocks), in one transaction.

`backend/supabase/pgtest/harness.ts:301`'s `createHarness()` applies **every**
file in the migrations directory in filename order, so migration 35 is applied by
every existing pgtest — which makes "no working path refused" (§7.6) and §3.5's
revoke safety mechanically enforced rather than asserted.

### 3.4 New tables — complete DDL, constraints, indexes and privileges

CLAUDE.md rule 2 — *every foreign key needs an explicit `onDelete` policy* — is
satisfied, and each table without a foreign key says why.

Every table follows the same three steps, for the measured reason the staged
Batch 2 SQL records: the hosted platform's default privileges give `service_role`
more than SELECT and INSERT on a new `public` table — the profile recorded in
this repository's H-9 work is `service_role=Dxtm`, i.e. TRUNCATE, REFERENCES,
TRIGGER and MAINTAIN. So each table is **(1)** `revoke all … from public, anon,
authenticated, service_role`, **(2)** granted exactly what it needs — including
**column-level** UPDATE where only some columns may change (round-2 finding 36),
and **(3)** `enable row level security` with **no policy**, so the API roles
reach nothing and `service_role`'s BYPASSRLS is what the panel uses.

**`public.admin_audit_log`**

| Column | Type |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `at` | `timestamptz not null` |
| `actor` | `text not null` |
| `actor_verified` | `boolean not null default false` |
| `role` | `text` |
| `action` | `text not null` |
| `target` | `text` |
| `outcome` | `text not null check (outcome in ('success','failure','denied'))` |
| `meta` | `jsonb not null default '{}'::jsonb` |
| `created_at` | `timestamptz not null default now()` |

Indexes: `(at desc, id)`, `(actor, at desc)`.
No foreign key, deliberately: an admin actor is a username from the `ADMIN_ROLES`
allowlist, not a `users` row, and a key to a table that holds no admins would be
fiction.
Privileges: `grant insert, select`. **No update, no delete, no truncate, and no
column-level update** — an audit row the panel can edit or erase is not evidence.

**`public.admin_role_assignments`**

| Column | Type |
|---|---|
| `username` | `text primary key` |
| `role` | `text not null check (role in ('super_admin','billing','support','read_only'))` |
| `is_active` | `boolean not null default true` |
| `sessions_revoked_at` | `timestamptz` |
| `assigned_by` | `text not null` |
| `assigned_at` | `timestamptz not null default now()` |
| `updated_at` | `timestamptz not null default now()` |

No foreign key, same reason. No extra index — the primary key is the only access
path.
Privileges: `grant select, insert`; `grant update (role, is_active,
sessions_revoked_at, updated_at)`. **No delete** — an account is disabled, never
deleted, so its history survives — and `username`, `assigned_by` and
`assigned_at` are immutable by privilege, not by convention.

**`public.admin_support_cases`**

| Column | Type |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `shop_id` | `uuid not null references public.shops(id) on delete restrict` |
| `category` | `text not null check (category in ('onboarding','sync','payment','data','device','account','other'))` |
| `status` | `text not null default 'open' check (status in ('open','pending','resolved','closed'))` |
| `priority` | `text not null default 'normal' check (priority in ('low','normal','high','urgent'))` |
| `assignee` | `text` |
| `summary` | `text not null check (length(summary) between 1 and 2000)` |
| `opened_by` | `text not null` |
| `opened_at` | `timestamptz not null default now()` |
| `updated_at` | `timestamptz not null default now()` |

Indexes: `(status, updated_at desc)`, `(shop_id, opened_at desc)`.
`ON DELETE RESTRICT`: a support case is platform history and must not vanish
because a shop row went. Shops are soft-deleted (`is_deleted`) and never
hard-deleted, so `restrict` blocks nothing that happens today.
Privileges: `grant select, insert`; `grant update (status, priority, assignee,
summary, updated_at)`. **No delete, no truncate**, and `id`, `shop_id`,
`opened_by`, `opened_at` immutable by privilege.

**`public.admin_support_notes`**

| Column | Type |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `case_id` | `uuid not null references public.admin_support_cases(id) on delete restrict` |
| `body` | `text not null check (length(body) between 1 and 8000)` |
| `author` | `text not null` |
| `created_at` | `timestamptz not null default now()` |

Index: `(case_id, created_at)`.
**`ON DELETE RESTRICT`, not CASCADE.** Revision 2 said CASCADE on the reasoning
that no role holds `delete` on cases so it is unreachable. Round 2 rejected that
(finding 34) and is right: a cascade that is unreachable *today* is an
append-only guarantee that depends on a privilege staying absent, and a later
migration or a table owner can delete a case. `RESTRICT` makes the note history
protect the case rather than the other way round, which is what append-only
means.
Privileges: `grant select, insert`. **No update, no delete, no truncate.**

**`public.admin_platform_settings`**

| Column | Type |
|---|---|
| `key` | `text primary key check (key in ('flag.analytics_enabled','flag.maps_enabled','flag.reports_pdf_enabled','notification.template.trial_ending','notification.template.payment_failed','notification.template.subscription_expired'))` |
| `value` | `jsonb not null` |
| `updated_by` | `text not null` |
| `updated_at` | `timestamptz not null default now()` |

No extra index. No foreign key — a settings key is a constant.
Privileges: `grant select, insert`; `grant update (value, updated_by,
updated_at)`. **No delete, no truncate**; `key` is immutable by privilege as well
as by being the primary key. The six keys are enumerated here, in the `check`,
and in `lib/adminSettings.ts`, and a test asserts all three lists are identical.

### 3.5 Two EXISTING tables — revoke first, then grant SELECT

Revision 2 planned bare SELECT grants here, which would have left both tables
with privileges the panel must not hold (round-2 finding 35, CRITICAL).

| Table | Privileges it already carries for `service_role` | E4 statement | Why |
|---|---|---|---|
| `public.sale_refunds` | **`select, insert, update, delete`** — granted by `20260821010000:299`'s `do` block, which runs `grant select, insert, update, delete on table %I to service_role` over a list that includes `sale_refunds` | `revoke all on table public.sale_refunds from service_role;` then `grant select on table public.sale_refunds to service_role;` | W4-04 needs SELECT. The panel must never hold DML on a money table, and `adminGrants.test.ts` asserts it does not — an assertion that would have **failed** against the real chain |
| `public.audit_logs` | hosted default `Dxtm` plus whatever the chain grants | `revoke all on table public.audit_logs from service_role;` then `grant select on table public.audit_logs to service_role;` | the per-shop audit view (§8.9b) needs SELECT; the append-only policy means the panel must hold nothing else |

**Why the revoke is safe, and how it is proven rather than assumed.** Both
tables are read by the sync pull path as `service_role`
(`backend/supabase/functions/sync/pull.ts:17` lists `audit_logs`;
`_shared/tables.ts` lists both), so SELECT must stay. Both are *written* only
through `sync_apply_row`, which is `SECURITY DEFINER` and therefore executes as
its owner, not as `service_role` — so removing `service_role`'s DML cannot break
a write path. That reasoning is **not trusted**: because `createHarness()`
applies migration 35, every existing B2/B3/B4/H-7 pgtest becomes a regression
test for it, and `e4-admin-platform.pgtest.ts` additionally asserts
`has_table_privilege('service_role', 'sale_refunds', 'insert'|'update'|'delete'|'truncate')`
is false while a refund still applies through `sync_apply_row` and the refund
history policy still reads. **If any existing suite breaks, the plan is corrected
rather than the grant left wide.**

---

## 4. Admin RBAC architecture

### 4.1 Permissions

The existing seven keep their exact names. Twelve are added: `revenue.read`,
`analytics.read`, `maps.read`, `support.read`, `admins.read`, `admins.write`,
`reports.read`, `reports.export`, `settings.read`, `settings.write`,
`audit.export`, `shop_audit.read`.

### 4.2 The matrix

| Permission | super_admin | billing | support | read_only |
|---|:-:|:-:|:-:|:-:|
| shops.read | yes | yes | yes | yes |
| accounts.read | yes | yes | yes | yes |
| subscriptions.read | yes | yes | yes | yes |
| subscriptions.write | yes | yes | — | — |
| payments.read | yes | yes | yes | yes |
| revenue.read | yes | yes | — | — |
| analytics.read | yes | yes | yes | yes |
| maps.read | yes | yes | yes | — |
| support.read | yes | — | yes | yes |
| support.write | yes | — | yes | — |
| audit.read | yes | yes | — | yes |
| shop_audit.read | yes | — | yes | — |
| audit.export | yes | — | — | — |
| admins.read | yes | — | — | — |
| admins.write | yes | — | — | — |
| reports.read | yes | yes | yes | yes |
| reports.export | yes | yes | — | — |
| settings.read | yes | yes | yes | yes |
| settings.write | yes | — | — | — |

Rationale for the four that are not obvious: `support` keeps **no**
`subscriptions.write` and **no** `revenue.read`, so the support UI cannot become
a billing console; `read_only` keeps **no** `maps.read`, because a coordinate is
the one field in this product that locates a physical person; `audit.export` is
super-admin-only because an export is the one way the log leaves the panel; and
`shop_audit.read` goes to `support` and not to `billing`, because Volume 5 scopes
the per-shop view to *"support/debugging use only"*.

The four role names, the `ROLE_PERMISSIONS` freeze and the `ownValue`
prototype-safe lookup are unchanged. `ADMIN_ROLES` keeps its exact format.

### 4.3 Role assignment and per-user revocation (Page 8)

`adminSession.ts` records the limit this closes: *"Revocation is
ADMIN_SESSION_EPOCH … all-or-nothing … Per-user revocation needs the Batch 3
session table."*

**Identity:** a username absent from `ADMIN_ROLES` has no authority, exactly as
today, and the Edge middleware keeps that cheap presence check with no database
round-trip.

**Rule 1 — a disabled row always denies.** If an `admin_role_assignments` row
exists with `is_active = false`, the request is denied. It never falls back to
`ADMIN_ROLES`.

**Rule 2 — permissions are the INTERSECTION.** The effective permission set is
`permissionsForRole(ADMIN_ROLES[username]) ∩ permissionsForRole(assignment.role)`
when an active assignment exists, and `permissionsForRole(ADMIN_ROLES[username])`
otherwise. A database row can only **narrow** authority, never grant a permission
the environment role lacks. That is also the operation `adminAuthz.ts:16-26`
already identifies as the only correct one for two disagreeing roles — *"the
correct operation is the INTERSECTION of their permission sets, never a rank
comparison."*

**Per-user revocation:** `admin_role_assignments.sessions_revoked_at`. A cookie
whose `iat` is at or before that instant is rejected. `ADMIN_SESSION_EPOCH` stays
as the all-or-nothing break-glass control.

**Failure posture:** the store is read in `currentAdminSession` (Node). If it
cannot be read the request is **denied** with an audited distinct reason
(`role_store_unavailable`). Fail-closed is correct for a revocation check; the
availability cost — a database outage takes the panel down rather than silently
widening authority — is stated in `docs/plans/admin-architecture-rbac.md`.

**Passwords are untouched.** PBKDF2-600k verification, the dummy-account
constant-work branch, the two throttles and the exact-key `ADMIN_ACCOUNTS` parser
all stay. **No plaintext password is ever stored, logged or accepted.** Creating a
*new* account still requires `scripts/admin-hash-password.mjs` plus an
environment change, so Page 8's provisioning surface generates the salt, the hash
and the exact JSON fragment and says so, and that control is visibly marked as
completing outside the panel. Everything the panel *can* do — narrow a role,
disable an account, revoke its sessions — is fully functional.

**Escalation guards, each with a negative test:** only `admins.write`
(super_admin) reaches the action; an admin cannot change their own role or revoke
their own sessions; the target must already exist in `ADMIN_ROLES`; the role must
be one of the four; a database role naming a wider role than the environment's
grants nothing extra; a disabled row denies even with a valid cookie and a
present `ADMIN_ROLES` entry; every attempt is audited on success and failure.

### 4.4 The non-negotiables (brief §4), mapped

| Requirement | Where it is satisfied | Test |
|---|---|---|
| 1 secure auth/session | unchanged W4-06 | existing suites |
| 2 server-side RBAC on every page and action | `requireAdminPermission` first, enforced by a source-level test over every `app/**/page.tsx` and every exported action, **plus** a per-route contract test that an unauthorized role gets the 403 notice and **no business query** runs — qualified, because durable denial auditing uses the audit client by design | `adminPageGuards.test.ts` + `adminRoutes.contract.test.tsx` |
| 3 CSRF / origin | `SameSite=Strict` plus the login route's Origin check; export routes are GET and permission-gated | existing + new |
| 4 secure cookies, expiry | unchanged | existing |
| 5 revocation and role change | §4.3 | new |
| 6 no service-role key in the browser | build-enforced `server-only` on `lib/env.ts`; **no `'use client'` file may import any server-only module**, asserted by import-graph test; plus a client-chunk scan for the key | `serviceRoleExposure.test.ts`, extended (§8) |
| 7 no cross-shop leakage | aggregates only, with the §8.5 k-anonymity floor; per-shop detail needs `shops.read` and a validated UUID; the audit allowlist bars shop-sensitive meta | new |
| 8 audit for sensitive changes | durable sink, awaited on every write action **and on every authorization denial** (§8.9c) | new |
| 9 input validation, safe output | every `searchParams` and every write payload through a shared Zod schema in `packages/validation` (§8.13); no raw error text reaches the browser | new |
| 10 query bounds, pagination | `.range()` plus explicit page caps; `readAllPages` keeps `MAX_PAGES`; the Analytics range is capped at 400 days | new |
| 11 error handling without leakage | `toDisplayMessage` only | existing, extended |
| 12 secure export endpoints | `reports.export` / `audit.export`, re-checked inside the route | new |
| 13 negative tests for unauthorized users | one per page, one per action | new |
| 14 permission change / stale session tests | §4.3 | new |

---

## 5. Metric definitions — the three money figures, kept apart

Defined once, in `apps/admin/lib/adminMetrics.ts`; §5.2's manifest binds each
rendered figure to its definition.

### 5.1a The canonical entitlement predicate, reused not re-derived

Revision 2 invented its own status/date predicates and got two cases wrong
(round-2 finding 38). The canonical definition is
`b4_user_has_premium` (`20260831000000_b4_commercial_platform.sql:262-272`):

```
premium :=  (status = 'trialing' AND trial_ends_at > now)
         OR (tier IN ('pro','ultra') AND status IN ('active','canceled')        AND paid_through  > now)
         OR (tier IN ('pro','ultra') AND status IN ('active','past_due','grace') AND grace_ends_at > now)
```

Two consequences revision 2 missed: an **`active`** row qualifies through
*either* `paid_through` or `grace_ends_at`, so requiring `paid_through` alone
excluded an active subscription inside grace; and a **`canceled`** row with
`paid_through > now` is still entitled, because access runs to the end of the
paid period.

So Batch 3 defines two figures off one predicate:

- **Currently paid entitlements** — the canonical predicate **minus the trialing
  branch** (a trial is premium but pays nothing). Includes `canceled` inside
  `paid_through`, because that access is paid for.
- **MRR**, which is forward-looking, so it is the same **minus `canceled`** as
  well — a cancellation will not recur:
  `tier IN ('pro','ultra') AND ((status = 'active' AND paid_through > now) OR (status IN ('active','past_due','grace') AND grace_ends_at > now))`.

A test asserts both figures against a fixture carrying one row of every status,
including an `active` row whose `paid_through` has passed but whose
`grace_ends_at` has not, and a `canceled` row still inside `paid_through` — the
two cases revision 2 got wrong.

**MRR amount.** The offering is the `plan_offerings` row matching the
subscription's own `tier` and `billing_cycle`, with `is_active` ignored so a
grandfathered price is still counted. `monthly` contributes the amount; `annual`
contributes `floor(amount_paisa / 12)`. The residue is never redistributed and the
page says the annual contribution is floored. The join is to the account's
current subscription, so an account with historical rows is counted once; a test
plants two subscription rows for one account and asserts the count is one.

**MRR is a forward-looking run-rate, not collected cash**, and the card says so.

### 5.1b The other two money figures

| Figure | Definition | Source | Never |
|---|---|---|---|
| **Collected subscription payments** | sum of `payment_orders.amount_paisa` where `status = 'verified'`, bucketed by `verified_at` | `payment_orders` | MRR; an expectation |
| **Pharmacy sales revenue (refund-net)** | `sum(sales.total) − sum(sale_refunds.total_amount)`, both on `business_date`, computed through the shared `netSalesPaisa` (§6) | `sales`, `sale_refunds` | Muthoy's revenue |

### 5.1c Counts, named for what they measure

- **Active pharmacies today** — a shop with at least one non-deleted `sales` row
  whose `business_date` equals the Dhaka day. Stated on the page.
- **Trial subscriptions** — the canonical trialing branch.
- **Active subscriptions** — the canonical predicate minus trialing.
- **Accounts ever paid** — accounts holding at least one `payment_orders` row
  with `status = 'verified'`. Named for what it measures, and shown beside:
- **Currently paid entitlements** — §5.1a. The gap between the two is itself
  information.
- **Trial-to-paid conversion** — accounts with `launch_trial_granted_at` that
  later hold a verified order, over accounts with `launch_trial_granted_at`.
- **Recorded cancellations** — subscriptions with `canceled_at` in the period.
  **This is NOT a churn trend and is not labelled one.** A renewal updates the
  same `billing_subscriptions` row and clears `canceled_at`
  (`20260831000000:704`), so historical churn is not recoverable from current
  state. The page says exactly that. Alongside it:
- **Expired without cancellation** — `paid_through < now` with `canceled_at`
  null, reported separately.
- **Renewal history** — from **verified `payment_orders`**, newest first;
  `billing_subscriptions` is current lifecycle state only and is labelled so.

### 5.2 The label guard — a typed metric manifest

- `lib/adminMetrics.ts` exports every rendered figure as
  `Metric = { id, label, family: 'subscription' | 'pharmacy_sales' | 'count', unit: 'paisa' | 'count' | 'ratio', definitionRef }`.
  A money figure can only reach a page **through** a `Metric`.
- A test asserts: no `pharmacy_sales` metric's label contains `revenue`, `MRR`,
  `ARR` or `profit`; no `subscription` metric's label contains `sales` or `net`;
  every `pharmacy_sales` paisa metric's value is produced by `netSalesPaisa`;
  and every `definitionRef` resolves to a heading that exists in
  `docs/plans/admin-metric-definitions.md`.
- A source test asserts no page renders a bare `formatMoney(` on anything that is
  not a `Metric`, so the manifest cannot be bypassed.
- `ARR` and `profit` stay banned outright in labels — neither is computed.
- The shop drill-down keeps `Gross sales today` **verbatim**: a per-shop figure
  stays gross because `sale_refunds` is read platform-wide.

Mutation checks, both **inside the mixed `/revenue` route**: relabelling that
page's pharmacy-sales metric as `revenue` must fail, and pointing its MRR metric
at a `netSalesPaisa` value must fail. The `font-mono`/`isMoney` rule for
CLAUDE.md 6 and the no-hardcoded-font rule are kept verbatim.

---

## 6. W4-04 — refund-net pharmacy sales revenue

1. **NEW** `packages/utils/src/netSales.ts` — `netSalesPaisa(gross, refunds)`
   over `subtractPaisa`, exported from the barrel.
2. **MOD** `apps/mobile/db/reports.ts:89` — `totalsFromRaw` consumes
   `netSalesPaisa` instead of its inline `difference(row.saleTotal,
   row.refundTotal)`, so no second definition exists. Mobile money regressions
   are re-run and must be unchanged.
3. **MOD** `apps/admin/lib/platformStats.ts` — `SaleRefundTotalRow`,
   `sumRefundTotals`, and the day range applied to **`business_date` on both
   sides**. The current code windows `sales` on `created_at`, which disagrees
   with the refund window for any backfilled or clock-skewed row.
4. **MOD** `apps/admin/lib/queries.ts` — `sale_refunds` read through the same
   `readAllPages` pager, `is_deleted = false`, `business_date` in range.
5. **MOD** `apps/admin/app/page.tsx` — the card reads "net of refunds".
6. **MOD** `apps/admin/lib/adminGrants.test.ts` — `sale_refunds` joins
   `DECLARED_READ_TABLES`; its SELECT grant is required; and **no write
   privilege may exist for `service_role`**, which §3.5's revoke is what makes
   true.

**The cancelled-sale rule, as it actually is.** `apps/mobile/db/reports.ts:34-37`'s
`period_refunds` CTE joins `sales s ON s.id = r.sale_id AND s.shop_id =
r.shop_id` with **no `s.is_deleted = 0` filter**, so the canonical definition
excludes a soft-deleted sale from the sales sum while still counting its refund.
Batch 3 **preserves that behaviour exactly** — admin matches mobile, because two
reports of the same shop disagreeing is worse than either rule — and a test pins
it with a soft-deleted sale that has a refund. The asymmetry is recorded in
`docs/plans/admin-metric-definitions.md` with the one-line change that would
alter it, so changing it later is a decision rather than a discovery. Changing it
now would be an unapproved change to money semantics on both platforms
(CLAUDE.md rules 4 and 10).

**Other cases, each its own test:** a full refund zeroes the day; a second refund
for one sale is impossible (`unique(shop_id, sale_id)`), asserted as a negative
control; a refund on a different `business_date` lands on its own day; a legacy
`sales_returns` row with `refund_id IS NULL` is ignored by both sums, matching the
canonical INNER JOIN — pre-existing, documented, not changed.

---

## 7. W4-05 — shop sync security

### 7.1 The threat, as corrected in Batch 1

A non-owner cannot write `user_permissions` at all — `20260819000000` raises
`MU015`. What remains is **owner-initiated**: an Owner *can* grant
`settings_manage`, the server *does* honour it, and whole-row LWW on `shops`
would then hand a Manager the entire shop identity row.
`muthoy-batch-1-plan.md:665-669` calls this *"preventive hardening of a latent
divergence, not the closure of a live hole."* Batch 3 says the same.

### 7.2 Part (a) — the permission gate

`muthoy-batch-1-plan.md:671-673`: *"`sync_row_permitted`'s `shops` arm becomes
**owner role**, not `settings_manage`."* The effective definition is the B4
wrapper (`20260831000000:425`), whose `else` arm delegates to
`sync_row_permitted_pre_b4`, where the `shops` arm lives. So E4 adds a
`sync_row_permitted` wrapper with an explicit `shops` arm requiring an **active
Owner role** for the calling app user, delegating everything else unchanged.

The `subscriptions` arm is **left alone**: the B4 wrapper's first branch is
already `when p_table='subscriptions' then false` for everyone, Owners included.
Revisions 1–3 of the Batch 1 plan each proposed changing it and were each wrong —
the `when 'subscriptions' then true` they cited belongs to `sync_table_readable`
(`20260907000000:228`), the pull-side read ACL. Recorded so it is not repeated.

### 7.3 Part (b) — the field-level pin, as independent defence

For `p_table = 'shops'`, `p_op <> 'delete'` and a caller who is **not** the
shop's owner, the wrapper overlays `name`, `name_en`, `phone`, `latitude`,
`longitude`, `thana`, `district` and `location_captured_at` from the stored row —
the exact `v_row := p_row || jsonb_build_object(…)` mechanism `20260831000000`
already uses for the commercial fields.

With (a) in place this pin is **redundant by design, and that is the point**: two
independent barriers, so a defect in either alone is not an exposure. The pgtest
proves each independently by exercising the wrapper with the other disabled.

### 7.4 Exact signatures and final privileges

| Signature | After E4 | `public`/`anon`/`authenticated` | `service_role` |
|---|---|---|---|
| `sync_apply_row(text,text,jsonb,uuid,uuid,text)` | **new** W4-05 wrapper: owner check, identity pin, delegate | revoked | **granted** |
| `sync_apply_row_pre_w405(text,text,jsonb,uuid,uuid,text)` | the renamed H-7 implementation (`20260907000000:89`) | revoked | **revoked** by E4 |
| `sync_apply_row(text,text,jsonb,uuid,uuid)` | **unchanged name and body** — the 5-argument wrapper calling `sync_apply_row(…, null)`; PostgreSQL re-resolves a SQL body's callee by name after a rename, so it now lands on the new 6-argument wrapper | revoked (already) | **granted** (already) |
| `sync_apply_row_pre_h7(text,text,jsonb,uuid,uuid,text)` | untouched | revoked (already) | **already revoked** by `20260907020000_h7_fix_pass_b.sql:70-71` — revision 2 wrongly said "granted" |
| `sync_row_permitted(uuid,text,jsonb)` | **new** E4 wrapper with the Owner `shops` arm | revoked | **granted** |
| `sync_row_permitted_pre_w405(uuid,text,jsonb)` | the renamed B4 wrapper (`20260831000000:425`) | revoked | **revoked** by E4 |

`sync_row_permitted` has **one arity only**, so there is no re-resolution
question for it; it is called from inside `sync_apply_row_pre_h7`'s delegation
chain, which resolves by name and therefore picks up the new wrapper — the same
property, verified by the pgtest rather than assumed.

`revoke execute … from service_role` on a renamed implementation does **not**
break its wrapper: a `security definer` function executes as its owner, and the
owner retains `execute`. The pgtest asserts both halves —
`has_function_privilege('service_role', …)` is false for each renamed
implementation, and a call through each wrapper still succeeds — so the claim is
measured. `20260907020000:66-68` states the same property for H-7's own rename.

### 7.5 No `update` grant on `shops`

Honouring W4-05 means owner-controlled fields stay owner-controlled **including
from the admin panel**. So the panel gets **no** `shops` write, the existing
`adminGrants.test.ts` assertion *"shops has no UPDATE grant for service_role"* is
**kept**, and Pharmacy Management's administrative controls are support notes and
cases (admin-owned tables), the existing commercial-status path that runs
server-side outside the panel, and read-only display. A control the panel may not
perform is rendered **visibly unavailable with its reason**.

### 7.6 "No working path refused"

Positive tests, all must pass: owner registration and onboarding; an Owner
editing the shop profile (all eight identity fields land); `b4_mutate_owned_shop`;
a staff sale push; a staff stock push; a staff cash push; the `b4_*` commercial
writes; both `sync_apply_row` arities after the rename. Negative tests:
`MANAGER_A` — the harness fixture already holding a `staff_management` permission
(`harness.ts:380`) — plus a planted `settings_manage` override is refused a
`shops` write by (a), and has its identity fields pinned by (b) with (a) bypassed.

Because `createHarness()` applies every migration, **every existing pgtest is a
regression test for this change**. Any suite that breaks is a refused working
path, by definition.

### 7.7 The forcing function fires, by design

`apps/mobile/tests/server-owned-fields.test.ts:424` asserts `w405Applied` is
false against the needle `'location_captured_at',v_shop.location_captured_at`.
When the migration lands this test **fails on purpose**, and the required
response is what its message says: move the eight `shops` identity fields into
`SERVER_OWNED_FIELDS.shops` with `EVIDENCE` entries scoped to the W4-05 branch,
and invert the two assertions. Pinning is unconditional because the outbox
records no actor — the recorded Batch 1 decision, kept.

---

## 8. The eleven pages

Architecture: Next 15 App Router; Supabase reached solely through `server-only`
modules; data computed on the server in pure `lib/` modules.

**Charts use Recharts; the map uses Leaflet — the locked stack.**
`TECH_STACK.md:95-98` names both, and `docs/playbook/05-admin.md:62,67` repeats
them. Revision 2's hand-written SVG was a deviation justified by a claim that is
false: a `'use client'` boundary does not endanger the service-role key. The key
is protected by `server-only` on `lib/env.ts`, which is a **build** failure if a
client file reaches it, and that protection is unaffected by the existence of
client components. The deviation is withdrawn.

So Batch 3 adds, to `apps/admin/package.json` only: `recharts` (3.10.1),
`leaflet` (1.9.4), `@types/leaflet`, and `@muthoy/validation` as a workspace
dependency (§8.13). `react-leaflet` is **not** added — `TECH_STACK.md` names
Leaflet, and one thin client component driving the Leaflet API directly avoids a
wrapper whose releases are coupled to React's.

**A `'use client'` boundary is not an SSR boundary, and Leaflet needs `window`.**
Next still **server-pre-renders** a client component to produce the initial HTML,
so a module-scope `import 'leaflet'` executes on the server and throws
`window is not defined` during `next build` (round-3 finding 46). The map
component therefore:

- is reached through a **thin `'use client'` loader component** that owns the
  `next/dynamic(() => import('./MapCanvas'), { ssr: false })` call. The server
  page imports **only that loader**. `ssr: false` is rejected inside a Server
  Component in Next 15 and fails `next build`, so the option cannot live on the
  `/maps` page itself (round-4 finding 48);
- imports Leaflet with a **dynamic `await import('leaflet')` inside
  `useEffect`**, never at module scope;
- imports `leaflet/dist/leaflet.css` (the markers and panes are unusable without
  it) and ships its own marker icons rather than Leaflet's default CDN-relative
  ones, which would be a third-party request;
- is **React Strict Mode safe**: `useEffect` creates the map once against a ref
  guard, and its cleanup calls `map.remove()`, **clears the ref, and marks any
  still-in-flight dynamic import as stale so its resolution does not initialise
  a map into an unmounted container** — Strict Mode mounts twice in development,
  and a second `L.map()` on the same container throws *"Map container is already
  initialized."*;
- renders a server-rendered, fully labelled placeholder as the `dynamic`
  fallback, so the page is complete and readable before any JavaScript runs.

Recharts needs none of this — it renders to SVG and pre-renders cleanly — but it
gets the same treatment for consistency of the loading state.

**The gate is a real build, not a unit test.** `next build` must succeed, and a
test asserts the build output contains no server-side `window` reference from
`leaflet` and that the map chunk is absent from the server bundle. A unit test
alone cannot catch this class of failure, which is why revision 3 missed it.

**The client boundary is narrow and asserted.** Only presentational chart and map
components carry `'use client'`. They receive **already-aggregated,
k-suppressed** arrays as props — never a row, never a client, never a credential.
`serviceRoleExposure.test.ts` is extended from "zero client files" to three
stronger assertions: no `'use client'` file imports `lib/env.ts`,
`lib/supabaseAdmin.ts`, `lib/queries.ts`, `lib/adminQueries.ts`,
`lib/adminActions.ts`, `lib/adminIdentity.ts`, `lib/adminLogin.ts` or any module
whose first line is `import 'server-only'`, checked transitively through the
import graph; every client component's props type contains no field typed as a
raw row; and the built client chunks contain no value from
`SUPABASE_SERVICE_ROLE_KEY` or `ADMIN_SESSION_SECRET`.

Every page gets: `requireAdminPermission` as its first statement; loading (the
route's `loading.tsx`), empty, error and unauthorized states; a responsive
desktop/tablet/mobile layout; accessible markup (`scope`, `role="alert"`,
`role="status"`, labelled controls, keyboard-reachable forms); **no hardcoded
statistic anywhere**; and a per-route contract test for each state (§11).

### 8.1 Dashboard — `/` · `shops.read`

Nine metrics: total registered pharmacies; pharmacies active today; active
subscriptions; trial subscriptions; accounts ever paid **and** currently paid
entitlements; MRR; recent registrations; subscription distribution; operational
alerts. KPI cards, a 30-day registration/activity trend, a
subscription-distribution chart, a recent-registrations table, and a link from
each card to its detail page. MRR is absent without `revenue.read`, and the page
is still correct without it.

Alerts, all computed: subscriptions expiring within seven days; accounts in
`past_due` or `grace`; shops with no billing account past the 24-hour bootstrap
window; `payment_orders` stale and open; `payment_provider_events` with
`processing_status = 'rejected'`.

### 8.2 Pharmacy Management — `/pharmacies` + `/shops/[id]` · `shops.read`

Search by name and phone (`ilike`, pushed into the query, metacharacters
escaped); filters by district, plan and commercial status; sort by registration
date or last activity; server-side pagination via `.range()` with an exact count.
The drill-down adds owner and account information, contact, subscription status,
latest activity, location **only with `maps.read` and only under §8.6's consent
rule**, support notes, and the §7.5 control set. The route param is
UUID-validated before it reaches a query, and one shop's detail never contains
another's rows — its own test.

### 8.3 Subscriptions — `/subscriptions` · `subscriptions.read`

All six statuses as a status filter, plus tier and cycle filters and pagination.
Columns: plan and tier detail, start, expiry, **next billing date**
(`paid_through` for an active paid cycle, `trial_ends_at` for a trial, em dash for
canceled or expired), **renewal history from verified `payment_orders`**, upcoming
expirations, and change history from the audit log.

**Two things are deliberately NOT built here, and both are blockers.**

**(i) Lifecycle overrides.** `docs/playbook/05-admin.md:47`:

> *"The older manual extend-trial/force-status/direct-table write design is
> superseded and unapproved. Trial derives from its original server grant and
> cannot reset/extend through client retry, reinstall, or login; any future admin
> override requires a separately approved audited server API."*

So trial extension and status override are rendered **visibly unavailable with
their reason and a pointer to gate E10**, not as controls that do nothing.

**(ii) `b4_refresh_entitlement_snapshot` is withdrawn from the panel entirely.**
This is a correction to **shipped** Batch 2 code, not a scope decision. The RPC's
whole body is:

```
update entitlement_snapshots
set verified_at = now(), version = version + 1, updated_at = now()
where billing_account_id = p_billing_account_id;
```

It rederives nothing. And `apps/mobile/domain/entitlements.ts:143-146` makes
`verified_at` the **offline access ceiling**:

```
const verificationCeiling = verifiedMs + MAX_OFFLINE_VERIFICATION_DAYS * DAY_MS;
if (mode === 'offline' && nowMs > verificationCeiling)
  return freeResult(snapshot, 'verification_stale', verificationCeiling);
```

So an admin pressing "Refresh entitlement snapshot" extends a device's premium
access by the full offline window **with no payment behind it** — exactly the
class Volume 5's clause and the founder brief forbid. It shipped in `a2c196a` as
one of W4-08's three actions.

Batch 3's response, which is the conservative one:

- `refreshEntitlementSnapshot` is **removed** from `lib/adminActions.ts`, and so
  is every dependent. Round 4 found revision 4's list of three incomplete; the
  **complete** set, enumerated so the full-suite gate is not what discovers it:

  | Site | Action |
  |---|---|
  | `lib/adminActions.ts:74` | the function itself — **deleted** |
  | `app/adminFormActions.ts:21,29,31` | the import and the `refreshSnapshotAction` export — **deleted** |
  | `app/accounts/[id]/page.tsx:9,116` | the import and the `ActionButton` — replaced by the unavailable-with-reason notice |
  | `lib/adminActions.test.ts:33` | the destructured import — **narrowed** to the two retained actions |
  | `lib/adminActions.test.ts:125-182` | the shared table-driven RBAC and denial cases, which cover **all three** actions — **retargeted**, not deleted: the `refreshEntitlementSnapshot` rows come out, the `reconcilePlanLimits` and `expireStalePaymentOrder` rows stay, so RBAC coverage of the retained actions is unchanged |
  | `lib/adminActions.test.ts:189-246` | the dedicated describe block — **deleted**, with one assertion in its place proving `lib/adminActions.ts` exports no `refreshEntitlementSnapshot` |
- the write manifest (§8.12) lists `b4_refresh_entitlement_snapshot` as a
  **forbidden** RPC, so re-adding it fails the build;
- **the RPC itself is not modified.** Rewriting it to rederive entitlement from
  verified evidence is money-path SQL and needs an approved plan (CLAUDE.md
  rule 10). It is gate **E11**;
- `b4_reconcile_plan_limits` **stays** — verified at plan time not to write
  `entitlement_snapshots` or `verified_at` at all; it re-applies plan limits to
  shops and staff, deriving from the snapshot rather than extending it;
- `expireStalePaymentOrder` stays, unchanged.

**No Batch 3 action may create or extend a paid entitlement without verified
payment evidence**, enforced by a source-level assertion that no admin write
touches `entitlement_snapshots`, `billing_subscriptions`, `billing_accounts` or
`plan_offerings`, and that the forbidden RPC appears nowhere.

**No payment gateway is activated.** W4-10 stands.

### 8.4 Revenue & Billing — `/revenue` · `revenue.read`

MRR (current), plan-wise revenue, historical payment orders, order status across
created/pending/verified/failed/expired, revenue breakdowns, recorded
cancellations and renewals, authorized payment-order reconciliation (the existing
bounded expire action), and billing exceptions — orders verified with no matching
subscription, events with no order, `rejected` events.

**Volume 5's "MRR trend" is reported BLOCKED, not claimed.**
`docs/playbook/05-admin.md:58` asks for an MRR trend *"computed from
`subscriptions` history"*. That history does not exist: a renewal updates the same
`billing_subscriptions` row, so past MRR is not recoverable. What this page
provides instead, clearly labelled as itself, is a 12-month **collected
subscription payments** trend from verified `payment_orders` — real evidence, but
cash collected, not run-rate. A historical MRR series needs an immutable
subscription-lifecycle-event table, which is gate **E12**. Claiming the
collected-payments chart *is* the MRR trend would be the mislabelling §5.2 exists
to stop.

**W4-04 appears here as a clearly separated section**, every figure carrying its
`Metric` family, so §5.2's manifest guard applies on exactly the page where both
families render. `/payments` keeps its route as this page's order-level view,
linked from here, and leaves the top-level nav so the nav holds exactly eleven
entries. No functionality is removed.

Historical SSLCommerz orders stay readable and reconcilable; no new initiation
exists; no bKash figure is invented.

### 8.5 Analytics — `/analytics` · `analytics.read`

Daily active pharmacies, new registrations over time, trial-to-paid conversion,
subscription growth, plan distribution, the recorded-cancellation series,
platform usage, and aggregated pharmacy sales **volume** (count and refund-net
total) — with a date-range filter capped at 400 days.

**k-anonymity: k = 5.** Any bucket, series point, aggregate or export row whose
value derives from fewer than 5 distinct contributing shops renders as an em dash
and exports as empty. One function, `suppressBelowK`, which every aggregate
passes through; a source test asserts no analytics or report aggregate reaches a
page or an export without it. Tests cover **k−1 suppressed and k visible** at the
boundary for a bucket, a series point and an export row.

No customer, no sale line and no medicine ever appears.

### 8.6 Maps — `/maps` · `maps.read`

**Consent.** `20260813000000_initial_schema.sql:10` declares
`location_captured_at` as a capture **timestamp**, not an affirmative, versioned,
revocable consent record. So:

- a null `latitude`, `longitude` **or** `location_captured_at` excludes the shop —
  necessary, and unchanged;
- a non-null timestamp is **not sufficient**. Until an explicit versioned and
  revocable consent record exists (gate E13), **no real marker is plotted**, and
  the page renders its tested empty state with the reason.

This costs nothing today: **nothing in the mobile app ever writes `latitude` or
`longitude`** — a repository search finds only the schema declaration and
`serverOwnedFields.ts`'s comment — so the real state is zero coordinates either
way. **No coordinate is invented and no address is geocoded.**

Leaflet is wired behind that same predicate, so enabling it later is a data and
policy change rather than new code: markers, plan-tier colour (Volume 5's rule),
a summary panel on marker selection, navigation to `/shops/[id]`, and filtering
by district and subscription status. The **tile URL is configuration, unset by
default**; with it unset — the shipped state — the component renders the empty
state and **makes no third-party request**, so no viewport around a pharmacy
leaves the browser before a tile provider is approved (gate E14). Tests: a
fixture shop with coordinates and a capture timestamp but no consent record is
not plotted; and with no tile URL configured, no network request is attempted.

The component obeys §8's SSR rules — `next/dynamic` with `ssr: false`, Leaflet
imported dynamically inside `useEffect`, bundled marker icons, a Strict-Mode-safe
`map.remove()` cleanup, and `leaflet/dist/leaflet.css`. With no tile URL
configured the dynamic import is **never triggered at all**, so in the shipped
state Leaflet does not even load, let alone reach a tile server.

### 8.7 Support Management — `/support` · `support.read`, writes `support.write`

`admin_support_cases` and `admin_support_notes` per §3.4. Search and status
filters, case detail, authorized notes, category and status, assignee, case
history, the account and shop context, and the authorized actions.

**No support history is fabricated** — the tables ship empty and the page's empty
state says so. Support staff gain **no** `subscriptions.write` and no
unrestricted shop access: a note is a row in an admin table, not a shop write.
Notes are append-only by privilege, not by UI. Every case transition and every
note is audited, and every payload is parsed by a shared Zod schema (§8.13).

### 8.8 Admin Users & Roles — `/admins` · `admins.read`, writes `admins.write`

A directory with environment role, assignment role, **effective (intersected)
permissions**, enabled state, and last session revocation. The §4.2 matrix is
rendered from `ROLE_PERMISSIONS` itself, so it cannot drift. Role narrowing,
account disable and per-user session revocation are functional. Account creation
is §4.3's hash-and-fragment flow, labelled as completing outside the panel.
Security audit history filtered to `admins.*`, `login` and `session.*`.

### 8.9 Audit Logs — `/audit` · `audit.read`, export `audit.export`

Two views, because Volume 5 requires both and they have different subjects.

**(a) Platform admin audit** — `admin_audit_log` per §3.4. Actor, action, target,
outcome, timestamp, non-sensitive context; failed and denied operations included;
filters on actor, action, outcome and date; search; pagination; read-only detail.

**(b) Per-shop `audit_logs` view** — `shop_audit.read`, scoped to one validated
shop id, read-only, newest first, paginated. §3.5 revokes then grants SELECT; a
test asserts no insert/update/delete/truncate for any role, matching the
append-only DB policy, and a source test asserts no admin module writes it.

**The sink is awaited on every sensitive path.** `AdminAuditSink.write(entry):
void` plus a sibling durable function is **not** enough on its own, because
`lib/adminActions.ts:47`'s local `audit()` wrapper is synchronous and every call
site uses it (round-2 finding 39). So:

- `AdminAuditSink` keeps `write(entry): void` and gains optional
  `flush?(): Promise<void>`, so **no existing non-sensitive call site changes**;
- `recordAdminActionDurably(input)` returns a promise that resolves once the
  Postgres sink has committed or failed;
- **`lib/adminActions.ts`'s `audit()` wrapper becomes `async`, and every action
  awaits it on every success and failure return path.** A test asserts each
  action's audit promise is awaited before its return value is produced;
- the stderr sink runs **first** and remains the record of account, so a database
  outage cannot lose the line.

**(c) Denials need their own fix, because they never reach the action.** An async
`audit()` in `lib/adminActions.ts` cannot cover a denial at all:
`lib/adminAuthz.ts:97-110`'s `requirePermission` is **synchronous**, records
`authz.denied` itself, and **throws** — so control never returns to the action
body where that wrapper lives (round-3 finding 45). The same holds for
`currentAdminSession`'s `session.role_revoked` and `session.role_mismatch`
records.

So the denial audit moves to where it can be awaited:

- `requirePermission` keeps its exact signature and its throw, but it **no
  longer records** the denial, so nothing is recorded twice. Two corrections to
  revision 4's reasoning, both found in round 4: the layout does **not** call it
  — `app/layout.tsx:77` uses `hasPermission` from `lib/adminRoles` — and
  `adminAuthz.test.ts:56-68` is a test named *"throws AND audits the denial"*
  that asserts the `authz.denied` entry, so it is **not** a pure-predicate test
  and **will** break. It is **retargeted**, not deleted: the throw assertion
  stays on `requirePermission`, and the audit assertion moves to a new async
  case on `requireAdminPermission`. `adminAuthz.test.ts:52-55`'s "audits
  nothing" case needs no change, and the error-shape case at `:70-80` touches no
  audit;
- `requireAdminPermission` (already `async`) catches the `AdminForbiddenError`,
  `await`s `recordAdminActionDurably` for the denial, then rethrows — so the
  denial is persisted before the caller sees the throw;
- `currentAdminSession`'s two records become awaited calls, which it can do
  because it is already `async`;
- `role_store_unavailable` (§4.3) is awaited on the same path.

Tests: the denial audit settles **before** `requireAdminPermission` rejects; a
denied call constructs **no** Supabase client and reaches **no business query** —
qualified deliberately, because durable denial auditing necessarily performs an
insert of its own, so "no query at all" would be a false claim (round-4 note); a
direct `requirePermission` call still throws the same error and records nothing;
and removing the `await` fails the first assertion.

**(d) Committed-but-unaudited is its own outcome, not a failure.** If the mutation
committed and the audit insert then failed, returning an ordinary failure would
invite a retry and duplicate a non-idempotent write such as a support note
(round-2 finding 40). So an action returns a third shape,
`{ ok: false, committed: true, code: 'audit_write_failed', message }`, the UI
states that the change was applied but not recorded and must not be retried, and
the stderr line plus the server log carry the record. Where the write is a single
statement that can carry its own audit row, the two are issued in one
transaction and this shape cannot arise; the shape exists for the paths where
they cannot be, and a test drives both.

The three-state result does not fit the existing redirect mapping:
`app/adminFormActions.ts:25`'s `outcomeQuery(action, ok)` takes a **boolean** and
emits `?done=` or `?failed=` (round-3 note on finding 40). It gains a third
value, `?applied_unrecorded=`, and each page's notice block gains the matching
sentence — applied, not recorded, do not retry. A test asserts all three query
values map to distinct, non-empty notices and that the third never reads as a
plain failure.

**`actor_verified`.** `apps/admin/lib/adminLogin.ts:364` audits a failed login
with `actor: account.username` and **no verified cookie**, so "the actor always
comes from the verified cookie" is false for login attempts, which by nature
precede a session. The record now distinguishes them: `actor_verified = true`
only when the actor came from a verified session cookie; a login attempt records
the **claimed subject** with `actor_verified = false`. The page shows the
distinction, and a test asserts an unauthenticated caller cannot produce a row
with `actor_verified = true`.

This means the promoted table is **not** byte-identical to
`backend/supabase/deploy/batch2-admin-audit.sql`: it adds one column. The plan
says so rather than claiming "substance unchanged" (round-2 finding 41 on
wording): every column, index, revoke and grant of the staged SQL is preserved,
**plus** `actor_verified`, and the staged file gets a header recording exactly
that difference.

**Redaction, enumerated.** The allowlist gains exactly these:

| Key | Type | Rule |
|---|---|---|
| `caseId` | string | UUID shape or dropped |
| `settingKey` | string | one of the six allowed setting keys, else dropped |
| `targetUsername` | string | ≤ 64 chars, no whitespace |
| `fromRole` / `toRole` | string | one of the four role names, else dropped |
| `reportId` | string | an allowlisted report id |
| `rowCount` | number | finite integer |
| `durationMs` | number | finite integer |
| `actorVerified` | boolean | — |

Existing keys, lengths, the scalars-only rule, the BD-phone and long-token
scrubbers and the UUID-safe phone pattern are **unchanged**. Rejection tests: a
nested object, an array, a function, `null`, an over-long string, an unlisted
key, a non-enum role, and a phone-shaped value inside `reason` are each dropped
or scrubbed.

**Durability is claimed for the code path only.** Until the migration is applied
to a hosted project, the page continues to say stderr is the record of account,
and the batch report says the same. **No hosted audit persistence is claimed.**

### 8.10 Reports — `/reports` · `reports.read`, export `reports.export`

Six platform reports: pharmacy registrations, subscriptions, subscription revenue
and renewals, plan distribution, activity summary, refund-net pharmacy sales.
Date-range and status filters. Every aggregate passes `suppressBelowK`.

- **CSV** — `lib/adminCsv.ts`, pure. RFC-4180 quoting, CRLF, UTF-8 BOM, and
  **formula-injection prevention**: any cell whose first character is `=`, `+`,
  `-`, `@`, tab or carriage return is prefixed with an apostrophe **inside** the
  quoted field. Tested with a planted `=cmd|…` payload and with a legitimate
  negative number, which must survive readable.
- **PDF** — `lib/adminPdf.ts`, pure and dependency-free: a valid PDF 1.4 byte
  stream with Helvetica, a title, the range, column headers repeated per page,
  page numbers and correct `xref` offsets. Tested by parsing the output back,
  with a corrupted-`xref` mutation check.
- **Completeness** — exports page through `readAllPages` with an explicit cap and
  a hard assertion that the exported row count equals the counted row count. A
  fixture larger than one page proves it.
- **Authorization** — `app/api/reports/export/route.ts` re-checks
  `reports.export` itself; a `reports.read`-only role gets 403; an
  unauthenticated caller gets 401 from the middleware; the report id and every
  filter are parsed by a shared Zod schema (§8.13).
- **No cross-pharmacy sensitive financial detail**: platform reports are
  aggregates or registration metadata. A per-shop financial export is **not**
  provided, and a test asserts no report row carries a sale, a customer or a
  medicine.

### 8.11 Settings — `/settings` · `settings.read`, writes `settings.write`

`admin_platform_settings` per §3.4, its six keys enumerated in three places with
a test asserting they are identical.

**Only settings with a real consumer are editable.**

| Section | State | Why |
|---|---|---|
| **Feature flags** (3) | **editable and genuinely consumed** | `lib/adminSettings.ts`'s `isFeatureEnabled` is read by the Analytics, Maps and Reports-PDF routes themselves — a real server-side consumer inside this app. A test asserts each flag's route honours it, and a mutation check asserts a disabled flag actually hides the feature |
| **Notification templates** (3) | **read-only, visibly unavailable, with the reason** | no admin notification dispatcher exists anywhere in the product. They render with their default text and an explicit "not yet consumed — no admin notification dispatch exists" note, the form is disabled, and a test asserts no write path accepts a `notification.template.*` key |
| **Environment / deployment diagnostics** | **read-only, names and presence only** | the page renders "set" or "not set" and **never a value**. A test asserts no settings source reads `process.env` except through a fixed name list, and that no rendered string contains a value from the environment |

Nothing here can change production infrastructure.

### 8.12 Keeping admin write power bounded

- Direct table writes are permitted **only** in `lib/adminActions.ts`,
  `lib/adminAuditStore.ts`, `lib/adminIdentityStore.ts`, `lib/adminSupport*` and
  `lib/adminSettings*` — an explicit module allowlist, asserted.
- **Every** write is enumerated by `(module, table, operation)` in a manifest the
  test compares against the parsed sources:

| Module | Table | Operations |
|---|---|---|
| `lib/adminActions.ts` | `payment_orders` | `update` (the existing guarded stale-order transition, unchanged) |
| `lib/adminAuditStore.ts` | `admin_audit_log` | `insert` **only** |
| `lib/adminIdentityStore.ts` | `admin_role_assignments` | `insert`, `update` |
| `lib/adminSupport*` | `admin_support_cases` | `insert`, `update` |
| `lib/adminSupport*` | `admin_support_notes` | `insert` **only** |
| `lib/adminSettings*` | `admin_platform_settings` | `insert`, `update` |

- **RPC allowlist and denylist.** The only RPC any admin module may call is
  `b4_reconcile_plan_limits`. `b4_refresh_entitlement_snapshot` is **explicitly
  forbidden by name** (§8.3), so re-adding it fails the build.
- `shops`, `sales`, `sale_refunds`, `users`, `audit_logs`,
  `entitlement_snapshots`, `billing_subscriptions`, `billing_accounts` and
  `plan_offerings` appear in **no** write entry — which is also how §8.3's
  no-paid-access-without-payment rule is enforced.
- `delete` and `truncate` appear in no entry at all.
- The two existing negative controls are kept and three are added: a synthetic
  module writing `shops`; a synthetic `adminAuditStore` performing an `update`;
  and a synthetic module calling `b4_refresh_entitlement_snapshot`.

### 8.13 Shared validation schemas

`docs/playbook/02-system-architecture.md:127`: *"`packages/validation` — every Zod
schema. A form in `apps/mobile` and any future admin-side write both import from
here — never duplicated."* Revision 2 planned hand-written validation in
`apps/admin`, which contradicts that (round-2 finding 44).

So `apps/admin` adds `@muthoy/validation` as a workspace dependency — the package
already owns `zod ^4.4.3`, so no external dependency is added to `apps/admin` for
this — and **every** new write payload and every `searchParams` shape gets a
schema there:

`adminSupportCaseCreate`, `adminSupportCaseUpdate`, `adminSupportNoteCreate`,
`adminRoleAssignmentUpdate`, `adminSessionRevocation`, `adminSettingUpdate`,
`adminReportExportQuery`, `adminListQuery` (search, filters, sort, page), and —
added in revision 4 — `adminAccountIdAction` and `adminPaymentOrderIdAction`.

**Ten, not eight.** Round 3 found that the two **retained** write actions were
left out: `reconcilePlanLimits(accountId)` and
`expireStalePaymentOrder(orderId)` validate their UUID with
`isUuid` from `lib/adminViews.ts` — hand-written, not a shared schema — which
contradicts §4.4 row 9 (finding 47). Both now parse a shared schema before the
RPC or table call. `isUuid` itself stays, because route params and drill-down ids
go through it on **read** paths where no write payload exists, and
`lib/adminViews.ts` is the framework-free module the pages already share.

Each is `safeParse`d **before** any RPC or table operation, and a source test
asserts every exported action and route handler parses its input through one of
them before its first client call. `lib/adminIdentity.ts`'s hand-written
`ADMIN_ACCOUNTS` parser is **left alone**: it parses an environment variable, not
a write payload, its every rejection is already enumerated in tests, and its
comment records why it is hand-written.

---

## 9. W2-03 — multilingual search over existing shop medicines

### 9.1 The mechanism

`medicines_fts` is an external-content FTS5 table over `medicines(name, generic)`
with three triggers and a rebuild. Today `db/sales.ts:88` and
`db/purchases.ts:109` pass raw input through `toFtsPrefixQuery`, so the index and
the query sit in different comparison spaces whenever the script differs. The
fold exists and is tested: `medicineSearchKey` / `medicineSearchKeys` in
`packages/utils/src/bengali.ts`, with the invariant *"the index and the query are
folded by the SAME function."*

### 9.2 The SQLite migration — `0033_medicine_search_key.sql`

1. `alter table medicines add column search_key text;` — nullable, **no default**
   (a volatile default would make this a data-writing migration).
2. Drop and recreate `medicines_fts` as
   `fts5(name, generic, search_key, content=medicines, content_rowid=rowid)`.
3. Recreate all three triggers to carry `search_key`.
4. `insert into medicines_fts(medicines_fts) values('rebuild');`

Registered in `meta/_journal.json` (`idx: 33`) and `migrations.js` (`m0033`).
`db/h7-access-lock.sqlite.test.ts:200-216` already asserts journal equals
registry equals `.sql` files for the whole directory — the existing guard,
reused. Its mutation check is re-run.

### 9.3 The backfill — `db/medicineSearchKeyBackfill.ts`

The fold is JavaScript, so SQL cannot compute it. A chunked, idempotent,
transactional backfill runs from `db/init.ts` immediately after migrations:
selects rows with `search_key IS NULL` in bounded chunks, computes
`medicineSearchKeys([name, generic])`, updates inside a transaction per chunk, and
finishes when no NULL remains. Re-running is a no-op. A failure mid-way leaves
committed chunks and retries the rest next launch — the state §9.4 must stay
correct in.

### 9.4 The query change — both raw and folded terms

A folded query is Latin, so a Bangla-named row whose `search_key` is still NULL
would match nothing. So the query **unions both expressions**:

```
raw    = toFtsPrefixQuery(query)
folded = toFtsPrefixQuery(medicineSearchKey(query))
MATCH  = raw                when folded === raw or folded === ''
         (raw) OR (folded)  otherwise
```

Both sides are already FTS5-quoted by `toFtsPrefixQuery`, so the `OR` composes
two safe sub-expressions and no user text reaches the parser unquoted. `bm25()`
still returns a single relevance score for the matched row against the whole
query expression, so ordering stays well-defined; the only change is that a row
matching through `search_key` and a row matching through `name` are now ranked in
one list, which is the intent. The secondary `m.name` sort is kept as the
deterministic tie-break it already is.

Consequences, each tested: a Bangla or Banglish query matches a backfilled row
through `search_key`; a Bangla query matches a **NULL-`search_key`** row through
the raw term; an English query still matches `name`/`generic` as before;
`encryptionVerify.ts`'s `MATCH 'Napa'` and its integrity check are unaffected,
because `name` and `generic` stay indexed in the same order; a query that folds
and raws to empty returns an empty array.

The union is kept permanently rather than removed after backfill: a pulled row is
folded on arrival, but a row written by an older bundle mid-upgrade is not, and a
correctness property that depends on a migration having finished is the kind that
fails on exactly one device.

### 9.5 Sync safety

`search_key` is **device-local**: the Postgres `medicines` table has no such
column.

- push: `toSyncPayload` deletes `searchKey` for `medicines` — the established
  pattern (`shops.cloudLinkedAt`, six `users` fields);
- pull: `applyToTable`'s `medicines` case (`sync-helpers.ts:1159`) computes
  `searchKey` from the incoming row and includes it in both `values` and the
  conflict `set`;
- `SERVER_OWNED_FIELDS` gains `medicines: ['search_key']` with an `EVIDENCE`
  entry scoped to the strip.

### 9.6 Tests

Fresh install; a migration upgrade from a populated pre-0033 fixture with every
existing medicine, batch, sale and purchase row preserved and still joinable
(asserted by row count and by id); FTS rebuild verified by matching a
pre-existing row; a chunk failure rolled back with no partial `search_key` and no
lost row; no duplicate `medicines` row and no stock change (`batches.stock`
compared before and after); offline search performance within an explicit budget;
and the three-script matrix for both the sale and purchase paths, **each run
twice — fully backfilled, and with `search_key` forced to NULL**.

**Real Android-device acceptance stays separate and is not claimed.**

---

## 10. H-9 — corrected status, and what Batch 3 can honestly finish

| Track | Actual state | Source | Still blocked on | Batch 3 |
|---|---|---|---|---|
| N0 account capacity | **PARTIAL — executed once successfully.** One organization returned, plan `free`; DEV `btfprhticjgeihcngpif` and the F12 rehearsal `jwjrijvprbsndukfhlvf` both `ACTIVE_HEALTHY`, both PG major 17. **CAPACITY UNVERIFIED** — the read proves the visible result, not complete account-wide visibility | `docs/plans/h9-n0-final-acceptance-2026-10-19.md:1-22` | a further authorized capacity read | **not re-run.** The completed result is preserved |
| PG17 runtime | **PASS — isolated synthetic runtime verification.** Founder approved one replacement; local `supabase/postgres:17.6.1.136` pinned by digest; focused guard tests 21/21 before creation | `docs/plans/h9-pg17-final-runtime-verification-2026-10-19.md:1-22` | **real H5 restore acceptance, PENDING** | **not re-run** |
| A2 fresh 34-chain | BLOCKED | readiness doc §1 | the capacity answer, then a disposable project | not attempted |
| A3 historical upgrade | BLOCKED | readiness doc §1 | capacity, a second database, a DEV credential | not attempted |
| H-11 C5 restore rehearsal | OWED | `pre-rc-master-plan.md:254` — *"every row of `restore_drill.md` still reads `_not run_`"* | a real backup provider — hosted | not attempted. **Local PGlite validation is never reported as a real restore** |
| Vault and backup authorization evidence | OWED | — | founder-controlled | documented in §14, not claimed |

**What Batch 3 completes locally, and it is real work:**

1. The **E4 successor acceptance mechanism** (§3) — four gate updates, an
   exact-set successor check, negative controls including same-count
   substitution, drift proofs, and a **new hash-recorded E4 evidence manifest**.
2. **Role, ACL, column-privilege and RLS verification for every new and every
   re-granted object** in PGlite via `e4-admin-platform.pgtest.ts`, in the
   effective-privilege style `batch2-admin-acl.pgtest.ts` established —
   `has_table_privilege` and `has_column_privilege` for every role and
   privilege, `has_function_privilege` for all six signatures in §7.4,
   `relrowsecurity`, and policy absence.
3. **Rollback and recovery procedure** for the E4 migration: classification,
   regenerated documents, and a per-component reversal note in
   `docs/plans/e4-migration-and-rollback.md`.
4. **Production-readiness prerequisites** enumerated in
   `docs/plans/release-readiness-checklist.md`.

**Boundaries honoured, without exception:** both Supabase Free projects
untouched — no deletion, pausing, repurposing or upgrade; no hosted SQL; no
hosted write; no credential retrieval; no real-data restore; no PROD deployment;
no infrastructure spending; the founder's Galaxy A04s untouched; no sealed H-9,
F12 or H1 evidence altered.

---

## 11. Test matrix

Vitest, root config, `environment: node`. `apps/admin/lib/**/*.test.ts` and
`packages/*/src/**/*.test.ts` are already globbed; new mobile, pgtest, route and
contract files are added to `include` explicitly.

**Per-route contract tests.** `apps/admin/app/adminRoutes.contract.test.tsx`
invokes each page's default export, awaits it, and renders the result with
`react-dom/server`'s `renderToStaticMarkup`. **Verified viable at plan time**: an
awaited async component returns a plain element tree that `renderToStaticMarkup`
renders, both bare and nested. It resolves `react-dom` only from inside
`apps/admin` under pnpm, so **the test file must live under `apps/admin/`** — a
root-level file fails with `ERR_MODULE_NOT_FOUND`. No new dependency and no jsdom
is needed. `cookies()` and `getSupabaseAdmin()` are injected per test; the client
chart and map components are stubbed at the module boundary, the same technique
`vitest.config.ts` already uses for Expo modules.

For each of the eleven pages: success with fixture rows; empty; a query error
(the `ErrorNotice` text, and no stack or Supabase message in the output); an
unauthorized role (the 403 notice **and** zero **business** client calls
recorded — the audit client is expected, per §8.9c); filter and
pagination parameters reaching the query; and the declared `select` column list
matching the real schema's columns, read from the migration SQL so a renamed
column fails the test rather than production.

| Area | File | Kind |
|---|---|---|
| Admin auth and sessions | existing suites plus new revocation cases | unit + negative |
| RBAC, intersection, disabled rows | `adminRoles.test.ts`, `adminAuthz.test.ts`, **new** `adminPageGuards.test.ts` | unit + source-level |
| Every route, every state | **new** `adminRoutes.contract.test.tsx` | render contract |
| Client-boundary isolation | `serviceRoleExposure.test.ts`, extended | import-graph + bundle scan |
| Admin provisioning and revocation | **new** `adminIdentityStore.test.ts` | unit + negative |
| Shop management and tenant isolation | `adminQueries.test.ts`, **new** `adminFilters.test.ts` | unit + negative |
| Subscription reads; withdrawn actions | **new** `adminSubscriptionViews.test.ts` | unit + source-level |
| Payment-order read and reconcile security | existing, extended | unit |
| MRR, canonical predicate, counts | **new** `adminMetrics.test.ts` | unit |
| Metric manifest / label separation | rewritten `adminLabels.test.ts` | manifest + source + mutation |
| Refund-net revenue | **new** `packages/utils/src/netSales.test.ts`, extended `platformStats.test.ts`, re-run mobile report suites | unit + accounting regression |
| Admin write manifest + RPC denylist | extended `adminGrants.test.ts` | source-level + mutation |
| Durable awaited audit, committed-but-unaudited | **new** `adminAuditStore.test.ts` | unit + negative |
| Shared Zod schemas on every write | **new** `adminValidation.test.ts` | source-level + unit |
| Support permissions and persistence | **new** `adminSupport.test.ts` | unit + negative |
| Maps, consent, no-tile-no-request | **new** `adminGeo.test.ts` | unit + negative |
| Reports CSV and PDF | **new** `adminCsv.test.ts`, `adminPdf.test.ts`, `adminReports.test.ts`, `reportExportRoute.test.ts` | unit + injection + authz |
| k-anonymity | **new** `adminSuppression.test.ts` | boundary (k−1 / k) |
| Settings, flags and their consumers | **new** `adminSettings.test.ts` | unit + negative + mutation |
| Offline multilingual shop search | **new** `db/w203-shop-medicine-search.sqlite.test.ts` | real SQLite |
| SQLite migration integrity | existing `h7-access-lock` guard plus the W2-03 upgrade fixture | real SQLite |
| Postgres migration, ACL, column ACL, RLS, FK policies | **new** `e4-admin-platform.pgtest.ts` | PGlite |
| The two revokes do not break sync | **new** cases in `e4-admin-platform.pgtest.ts` **plus** every existing B2/B3/B4/H-7 pgtest | PGlite regression |
| W4-05 owner gate + identity pin | **new** `w405-shop-identity.pgtest.ts` | PGlite + negative |
| Chain succession | **new** `e4-chain-succession.pgtest.ts`; modified `h9-cron-cleanup.pgtest.ts`, `h9-prod-preflight.test.ts`, `migration-rollback-classification.test.ts` | PGlite + drift proof |
| E4 evidence manifest | **new** `e4-evidence-manifest.test.ts` | hash drift |
| Server-owned fields | modified `server-owned-fields.test.ts` | source-derived |
| POS financial and inventory regression | existing suites, unchanged and re-run | real SQLite |

**Non-vacuity is a requirement.** Every new guard ships a mutation check that
fails the assertion it targets: a planted CSV formula payload; a corrupted PDF
`xref`; a synthetic module writing `shops`; a synthetic `adminAuditStore` update;
a synthetic call to the forbidden RPC; a synthetic page missing
`requireAdminPermission`; a pharmacy metric relabelled `revenue` inside
`/revenue`; an MRR metric pointed at `netSalesPaisa`; an MRR that counts trials;
an MRR that counts canceled rows; an active-in-grace row wrongly excluded; a
refund counted on the wrong `business_date`; a non-owner `shops` write and a
non-owner identity write, each with the other barrier disabled; a row forged with
`actor_verified = true`; an action whose audit promise is not awaited; a settings
write with an unlisted key; a disabled feature flag that still renders its
feature; an export that drops its second page; a 4-shop bucket left visible; a
same-count migration substitution; a removed migration registry key; a removed
transliteration fold; a Bangla row with NULL `search_key`; and a client component
importing a `server-only` module.

**Execution discipline:** the definitive run uses a bounded worker count
(`--pool=threads --poolOptions.threads.maxThreads=4`) and **never runs
concurrently with a Codex review** — under CPU contention
`db/h7-pin-reservation.sqlite.test.ts`, `db/inventory-ledger.sqlite.test.ts` and
`h7-security.pgtest.ts` fail falsely. The exit code is recorded, not described.
No test is excluded, skipped or weakened to pass.

---

## 12. Implementation order

| Step | Work | Gate before moving on |
|---|---|---|
| 1 | E4 migration (§3.3–§3.5), successor check, four gate updates, the E4 evidence manifest, classification and document regeneration | `e4-admin-platform`, `e4-chain-succession`, `e4-evidence-manifest`, `h9-cron-cleanup`, `h9-prod-preflight`, `migration-rollback-classification` all pass, **and every existing pgtest still passes** (the revoke regression) |
| 2 | W4-05 owner gate + identity pin + ACLs + pgtest + `serverOwnedFields` reclassification | `w405-shop-identity` passes; every existing pgtest still passes |
| 3 | W4-04 shared `netSales` consumed by mobile **and** admin; admin reads; label | mobile report regressions unchanged; accounting cases pass |
| 4 | Permissions, matrix, intersection, disabled-row denial, per-user revocation | RBAC and revocation negatives pass |
| 5 | Shared Zod schemas in `packages/validation`; durable awaited audit sink; `actor_verified`; enumerated redaction; the withdrawn action removed | audit and validation negatives pass |
| 6 | Pure libs: metrics + manifest, filters, suppression, csv, pdf, reports, geo, support, settings | each lib's unit tests pass |
| 7 | Pages 1–11, the Recharts/Leaflet client components, nav, export route, loading/empty/error states | route contract tests pass; client-boundary tests pass; admin typecheck, lint and build clean |
| 8 | W2-03 migration, backfill, union query, sync safety | W2-03 suite and upgrade fixture pass, both backfill states |
| 9 | Documentation reconciliation | §13 complete |
| 10 | Definitive full suite, then Gate 5 | exit 0 recorded |

Logical local commits at each step. **No approval is requested between steps.**

---

## 13. Documentation

| File | Action |
|---|---|
| `docs/plans/muthoy-batch-3-plan.md` | this file |
| `docs/plans/muthoy-batch-3-implementation-2026-10-23.md` | NEW — evidence record, per-task before and after, every commit with its counts |
| `docs/plans/admin-architecture-rbac.md` | NEW — architecture, the §4.2 matrix, the intersection model, the fail-closed trade-off, the client-boundary rule, and the **per-page acceptance checklist**: implemented functionality, automated test evidence, missing hosted/device validation, remaining blockers |
| `docs/plans/admin-metric-definitions.md` | NEW — §5 verbatim, including the canonical predicate, the cancelled-sale asymmetry, why churn is not claimed, and why the MRR trend is blocked |
| `docs/plans/admin-reports-and-exports.md` | NEW |
| `docs/plans/admin-support-runbook.md` | NEW |
| `docs/plans/admin-audit-security.md` | NEW — storage, the awaited path, committed-but-unaudited, `actor_verified`, the enumerated redaction boundary, the durability-claim boundary |
| `docs/plans/e4-migration-and-rollback.md` | NEW — the four gates, the successor, the evidence manifest, the two revokes and why they are safe, per-component reversal, the authorization gates |
| `docs/plans/w203-shop-medicine-search.md` | NEW |
| `docs/plans/release-readiness-checklist.md` | NEW |
| `docs/plans/muthoy-five-batch-delivery-ledger.md` | MOD — Batch 3 on both axes; E4 closed locally; the six-batch structure and Batch 6's exactly-two deliverables preserved |
| `docs/plans/admin-auth-rbac.md` | MOD — status header pointing at the new document; historical text preserved |
| `DECISIONS.md` | MOD — **appended at the END only** |
| `apps/admin/README.md` | MOD — the eleven pages, the new dependencies, the new environment, the honest limits |
| `backend/supabase/deploy/batch2-admin-audit.sql` | MOD — header recording that it is superseded by migration 35 **and that the promoted table adds one column (`actor_verified`)**. Original text preserved |

**On `DECISIONS.md` and the H-9 hash manifest.** `DECISIONS.md` **is** recorded
in `audit-artifacts/h9-remediation/final-source-hashes.json:9` as
`7833b2ae…`; its current hash is
`952c3c6310964ab41205e984af8552b079984c9497adfe9c3aed4cc72df8112a`. That manifest
is a **snapshot at commit `b8ca5d8`**, not a live invariant. The drift has two
distinct parts, and revision 2 conflated them (round-2 finding 31):

- **committed:** `b8ca5d8..HEAD` adds lines to `DECISIONS.md` through H-9,
  Batch 1 and Batch 2 work, all reviewed and pushed;
- **uncommitted:** a further block sits in the working tree — the founder's H-9
  hunk plus the Batch 2 append — and is therefore *not* "already at HEAD", which
  is what revision 2 implied.

So §16's claim is narrowed to what is true: **no pre-existing H-9 artifact is
edited, and no `audit-artifacts/**` file is modified — one new
`audit-artifacts/e4/` manifest is added.** Appending to `DECISIONS.md` is
established practice (Batch 2 did it), the brief requires genuine new decisions to
be recorded, and Batch 3 appends at the very end only, leaving the founder's hunk
and the Batch 2 append untouched.

Batch 1 and Batch 2 reports are **not** rewritten, except that the Batch 2
implementation record gains a dated addendum noting the §8.3(ii) entitlement
defect found in its shipped code — a correction, not a rewrite.
`CODE-COMPLETE` and `DEVICE/PRODUCTION-VERIFIED` stay two separate axes, and **no
acceptance evidence is invented.**

---

## 14. External gates after Batch 3

Unchanged and still open: **E1** Batch 1 device validation; **E2** H-6
two-device; **E3** H-8 provider; **E6** live payment (Batch 6 B6-02); **E7**
licensed dataset (Batch 6 B6-01); **E8** bKash contract (Batch 6 B6-02); **E9**
descoped and documented.

**E4** is closed *locally* — the mechanism exists, is validated in PGlite, its
evidence is hash-recorded, and the four gates are consistent. **Hosted
application of migration 35 remains a founder-authorized operation and is not
performed.**

New or restated:

| Gate | Needs |
|---|---|
| **E10 — subscription lifecycle override API** | `docs/playbook/05-admin.md:47` records the manual extend-trial / force-status / direct-table-write design as superseded and unapproved and requires *"a separately approved audited server API"*. A founder decision plus a `SECURITY DEFINER` RPC in a future migration, with the rule that no override may create or extend paid entitlement without verified payment evidence. **This is why §8.3 ships without those controls** |
| **E11 — `b4_refresh_entitlement_snapshot` correctness** | **NEW, and a defect in shipped code.** The RPC advances `verified_at` without rederiving entitlement, and `entitlements.ts:143-146` makes `verified_at` the offline access ceiling, so the shipped admin button extends paid access with no payment. Batch 3 removes the surface and forbids the RPC by name; **fixing the RPC is money-path SQL needing an approved plan** (CLAUDE.md rule 10) |
| **E12 — immutable subscription lifecycle history** | a historical MRR series and a true churn trend both need it; `billing_subscriptions` is a mutable current-state row (§8.4, §5.1c) |
| **E13 — location consent record** | a versioned, revocable consent record **and** a mobile capture flow. Neither a coordinate nor a consent record exists today, so Maps ships an empty state |
| **E14 — map tile provider** | an approved tile provider and a privacy/data-processing design. The tile URL is unset by default and the component makes no third-party request until it is set |
| **E15 — deployed-browser verification** | `docs/playbook/05-admin.md:86-92` requires checking the devtools network tab on a real deployment before **any** admin feature is considered done, and calls it *"a hard-spot verification, not a formality"*. It cannot be performed without a deployment, so it is an explicit gate: inspect the network tab and the shipped client bundle for the service-role key. **No admin page is DONE until this passes** |
| E4-H | founder authorization to apply migration 35 to DEV, then PROD, with the successor check run against the real history |
| H-9 capacity | a further authorized read to settle Free-slot capacity; N0 itself is PARTIAL and executed |
| H-9 A2/A3 | the capacity answer, then a disposable project — and a cost decision if no Free slot exists |
| H-11 C5 / real H5 restore | a real backup provider and an authorized restore rehearsal. The isolated PG17 runtime verification already PASSED and is not re-run |
| Admin deployment | a Vercel deployment, provisioned admin accounts, and `ADMIN_SESSION_SECRET`, `ADMIN_ROLES`, `ADMIN_ACCOUNTS` set in the hosted environment |
| Durable audit evidence | the above, plus a hosted run writing and reading a row |
| Admin notification dispatch | no dispatcher exists, which is why §8.11's templates are read-only |

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| The two revokes break sync | §3.5 — SECURITY DEFINER reasoning, plus every existing pgtest as a regression gate, plus explicit privilege assertions. If a suite breaks, the plan is corrected rather than the grant left wide |
| The E4 migration breaks a sealed gate | §3.1 lists **four** gates with **five** hardcoded values; gate 2 stays byte-identical; the successor asserts an exact version set; a same-count substitution is a required negative control |
| A paid entitlement granted without payment | §8.3 withdraws the offending action, forbids the RPC by name, and asserts no write reaches the four entitlement tables |
| Admin write power widens | §8.12's `(module, table, operation)` manifest plus an RPC denylist; nine tables in no entry; column-level UPDATE so attribution and history columns are immutable by privilege |
| A client component leaks a credential | §8 — transitive import-graph assertion, props-shape assertion, and a built-chunk scan, on top of build-enforced `server-only` |
| Two net-sales definitions | §6 item 2 — mobile consumes the shared helper, regressions re-run |
| W2-03 corrupts a live FTS index | external-content rebuild, no row rewrite, an upgrade fixture asserting every row and every stock figure, a union query correct in both backfill states |
| Fail-closed role store takes the panel down | stated explicitly; `ADMIN_SESSION_EPOCH` stays as break-glass |
| A route "passes" without rendering | §11's per-route contract tests, verified viable at plan time, including the schema-column check |
| A mislabelled money figure | §5.2's typed manifest, with mutations inside the mixed `/revenue` route |
| Local Vitest reporter-RPC timeouts | bounded worker count; never concurrent with a review |
| Scope creep | this plan is the boundary. B6-01, B6-02 and barcode untouched; E10–E15 deferred rather than improvised |

---

## 16. Working-tree preservation

Enumerate with `git status --porcelain=v1 --untracked-files=all` — **never** the
default `--porcelain`, which collapses
`apps/prototype-web/Muthoy (prototype)/.expo/` into one entry although it holds
two files. That collapse is why earlier revisions recorded 40, 42 and 47.

**Measured: 49 paths — 10 modified, 39 untracked.** 48 are pre-existing; the 39th
untracked path is this plan file.

- Modified, protected (2): `scripts/h9/install-local-runtime.ps1`,
  `apps/prototype-web/Muthoy (prototype)/pnpm-workspace.yaml`
- Modified, this batch stages (8): `DECISIONS.md` (appended at the END only) and
  the seven roadmap documents — `bkash-integration-runbook.md`,
  `medicine-catalog-provenance.md`,
  `muthoy-batch-1-implementation-2026-10-20.md`,
  `muthoy-batch-2-handoff-2026-10-22.md`,
  `muthoy-batch-2-implementation-2026-10-21.md`,
  `muthoy-five-batch-delivery-ledger.md`, `pre-rc-master-plan.md`
- Untracked, protected and never staged (38): **26** `scripts/h9/**`, **8**
  `docs/plans/h9-*`, **4** prototype paths (`.expo/README.md`,
  `.expo/devices.json`, `pnpm-lock.yaml`, `tsconfig.json`)

**Forbidden, without exception:** `git add .`, `git add -A`, `git reset`,
`git stash`, `git clean`, `git commit --amend`, force push. Every path is staged
by name, and the staged manifest is printed and checked before each commit. **No
file in `.gitattributes`' `eol=lf` list is modified. No pre-existing H-9 artifact
is edited, and no existing `audit-artifacts/**` file is modified — one new
`audit-artifacts/e4/` manifest is added.** `pnpm-lock.yaml` at the repository root
**is** modified, by the three `apps/admin` dependencies §8 adds; the prototype's
own untracked `pnpm-lock.yaml` is a different file and stays untouched.

---

## 17. Volume 5 compliance

`docs/playbook/05-admin.md` is the admin panel's own specification. Checked
clause by clause:

| Volume 5 clause | Batch 3 |
|---|---|
| P0: two pages, read-only list + two-number dashboard | both preserved and extended; the P0 reads still work |
| Dashboard P1: active-today, MRR, trial-vs-paid, recent signups | §8.1, with trial-vs-paid split into the honest figures of §5.1c |
| Analytics P1: time-series, aggregated, *"never per-shop financial detail unless drilled into one shop"* | §8.5, plus a k=5 floor Volume 5 does not require |
| Pharmacy Management P1: searchable/filterable by district, plan, activity; drill-down with profile, plan, map location, recent activity, support notes | §8.2; map location gated on E13 |
| Users P1: founder's own admin accounts, role-gated | §8.8 |
| Subscription P1: list by status, due-soon via next billing. *"superseded and unapproved"* override design | §8.3 — list, statuses and due-soon built; **overrides NOT built**, gate E10 |
| Audit Logs P1: read-only view into each shop's `audit_logs`, never edit or delete | §8.9b, `shop_audit.read` scoped to super_admin and support per *"support/debugging use only"* |
| Revenue P1: MRR trend, plan-tier breakdown, churn *"computed from `subscriptions` history"* | §8.4. Plan-tier breakdown built. **MRR trend and churn are BLOCKED** on gate E12 — the history the clause assumes does not exist on a mutable row — and a collected-payments trend plus recorded cancellations ship in their place, each labelled as itself |
| Charts P1: Recharts | **used.** No deviation |
| Maps P1: Leaflet, marker colour = plan tier, click to drill down | **Leaflet used.** Colour-by-tier and drill-down built; markers gated on E13, tiles on E14 |
| Reports P1: exportable CSV/PDF platform summaries, distinct from per-shop owner reports | §8.10 |
| Role Management P1: super-admin vs support-read-only, separate from pharmacy roles | §4.2's four roles, separate namespace |
| Settings P1: notification templates, feature flags, environment info | §8.11; templates read-only because no dispatcher exists |
| **The one rule**: service-role key in server-side code only; browser bundle never contains it; *"verify this explicitly (check devtools' network tab) before considering ANY admin feature done — a hard-spot verification, not a formality"* | build-enforced `server-only`; the three client-boundary assertions in §8; **and the deployed devtools/bundle inspection is gate E15**, which no admin page is DONE without. Revision 2 claimed §14 carried this check and it did not |

Other volumes checked for clauses governing this batch:
`00-execution-roadmap.md` (the P0/P1/P2 scope lock and Beta definition CLAUDE.md
rules 12 and 13 bind to — the admin panel's P1 build-out is assigned to Batch 3
by founder decision, which changes *when*, not *what*),
`02-system-architecture.md:120-132` (shared packages — §8.13 is the
`packages/validation` rule), `03-database-backend.md` (migration and FK policy —
§3.4). Volume 3's cash formula is untouched by this batch.

---

## 18. Review log

| Round | Reviewer | Verdict | Findings | Disposition |
|---|---|---|---|---|
| 1 | Codex `gpt-5.6-sol` | **PLAN REVISE** | 29 (6 CRITICAL, 14 HIGH, 8 MEDIUM, 1 LOW) | all 29 applied in revision 2; one prescription declined with reason |
| 2 | Codex `gpt-5.6-sol` (targeted delta) | **PLAN REVISE** | 21 of 29 confirmed RESOLVED; **15 new** (30–44: 2 CRITICAL, 10 HIGH, 3 MEDIUM) | **all 15 applied in revision 3.** No prescription declined |
| 3 | Codex `gpt-5.6-sol` (targeted delta) | **PLAN REVISE** | 10 of 15 confirmed RESOLVED (30–36, 38, 42, 43); **3 new HIGH** (45–47) plus 2 notes | **all 3 and both notes applied in revision 4.** No prescription declined |
| 4 | Codex `gpt-5.6-sol` (targeted delta) | **PLAN REVISE** | 47 and note40 RESOLVED; **1 new HIGH** (48) plus 3 notes | **all 4 applied in revision 5.** No prescription declined |
| 5 | Codex `gpt-5.6-sol` (targeted delta) | **PLAN ACCEPT** | 48 and all three round-4 notes RESOLVED; the #46/#47/#37/#40 re-checks confirmed correct; one non-blocking note | note applied in §4.4 and §11 — "no **business** client/query calls". **GATE 2 CLOSED** |

**Gate 2 is CLOSED on revision 5.** Five independent rounds, 48 findings, every
one verified against the code and applied; one round-1 prescription declined with
its reasoning recorded in §13. Do not re-plan and do not re-review the plan —
Gate 5 reviews the implemented code.

### Round 4 disposition

| # | Sev | Subject | Applied in |
|---|---|---|---|
| 48 | HIGH | `next/dynamic` with `ssr: false` is rejected in a Server Component in Next 15, so the `/maps` page cannot own that call | §8 — a thin `'use client'` loader owns `dynamic(…, { ssr: false })`; the server page imports only the loader |
| note | — | the layout uses `hasPermission`, not `requirePermission`, and `adminAuthz.test.ts:56-68` asserts the denial audit rather than acting as a pure predicate | §8.9c — both corrected; that test is **retargeted**, with the throw staying on `requirePermission` and the audit assertion moving to `requireAdminPermission` |
| note | — | "no query" is false once denial auditing inserts a row | §8.9c — qualified to "no **business** query" |
| note | — | `refreshEntitlementSnapshot` is called outside its dedicated describe block, at `adminActions.test.ts:33` and `:125-182` | §8.3(ii) — the complete six-row call-site table; the shared RBAC block is retargeted, not deleted |
| note | — | Strict-Mode cleanup must clear the ref and ignore a stale in-flight import | §8 — both added to the cleanup requirement |

### Round 3 disposition

| # | Sev | Subject | Applied in |
|---|---|---|---|
| 45 | HIGH | an async `audit()` cannot cover a denial, because `requirePermission` records it synchronously and throws | §8.9c — the denial audit moves into `requireAdminPermission`, awaited before the rethrow; `requirePermission` keeps its signature and stops recording |
| 46 | HIGH | a `'use client'` boundary is not an SSR boundary, so a static `leaflet` import breaks `next build` on `window` | §8 — `next/dynamic` with `ssr: false`, dynamic import inside `useEffect`, bundled icons, Leaflet CSS, Strict-Mode-safe `map.remove()`, and a real `next build` gate; §8.6 repeats it for the map page |
| 47 | HIGH | the schema list omitted the two **retained** write actions | §8.13 — ten schemas; `adminAccountIdAction` and `adminPaymentOrderIdAction` parsed before the RPC and the table write |
| note | — | the withdrawal's three dependents were unnamed | §8.3(ii) — `adminFormActions.refreshSnapshotAction` deleted, the `/accounts/[id]` button replaced, the test block deleted with a replacement assertion |
| note | — | the three-state result does not fit a boolean redirect mapping | §8.9d — `outcomeQuery` gains `applied_unrecorded`, with a distinct notice per value |

### Round 2 disposition, finding by finding

| # | Sev | Subject | Applied in |
|---|---|---|---|
| 30 | MEDIUM | gate 4's fifth hardcoded value — the one-element override assertion | §3.1 gate 4, §3.2 item 4 — both overrides, comment rewritten |
| 31 | MEDIUM | drift provenance conflated committed with worktree | §13 — the two parts stated separately; §16 narrowed |
| 32 | HIGH | `sync_apply_row_pre_h7` is already revoked, not granted | §7.4 — corrected, citing `20260907020000:70-71` |
| 33 | HIGH | DDL still held placeholders | §3.4 — every column, check, enum, length bound and index enumerated |
| 34 | HIGH | CASCADE can erase append-only notes | §3.4 — `admin_support_notes.case_id` is `ON DELETE RESTRICT` |
| 35 | CRITICAL | bare SELECT grants leave existing DML in place | §3.5 — revoke-then-grant on `sale_refunds` and `audit_logs`, with a regression gate |
| 36 | HIGH | table-wide UPDATE lets attribution be rewritten | §3.4 — column-level UPDATE grants on all three mutable tables |
| 37 | CRITICAL | the refresh RPC extends paid access without payment | §8.3(ii) — surface removed, RPC forbidden by name, gate E11; RPC itself not modified |
| 38 | HIGH | MRR predicates contradicted the canonical one | §5.1a — canonical predicate reused; active-in-grace and canceled-in-paid-through fixed |
| 39 | HIGH | a void `write()` plus a sibling does not make call sites await | §8.9 — `audit()` becomes async and is awaited on every return path |
| 40 | HIGH | committed-then-unaudited reported as plain failure | §8.9 — distinct `committed: true` result that must not be retried |
| 41 | HIGH | SVG contradicted the locked Recharts/Leaflet stack | §8 — **deviation withdrawn**; Recharts and Leaflet in isolated client components with three boundary assertions |
| 42 | HIGH | a collected-payments trend is not Volume 5's MRR trend | §8.4, §17 — labelled as itself; MRR trend BLOCKED on gate E12 |
| 43 | HIGH | the mandatory browser network check was in no gate | §14 — gate **E15**, and no admin page is DONE without it |
| 44 | HIGH | no shared Zod schemas despite the repository rule | §8.13 — eight schemas in `packages/validation`, parsed before any client call |
