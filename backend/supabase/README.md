# backend/supabase/

Supabase cloud mirror and Edge Functions.

- `migrations/`: 21-table PostgreSQL mirror, RLS, service-role-only sync RPCs,
  and the narrow `SELECT` grants the Day 14 admin panel and the sync push path
  need — see that folder's README on why `BYPASSRLS` is not a `GRANT`.
- `functions/sync/`: authenticated push, pull, and device-link actions.

- `pgtest/`: the migrations, RLS policies, permission functions and access-token
  hook EXECUTED against a real Postgres (PGlite — Postgres compiled to Wasm, no
  Docker). `harness.ts` recreates the parts of a hosted project that exist
  before migration 1 (the `auth` schema, the four roles, the default privileges)
  and then applies `migrations/` unchanged. Runs with the rest: `pnpm test`.

SQLite remains the mobile source of truth. Notifications and the local sync/conflict
queues are intentionally not mirrored.

## Required manual step after deploying migrations

`custom_access_token_hook` must be registered by hand: **Auth → Hooks →
Customize Access Token → `public.custom_access_token_hook`**.

No migration can do this. Until it is registered, no token carries
`app_user_id`, `role` or `permission_version`; `assertCallerCurrent` returns the
distinct `hook_not_configured` failure, and the client halts without consuming
outbox attempts. A stale version instead returns `permissions_changed`, which
the client refreshes and retries exactly once.
Direct PostgREST access fails CLOSED in the same state (`auth_has_permission`
resolves a null actor to false), which is the safe direction but equally silent.

Verify after deploying: mint a session, decode the access token, and confirm
`app_metadata.app_user_id` is present.
