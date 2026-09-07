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

There is exactly one path, in every build: phone → OTP verification → canonical
server Owner/shop onboarding → auth binding → refreshed full Owner claims →
automatic trial hydration. The DEV Skip-OTP entry, the anonymous sign-in it
used, the owner-link repair affordance, and the earlier separate DEV bootstrap
are all removed (H-2, 2026-09-06) and must not return; `dev/README.md` records
why, and `tests/dev-production-safety*` fails the build if any of them comes
back.

Until H-5 configures a real OTP provider, a **temporary DEV registration
harness** (`dev/devRegistrationHarness.tsx`) keeps fresh local registration
testable. It skips only the SMS code and then joins the canonical path above at
`createShopAndOwner`; it is not a second path. `metro.config.js` resolves it to
an inert stub in every non-dev bundle, so no release build contains it, and the
DEV Owner it creates has a **null** phone — nothing claims a verification that
did not happen. **H-5 removes the harness before RC**; `dev/README.md` carries
the removal checklist.

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

A release build's only boot diagnostic is the missing-configuration warning,
which names the absent `EXPO_PUBLIC_*` variables and nothing else — no host, no
key, no identifier — and `app/_layout.tsx` shows the same list on screen and
fails closed. The healthy-config line names the Supabase host and is therefore
`__DEV__`-only; the B4 `[muthoy-runtime]` build-marker line is gone. Session
diagnostics are inert in release: no user id, shop id, role, or permission count
is assembled at all.

Recorded B4 completion checks: physical Android PASS; 146 files/1,537 tests,
typecheck, and lint PASS. Live SSLCommerz acceptance, production OTP hardening,
SQLCipher, final UI/security audits, and the full RC matrix remain release work;
see `../../DECISIONS.md`.

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
