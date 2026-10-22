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

import {
  createElement,
  useEffect,
  useImperativeHandle,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { CameraPermissionState } from "../../domain/cameraPermissionState";

// --- Test doubles wired into the mocks below -------------------------------

let currentPermissionState: CameraPermissionState = "granted";
const requestPermissionMock = vi.fn<() => Promise<boolean>>();
const captureAsyncMock = vi.fn<() => Promise<string | null>>();
const openSettingsMock = vi.fn<() => Promise<void>>();
const scanTextMock =
  vi.fn<(uri: string) => Promise<{ recognizedText: string } | null>>();
// W2-01: the scanner now owns its temporary capture on the OCR path.
const removeTemporaryCaptureMock = vi.fn<(uri: string) => Promise<boolean>>();
const reportEventMock = vi.fn<(event: string) => void>();

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}

// Minimal DOM stand-ins: only the props this component actually relies on are
// forwarded, so React never warns about unknown DOM attributes.
vi.mock("react-native", () => ({
  View: ({ children }: StubProps) => createElement("div", null, children),
  Text: ({ children }: StubProps) => createElement("span", null, children),
  Modal: ({ children }: StubProps) => createElement("div", null, children),
  ActivityIndicator: () => createElement("div", { role: "progressbar" }),
  Pressable: ({ children, onPress, accessibilityLabel }: StubProps) =>
    createElement(
      "button",
      { onClick: onPress, "aria-label": accessibilityLabel },
      children,
    ),
  Linking: { openSettings: () => openSettingsMock() },
}));

