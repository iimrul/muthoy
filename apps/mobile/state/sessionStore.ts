import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { createMMKV } from 'react-native-mmkv';
import type { PermissionOverrides, Role } from '../domain/permissions';

// state/sessionStore.ts — the logged-in session (shop_id + role, per Volume 4
// AUTHENTICATION: "Both converge on a session carrying shop_id + role").
// In-memory UI state, NOT the source of truth (SQLite is) — this only
// remembers WHO is logged in, never re-derives auth decisions itself.
//
// Persisted via MMKV so a killed-and-reopened app keeps the session (Volume 0
// Day 5 checklist: "Kill and reopen the app — session persists correctly
// (MMKV)"). MMKV holds ONLY this — shop_id/user_id/role — never a PIN or its
// hash. The hash lives solely in SQLite's users.pin_hash; verifying a PIN is
// a one-time check at login, not something this store re-checks later.

// react-native-mmkv v4 is Nitro-Modules-based: `MMKV` is a type, instances
// come from createMMKV(). (`remove`, not `delete`, is the key-removal method.)
const sessionStorage = createMMKV({ id: 'muthoy-session' });

const mmkvStorage: StateStorage = {
  setItem: (name, value) => sessionStorage.set(name, value),
  getItem: (name) => sessionStorage.getString(name) ?? null,
  removeItem: (name) => sessionStorage.remove(name),
};

export interface Session {
  shopId: string;
  userId: string;
  role: Role;
  /**
   * The owner's per-staff permission overrides for THIS user, snapshotted at
   * login so route guards can decide what to render without a SQLite read per
   * screen.
   *
   * UI convenience only, and deliberately optional: a session persisted before
   * per-staff permissions existed deserialises without it and falls back to the
   * role default. Nothing security-bearing reads this — db/auth.ts's
   * requirePermission re-reads overrides from SQLite on every guarded write,
   * and the server re-derives them again from its own tables. app/index.tsx
   * refreshes this snapshot on every launch and session change.
   */
  permissions?: PermissionOverrides;
}

/** Headless-context read only; components must use useSessionStore. */
export function readPersistedSessionSync(): Session | null {
  const serialized = sessionStorage.getString('session');
  if (!serialized) {
    return null;
  }

  try {
    const persisted = JSON.parse(serialized) as { state?: { session?: Session | null } };
    return persisted.state?.session ?? null;
  } catch {
    return null;
  }
}

interface SessionState {
  session: Session | null;
  /**
   * Monotonic counter identifying THIS login instance. Bumped by both login()
   * and clearActiveUser(), so it changes on every device handover.
   *
   * A user id cannot serve this purpose: the owner handing the phone to staff
   * and taking it straight back produces the same userId either side of two
   * real handovers, while the cart in between was cleared. Async work started
   * under one login therefore captures this number and re-checks it (see
   * state/sessionGuard.ts) rather than comparing identities.
   */
  epoch: number;
  login: (session: Session) => void;
  /**
   * Ends the ACTIVE LOCAL USER's session and nothing else.
   *
   * Deliberately NOT named `logout`: this is not a sign-out. It clears only
   * the `session` key in MMKV's 'muthoy-session' store. The linked-device
   * cloud identity (the Supabase JWT lives in a SEPARATE MMKV store,
   * 'muthoy-supabase-auth' — see sync/supabaseClient.ts), the shop's
   * `cloud_linked_at` row in SQLite, and the shop-keyed pull cursor
   * ('muthoy-sync-cursor') are all untouched — so the device stays linked and
   * the next person reaches PIN Login, never OTP or Registration.
   *
   * Used by state/switchUser.ts for a device handover, and by app/index.tsx's
   * root gate when a persisted session no longer matches SQLite.
   */
  clearActiveUser: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      session: null,
      epoch: 0,
      // Both transitions bump. clearActiveUser() alone is not enough: work
      // started before a handover must be invalidated even if the SAME person
      // logs back in before it finishes.
      login: (session) => set((state) => ({ session, epoch: state.epoch + 1 })),
      clearActiveUser: () => set((state) => ({ session: null, epoch: state.epoch + 1 })),
    }),
    {
      name: 'session',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
