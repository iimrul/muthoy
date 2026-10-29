// Batch 3 §6i — the financial-provenance evidence suite.
//
// Gate 5 round 9 demonstrated three substitutions that rendered the WRONG
// MONEY under a pharmacy-net caption, through the real pages, confirmed by
// SSR. All three passed a 45-assertion source-scanning guard and produced zero
// TypeScript diagnostics, which is why the guard was replaced rather than
// patched a tenth time.
//
// This file is the evidence that the replacement actually holds. Every claim
// is EXECUTED: the substitutions are applied to the real rendering path and
// rendered with `react-dom/server`, the compile-negative cases are handed to
// the real TypeScript compiler and its diagnostics are read, and each
// protection is mutated to show the test fails without it.
//
// WHAT IS PROVED, and what is not. These tests prove that a value which did
// not come through `netSalesPaisa`/`sumNetSales` cannot appear under a
// pharmacy-net label. They do NOT prove the arithmetic is right or that the
// rows were windowed correctly — the producer tests below and the W4-04 tests
// cover that, and the distinction is stated in netSales.ts itself. Conflating
// the two would be the same overclaiming the source guard was guilty of.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';
import { asPaisa } from '@muthoy/types';
import {
  isNetSales,
  netSalesAmount,
  netSalesPaisa,
  NetSalesProvenanceError,
  sumNetSales,
  type NetSales,
} from '@muthoy/utils';
import NetSalesCard from '../components/NetSalesCard';
import { requirePharmacySalesMetric } from './adminMetrics';
import { suppressBelowK } from './adminSuppression';

const NET_TODAY = requirePharmacySalesMetric('pharmacy_sales_net_today');
const NET_ALL_TIME = requirePharmacySalesMetric('pharmacy_sales_net');

describe('§6i the trusted producer', () => {
  test('the arithmetic is unchanged: gross minus refunds, in paisa', () => {
    const net = netSalesPaisa(asPaisa(10_000), asPaisa(2_000));
    expect(netSalesAmount(net)).toBe(8_000);
  });

  test('it still goes NEGATIVE when refunds exceed sales', () => {
    // W4-04's deliberate behaviour: a refund against an earlier day's invoice
    // genuinely nets below zero, and clamping would hide money leaving the
    // till. §6i must not have changed this.
    const net = netSalesPaisa(asPaisa(1_000), asPaisa(2_500));
    expect(netSalesAmount(net)).toBe(-1_500);
  });

  test('zero is a real, authentic value rather than an absence', () => {
    const net = netSalesPaisa(asPaisa(0), asPaisa(0));
    expect(isNetSales(net)).toBe(true);
    expect(netSalesAmount(net)).toBe(0);
  });

  test('sums of authentic parts are authentic, and add up', () => {
    const months = [
      netSalesPaisa(asPaisa(5_000), asPaisa(1_000)),
      netSalesPaisa(asPaisa(3_000), asPaisa(500)),
    ];
    const total = sumNetSales(months);

    expect(isNetSales(total)).toBe(true);
    expect(netSalesAmount(total)).toBe(6_500);
  });

  test('an empty sum is an authentic zero, not a throw', () => {
    const total = sumNetSales([]);
    expect(isNetSales(total)).toBe(true);
    expect(netSalesAmount(total)).toBe(0);
  });

  test('every producer returns a DISTINCT object, so identity is not shared', () => {
    const a = netSalesPaisa(asPaisa(1), asPaisa(0));
    const b = netSalesPaisa(asPaisa(1), asPaisa(0));
    expect(a).not.toBe(b);
    expect(netSalesAmount(a)).toBe(netSalesAmount(b));
  });
});

