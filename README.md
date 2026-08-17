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
