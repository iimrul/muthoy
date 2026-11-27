import { describe, expect, it } from "vitest";
import { catalog } from "../i18n/catalog";
import {
  DOSAGE_FORMS,
  DOSAGE_FORM_ICON,
  DOSAGE_FORM_LABEL,
  DOSAGE_FORM_TINT,
  dosageFormsInText,
  normalizeDosageForm,
} from "./dosageForm";

describe("normalizeDosageForm (founder, 2026-11-27: tablet vs capsule)", () => {
  it("reads canonical values, English words, abbreviations and Bangla", () => {
    expect(normalizeDosageForm("tablet")).toBe("tablet");
    expect(normalizeDosageForm("Tablet")).toBe("tablet");
    expect(normalizeDosageForm("Tab.")).toBe("tablet");
    expect(normalizeDosageForm("CAPS")).toBe("capsule");
    expect(normalizeDosageForm("ক্যাপসুল")).toBe("capsule");
    expect(normalizeDosageForm("ট্যাবলেট")).toBe("tablet");
    expect(normalizeDosageForm("Syp")).toBe("syrup");
    expect(normalizeDosageForm("Oral Suspension")).toBe("suspension");
    expect(normalizeDosageForm("Inj.")).toBe("injection");
    expect(normalizeDosageForm("Eye Drops")).toBe("drops");
    expect(normalizeDosageForm("Ointment")).toBe("cream");
    expect(normalizeDosageForm("Sachet")).toBe("powder");
    expect(normalizeDosageForm("গুঁড়া")).toBe("powder");
    expect(normalizeDosageForm("Nasal Spray")).toBe("inhaler");
  });

  it("an insulin injection is insulin, not a generic injection", () => {
    expect(normalizeDosageForm("Insulin Injection")).toBe("insulin");
    expect(normalizeDosageForm("ইনসুলিন")).toBe("insulin");
  });

  it("is null when nothing was recorded and 'other' for an unknown form", () => {
    expect(normalizeDosageForm(null)).toBeNull();
    expect(normalizeDosageForm("   ")).toBeNull();
    expect(normalizeDosageForm("Suppository")).toBe("other");
  });
});

describe("dosageFormsInText (OCR)", () => {
  it("finds the form printed on a strip", () => {
    expect(dosageFormsInText("Telmepress® 20 mg Capsule")).toEqual(["capsule"]);
    expect(dosageFormsInText("TELMEPRESS 20 Tablet USP")).toEqual(["tablet"]);
    expect(dosageFormsInText("Napa Extend 665 mg")).toEqual([]);
  });

  it("ignores Latin words too short to trust in a camera frame", () => {
    expect(dosageFormsInText("DT 20 mg")).toEqual([]);
  });
});

describe("every form has a label in both languages, an icon and a colour", () => {
  it.each(DOSAGE_FORMS)("%s", (form) => {
    expect(catalog.en[DOSAGE_FORM_LABEL[form]]).toBeTruthy();
    expect(catalog.bn[DOSAGE_FORM_LABEL[form]]).toBeTruthy();
    expect(DOSAGE_FORM_ICON[form]).toBeTruthy();
    expect(DOSAGE_FORM_TINT[form].ink).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("no two forms share an icon or a colour", () => {
    expect(new Set(Object.values(DOSAGE_FORM_ICON)).size).toBe(DOSAGE_FORMS.length);
    expect(new Set(Object.values(DOSAGE_FORM_TINT).map((tint) => tint.ink)).size).toBe(DOSAGE_FORMS.length);
  });
});
