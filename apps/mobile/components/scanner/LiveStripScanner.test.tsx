// @vitest-environment jsdom
//
// The live strip scanner, driven for real: the real cart store, the real
// matcher (domain/stripMatcher.ts) and the real session state machine
// (domain/stripScanSession.ts). Only the camera, ML Kit and the database are
// doubled. The "camera" keeps reading whatever strip the test is holding in
// front of it, frame after frame, exactly as the phone does.

import { createElement, useEffect, useImperativeHandle, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OcrTextLine, ScanVocabularyEntry } from "../../domain/stripMatcher";

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}

vi.mock("react-native", () => ({
  View: ({ children }: StubProps) => createElement("div", null, children),
  ScrollView: ({ children }: StubProps) => createElement("div", null, children),
  Text: ({ children }: StubProps) => createElement("span", null, children),
  Modal: ({ children }: StubProps) => createElement("div", null, children),
  StatusBar: { currentHeight: 24 },
  Linking: { openSettings: vi.fn() },
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: StubProps) =>
    createElement("button", { onClick: onPress, "aria-label": accessibilityLabel, disabled }, children),
}));

const camera = vi.hoisted(() => ({
  heldStrip: [] as OcrTextLine[],
  frameCount: 0,
  capturedUris: [] as string[],
  isMounted: false,
  barcodeEnabled: false,
  onBarcodeScanned: null as ((result: { data: string; type: string }) => void) | null,
}));

vi.mock("@expo/vector-icons/Feather", () => ({ default: () => null }));

vi.mock("../../native/ScannerCamera", () => ({
  ScannerCamera: ({
    onPermissionStateChange,
    barcodeEnabled,
    onBarcodeScanned,
    ref,
  }: {
    onPermissionStateChange: (state: "granted") => void;
    barcodeEnabled?: boolean;
    onBarcodeScanned?: (result: { data: string; type: string }) => void;
    ref?: React.Ref<unknown>;
  }) => {
    useEffect(() => onPermissionStateChange("granted"), [onPermissionStateChange]);
    useEffect(() => {
      camera.isMounted = true;
      camera.barcodeEnabled = Boolean(barcodeEnabled);
      camera.onBarcodeScanned = onBarcodeScanned ?? null;
      return () => {
        camera.isMounted = false;
      };
    });
    useImperativeHandle(ref, () => ({
      requestPermission: async () => true,
      captureAsync: async () => null,
      captureFrameAsync: async () => {
        camera.frameCount += 1;
        const uri = `file:///frame-${camera.frameCount}.jpg`;
        camera.capturedUris.push(uri);
        return uri;
      },
    }));
    return null;
  },
}));

// The frame-processor camera (native/LiveTextCamera.tsx): off unless a test
// turns it on; when on, the test pushes readings the way the frame worklet does.
const liveText = vi.hoisted(() => ({
  isAvailable: false,
  push: null as ((lines: OcrTextLine[] | null) => void) | null,
}));

vi.mock("../../native/LiveTextCamera", () => ({
  isLiveTextCameraAvailable: () => liveText.isAvailable,
  LiveTextCamera: ({
    onPermissionStateChange,
    onLines,
  }: {
    onPermissionStateChange: (state: "granted") => void;
    onLines: (lines: OcrTextLine[] | null) => void;
  }) => {
    useEffect(() => onPermissionStateChange("granted"), [onPermissionStateChange]);
    useEffect(() => {
      liveText.push = onLines;
    });
    return null;
  },
}));

const deps = vi.hoisted(() => ({
  removeTemporaryCapture: vi.fn(async (_uri: string) => true),
  listScanVocabulary: vi.fn(),
  getActiveBatchForMedicine: vi.fn(),
  playScanBeep: vi.fn(),
}));

vi.mock("../../native/scanSound", () => ({ playScanBeep: () => deps.playScanBeep() }));

