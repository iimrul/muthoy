// CHARACTERIZATION (expected GREEN): the REAL native/printer.ts and the REAL
// modules/muthoy-ble-printer/src/index.ts bridge, running on a scripted,
// byte-recording fake of the native `MuthoyBlePrinter` module (fakes/expo.ts).
// Native error codes used below are the ones the Kotlin and Swift sources
// actually reject with (MuthoyBlePrinterModule.kt / MuthoyBlePrinterModule.swift).
//
// What this CANNOT show: GATT behaviour, MTU/chunking, pairing UI, real
// permission dialogs, paper sensors. Those are in the hardware procedure.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMMKVStores, createMMKV } from "../../db/test/react-native-mmkv";
import { renderEscPos } from "./fakes/escpos-paper";
import { fakeBle } from "./fakes/fake-ble-printer";
import { PermissionsAndroid, rnControl } from "./fakes/react-native";
import {
  loadTarget, TARGET_PRINTER_HAS_IOS_PATH, TARGET_ROOT, type EscPosModule, type PrinterModule,
} from "./support/target";

const printer = await loadTarget<PrinterModule>("apps/mobile/native/printer.ts");
const escpos = await loadTarget<EscPosModule>("apps/mobile/domain/escpos.ts");
const { BLUETOOTH_SCAN, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION } = PermissionsAndroid.PERMISSIONS;
const ANDROID_PRINTER = { id: "00:11:22:AA:BB:CC", name: "Synthetic BLE 58", rssi: -48 };
const IOS_PRINTER = { id: "79000000-0000-4000-8000-000000000001", name: "Synthetic BLE 58", rssi: -48 };

function headerCount(paper: number[]): number {
  return new TextDecoder().decode(Uint8Array.from(paper)).split("MUTHOY POS").length - 1;
}

beforeEach(() => {
  fakeBle.reset();
  rnControl.reset();
  __resetMMKVStores();
});

describe(`printer transport — happy path (target ${TARGET_ROOT})`, () => {
  it("delivers the builder's exact bytes through base64 to the native module, then marks the printer validated", async () => {
    const paired = printer.savePairedPrinter(ANDROID_PRINTER);
    expect(paired.validatedAt).toBeUndefined();
    const job = escpos.buildTestPrint();
    await printer.printEscPos(job, paired);
    expect(fakeBle.attempts).toHaveLength(1);
    expect(fakeBle.attempts[0]?.deviceId).toBe(ANDROID_PRINTER.id);
    expect(Array.from(fakeBle.attempts[0]?.bytes ?? [])).toEqual(Array.from(job));
    expect(fakeBle.paper).toEqual(Array.from(job));
    expect(printer.getPairedPrinter()?.validatedAt).toEqual(expect.any(String));
  });

  it("'validated' means the transport promise resolved — the fake delivered bytes, nothing proves paper came out", async () => {
    const paired = printer.savePairedPrinter(ANDROID_PRINTER);
    fakeBle.printScript.push({ deliverFraction: 0 }); // resolves, yet nothing reached paper
    await printer.printEscPos(escpos.buildTestPrint(), paired);
    expect(fakeBle.paper).toHaveLength(0);
    expect(printer.getPairedPrinter()?.validatedAt).toEqual(expect.any(String));
  });

  it("uses the persisted printer when none is passed; removed or corrupt records read as 'no printer'", async () => {
    printer.savePairedPrinter(ANDROID_PRINTER);
    await printer.printEscPos(Uint8Array.of(0x1b, 0x40));
    expect(fakeBle.attempts[0]?.deviceId).toBe(ANDROID_PRINTER.id);
    printer.removePairedPrinter();
    await expect(printer.printEscPos(Uint8Array.of(0x1b, 0x40))).rejects.toMatchObject({ code: "no-device" });
    createMMKV({ id: "muthoy-printer" }).set("paired-printer", "{not json");
    expect(printer.getPairedPrinter()).toBeNull();
    createMMKV({ id: "muthoy-printer" }).set("paired-printer", JSON.stringify({ id: "00:11:22:AA:BB:CC" }));
    expect(printer.getPairedPrinter()).toBeNull();
    expect(fakeBle.attempts).toHaveLength(1);
  });
});

