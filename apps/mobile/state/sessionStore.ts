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
  /** Start of this operational login/shift. Preserved across app restarts. */
  startedAt?: string;
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
  principalUserId?: string;
  billingAccountId?: string;
  cloudShopConfirmed?: boolean;
  /** False until the stored cloud JWT is proven to name this actor + shop. */
  cloudActorConfirmed?: boolean;
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

export function readLastShopIdSync(): string | null {
  const serialized = sessionStorage.getString('session');
  if (!serialized) return null;
  try {
    const persisted = JSON.parse(serialized) as { state?: { lastShopId?: string | null } };
    return persisted.state?.lastShopId ?? null;
  } catch {
    return null;
  }
}

interface SessionState {
  session: Session | null;
  /** True only while an online shop switch owns the credential/session handoff. */
  authorityTransitioning: boolean;
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
  lastShopId: string | null;
  login: (session: Session) => void;
  /** Invalidates the active epoch and hides all auth UI during a shop handoff. */
  beginAuthorityTransitionIfEpoch: (expectedEpoch: number) => number | null;
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
  /** Atomically clears only the login instance the caller inspected. */
  clearActiveUserIfEpoch: (expectedEpoch: number) => boolean;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      session: null,
      authorityTransitioning: false,
      epoch: 0,
      lastShopId: null,
      // Both transitions bump. clearActiveUser() alone is not enough: work
      // started before a handover must be invalidated even if the SAME person
      // logs back in before it finishes.
      login: (session) => set((state) => ({
        session: { ...session, startedAt: session.startedAt ?? new Date().toISOString() },
        authorityTransitioning: false,
        epoch: state.epoch + 1,
        lastShopId: session.shopId,
      })),
      beginAuthorityTransitionIfEpoch: (expectedEpoch) => {
        let transitionEpoch: number | null = null;
        set((state) => {
          if (state.epoch !== expectedEpoch || state.session === null) return state;
          transitionEpoch = state.epoch + 1;
          return {
            session: null,
            authorityTransitioning: true,
            epoch: transitionEpoch,
          };
        });
        return transitionEpoch;
      },
      clearActiveUser: () => set((state) => ({
        session: null,
        authorityTransitioning: false,
        epoch: state.epoch + 1,
      })),
      clearActiveUserIfEpoch: (expectedEpoch) => {
        let cleared = false;
        set((state) => {
          if (state.epoch !== expectedEpoch || state.session === null) return state;
          cleared = true;
          return { session: null, authorityTransitioning: false, epoch: state.epoch + 1 };
        });
        return cleared;
      },
    }),
    {
      name: 'session',
      storage: createJSONStorage(() => mmkvStorage),
      // Epoch and in-flight transition state are process-local concurrency
      // controls. Persisting either could strand a cold start in a transition
      // that no longer has an owner.
      partialize: (state) => ({ session: state.session, lastShopId: state.lastShopId }),
    },
  ),
);