describe('§6i forgery and laundering are refused', () => {
  test('a plain number is not authentic', () => {
    expect(isNetSales(8_000)).toBe(false);
    expect(isNetSales(asPaisa(8_000))).toBe(false);
  });

  test('a hand-built object is not authentic, however it is shaped', () => {
    for (const forged of [
      {},
      { paisa: 8_000 },
      { __netBrand: true, paisa: 8_000 },
      Object.create(null),
      [8_000],
    ]) {
      expect(isNetSales(forged), JSON.stringify(forged)).toBe(false);
    }
  });

  test('a COPY of an authentic value is not authentic', () => {
    // The reason the register is a WeakSet rather than a property: a property
    // survives a spread or a clone, and set membership does not.
    const real = netSalesPaisa(asPaisa(10_000), asPaisa(2_000));

    expect(isNetSales({ ...(real as unknown as object) })).toBe(false);
    expect(isNetSales(Object.assign({}, real))).toBe(false);
    expect(isNetSales(structuredClone(real as unknown as object))).toBe(false);
  });

  test('an authentic value cannot be MUTATED after the fact', () => {
    const real = netSalesPaisa(asPaisa(10_000), asPaisa(2_000));
    expect(Object.isFrozen(real)).toBe(true);

    // Silent in sloppy mode, throws in strict; either way the amount stands.
    try {
      (real as unknown as { paisa: number }).paisa = 999;
    } catch {
      // A TypeError here is the frozen object refusing, which is the point.
    }
    expect(netSalesAmount(real)).toBe(8_000);
  });

  test('unwrapping a non-authentic value THROWS rather than answering', () => {
    // A function that answered 0, or NaN, or the input would turn a provenance
    // failure into a plausible figure. That is the outcome §6i exists to stop.
    expect(() => netSalesAmount(8_000 as unknown as NetSales))
      .toThrow(NetSalesProvenanceError);
    expect(() => netSalesAmount({} as unknown as NetSales))
      .toThrow(NetSalesProvenanceError);
  });

  test('summing a NON-net part fails the whole sum', () => {
    // `[...authenticMonths, grossTotal]` is an error, not a total. This is the
    // "authenticating a value from the wrong business calculation" case: the
    // gross figure never went through the subtraction, so it cannot join a
    // net aggregate.
    const authentic = netSalesPaisa(asPaisa(5_000), asPaisa(1_000));
    const grossMasqueradingAsNet = asPaisa(99_999) as unknown as NetSales;

    expect(() => sumNetSales([authentic, grossMasqueradingAsNet]))
      .toThrow(NetSalesProvenanceError);
  });
});

describe('§6i the renderer: ROUND 9 reproduction A, at runtime', () => {
  // `Object.assign(stats, { ['net' + 'SalesToday']: stats.grossSalesToday })`
  // is invisible to every static check: the property name is built from two
  // string literals and the field's declared type is unchanged. Only a runtime
  // provenance check can reach it, and this is that check.

  test('an authentic amount renders the figure under the manifest caption', () => {
    const net = netSalesPaisa(asPaisa(10_000), asPaisa(2_000));
    const html = renderToStaticMarkup(<NetSalesCard metric={NET_TODAY} amount={net} />);

    expect(html).toContain(NET_TODAY.label);
    expect(html).toContain('৳80.00');
    // CLAUDE.md rule 6.
    expect(html).toContain('font-mono');
    // No provenance failure.
    expect(html).not.toContain('role="alert"');
  });

  test('REPRODUCTION A: a gross value assigned over the field renders NO figure', () => {
    // The exact substitution, performed on a real stats-shaped object.
    const stats = {
      grossSalesToday: asPaisa(10_000),
      refundsToday: asPaisa(2_000),
      netSalesToday: netSalesPaisa(asPaisa(10_000), asPaisa(2_000)),
    };
    Object.assign(stats, { ['net' + 'SalesToday']: stats.grossSalesToday });

    const html = renderToStaticMarkup(
      <NetSalesCard metric={NET_TODAY} amount={stats.netSalesToday} />,
    );

    // The gross figure does NOT appear.
    expect(html).not.toContain('৳100.00');
    // Nor does any other figure: it fails closed rather than showing zero or
    // an em dash, either of which would read as a real answer.
    expect(html).not.toContain('৳0.00');
    expect(html).not.toContain('৳80.00');
    // And the failure is visible and announced.
    expect(html).toContain('role="alert"');
    expect(html).toContain('not produced by the refund-net calculation');
    // The caption still names the figure, so an operator can tell WHICH one.
    expect(html).toContain(NET_TODAY.label);
  });

  test('MUTATION: without the runtime check, the same substitution renders gross', () => {
    // The card's protection is `isNetSales(amount)`. This reconstructs the
    // unprotected renderer and shows it publishing ৳100.00 — so the test above
    // is attributable to the check rather than to anything incidental.
    const stats = {
      grossSalesToday: asPaisa(10_000),
      netSalesToday: netSalesPaisa(asPaisa(10_000), asPaisa(2_000)),
    };
    Object.assign(stats, { ['net' + 'SalesToday']: stats.grossSalesToday });

    const unprotected = (amount: unknown) => '৳' + (Number(amount) / 100).toFixed(2);

    expect(unprotected(stats.netSalesToday)).toBe('৳100.00');
    // And the real card refuses the very same value.
    const html = renderToStaticMarkup(
      <NetSalesCard metric={NET_TODAY} amount={stats.netSalesToday} />,
    );
    expect(html).not.toContain('৳100.00');
  });

  test('a withheld figure shows the em dash, and is still not a substitution', () => {
    const net = netSalesPaisa(asPaisa(10_000), asPaisa(2_000));
    const html = renderToStaticMarkup(
      <NetSalesCard metric={NET_ALL_TIME} amount={net} withheld />,
    );

    expect(html).toContain('—');
    expect(html).not.toContain('৳80.00');
    // Suppression is not a provenance failure, and must not look like one.
    expect(html).not.toContain('role="alert"');
  });

  test('k=5 suppression carries the opaque amount through unchanged', () => {
    // `suppressBelowK` is generic, so the amount keeps its identity and the
    // renderer can still verify it. A suppression helper that returned a
    // number would have broken provenance at exactly the wrong place.
    const net = netSalesPaisa(asPaisa(10_000), asPaisa(2_000));
    const belowK = suppressBelowK({ value: net, contributingShopIds: ['a', 'b'] });
    const atK = suppressBelowK({
      value: net,
      contributingShopIds: ['a', 'b', 'c', 'd', 'e'],
    });

    expect(belowK.suppressed).toBe(true);
    expect(atK.suppressed).toBe(false);
    // The visible value is still the SAME authentic object.
    expect(atK.suppressed === false && atK.value === net).toBe(true);
  });
});

