import { describe, expect, it } from 'vitest';
import {
  medicinePrefillFromCatalog,
  medicinePrefillFromSearchResult,
  unitOfMeasureFromPackSize,
} from './catalogPrefill';

const FULL_ROW = {
  brandName: 'Napa Extra',
  genericName: 'Paracetamol + Caffeine',
  manufacturer: 'Beximco Pharmaceuticals',
  strength: '500mg + 65mg',
  dosageForm: 'Tablet',
  packSize: 'Strip',
};

describe('medicinePrefillFromCatalog', () => {
  it('maps every catalogue field into its own form field', () => {
    expect(medicinePrefillFromCatalog(FULL_ROW)).toEqual({
      name: 'Napa Extra',
      generic: 'Paracetamol + Caffeine',
      manufacturer: 'Beximco Pharmaceuticals',
      strength: '500mg + 65mg',
      type: 'Tablet',
      unitOfMeasure: 'strip',
    });
  });

  it('never concatenates strength, dosage form or pack size into the name', () => {
    // medicines.name must stay the brand name: medicines_fts indexes it and
    // findExactNameMatch compares against it.
    const prefill = medicinePrefillFromCatalog(FULL_ROW);
    expect(prefill.name).toBe('Napa Extra');
    expect(prefill.name).not.toContain('500mg');
    expect(prefill.name).not.toContain('Tablet');
    expect(prefill.name).not.toContain('Strip');
  });

  it('drops null, absent and blank columns rather than prefilling empty text', () => {
    expect(
      medicinePrefillFromCatalog({
        brandName: '  Napa  ',
        genericName: null,
        manufacturer: '   ',
        strength: null,
      }),
    ).toEqual({
      name: 'Napa',
      generic: undefined,
      manufacturer: undefined,
      strength: undefined,
      type: undefined,
      unitOfMeasure: undefined,
    });
  });

  it('does not map the catalogue Bangla names onto the synced medicines row', () => {
    const prefill = medicinePrefillFromCatalog({
      ...FULL_ROW,
      // Present on medicine_catalog, deliberately unmapped until E4 — adding
      // Bangla columns to `medicines` is a Postgres migration behind the seal.
      ...{ brandNameBn: 'নাপা এক্সট্রা', genericNameBn: 'প্যারাসিটামল' },
    });
    expect(Object.values(prefill)).not.toContain('নাপা এক্সট্রা');
    expect(Object.values(prefill)).not.toContain('প্যারাসিটামল');
  });
});

describe('unitOfMeasureFromPackSize', () => {
  it.each([
    ['Strip', 'strip'],
    ['strips', 'strip'],
    ['BOTTLE', 'bottle'],
    ['pcs', 'piece'],
    ['pack', 'packet'],
    ['ml', 'ml'],
    ['Litre', 'l'],
    ['tube.', 'tube'],
  ])('accepts %s, which names a unit, as %s', (packSize, expected) => {
    expect(unitOfMeasureFromPackSize(packSize)).toBe(expected);
  });

  it.each([
    "10's pack",
    '1 x 10',
    '30 ml bottle',
    '10x10',
    '100ml',
    'strip of 10',
  ])('drops %s, which counts a quantity instead of naming a unit', (packSize) => {
    // Writing a count into unit_of_measure would put "1 x 10" on a receipt
    // line: sale_items.unit_snapshot copies this column at sale time.
    expect(unitOfMeasureFromPackSize(packSize)).toBeUndefined();
  });

  it.each(['Alu-Alu blister', 'HDPE container', 'combipack'])(
    'drops %s, which is packaging rather than a sale unit',
    (packSize) => {
      expect(unitOfMeasureFromPackSize(packSize)).toBeUndefined();
    },
  );

  it('drops null, undefined and blank pack sizes', () => {
    expect(unitOfMeasureFromPackSize(null)).toBeUndefined();
    expect(unitOfMeasureFromPackSize(undefined)).toBeUndefined();
    expect(unitOfMeasureFromPackSize('   ')).toBeUndefined();
  });
});

describe('medicinePrefillFromSearchResult', () => {
  it('maps a search result the same way a full catalogue row maps', () => {
    expect(
      medicinePrefillFromSearchResult({
        name: 'Napa Extra',
        generic: 'Paracetamol + Caffeine',
        manufacturer: 'Beximco Pharmaceuticals',
        strength: '500mg + 65mg',
        dosageForm: 'Tablet',
        packSize: 'Strip',
      }),
    ).toEqual(medicinePrefillFromCatalog(FULL_ROW));
  });

  it('carries the four legacy fields when a provider supplies no new ones', () => {
    expect(
      medicinePrefillFromSearchResult({
        name: 'Napa',
        generic: 'Paracetamol',
        manufacturer: 'Beximco',
      }),
    ).toEqual({
      name: 'Napa',
      generic: 'Paracetamol',
      manufacturer: 'Beximco',
      strength: undefined,
      type: undefined,
      unitOfMeasure: undefined,
    });
  });
});
