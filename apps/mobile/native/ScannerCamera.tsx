// native/ScannerCamera.tsx — the one deliberate .tsx file in native/
// (DEVELOPMENT_RULES.md: "native/ — the ONLY code that imports native
// modules"). A live camera preview needs a rendered component, which the
// rest of native/ (id.ts, crypto.ts, notifications.ts, scanner.ts) never
// needed — this file exists so expo-camera's import stays confined to
// native/ rather than leaking into components/scanner/.
//
// Thin on purpose: live preview + an imperative capture/permission handle.
// No copy, styling, or business logic — that lives in
// components/scanner/MedicineTextScanner.tsx, which composes this primitive
// and never imports expo-camera itself.

import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { resolveCameraPermissionState, type CameraPermissionState } from '../domain/cameraPermissionState';

export type { CameraPermissionState };

export interface ScannerCameraHandle {
  requestPermission: () => Promise<boolean>;
  captureAsync: () => Promise<string | null>;
}

export interface ScannerCameraProps {
  onPermissionStateChange: (state: CameraPermissionState) => void;
  ref?: React.Ref<ScannerCameraHandle>;
}

const CAPTURE_OPTIONS = { quality: 0.8, skipProcessing: true } as const;

export function ScannerCamera({ onPermissionStateChange, ref }: ScannerCameraProps) {
  const cameraViewRef = useRef<CameraView>(null);
  const isCameraReadyRef = useRef(false);
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [hasMountError, setHasMountError] = useState(false);

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
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        getPermission().catch(() => {
          // Best-effort refresh; the existing permission state (and its own
          // Grant/Settings affordances) still drives the UI if this fails.
        });
      }
    });
    return () => subscription.remove();
  }, [getPermission]);

  useImperativeHandle(
    ref,
    () => ({
      // Reports success/failure so the caller can show a distinct
      // request-failed message — unlike a normal decline (which the
      // permission hook's own state already communicates), a thrown native
      // call would otherwise look like the button silently did nothing.
      requestPermission: async () => {
        try {
          await requestPermission();
          return true;
        } catch {
          return false;
        }
      },
      // Never throws — a capture failure (camera not yet ready, hardware
      // busy, user backgrounded mid-capture) is reported as null so the
      // caller's existing error UI state handles it, same as a "no text
      // detected" OCR result.
      captureAsync: async () => {
        if (!cameraViewRef.current || !isCameraReadyRef.current) {
          return null;
        }
        try {
          const photo = await cameraViewRef.current.takePictureAsync(CAPTURE_OPTIONS);
          return photo?.uri ?? null;
        } catch {
          return null;
        }
      },
    }),
    [requestPermission],
  );

  if (!permission?.granted || hasMountError) {
    return null;
  }

  return (
    <CameraView
      ref={cameraViewRef}
      style={{ flex: 1 }}
      facing="back"
      onCameraReady={() => {
        isCameraReadyRef.current = true;
      }}
      onMountError={() => {
        isCameraReadyRef.current = false;
        setHasMountError(true);
      }}
    />
  );
}
