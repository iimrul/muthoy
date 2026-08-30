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

## Current production baseline — B1 to B3

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

Standing invariants: screens read SQLite only; money is integer paisa; business
dates are Asia/Dhaka; stock changes only through append-only inventory movements;
expected cash uses the fixed seven-term formula; grouped money/stock operations
apply atomically and idempotently; protected actor-initiated business writes are
shop-scoped and actor-checked. Deliberate background/system writes remain
shop-scoped without inventing an actor.

## Delivery status — 2026-08-30

- B1-B3 product code is committed.
- Local SQLite migrations `0000` through `0025` are packaged in order and have
  automated fresh/upgrade coverage.
- Full automated suite: **PASS** — 124 files, 1,268 tests (`pnpm test`). Tests
  execute migrations only in ephemeral SQLite/PGlite databases.
- Founder-reported B3 physical-device acceptance: **PASS**.
- Founder-reported final Supabase migration dry-run: **PASS**. The exact command
  transcript is not committed in the repository.
- B1-B3 remote Supabase migration execution and Edge Function deployment remain
  **PENDING**. No migration ran against a persistent app database or linked
  Supabase project; no deployment, push, or commit is part of this recovery.

See [`backend/supabase/migrations/README.md`](backend/supabase/migrations/README.md)
for exact migration order and rollout gates, and [`DECISIONS.md`](DECISIONS.md)
for the durable B1-B3 contracts and known risks.

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
