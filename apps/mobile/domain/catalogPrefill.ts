// domain/catalogPrefill.ts — W2-02: mapping a selected `medicine_catalog` row
// onto Add Medicine's form fields.
//
// Pure: zero React/native/DB imports (mirrors domain/fefo.ts). That is what
// makes the one genuinely non-obvious rule here — when a catalogue pack size
// may become a shop medicine's unit of measure — unit-testable without
// rendering a form or opening a database.
//
// Nothing in this module writes anything. Every value it produces is a
// PREFILL the user can still edit, and Save remains the only commit path:
// db/medicineCatalog.ts deliberately ships no catalogue-to-`medicines` writer.

/**
 * The subset of a `medicine_catalog` row this mapping reads. Declared
 * structurally instead of importing `CatalogEntry` from `db/medicineCatalog.ts`
 * so this module keeps its no-DB-import rule; `CatalogEntry` is assignable to it.
 */
export interface CatalogPrefillSource {
  brandName: string;
  genericName?: string | null;
  manufacturer?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  packSize?: string | null;
}

/** Add Medicine's prefillable identity fields, in the form's own vocabulary. */
export interface MedicinePrefill {
  name: string;
  generic?: string;
  manufacturer?: string;
  strength?: string;
  /** `medicines.type` — the existing dosage-form column. */
  type?: string;
  /** Only set when the catalogue's pack size actually names a unit. */
  unitOfMeasure?: string;
}

/**
 * Pack-size strings that NAME a unit, mapped to the canonical spelling the
 * rest of the app writes into `medicines.unit_of_measure` (whose default is
 * "piece", and whose schema comment reads "piece, ml, strip...").
 *
 * The column is free text a shopkeeper types, so there is no enumeration to
 * validate against — which is exactly why this list is an allowlist rather
 * than a cleanup pass over arbitrary input.
 */
const UNIT_PACK_SIZES: Readonly<Record<string, string>> = {
  piece: "piece",
  pieces: "piece",
  pc: "piece",
  pcs: "piece",
  strip: "strip",
  strips: "strip",
  bottle: "bottle",
  bottles: "bottle",
  tube: "tube",
  tubes: "tube",
  vial: "vial",
  vials: "vial",
  ampoule: "ampoule",
  ampoules: "ampoule",
  ampule: "ampoule",
  sachet: "sachet",
  sachets: "sachet",
  box: "box",
  boxes: "box",
  jar: "jar",
  jars: "jar",
  tin: "tin",
  tins: "tin",
  packet: "packet",
  packets: "packet",
  pack: "packet",
  packs: "packet",
  can: "can",
  cans: "can",
  syringe: "syringe",
  syringes: "syringe",
  inhaler: "inhaler",
  inhalers: "inhaler",
  suppository: "suppository",
  suppositories: "suppository",
  drop: "drop",
  drops: "drop",
  ml: "ml",
  gm: "gm",
  g: "gm",
  l: "l",
  litre: "l",
  liter: "l",
};

/** Trimmed text, or undefined for null/absent/blank — never an empty string. */
function clean(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * A catalogue pack size becomes a unit of measure only when it names one.
 *
 * A pack size that COUNTS something — "10's pack", "1 x 10", "30 ml bottle" —
 * is a quantity, and writing it into `unit_of_measure` would put "1 x 10" on a
 * receipt line, because `sale_items.unit_snapshot` copies this column at sale
 * time (db/sales.ts) and the sales-history read falls back to it. So anything
 * carrying a digit is dropped outright, and what remains must match the
 * allowlist above; otherwise the field is left alone and keeps its "piece"
 * default, which the user can still edit.
 */
export function unitOfMeasureFromPackSize(
  packSize?: string | null,
): string | undefined {
  const value = clean(packSize);
  if (!value) return undefined;
  if (/\d/.test(value)) return undefined;
  const folded = value.toLowerCase().replace(/[^a-z]/g, "");
  return UNIT_PACK_SIZES[folded];
}

/**
 * The selected catalogue row as Add Medicine's prefills.
 *
 * `brandName` maps to `name` ALONE. Strength, dosage form and pack size are
 * never concatenated into it: `medicines.name` must stay the brand name,
 * because `medicines_fts` indexes it and `findExactNameMatch` compares against
 * it, so polluting it would corrupt both the sale scan's exact-match gate and
 * existing medicine search.
 *
 * The catalogue's Bangla names are deliberately not mapped. They feed the
 * search index (W2-03); giving the shop-owned, SYNCED `medicines` table Bangla
 * columns would need a Postgres migration, which is behind the H-9 seal (E4).
 */
export function medicinePrefillFromCatalog(
  source: CatalogPrefillSource,
): MedicinePrefill {
  return {
    name: source.brandName.trim(),
    generic: clean(source.genericName),
    manufacturer: clean(source.manufacturer),
    strength: clean(source.strength),
    type: clean(source.dosageForm),
    unitOfMeasure: unitOfMeasureFromPackSize(source.packSize),
  };
}

/**
 * The same mapping from a search result rather than a full catalogue row — the
 * fallback when the row cannot be re-read at selection time (a re-import can
 * replace ids, so `getCatalogEntry` may legitimately return null). The user
 * still gets exactly the values the result row showed them, and still confirms
 * with Save.
 */
export function medicinePrefillFromSearchResult(result: {
  name: string;
  generic?: string;
  manufacturer?: string;
  strength?: string;
  dosageForm?: string;
  packSize?: string;
}): MedicinePrefill {
  return medicinePrefillFromCatalog({
    brandName: result.name,
    genericName: result.generic,
    manufacturer: result.manufacturer,
    strength: result.strength,
    dosageForm: result.dosageForm,
    packSize: result.packSize,
  });
}
