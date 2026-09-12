# Supabase migration order and rollout status

Apply timestamped files in lexical order. Committed migrations are immutable;
schema changes require a new file. SQLite remains the mobile source of truth,
and every PostgreSQL money column mirrors integer paisa.

## Exact PostgreSQL order

```text
20260813000000_initial_schema.sql
20260817000000_admin_read_grants.sql
20260817000100_sync_roles_read_grant.sql
20260818000000_inventory_movement_ledger.sql
20260818000100_sync_batches_stock_server_derived.sql
20260819000000_staff_device_login.sql
20260821000000_phase_b1_navigation_roles.sql
20260821010000_phase_b2_sales_inventory_sync.sql
20260822000000_owner_dashboard_credit_period.sql
20260822010000_b3_group1_shop_settings.sql
20260823000000_b3_group2_payment_note.sql
20260823010000_b3_group2_cash_reconcile.sql
20260823020000_b3_group2_sync_completion.sql
20260823030000_b3_group3_expense_category_taxonomy.sql
20260823040000_b3_groups456_schema_additions.sql
20260823050000_b3_groups456_sync_completion.sql
20260824000000_b3_group7_purchase_return_sync.sql
20260825000000_inventory_add_purchase_sync.sql
20260827000000_b3_group8_report_indexes.sql
20260827010000_b3_group9_sale_tax_snapshot.sql
20260831000000_b4_commercial_platform.sql
20260905000000_b4_canonical_onboarding.sql
20260907000000_h7_security_hardening.sql
20260907010000_h7_revoke_api_role_truncate.sql
20260907020000_h7_fix_pass_b.sql
20260909000000_h7_actor_binding_staff_reactivation.sql
```

Do not reorder the function-wrapper migrations: each later grouped-operation
dispatcher delegates to the function version installed immediately before it.
The report-index migration must precede the tax-snapshot migration.

## Local SQLite order

The mobile runner and Drizzle journal register this exact numeric order:

```text
0000_open_senator_kelly.sql
0001_medicines_fts.sql
0002_furry_celestials.sql
0003_curious_wild_pack.sql
0004_deep_boomer.sql
0005_eminent_legion.sql
0006_inventory_movement_ledger.sql
0007_staff_device_login.sql
0008_native_pin_lookup.sql
0009_strong_gargoyle.sql
0010_known_ares.sql
0011_black_zarda.sql
0012_small_meltdown.sql
0013_owner_dashboard_credit_period.sql
0014_owner_dashboard_credit_period_guard.sql
0015_b3_shop_settings.sql
0016_payment_note.sql
0017_cash_reconcile.sql
0018_expense_category_taxonomy.sql
0019_supplier_archive.sql
0020_purchase_item_status.sql
0021_purchase_void.sql
0022_supplier_profile_fields.sql
0023_purchase_invoice_metadata.sql
0024_b3_report_indexes.sql
0025_b3_sale_tax_snapshot.sql
0026_b4_commercial_cache.sql
0027_h7_local_access_lock.sql
0028_shop_scoped_pin_lookup.sql
0029_pin_reserved_while_inactive.sql
```

B1 starts at `0009`; B2 sales/inventory occupies `0010`-`0012`, followed by
dashboard credit-period migrations `0013`-`0014`; B3 occupies `0015`-`0025`.
B4 local commercial membership/entitlement/payment caching is `0026`; H-7's
device-only access lock, shop-scoped PIN lookup, and PIN reservation across
inactive/locked users are `0027`-`0029`.

`0018` backfills the old expense categories to
Rent/Salary/Utilities/Conveyance/Other. `0024` backfills missing sale business
dates using Asia/Dhaka. `0025` adds immutable MRP-inclusive integer-paisa tax
snapshots. These data-shape steps need production backups and postchecks; they
are not routine column-only changes.

## Current status — 2026-09-12

- The hosted ledger is applied **26/26** through
  `20260909000000_h7_actor_binding_staff_reactivation.sql` (confirmed by
  direct hosted verification, 2026-09-12: `supabase migration list
  --linked`), covered by real SQLite/PGlite migration tests, including fresh
  order, legacy upgrade/backfill, repeated application where supported,
  RLS/shop isolation, grouped operation replay, inventory ledger,
  `inventory_add`, reporting, and tax constraints.
- `20260909000000_h7_actor_binding_staff_reactivation.sql` is deployed. It
  shipped 2026-09-10 — two days before an earlier revision of this file
  called it "not deployed pending review" from stale local docs instead of
  checking the hosted project directly. That line is corrected here.
