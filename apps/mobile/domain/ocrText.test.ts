import { describe, expect, it } from 'vitest';
import {
  extractBatchNoCandidate,
  extractExpiryCandidateText,
  extractMedicineNameCandidate,
  findExactNameMatch,
  normalizeMedicineName,
  parseScannedMedicineStrip,
} from './ocrText';

const SAMPLE_STRIP = [
  'Napa Extra',
  'Paracetamol + Caffeine',
  'Tab 500mg+65mg',
  'Beximco Pharmaceuticals Ltd.',
  'B. No: NX2456',
  'MFG: 05/2025',
  'EXP: 04/2027',
  'MRP: Tk. 1.50',
].join('\n');

describe('extractMedicineNameCandidate', () => {
  it('returns the first plausible line, skipping label/price lines', () => {
    expect(extractMedicineNameCandidate(SAMPLE_STRIP)).toBe('Napa Extra');
  });

  it('returns null when every line is a label or noise', () => {
    expect(extractMedicineNameCandidate('MFG: 05/2025\nEXP: 04/2027\n123')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractMedicineNameCandidate('')).toBeNull();
  });
});

describe('extractBatchNoCandidate', () => {
  it('extracts a "B. No:" labeled batch number', () => {
    expect(extractBatchNoCandidate(SAMPLE_STRIP)).toBe('NX2456');
  });

  it('extracts a "Batch No" labeled batch number', () => {
    expect(extractBatchNoCandidate('Batch No: AB-9910')).toBe('AB-9910');
  });

  it('returns null when no batch label is present', () => {
    expect(extractBatchNoCandidate('Napa Extra\nEXP: 04/2027')).toBeNull();
  });
});

describe('extractExpiryCandidateText', () => {
  it('prefers an EXP-labeled date even when an MFG date is also present', () => {
    expect(extractExpiryCandidateText(SAMPLE_STRIP)).toBe('04/2027');
  });

  it('never falls back to an unlabeled date, even when only one is present', () => {
    expect(extractExpiryCandidateText('Napa Extra\n04/2027')).toBeNull();
  });

  it('never falls back to an unlabeled date when several are present', () => {
    expect(extractExpiryCandidateText('Napa Extra\n04/2027\n11/2026')).toBeNull();
  });

  it('returns null when no date-like token is present', () => {
    expect(extractExpiryCandidateText('Napa Extra\nParacetamol')).toBeNull();
  });

  it('returns null for an MFG-labeled date when no EXP label is present — never mistakes a manufacture date for an expiry date', () => {
    expect(extractExpiryCandidateText('Napa Extra\nMFG: 05/2025')).toBeNull();
  });

  it('returns null for an MFD-labeled date with no EXP label, regardless of how the date reads', () => {
    // Even a date that would read as "in the future" must not be inferred as
    // expiry from an MFG/MFD label alone — isoDateSchema's "today or later"
    // check downstream cannot catch an OCR digit misread that turns a past
    // manufacture date into an apparently-future one.
    expect(extractExpiryCandidateText('Napa Extra\nMFD: 05/2099')).toBeNull();
  });
});

describe('parseScannedMedicineStrip', () => {
  it('extracts name, batch number, and normalized expiry from a realistic strip', () => {
    expect(parseScannedMedicineStrip(SAMPLE_STRIP)).toEqual({
      name: 'Napa Extra',
      batchNo: 'NX2456',
      expiryDate: '2027-04-30',
    });
  });

  it('returns all-null fields for garbage/noise input', () => {
    expect(parseScannedMedicineStrip('###\n123456\n...')).toEqual({
      name: null,
      batchNo: null,
      expiryDate: null,
    });
  });

  it('leaves expiryDate null when only unlabeled dates are present, even with a clear name', () => {
    const result = parseScannedMedicineStrip('Napa Extra\n04/2027\n11/2026');
    expect(result.name).toBe('Napa Extra');
    expect(result.expiryDate).toBeNull();
  });

  it('leaves expiryDate null when only an MFG-labeled date is present — never prefills a manufacture date as expiry', () => {
    const result = parseScannedMedicineStrip('Napa Extra\nB. No: NX2456\nMFG: 05/2025');
    expect(result).toEqual({
      name: 'Napa Extra',
      batchNo: 'NX2456',
      expiryDate: null,
    });
  });
});

describe('normalizeMedicineName', () => {
  it('trims, lowercases, and collapses internal whitespace', () => {
    expect(normalizeMedicineName('  Napa   Extra  ')).toBe('napa extra');
  });

  it('treats differently-cased names as identical once normalized', () => {
    expect(normalizeMedicineName('NAPA EXTRA')).toBe(normalizeMedicineName('napa extra'));
  });
});

describe('findExactNameMatch', () => {
  const napaExtra = { name: 'Napa Extra' };

  it('returns the match for exactly one result with an identical normalized name', () => {
    expect(findExactNameMatch(' napa   extra ', [napaExtra])).toBe(napaExtra);
  });

  it('returns null when the single result is only a prefix of the candidate name', () => {
    // searchMedicinesForSale does FTS prefix matching, so a truncated OCR
    // read ("Napa") can be the only result without actually being that
    // product — must never be trusted as an exact identity match.
    expect(findExactNameMatch('Napa', [napaExtra])).toBeNull();
  });

  it('returns null when the single result name is unrelated to the candidate', () => {
    expect(findExactNameMatch('Seclo', [napaExtra])).toBeNull();
  });

  it('returns null when there are zero matches', () => {
    expect(findExactNameMatch('Napa Extra', [])).toBeNull();
  });

  it('returns null when there are multiple matches, even if one name is exact', () => {
    expect(findExactNameMatch('Napa Extra', [napaExtra, { name: 'Napa Extra Forte' }])).toBeNull();
  });
});
