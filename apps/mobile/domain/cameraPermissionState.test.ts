import { describe, expect, it } from 'vitest';
import {
  openSettingsErrorMessage,
  requestPermissionErrorMessage,
  resolveCameraPermissionState,
} from './cameraPermissionState';

describe('resolveCameraPermissionState', () => {
  it('returns unavailable on a mount error, even when permission is granted', () => {
    expect(resolveCameraPermissionState({ granted: true, canAskAgain: true }, true)).toBe('unavailable');
  });

  it('returns unavailable on a mount error, even when permission has not resolved yet', () => {
    expect(resolveCameraPermissionState(null, true)).toBe('unavailable');
  });

  it('returns checking when permission has not resolved yet and there is no mount error', () => {
    expect(resolveCameraPermissionState(null, false)).toBe('checking');
  });

  it('returns granted when permission is granted and there is no mount error', () => {
    expect(resolveCameraPermissionState({ granted: true, canAskAgain: false }, false)).toBe('granted');
  });

  it('returns deniable when not granted but the user can be asked again', () => {
    expect(resolveCameraPermissionState({ granted: false, canAskAgain: true }, false)).toBe('deniable');
  });

  it('returns blocked when not granted and the user cannot be asked again', () => {
    expect(resolveCameraPermissionState({ granted: false, canAskAgain: false }, false)).toBe('blocked');
  });
});

describe('requestPermissionErrorMessage', () => {
  it('returns null when the request succeeded', () => {
    expect(requestPermissionErrorMessage(true)).toBeNull();
  });

  it('returns a user-visible message when the request failed', () => {
    expect(requestPermissionErrorMessage(false)).toBe("Couldn't request camera access. Try again.");
  });
});

describe('openSettingsErrorMessage', () => {
  it('returns null when Settings opened successfully', () => {
    expect(openSettingsErrorMessage(true)).toBeNull();
  });

  it('returns a message including the manual fallback path when Settings failed to open', () => {
    const message = openSettingsErrorMessage(false);
    expect(message).toContain("Couldn't open Settings");
    expect(message).toContain('Settings › Apps › Muthoy › Permissions › Camera');
  });
});