- SQLite is registered through `0029`. H-7 automated/security validation,
  single-device physical validation, and the `0027`-`0029` on-device upgrade are
  all **PASS** (2026-09-12); full suite 170 files / 2,058 tests PASS with
  typecheck and lint clean. No known H-7 application defect remains. Physical
  two-device convergence is **NOT RUN** (no second device) and is deferred —
  see the Fix Pass B sign-off checklist below.
- B4 DB/migration parity, RLS, Auth hook configuration, ledger invariants, and
  valid production-row preservation were verified during controlled rollout.
- Deployed `sync` is **v16 ACTIVE** (updated 2026-09-10 07:28:21 UTC),
  carrying the actor-binding/reactivation Edge source. `payment-webhook` is
  still undeployed and not production-ready while
  SSLCommerz credentials/live validation remain absent.
- Recorded B4 completion suite: **PASS** — 146 files, 1,537 tests; typecheck and
  lint PASS. Coverage includes canonical onboarding, hosted ACL/grants,
  commercial/trial/Multi-Shop behavior, direct-write denial, and migration parity.

## Required sequence for future migrations

1. Confirm the linked project/environment and current remote migration table.
2. Take schema and data backups.
3. Run actorless-ledger and data-shape prechecks, especially legacy expense
   categories, null/mismatched business dates, ledger gaps, and money ranges.
4. Re-run the CLI dry-run and review this exact ordered list.
5. Apply the pending migrations once, in order.
6. Run `backend/supabase/checks/ledger_invariant.sql`; PASS is check 0 =
   `PASS`, zero rows from checks 1-4, and all four triggers present in check 5.
7. Deploy the matching sync Edge Function only after schema success.
8. Confirm `public.custom_access_token_hook` remains selected in Supabase Auth
   Hooks; migrations cannot preserve/enable this hosted setting. Mint/decode a
   token and verify all current Owner claims.
9. Run post-deploy B1-B4 smoke tests: role revocation, `inventory_add`, sale and
   stale quote, grouped replay, refund claim, credit convergence, purchase/
   return/supplier credit, reports/tax/export, and two-device stock convergence.

Do not deploy the app before both schema and matching function versions are
live. Several B2/B3 operations intentionally require atomic server dispatchers;
a new client against an old backend can halt or reject queued groups.

## Inventory ledger invariant

`20260818000000_inventory_movement_ledger.sql` and
`20260818000100_sync_batches_stock_server_derived.sql` replace absolute LWW
stock with `batches.stock = SUM(inventory_movements.change_qty)`. Only the
movement trigger changes stock. Movements are append-only; correction is a
tombstone/compensating movement, never physical deletion. Deterministic
backfill IDs prevent SQLite and PostgreSQL from double-counting the same legacy
gap. An actorless gap aborts instead of being skipped.

Run the read-only postcheck from the repository root:

```bash
psql "$DATABASE_URL" -f backend/supabase/checks/ledger_invariant.sql
```

## Service-role grants

`BYPASSRLS` skips policies but grants no table privilege. Direct PostgREST reads
still require explicit least-privilege grants:

| Migration | Grant | Consumer |
| --- | --- | --- |
| `20260817000000_admin_read_grants.sql` | `SELECT` on `shops`, `sales` | P0 admin pages |
| `20260817000100_sync_roles_read_grant.sql` | `SELECT` on `roles` | sync permission-row authorization |

Canonical onboarding and owned-shop mutation deliberately add no broad
service-role table writes. `20260905000000_b4_canonical_onboarding.sql` exposes
only service-role execution of `SECURITY DEFINER` functions
`b4_onboard_owner(...)` and `b4_mutate_owned_shop(...)`; execution is revoked
from public, `anon`, and `authenticated`. The PGlite harness models hosted ACLs,
and grant tests fail if direct protected-table writes appear without an explicit,
reviewed boundary.

No migration grants table writes to `anon` or `authenticated`, and no default
privilege grants future tables automatically. New direct reads must add an
explicit grant and extend the grant tests.

## H-7 security hardening — 2026-09-07, APPLIED to Dev/Test

`20260907000000_h7_security_hardening.sql` is additive and edits no applied
file. It closes the findings of the H-7 audit:

