import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { AppState } from "react-native";
import { matchStrip, type OcrTextLine, type StripIndex } from "../../domain/stripMatcher";
import {
  createScanSession,
  lockScannedMedicines,
  stepScanSession,
  type ScanSessionAction,
} from "../../domain/stripScanSession";
import { reportEvent } from "../../monitoring";
import { removeTemporaryCapture } from "../../native/prescriptionAttachment";
import type { ScannerCameraHandle } from "../../native/ScannerCamera";
import { scanTextLines } from "../../native/scanner";

// components/scanner/useLiveStripScan.ts — the live strip scanner's frame loop.
//
// capture a frame -> ML Kit lines -> delete the frame -> match against the
// shop's inventory -> session decides -> hand the action to the screen. One
// frame is in flight at a time: pausing (a choice on screen, the app in the
// background) cancels the loop, and a resumed loop waits for the previous one
// to finish so two captures can never race on the camera.
//
// Every frame is a temporary file owned here and deleted whether or not it was
// read — the same guarantee MedicineTextScanner gives its OCR path.

/** Minimum time between frame starts; recognition usually takes longer anyway. */
export const LIVE_SCAN_FRAME_MS = 200;
/** Back-off while the camera is not ready or a read failed. */
export const LIVE_SCAN_RETRY_MS = 300;
const READ_FAILURES_BEFORE_NOTICE = 5;

export type LiveScanAction = Exclude<ScanSessionAction, { kind: "idle" }>;

export interface UseLiveStripScanOptions {
  isEnabled: boolean;
  cameraRef: RefObject<ScannerCameraHandle | null>;
  index: StripIndex | null;
  onAction: (action: LiveScanAction) => void | Promise<void>;
  frameIntervalMs?: number;
  retryMs?: number;
}

export interface LiveStripScan {
  /** True after several consecutive frames ML Kit could not read at all. */
  isReadFailing: boolean;
  /** For medicines the seller resolved by hand, so the same strip is not re-offered. */
  lockMedicines: (medicineIds: readonly string[]) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function discardFrame(uri: string): Promise<void> {
  if (!(await removeTemporaryCapture(uri))) reportEvent("scan.capture_cleanup.failed");
}

/** Recognition that reports failure as null instead of throwing out of the loop. */
async function readFrame(uri: string): Promise<OcrTextLine[] | null> {
  try {
    return await scanTextLines(uri);
  } catch {
    return null;
  } finally {
    void discardFrame(uri);
  }
}

export function useLiveStripScan({
  isEnabled,
  cameraRef,
  index,
  onAction,
  frameIntervalMs = LIVE_SCAN_FRAME_MS,
  retryMs = LIVE_SCAN_RETRY_MS,
}: UseLiveStripScanOptions): LiveStripScan {
  const sessionRef = useRef(createScanSession());
  const onActionRef = useRef(onAction);
  const previousLoopRef = useRef<Promise<void>>(Promise.resolve());
  const [isAppActive, setIsAppActive] = useState(AppState.currentState !== "background");
  const [isReadFailing, setIsReadFailing] = useState(false);

  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      setIsAppActive(next === "active");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isEnabled || !index || !isAppActive) return undefined;
    const control = { isCancelled: false };

    const runLoop = async () => {
      let failures = 0;
      // PIPELINED: the recognition of one frame overlaps the capture of the
      // next. The camera and ML Kit run on separate native threads, so a frame
      // costs max(capture, read) instead of capture + read. Results are still
      // handled strictly in capture order, and every frame is still deleted by
      // readFrame whether or not its result is used.
      let pendingRead: Promise<OcrTextLine[] | null> | null = null;
      while (!control.isCancelled) {
        const startedAt = Date.now();
        const uri = (await cameraRef.current?.captureFrameAsync()) ?? null;
        const previousRead = pendingRead;
        pendingRead = uri ? readFrame(uri) : null;
        if (!previousRead) {
          if (!uri) await sleep(retryMs);
          continue;
        }
        const lines = await previousRead;
        if (control.isCancelled) break;
        if (lines === null) {
          failures += 1;
          if (failures >= READ_FAILURES_BEFORE_NOTICE) setIsReadFailing(true);
          await sleep(retryMs);
          continue;
        }
        if (failures > 0) {
          failures = 0;
          setIsReadFailing(false);
        }
        const step = stepScanSession(sessionRef.current, matchStrip(index, lines), Date.now());
        sessionRef.current = step.state;
        if (step.action.kind !== "idle") {
          // The screen reports its own failures (an add that could not be made
          // shows an inline notice). This guard only keeps one failed action
          // from silently ending the whole scanning session.
          try {
            await onActionRef.current(step.action);
          } catch {
            setIsReadFailing(true);
          }
        }
        // Always a real timer, even at 0 ms: without one, a loop whose awaits all
        // resolve immediately never yields to rendering or touch handling.
        await sleep(Math.max(0, frameIntervalMs - (Date.now() - startedAt)));
      }
    };

    previousLoopRef.current = previousLoopRef.current.then(runLoop, runLoop);
    return () => {
      control.isCancelled = true;
    };
  }, [cameraRef, frameIntervalMs, index, isAppActive, isEnabled, retryMs]);

  const lockMedicines = useCallback((medicineIds: readonly string[]) => {
    sessionRef.current = lockScannedMedicines(sessionRef.current, medicineIds, Date.now());
  }, []);

  return { isReadFailing, lockMedicines };
}
