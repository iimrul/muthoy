# apps/mobile

The production Muthoy POS app — React Native (Expo), TypeScript, Expo Router,
NativeWind. SQLite is this app's only source of truth (see the root
`CLAUDE.md`).

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
