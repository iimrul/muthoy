// Node stand-in for expo-clipboard, aliased in vitest.config.ts like
// db/test/expo-device.ts. The real package reaches expo-modules-core's
// EventEmitter at import time, which fails any suite that renders OtpInput or
// the sync failure sheet. This double is an in-memory clipboard: tests seed it
// with setClipboardTestText and read what the app copied with getStringAsync.

let clipboardText = '';

export function setClipboardTestText(text: string): void {
  clipboardText = text;
}

export async function getStringAsync(): Promise<string> {
  return clipboardText;
}

export async function setStringAsync(text: string): Promise<boolean> {
  clipboardText = text;
  return true;
}
