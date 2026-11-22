import type { ReactNode } from "react";
import { View } from "react-native";

// monitoring/tapLatencyProbe.tsx — measures how fast the app answers a tap, on a real
// device, in a real release build.
//
// ON ONLY when the build sets EXPO_PUBLIC_PERF_PROBE=1 (the EAS `internal`
// profile does; `production` does not, so there the wrapper is never rendered).
// For every tap anywhere in the app it logs, to the device log only:
//
//   PERF tap#<n> first=<ms> settle=<ms> blocked=<ms>
//
//   first   — touch-end to the first frame after it (handler + render)
//   settle  — touch-end to the last frame the JS thread held up
//   blocked — total frame time the JS thread held up after the tap
//
// Read it with `adb logcat -s ReactNativeJS`. It records timings only — no
// route, id, shop or user — and it never touches the database. (A probe that
// wrapped expo-sqlite once broke the encrypted-open check; never do that.)

export const isTapLatencyProbeEnabled = process.env.EXPO_PUBLIC_PERF_PROBE === "1";

const FRAME_BUDGET_MS = 16.7;
const DROPPED_FRAME_MS = 25;
const QUIET_FRAMES_TO_SETTLE = 10;
const GIVE_UP_MS = 8_000;

let tapNumber = 0;

function measureTap(): void {
  tapNumber += 1;
  const id = tapNumber;
  const startedAt = performance.now();
  let last = startedAt;
  let first = -1;
  let quietFrames = 0;
  let busyEnd = startedAt;
  let blocked = 0;
  const onFrame = () => {
    const now = performance.now();
    const gap = now - last;
    last = now;
    if (first < 0) first = now - startedAt;
    if (gap > DROPPED_FRAME_MS) {
      blocked += gap - FRAME_BUDGET_MS;
      busyEnd = now;
      quietFrames = 0;
    } else {
      quietFrames += 1;
    }
    if (quietFrames >= QUIET_FRAMES_TO_SETTLE || now - startedAt > GIVE_UP_MS) {
      console.log(
        `PERF tap#${id} first=${first.toFixed(0)}ms settle=${(busyEnd - startedAt).toFixed(0)}ms blocked=${blocked.toFixed(0)}ms`,
      );
      return;
    }
    requestAnimationFrame(onFrame);
  };
  requestAnimationFrame(onFrame);
}

/** Wraps the app; observes touches in the capture phase and never claims them. */
export function TapLatencyProbe({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1 }} onTouchEndCapture={measureTap}>
      {children}
    </View>
  );
}
