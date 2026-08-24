import { describe, expect, it } from 'vitest';
import { fuzzyMatchMedicines } from './medicineMatch';

const CATALOG = [
  { medicineId: 'm1', name: 'Napa Extra' },
  { medicineId: 'm2', name: 'Napa' },
  { medicineId: 'm3', name: 'Seclo 20' },
  { medicineId: 'm4', name: 'Ace 500' },
];

describe('fuzzyMatchMedicines', () => {
  it('ranks an exact match first with the highest score', () => {
    const matches = fuzzyMatchMedicines('Napa Extra', CATALOG);
    expect(matches[0]?.medicine.medicineId).toBe('m1');
    expect(matches[0]?.score).toBe(100);
  });

  it('surfaces a close OCR misread (single-character substitution) as a top candidate', () => {
    const matches = fuzzyMatchMedicines('Napa Extr@', CATALOG);
    expect(matches[0]?.medicine.medicineId).toBe('m1');
    expect(matches[0]!.score).toBeGreaterThanOrEqual(80);
  });

  it('returns at most 3 candidates, sorted by descending score', () => {
    const matches = fuzzyMatchMedicines('Napa', CATALOG);
    expect(matches.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < matches.length; i += 1) {
      expect(matches[i - 1]!.score).toBeGreaterThanOrEqual(matches[i]!.score);
    }
  });

  it('excludes unrelated names below the minimum score threshold', () => {
    const matches = fuzzyMatchMedicines('Zzyzx Quantum Formula', CATALOG);
    expect(matches).toHaveLength(0);
  });

  it('returns an empty array against an empty catalog', () => {
    expect(fuzzyMatchMedicines('Napa Extra', [])).toEqual([]);
  });
});
