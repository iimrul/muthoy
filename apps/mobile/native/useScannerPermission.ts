// native/useScannerPermission.ts — the camera permission flow shared by both
// live cameras (ScannerCamera: expo-camera; LiveTextCamera: VisionCamera frame
// OCR). Both read the same OS camera permission, so expo-camera's hook serves
// both and the existing permission panel works unchanged.

import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { useCameraPermissions } from "expo-camera";
import { resolveCameraPermissionState, type CameraPermissionState } from "../domain/cameraPermissionState";

export interface ScannerPermission {
  isGranted: boolean;
  /** Never throws: false when the native request itself failed. */
  requestPermission: () => Promise<boolean>;
}

export function useScannerPermission(
  onPermissionStateChange: (state: CameraPermissionState) => void,
  hasMountError: boolean,
): ScannerPermission {
  const [permission, requestPermission, getPermission] = useCameraPermissions();

  useEffect(() => {
    onPermissionStateChange(resolveCameraPermissionState(permission, hasMountError));
  }, [permission, hasMountError, onPermissionStateChange]);

  // useCameraPermissions() only updates its `permission` value on mount or
  // after requestPermission() — it never learns the user granted access from
  // the OS Settings app while this modal stayed mounted underneath it.
  // Re-check (its 3rd tuple member, a manual getCameraPermissionsAsync) on
  // every foreground transition so a `blocked` state clears on its own
  // instead of trapping the user (docs/plans/ocr.md).
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        getPermission().catch(() => {
          // Best-effort refresh; the existing permission state (and its own
          // Grant/Settings affordances) still drives the UI if this fails.
        });
      }
    });
    return () => subscription.remove();
  }, [getPermission]);

  // Reports success/failure so the caller can show a distinct request-failed
  // message — unlike a normal decline (which the permission hook's own state
  // already communicates), a thrown native call would otherwise look like the
  // button silently did nothing.
  const request = useCallback(async () => {
    try {
      await requestPermission();
      return true;
    } catch {
      return false;
    }
  }, [requestPermission]);

  return { isGranted: Boolean(permission?.granted), requestPermission: request };
}
