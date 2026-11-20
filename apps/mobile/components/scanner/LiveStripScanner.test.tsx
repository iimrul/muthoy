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
}));

vi.mock("../../native/ScannerCamera", () => ({
  ScannerCamera: ({
    onPermissionStateChange,
    ref,
  }: {
    onPermissionStateChange: (state: "granted") => void;
    ref?: React.Ref<unknown>;
  }) => {
    useEffect(() => onPermissionStateChange("granted"), [onPermissionStateChange]);
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

function renderScanner(props: { onDone?: () => void } = {}) {
  const onDone = props.onDone ?? vi.fn();
  render(
    createElement(LiveStripScanner, {
      visible: true,
      shopId: "shop-1",
      userId: "user-1",
      onClose: vi.fn(),
      onDone,
      frameIntervalMs: 5,
    }),
  );
  return { onDone };
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "en" });
  useCartStore.setState({ items: [] });
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

  it("does not start the camera loop when the inventory could not be loaded", async () => {
    deps.listScanVocabulary.mockReset().mockRejectedValue(new Error("db closed"));
    renderScanner();

    expect(await screen.findByText("Couldn't load inventory for scanning.")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(camera.frameCount).toBe(0);
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
