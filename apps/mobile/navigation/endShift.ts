import { router, type Href } from 'expo-router';
import type { Role } from '../domain/permissions';
import { clearDeviceRelinkRequired } from '../state/deviceRelinkStore';
import { switchUser, switchUserDurably } from '../state/switchUser';

// navigation/endShift.ts — "Logout" / "Switch user" / "End shift", once.
//
// The handover itself is state/switchUser.ts, unchanged: cart and local
// session only, never SQLite, the cloud identity or the device registry. This
// adds the one navigation rule every caller needs: nothing of the outgoing
// user's screens stays underneath the next one. Settings sits on top of the
// dashboard, and a plain replace left the dashboard there for Android Back to
// reveal (to a signed-out user, behind the session overlay).
//
// Order is the contract: teardown first and synchronously, then the stack is
// emptied, then the destination replaces the one screen left. switchUser()
// throwing stops everything after it, so a failed teardown never navigates.
function replaceWholeStack(href: Href): void {
  if (router.canDismiss?.()) {
    router.dismissAll();
  }
  router.replace(href);
}

export function endShiftToPinPad(): void {
  switchUser();
  replaceWholeStack('/');
}

// A2.3 device_session_unbound: the actor must prove phone + PIN on Device
// Login to bind this installation. The teardown is the durable one
// (switchUserDurably): it throws with nothing changed if the signed-out
// session cannot be written, so a failed relink stays signed in, in memory
// AND on disk, on the screen it started from. The relink requirement is
// cleared, and the stack emptied, only after the old session is really gone.
export function endShiftForDeviceRelink(role: Role): void {
  switchUserDurably();
  clearDeviceRelinkRequired();
  replaceWholeStack({ pathname: '/device-login', params: { role, reason: 'relink' } });
}
