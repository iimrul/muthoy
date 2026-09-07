# backend/supabase/

Supabase cloud mirror and Edge Functions.

- `migrations/`: timestamped PostgreSQL mirror, RLS, service-role-only sync
  RPCs, B1-B4 grouped-operation/commercial/onboarding functions, report/tax
  schema, and narrow
  direct-read grants. See that folder's README for exact order/status and why
  `BYPASSRLS` is not a `GRANT`.
- `functions/sync/`: authenticated sync, canonical onboarding/device linking,
  billing status/initiation, and multi-shop orchestration.

- `pgtest/`: the migrations, RLS policies, permission functions and access-token
  hook EXECUTED against a real Postgres (PGlite — Postgres compiled to Wasm, no
  Docker). `harness.ts` recreates the parts of a hosted project that exist
  before migration 1 (the `auth` schema, the four roles, the default privileges)
  and then applies `migrations/` unchanged. Runs with the rest: `pnpm test`.

SQLite remains the mobile source of truth. Notifications and the local sync/conflict
queues are intentionally not mirrored.

## Current rollout status — 2026-09-05

The B1-B4 schema is remotely applied and verified. Local and remote migration
ledgers match through `20260905000000_b4_canonical_onboarding.sql`; B4 database
parity, RLS, the ledger invariant, and valid shop/Owner preservation passed.
`sync` is v10 ACTIVE. B4 commercial/trial/Multi-Shop passed physical Android
verification. This supersedes older text that calls the B1-B4 remote rollout
pending.

## Auth hook and canonical Owner onboarding

`custom_access_token_hook` is registered and enabled at **Auth → Hooks →
Customize Access Token → `public.custom_access_token_hook`**. This remains a
manual hosted-project setting; migrations cannot enable it.

No migration can do this. Until it is registered, no token carries
`app_user_id`, `role` or `permission_version`; `assertCallerCurrent` returns the
distinct `hook_not_configured` failure, and the client halts without consuming
outbox attempts. A stale version instead returns `permissions_changed`, which
the client refreshes and retries exactly once.
Direct PostgREST access fails CLOSED in the same state (`auth_has_permission`
resolves a null actor to false), which is the safe direction but equally silent.

Owner registration uses one path, in every build: verified OTP session →
`sync/link-device` → `b4_onboard_owner(...)` → auth binding → refreshed claims →
automatic trial hydration. The DEV Skip-OTP bypass, the anonymous sign-in it
used, and the owner-link repair were removed in H-2 (2026-09-06), as was the
older separate `devRegistration.ts` bootstrap. None may return. Anonymous
sign-ins must stay disabled in Authentication → Providers on every project: the
client can no longer request one, and rejecting anonymous callers inside
`verifyCallerJwt()` is H-5's hardening.

`20260905000000_b4_canonical_onboarding.sql` owns two narrow `SECURITY DEFINER`
boundaries: `b4_onboard_owner(...)` atomically/idempotently creates the shop,
three system roles, Owner, and settings; `b4_mutate_owned_shop(...)` performs
Owner-account-scoped rename/archive/restore. They avoid widening direct table
grants. The hosted ACL model is represented in the PG harness, and grant/ACL
tests guard direct PostgREST writes to protected tables.

Fresh Owner tokens must contain `app_user_id`, `principal_user_id`, `shop_id`,
Owner role, `permission_version`, and `billing_account_id`, with exact requested
shop/user matches. No principal fallback or partial cloud-link success exists.

## B4 commercial and payment state

Free is ৳0; Pro is ৳399/month or ৳3,830/year; Ultra is ৳499/month or
৳4,790/year. Pro allows 3 active shops and 4 active non-owner staff per shop;
Manager counts as staff and Owner does not. Ultra and the automatic one-time
14-day trial are unlimited. One Owner billing account covers all owned shops.
Paid grace is 7 days; trial has none. Downgrade deletes nothing and
deterministically suspends excess shops/staff.

The payment provider abstraction and `payment-webhook` source exist, with
SSLCommerz planned first. Real SSLCommerz credentials/account and live provider
validation are not configured. Missing configuration fails closed and no client
payment state grants entitlement; do not describe live payments as production-ready.
Production setup will require Edge secrets
`SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_MODE`,
`PAYMENT_CALLBACK_BASE_URL`, and `PAYMENT_APP_RETURN_URL`. `config.toml`
deliberately disables platform JWT
verification only for `payment-webhook`; SSLCommerz validation and the
server-priced payment order remain mandatory before entitlement activation.
Pre-RC validation must cover valid payment, duplicate webhook, transaction or
amount mismatch, failed/canceled browser return, 7-day grace, trial expiry,
offline verification ceiling, Pro shop/staff limits, archive/restore, and a
two-device shop switch.
