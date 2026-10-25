// Batch 3 §8.5 — k-anonymity at the boundary: k−1 suppressed and k visible,
// for a bucket, a series point and an export row.
//
// The boundary is the whole test. A floor that suppresses at 4 and shows at 5
// is correct; one that suppresses at 5 and shows at 6 withholds data nobody
// asked it to; one that shows at 4 discloses a pharmacy. Only the exact pair
// proves which of the three was built.

import { describe, expect, test } from 'vitest';
import {
  SUPPRESSED_DISPLAY,
  SUPPRESSED_EXPORT,
  SUPPRESSION_K,
  displaySuppressed,
  exportSuppressed,
  suppressBelowK,
  suppressSeriesBelowK,
  visiblePoints,
} from './adminSuppression';

function shops(count: number): readonly string[] {
  return Array.from({ length: count }, (_unused, index) => 'shop-' + index);
}

describe('the boundary', () => {
  test('k is five', () => {
    expect(SUPPRESSION_K).toBe(5);
  });

  test('k-1 contributing shops is SUPPRESSED', () => {
    const gated = suppressBelowK({ value: 123_456, contributingShopIds: shops(4) });

    expect(gated.suppressed).toBe(true);
    expect(gated.value).toBeNull();
    expect(gated.contributorCount).toBe(4);
  });

  test('k contributing shops is VISIBLE', () => {
    const gated = suppressBelowK({ value: 123_456, contributingShopIds: shops(5) });

    expect(gated.suppressed).toBe(false);
    expect(gated.value).toBe(123_456);
    expect(gated.contributorCount).toBe(5);
  });

  test('one shop is suppressed, however many rows it contributed', () => {
    // A hundred sales rows from one pharmacy is still one pharmacy.
    const gated = suppressBelowK({
      value: 9_999_999,
      contributingShopIds: Array.from({ length: 100 }, () => 'shop-1'),
    });

    expect(gated.suppressed).toBe(true);
    expect(gated.contributorCount).toBe(1);
  });

  test('an empty bucket is suppressed', () => {
    expect(suppressBelowK({ value: 0, contributingShopIds: [] }).suppressed).toBe(true);
  });

  test('DISTINCT shops are counted, not entries', () => {
    const duplicated = ['a', 'a', 'b', 'b', 'c', 'c', 'd', 'd'];

    expect(suppressBelowK({ value: 1, contributingShopIds: duplicated }).contributorCount).toBe(4);
    expect(suppressBelowK({ value: 1, contributingShopIds: duplicated }).suppressed).toBe(true);
  });

  test('the floor is on contributors, NOT on the value', () => {
    // A zero value from five shops is publishable; a huge value from one is not.
    expect(suppressBelowK({ value: 0, contributingShopIds: shops(5) }).suppressed).toBe(false);
    expect(suppressBelowK({ value: 10 ** 9, contributingShopIds: shops(1) }).suppressed).toBe(true);
  });

  test('a caller may raise the floor, but the default is five', () => {
    expect(suppressBelowK({ value: 1, contributingShopIds: shops(5) }, 10).suppressed).toBe(true);
    expect(suppressBelowK({ value: 1, contributingShopIds: shops(5) }).suppressed).toBe(false);
  });
});

describe('a series point is gated independently', () => {
  const series = suppressSeriesBelowK([
    { value: 10, contributingShopIds: shops(6) },
    { value: 20, contributingShopIds: shops(4) },
    { value: 30, contributingShopIds: shops(5) },
  ]);

  test('only the thin point is withheld', () => {
    expect(series.map((point) => point.suppressed)).toEqual([false, true, false]);
  });

  test('a suppressed point is ABSENT from a chart, not plotted as zero', () => {
    const { points, withheld } = visiblePoints(series);

    expect(points).toEqual([10, 30]);
    expect(withheld).toBe(1);
    // Plotting a gap as zero would draw a cliff that is not in the data.
    expect(points).not.toContain(0);
  });

  test('a fully suppressed series yields no points and says how many were withheld', () => {
    const thin = suppressSeriesBelowK([
      { value: 1, contributingShopIds: shops(1) },
      { value: 2, contributingShopIds: shops(2) },
    ]);

    expect(visiblePoints(thin)).toEqual({ points: [], withheld: 2 });
  });
});

describe('rendering and exporting a suppressed value', () => {
  const visible = suppressBelowK({ value: 5_000, contributingShopIds: shops(5) });
  const hidden = suppressBelowK({ value: 5_000, contributingShopIds: shops(4) });
  const format = (value: number): string => '৳' + (value / 100).toFixed(2);

  test('a visible value is formatted', () => {
    expect(displaySuppressed(visible, format)).toBe('৳50.00');
  });

  test('a suppressed value renders as the em dash', () => {
    expect(displaySuppressed(hidden, format)).toBe(SUPPRESSED_DISPLAY);
    expect(SUPPRESSED_DISPLAY).toBe('—');
  });

  test('a suppressed EXPORT cell is empty, not a placeholder a spreadsheet would total', () => {
    expect(exportSuppressed(hidden, format)).toBe(SUPPRESSED_EXPORT);
    expect(SUPPRESSED_EXPORT).toBe('');
    // Specifically NOT a zero and NOT the em dash: an export is read by
    // software, and '—' in a numeric column is a parse error waiting to happen.
    expect(exportSuppressed(hidden, format)).not.toBe('0');
    expect(exportSuppressed(hidden, format)).not.toBe(SUPPRESSED_DISPLAY);
  });

  test('the formatter is NEVER called for a suppressed value', () => {
    // A formatter that logged, cached or otherwise observed its input would
    // otherwise see the figure that was meant to be withheld.
    let calls = 0;
    const observing = (value: number): string => {
      calls += 1;
      return String(value);
    };

    displaySuppressed(hidden, observing);
    exportSuppressed(hidden, observing);

    expect(calls).toBe(0);
  });

  test('MUTATION: a 4-shop bucket left visible is caught', () => {
    // The guard stated as the failure it prevents: lower the floor and the
    // bucket comes out.
    expect(suppressBelowK({ value: 5_000, contributingShopIds: shops(4) }, 4).suppressed)
      .toBe(false);
    // ...and with the real floor it is withheld.
    expect(suppressBelowK({ value: 5_000, contributingShopIds: shops(4) }).suppressed).toBe(true);
  });
});