vi.mock("../../native/ScannerCamera", () => ({
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

vi.mock("../../native/scanner", () => ({
  scanText: (uri: string) => scanTextMock(uri),
}));

vi.mock("../../native/prescriptionAttachment", () => ({
  removeTemporaryCapture: (uri: string) => removeTemporaryCaptureMock(uri),
}));

// Mocked rather than exercised: monitoring/sink.ts opens MMKV at module scope,
// and what matters here is only that a cleanup failure is reported instead of
// being shown to the user as a scan error.
vi.mock("../../monitoring", () => ({
  reportEvent: (event: string) => reportEventMock(event),
}));

const { MedicineTextScanner } = await import("./MedicineTextScanner");
const { useLocaleStore } = await import("../../state/localeStore");

function renderScanner(
  overrides: {
    onClose?: () => void;
    onTextRecognized?: (text: string) => void;
    captureOnly?: boolean;
    onImageCaptured?: (uri: string) => void;
    onCaptureRecognition?: (text: string | null) => void;
  } = {},
) {
  const onClose = overrides.onClose ?? vi.fn();
  const onTextRecognized = overrides.onTextRecognized ?? vi.fn();
  const onImageCaptured = overrides.onImageCaptured ?? vi.fn();
  render(
    createElement(MedicineTextScanner, {
      visible: true,
      mode: "lookup",
      onClose,
      onTextRecognized,
      ...(overrides.captureOnly ? { captureOnly: true, onImageCaptured } : {}),
      ...(overrides.onCaptureRecognition
        ? { onCaptureRecognition: overrides.onCaptureRecognition }
        : {}),
    }),
  );
  return { onClose, onTextRecognized, onImageCaptured };
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "en" });
  currentPermissionState = "granted";
  requestPermissionMock.mockReset().mockResolvedValue(true);
  captureAsyncMock.mockReset().mockResolvedValue("file:///strip.jpg");
  openSettingsMock.mockReset().mockResolvedValue(undefined);
  scanTextMock.mockReset().mockResolvedValue({ recognizedText: "Napa Extra" });
  removeTemporaryCaptureMock.mockReset().mockResolvedValue(true);
  reportEventMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("MedicineTextScanner — visibility", () => {
  it("renders nothing when not visible", () => {
    render(
      createElement(MedicineTextScanner, {
        visible: false,
        mode: "lookup",
        onClose: vi.fn(),
        onTextRecognized: vi.fn(),
      }),
    );
    expect(screen.queryByLabelText("Close scanner")).toBeNull();
  });
});

describe("MedicineTextScanner — deniable permission", () => {
  beforeEach(() => {
    currentPermissionState = "deniable";
  });

  it("offers a Grant access button that requests permission", async () => {
    renderScanner();
    fireEvent.click(await screen.findByLabelText("Grant camera access"));
    await waitFor(() => expect(requestPermissionMock).toHaveBeenCalledTimes(1));
  });

  it("shows a visible error when the permission request itself fails", async () => {
    requestPermissionMock.mockResolvedValue(false);
    renderScanner();
    fireEvent.click(await screen.findByLabelText("Grant camera access"));
    expect(
      await screen.findByText("Couldn't request camera access. Try again."),
    ).toBeTruthy();
  });

  it("clears a previous request error when retried successfully", async () => {
    requestPermissionMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    renderScanner();
    const button = await screen.findByLabelText("Grant camera access");

    fireEvent.click(button);
    expect(
      await screen.findByText("Couldn't request camera access. Try again."),
    ).toBeTruthy();

    fireEvent.click(button);
    await waitFor(() =>
      expect(
        screen.queryByText("Couldn't request camera access. Try again."),
      ).toBeNull(),
    );
  });
});

describe("MedicineTextScanner — blocked permission and Settings", () => {
  beforeEach(() => {
    currentPermissionState = "blocked";
  });

  it("offers an Open Settings button that opens Settings", async () => {
    renderScanner();
    fireEvent.click(await screen.findByLabelText("Open Settings"));
    await waitFor(() => expect(openSettingsMock).toHaveBeenCalledTimes(1));
  });

  it("shows a visible error with a manual fallback path when Settings fails to open", async () => {
    openSettingsMock.mockRejectedValue(new Error("no activity found"));
    renderScanner();
    fireEvent.click(await screen.findByLabelText("Open Settings"));

    const message = await screen.findByText(/Couldn't open Settings/);
    expect(message.textContent).toContain(
      "Settings › Apps › Muthoy › Permissions › Camera",
    );
  });

  it("keeps the Settings button pressable to retry after a failure", async () => {
    openSettingsMock
      .mockRejectedValueOnce(new Error("no activity found"))
      .mockResolvedValueOnce(undefined);
    renderScanner();
    const button = await screen.findByLabelText("Open Settings");

    fireEvent.click(button);
    expect(await screen.findByText(/Couldn't open Settings/)).toBeTruthy();

    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.queryByText(/Couldn't open Settings/)).toBeNull(),
    );
    expect(openSettingsMock).toHaveBeenCalledTimes(2);
  });

  it("still offers the manual-search escape while blocked", async () => {
    const { onClose } = renderScanner();
    fireEvent.click(await screen.findByLabelText("Search manually instead"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("MedicineTextScanner — camera unavailable", () => {
  beforeEach(() => {
    currentPermissionState = "unavailable";
  });

  it("offers an in-place camera retry rather than a dead end", async () => {
    renderScanner();
    expect(await screen.findByLabelText("Retry camera")).toBeTruthy();
    expect(screen.getByLabelText("Search manually instead")).toBeTruthy();
  });
});

describe("MedicineTextScanner — capture and OCR errors", () => {
  it("shows a retryable error when the capture fails", async () => {
    captureAsyncMock.mockResolvedValue(null);
    renderScanner();
    fireEvent.click(await screen.findByLabelText("Capture photo"));

    expect(
      await screen.findByText("Couldn't capture the photo. Try again."),
    ).toBeTruthy();
    expect(screen.getByLabelText("Retry scan")).toBeTruthy();
  });

  it("shows a retryable error when no text is detected", async () => {
    scanTextMock.mockResolvedValue(null);
    renderScanner();
    fireEvent.click(await screen.findByLabelText("Capture photo"));

    expect(
      await screen.findByText(
        "No text detected on the strip. Hold it flat and steady, then retry.",
      ),
    ).toBeTruthy();
  });

  it("shows a retryable error when OCR throws", async () => {
    scanTextMock.mockRejectedValue(new Error("mlkit exploded"));
    renderScanner();
    fireEvent.click(await screen.findByLabelText("Capture photo"));

    expect(
      await screen.findByText("Couldn't read the strip. Try again."),
    ).toBeTruthy();
  });

  it("returns to a capturable state after retrying a failed scan", async () => {
    captureAsyncMock.mockResolvedValueOnce(null);
    renderScanner();
    fireEvent.click(await screen.findByLabelText("Capture photo"));
    fireEvent.click(await screen.findByLabelText("Retry scan"));

    expect(await screen.findByLabelText("Capture photo")).toBeTruthy();
    expect(
      screen.queryByText("Couldn't capture the photo. Try again."),
    ).toBeNull();
  });

  it("hands recognized text to the caller and closes on success", async () => {
    const { onClose, onTextRecognized } = renderScanner();
    fireEvent.click(await screen.findByLabelText("Capture photo"));

    await waitFor(() =>
      expect(onTextRecognized).toHaveBeenCalledWith("Napa Extra"),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ── W2-01 section 6.2.2: the scanner-owned half of the capture leak ────────
//
// Before this, captureAsync() wrote a JPEG of a medicine strip into the cache
// directory and nothing deleted it on any path. The scanner owns that file on
// the OCR path only — there the URI never leaves this component — and must
// never touch it on the captureOnly path, where the image is the artefact the
// caller keeps and may already be a durable held-draft file (gate E9).
describe("MedicineTextScanner — temporary capture cleanup", () => {
  it("deletes the capture after a successful scan", async () => {
    renderScanner();
    fireEvent.click(await screen.findByLabelText("Capture photo"));

    await waitFor(() =>
      expect(removeTemporaryCaptureMock).toHaveBeenCalledWith("file:///strip.jpg"),
    );
  });

  it("deletes the capture when no text is found", async () => {
    scanTextMock.mockResolvedValueOnce(null);
    renderScanner();
    fireEvent.click(await screen.findByLabelText("Capture photo"));

    expect(
      await screen.findByText(
        "No text detected on the strip. Hold it flat and steady, then retry.",
      ),
    ).toBeTruthy();
    expect(removeTemporaryCaptureMock).toHaveBeenCalledWith("file:///strip.jpg");
  });

  it("deletes the capture when recognition throws", async () => {
    scanTextMock.mockRejectedValueOnce(new Error("ml kit unavailable"));
    renderScanner();
    fireEvent.click(await screen.findByLabelText("Capture photo"));

    await waitFor(() =>
      expect(removeTemporaryCaptureMock).toHaveBeenCalledWith("file:///strip.jpg"),
    );
  });

  it("deletes the capture even when the modal is closed mid-processing", async () => {
    let finishScan: ((result: { recognizedText: string }) => void) | undefined;
    scanTextMock.mockImplementationOnce(
      () => new Promise((resolve) => {
        finishScan = resolve;
      }),
    );
    renderScanner();
    fireEvent.click(await screen.findByLabelText("Capture photo"));
    await waitFor(() => expect(scanTextMock).toHaveBeenCalled());

    // The user gives up and closes while OCR is still running.
    fireEvent.click(screen.getByLabelText("Close scanner"));
    expect(removeTemporaryCaptureMock).not.toHaveBeenCalled();

    finishScan?.({ recognizedText: "Napa Extra" });
    await waitFor(() =>
      expect(removeTemporaryCaptureMock).toHaveBeenCalledWith("file:///strip.jpg"),
    );
  });

  it("reports a failed deletion to monitoring without failing the scan", async () => {
    removeTemporaryCaptureMock.mockResolvedValueOnce(false);
    const { onClose, onTextRecognized } = renderScanner();
    fireEvent.click(await screen.findByLabelText("Capture photo"));

    await waitFor(() =>
      expect(reportEventMock).toHaveBeenCalledWith("scan.capture_cleanup.failed"),
    );
    // The scan itself worked, so the user sees a result, not an error.
    expect(onTextRecognized).toHaveBeenCalledWith("Napa Extra");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Couldn't read the strip. Try again.")).toBeNull();
  });

  it("never deletes anything on the captureOnly path", async () => {
    const { onImageCaptured } = renderScanner({ captureOnly: true });
    fireEvent.click(await screen.findByLabelText("Capture photo"));

    await waitFor(() =>
      expect(onImageCaptured).toHaveBeenCalledWith("file:///strip.jpg"),
    );
    // The durable copy does not exist yet, and on a resumed held draft this URI
    // IS the durable file. Deleting it here destroys a real prescription.
    expect(removeTemporaryCaptureMock).not.toHaveBeenCalled();
    expect(reportEventMock).not.toHaveBeenCalled();
  });
});

// ── W2-01 section 6.2.4: recognition on the captureOnly path ──────────────
//
// On the prescription path the camera ran, the image was stored, and the
// image-to-text step never happened at all: the captureOnly branch returned
// before scanText was called. It can now do both — but only when the caller
// asks, and never at the cost of the capture.
describe("MedicineTextScanner — captureOnly recognition", () => {
  it("does not attempt recognition for a captureOnly caller that did not ask", async () => {
    const { onImageCaptured } = renderScanner({ captureOnly: true });
    fireEvent.click(await screen.findByLabelText("Capture photo"));

    await waitFor(() =>
      expect(onImageCaptured).toHaveBeenCalledWith("file:///strip.jpg"),
    );
    // Opt-in by presence: today's single caller keeps today's behaviour until
    // it passes the callback, so no future caller acquires OCR silently.
    expect(scanTextMock).not.toHaveBeenCalled();
  });

  it("hands back the image and then the recognised text", async () => {
    const onImageCaptured = vi.fn();
    const onCaptureRecognition = vi.fn();
    renderScanner({ captureOnly: true, onImageCaptured, onCaptureRecognition });
    fireEvent.click(await screen.findByLabelText("Capture photo"));

    await waitFor(() =>
      expect(onCaptureRecognition).toHaveBeenCalledWith("Napa Extra"),
    );
    // The image is the primary artefact, so it goes back first.
    expect(onImageCaptured).toHaveBeenCalledWith("file:///strip.jpg");
    expect(onImageCaptured.mock.invocationCallOrder[0]!).toBeLessThan(
      onCaptureRecognition.mock.invocationCallOrder[0]!,
    );
  });

  it("still hands back the image when nothing can be read", async () => {
    scanTextMock.mockResolvedValueOnce(null);
    const onCaptureRecognition = vi.fn();
    const { onImageCaptured, onClose } = renderScanner({
      captureOnly: true,
      onCaptureRecognition,
    });
    fireEvent.click(await screen.findByLabelText("Capture photo"));

    await waitFor(() => expect(onCaptureRecognition).toHaveBeenCalledWith(null));
    expect(onImageCaptured).toHaveBeenCalledWith("file:///strip.jpg");
    // Null is an answer, not a failure: no retryable scan error, and the modal
    // closes normally so the sale stays completable.
    expect(screen.queryByText("No text detected on the strip. Hold it flat and steady, then retry.")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("still hands back the image when the reader throws", async () => {
    scanTextMock.mockRejectedValueOnce(new Error("ml kit unavailable"));
    const onCaptureRecognition = vi.fn();
    const { onImageCaptured, onClose } = renderScanner({
      captureOnly: true,
      onCaptureRecognition,
    });
    fireEvent.click(await screen.findByLabelText("Capture photo"));

    await waitFor(() => expect(onCaptureRecognition).toHaveBeenCalledWith(null));
    expect(onImageCaptured).toHaveBeenCalledWith("file:///strip.jpg");
    expect(screen.queryByText("Couldn't read the strip. Try again.")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("never deletes the capture, even once recognition runs on it", async () => {
    const onCaptureRecognition = vi.fn();
    renderScanner({ captureOnly: true, onCaptureRecognition });
    fireEvent.click(await screen.findByLabelText("Capture photo"));

    await waitFor(() => expect(onCaptureRecognition).toHaveBeenCalled());
    // Recognition does not transfer ownership of the file to the scanner: the
    // caller still owns it, and on a resumed held draft it is already durable.
    expect(removeTemporaryCaptureMock).not.toHaveBeenCalled();
  });
});