describe("Android runtime permissions", () => {
  it("API 31+: requests BLUETOOTH_SCAN + BLUETOOTH_CONNECT before printing (never location)", async () => {
    rnControl.setPlatform("android", 31);
    await printer.printEscPos(Uint8Array.of(0x0a), printer.savePairedPrinter(ANDROID_PRINTER));
    expect(rnControl.requests).toEqual([[BLUETOOTH_SCAN, BLUETOOTH_CONNECT]]);
  });

  it("API 30 and below: requests ACCESS_FINE_LOCATION only (BLUETOOTH/BLUETOOTH_ADMIN are manifest-only, see report)", async () => {
    rnControl.setPlatform("android", 30);
    fakeBle.scanScript.push({ devices: [] });
    await printer.scanBlePrinters();
    expect(rnControl.requests).toEqual([[ACCESS_FINE_LOCATION]]);
  });

  it("a denied CONNECT stops before the native module and leaves the printer unvalidated", async () => {
    const paired = printer.savePairedPrinter(ANDROID_PRINTER);
    rnControl.answer(BLUETOOTH_CONNECT, "denied");
    await expect(printer.printEscPos(escpos.buildTestPrint(), paired)).rejects.toMatchObject({ code: "permission-denied" });
    expect(fakeBle.attempts).toHaveLength(0);
    expect(printer.getPairedPrinter()?.validatedAt).toBeUndefined();
  });

  it("'never ask again' and a plain denial surface as the SAME code (no Settings hand-off is possible)", async () => {
    const paired = printer.savePairedPrinter(ANDROID_PRINTER);
    rnControl.answer(BLUETOOTH_SCAN, "never_ask_again");
    const blocked = await printer.printEscPos(Uint8Array.of(1), paired).catch((error: unknown) => error);
    rnControl.answer(BLUETOOTH_SCAN, "denied");
    const denied = await printer.printEscPos(Uint8Array.of(1), paired).catch((error: unknown) => error);
    expect(blocked).toMatchObject({ code: "permission-denied" });
    expect(denied).toMatchObject({ code: "permission-denied" });
  });
});