- **C-1 (critical).** `sync_apply_row` accepted a row whose `shop_id` named
  another shop whenever the row id did not already exist — the insert arm of
  `sync_apply_row_base` carries its caller predicate only on the
  `on conflict do update` branch, and `sync_existing_row_owned_or_missing`
  answers true for a missing row by definition. Executed against a real
  Postgres, a Shop A caller planted a medicine and a customer into Shop B and
  invented a brand-new `shops` row, all returning `applied`. Only push.ts's
  TypeScript check stood in the way. `h7_row_shop_matches_caller` now runs
  before dispatch, on both `sync_apply_row` overloads.
- **H-1.** `sync_pull_changes_b2` gated fifteen tables on nothing but "is the
  caller a live user of this shop", so a default Staff member received every
  `expenses` and `payments` row in the shop even though RLS denies them both.
  Read eligibility now lives in one function, `sync_table_readable`, which both
  the pull and the new `sync_readable_tables` are expressed through — the two
  cannot drift.
- **M-1 / M-2.** Liveness added to the six bare `b2_shop_read` policies and to
  the `staff_id = <claim>` branch of the six sale-history policies.
- **M-4.** The unconditional `return true` for a null `billing_account_id`
  becomes a bounded onboarding window (`h7_shop_billing_bootstrap_allowed`).
- **Defence in depth.** `DELETE` revoked from `anon`/`authenticated` on every
  tombstone-only table; the unfiltered legacy `sync_pull_changes(...)` dropped;
  explicit revokes on `auth_bindings` and `login_attempts`.

**M-5 was deliberately NOT changed.** Withholding claims from a revoked
principal was implemented and reverted: without `app_user_id` the server answers
503 `hook_not_configured`, which `sync/requestFailure.ts` classifies as `config`
and `isRetriableFailure()` treats as non-retriable — a deactivated cashier would
be told the server is misconfigured instead of being logged out. The claims
do not authorize an Edge request: `assertCallerCurrent` re-reads the live user,
binding, shop and plan state, and hosted API roles have no direct table data
grants. This is deliberately narrower than claiming every SQL predicate has
full commercial liveness: `auth_is_owner` and `b2_user_is_owner` do not. The
asymmetry is pinned as intentional by
`h7_token_hook_decorates_revoked_principal`.

Pass A's matching Edge changes are deployed in `sync` v13.

## H-7 Fix Pass B — 2026-09-07, DEPLOYED / PHYSICAL RETEST PASS

`20260907020000_h7_fix_pass_b.sql` adds a server-owned bootstrap-window table
and insert trigger. `h7_shop_billing_bootstrap_allowed` now reads that immutable
anchor instead of client-writable `shops.created_at`; stale unbilled shops close
after 24 hours, future-dating the shop row cannot extend the window, missing
pre-creation rows still pass canonical onboarding, and archived/deleted shops
remain denied. The table is RLS-enabled with no API grants.

The same migration revokes direct `service_role` execution of
`sync_apply_row_pre_h7(...)`. The guarded `sync_apply_row(...)` wrapper remains
executable and functional through SECURITY DEFINER ownership.

The matching Edge/client change adds strict `readableTables` validation,
shop-scoped purge, pending/failed FK-parent closure, sale-history row pruning,
stable access versions across pagination, and authoritative local revocation
lockdown. SQLite migration `0027_h7_local_access_lock.sql` is registered after
`0026` in both the runtime journal and bundle. Its device-only
`access_locked_at` marker is stripped outbound and preserved during remote user
hydration; revocation never rewrites server-owned `is_active`. A successful
credential proof plus full hydration clears the device lock; malformed
reconciliation answers never purge.

Fix Pass B is deployed as migration 25 with `sync` v14. Physical Android
validation found the shared-device stale-JWT and Staff-reactivation blockers;
their additive migration 26 and matching Edge/client source **were deployed
2026-09-10**, bringing the hosted ledger to 26/26 and `sync` to v16 —
confirmed by direct hosted verification on 2026-09-12 (see "Current status"
above).

Single-device physical validation is **PASS** as of 2026-09-12, and no known
H-7 application defect remains. Wave 1 sign-off checklist:

- Staff local SQLite excludes `expenses` and `payments` after reconciliation — PASS.
- A deactivated Staff member immediately loses protected local data/actions — PASS.
- Owner, Manager, and Staff normal flows still work — PASS.
- Multi-Shop/shared-device switching stays isolated — PASS.
- SQLite `0027`-`0029` apply on a real upgraded device database — PASS.
- Two devices converge after writes and permission changes — **NOT RUN.** Only
  one Android device exists and the emulator cannot run Muthoy. Deferred to
  post-RC/pilot field validation; it must not be recorded as verified.

