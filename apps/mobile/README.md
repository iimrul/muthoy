# apps/mobile

The production Muthoy POS app — React Native (Expo), TypeScript, Expo Router,
NativeWind. SQLite is this app's only source of truth (see the root
`CLAUDE.md`).

## B1-B4 status — 2026-09-05

B1 navigation/roles/settings/notifications, B2 sales/inventory/refunds, and B3
finance/supplier/report/export/printing flows are implemented and committed.
The prototype web app defines expected UI/UX and flow; this app's SQLite,
domain, auth, native, and sync layers define correctness.

B4 commercial/trial/multi-shop flows are complete at commit `8d4c503` and passed
physical Android verification. The app displays Trial—not Ultra—during the
automatic one-time 14-day trial while granting Ultra-equivalent features. Free,
Pro, Ultra, grace, expiry, shop/staff limits, and downgrade suspension resolve
from server-verified entitlement cached in SQLite; no client path can self-unlock.
Local/remote migrations match through `20260905000000_b4_canonical_onboarding.sql`
and remote `sync` is v10 ACTIVE.

## Owner onboarding

Production is: phone → OTP verification → canonical server Owner/shop onboarding
→ auth binding → refreshed full Owner claims → automatic trial hydration.
DEV Skip OTP bypasses only OTP verification and then uses that same canonical
path. The removed separate DEV bootstrap must not return. DEV bypass UI remains
`__DEV__`-only and must be removed/disabled for production.

A successful refreshed Owner token requires `app_user_id`,
`principal_user_id`, `shop_id`, `role=owner`, `permission_version`, and
`billing_account_id`, plus exact requested shop/Owner identity matches. There is
no principal fallback and partial/mismatched claims never mark cloud linking
successful.

## Connectivity and entitlement hydration

Google/Android reachability is not authoritative. Only a confidently absent
transport is offline; unknown reachability still attempts Supabase. Sync,
manual Sync, and billing hydration share that decision. Billing hydration makes
its mandatory first request without an outbox dependency, classifies offline,
config, auth, and server failures separately, and coalesces timer/reconnect/
foreground retries per session/shop generation. Logout or shop switch invalidates
the generation, so stale responses cannot write SQLite or publish state. A valid
cached entitlement remains usable through transient verification failure within
its server expiry and offline-verification bounds.

## Environment

Local Expo configuration belongs in the uncommitted `apps/mobile/.env`; use
`.env.example` only for non-secret placeholders. EAS builds require EAS
Environment Variables because `EXPO_PUBLIC_*` values are transform-time inlined.
Runtime diagnostics may expose build mode, config presence, and Supabase host,
never anon keys, tokens, or identifiers.

Recorded B4 completion checks: physical Android PASS; 146 files/1,537 tests,
typecheck, and lint PASS. Live SSLCommerz acceptance, production OTP hardening,
SQLCipher, final UI/security audits, DEV cleanup, and the full RC matrix remain
release work; see `../../DECISIONS.md`.

## Develop

From the repo root:

```sh
pnpm install
cd apps/mobile
npx expo start
```

## Layout

See `docs/playbook/02-system-architecture.md` (Volume 2) for the full
8-layer architecture. One-line rule per folder: `app/` is layout/navigation
only, `components/` is presentation only, `db/` is the only code touching
SQLite, `state/` is Zustand (not the source of truth), `domain/` is pure
business logic, `sync/` is the only code talking to Supabase, `native/` is
the only code touching native modules.
