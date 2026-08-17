# backend/supabase/migrations/

Apply timestamped files in order with the Supabase CLI.

The initial schema mirrors 21 SQLite business tables with native UUIDs,
BIGINT paisa, explicit FK deletion behavior, and shop-isolating RLS. Sync RPCs
preserve client `updated_at` values for Beta LWW and are executable only by
`service_role`.

Committed migrations are immutable; later changes require a new migration.

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
