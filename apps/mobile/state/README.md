# state/

Zustand stores — in-memory session/cart/UI state, NOT the source of truth
(SQLite is).

- `cartStore.ts` — defines the Cart/CartLine shape only (Sales skeleton); no
  zustand import yet, functions throw `TODO: ...`. Real Zustand wiring is
  Day 3; the store's actual logic is Day 6.
- `usePlan.ts` — Subscription (P1, post-beta). Not a Zustand store; reads
  the cached `shops.plan` fast-path value, `TODO: ...` stub for now.
