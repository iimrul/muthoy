// navigation/lastRoute.ts — the screen to return to after the authority gate.
//
// Every reconnect and every return to the foreground closes the whole
// authenticated runtime while app/_layout.tsx re-checks the session (H-10 #6:
// nothing authenticated stays mounted under the "Checking your access…"
// screen). Closing it unmounts the navigator, which used to drop the person on
// the first tab: a pharmacist mid-refund on Sale history came back to the Sale
// screen (device test, 2026-11-26).
//
// This remembers the last authenticated route, and hands it back ONCE after a
// gate re-check of the SAME session. It never decides access: the boundary
// re-checks the route against the current session before using it, and the
// gate itself is unchanged. In memory only, never persisted: a restart, a
// different user, a new login or a shop switch (a new epoch) restores nothing.

let remembered: { key: string; href: string } | null = null;
let armedKey: string | null = null;

/** Identifies one signed-in session: the epoch changes on every login, switch and sign-out. */
export function routeSessionKey(epoch: number, userId: string, shopId: string): string {
  return `${epoch}:${userId}:${shopId}`;
}

/** Called by the navigation boundary for every authenticated route it shows. */
export function rememberRoute(key: string, href: string): void {
  remembered = { key, href };
}

/** Called by the authority gate as it closes for a re-check of this session. */
export function armRouteRestore(key: string): void {
  armedKey = key;
}

/**
 * The route to return to, if the gate was re-checked for this same session
 * since the route was remembered. Consumes the arming either way, so a later
 * remount (for any other reason) never jumps.
 */
export function takeRouteToRestore(key: string): string | null {
  if (armedKey !== key) return null;
  armedKey = null;
  if (!remembered || remembered.key !== key) return null;
  return remembered.href;
}

export function resetRouteMemoryForTests(): void {
  remembered = null;
  armedKey = null;
}
