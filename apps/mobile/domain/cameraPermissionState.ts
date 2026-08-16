// domain/cameraPermissionState.ts — pure decision logic for the scanner's
// permission/error UI, extracted out of native/ScannerCamera.tsx and
// components/scanner/MedicineTextScanner.tsx so the exact state-transition
// rules are unit-testable without a React Native rendering harness (this
// repo has none — Vitest covers pure logic only; see docs/plans/ocr.md).
// Zero React/native/DB imports (mirrors domain/fefo.ts).

export type CameraPermissionState = 'checking' | 'deniable' | 'blocked' | 'granted' | 'unavailable';

export interface CameraPermissionSnapshot {
  granted: boolean;
  canAskAgain: boolean;
}

// Mount errors take priority over whatever the permission hook reports — a
// broken native camera view is 'unavailable' regardless of permission
// status, so a real hardware/mount failure is never masked by a stale
// 'granted' read. A null permission means the native check hasn't resolved
// yet ('checking'); once it has, `canAskAgain` distinguishes a
// re-promptable denial ('deniable') from a permanent one that only Settings
// can fix ('blocked'). Every branch returns a real state with its own
// user-visible action (see MedicineTextScanner.tsx) — none is a dead end.
export function resolveCameraPermissionState(
  permission: CameraPermissionSnapshot | null,
  hasMountError: boolean,
): CameraPermissionState {
  if (hasMountError) {
    return 'unavailable';
  }
  if (!permission) {
    return 'checking';
  }
  if (permission.granted) {
    return 'granted';
  }
  if (permission.canAskAgain) {
    return 'deniable';
  }
  return 'blocked';
}

// A failed requestPermission() call (the native call itself throwing, not
// the user simply declining) needs its own visible message distinct from
// the normal deniable/blocked copy — otherwise the user sees the "Grant
// access" button do nothing and has no idea whether to retry or give up.
export function requestPermissionErrorMessage(succeeded: boolean): string | null {
  return succeeded ? null : "Couldn't request camera access. Try again.";
}

// Linking.openSettings() rejects on some Android OEM builds (and any platform
// where no Settings activity resolves). Left unhandled that is an invisible
// dead end: the button appears to do nothing and the user has no way forward.
// The failure message therefore carries the manual navigation path as a
// fallback, and the button itself stays pressable to retry
// (docs/plans/ocr.md — "no dead scanner state").
export function openSettingsErrorMessage(succeeded: boolean): string | null {
  return succeeded
    ? null
    : "Couldn't open Settings. Open it manually: Settings › Apps › Muthoy › Permissions › Camera.";
}
