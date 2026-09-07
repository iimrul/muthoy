# Muthoy POS

A Bangla-first, offline-first point-of-sale for independent pharmacies in
Bangladesh. SQLite is the source of truth on-device; Supabase provides sync,
backup, and the admin panel. See `PROJECT_CONTEXT.md` for the full product
vision.

## Read first

Every session starts with these four files, in order:
- [`CLAUDE.md`](CLAUDE.md) — non-negotiable AI operating rules
- [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) — vision, users, goals, non-goals
- [`TECH_STACK.md`](TECH_STACK.md) — the locked technology stack
- [`DEVELOPMENT_RULES.md`](DEVELOPMENT_RULES.md) — coding/naming/folder/git standards

The full day-by-day build plan lives in [`docs/playbook/`](docs/playbook/)
(Volumes 0-10). Real decisions made along the way are logged in
[`DECISIONS.md`](DECISIONS.md).

## Current production baseline — B1 to B4

`apps/prototype-web` is the UI/UX and product-flow source of truth. It is not
the implementation authority. Production correctness comes from the mobile
SQLite/domain/auth/native layers and the Supabase sync/RLS migrations. Web
state, localStorage, demo data, and web architecture are never copied into the
production app.

- **B1:** role-correct Owner/Manager/Staff navigation; route and data-action
  permission parity; global Bangla/English; Owner settings/profile; device-local
  shop-keyed notification preferences and per-user receipts. Production has the prototype's 12
  permissions plus the narrower `inventory_add` permission. `inventory_add`
  defaults OFF for every non-owner and permits only the Add Medicine + opening
  supplier-purchase graph when explicitly granted; it does not grant general
  inventory editing or purchase management.
- **B2:** SQLite-backed sale search/cart/checkout; transaction-time FEFO;
  promotions and sale discounts in integer paisa; cash/credit/split tender;
  holds; prescription metadata; barcode/OCR; inventory edit/archive/adjustment;
  expiry management; full-sale refunds; grouped sync and replay idempotency.
  Expired stock is unsellable against the Asia/Dhaka business date, null expiry
  sorts FEFO-last, and any changed stock/price allocation raises a stale quote
  that the cashier must review and confirm again.
- **B3:** opening cash, withdrawals, reconciliation, expenses, End of Day,
  customer credit and collections, suppliers, purchase invoices/pending lines,
  supplier payments, purchase returns and supplier credit, reports/monthly P&L,
  MRP-inclusive tax snapshots, CSV/XLSX export, and Android BLE ESC/POS printing.
- **B4:** server-authoritative Free/Pro/Ultra entitlements, automatic one-time
  14-day Ultra-equivalent trial, verified offline entitlement cache, Plans and
  payment states, premium gates, and Owner multi-shop create/rename/switch/
  archive/restore. One Owner billing account covers all owned shops; downgrade
  suspends deterministic excess shops/staff without deleting data.

Standing invariants: screens read SQLite only; money is integer paisa; business
dates are Asia/Dhaka; stock changes only through append-only inventory movements;
expected cash uses the fixed seven-term formula; grouped money/stock operations
apply atomically and idempotently; protected actor-initiated business writes are
shop-scoped and actor-checked. Deliberate background/system writes remain
shop-scoped without inventing an actor.

## Delivery status — 2026-09-05

- B1-B4 product code is committed at `8d4c503` (`feat: complete B4 commercial
  flows and canonical onboarding`). B4 physical Android verification passed,
  including Trial discovery and Multi-Shop.
- Local SQLite migrations `0000` through `0026` are packaged in order and have
  automated fresh/upgrade coverage.
- Local and remote PostgreSQL migration ledgers match through
  `20260905000000_b4_canonical_onboarding.sql`; migration parity and B4 DB
  behavior are verified. The `sync` Edge Function is v10 ACTIVE.
- Recorded B4 completion suite: **PASS** — 146 files, 1,537 tests; typecheck and
  lint also passed. Migration tests cover canonical onboarding, hosted ACL/grant
  behavior, RLS, commercial/trial limits, and multi-shop isolation.
- Payment UI/domain/provider abstraction exists and fails closed while
  SSLCommerz is unconfigured. Live payment acceptance is **not** production-ready.

See [`backend/supabase/migrations/README.md`](backend/supabase/migrations/README.md)
for exact migration order and current parity, and [`DECISIONS.md`](DECISIONS.md)
for the durable B1-B4 contracts and remaining release gates.

## Pre-RC gates

Still incomplete: production OTP provider hardening, real SSLCommerz credentials
and validation, SQLCipher, `conflict_queue` UI/wiring, PIN timing/security
hardening, broader printer hardware coverage, the export service-level Owner
guard if still pending, admin completion, fixed shop location/map support,
production observability, final 39/39 UI parity and security/RLS audits, and the
RC fresh-install/upgrade/offline/multi-device matrix.

DEV bypass/debug removal is DONE in code (H-2, 2026-09-06) — the Skip-OTP entry,
its anonymous sign-in, the owner-link repair, and the B4 build-marker log are
gone, with static and behavioural guards against their return. A release-bundle
grep on a native rebuild is still owed.

Fresh local registration stays testable through a temporary DEV harness that
skips only the SMS code and then runs the canonical onboarding path. It is kept
out of every non-dev bundle by `apps/mobile/metro.config.js` rather than by a
runtime flag, and **H-5 deletes it** when a real OTP provider lands; the removal
checklist is in `apps/mobile/dev/README.md`.

## Prerequisites

- Node 22 (see `.nvmrc`)
- `corepack enable` (this repo pins its pnpm version via the root
  `package.json`'s `packageManager` field — no separate pnpm install needed)

## Setup

```sh
pnpm install
```

## Monorepo layout

```
apps/
  mobile/           React Native (Expo) — the production app
  admin/            Next.js admin panel — Day 14 P0: dashboard + pharmacy list
  prototype-web/    Figma Make export — REFERENCE ONLY, never built/imported
backend/
  supabase/         Postgres schema, RLS policies, Edge Functions
packages/
  ui/               Shared components used by both apps
  types/            TypeScript types generated from the schema
  utils/            formatMoney/formatNumber, date helpers
  validation/       Every Zod schema — single source of truth
  constants/        Brand tokens (colors/fonts/spacing), plan limits
  config/           Shared ESLint/TypeScript/Tailwind base configs
docs/playbook/       Volumes 0-10 of the engineering playbook
```

`apps/prototype-web` is reference-only for UI/UX layout and flow — see its own
`README.md`. It is never imported by `apps/mobile` or `apps/admin`, isn't a
workspace package, and can be deleted without breaking anything.

## Common commands

```sh
pnpm turbo run lint
pnpm turbo run typecheck
```
