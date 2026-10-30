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
  dayReleasable,
  daysReleasable,
  displaySuppressed,
  exportSuppressed,
  suppressBelowK,
  suppressSeriesBelowK,
  visiblePoints,
  withheldSide,
  type DaySides,
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


describe('FOUNDER DECISION 3: a zero refund side is protected, and a quiet day is not', () => {
  const day = (sellers: number, refunders: number): DaySides => ({
    day: '2026-10-01',
    saleShopIds: shops(sellers),
    refundShopIds: shops(refunders),
  });

  test('ORDINARY ZERO: pharmacies sold and none refunded — withheld, naming the refund side', () => {
    // The disclosure, stated as the numbers: ten sold, none refunded, so a
    // published figure says every one of those ten refunded NOTHING. Unlike
    // five-of-ten, the set of zero-refunders is fully identified because it is
    // all of them, and there is no crowd for k to hide anyone in.
    expect(withheldSide(day(10, 0))).toBe('refund');
    expect(dayReleasable(day(10, 0))).toBe(false);
  });

  test('NOBODY TRADED: no sales and no refunds — releasable, because no zero belongs to anyone', () => {
    expect(withheldSide(day(0, 0))).toBe(null);
    expect(dayReleasable(day(0, 0))).toBe(true);
  });

  test('the boundary on the refund side is the same k, and it is exact', () => {
    expect(withheldSide(day(10, SUPPRESSION_K - 1))).toBe('refund');
    expect(withheldSide(day(10, SUPPRESSION_K))).toBe(null);
  });

  test('the SALE side is reported first when both fail, because an operator can act on it', () => {
    expect(withheldSide(day(1, 0))).toBe('sale');
  });

  test('COHORT DIFFERENCE: the same refunder counted twice is still one pharmacy', () => {
    // Five refund ROWS from one shop is not five contributors. The floor is on
    // distinct pharmacies, which is the only thing that makes it a floor.
    expect(
      withheldSide({
        day: '2026-10-01',
        saleShopIds: shops(10),
        refundShopIds: ['shop-0', 'shop-0', 'shop-0', 'shop-0', 'shop-0'],
      }),
    ).toBe('refund');
  });

  test('A QUIET DAY INSIDE A MONTH does not withhold the month', () => {
    // The over-withholding this rule was shaped to avoid. A Friday on which
    // nobody traded discloses nothing, so a month containing one must still be
    // able to publish -- otherwise every real month is withheld and the rule
    // asserts nothing.
    const month: readonly DaySides[] = [
      day(10, SUPPRESSION_K),
      { day: '2026-10-02', saleShopIds: [], refundShopIds: [] },
      { day: '2026-10-03', saleShopIds: shops(10), refundShopIds: shops(SUPPRESSION_K) },
    ];

    expect(daysReleasable(month)).toBe(true);
  });

  test('ONE zero-refund trading day withholds the whole month', () => {
    const month: readonly DaySides[] = [
      day(10, SUPPRESSION_K),
      { day: '2026-10-02', saleShopIds: shops(10), refundShopIds: [] },
    ];

    expect(daysReleasable(month)).toBe(false);
  });

  test('OVERLAPPING PERIODS: a month and a wider window containing it agree', () => {
    // Differencing needs two answers that differ. September alone and
    // September-plus-October are evaluated by the same per-day rule, so a day
    // that withholds one withholds the other; there is no window in which the
    // same day is releasable and not releasable.
    const september: readonly DaySides[] = [
      { day: '2026-09-30', saleShopIds: shops(10), refundShopIds: [] },
    ];
    const both: readonly DaySides[] = [...september, day(10, SUPPRESSION_K)];

    expect(daysReleasable(september)).toBe(false);
    expect(daysReleasable(both)).toBe(false);
  });

  test('ROUND 3 FINDING 3: a REFUND-ONLY day is withheld, and a dead day is not', () => {
    // My exemption said `saleShopIds.length === 0`, meaning "nobody traded".
    // It also matched a day with no sales and ONE refund -- a refund against a
    // sale made earlier -- and let it through, which discloses that one
    // pharmacy's refund. The intent was always both sides empty.
    expect(withheldSide(day(0, 1))).toBe('refund');
    expect(withheldSide(day(0, 0))).toBe(null);
  });

  test('ROUND 3 FINDING 3: a month checks BOTH sides of every day', () => {
    // `daysReleasable` used to check only the refund side, justified by
    // per-pharmacy GROSS being published -- so gating sales protected nothing.
    // FOUNDER DECISION 1 removed that gross, which voided the justification and
    // left a real hole: (1 seller, 5 refunders) failed `dayReleasable` and
    // PASSED `daysReleasable`, so a month could be composed from a day that
    // identifies its single seller.
    const thinSellerDay = day(1, SUPPRESSION_K);

    expect(dayReleasable(thinSellerDay)).toBe(false);
    expect(daysReleasable([thinSellerDay])).toBe(false);
    // And the two agree on a day that clears both floors.
    expect(daysReleasable([day(SUPPRESSION_K, SUPPRESSION_K)])).toBe(true);
  });

  test('MUTATION: restoring the empty-set exemption reopens the zero disclosure', () => {
    // The rule stated as the defect it prevents. The old predicate was
    // `ids.length === 0 || distinctCount(ids) >= k`, so an empty refund list
    // passed. Reproduced here as the arithmetic rather than by editing the
    // module: ten sellers, zero refunders, and the old disjunction answers
    // TRUE where the shipped rule answers FALSE.
    const sides = day(10, 0);
    const oldRule = sides.refundShopIds.length === 0
      || new Set(sides.refundShopIds).size >= SUPPRESSION_K;

    expect(oldRule).toBe(true);
    expect(dayReleasable(sides)).toBe(false);
  });
});
