import { stopSyncEngine } from '../sync';
import { useCartStore } from './cartStore';
import { clearActiveUserDurably, useSessionStore } from './sessionStore';

// state/switchUser.ts — the device-handover action for Volume 0 Days 5/11.
// One pharmacy phone is shared by the owner and their staff, and Day 11's
// testing checklist ("Log in as each role, confirm each sees only what it
// should") is not performable without it: until now nothing in the UI could
// end a session, so whoever logged in first owned the device until reinstall.
//
// This is deliberately the NARROWEST possible clear. What it ends:
//   - the active local user session (MMKV 'muthoy-session'), so the next
//     screen is normal PIN Login and the next actor logs in as themselves;
//   - the in-progress cart, so a half-built sale can never be completed and
//     attributed under the INCOMING user's id (db/sales.ts stamps staff_id
//     from whoever is logged in at checkout, not from who added the lines).
//
// What it must NOT touch, and does not:
//   - SQLite. No user, shop, role or PIN row is read or written. Nothing is
//     re-created: the shop keeps the id it registered with (CLAUDE.md rule 7),
//     and every sale/cash row keeps the staff_id it was written with.
//   - The linked-device cloud identity. `shops.cloud_linked_at` in SQLite and
//     the Supabase JWT in MMKV 'muthoy-supabase-auth' both survive, so a
//     handover never re-triggers OTP — that is sync/otp.ts's flow, for a NEW
//     owner claiming the device — and never asks a staff member for a phone
//     number they were never given (Volume 4 AUTHENTICATION: "Staff: created
//     by the owner with a name + PIN, never needs a phone number").
//   - The sync identity. The pull cursor in MMKV 'muthoy-sync-cursor' is keyed
//     by SHOP, not user, and the sync_queue outbox lives in SQLite; both are
//     left as-is. This function stops the sync engine itself (below) rather
//     than leaving that to app/_layout.tsx noticing the session went null on
//     its next render — that render-order coupling is exactly the kind of gap
//     that lets a stray scheduled/foreground tick fire between screens. Sync
//     restarts on the SAME shopId at the next login via _layout.tsx's effect
//     (only a mounted screen has the session to know a login happened), so a
//     handover costs no re-hydration and loses no queued row.
//   - PINs, raw or hashed (CLAUDE.md rule 8) — none is read here at all. The
//     incoming user re-authenticates against SQLite's users.pin_hash through
//     db/auth.ts's verifyPin, exactly as on a cold start.
//
// A destructive "Sign Out Device" — dropping the Supabase session and
// unlinking the device — is a DIFFERENT action with different semantics, and
// is intentionally not built here.
export function switchUser(): void {
  // Cart first: the outgoing user's lines must be gone before any new session
  // can exist, so no line can ever be saved under the wrong staff_id.
  useCartStore.getState().clear();
  useSessionStore.getState().clearActiveUser();
  // Stop sync as part of the handover contract itself, not as a side effect
  // some other screen happens to notice. Idempotent — app/_layout.tsx's own
  // cleanup calls this again when it reacts to the session change, which is a
  // harmless no-op by then.
  stopSyncEngine();
}

/**
 * switchUser() for the A2.3 device relink, made failure-safe.
 *
 * A relink that fails half-way has a safe place to stay (the screen the person
 * is on, still signed in) and an unsafe place to go (Device Login with the old
 * session still live in memory, or still on disk for the next launch). So
 * nothing changes until the signed-out session is durably on disk
 * (clearActiveUserDurably): a failed write throws with memory, disk, cart and
 * sync exactly as they were. Only then do the cart and sync go.
 *
 * The session goes before the cart here, the reverse of switchUser(): the cart
 * is memory-only and cannot fail on storage, and emptying it first would throw
 * away a half-built sale on a relink whose write then failed. The cart is
 * still empty before any new login is possible — nothing between these lines
 * can create one.
 */
export function switchUserDurably(): void {
  clearActiveUserDurably();
  useCartStore.getState().clear();
  stopSyncEngine();
}
