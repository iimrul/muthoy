// The five strips the founder photographed on 2026-11-20 (Napa Extra, SMC
// ORSaline, Flacol, Napa Extend, Progut MUPS 20).
//
// HONEST LIMIT: the lines below are the text PRINTED on those strips,
// transcribed by hand from the photos in roughly the order it appears — NOT
// captured ML Kit output, which can only be produced on a phone. They pin the
// matching rules; recognition accuracy is a device question.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStripIndex,
  matchStrip,
  type OcrTextLine,
  type ScanVocabularyEntry,
  type StripMatchResult,
} from "./stripMatcher";

function medicine(
  medicineId: string,
  name: string,
  fields: Partial<Omit<ScanVocabularyEntry, "medicineId" | "name">> = {},
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

const BEXIMCO = "Beximco Pharmaceuticals Ltd.";
const NAPA = medicine("napa", "Napa", { generic: "Paracetamol", strength: "500mg", manufacturer: BEXIMCO });
const NAPA_EXTRA = medicine("napa-extra", "Napa Extra", {
  generic: "Paracetamol + Caffeine",
  strength: "500mg+65mg",
  manufacturer: BEXIMCO,
});
const NAPA_EXTEND = medicine("napa-extend", "Napa Extend", {
  generic: "Paracetamol",
  strength: "665mg",
  manufacturer: BEXIMCO,
});
const FLACOL = medicine("flacol", "Flacol", { generic: "Simethicone", strength: "40mg" });
const PROGUT_20 = medicine("progut-20", "Progut MUPS 20", {
  generic: "Esomeprazole",
  strength: "20mg",
  manufacturer: "Popular Pharmaceuticals Ltd.",
});
const PROGUT_40 = medicine("progut-40", "Progut MUPS 40", {
  generic: "Esomeprazole",
  strength: "40mg",
  manufacturer: "Popular Pharmaceuticals Ltd.",
});
const ORSALINE = medicine("orsaline", "SMC ORSaline", {
  generic: "Oral Rehydration Salts",
  manufacturer: "SMC Enterprise Ltd.",
});
const SECLO = medicine("seclo-20", "Seclo 20", {
  generic: "Omeprazole",
  strength: "20mg",
  manufacturer: "Square Pharmaceuticals Ltd.",
});

const SHOP = [NAPA, NAPA_EXTRA, NAPA_EXTEND, FLACOL, PROGUT_20, PROGUT_40, ORSALINE, SECLO];

const lines = (...texts: string[]): OcrTextLine[] =>
  texts.map((text) => ({ text, height: /napa|flacol|progut|orsaline/i.test(text) ? 60 : 24 }));

const NAPA_EXTRA_STRIP = lines(
  "MA No. 186-480-006",
  "Mfg. Lic",
  "BEXIMCO",
  "PHARMA",
  "3010001904",
  "a® Extra",
  "Napa® Extra",
  "amol 500 mg &",
  "Paracetamol 500 mg &",
  "eine 65 mg",
  "Caffeine 65 mg",
  "o. 186-480-006",
  "Mfg. Lic. No. 379 & 119",
  "Napa® Extra",
  "Paracetamol 500 mg &",
  "Caffeine 65 mg",
  "Napa",
  "Paraceta",
);

const NAPA_EXTEND_STRIP = lines(
  "Napa® Extend",
  "BEXIMCO PHARMA",
  "Paracetamol 665 mg",
  "MA No. 186-646-006",
  "Mfg. Lic. No. 379 & 119",
  "3010002147",
  "Napa® Extend",
  "Paracetamol 665 mg",
);

const FLACOL_STRIP = lines(
  "Simethicone USP 40 mg",
  "Sugar free Chewable tablet",
  "Flacol®",
  "Flacol",
  "Simethic",
  "cone US",
  "Sug free Chewa",
);

const PROGUT_20_STRIP = lines(
  "Esomeprazole 20 mg",
  "POPULAR",
  "Progut MUPS 20",
  "Esomeprazole 20 mg",
  "POPULAR",
  "Mfg. Lic. No.: 473 & 250",
  "MA No.: 336-802-067",
);

const ORSALINE_PACKET = lines("SMC", "SMC", "ORSaline", "WHO & UNICEF Approved", "SMC ORSaline");

function idsOf(result: StripMatchResult): string[] {
  if (result.kind === "match") return [result.medicine.medicineId];
  if (result.kind === "choose") return result.options.map((option) => option.medicineId);
  return [];
}

function scan(stock: readonly ScanVocabularyEntry[], strip: readonly OcrTextLine[]): StripMatchResult {
  return matchStrip(buildStripIndex(stock), strip);
}

describe("the five photographed strips", () => {
  it("Napa Extra adds Napa Extra — not plain Napa, whose name is also printed", () => {
    const result = scan(SHOP, NAPA_EXTRA_STRIP);
    expect(result).toMatchObject({ kind: "match", isStrong: true });
    expect(idsOf(result)).toEqual(["napa-extra"]);
  });

  it("ignores the MA No. line the old scanner took for the name", () => {
    const result = scan(SHOP, lines("MA No. 186-480-006", "Napa® Extra", "Caffeine 65 mg", "Paracetamol 500 mg"));
    expect(idsOf(result)).toEqual(["napa-extra"]);
  });

  it("Napa Extend adds Napa Extend", () => {
    expect(scan(SHOP, NAPA_EXTEND_STRIP)).toMatchObject({ kind: "match", medicine: { medicineId: "napa-extend" } });
  });

  it("Flacol adds Flacol", () => {
    expect(scan(SHOP, FLACOL_STRIP)).toMatchObject({ kind: "match", medicine: { medicineId: "flacol" }, isStrong: true });
  });

  it("Progut MUPS 20 adds the 20 mg product while 40 mg is also stocked", () => {
    expect(scan(SHOP, PROGUT_20_STRIP)).toMatchObject({ kind: "match", medicine: { medicineId: "progut-20" } });
  });

  it("SMC ORSaline adds ORSaline from the English text on the packet", () => {
    expect(scan(SHOP, ORSALINE_PACKET)).toMatchObject({ kind: "match", medicine: { medicineId: "orsaline" } });
  });
});

describe("strength separates variants, and never guesses", () => {
  it("offers both strengths when the strength could not be read", () => {
    const result = scan(SHOP, lines("Progut MUPS", "POPULAR", "Esomeprazole"));
    expect(result.kind).toBe("choose");
    expect(idsOf(result).sort()).toEqual(["progut-20", "progut-40"]);
  });

  it("reports a 40 mg strip as not found when the shop only stocks 20 mg", () => {
    const strip = lines("Progut MUPS 40", "Esomeprazole 40 mg", "POPULAR", "MA No.: 336-802-068");
    expect(scan([PROGUT_20, SECLO], strip)).toEqual({ kind: "notFound" });
  });

  it("reads OCR's letter-O-for-zero inside a strength", () => {
    const strip = lines("Progut MUPS 2O", "Esomeprazole 2O mg", "POPULAR");
    expect(idsOf(scan(SHOP, strip))).toEqual(["progut-20"]);
  });

  it("does not let MA / licence numbers act as a strength", () => {
    // 186 and 480 are on the MA line; no product here has those strengths, and
    // a registration line must not make Napa Extra look contradicted either.
    const strip = lines("Napa® Extra", "MA No. 186-480-006", "Mfg. Lic. No. 379 & 119");
    expect(idsOf(scan(SHOP, strip))).toEqual(["napa-extra"]);
  });
});

describe("a missed variant word is offered, never silently downgraded", () => {
  it("offers Napa AND Napa Extra when the Extra box was not read but Caffeine 65 mg was", () => {
    const strip = lines("Napa®", "Paracetamol 500 mg &", "Caffeine 65 mg", "BEXIMCO PHARMA", "Napa®");
    const result = scan(SHOP, strip);
    expect(result.kind).toBe("choose");
    expect(idsOf(result)).toEqual(expect.arrayContaining(["napa", "napa-extra"]));
  });

  it("does not add plain Napa from a Napa Extra strip in a shop that has no Napa Extra", () => {
    const result = scan([NAPA, FLACOL], NAPA_EXTRA_STRIP);
    expect(result.kind).not.toBe("match");
  });

  it("does not add plain Napa from a Napa Extend strip either", () => {
    expect(scan([NAPA, FLACOL], NAPA_EXTEND_STRIP).kind).not.toBe("match");
  });

  it("still adds plain Napa from a plain Napa strip", () => {
    const strip = lines("Napa", "Paracetamol 500 mg", "BEXIMCO PHARMA", "Napa", "MA No. 186-117-006");
    expect(scan(SHOP, strip)).toMatchObject({ kind: "match", medicine: { medicineId: "napa" } });
  });

  it("offers Napa Extend from its generic and strength when the script brand is unreadable", () => {
    const strip = lines("Napa®", "Paracetamol 665 mg", "BEXIMCO PHARMA", "Napa®");
    const result = scan(SHOP, strip);
    expect(result).toEqual({ kind: "choose", options: [NAPA_EXTEND] });
  });

  it("never offers omeprazole for an esomeprazole strip", () => {
    const strip = lines("Esomeprazole 20 mg", "Esomeprazole 20 mg");
    expect(idsOf(scan([SECLO], strip))).not.toContain("seclo-20");
  });

  it("offers, rather than adds, two products whose names differ only by a single letter", () => {
    const orsalineN = medicine("orsaline-n", "SMC ORSaline-N", { manufacturer: "SMC Enterprise Ltd." });
    const result = scan([ORSALINE, orsalineN], ORSALINE_PACKET);
    expect(result.kind).toBe("choose");
  });
});

describe("OCR slips the matcher tolerates", () => {
  it("accepts one wrong letter in a long brand word (the script-font Extend)", () => {
    const strip = lines("Napa® Exlend", "Paracetamol 665 mg", "BEXIMCO PHARMA");
    expect(idsOf(scan(SHOP, strip))).toEqual(["napa-extend"]);
  });

  it("does not accept a wrong letter in a 4-letter word", () => {
    const strip = lines("Nopa", "Paracetamol 500 mg");
    expect(idsOf(scan([NAPA], strip))).not.toContain("napa");
  });

  it("does not offer a different brand of the same generic and strength", () => {
    expect(idsOf(scan([PROGUT_20], lines("Maxpro 20", "Esomeprazole 20 mg")))).toEqual([]);
  });

  it("accepts a brand read as one glued word", () => {
    expect(idsOf(scan(SHOP, lines("NapaExtra", "Caffeine 65 mg", "Paracetamol 500 mg")))).toEqual([
      "napa-extra",
    ]);
  });

  it("matches a medicine stored under a Bengali name from the Latin strip text", () => {
    const flacolBangla = medicine("flacol-bn", "ফ্লাকোল", { strength: "৪০ মি.গ্রা." });
    expect(idsOf(scan([flacolBangla], FLACOL_STRIP))).toEqual(["flacol-bn"]);
  });
});

// ── REAL device output ─────────────────────────────────────────────────────
// stripMatcher.device-ocr.json is what ML Kit actually returned on the founder's
// Galaxy A04s for the same five photos, through the app's own scanTextLines —
// verbatim, misreads included: "500 rmg", "Calteine", "Napa°tend", "NapaCxtend",
// "OsMc0RSaine". These pin the matcher against what the phone really reads.
interface DeviceCapture {
  strips: Record<string, { lines: OcrTextLine[] }>;
}
const DEVICE: DeviceCapture = JSON.parse(
  readFileSync(resolve(process.cwd(), "apps/mobile/domain/stripMatcher.device-ocr.json"), "utf8"),
);
const deviceStrip = (key: string): OcrTextLine[] => {
  const strip = DEVICE.strips[key];
  if (!strip) throw new Error(`no device capture for ${key}`);
  return strip.lines;
};

describe("REAL on-device ML Kit output (Galaxy A04s, 2026-11-20)", () => {
  it.each([
    ["napaExtra", "napa-extra"],
    ["napaExtend", "napa-extend"],
    ["flacol", "flacol"],
    ["progutMups20", "progut-20"],
    ["smcOrsaline", "orsaline"],
  ])("the real %s read adds exactly %s", (key, medicineId) => {
    const result = scan(SHOP, deviceStrip(key));
    expect(result.kind).toBe("match");
    expect(idsOf(result)).toEqual([medicineId]);
  });

  it("never turns the real Napa Extra or Napa Extend read into plain Napa", () => {
    for (const key of ["napaExtra", "napaExtend"]) {
      expect(scan([NAPA, FLACOL], deviceStrip(key)).kind).not.toBe("match");
    }
  });

  it("reports the real Progut MUPS 20 read as not found where only 40 mg is stocked", () => {
    expect(scan([PROGUT_40, NAPA], deviceStrip("progutMups20"))).toEqual({ kind: "notFound" });
  });
});

describe("what is NOT a medicine", () => {
  it("stays silent on an empty frame", () => {
    expect(scan(SHOP, [])).toEqual({ kind: "none" });
  });

  it("stays silent on ordinary text", () => {
    expect(scan(SHOP, lines("Hello world", "Thank you for shopping"))).toEqual({ kind: "none" });
  });

  it("says not found for a medicine strip the shop does not stock", () => {
    expect(scan(SHOP, lines("Maxpro 20", "Esomeprazole 20 mg", "Renata Limited"))).toEqual({ kind: "notFound" });
  });

  it("still identifies a medicine with no sellable stock — stock is the screen's decision", () => {
    const outOfStock = { ...FLACOL, isSellable: false };
    expect(scan([outOfStock], FLACOL_STRIP)).toMatchObject({ kind: "match", medicine: { isSellable: false } });
  });
});
