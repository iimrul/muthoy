// @vitest-environment jsdom
//
// Component tests for the scanner modal's permission / error / Settings
// states. React Native's primitives are replaced with minimal DOM stubs
// (below) rather than pulling in a full native test harness — this repo has
// no jest-expo/@testing-library/react-native setup, and the behaviour under
// test here is the component's own conditional rendering, state transitions,
// and handler wiring, none of which depends on native rendering.
//
// native/ScannerCamera and native/scanner are mocked at the module boundary,
// so no expo-camera or ML Kit native module is ever loaded.

import { createElement, useEffect, useImperativeHandle, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CameraPermissionState } from '../../domain/cameraPermissionState';

// --- Test doubles wired into the mocks below -------------------------------

let currentPermissionState: CameraPermissionState = 'granted';
const requestPermissionMock = vi.fn<() => Promise<boolean>>();
const captureAsyncMock = vi.fn<() => Promise<string | null>>();
const openSettingsMock = vi.fn<() => Promise<void>>();
const scanTextMock = vi.fn<(uri: string) => Promise<{ recognizedText: string } | null>>();

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}

// Minimal DOM stand-ins: only the props this component actually relies on are
// forwarded, so React never warns about unknown DOM attributes.
vi.mock('react-native', () => ({
  View: ({ children }: StubProps) => createElement('div', null, children),
  Text: ({ children }: StubProps) => createElement('span', null, children),
  Modal: ({ children }: StubProps) => createElement('div', null, children),
  ActivityIndicator: () => createElement('div', { role: 'progressbar' }),
  Pressable: ({ children, onPress, accessibilityLabel }: StubProps) =>
    createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children),
  Linking: { openSettings: () => openSettingsMock() },
}));

vi.mock('../../native/ScannerCamera', () => ({
  ScannerCamera: ({
    onPermissionStateChange,
    ref,
  }: {
    onPermissionStateChange: (state: CameraPermissionState) => void;
    ref?: React.Ref<unknown>;
  }) => {
    useEffect(() => {
      onPermissionStateChange(currentPermissionState);
    }, [onPermissionStateChange]);
    useImperativeHandle(ref, () => ({
      requestPermission: requestPermissionMock,
      captureAsync: captureAsyncMock,
    }));
    return null;
  },
}));

vi.mock('../../native/scanner', () => ({
  scanText: (uri: string) => scanTextMock(uri),
}));

const { MedicineTextScanner } = await import('./MedicineTextScanner');

function renderScanner(overrides: { onClose?: () => void; onTextRecognized?: (text: string) => void } = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const onTextRecognized = overrides.onTextRecognized ?? vi.fn();
  render(
    createElement(MedicineTextScanner, {
      visible: true,
      mode: 'lookup',
      onClose,
      onTextRecognized,
    }),
  );
  return { onClose, onTextRecognized };
}

beforeEach(() => {
  currentPermissionState = 'granted';
  requestPermissionMock.mockReset().mockResolvedValue(true);
  captureAsyncMock.mockReset().mockResolvedValue('file:///strip.jpg');
  openSettingsMock.mockReset().mockResolvedValue(undefined);
  scanTextMock.mockReset().mockResolvedValue({ recognizedText: 'Napa Extra' });
});

afterEach(() => {
  cleanup();
});

describe('MedicineTextScanner — visibility', () => {
  it('renders nothing when not visible', () => {
    render(
      createElement(MedicineTextScanner, {
        visible: false,
        mode: 'lookup',
        onClose: vi.fn(),
        onTextRecognized: vi.fn(),
      }),
    );
    expect(screen.queryByLabelText('Close scanner')).toBeNull();
  });
});

describe('MedicineTextScanner — deniable permission', () => {
  beforeEach(() => {
    currentPermissionState = 'deniable';
  });

  it('offers a Grant access button that requests permission', async () => {
    renderScanner();
    fireEvent.click(await screen.findByLabelText('Grant camera access'));
    await waitFor(() => expect(requestPermissionMock).toHaveBeenCalledTimes(1));
  });

  it('shows a visible error when the permission request itself fails', async () => {
    requestPermissionMock.mockResolvedValue(false);
    renderScanner();
    fireEvent.click(await screen.findByLabelText('Grant camera access'));
    expect(await screen.findByText("Couldn't request camera access. Try again.")).toBeTruthy();
  });

  it('clears a previous request error when retried successfully', async () => {
    requestPermissionMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderScanner();
    const button = await screen.findByLabelText('Grant camera access');

    fireEvent.click(button);
    expect(await screen.findByText("Couldn't request camera access. Try again.")).toBeTruthy();

    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByText("Couldn't request camera access. Try again.")).toBeNull());
  });
});

