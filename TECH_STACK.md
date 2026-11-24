# TECH_STACK.md — Muthoy POS

## Current status — 2026-11-24

Changes since 2026-11-16 (each logged in DECISIONS.md):

- **Live strip scan:** frame-processor OCR on `react-native-vision-camera` 5.2.4,
  `react-native-vision-camera-worklets` 5.2.4, `react-native-nitro-modules`
  0.37.2, `react-native-nitro-image` 0.15.2 and
  `react-native-vision-camera-ocr-plus` 2.1.2 (founder-approved). Expo Camera's
  photo loop remains the fallback. VisionCamera 5 has no barcode output on
  Android, so the Sale scanner pairs frame OCR with a Barcode button.
  `expo-audio` ~57.0.5 plays the add beep.
- **Android 8.0 (API 26) minimum**, set by `plugins/withAndroidMinSdk`; the OCR
  package needs it.
- **Sentry:** `@sentry/react-native` 7.11.0 is wired behind H-8's allowlist
  (`crashReporting/`). Messages, breadcrumbs, user and request data are always
  dropped. Source maps are not uploaded yet. PostHog (below) is not installed.
- **Edge Function region:** DEV's database is in Tokyo, so the app sends an
  `x-region` header for DEV function calls (`sync/functionRegion.ts`). PROD
  should be created in Mumbai (ap-south-1) and added to that map.
