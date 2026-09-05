# TECH_STACK.md — Muthoy POS
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
- SQLCipher (encryption) — **still required; not yet enabled.** Deferred on
  Day 2 because it is a native-build + key-management task. MUST be in place
  before any real pharmacy/pilot data is stored — see DECISIONS.md.
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
  Android-only and requires a development/EAS build.

## Backend — Supabase
- Supabase PostgreSQL
- Authentication (phone OTP)
- Row Level Security (RLS)
- Storage
- Edge Functions
- Limited Realtime (used sparingly — battery/data cost on low-end phones)
- Custom Sync Queue (Outbox Pattern) — SQLite → Sync Queue → Supabase

### Commercial, onboarding, and deployed state

- Server-owned Free/Pro/Ultra entitlement and Owner-level billing-account model.
  SQLite stores a verified cache for instant/offline UX; it never grants access.
- Canonical Owner onboarding is an Edge orchestration call into the
  `SECURITY DEFINER` `b4_onboard_owner(...)` PostgreSQL function. Production
  reaches it after OTP verification; DEV Skip OTP bypasses only that proof and
  then uses the same onboarding, auth-binding, refreshed-claim, and trial path.
- Multi-shop rename/archive/restore uses the narrow `SECURITY DEFINER`
  `b4_mutate_owned_shop(...)` function rather than broad table-write grants.
- PostgreSQL migration parity is verified through
  `20260905000000_b4_canonical_onboarding.sql`; deployed `sync` is v10 ACTIVE.
- SSLCommerz is the first planned provider. The provider abstraction and webhook
  source exist, but real credentials/live validation are not configured; payment
  fails closed and is not production-ready.

## Admin Panel — Next.js
- Next.js 15
- Tailwind CSS
- shadcn/ui
- Recharts (standard charts: revenue, MRR, plan distribution)
- Leaflet (shop map, using captured lat/long — a dedicated map library instead
  of forcing one charting library to do both jobs)

> **Current state (Day 14, P0):** `apps/admin` runs on Next.js 15 + Tailwind
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
