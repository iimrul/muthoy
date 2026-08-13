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
- MMKV (PIN hash + session, fast synchronous storage)

## Native Features
- ML Kit (on-device) — barcode scanning AND text recognition (OCR); one engine,
  two APIs, not two separate libraries
- Expo Camera
- expo-notifications
- expo-background-task
- expo-task-manager
- expo-local-authentication
- expo-location

## Backend — Supabase
- Supabase PostgreSQL
- Authentication (phone OTP)
- Row Level Security (RLS)
- Storage
- Edge Functions
- Limited Realtime (used sparingly — battery/data cost on low-end phones)
- Custom Sync Queue (Outbox Pattern) — SQLite → Sync Queue → Supabase

## Admin Panel — Next.js
- Next.js 15
- Tailwind CSS
- shadcn/ui
- Recharts (standard charts: revenue, MRR, plan distribution)
- Leaflet (shop map, using captured lat/long — a dedicated map library instead
  of forcing one charting library to do both jobs)

## DevOps & Deployment
- GitHub
- GitHub Actions
- Expo EAS
- Vercel
- pnpm workspaces + Turborepo (this monorepo)

## Monitoring & Analytics
- Sentry (crash reporting)
- PostHog (product analytics)

---

## Notes on native module constraints
ML Kit's camera integration needs an **Expo development build**, not Expo Go —
confirm this on Day 1's EAS dev build, don't discover it later when scanning
is actually built (P1, immediately post-beta — see Volume 0's scope lock).

## What is intentionally NOT in the stack (yet)
- A general-purpose public API — deferred until real external demand exists
  (see the Maintenance volume's Future SaaS Direction).
- Upstash Redis or any second data store — deferred until a concrete need
  (OTP rate-limiting, a job queue) appears at real scale; Supabase/Postgres
  covers everything through beta and well beyond.
