// CHARACTERIZATION (expected GREEN): the pure OCR post-processing that runs
// AFTER ML Kit returns text. Inputs are synthetic strings shaped like what a
// recogniser might return; medicine and company names are invented. The
// recogniser itself (ML Kit, on-device, Latin script) cannot run off-device,
// so nothing here says anything about recognition accuracy.
import { describe, expect, it } from "vitest";
import { asPaisa } from "@muthoy/types";
import {
  loadTarget, TARGET_ROOT, type CameraPermissionModule, type MedicineMatchModule, type OcrDateModule,
  type OcrTextModule, type PrescriptionModule,
} from "./support/target";
import type { PrescriptionLookupResult } from "../../domain/prescriptionLines";

const ocr = await loadTarget<OcrTextModule>("apps/mobile/domain/ocrText.ts");
const dates = await loadTarget<OcrDateModule>("apps/mobile/domain/ocrDateNormalizer.ts");
const rx = await loadTarget<PrescriptionModule>("apps/mobile/domain/prescriptionLines.ts");
const fuzzy = await loadTarget<MedicineMatchModule>("apps/mobile/domain/medicineMatch.ts");
const camera = await loadTarget<CameraPermissionModule>("apps/mobile/domain/cameraPermissionState.ts");

const STRIP = ["ZENTRAFEN 500", "Paracetamol BP 500 mg", "B.No: NX2411", "MFG: 01/2025 EXP: 12/2027", "MRP Tk 12.00"].join("\n");

describe(`medicine strip extraction (target ${TARGET_ROOT})`, () => {
  it("extracts name, batch and expiry from a well-labelled synthetic strip", () => {
    expect(ocr.parseScannedMedicineStrip(STRIP)).toEqual({ name: "ZENTRAFEN 500", batchNo: "NX2411", expiryDate: "2027-12-31" });
  });

  it.each([
    ["EXP: 12/2027", "2027-12-31"],
    ["EXP:12/27", "2027-12-31"],
    ["Expiry Date: 31.12.2027", "2027-12-31"],
    ["EXP 03/04/2027", "2027-04-03"], // day-first, never US month-first
    ["EXP 2027-06-30", "2027-06-30"],
    ["EXP 12/99", "2099-12-31"], // two-digit years are always 20YY
    ["EXP 31/02/2027", null], // calendar-invalid -> null, never rolled over
    ["Exp. 12/2027", null], // GAP: a dot after EXP defeats the label pattern
    ["EXP DEC 2027", null], // GAP: month names unsupported
    ["EXP 2027-12", null], // GAP: year-month ISO unsupported
    ["12/2027", null], // unlabelled dates are never guessed (by design)
  ])("expiry %j -> %j", (line, expected) => {
    expect(ocr.parseScannedMedicineStrip(`ZENTRAFEN 500\n${line}`).expiryDate).toBe(expected);
  });

  it("MFG and EXP on one line: the EXP date wins and the line is never taken as the name", () => {
    expect(ocr.parseScannedMedicineStrip("MFG 01/2025 EXP 06/2026\nCALVOXIN 250")).toEqual({
      name: "CALVOXIN 250", batchNo: null, expiryDate: "2026-06-30",
    });
  });

  it("GAP: Bangla text and Bangla digits yield nothing (Latin-only name test, ASCII-digit-only dates)", () => {
    expect(ocr.parseScannedMedicineStrip("জেনট্রাফেন ৫০০\nমেয়াদ: ১২/২০২৭\nব্যাচ: ১২৩")).toEqual({
      name: null, batchNo: null, expiryDate: null,
    });
    expect(ocr.parseScannedMedicineStrip("জেনট্রাফেন ৫০০\nZENTRAFEN 500").name).toBe("ZENTRAFEN 500");
  });

  it("GAP: 'Lot'/'Batch' inside an ordinary word is read as a batch label ('Lotion' -> batch 'ion')", () => {
    expect(ocr.extractBatchNoCandidate("Calamine Lotion 100ml")).toBe("ion");
    expect(ocr.extractBatchNoCandidate("Batches 4")).toBe("es");
    expect(ocr.extractBatchNoCandidate("Lot No: L-7781")).toBe("L-7781");
    expect(ocr.extractBatchNoCandidate("B No. AB12/34")).toBe("AB12/34");
  });

  it("GAP: the first Latin line wins, so a manufacturer or price line can become the name candidate", () => {
    expect(ocr.extractMedicineNameCandidate("Orbitex Pharmaceuticals Ltd.\nZENTRAFEN 500")).toBe("Orbitex Pharmaceuticals Ltd.");
    expect(ocr.extractMedicineNameCandidate("Tk 45.00\nZENTRAFEN 500")).toBe("Tk 45.00");
    expect(ocr.extractMedicineNameCandidate("MRP Tk 45.00\nZENTRAFEN 500")).toBe("ZENTRAFEN 500");
  });

  it("noise without letters is never a name; empty input is all-null", () => {
    expect(ocr.extractMedicineNameCandidate("###\n...\n12345")).toBeNull();
    expect(ocr.parseScannedMedicineStrip("   ")).toEqual({ name: null, batchNo: null, expiryDate: null });
  });
});