describe('§6i compile-negative: the substitutions do not TYPECHECK', () => {
  // Round 9's reproductions B and C produced ZERO TypeScript diagnostics. The
  // point of the opaque type is that they now produce diagnostics, so this
  // suite runs the REAL compiler and reads them. A test that merely asserted
  // "this is a type error" without compiling would prove nothing — and the
  // brief is explicit that a case which never compiled does not count.

  /** Compiles one fixture against the real packages, and returns its errors. */
  function diagnosticsFor(source: string): readonly string[] {
    const dir = mkdtempSync(join(tmpdir(), 'netsales-'));
    const file = join(dir, 'fixture.ts');
    writeFileSync(file, source, 'utf8');
    try {
      const program = ts.createProgram([file], {
        strict: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        skipLibCheck: true,
        paths: {
          '@muthoy/utils': [join(import.meta.dirname, '../../../packages/utils/src/index.ts')],
          '@muthoy/types': [join(import.meta.dirname, '../../../packages/types/src/index.ts')],
        },
      });
      const normalised = file.split('\\').join('/');
      return ts
        .getPreEmitDiagnostics(program)
        .filter((entry) => entry.file?.fileName === normalised)
        .map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, ' '));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const PRELUDE = [
    "import { asPaisa } from '@muthoy/types';",
    "import { netSalesPaisa, sumNetSales, type NetSales } from '@muthoy/utils';",
    'const authentic: NetSales = netSalesPaisa(asPaisa(10000), asPaisa(2000));',
    'const collectedTotalPaisa = asPaisa(23000);',
    'const grossSalesToday = asPaisa(10000);',
    'declare function takesNet(amount: NetSales): void;',
    '',
  ].join('\n');

  test('the PRELUDE itself compiles clean, or every case below is vacuous', () => {
    // The non-vacuity gate the brief asks for: if the fixture could not
    // resolve `@muthoy/utils`, every "this is rejected" case would pass for
    // the wrong reason.
    const diagnostics = diagnosticsFor(PRELUDE + 'takesNet(authentic);\n');
    expect(diagnostics, 'the fixture harness itself is broken').toEqual([]);
  });

  test('REPRODUCTION B: a laundered collected total cannot be supplied as net', () => {
    const diagnostics = diagnosticsFor(
      PRELUDE + 'takesNet(((_amount: number) => Number(collectedTotalPaisa))(0));\n',
    );
    expect(diagnostics.length, 'the laundered collected total was accepted').toBeGreaterThan(0);
    expect(diagnostics.join(' ')).toContain('NetSales');
  });

  test('REPRODUCTION C: a formatted string cannot be supplied as net', () => {
    const diagnostics = diagnosticsFor(
      PRELUDE + 'takesNet(((_: string) => "x")("y"));\n',
    );
    expect(diagnostics.length, 'a formatted string was accepted').toBeGreaterThan(0);
  });

  test('a GROSS paisa amount cannot be supplied as net', () => {
    const diagnostics = diagnosticsFor(PRELUDE + 'takesNet(grossSalesToday);\n');
    expect(diagnostics.length, 'gross was accepted as net').toBeGreaterThan(0);
  });

  test('a COLLECTED paisa amount cannot be supplied as net', () => {
    const diagnostics = diagnosticsFor(PRELUDE + 'takesNet(collectedTotalPaisa);\n');
    expect(diagnostics.length, 'collected was accepted as net').toBeGreaterThan(0);
  });

  test('a gross amount cannot be summed into a net total', () => {
    const diagnostics = diagnosticsFor(
      PRELUDE + 'sumNetSales([authentic, grossSalesToday]);\n',
    );
    expect(diagnostics.length, 'gross joined a net aggregate').toBeGreaterThan(0);
  });

  test('a DOUBLE ASSERTION still compiles — which is why the runtime check exists', () => {
    // Stated rather than hidden. `x as unknown as NetSales` defeats any type,
    // in any language with assertions, so the type is not the whole defence.
    // The runtime register is, and the suite above proves such a value is
    // refused at the renderer.
    const diagnostics = diagnosticsFor(
      PRELUDE + 'takesNet(grossSalesToday as unknown as NetSales);\n',
    );
    expect(diagnostics).toEqual([]);
    expect(isNetSales(asPaisa(10_000) as unknown as NetSales)).toBe(false);
  });
});

