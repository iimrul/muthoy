# state/

Zustand stores — in-memory session/cart/UI state, NOT the source of truth
(SQLite is).

- `sessionStore.ts` (Days 4-5/11) — the logged-in session (`shopId`,
  `userId`, `role`), Zustand + MMKV-persisted so it survives an app kill
  (Volume 0 Day 5 checklist). Holds ONLY the session — never a PIN or its
  hash; SQLite's `users.pin_hash` is the sole source of truth for that, and
  verifying one is a one-time check at login, not something re-checked here.
- `cartStore.ts` — defines the Cart/CartLine shape only (Sales skeleton); no
  zustand import yet, functions throw `TODO: ...`. Real Zustand wiring is
  Day 3; the store's actual logic is Day 6.
- `usePlan.ts` — Subscription (P1, post-beta). Not a Zustand store; reads
  the cached `shops.plan` fast-path value, `TODO: ...` stub for now.