vi.mock("../../native/scanner", () => ({
  scanTextLines: async () => camera.heldStrip,
  scanBarcode: (data: string, format: string) => ({ data, format }),
}));
vi.mock("../../native/prescriptionAttachment", () => ({
  removeTemporaryCapture: (uri: string) => deps.removeTemporaryCapture(uri),
}));
vi.mock("../../monitoring", () => ({ reportEvent: vi.fn() }));
vi.mock("../../db/scanVocabulary", () => ({ listScanVocabulary: deps.listScanVocabulary }));
vi.mock("../../db/sales", () => ({ getActiveBatchForMedicine: deps.getActiveBatchForMedicine }));

const { LiveStripScanner } = await import("./LiveStripScanner");
const { useCartStore } = await import("../../state/cartStore");
const { useLocaleStore } = await import("../../state/localeStore");
const { asPaisa } = await import("@muthoy/types");

function medicine(
  medicineId: string,
  name: string,
  fields: Partial<ScanVocabularyEntry> = {},
): ScanVocabularyEntry {
  return {
    medicineId,
    name,
    generic: null,
    manufacturer: null,
    strength: null,
    requiresPrescription: false,
    isSellable: true,
    ...fields,
  };
}

const NAPA = medicine("napa", "Napa", { generic: "Paracetamol", strength: "500mg" });
const NAPA_EXTRA = medicine("napa-extra", "Napa Extra", {
  generic: "Paracetamol + Caffeine",
  strength: "500mg+65mg",
  manufacturer: "Beximco Pharmaceuticals Ltd.",
});
const PROGUT_20 = medicine("progut-20", "Progut MUPS 20", { generic: "Esomeprazole", strength: "20mg" });
const PROGUT_40 = medicine("progut-40", "Progut MUPS 40", { generic: "Esomeprazole", strength: "40mg" });
const FLACOL_SOLD_OUT = medicine("flacol", "Flacol", { strength: "40mg", isSellable: false });
const RX = medicine("rx", "Ceftrion", { strength: "500mg", requiresPrescription: true });

const strip = (...texts: string[]): OcrTextLine[] => texts.map((text) => ({ text, height: 30 }));
const NAPA_EXTRA_STRIP = strip("Napa® Extra", "Paracetamol 500 mg &", "Caffeine 65 mg", "Napa® Extra");
const NOTHING: OcrTextLine[] = [];

function hold(lines: OcrTextLine[]): void {
  camera.heldStrip = lines;
}

/** Lets the camera run for `count` more frames with the current strip held. */
async function waitFrames(count: number): Promise<void> {
  const target = camera.frameCount + count;
  await waitFor(() => expect(camera.frameCount).toBeGreaterThanOrEqual(target), { timeout: 3_000 });
}

function quantityOf(medicineId: string): number {
  return useCartStore.getState().items.find((item) => item.medicineId === medicineId)?.quantity ?? 0;
}

function renderScanner(
  props: { onDone?: () => void; onBarcodeRecognized?: (data: string, format: string) => void } = {},
) {
  const onDone = props.onDone ?? vi.fn();
  render(
    createElement(LiveStripScanner, {
      visible: true,
      shopId: "shop-1",
      userId: "user-1",
      onClose: vi.fn(),
      onDone,
      onBarcodeRecognized: props.onBarcodeRecognized,
      frameIntervalMs: 5,
    }),
  );
  return { onDone };
}

/** One reading from the frame-processor camera, once scanning is ready. */
async function pushReading(lines: OcrTextLine[] | null): Promise<void> {
  await screen.findByText("Hold a medicine strip in front of the camera.");
  await act(async () => {
    liveText.push?.(lines);
  });
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "en" });
  useCartStore.setState({ items: [] });
  liveText.isAvailable = false;
  liveText.push = null;
  hold(NOTHING);
  camera.frameCount = 0;
  camera.capturedUris = [];
  deps.removeTemporaryCapture.mockClear();
  deps.playScanBeep.mockClear();
  deps.listScanVocabulary
    .mockReset()
    .mockResolvedValue([NAPA, NAPA_EXTRA, PROGUT_20, PROGUT_40, FLACOL_SOLD_OUT, RX]);
  deps.getActiveBatchForMedicine.mockReset().mockImplementation(async (_shopId: string, medicineId: string) => ({
    id: `${medicineId}-batch`,
    medicineId,
    expiryDate: "2099-01-01",
    quantityAvailable: 10,
    salePrice: asPaisa(1200),
  }));
});

