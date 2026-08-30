# apps/mobile

The production Muthoy POS app — React Native (Expo), TypeScript, Expo Router,
NativeWind. SQLite is this app's only source of truth (see the root
`CLAUDE.md`).

## B1-B3 status — 2026-08-30

B1 navigation/roles/settings/notifications, B2 sales/inventory/refunds, and B3
finance/supplier/report/export/printing flows are implemented and committed.
The prototype web app defines expected UI/UX and flow; this app's SQLite,
domain, auth, native, and sync layers define correctness. Founder-reported B3
physical-device acceptance passed. Remote Supabase migrations and function
deployment remain pending; see `../../backend/supabase/migrations/README.md`.

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
