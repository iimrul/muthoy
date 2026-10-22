import { describe, expect, it } from 'vitest';
import {
  banglishFromBengali,
  hasBengaliScript,
  medicineSearchKey,
  medicineSearchKeys,
  normalizeBengali,
} from './bengali';

// W2-03. The property under test is SYMMETRY: the same fold is applied to the
// indexed field and to the query, so English, Bangla and Banglish reach the same
// key. A test that only checked "Bangla produces some string" would pass while
// the three scripts landed in three different spaces and nothing ever matched.

const NAPA_BN = 'নাপা'; // নাপা
const HASANTA_WORD = 'সার্ব'; // সার্ব — carries a hasanta

describe('normalizeBengali', () => {
  it('strips zero-width joiners and non-joiners', () => {
    const withJoiners = `${NAPA_BN.slice(0, 2)}‌‍${NAPA_BN.slice(2)}`;

    expect(normalizeBengali(withJoiners)).toBe(NAPA_BN);
  });

  it('folds Bengali digits to ASCII', () => {
    expect(normalizeBengali('৫০০ mg')).toBe('500 mg');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeBengali('  napa   500  ')).toBe('napa 500');
  });

  it('keeps Bengali letters as Bengali — it is not the comparison key', () => {
    expect(hasBengaliScript(normalizeBengali(NAPA_BN))).toBe(true);
  });
});

describe('banglishFromBengali', () => {
  it('transliterates a Bengali brand name to Latin', () => {
    expect(banglishFromBengali(NAPA_BN)).toBe('napa');
  });

  it('drops hasanta rather than emitting a letter for it', () => {
    expect(banglishFromBengali(HASANTA_WORD)).toBe('sarb');
  });

  it('prefers the two-codepoint nukta form over its single-codepoint base', () => {
    // ড় (U+09A1 U+09BC) is "r", not the "d" of its base ড.
    expect(banglishFromBengali('ড়')).toBe('r');
    expect(banglishFromBengali('ড')).toBe('d');
  });

  it('passes ASCII through untouched', () => {
    expect(banglishFromBengali('Napa 500')).toBe('Napa 500');
  });
});

describe('medicineSearchKey — the three scripts must converge', () => {
  it('maps English, Bangla and Banglish spellings of one brand to ONE key', () => {
    const fromEnglish = medicineSearchKey('Napa');
    const fromBangla = medicineSearchKey(NAPA_BN);
    const fromBanglish = medicineSearchKey('napa');

    expect(fromEnglish).toBe('napa');
    expect(fromBangla).toBe(fromEnglish);
    expect(fromBanglish).toBe(fromEnglish);
  });

  it('is case insensitive', () => {
    expect(medicineSearchKey('NAPA')).toBe(medicineSearchKey('napa'));
  });

  it('folds the ph/f variation both typists use', () => {
    expect(medicineSearchKey('Ciprofloxacin')).toBe(medicineSearchKey('Ciprophloxacin'));
  });

  it('folds z/j, which Bangla writes both ways', () => {
    expect(medicineSearchKey('Zimax')).toBe(medicineSearchKey('Jimax'));
  });

  it('collapses doubled letters', () => {
    expect(medicineSearchKey('Seppa')).toBe(medicineSearchKey('Sepa'));
  });

  it('keeps strength digits, so 500mg and 665mg stay distinguishable', () => {
    expect(medicineSearchKey('Napa 500')).not.toBe(medicineSearchKey('Napa 665'));
    expect(medicineSearchKey('Napa 500')).toContain('500');
  });

  it('folds a Bengali strength written in Bengali digits onto the ASCII one', () => {
    expect(medicineSearchKey(`${NAPA_BN} ৫০০`)).toBe(medicineSearchKey('Napa 500'));
  });

  it('does NOT collapse two genuinely different brands onto one key', () => {
    expect(medicineSearchKey('Napa')).not.toBe(medicineSearchKey('Seclo'));
  });

  it('returns empty for input with no alphanumeric content', () => {
    // A blank key must never come from real text, or it would behave as a
    // match-everything token once it reaches FTS5.
    expect(medicineSearchKey('   ---  ')).toBe('');
    expect(medicineSearchKey(NAPA_BN)).not.toBe('');
  });
});

describe('medicineSearchKeys', () => {
  it('joins every distinct fold of a row', () => {
    const key = medicineSearchKeys(['Napa', NAPA_BN, 'Paracetamol']);

    // Napa and নাপা fold identically, so the brand appears once, not twice.
    expect(key.split(' ').filter((token) => token === 'napa')).toHaveLength(1);
    expect(key).toContain('paracetamol');
  });

  it('drops null, undefined and empty fields instead of emitting blank tokens', () => {
    expect(medicineSearchKeys(['Napa', null, undefined, '', '  '])).toBe('napa');
  });

  it('is empty for a row with no searchable text at all', () => {
    expect(medicineSearchKeys([null, undefined, ''])).toBe('');
  });

  it('makes a Bangla-only row findable by its Banglish spelling', () => {
    // The row carries no ASCII name at all. This is the case that fails if the
    // transliteration fold is ever removed from the key.
    expect(medicineSearchKeys([NAPA_BN])).toContain(medicineSearchKey('napa'));
  });
});
