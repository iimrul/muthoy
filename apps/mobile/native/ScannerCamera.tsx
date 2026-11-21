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
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { resolveCameraPermissionState, type CameraPermissionState } from '../domain/cameraPermissionState';
import { pickScanPictureSize } from '../domain/scanPictureSize';

export type { CameraPermissionState };

export interface ScannerCameraHandle {
  requestPermission: () => Promise<boolean>;
  captureAsync: () => Promise<string | null>;
  /**
   * The live strip scanner's frame: smaller, silent, no shutter animation.
   * Same contract as captureAsync — never throws, null when not ready — and the
   * caller owns (and must delete) the returned temporary file.
   */
  captureFrameAsync: () => Promise<string | null>;
}

export interface ScannerCameraProps {
  onPermissionStateChange: (state: CameraPermissionState) => void;
  onBarcodeScanned?: (result: BarcodeScanningResult) => void;
  barcodeEnabled?: boolean;
  /**
   * Live strip scanning: captures run back to back, so the shutter animation is
   * off and the picture size is reduced (domain/scanPictureSize.ts). Absent, the
   * camera behaves exactly as the tap-to-capture scanners have always had it.
   */
  isContinuous?: boolean;
  ref?: React.Ref<ScannerCameraHandle>;
}

const CAPTURE_OPTIONS = { quality: 0.8, skipProcessing: true } as const;
// Quality 0.5: every live frame is JPEG-encoded, written, read back and decoded,
// so a smaller file is time saved twice per frame. Resolution is NOT lowered —
// that is what keeps small print ("20 mg") legible (domain/scanPictureSize.ts).
const FRAME_OPTIONS = { quality: 0.5, skipProcessing: true, shutterSound: false } as const;

export function ScannerCamera({
  onPermissionStateChange,
  onBarcodeScanned,
  barcodeEnabled = false,
  isContinuous = false,
  ref,
}: ScannerCameraProps) {
  const cameraViewRef = useRef<CameraView>(null);
  const isCameraReadyRef = useRef(false);
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [hasMountError, setHasMountError] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);

  const takeAsync = async (options: typeof CAPTURE_OPTIONS | typeof FRAME_OPTIONS) => {
    if (!cameraViewRef.current || !isCameraReadyRef.current) {
      return null;
    }
    try {
      const photo = await cameraViewRef.current.takePictureAsync(options);
      return photo?.uri ?? null;
    } catch {
      return null;
    }
  };

  // Best-effort: a device that will not list its sizes keeps its default size,
  // which is slower but still works.
  const choosePictureSize = async () => {
    try {
      const sizes = (await cameraViewRef.current?.getAvailablePictureSizesAsync()) ?? [];
      setPictureSize(pickScanPictureSize(sizes) ?? undefined);
    } catch {
      // keep the default
    }
  };

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
      captureAsync: () => takeAsync(CAPTURE_OPTIONS),
      captureFrameAsync: () => takeAsync(FRAME_OPTIONS),
    }),
    // takeAsync reads only refs, so it cannot go stale between renders.
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
      barcodeScannerSettings={{
        barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'],
      }}
      onBarcodeScanned={barcodeEnabled ? onBarcodeScanned : undefined}
      animateShutter={!isContinuous}
      pictureSize={isContinuous ? pictureSize : undefined}
      onCameraReady={() => {
        isCameraReadyRef.current = true;
        if (isContinuous && pictureSize === undefined) void choosePictureSize();
      }}
      onMountError={() => {
        isCameraReadyRef.current = false;
        setHasMountError(true);
      }}
    />
  );
}
