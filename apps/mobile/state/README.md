# state/

Zustand stores — in-memory session/cart/UI state, NOT the source of truth
(SQLite is).

- `sessionStore.ts` (Days 4-5/11) — the logged-in session (`shopId`,
  `userId`, `role`), Zustand + MMKV-persisted so it survives an app kill
  (Volume 0 Day 5 checklist). Holds ONLY the session — never a PIN or its
  hash; SQLite's `users.pin_hash` is the sole source of truth for that, and
  verifying one is a one-time check at login, not something re-checked here.
  Its `clearActiveUser` action is deliberately NOT called `logout`: it ends
  the local user session only, never the cloud session or the device link.
- `switchUser.ts` (Days 5/11) — the device-handover action for a shared
  pharmacy phone. Clears the active local session and the in-progress cart,
  and nothing else: the shop, its `cloud_linked_at` row, the Supabase JWT
  ('muthoy-supabase-auth') and the shop-keyed pull cursor all survive, so the
  next person reaches PIN Login rather than OTP or Registration. A
  destructive "Sign Out Device" is a separate action and is not built.
- `usePermission.ts` — the route-level guard. Resolves the role default THEN
  the session's per-user overrides, through `domain/permissions.ts`'s
  `resolvePermission` — the same order `db/auth.ts`'s `requirePermission` and
  the server's `auth_has_permission` use, so UI, local writes and RLS cannot
  disagree about what a staff member may do. UI only: it decides what renders,
  never what commits.
- `sessionStore.ts`'s `Session.permissions` (0007) — a SNAPSHOT of the owner's
  per-staff overrides, taken at login and refreshed by `app/index.tsx` on every
  launch and session change (guarded on an actual difference, or the refresh
  would re-trigger the effect that produced it). Optional, so a session
  persisted before migration 0007 deserialises and falls back to the role
  default. Nothing security-bearing reads it: every guarded write re-reads
  overrides from SQLite, and the server re-derives them from its own tables.
- `cartStore.ts` — defines the Cart/CartLine shape only (Sales skeleton); no
  zustand import yet, functions throw `TODO: ...`. Real Zustand wiring is
  Day 3; the store's actual logic is Day 6.
- `usePlan.ts` — Subscription (P1, post-beta). Not a Zustand store; reads
  the cached `shops.plan` fast-path value, `TODO: ...` stub for now.
