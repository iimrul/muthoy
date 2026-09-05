# backend/supabase/

Supabase cloud mirror and Edge Functions.

- `migrations/`: timestamped PostgreSQL mirror, RLS, service-role-only sync
  RPCs, B1-B3 grouped-operation dispatchers, report/tax schema, and narrow
  direct-read grants. See that folder's README for exact order/status and why
  `BYPASSRLS` is not a `GRANT`.
- `functions/sync/`: authenticated push, pull, and device-link actions.

- `pgtest/`: the migrations, RLS policies, permission functions and access-token
  hook EXECUTED against a real Postgres (PGlite — Postgres compiled to Wasm, no
  Docker). `harness.ts` recreates the parts of a hosted project that exist
  before migration 1 (the `auth` schema, the four roles, the default privileges)
  and then applies `migrations/` unchanged. Runs with the rest: `pnpm test`.

SQLite remains the mobile source of truth. Notifications and the local sync/conflict
queues are intentionally not mirrored.

## Current rollout status — 2026-08-31

The complete B1-B4 migration/function bundle is present. Founder-reported final
Supabase migration dry-run passed; the transcript is not committed. Remote
migration execution and matching Edge Function deployment remain pending. Do
not deploy a B2/B3 client before the schema-compatible grouped-operation
dispatchers are live. This status supersedes older plan/decision text that says
individual migrations are merely future work.

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

## B4 billing deployment requirements

Deploy `sync` and `payment-webhook` only with migration
`20260831000000_b4_commercial_platform.sql`. Configure Edge secrets
`SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_MODE`,
`PAYMENT_CALLBACK_BASE_URL`, and `PAYMENT_APP_RETURN_URL`. `config.toml`
deliberately disables platform JWT
verification only for `payment-webhook`; SSLCommerz validation and the
server-priced payment order remain mandatory before entitlement activation.
Post-deploy smoke must cover valid payment, duplicate webhook, transaction or
amount mismatch, failed/canceled browser return, 7-day grace, trial expiry,
offline verification ceiling, Pro shop/staff limits, archive/restore, and a
two-device shop switch. No remote migration or function deployment was run by
the B4 implementation work.
