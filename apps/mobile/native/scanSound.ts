// native/scanSound.ts — the live strip scanner's "added to cart" beep, the
// same short 800 Hz tone the prototype played (assets/sounds/scan-beep.wav is
// rendered from the prototype's own WebAudio parameters). The ONLY file that
// touches expo-audio (DEVELOPMENT_RULES.md: native modules live in native/).
//
// expo-audio is a native module. A build made before it was added has no
// "ExpoAudio" module, and expo-audio's own entry throws at import time on such
// a build — so it is never imported statically. The module is checked first
// and only then loaded; on an older build the beep is simply silent and
// scanning carries on.
//
// The phone's silent / vibrate mode is respected (playsInSilentMode: false) and
// other apps' audio is not interrupted (mixWithOthers): a pharmacy counter phone
// on silent should stay silent.

import { requireOptionalNativeModule } from "expo";
import type { AudioPlayer } from "expo-audio";

// A Metro asset reference: the bundler turns this into an asset id.
const BEEP_SOURCE: number = require("../assets/sounds/scan-beep.wav");

let playerPromise: Promise<AudioPlayer | null> | null = null;

async function loadPlayer(): Promise<AudioPlayer | null> {
  if (!requireOptionalNativeModule("ExpoAudio")) return null;
  try {
    const audio = await import("expo-audio");
    await audio.setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers" });
    return audio.createAudioPlayer(BEEP_SOURCE);
  } catch {
    return null;
  }
}

/** Fire-and-forget. Never throws and never delays the cart add it follows. */
export function playScanBeep(): void {
  playerPromise ??= loadPlayer();
  void playerPromise.then(async (player) => {
    if (!player) return;
    try {
      await player.seekTo(0);
      player.play();
    } catch {
      // A beep that cannot play is not an error worth showing a seller.
    }
  });
}

/**
 * A confirmed sale. The prototype's checkout plays the very same 800 Hz /
 * 150 ms tone (Checkout.tsx playConfirmationBeep), so it shares the asset and
 * the player — and the same rules: silent mode respected, never throws.
 */
export function playSaleBeep(): void {
  playScanBeep();
}