afterEach(() => cleanup());

describe("a strip in front of the camera goes straight into the cart", () => {
  it("adds Napa Extra — with the batch, price and stock ceiling — and says so", async () => {
    renderScanner();
    hold(NAPA_EXTRA_STRIP);

    await waitFor(() => expect(quantityOf("napa-extra")).toBe(1));
    expect(useCartStore.getState().items[0]).toMatchObject({
      medicineId: "napa-extra",
      medicineName: "Napa Extra",
      generic: "Paracetamol + Caffeine",
      manufacturer: "Beximco Pharmaceuticals Ltd.",
      requiresPrescription: false,
      batchId: "napa-extra-batch",
      expiryDate: "2099-01-01",
      availableQuantity: 10,
      quantity: 1,
      unitPrice: 1200,
    });
    expect(screen.getByText("Added: Napa Extra")).toBeTruthy();
    // The prototype's beep plays for the add.
    expect(deps.playScanBeep).toHaveBeenCalledTimes(1);
    // Never the plain Napa whose name is also printed on the strip.
    expect(quantityOf("napa")).toBe(0);
  });

  it("adds ONE unit — and beeps once — however long the strip is held", async () => {
    renderScanner();
    hold(NAPA_EXTRA_STRIP);
    await waitFor(() => expect(quantityOf("napa-extra")).toBe(1));

    await waitFrames(25);
    expect(quantityOf("napa-extra")).toBe(1);
    expect(deps.playScanBeep).toHaveBeenCalledTimes(1);
  });

  it("adds a second unit when the strip is taken away and brought back", async () => {
    renderScanner();
    hold(NAPA_EXTRA_STRIP);
    await waitFor(() => expect(quantityOf("napa-extra")).toBe(1));

    hold(NOTHING);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    hold(NAPA_EXTRA_STRIP);

    await waitFor(() => expect(quantityOf("napa-extra")).toBe(2), { timeout: 3_000 });
  });

  it("Undo takes the unit back out", async () => {
    renderScanner();
    hold(NAPA_EXTRA_STRIP);
    await waitFor(() => expect(quantityOf("napa-extra")).toBe(1));

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Undo"));
    });

    expect(quantityOf("napa-extra")).toBe(0);
    expect(screen.getByText("Removed from cart")).toBeTruthy();
    // And the strip still in view does not sneak it back in.
    await waitFrames(10);
    expect(quantityOf("napa-extra")).toBe(0);
  });

  it("adds a prescription medicine the same way, and flags it (founder decision 2026-11-20)", async () => {
    renderScanner();
    hold(strip("Ceftrion", "Ceftriaxone 500 mg", "Ceftrion"));

    await waitFor(() => expect(quantityOf("rx")).toBe(1));
    expect(screen.getByText("Requires prescription")).toBeTruthy();
  });
});