- **DEV backend:** migrations through 43 (41 admin plan grants, 42 the `grant`
  billing cycle, 43 the session-bound token shop plus one owner PIN for all of
  an owner's shops); `sync` is v35. PROD is untouched.

## Integration status — 2026-11-15

The approved external source work is integrated file by file into this repository:
Android remediation, money/stock/transaction tests, role-scoped sync repair,
recovery source, the same-app iOS modules, and the separate Admin fixes/tests.
See [the integration plan](docs/plans/external-integration-2026-11-15/PLAN.md)
and [the verification report](docs/plans/external-integration-2026-11-15/INTEGRATION_REPORT.md).

This is source integration. Existing database schemas/data, hosted contracts,
installed applications and device state have not been changed. iOS native/XCTest,
physical hardware, hosted activation and current-source device acceptance remain
unverified here. Historical test receipts below retain their original scope.
Production remains NO GO. B6-01 and B6-02 remain deferred deliverables.

## Historical implementation receipt — 2026-11-09

Android remediation is in progress from source `a23ca61262497474bf85ede78948ca831657c8db`.
See [the dated implementation record](docs/plans/android-remediation-2026-11-09.md).
Historical completion statements below do not establish current hosted parity,
current-source Android acceptance or production readiness. On11November the Founder authorized iOS implementation in this SAME React Native app; physical iOS testing remains deferred;
B6-01 and B6-02 remain mandatory deferred deliverables.

### The finalized, locked technology stack. Read alongside CLAUDE.md,
### PROJECT_CONTEXT.md, and DEVELOPMENT_RULES.md. Do not deviate without updating
### this file first and logging why in DECISIONS.md.

---

## Client — React Native (Expo)
- React Native 0.86 (via Expo SDK 57)
- Expo SDK 57
- TypeScript
- Expo Router
- NativeWind
- React Hook Form
- Zod (validation)

> Version note: originally locked to Expo SDK 52 (React Native 0.76+); bumped
> to SDK 57 on Day 1, before any app code existed — see DECISIONS.md.

## Local Database (Offline-First) — SQLite
- SQLite (WAL Mode)
- SQLite FTS5 (Day One — instant search across 20k+ medicines)
- SQLCipher (encryption at rest) — **ENABLED and signed off 2026-09-17 (H-3).**
  Turned on by `app.json`'s `expo-sqlite` plugin prop `android.useSQLCipher:
  true`, which is what makes expo-sqlite compile `vendor/sqlcipher`. The key is
  32 bytes of `SecureRandom`, wrapped AES-256-GCM by a non-exportable
  AndroidKeyStore key (`modules/muthoy-db-key`), and applied as SQLCipher's raw
  `PRAGMA key = "x'<64 hex>'"` — no KDF, no salt. `PRAGMA key` is always the
  FIRST statement on a connection; `journal_mode` and `foreign_keys` follow it.
  Scope is SQLite only. MMKV, exports/reports and attachments are NOT covered
  by H-3 and remain separate work.
- Drizzle ORM

> Money representation: every money value is an INTEGER number of paisa
> (1 taka = 100 paisa), never a float. Enforced in TypeScript by the branded
> `Paisa` type in `packages/types`. The Supabase mirror must match — see the
> Day 12 precondition in DECISIONS.md.

## State Management & Caching
- Zustand (in-app UI/session/cart state — not the source of truth)
- TanStack Query (sync layer only — never used to fetch what a screen displays)
- MMKV (session plus device-local locale/notification/printer preferences;
  never a PIN or PIN hash). PIN hashes remain SQLite-only; Android Keystore
  holds the non-exportable key for local lookup tags.

## Native Features

Current platform implementation (11 November): this SAME mobile app now includes
Apple DB-key, PIN-crypto and BLE Expo modules plus iOS SQLCipher configuration.
iOS source/JS boundary checks are separate from native compilation: no Xcode is
available here, so native build/runtime is BLOCKED and physical testing deferred.
Apple keys use nonsynchronizing AfterFirstUnlockThisDeviceOnly Keychain storage;
this is device-only software-key custody, not a Secure Enclave/non-exportable-key
claim. PIN bcrypt cost10 vendors the fixed upstream BCryptSwift commit
7cebf3c0d9b507912f572a0ad9b4d6af764d8b1a with Apache license/provenance; HMAC lookup
retains the existing domain and base64url contract. BLE uses CoreBluetooth with
existing shared ESC/POS formatting. Android native implementations are unchanged.

Recovery core (approved local scope): additive SQLite journal within the existing
outbox transaction; versioned tenant business snapshots; installed expo-crypto
AES256GCM; owner-held random256bit factor; independently verified immutable DEV
Storage copies and isolated SQLite restore. Founder-approved local Owner custody stores a confirmed factor only in existing
verified SQLCipher; durable jobs retain identical ciphertext across retries. The
Owner setup/status panel and foreground lifecycle are locally integrated. There is
NO default network runtime: hosted backup activation remains blocked pending its
own approval. No Staff coverage protocol is enabled. HELD Storage SQL is not hosted. No-loss remains FAIL while an independent copy is unavailable.

The following Android implementation details remain the verified native baseline:

- Local Android Expo module backed by `at.favre.lib:bcrypt` 0.10.2 for
  standard bcrypt at cost 10; Android Keystore HMAC-SHA256 for local-only PIN
  lookup tags. Requires a development/EAS build, not Expo Go.
- ML Kit (on-device) — barcode scanning AND text recognition (OCR); one engine,
  two APIs, not two separate libraries
- Expo Camera
- expo-notifications
- expo-background-task
- expo-task-manager
- expo-local-authentication
- expo-location
- Local Android Expo BLE printer module: BLE scan/connect plus ESC/POS byte
  transport. Pairing metadata is device-local in MMKV; Beta printing is
  Android-verified; the Apple source transport above also requires a native development build.

## Backend — Supabase
- Supabase PostgreSQL
- Authentication (phone OTP)
- Row Level Security (RLS)
- Storage
- Edge Functions
- Limited Realtime (used sparingly — battery/data cost on low-end phones)
- Custom Sync Queue (Outbox Pattern) — SQLite → Sync Queue → Supabase

### Historical commercial, onboarding, and deployment record

- Server-owned Free/Pro/Ultra entitlement and Owner-level billing-account model.
  SQLite stores a verified cache for instant/offline UX; it never grants access.
- Canonical Owner onboarding is an Edge orchestration call into the
  `SECURITY DEFINER` `b4_onboard_owner(...)` PostgreSQL function. Every build
  reaches it the same way — after OTP verification — then auth binding,
  refreshed claims, and trial. The DEV Skip-OTP bypass and its anonymous
  sign-in were removed in H-2 (2026-09-06); there is no second path.
- Multi-shop rename/archive/restore uses the narrow `SECURITY DEFINER`
  `b4_mutate_owned_shop(...)` function rather than broad table-write grants.
- PostgreSQL migration parity is verified through
  `20260905000000_b4_canonical_onboarding.sql`; deployed `sync` is v10 ACTIVE.
- Edge Functions pin `npm:@supabase/supabase-js@2.112.3` (the mobile lockfile's
  version) and resolve API keys once per cold start: modern publishable/secret
  keys by default, the legacy anon/service_role pair only as an explicit
  rollback (`MUTHOY_SUPABASE_KEY_MODE`). `sync` keeps gateway JWT
  verification. H-9; see `backend/supabase/deploy/README.md`.
- SSLCommerz is the first planned provider. The provider abstraction and webhook
  source exist, but real credentials/live validation are not configured; payment
  fails closed and is not production-ready.

## Admin Panel — Next.js

Integrated dependency manifests pin Next.js/eslint-config-next 15.5.29,
Recharts 3.10.1 and Leaflet 1.9.4. The Day 14 note below is retained historical
context; it is not a description of the current Admin implementation.

- Next.js 15
- Tailwind CSS
- shadcn/ui
- Recharts (standard charts: revenue, MRR, plan distribution)
- Leaflet (shop map, using captured lat/long — a dedicated map library instead
  of forcing one charting library to do both jobs)

> **Historical state (Day 14, P0):** `apps/admin` runs on Next.js 15 + Tailwind
> only. shadcn/ui, Recharts and Leaflet are **not installed** — they arrive with
> the P1 Full Admin build-out (Volume 5), since the P0 panel has no charts and
> no map by design.

## DevOps & Deployment
- GitHub
- GitHub Actions
- Expo EAS
- Vercel
- pnpm workspaces + Turborepo (this monorepo)

Expo local development reads non-committed values from `apps/mobile/.env`.
EAS builds require the same public configuration as EAS Environment Variables;
`EXPO_PUBLIC_*` values are transform-time inlined, not runtime secret storage.
Only non-secret placeholders belong in `.env.example`, and DEV diagnostics may
report presence/host only—never keys or tokens.

## Monitoring & Analytics
- Sentry (crash reporting)
- PostHog (product analytics)

---

## Notes on native module constraints
ML Kit's camera integration needs an **Expo development build**, not Expo Go —
confirm this on Day 1's EAS dev build, don't discover it later when scanning
is actually built (P1, immediately post-beta — see Volume 0's scope lock).
The local PIN crypto module has the same build requirement.

## What is intentionally NOT in the stack (yet)
- A general-purpose public API — deferred until real external demand exists
  (see the Maintenance volume's Future SaaS Direction).
- Upstash Redis or any second data store — deferred until a concrete need
  (OTP rate-limiting, a job queue) appears at real scale; Supabase/Postgres
  covers everything through beta and well beyond.