describe('MedicineTextScanner — blocked permission and Settings', () => {
  beforeEach(() => {
    currentPermissionState = 'blocked';
  });

  it('offers an Open Settings button that opens Settings', async () => {
    renderScanner();
    fireEvent.click(await screen.findByLabelText('Open Settings'));
    await waitFor(() => expect(openSettingsMock).toHaveBeenCalledTimes(1));
  });

  it('shows a visible error with a manual fallback path when Settings fails to open', async () => {
    openSettingsMock.mockRejectedValue(new Error('no activity found'));
    renderScanner();
    fireEvent.click(await screen.findByLabelText('Open Settings'));

    const message = await screen.findByText(/Couldn't open Settings/);
    expect(message.textContent).toContain('Settings › Apps › Muthoy › Permissions › Camera');
  });

  it('keeps the Settings button pressable to retry after a failure', async () => {
    openSettingsMock.mockRejectedValueOnce(new Error('no activity found')).mockResolvedValueOnce(undefined);
    renderScanner();
    const button = await screen.findByLabelText('Open Settings');

    fireEvent.click(button);
    expect(await screen.findByText(/Couldn't open Settings/)).toBeTruthy();

    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByText(/Couldn't open Settings/)).toBeNull());
    expect(openSettingsMock).toHaveBeenCalledTimes(2);
  });

  it('still offers the manual-search escape while blocked', async () => {
    const { onClose } = renderScanner();
    fireEvent.click(await screen.findByLabelText('Search manually instead'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('MedicineTextScanner — camera unavailable', () => {
  beforeEach(() => {
    currentPermissionState = 'unavailable';
  });

  it('offers an in-place camera retry rather than a dead end', async () => {
    renderScanner();
    expect(await screen.findByLabelText('Retry camera')).toBeTruthy();
    expect(screen.getByLabelText('Search manually instead')).toBeTruthy();
  });
});

describe('MedicineTextScanner — capture and OCR errors', () => {
  it('shows a retryable error when the capture fails', async () => {
    captureAsyncMock.mockResolvedValue(null);
    renderScanner();
    fireEvent.click(await screen.findByLabelText('Capture photo'));

    expect(await screen.findByText("Couldn't capture the photo. Try again.")).toBeTruthy();
    expect(screen.getByLabelText('Retry scan')).toBeTruthy();
  });

  it('shows a retryable error when no text is detected', async () => {
    scanTextMock.mockResolvedValue(null);
    renderScanner();
    fireEvent.click(await screen.findByLabelText('Capture photo'));

    expect(
      await screen.findByText('No text detected on the strip. Hold it flat and steady, then retry.'),
    ).toBeTruthy();
  });

  it('shows a retryable error when OCR throws', async () => {
    scanTextMock.mockRejectedValue(new Error('mlkit exploded'));
    renderScanner();
    fireEvent.click(await screen.findByLabelText('Capture photo'));

    expect(await screen.findByText("Couldn't read the strip. Try again.")).toBeTruthy();
  });

  it('returns to a capturable state after retrying a failed scan', async () => {
    captureAsyncMock.mockResolvedValueOnce(null);
    renderScanner();
    fireEvent.click(await screen.findByLabelText('Capture photo'));
    fireEvent.click(await screen.findByLabelText('Retry scan'));

    expect(await screen.findByLabelText('Capture photo')).toBeTruthy();
    expect(screen.queryByText("Couldn't capture the photo. Try again.")).toBeNull();
  });

  it('hands recognized text to the caller and closes on success', async () => {
    const { onClose, onTextRecognized } = renderScanner();
    fireEvent.click(await screen.findByLabelText('Capture photo'));

    await waitFor(() => expect(onTextRecognized).toHaveBeenCalledWith('Napa Extra'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