describe("date normaliser directly", () => {
  it.each([
    ["02/2028", "2028-02-29"], ["02/2027", "2027-02-28"], ["13/2027", null], ["00/2027", null],
    ["29/02/2027", null], ["29/02/2028", "2028-02-29"], ["1/1/2027", "2027-01-01"], ["2027-13-01", null],
  ])("%j -> %j", (input, expected) => {
    expect(dates.normalizeScannedExpiryDate(input)).toBe(expected);
  });
});

describe("invoice packet splitting (purchase-create OCR source)", () => {
  const items = [
    "ZENTRAFEN 500\nBatch: ZF-1001\nEXP: 11/2027",
    "CALVOXIN 250\nLot: CV77\nQty 10 x 45.00",
    "DERMOLAX CREAM",
  ];

  it("blank-line-separated blocks become one candidate each, scored by fields found (100/67/33)", () => {
    const candidates = ocr.parseScannedInvoiceLines(items.join("\n\n"));
    expect(candidates.map(({ name, batchNo, expiryDate, confidence }) => ({ name, batchNo, expiryDate, confidence }))).toEqual([
      { name: "ZENTRAFEN 500", batchNo: "ZF-1001", expiryDate: "2027-11-30", confidence: 100 },
      { name: "CALVOXIN 250", batchNo: "CV77", expiryDate: null, confidence: 67 },
      { name: "DERMOLAX CREAM", batchNo: null, expiryDate: null, confidence: 33 },
    ]);
  });

  it("RISK: the same three items joined by single newlines collapse into ONE candidate (items 2-3 lost as lines)", () => {
    const candidates = ocr.parseScannedInvoiceLines(items.join("\n"));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ name: "ZENTRAFEN 500", batchNo: "ZF-1001", expiryDate: "2027-11-30" });
  });

  it("an invoice header block is offered as a medicine candidate (it is shown for review, never committed)", () => {
    const candidates = ocr.parseScannedInvoiceLines("INVOICE NO: 4471\nDate: 10/11/2026\n\nZENTRAFEN 500\nEXP 12/2027");
    expect(candidates[0]).toMatchObject({ name: "INVOICE NO: 4471", confidence: 33 });
    expect(candidates).toHaveLength(2);
  });

  it("quantity and price are never extracted", () => {
    const [candidate] = ocr.parseScannedInvoiceLines("CALVOXIN 250\nQty 10 x 45.00 = 450.00");
    expect(Object.keys(candidate ?? {}).sort()).toEqual(["batchNo", "confidence", "expiryDate", "name", "rawText"]);
  });

  it("whitespace-only text gives no candidates (screen shows 'could not read lines')", () => {
    expect(ocr.parseScannedInvoiceLines(" \n \n ")).toEqual([]);
  });
});

describe("exact-match rule used by the sale scan and prescription review", () => {
  const one = [{ name: "Zentrafen  500" }];
  it("case/space-insensitive identity matches; a prefix or two results never does", () => {
    expect(ocr.findExactNameMatch("zentrafen 500", one)).toEqual(one[0]);
    expect(ocr.findExactNameMatch("Zentrafen", [{ name: "Zentrafen Plus" }])).toBeNull();
    expect(ocr.findExactNameMatch("Zentrafen 500", [{ name: "Zentrafen 500" }, { name: "Zentrafen 500 " }])).toBeNull();
    expect(ocr.findExactNameMatch("Zentrafen 500", [])).toBeNull();
  });
});

