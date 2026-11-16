// RELEASE REQUIREMENTS (expected RED until the code changes). Each test
// states a requirement that already exists in the repository's own
// documents, and fails while the current source does not meet it:
//
//   HW-P1  The builders join rows with '\n' — the intended output is one row
//          per paper line. thermalText's allow-list turns 0x0A into '?'.
//   HW-P2  docs/plans/phase-b3-exact-prototype-parity.md PR-11:
//          "... centered footer ..., 3-line feed, cut".
//   HW-P3  IMPLEMENTATION_TASK_MATRIX.md T33: "no automatic second print
//          after uncertain completion".
//
// A green test here is NOT physical acceptance; it only removes a known
// off-device blocker. Do not weaken these to make them pass.
import { beforeEach, describe, expect, it } from "vitest";
import { __resetMMKVStores } from "../../db/test/react-native-mmkv";
import { paperText, renderEscPos } from "./fakes/escpos-paper";
import { fakeBle } from "./fakes/fake-ble-printer";
import { rnControl } from "./fakes/react-native";
import { count, eodSnapshot, LF, monthlySnapshot } from "./support/fixtures";
import { loadTarget, TARGET_ROOT, type EscPosModule, type PrinterModule } from "./support/target";

const escpos = await loadTarget<EscPosModule>("apps/mobile/domain/escpos.ts");
const printer = await loadTarget<PrinterModule>("apps/mobile/native/printer.ts");

const jobs = {
  "test print": () => escpos.buildTestPrint(),
  "end-of-day report": () => escpos.buildEodReportPrint("Synthetic Pharmacy", eodSnapshot()),
  "monthly P&L": () => escpos.buildMonthlyPnlPrint("Synthetic Pharmacy", monthlySnapshot()),
} as const;

describe(`HW-P1 — one row per paper line, nothing left in the buffer at the cut (target ${TARGET_ROOT})`, () => {
  for (const [name, build] of Object.entries(jobs)) {
    it(`${name}: contains LF terminators and the cut arrives at the start of a line`, () => {
      const bytes = build();
      const paper = renderEscPos(bytes, 32);
      expect(count(bytes, LF)).toBeGreaterThan(0);
      expect(paper.cuts[0]?.pendingText).toBe("");
      expect(paper.lines.filter((line) => line.wrapped)).toEqual([]);
    });
  }

  it("test print renders exactly its intended rows", () => {
    expect(paperText(renderEscPos(escpos.buildTestPrint(), 32))).toEqual([
      "           MUTHOY POS",
      "    Printer test successful",
      "  Generic ESC/POS - 32 columns",
      "--------------------------------",
      "",
      "",
    ]);
  });
});

describe("HW-P2 — a 3-line feed precedes the cut (PR-11)", () => {
  it("monthly P&L: at least 3 LF after the last text before GS V (rows.filter(Boolean) removes them)", () => {
    const bytes = escpos.buildMonthlyPnlPrint("Synthetic Pharmacy", monthlySnapshot());
    const cutAt = bytes.length - 4;
    let trailingLf = 0;
    for (let index = cutAt - 1; index >= 0 && bytes[index] === LF; index -= 1) trailingLf += 1;
    expect(trailingLf).toBeGreaterThanOrEqual(3);
  });
});

describe("HW-P3 — no automatic second print after uncertain completion (T33)", () => {
  beforeEach(() => {
    fakeBle.reset();
    rnControl.reset();
    __resetMMKVStores();
  });

  const uncertain = [
    { code: "DISCONNECTED", message: "Printer disconnected" },
    { code: "SEND_FAILED", message: "Printer write failed (133)" },
    { code: "OUT_OF_RANGE", message: "Printer connection timed out" },
  ];
  for (const failure of uncertain) {
    it(`${failure.code} after part of the job reached the printer: surfaced once, never re-sent automatically`, async () => {
      const paired = printer.savePairedPrinter({ id: "00:11:22:AA:BB:CC", name: "Synthetic BLE 58", rssi: -48 });
      fakeBle.printScript.push({ deliverFraction: 0.5, reject: failure }, {});
      const outcome = await printer.printEscPos(escpos.buildTestPrint(), paired).then(() => "resolved", () => "rejected");
      expect(fakeBle.attempts).toHaveLength(1);
      expect(outcome).toBe("rejected");
    });
  }
});
