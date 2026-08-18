# backend/supabase/migrations/

Apply timestamped files in order with the Supabase CLI.

The initial schema mirrors 21 SQLite business tables with native UUIDs,
BIGINT paisa, explicit FK deletion behavior, and shop-isolating RLS. Sync RPCs
preserve client `updated_at` values for Beta LWW and are executable only by
`service_role`.

Committed migrations are immutable; later changes require a new migration.

## After applying the ledger migrations, run the invariant check

`20260818000000_inventory_movement_ledger.sql` turns `batches.stock` into a
projection of `inventory_movements` and backfills every existing batch onto
that invariant. Its closing assertion aborts the migration if any batch is left
off it, but that only covers the moment it ran. Verify the result against the
real database before promoting anything:

```bash
psql "$DATABASE_URL" -f backend/supabase/checks/ledger_invariant.sql
```

Read-only, safe to repeat. `checks/` sits outside this directory on purpose —
the CLI applies `migrations/` and only `migrations/`, so nothing there can run
as a migration by accident. PASS is `status = 'PASS'` from check 0, zero rows
from checks 1–4, and all four triggers `present` in check 5.

**What these two migrations do, briefly** (full account in `DECISIONS.md`,
2026-08-18): replace a plain LWW-synced `stock` column — which let two
devices' offline sales silently overwrite each other — with
`stock = SUM(inventory_movements.change_qty)`, enforced by
`batches_stock_is_ledger_derived`/`apply_inventory_movement` so only a
movement's own delta can ever move `stock`. `inventory_movement_no_delete`
(errcode `MU007`) makes movements append-only; correction is a tombstone, not
a delete. Rows that predate the ledger are backfilled with one synthetic
`adjustment` movement per stock gap, its id derived deterministically from
the batch's own UUID (version nibble set to `8`) so this backfill and
SQLite's `0006` migration mint the identical id independently and never
double-count. An actorless stock gap aborts the migration (`MU008`) rather
than being silently skipped.

**Status: written and tested, NOT yet pushed to Dev/Test.** Execute against
the linked project only via the reviewed checklist (schema+data backup first,
`db push --dry-run`, actorless/invariant prechecks, push, then this file's
invariant check) — not ad hoc.

## `BYPASSRLS` is not a `GRANT` — read this before adding a direct table read

`service_role` carries `BYPASSRLS`, which skips row-level **policies** but
confers **no table privileges**. PostgREST still runs `set role service_role`,
so every statement is checked against the table ACL first. The initial schema
creates all 21 business tables and grants nothing on any of them — only
`shop_claims` and the four sync functions got explicit grants. Any code path
that reaches a table *directly* rather than through a `SECURITY DEFINER`
function therefore fails with SQLSTATE 42501 until it is granted.

Two later migrations fix the two places that had already hit this:

| Migration | Grants | Why |
| --- | --- | --- |
| `20260817000000_admin_read_grants.sql` | `select` on `shops`, `sales` to `service_role` | The Day 14 admin panel's two pages read exactly these two tables and join nothing. |
| `20260817000100_sync_roles_read_grant.sql` | `select` on `roles` to `service_role` | `functions/sync/push.ts` authorizes a `permissions` row by reading the owning role's `shop_id` directly — the one sync access not behind a `SECURITY DEFINER` function. |

Both are `SELECT`-only, name their tables explicitly, and target `service_role`
alone — no `anon`/`authenticated` grant, no write privilege, no policy change,
and deliberately no `ALTER DEFAULT PRIVILEGES`, which would silently cover every
future table. New tables must opt in with their own explicit grant.

`apps/admin/lib/adminGrants.test.ts` and `functions/sync/grants.test.ts` derive
the required tables from the querying source and fail if a direct read is added
without a matching grant.