describe("prescription review lines (checkout captureOnly path)", () => {
  const inventory: PrescriptionLookupResult[] = [
    { medicineId: "m-1", name: "ZENTRAFEN 500", activeBatch: { id: "b-1", expiryDate: "2027-12-31", salePrice: asPaisa(1_200), quantityAvailable: 30 }, activeBatchNo: "ZF-1" },
    { medicineId: "m-2", name: "CALVOXIN 250", activeBatch: { id: "b-2", expiryDate: "2027-06-30", salePrice: asPaisa(4_500), quantityAvailable: 4 }, activeBatchNo: null },
  ];
  function lookupRecorder() {
    const calls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const lookup = async (name: string): Promise<PrescriptionLookupResult[]> => {
      calls.push(name);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      // Prefix search, the shape searchMedicinesForSale's FTS prefix query returns.
      return inventory.filter((row) => row.name.toLowerCase().startsWith(name.toLowerCase()));
    };
    return { lookup, calls, max: () => maxInFlight };
  }

  it("matches exact lines, keeps unmatched Latin lines, adds nothing, and looks up one line at a time", async () => {
    const recorder = lookupRecorder();
    const lines = await rx.buildPrescriptionLines("ZENTRAFEN 500\n1+0+1   x 5 days\n\nCALVOXIN\n\nNOVAMED 10", recorder.lookup);
    expect(lines.map(({ id, rawText, match, isAdded }) => ({ id, rawText, matched: match?.medicineId ?? null, isAdded }))).toEqual([
      { id: "rx-0", rawText: "ZENTRAFEN 500 1+0+1 x 5 days", matched: "m-1", isAdded: false },
      { id: "rx-1", rawText: "CALVOXIN", matched: null, isAdded: false }, // prefix-only hit is not a match
      { id: "rx-2", rawText: "NOVAMED 10", matched: null, isAdded: false },
    ]);
    expect(lines[0]?.match).toMatchObject({ batchId: "b-1", unitPrice: 1_200, availableQuantity: 30 });
    expect(recorder.calls).toEqual(["ZENTRAFEN 500", "CALVOXIN", "NOVAMED 10"]);
    expect(recorder.max()).toBe(1);
  });

  it("GAP: a line with no extractable field (Bangla-only, or digits-only) is DROPPED, not kept for review", async () => {
    const recorder = lookupRecorder();
    const lines = await rx.buildPrescriptionLines("ZENTRAFEN 500\n\nপ্যারাসিটামল ৫০০\n\n500 1+0+1", recorder.lookup);
    expect(lines.map((line) => line.rawText)).toEqual(["ZENTRAFEN 500"]);
    expect(recorder.calls).toEqual(["ZENTRAFEN 500"]);
  });
});

describe("fuzzy picker (purchase review, human-confirmed)", () => {
  const catalog = [
    { medicineId: "m-1", name: "ZENTRAFEN 500" },
    { medicineId: "m-2", name: "ZENTRAFEN PLUS" },
    { medicineId: "m-3", name: "CALVOXIN 250" },
    { medicineId: "m-4", name: "DERMOLAX CREAM" },
  ];
  it("ranks a typical OCR misread (O for 0) first and caps the list at three", () => {
    const matches = fuzzy.fuzzyMatchMedicines("ZENTRAFEN 5OO", catalog);
    expect(matches[0]?.medicine.medicineId).toBe("m-1");
    expect(matches[0]?.score).toBe(85);
    expect(matches.length).toBeLessThanOrEqual(3);
    expect(matches.every((match) => match.score >= 40)).toBe(true);
  });
  it("a Bangla candidate never matches a Latin catalogue (no cross-script fold here)", () => {
    expect(fuzzy.fuzzyMatchMedicines("জেনট্রাফেন ৫০০", catalog)).toEqual([]);
  });
});

describe("camera permission state machine", () => {
  it.each([
    [null, false, "checking"], [{ granted: true, canAskAgain: true }, false, "granted"],
    [{ granted: false, canAskAgain: true }, false, "deniable"], [{ granted: false, canAskAgain: false }, false, "blocked"],
    [{ granted: true, canAskAgain: true }, true, "unavailable"],
  ] as const)("%j mountError=%s -> %s", (permission, mountError, expected) => {
    expect(camera.resolveCameraPermissionState(permission, mountError)).toBe(expected);
  });

  it("LOW: the request-failed and Settings-failed messages are hard-coded English (shown raw in a Bangla UI)", () => {
    expect(camera.requestPermissionErrorMessage(false)).toBe("Couldn't request camera access. Try again.");
    expect(camera.openSettingsErrorMessage(false)).toMatch(/^Couldn't open Settings\./);
    expect(camera.requestPermissionErrorMessage(true)).toBeNull();
  });
});
