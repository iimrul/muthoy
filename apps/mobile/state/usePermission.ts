import { resolvePermission, toRole, type Permission } from '../domain/permissions';
import { useSessionStore, type Session } from './sessionStore';

// state/usePermission.ts — the route-level half of Volume 0 Day 11's
// permission check. Reads the logged-in role from the session store and
// resolves it through domain/permissions.hasPermission — the app's single
// grant table — so no screen compares a role string itself.
//
// This is a UI guard only: it decides what a screen RENDERS. The session
// store is remembered state, not the source of truth, so it can never be the
// last line of defence. Every guarded write additionally re-derives the role
// from SQLite in db/auth.ts's requirePermission, which is what actually
// blocks a Staff login that arrives by direct navigation.

export interface PermissionCheck {
  session: Session | null;
  /** True only with a live session whose role grants `permission`. */
  isAllowed: boolean;
}

export function usePermission(permission: Permission): PermissionCheck {
  const session = useSessionStore((state) => state.session);
  // `session.role` is typed as Role but comes off persisted MMKV, so at runtime
  // it can be any string — a P1 'manager', or a tampered value. toRole fails
  // those closed here exactly as the db/ guards do, instead of letting an
  // unnarrowed role fall through to the staff grant list.
  const role = session ? toRole(session.role) : null;
  return {
    session,
    // Same default-then-override resolution db/auth.ts's requirePermission and
    // the server's auth_has_permission use, so a staff member is never shown a
    // screen whose write the DB would then refuse — or refused a screen the
    // owner granted them.
    isAllowed: role !== null && resolvePermission(role, permission, session?.permissions),
  };
}
