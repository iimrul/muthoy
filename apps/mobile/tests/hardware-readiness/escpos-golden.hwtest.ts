// Approved 2026-11-16: pin repaired row delimiters/feed and unchanged content.
// Independent release requirements remain unchanged in release-requirements.hwtest.ts.
//
// Scope note: the repository has NO sale-receipt builder. The only thermal
// jobs are buildTestPrint, buildEodReportPrint and buildMonthlyPnlPrint.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { asPaisa } from "@muthoy/types";
import { paperText, renderEscPos } from "./fakes/escpos-paper";
import { ascii, count, eodSnapshot, LF, monthlySnapshot } from "./support/fixtures";
import { loadTarget, TARGET_ROOT, type EscPosModule, type ExportModule } from "./support/target";

const escpos = await loadTarget<EscPosModule>("apps/mobile/domain/escpos.ts");
const money = await loadTarget<ExportModule>("apps/mobile/domain/export.ts");
const ESC = 0x1b;
const GS = 0x1d;

describe(`ESC/POS golden bytes — current builders (target ${TARGET_ROOT})`, () => {
  it("test print: exact byte sequence, built independently from the ESC/POS command table", () => {
    const expected = [
      ESC, 0x40, ESC, 0x61, 0x01, ESC, 0x45, 0x01,
      ...ascii("MUTHOY POS\n"),
      ESC, 0x45, 0x00,
      ...ascii("Printer test successful\n"),
      ...ascii("Generic ESC/POS - 32 columns\n"),
      ...ascii(`${"-".repeat(32)}\n\n\n`),
      GS, 0x56, 0x41, 0x03,
    ];
    expect(Array.from(escpos.buildTestPrint())).toEqual(expected);
  });

  it("every builder preserves LF separators while field sanitization rejects injected control bytes", () => {
    const jobs = {
      test: escpos.buildTestPrint(),
      eod: escpos.buildEodReportPrint("Synthetic Pharmacy", eodSnapshot()),
      monthly: escpos.buildMonthlyPnlPrint("Synthetic Pharmacy", monthlySnapshot()),
    };
    for (const bytes of Object.values(jobs)) {
      expect(count(bytes, LF)).toBeGreaterThan(5);
    }
    // Only the builder owns row boundaries; a field cannot inject commands/rows.
    expect(escpos.thermalText("a\nb")).toBe("a?b");
    expect(escpos.thermalText("a\x1b@b\r\nc")).toBe("a?@b??c");
  });

  it("all original content bytes stay identical apart from approved LF and two monthly feed bytes", () => {
    const jobs = {
      test: escpos.buildTestPrint(),
      eod: escpos.buildEodReportPrint("Synthetic Pharmacy", eodSnapshot()),
      monthly: escpos.buildMonthlyPnlPrint("Synthetic Pharmacy", monthlySnapshot()),
    };
    const originalHashes = {
      test: "d96643c3b9202fef4bb427af7618f03a8fb950e8281c7ade260aa06ad6b3309c",
      eod: "ba1c6d2366dbb2a820992ba50da91a1e26c15dca8a8593e12e7107f2d660a290",
      monthly: "cec14ad3b36ccd8e0ebd06707275b7daa1089333d0881584abba49f3bf1e2234",
    };
    for (const name of Object.keys(jobs) as (keyof typeof jobs)[]) {
      const bytes = jobs[name];
      const content = name === 'monthly'
        ? Uint8Array.from([...bytes.slice(0, -6), ...bytes.slice(-4)]) : bytes;
      const originalEncoding = content.map((byte) => byte === LF ? 0x3f : byte);
      expect(createHash('sha256').update(originalEncoding).digest('hex')).toBe(originalHashes[name]);
    }
  });

  it("every job starts with ESC @ and ends with GS V 65 3 (cut after a 3-unit feed)", () => {
    for (const bytes of [
      escpos.buildTestPrint(),
      escpos.buildEodReportPrint("Synthetic Pharmacy", eodSnapshot()),
      escpos.buildMonthlyPnlPrint("Synthetic Pharmacy", monthlySnapshot()),
    ]) {
      expect(Array.from(bytes.slice(0, 2))).toEqual([ESC, 0x40]);
      expect(Array.from(bytes.slice(-4))).toEqual([GS, 0x56, 0x41, 0x03]);
      expect(Array.from(bytes).every((byte) => byte === ESC || byte === GS || byte < 0x80)).toBe(true);
    }
  });
});

