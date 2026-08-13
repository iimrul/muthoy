import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { createMMKV } from 'react-native-mmkv';
import type { Role } from '../domain/permissions';

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
  login: (session: Session) => void;
  logout: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      session: null,
      login: (session) => set({ session }),
      logout: () => set({ session: null }),
    }),
    {
      name: 'session',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
