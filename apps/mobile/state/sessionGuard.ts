import { StaleSessionError } from '../db/errors';
import { useSessionStore, type Session } from './sessionStore';

export { StaleSessionError };

// state/sessionGuard.ts — the one mechanism every actor-stamping write uses to
// survive a device handover (Volume 0 Days 5/11; state/switchUser.ts).
//
// The problem it solves: a screen's async handler closes over the `session`
// that rendered it. That closure keeps running across a switch, so without a
// check it would stamp the OUTGOING user's id on a row committed after the
// phone changed hands, and push the outgoing user's screen at the incoming
// user. Comparing `session.userId` against the live store is not sufficient —
// owner → staff → owner returns the same id across two real handovers while
// the cart in between was cleared, so identity cannot see what happened.
//
// The epoch can. Capture it at the top of the handler, then re-check after
// EVERY await and immediately before anything that commits or navigates.
export interface SessionGuard {
  /** The epoch this unit of work belongs to. */
  readonly epoch: number;
  /** True once any login/clearActiveUser has happened since capture. */
  isStale: () => boolean;
  /**
   * The inverse of isStale, in the shape db/ writes accept. Handed straight to
   * a write's `isStillActive` so db/errors.ts's assertSessionLive re-checks
   * this same epoch as the FIRST statement inside the transaction.
   */
  isStillActive: () => boolean;
  /** Throws StaleSessionError if the device changed hands. */
  assertLive: () => void;
  /**
   * Runs `effect` only while this login still holds. Every continuation after
   * an await belongs here: clearing a form, repainting owner-only figures,
   * navigating, showing a success or an error. They are all the OUTGOING
   * user's screen, and none of them may land on the incoming user.
   */
  ifLive: (effect: () => void) => void;
  /** ifLive for a continuation that is itself async (a reload, say). */
  ifLiveAsync: (effect: () => Promise<void>) => Promise<void>;
}

export function captureSession(): SessionGuard {
  return guardForEpoch(useSessionStore.getState().epoch);
}

/**
 * captureSession, plus the check a screen handler needs: that the store has not
 * ALREADY moved past the session this handler closed over.
 *
 * Zustand writes the store synchronously but React re-renders afterwards, so a
 * press that lands in that window runs a handler still holding the outgoing
 * `session` while the epoch has already advanced. Capturing the epoch there
 * would produce a guard that never goes stale, and the write would stamp the
 * OUTGOING user's id on a row committed under the INCOMING user's login — the
 * one outcome the whole handover contract exists to prevent.
 *
 * Returns null when the unit of work must not start at all. Callers return
 * silently: whoever is holding the phone did not press this button, so there is
 * nothing to tell them.
 */
export function captureSessionFor(rendered: Session): SessionGuard | null {
  const { session, epoch } = useSessionStore.getState();
  if (!session || session.userId !== rendered.userId || session.shopId !== rendered.shopId) {
    return null;
  }
  return guardForEpoch(epoch);
}

function guardForEpoch(epoch: number): SessionGuard {
  const isStale = (): boolean => useSessionStore.getState().epoch !== epoch;
  return {
    epoch,
    isStale,
    isStillActive: () => !isStale(),
    assertLive: () => {
      if (isStale()) {
        throw new StaleSessionError();
      }
    },
    ifLive: (effect) => {
      if (!isStale()) {
        effect();
      }
    },
    ifLiveAsync: async (effect) => {
      if (!isStale()) {
        await effect();
      }
    },
  };
}