describe("what does not go into the cart", () => {
  it("says a strip is not in inventory, and adds nothing", async () => {
    renderScanner();
    hold(strip("Maxpro 20", "Esomeprazole 20 mg", "Renata Limited"));

    expect(await screen.findByText("Not found in inventory", {}, { timeout: 3_000 })).toBeTruthy();
    expect(useCartStore.getState().items).toHaveLength(0);
    expect(deps.playScanBeep).not.toHaveBeenCalled();
  });

  it("says a recognised medicine is out of stock, and adds nothing", async () => {
    renderScanner();
    hold(strip("Flacol", "Simethicone USP 40 mg", "Flacol"));

    expect(await screen.findByText("Out of stock", {}, { timeout: 3_000 })).toBeTruthy();
    expect(useCartStore.getState().items).toHaveLength(0);
    expect(deps.playScanBeep).not.toHaveBeenCalled();
  });

  it("asks which one when the strength cannot be read, and adds the one tapped", async () => {
    renderScanner();
    hold(strip("Progut MUPS", "Esomeprazole"));

    expect(await screen.findByText("Which medicine is this?", {}, { timeout: 3_000 })).toBeTruthy();
    expect(useCartStore.getState().items).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Progut MUPS 20"));
    });

    await waitFor(() => expect(quantityOf("progut-20")).toBe(1));
    expect(quantityOf("progut-40")).toBe(0);
    // The same strip, still in view, does not ask again.
    await waitFrames(10);
    expect(screen.queryByText("Which medicine is this?")).toBeNull();
  });

  it("adds nothing when the seller answers None of these", async () => {
    renderScanner();
    hold(strip("Progut MUPS", "Esomeprazole"));
    await screen.findByText("Which medicine is this?", {}, { timeout: 3_000 });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("None of these"));
    });

    await waitFrames(10);
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it("tells a tablet from a capsule of the same name (founder, 2026-11-27)", async () => {
    const telmi = { generic: "Telmisartan", strength: "20mg" };
    deps.listScanVocabulary.mockReset().mockResolvedValue([
      medicine("telmi-tab", "Telmepress 20", { ...telmi, dosageForm: "tablet" }),
      medicine("telmi-cap", "Telmepress 20", { ...telmi, dosageForm: "capsule" }),
    ]);
    renderScanner();
    // No form printed: asked, each option labelled by its form.
    hold(strip("Telmepress 20", "Telmisartan 20 mg"));
    await screen.findByText("Which medicine is this?", {}, { timeout: 3_000 });
    expect(screen.getByLabelText("Telmepress 20 · Capsule")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Telmepress 20 · Tablet"));
    });
    await waitFor(() => expect(quantityOf("telmi-tab")).toBe(1));
    expect(quantityOf("telmi-cap")).toBe(0);
    // The cart line carries the form and strength the cart shows.
    expect(useCartStore.getState().items[0]).toMatchObject({ dosageForm: "tablet", strength: "20mg" });

    // A capsule strip goes straight in as the capsule.
    hold(NOTHING);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    hold(strip("Telmepress 20", "Telmisartan 20 mg", "Capsule"));
    await waitFor(() => expect(quantityOf("telmi-cap")).toBe(1), { timeout: 3_000 });
    expect(quantityOf("telmi-tab")).toBe(1);
  });

  it("does not start the camera loop when the inventory could not be loaded", async () => {
    deps.listScanVocabulary.mockReset().mockRejectedValue(new Error("db closed"));
    renderScanner();

    expect(await screen.findByText("Couldn't load inventory for scanning.")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(camera.frameCount).toBe(0);
  });
});