describe("failure paths without automatic resend", () => {
  it("disconnect mid-print: preserves one partial copy and surfaces the uncertainty", async () => {
    const paired = printer.savePairedPrinter(ANDROID_PRINTER);
    fakeBle.printScript.push({ deliverFraction: 0.6, reject: { code: "DISCONNECTED", message: "Printer disconnected" } }, {});
    await expect(printer.printEscPos(escpos.buildTestPrint(), paired)).rejects.toMatchObject({ code: "disconnected" });
    expect(fakeBle.attempts).toHaveLength(1);
    expect(headerCount(fakeBle.paper)).toBe(1);
    expect(printer.getPairedPrinter()?.validatedAt).toBeUndefined();
  });

  it("Android timeout after partial output is reported once without another copy", async () => {
    const paired = printer.savePairedPrinter(ANDROID_PRINTER);
    const timeout = { code: "OUT_OF_RANGE", message: "Printer connection timed out" };
    fakeBle.printScript.push({ deliverFraction: 0.7, reject: timeout }, { deliverFraction: 0.7, reject: timeout });
    await expect(printer.printEscPos(escpos.buildTestPrint(), paired)).rejects.toMatchObject({ code: "out-of-range" });
    expect(fakeBle.attempts).toHaveLength(1);
    expect(headerCount(fakeBle.paper)).toBe(1);
    expect(printer.getPairedPrinter()?.validatedAt).toBeUndefined();
  });

  it("SEND_FAILED is surfaced after exactly one attempt", async () => {
    const paired = printer.savePairedPrinter(ANDROID_PRINTER);
    const failed = { code: "SEND_FAILED", message: "Printer rejected data" };
    fakeBle.printScript.push({ deliverFraction: 0.3, reject: failed }, { deliverFraction: 0.3, reject: failed });
    await expect(printer.printEscPos(escpos.buildTestPrint(), paired)).rejects.toMatchObject({ code: "send-failed" });
    expect(fakeBle.attempts).toHaveLength(1);
  });

  it("UNSUPPORTED (no writable characteristic) is not retried", async () => {
    const paired = printer.savePairedPrinter(ANDROID_PRINTER);
    fakeBle.printScript.push({ deliverFraction: 0, reject: { code: "UNSUPPORTED", message: "No writable BLE characteristic" } });
    await expect(printer.printEscPos(Uint8Array.of(1), paired)).rejects.toMatchObject({ code: "unsupported" });
    expect(fakeBle.attempts).toHaveLength(1);
  });

  it("Android Bluetooth-off is reported as out-of-range without retry", async () => {
    const paired = printer.savePairedPrinter(ANDROID_PRINTER);
    const off = { code: "CONNECTION_FAILED", message: "Bluetooth is turned off" };
    fakeBle.printScript.push({ deliverFraction: 0, reject: off }, { deliverFraction: 0, reject: off });
    const error = await printer.printEscPos(Uint8Array.of(1), paired).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "out-of-range", message: "Bluetooth is turned off" });
    expect(fakeBle.attempts).toHaveLength(1);
  });

  it("there is no paper-status path: OUT_OF_PAPER (not emitted by either native module) maps to unknown, no retry", async () => {
    const paired = printer.savePairedPrinter(ANDROID_PRINTER);
    fakeBle.printScript.push({ reject: { code: "OUT_OF_PAPER", message: "synthetic" } });
    await expect(printer.printEscPos(Uint8Array.of(1), paired)).rejects.toMatchObject({ code: "unknown" });
    expect(fakeBle.attempts).toHaveLength(1);
  });

  it("iOS-only native codes BUSY and CANCELLED map to unknown", async () => {
    const paired = printer.savePairedPrinter(ANDROID_PRINTER);
    for (const code of ["BUSY", "CANCELLED"]) {
      fakeBle.printScript.push({ reject: { code, message: code } });
      await expect(printer.printEscPos(Uint8Array.of(1), paired)).rejects.toMatchObject({ code: "unknown" });
    }
  });

  it("two overlapping print calls both reach the native module (no JS-side serialisation)", async () => {
    const paired = printer.savePairedPrinter(ANDROID_PRINTER);
    await Promise.all([printer.printEscPos(Uint8Array.of(1), paired), printer.printEscPos(Uint8Array.of(2), paired)]);
    expect(fakeBle.maxConcurrent).toBe(2);
  });
});

describe("scan", () => {
  it("passes a 5000 ms window and returns every advertised device unfiltered, including non-printers", async () => {
    const devices = [
      { id: "00:11:22:33:44:55", name: "BLE Printer", rssi: -60 }, // Kotlin's default label for an unnamed device
      { id: "66:77:88:99:AA:BB", name: "Synthetic Earbuds", rssi: -40 },
    ];
    fakeBle.scanScript.push({ devices });
    expect(await printer.scanBlePrinters()).toEqual(devices);
    expect(fakeBle.scanCalls).toEqual([5000]);
  });

  it("every Android scan failure (permission, Bluetooth off, scan error) arrives as SCAN_FAILED and maps to unknown", async () => {
    for (const message of ["Bluetooth permission denied", "Bluetooth is turned off", "Bluetooth scan failed (2)"]) {
      fakeBle.scanScript.push({ reject: { code: "SCAN_FAILED", message } });
      await expect(printer.scanBlePrinters()).rejects.toMatchObject({ code: "unknown", message });
    }
  });

  it("an empty scan resolves [] (the screen then shows 'No BLE printers found')", async () => {
    fakeBle.scanScript.push({ devices: [] });
    expect(await printer.scanBlePrinters()).toEqual([]);
  });
});