The deferred row is covered in automation wherever convergence is decidable
without a second handset: `inventory-ledger.sqlite.test.ts` (both directions,
order-independent, redelivery and offline-queue merge), `hydration-ledger`
(replay, interruption, page splits), `sale-graph-hydration.sqlite.test.ts`
(receiving-device sale/report/cash/credit read models plus idempotency),
`credit-convergence.pgtest.ts` (two devices against one server balance), and
`h7-security.pgtest.ts` (cross-shop isolation). What stays unexercised is real
transport, hosted RLS round-trip, clock skew between handsets, and genuinely
simultaneous push.

## Known rollout risks

- Confirm the linked project and ledger before every future rollout; the
  remote verified cutoff is
  `20260909000000_h7_actor_binding_staff_reactivation.sql` (26/26, confirmed
  2026-09-12).
- H-7 Fix Pass B and the actor-binding/reactivation follow-up are both applied
  to Dev/Test; the remote ledger is 26/26 and `sync` v16 is ACTIVE.
- `M-3` (hosted ACL parity) is now VERIFIED against the DEV project. Findings:
  - `anon` and `authenticated` hold **no** SELECT/INSERT/UPDATE/DELETE on any
    table in `public`. Direct PostgREST data access is impossible before RLS is
    even consulted.
  - `service_role` holds SELECT on exactly `roles`, `sales`, `shops`, `users`
    plus the tables later migrations granted explicitly — matching the harness's
    assumption that only explicit GRANTs count.
  - Supabase's blanket `grant all` is on the **supabase_admin** default ACL, not
    the `postgres` one. Tables these migrations create get `anon=Dxtm`,
    `authenticated=Dxtm`, `service_role=Dxtm` — TRUNCATE, REFERENCES, TRIGGER,
    MAINTAIN and nothing else. Functions get `postgres=X` only, so **every RPC
    that works in production is carried by an explicit `grant execute`**.
  - `pgtest/harness.ts` was corrected for the function half (see
    `HOSTED_FUNCTION_EXECUTE_MODEL`) and now revokes the free PUBLIC EXECUTE
    after migrations run. The table half stays deliberately wider so RLS is
    still the thing that denies a row. No production grant was widened.
  Re-run the reading with:
  `select grantee, table_name, privilege_type from information_schema.role_table_grants
   where table_schema='public' and grantee in ('anon','authenticated','service_role')
   order by grantee, table_name, privilege_type;`
- **CLOSED (2026-09-07): `anon`/`authenticated` TRUNCATE.** They held it on 32
  tables, inherited from the platform default ACL and never revoked; TRUNCATE
  ignores RLS entirely and leaves no tombstone for sync to carry. It was never
  reachable — PostgREST exposes no TRUNCATE verb and no function in `public`
  issues one — so this was defence in depth, not an incident.
  `20260907010000_h7_revoke_api_role_truncate.sql` revokes it from every base
  table in `public` and narrows the default ACL so new tables cannot inherit it.
  Hosted now reads `anon=xtm, authenticated=xtm, service_role=Dxtm`; the API
  roles' TRUNCATE grant count is 0 and `service_role` is untouched.
- Residue, deliberately left: `anon`/`authenticated` still hold REFERENCES,
  TRIGGER and MAINTAIN from that same default ACL. Each needs its own
  reachability argument, and widening the TRUNCATE change to cover them would
  have shipped privilege edits no test in that pass covered.
- Expense-category and business-date backfills touch existing data.
- Ledger backfill needs a valid actor for every historical gap.
- Client/function/schema version skew can strand atomic groups.
- The access-token hook is currently enabled, remains a manual hosted setting,
  and fails closed when absent.
- Live two-device convergence, refund authority, and revocation must be checked
  after deploy even though PGlite coverage passes. Two-device convergence has
  **never been run on hardware** — one device only — so it carries no physical
  evidence at all and is deferred to post-RC/pilot field validation.
- SQLCipher, production OTP/provider hardening, and broader BLE printer-model
  rollout remain separate release gates.
- Client DEV bypass removal is done (H-2, 2026-09-06). Anonymous sign-ins must
  still stay disabled in Authentication → Providers on every project, but that
  toggle is no longer the only defence: `verifyCallerJwt()` now rejects an
  anonymous caller outright with `anonymous_session_rejected` (H-7, 2026-09-07),
  ahead of any claim handling.