describe("frame-processor camera: readings are pushed, no photo is taken", () => {
  it("adds Napa Extra once from pushed readings, without capturing a single frame", async () => {
    liveText.isAvailable = true;
    renderScanner();

    await pushReading(NAPA_EXTRA_STRIP);
    await waitFor(() => expect(quantityOf("napa-extra")).toBe(1));
    expect(screen.getByText("Added: Napa Extra")).toBeTruthy();

    // The same strip, still in view, is not added again.
    await pushReading(NAPA_EXTRA_STRIP);
    await pushReading(NAPA_EXTRA_STRIP);
    expect(quantityOf("napa-extra")).toBe(1);
    expect(deps.playScanBeep).toHaveBeenCalledTimes(1);
    expect(camera.frameCount).toBe(0);
  });

  it("re-adds the strip after it left the view and came back", async () => {
    liveText.isAvailable = true;
    renderScanner();
    await pushReading(NAPA_EXTRA_STRIP);
    await waitFor(() => expect(quantityOf("napa-extra")).toBe(1));

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    try {
      await pushReading(NOTHING);
      vi.setSystemTime(Date.now() + 2_000);
      await pushReading(NOTHING);
      await pushReading(NAPA_EXTRA_STRIP);
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(quantityOf("napa-extra")).toBe(2));
  });

  it("asks which one on an ambiguous strip and ignores readings while the question is open", async () => {
    liveText.isAvailable = true;
    renderScanner();
    const progut = strip("Progut MUPS", "Esomeprazole");

    await pushReading(progut);
    await pushReading(progut);
    expect(await screen.findByText("Which medicine is this?")).toBeTruthy();

    await pushReading(NAPA_EXTRA_STRIP);
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it("says it cannot read after repeated recognition failures", async () => {
    liveText.isAvailable = true;
    renderScanner();
    for (let attempt = 0; attempt < 5; attempt += 1) await pushReading(null);

    expect(await screen.findByText("Can't read right now. Hold the strip steady.")).toBeTruthy();
  });

  it("starts on fast frame OCR even when it can read barcodes, with a Barcode button", async () => {
    liveText.isAvailable = true;
    renderScanner({ onBarcodeRecognized: vi.fn() });

    await pushReading(NAPA_EXTRA_STRIP);
    await waitFor(() => expect(quantityOf("napa-extra")).toBe(1));
    expect(camera.isMounted).toBe(false);
    expect(camera.frameCount).toBe(0);
    expect(screen.getByText("Barcode")).toBeTruthy();
  });

  it("the Barcode button swaps to the barcode reader and Strip swaps back", async () => {
    liveText.isAvailable = true;
    const onBarcodeRecognized = vi.fn();
    renderScanner({ onBarcodeRecognized });
    await screen.findByText("Hold a medicine strip in front of the camera.");

    await act(async () => fireEvent.click(screen.getByText("Barcode")));
    expect(await screen.findByText("Point the camera at the barcode.")).toBeTruthy();
    expect(camera.isMounted).toBe(true);
    expect(camera.barcodeEnabled).toBe(true);
    await act(async () => camera.onBarcodeScanned?.({ data: "8941234567890", type: "ean13" }));
    expect(onBarcodeRecognized).toHaveBeenCalledWith("8941234567890", "ean13");

    // Strip readings are ignored while the barcode reader is on, and no photo loop runs.
    await act(async () => liveText.push?.(NAPA_EXTRA_STRIP));
    expect(useCartStore.getState().items).toHaveLength(0);
    expect(camera.frameCount).toBe(0);

    await act(async () => fireEvent.click(screen.getByText("Strip")));
    expect(camera.isMounted).toBe(false);
    await pushReading(NAPA_EXTRA_STRIP);
    await waitFor(() => expect(quantityOf("napa-extra")).toBe(1));
  });

  it("offers no Barcode button when the scanner does not read barcodes", async () => {
    liveText.isAvailable = true;
    renderScanner();
    await screen.findByText("Hold a medicine strip in front of the camera.");
    expect(screen.queryByText("Barcode")).toBeNull();
  });
});

describe("frames and the cart bar", () => {
  it("deletes every frame it captured", async () => {
    renderScanner();
    hold(NAPA_EXTRA_STRIP);
    await waitFrames(15);
    cleanup();

    await waitFor(() => {
      const deleted = new Set(deps.removeTemporaryCapture.mock.calls.map(([uri]) => uri));
      expect(camera.capturedUris.every((uri) => deleted.has(uri))).toBe(true);
    });
  });

  it("shows the running cart and hands over on Done", async () => {
    const { onDone } = renderScanner();
    expect(screen.getByText("Scan the next medicine")).toBeTruthy();
    hold(NAPA_EXTRA_STRIP);
    await waitFor(() => expect(quantityOf("napa-extra")).toBe(1));

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Done: 1"));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