describe('§6i the shipped pages use the trusted path', () => {
  // Structural, and deliberately small: the real guarantees are the type and
  // the renderer, both exercised above. This only checks that the pages are
  // wired to them, which is the one thing a type cannot say about itself.

  function source(relative: string): string {
    return readFileSync(join(import.meta.dirname, '..', relative), 'utf8');
  }

  test('the Dashboard hands the opaque amount to the net card', () => {
    const page = source('app/page.tsx');
    expect(page).toContain('<NetSalesCard');
    expect(page).toContain('amount={stats.netSalesToday}');
    // It does not format the net figure itself any more.
    expect(page).not.toContain('formatMoney(stats.netSalesToday)');
  });

  test('the Revenue page aggregates with sumNetSales, not with Number()', () => {
    const page = source('app/revenue/page.tsx');
    expect(page).toContain('sumNetSales(');
    expect(page).toContain('<NetSalesCard');

    // The laundering shape round 9 used is gone -- stated PRECISELY, because
    // the collected-payments trend on this same page legitimately coerces its
    // own `month.totalPaisa`, which is still a plain `Paisa`. The two buckets
    // share a field name, so a bare `Number(month.totalPaisa)` search cannot
    // tell them apart and would fail on correct code. The real claim is that
    // the PHARMACY bucket is never coerced.
    const pharmacyLines = page
      .split(String.fromCharCode(10))
      .filter((line) => line.includes('pharmacySalesByMonth'));
    expect(pharmacyLines.length, 'the pharmacy bucket is not read here').toBeGreaterThan(0);
    for (const line of pharmacyLines) {
      expect(line, 'the pharmacy bucket is coerced: ' + line.trim()).not.toContain('Number(');
    }
  });

  test('the Analytics chart unwraps EXPLICITLY, and verifies while doing it', () => {
    const page = source('app/analytics/page.tsx');
    expect(page).toContain('netSalesAmount(bucket.totalPaisa)');
  });
});
