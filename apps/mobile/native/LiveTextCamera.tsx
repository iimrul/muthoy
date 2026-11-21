// native/LiveTextCamera.tsx — frame-processor OCR for the live strip scanner
// (founder-approved 2026-11-21). react-native-vision-camera 5 hands every live
// camera frame to ML Kit (react-native-vision-camera-ocr-plus) on a native
// background thread. No photo is taken, JPEG-encoded, written, read back and
// deleted per frame — the cost the expo-camera capture loop
// (ScannerCamera.captureFrameAsync) pays on every reading.
//
// This is the ONLY file that touches that stack (DEVELOPMENT_RULES.md: native
// modules live in native/). A build made before the stack was added has no
// Nitro host module, so the packages are required lazily behind a guard and
// isLiveTextCameraAvailable() reports false there; the scanner then keeps the
// capture loop. VisionCamera 5 has no barcode output on Android, so a scanner
// that needs barcodes keeps the expo-camera path as well.

import { type ComponentType, type Ref, useCallback, useImperativeHandle, useMemo, useState } from "react";
import { Platform, StyleSheet, TurboModuleRegistry } from "react-native";
import type { CameraPermissionState } from "../domain/cameraPermissionState";
import { liveTextResultKey, toOcrTextLines, type LiveTextResult } from "../domain/liveTextFrame";
import type { OcrTextLine } from "../domain/stripMatcher";
import { useScannerPermission } from "./useScannerPermission";

interface NativeFrame {
  orientation?: string;
  getNativeBuffer: () => { pointer: bigint; release: () => void };
  dispose: () => void;
}
interface TextRecognizer {
  scanFrame: (pointer: bigint, orientation: string) => LiveTextResult | undefined;
}
interface Synchronizable<T> {
  getDirty: () => T;
  setBlocking: (value: T) => void;
}
interface FrameCameraProps {
  style: object;
  device: "back";
  isActive: boolean;
  outputs: unknown[];
  onError: (error: Error) => void;
}
interface FrameOcrStack {
  Camera: ComponentType<FrameCameraProps>;
  useFrameOutput: (options: { onFrame: (frame: NativeFrame) => void; pixelFormat: string }) => unknown;
  useTextRecognition: (options: typeof RECOGNITION_OPTIONS) => { recognizer: TextRecognizer };
  createSynchronizable: (value: string) => Synchronizable<string>;
  scheduleOnRN: (callback: (lines: OcrTextLine[] | null) => void, lines: OcrTextLine[] | null) => void;
}

// frameSkipThreshold 1: a new recognition starts on the first frame after the
// previous one finished, so a strip is read as soon as ML Kit is free. Latin
// only — the non-Latin and translation models are left out of the build by the
// ocr-plus config plugin (app.config.js).
const RECOGNITION_OPTIONS = { language: "latin", frameSkipThreshold: 1, useLightweightMode: true } as const;
// ocr-plus reads Android frames as RGBA hardware buffers and iOS frames as YUV.
const PIXEL_FORMAT = Platform.OS === "android" ? "rgb" : "yuv";

let cachedStack: FrameOcrStack | null | undefined;

function loadFrameOcrStack(): FrameOcrStack | null {
  if (cachedStack !== undefined) return cachedStack;
  cachedStack = null;
  // Requiring the packages in a build without the native side would throw while
  // they create their native objects — check for the host module first.
  if (TurboModuleRegistry.get("NitroModules") == null) return cachedStack;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports -- lazy: absent in older builds */
    const visionCamera = require("react-native-vision-camera");
    const ocrPlus = require("react-native-vision-camera-ocr-plus");
    const worklets = require("react-native-worklets");
    /* eslint-enable @typescript-eslint/no-require-imports */
    cachedStack = {
      Camera: visionCamera.Camera,
      useFrameOutput: visionCamera.useFrameOutput,
      useTextRecognition: ocrPlus.useTextRecognition,
      createSynchronizable: worklets.createSynchronizable,
      scheduleOnRN: worklets.scheduleOnRN,
    };
  } catch {
    cachedStack = null;
  }
  return cachedStack;
}

/** True only in builds that contain the frame-processor OCR stack. */
export function isLiveTextCameraAvailable(): boolean {
  return loadFrameOcrStack() !== null;
}

export interface LiveTextCameraHandle {
  requestPermission: () => Promise<boolean>;
}

export interface LiveTextCameraProps {
  isActive: boolean;
  /** One NEW reading (repeats are filtered out); null when recognition failed. */
  onLines: (lines: OcrTextLine[] | null) => void;
  onPermissionStateChange: (state: CameraPermissionState) => void;
  ref?: Ref<LiveTextCameraHandle>;
}

export function LiveTextCamera({ isActive, onLines, onPermissionStateChange, ref }: LiveTextCameraProps) {
  const [hasMountError, setHasMountError] = useState(false);
  const { isGranted, requestPermission } = useScannerPermission(onPermissionStateChange, hasMountError);
  const handleError = useCallback(() => setHasMountError(true), []);

  useImperativeHandle(ref, () => ({ requestPermission }), [requestPermission]);

  const stack = loadFrameOcrStack();
  if (!stack || !isGranted || hasMountError) return null;
  return <FrameOcrCamera stack={stack} isActive={isActive} onLines={onLines} onError={handleError} />;
}

interface FrameOcrCameraProps {
  stack: FrameOcrStack;
  isActive: boolean;
  onLines: (lines: OcrTextLine[] | null) => void;
  onError: (error: Error) => void;
}

function FrameOcrCamera({ stack, isActive, onLines, onError }: FrameOcrCameraProps) {
  const { Camera, useFrameOutput, useTextRecognition, createSynchronizable, scheduleOnRN } = stack;
  const { recognizer } = useTextRecognition(RECOGNITION_OPTIONS);
  // Written only by the frame worklet, so its unlocked read is exact.
  const lastKey = useMemo(() => createSynchronizable(""), [createSynchronizable]);

  // Runs on the camera's frame thread for EVERY frame: never blocks (scanFrame
  // returns the last completed result and queues the next one natively), always
  // disposes the frame, and wakes the JS thread only for a new reading.
  const onFrame = useCallback(
    (frame: NativeFrame) => {
      "worklet";
      let result: LiveTextResult | undefined;
      let hasFailed = false;
      try {
        const buffer = frame.getNativeBuffer();
        try {
          result = recognizer.scanFrame(buffer.pointer, frame.orientation ?? "unknown");
        } finally {
          buffer.release();
        }
      } catch {
        hasFailed = true;
      } finally {
        frame.dispose();
      }
      if (hasFailed) {
        scheduleOnRN(onLines, null);
        return;
      }
      const reading = result ?? { resultText: "", blocks: [] };
      const key = liveTextResultKey(reading, Date.now());
      if (key === lastKey.getDirty()) return;
      lastKey.setBlocking(key);
      scheduleOnRN(onLines, toOcrTextLines(reading));
    },
    [recognizer, lastKey, scheduleOnRN, onLines],
  );

  const frameOutput = useFrameOutput({ onFrame, pixelFormat: PIXEL_FORMAT });

  return <Camera style={styles.fill} device="back" isActive={isActive} outputs={[frameOutput]} onError={onError} />;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
