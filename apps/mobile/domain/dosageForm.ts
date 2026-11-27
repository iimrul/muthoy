// domain/dosageForm.ts — what KIND of medicine a row is: tablet, capsule,
// syrup, injection, insulin, powder… (founder, 2026-11-27).
//
// The same brand and strength often comes as both a tablet and a capsule
// (Telmepress 20). A customer asks for one or the other, so the shop keeps
// them as two products and every screen must tell them apart at a glance.
// `medicines.type` has always existed but was free text and shown nowhere;
// this module is the one vocabulary for it: a fixed list of forms, a reader
// that maps whatever was typed or printed ("Tab.", "CAPS", "ট্যাবলেট",
// "Eye Drops") onto it, and the icon + colour each form is drawn with.
//
// Pure: no React, native or DB imports.

import type { CatalogKey } from "../i18n/catalog";

export const DOSAGE_FORMS = [
  "tablet",
  "capsule",
  "syrup",
  "suspension",
  "injection",
  "insulin",
  "powder",
  "drops",
  "cream",
  "inhaler",
  "other",
] as const;

export type DosageForm = (typeof DOSAGE_FORMS)[number];

/** Words (lower-case, Latin or Bangla) that name each form. */
const SYNONYMS: Readonly<Record<Exclude<DosageForm, "other">, readonly string[]>> = {
  insulin: ["insulin", "penfill", "flexpen", "ইনসুলিন"],
  tablet: ["tablet", "tablets", "tab", "tabs", "chewable", "ট্যাবলেট", "ট্যাব", "বড়ি"],
  capsule: ["capsule", "capsules", "cap", "caps", "ক্যাপসুল", "ক্যাপ"],
  suspension: ["suspension", "susp", "সাসপেনশন"],
  syrup: ["syrup", "syp", "syr", "elixir", "সিরাপ"],
  injection: ["injection", "inj", "vial", "ampoule", "ampule", "ইনজেকশন", "ইঞ্জেকশন"],
  powder: ["powder", "pdr", "sachet", "sachets", "granules", "পাউডার", "গুঁড়া", "গুড়া", "স্যাশে"],
  drops: ["drops", "drop", "ড্রপ"],
  cream: ["cream", "ointment", "oint", "gel", "lotion", "ক্রিম", "মলম", "জেল"],
  inhaler: ["inhaler", "spray", "rotacap", "rotacaps", "ইনহেলার", "স্প্রে"],
};

const SYNONYM_ENTRIES = Object.entries(SYNONYMS) as [Exclude<DosageForm, "other">, readonly string[]][];
const WORD = /[\p{L}\p{M}]+/gu;

function wordsOf(text: string): string[] {
  return text.toLocaleLowerCase().normalize("NFC").match(WORD) ?? [];
}

/** The forms the words name, in order of first appearance. */
function formsInWords(words: readonly string[]): DosageForm[] {
  const found: DosageForm[] = [];
  for (const word of words) {
    for (const [form, synonyms] of SYNONYM_ENTRIES) {
      if (synonyms.includes(word) && !found.includes(form)) found.push(form);
    }
  }
  return found;
}

/**
 * The canonical form for a stored or typed value, or null when there is none.
 * A canonical value reads as itself; "Insulin Injection" is insulin, not a
 * generic injection; anything unrecognised but non-empty is "other".
 */
export function normalizeDosageForm(value: string | null | undefined): DosageForm | null {
  const text = value?.trim();
  if (!text) return null;
  const lower = text.toLocaleLowerCase();
  if ((DOSAGE_FORMS as readonly string[]).includes(lower)) return lower as DosageForm;
  const forms = formsInWords(wordsOf(text));
  if (forms.includes("insulin")) return "insulin";
  return forms[0] ?? "other";
}

/**
 * Every form a strip's OCR text names ("Telmepress 20 mg Capsule" → capsule).
 * Latin words shorter than 3 letters are ignored: too easy to misread on a
 * camera frame.
 */
export function dosageFormsInText(text: string): DosageForm[] {
  return formsInWords(wordsOf(text).filter((word) => word.length >= 3 || /[^\x00-\x7F]/.test(word)));
}

export const DOSAGE_FORM_LABEL: Readonly<Record<DosageForm, CatalogKey>> = {
  tablet: "dosageFormTablet",
  capsule: "dosageFormCapsule",
  syrup: "dosageFormSyrup",
  suspension: "dosageFormSuspension",
  injection: "dosageFormInjection",
  insulin: "dosageFormInsulin",
  powder: "dosageFormPowder",
  drops: "dosageFormDrops",
  cream: "dosageFormCream",
  inhaler: "dosageFormInhaler",
  other: "dosageFormOther",
};

/** MaterialCommunityIcons glyphs (each verified in the bundled glyph map). */
export const DOSAGE_FORM_ICON = {
  tablet: "minus-circle-outline",
  capsule: "pill",
  syrup: "bottle-tonic-outline",
  suspension: "bottle-tonic-plus-outline",
  injection: "needle",
  insulin: "diabetes",
  powder: "shaker-outline",
  drops: "eyedropper",
  cream: "lotion-outline",
  inhaler: "spray",
  other: "medical-bag",
} as const satisfies Readonly<Record<DosageForm, string>>;

/**
 * One colour per form, so a tablet and a capsule of the same name are told
 * apart before the label is read. Ink on a light tint of the same hue.
 */
export const DOSAGE_FORM_TINT: Readonly<Record<DosageForm, { ink: string; bg: string }>> = {
  tablet: { ink: "#2563EB", bg: "#EFF6FF" },
  capsule: { ink: "#7C3AED", bg: "#F3E8FF" },
  syrup: { ink: "#D97706", bg: "#FEF3C7" },
  suspension: { ink: "#B45309", bg: "#FFFBEB" },
  injection: { ink: "#DC2626", bg: "#FEF2F2" },
  insulin: { ink: "#0D9488", bg: "#F0FDFA" },
  powder: { ink: "#92400E", bg: "#FFF7ED" },
  drops: { ink: "#0891B2", bg: "#ECFEFF" },
  cream: { ink: "#DB2777", bg: "#FDF2F8" },
  inhaler: { ink: "#4F46E5", bg: "#EEF2FF" },
  other: { ink: "#6B7280", bg: "#F3F4F6" },
};