describe("paper model on 58 mm / 32 columns (model of ESC/POS, not a printer)", () => {
  it("test print: each row is terminated and no text is pending at the cut", () => {
    const paper = renderEscPos(escpos.buildTestPrint(), 32);
    expect(paper.lineFeeds).toBe(6);
    expect(paper.cuts).toHaveLength(1);
    expect(paper.cuts[0]?.pendingText).toBe("");
    expect(paper.lines.every((line) => !line.wrapped)).toBe(true);
    expect(paperText(paper)[0]).toBe("           MUTHOY POS");
  });

  it("EOD: exact paper rows retain their labels, amounts and blank lines", () => {
    const paper = renderEscPos(escpos.buildEodReportPrint("Synthetic Pharmacy", eodSnapshot()), 32);
    expect(paperText(paper)).toEqual([
      "       Synthetic Pharmacy",
      "       END OF DAY REPORT",
      "    2026-11-10 - 2026-11-10",
      "--------------------------------",
      "MRP-inclusive sales     12250.00",
      "Transactions                  42",
      "Cash sales               9000.00",
      "Credit sales             3250.00",
      "COGS                     8000.00",
      "Expenses                  500.00",
      "--------------------------------",
      "NET PROFIT               3750.00",
      "", "English-only thermal output", "", "",
    ]);
    expect(paper.cuts[0]?.pendingText).toBe("");
    const intended = [escpos.thermalColumns("Cash sales", "9000.00"), escpos.thermalColumns("NET PROFIT", "3750.00")];
    for (const row of intended) expect(paper.lines.map((line) => line.text)).toContain(row);
  });

  it("monthly and EOD both retain three trailing line feeds", () => {
    const eodText = new TextDecoder().decode(escpos.buildEodReportPrint("S", eodSnapshot()));
    const monthlyText = new TextDecoder().decode(escpos.buildMonthlyPnlPrint("S", monthlySnapshot()));
    expect(eodText).toMatch(/English-only thermal output\n\n\n\x1d/);
    expect(monthlyText).toMatch(/English-only thermal output\n\n\n\x1d/);
  });
});

describe("Bangla and non-ASCII input (founder decision D-7: thermal output is English-only)", () => {
  it("a Bangla shop name prints as a centred run of '?' — one per NFKD code point", () => {
    const shopName = "রহমান ফার্মেসী";
    const header = escpos.centerThermal(shopName);
    const expectedMarks = shopName.normalize("NFKD").replace(/ /g, "").length;
    expect(header.trim().replace(/ /g, "")).toBe("?".repeat(expectedMarks));
    const text = new TextDecoder().decode(escpos.buildEodReportPrint(shopName, eodSnapshot()));
    expect(text).not.toMatch(/[ঀ-৿]/);
    expect(text).toContain("?????");
  });

  it("mixed English/Bangla keeps the English and replaces the Bangla", () => {
    expect(escpos.thermalText("Rahman ফার্মা")).toMatch(/^Rahman \?+$/);
  });

  it("accented Latin gains an extra '?' (NFKD splits the accent, then the accent is replaced)", () => {
    expect(escpos.thermalText("Café")).toBe("Cafe?");
  });

  it("Bangla digits and the taka sign are replaced, never transliterated", () => {
    expect(escpos.thermalText("৳ ১২৩")).toBe("? ???");
  });
});