describe("native module missing (build without the module linked)", () => {
  it("print and scan fail as 'unknown' with the loader's message", async () => {
    vi.resetModules();
    fakeBle.moduleMissing = true;
    const fresh = await loadTarget<PrinterModule>("apps/mobile/native/printer.ts");
    const paired = fresh.savePairedPrinter(ANDROID_PRINTER);
    await expect(fresh.printEscPos(Uint8Array.of(1), paired)).rejects.toMatchObject({
      code: "unknown", message: "Cannot find native module 'MuthoyBlePrinter'",
    });
    await expect(fresh.scanBlePrinters()).rejects.toMatchObject({ code: "unknown" });
    expect(fakeBle.attempts).toHaveLength(0);
  });
});

describe("platform gate", () => {
  it("web is refused before the native module", async () => {
    rnControl.setPlatform("web", 0);
    await expect(printer.scanBlePrinters()).rejects.toMatchObject({ code: "unsupported" });
    expect(fakeBle.scanCalls).toHaveLength(0);
  });

  it.runIf(TARGET_PRINTER_HAS_IOS_PATH)("[uncommitted working tree] iOS skips Android permissions and prints", async () => {
    rnControl.setPlatform("ios", 17);
    await printer.printEscPos(Uint8Array.of(0x1b, 0x40, 0x0a), printer.savePairedPrinter(IOS_PRINTER));
    expect(rnControl.requests).toHaveLength(0);
    expect(fakeBle.attempts).toHaveLength(1);
  });

  it.runIf(!TARGET_PRINTER_HAS_IOS_PATH)("[a23ca61 baseline] iOS is refused as unsupported", async () => {
    rnControl.setPlatform("ios", 17);
    await expect(printer.printEscPos(Uint8Array.of(1), printer.savePairedPrinter(IOS_PRINTER))).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(fakeBle.attempts).toHaveLength(0);
  });
});

describe("paper model sanity for the fake roll", () => {
  it("a successful test print leaves exactly one cut with no pending text", async () => {
    await printer.printEscPos(escpos.buildTestPrint(), printer.savePairedPrinter(ANDROID_PRINTER));
    const paper = renderEscPos(fakeBle.paper);
    expect(paper.cuts).toHaveLength(1);
    expect(paper.cuts[0]?.pendingText).toBe("");
  });
});

describe.each(TARGET_PRINTER_HAS_IOS_PATH ? ['android', 'ios'] : ['android'])("uncertain delivery on %s", (platform) => {
  it.each(['DISCONNECTED', 'SEND_FAILED', 'OUT_OF_RANGE'])("%s after FULL delivery never sends a duplicate; explicit retry remains possible", async (code) => {
    rnControl.setPlatform(platform, platform === 'ios' ? 17 : 35);
    const paired = printer.savePairedPrinter(platform === 'ios' ? IOS_PRINTER : ANDROID_PRINTER);
    const job = escpos.buildTestPrint();
    fakeBle.printScript.push({ deliverFraction: 1, reject: { code, message: 'uncertain completion' } }, {});
    await expect(printer.printEscPos(job, paired)).rejects.toThrow('uncertain completion');
    expect(fakeBle.attempts).toHaveLength(1);
    expect(fakeBle.paper).toEqual(Array.from(job));
    expect(printer.getPairedPrinter()?.validatedAt).toBeUndefined();
    await printer.printEscPos(job, paired);
    expect(fakeBle.attempts).toHaveLength(2);
    expect(printer.getPairedPrinter()?.validatedAt).toEqual(expect.any(String));
  });
});