describe("column layout: 58 mm (32) and 80 mm (48)", () => {
  it("builders are fixed at 32 columns; on an 80 mm roll they print a 32-column block", () => {
    const paper = renderEscPos(escpos.buildEodReportPrint("Synthetic Pharmacy", eodSnapshot()), 48);
    expect(Math.max(...paper.lines.map((line) => line.text.length))).toBeLessThanOrEqual(48);
    expect(escpos.thermalColumns("Cash sales", "9000.00")).toHaveLength(32);
  });

  it("the exported helpers honour an explicit 48-column width", () => {
    expect(escpos.thermalColumns("Cash sales", "9000.00", 48)).toHaveLength(48);
    expect(escpos.centerThermal("END OF DAY REPORT", 48)).toBe(`${" ".repeat(15)}END OF DAY REPORT`);
  });

  it("a long medicine-style label is truncated, the money value stays whole and right-aligned", () => {
    const label = "Zentrafen Extra Strength 500 mg Film Coated Tablet (Synthetic)";
    for (const width of [32, 48]) {
      const row = escpos.thermalColumns(label, "1234567.89", width);
      expect(row).toHaveLength(width);
      expect(row.endsWith(" 1234567.89")).toBe(true);
    }
  });

  it("the largest safe-integer paisa amount still prints whole at 32 columns", () => {
    const value = money.paisaToTakaText(asPaisa(Number.MAX_SAFE_INTEGER));
    expect(value).toBe("90071992547409.91");
    expect(escpos.thermalColumns("Net sales revenue", value)).toBe(`Net sales reve ${value}`);
    expect(escpos.thermalColumns("Net sales revenue", value).endsWith(value)).toBe(true);
  });

  it("LOW: a value of 31+ characters loses its LAST character (least-significant digit) instead of failing", () => {
    const value = `${"9".repeat(28)}.05`; // 31 chars, unreachable from integer paisa
    const row = escpos.thermalColumns("X", value);
    expect(row).toHaveLength(32);
    expect(row.endsWith("0")).toBe(true);
    expect(row.endsWith("05")).toBe(false);
  });
});

describe("money text on thermal output (paisaToTakaText, no thousands separators, ASCII digits)", () => {
  it.each([
    [0, "0.00"], [5, "0.05"], [100, "1.00"], [123_456_789, "1234567.89"], [-5_000, "-50.00"], [-1, "-0.01"],
  ])("%i paisa -> %s", (paisa, text) => {
    expect(money.paisaToTakaText(asPaisa(paisa))).toBe(text);
  });

  it("EOD labels a negative net result 'NET PROFIT -50.00'; monthly labels it 'NET LOSS' (inconsistent)", () => {
    const eod = new TextDecoder().decode(escpos.buildEodReportPrint("S", eodSnapshot({ netProfit: -5_000 })));
    const monthly = new TextDecoder().decode(escpos.buildMonthlyPnlPrint("S", monthlySnapshot({ netProfit: -5_000 })));
    expect(eod).toContain("NET PROFIT");
    expect(eod).toContain("-50.00");
    expect(eod).not.toContain("NET LOSS");
    expect(monthly).toContain("NET LOSS");
  });

  it("monthly prints zero deductions as '-0.00'", () => {
    const monthly = new TextDecoder().decode(escpos.buildMonthlyPnlPrint("S", monthlySnapshot({ discounts: 0, expenses: 0 })));
    expect(monthly).toContain("Discounts");
    expect(monthly).toContain("-0.00");
  });

  it("EOD prints cash and credit totals as separate rows (split sales contribute to both upstream)", () => {
    const eod = new TextDecoder().decode(escpos.buildEodReportPrint("S", eodSnapshot({ cashSales: 900_000, creditSales: 325_000 })));
    expect(eod).toContain("Cash sales");
    expect(eod).toContain("9000.00");
    expect(eod).toContain("Credit sales");
    expect(eod).toContain("3250.00");
  });
});

describe("base64 bridge encoding (domain/escpos bytesToBase64 -> native Base64.decode)", () => {
  it("matches Node's encoder for every byte value and for lengths 0..5 and 4096", () => {
    const all = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(escpos.bytesToBase64(all)).toBe(Buffer.from(all).toString("base64"));
    for (let length = 0; length <= 5; length += 1) {
      const bytes = all.slice(250, 250 + length);
      expect(escpos.bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    }
    const big = Uint8Array.from({ length: 4096 }, (_, index) => (index * 37 + 11) & 0xff);
    expect(escpos.bytesToBase64(big)).toBe(Buffer.from(big).toString("base64"));
  });
});
