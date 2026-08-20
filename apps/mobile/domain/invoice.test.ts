import { describe, expect, it } from 'vitest';
import {
  INVOICE_SUFFIX_LENGTH,
  buildPurchaseInvoiceNo,
  buildSaleInvoiceNo,
  invoiceSuffix,
} from './invoice';

// The defect under test: the running number is counted from the LOCAL sales
// table, so two phones selling one shop's stock independently reach the same
// count and mint the same invoice number. The cloud's sales_shop_invoice_unique
// index rejects the second with 23505, which sync/push.ts treats as PERMANENT —
// the sale is dropped from the cloud entirely. These tests pin the property
// that makes that impossible.

/** A v4-shaped UUID whose tail is what the suffix must come from. */
function uuid(tail: string): string {
  return `9f8e7d6c-5b4a-4392-8171-abcdef${tail.padStart(6, '0')}`;
}

describe('format', () => {
  it('is INV-{year}-{6-digit sequence}-{12-char suffix}', () => {
    expect(buildSaleInvoiceNo(2026, 11, '4d3c2b1a-0000-4000-8000-00000000004f')).toBe(
      'INV-2026-000011-00000000004F',
    );
  });

  it('matches the documented shape for any sequence', () => {
    for (const sequence of [1, 9, 10, 999, 1000, 999999]) {
      expect(buildSaleInvoiceNo(2026, sequence, uuid('1a2b3c'))).toMatch(
        /^INV-\d{4}-\d{6}-[0-9A-F]{12}$/,
      );
    }
  });

  it('preserves the readable local sequence, zero-padded to six', () => {
    expect(buildSaleInvoiceNo(2026, 1, uuid('abc'))).toContain('-000001-');
    expect(buildSaleInvoiceNo(2026, 482, uuid('abc'))).toContain('-000482-');
    expect(buildSaleInvoiceNo(2026, 123456, uuid('abc'))).toContain('-123456-');
  });

  it('keeps a sequence wider than six digits intact rather than truncating it', () => {
    // Padding must never become clipping: a shop past a million sales in a year
    // would otherwise start reissuing numbers it had already used.
    expect(buildSaleInvoiceNo(2026, 1234567, uuid('abc'))).toContain('-1234567-');
  });

  it('carries the year through unchanged', () => {
    expect(buildSaleInvoiceNo(2027, 11, uuid('abc')).startsWith('INV-2027-')).toBe(true);
  });
});

describe('suffix derivation', () => {
  it('is the last twelve hex characters of the sale UUID, uppercased', () => {
    expect(invoiceSuffix('9f8e7d6c-5b4a-4392-8171-abcdef0014f2')).toBe('ABCDEF0014F2');
  });

  it('uppercases lowercase hex', () => {
    expect(invoiceSuffix('00000000-0000-4000-8000-00000000abcd')).toBe('00000000ABCD');
  });

  it('is exactly twelve characters and drawn only from hex', () => {
    const suffix = invoiceSuffix(uuid('9e8d7c'));
    expect(suffix).toHaveLength(INVOICE_SUFFIX_LENGTH);
    expect(suffix).toMatch(/^[0-9A-F]{12}$/);
  });

  it('takes the TAIL, not the head — the head is near-constant across v4 UUIDs', () => {
    // Every v4 UUID carries a fixed version nibble and a constrained variant
    // nibble near the front. Two ids that differ only in their random tail must
    // still produce different suffixes, or the whole mechanism is decorative.
    const a = '00000000-0000-4000-8000-000000000001';
    const b = '00000000-0000-4000-8000-000000000002';
    expect(invoiceSuffix(a)).not.toBe(invoiceSuffix(b));
    expect(invoiceSuffix(a)).toBe('000000000001');
    expect(invoiceSuffix(b)).toBe('000000000002');
  });

  it('is deterministic — the same sale id always yields the same suffix', () => {
    const id = uuid('c0ffee');
    expect(invoiceSuffix(id)).toBe(invoiceSuffix(id));
    expect(buildSaleInvoiceNo(2026, 11, id)).toBe(buildSaleInvoiceNo(2026, 11, id));
  });

  it('rejects an id too short to derive a suffix from', () => {
    expect(() => invoiceSuffix('abc-def')).toThrow(/Cannot derive an invoice suffix/);
  });
});

describe('two devices, same year, same local sequence', () => {
  // The exact production collision: neither phone has seen the other's sales,
  // so both count 10 locally and both mint sequence 11.
  const YEAR = 2026;
  const SEQUENCE = 11;
  const deviceASaleId = '11111111-1111-4111-8111-1111111111aa';
  const deviceBSaleId = '22222222-2222-4222-8222-2222222222bb';

  it('produces different invoice numbers', () => {
    const a = buildSaleInvoiceNo(YEAR, SEQUENCE, deviceASaleId);
    const b = buildSaleInvoiceNo(YEAR, SEQUENCE, deviceBSaleId);

    expect(a).toBe('INV-2026-000011-1111111111AA');
    expect(b).toBe('INV-2026-000011-2222222222BB');
    expect(a).not.toBe(b);
  });

  it('still shows the shop the same readable running number on both', () => {
    const a = buildSaleInvoiceNo(YEAR, SEQUENCE, deviceASaleId);
    const b = buildSaleInvoiceNo(YEAR, SEQUENCE, deviceBSaleId);
    // The sequence is deliberately NOT made globally unique. Both phones say
    // "sale 11" because that is what each has sold; uniqueness rides on the
    // suffix, which is what the cloud constraint actually needs.
    const readable = 'INV-2026-000011'.length;
    expect(a.slice(0, readable)).toBe(b.slice(0, readable));
    expect(a.slice(0, readable)).toBe('INV-2026-000011');
  });

  it('survives a whole day of both devices racing on identical sequences', () => {
    // Every sequence from 1..200 minted on both phones at once: 400 invoices,
    // 200 shared sequences, and not one duplicate number.
    // The per-device marker has to live in the LAST four hex characters. Put
    // it anywhere else in the UUID and both phones derive the same suffix —
    // which is exactly the trap the first draft of this test fell into.
    const issued = new Set<string>();
    for (let sequence = 1; sequence <= 200; sequence += 1) {
      const hex = sequence.toString(16).padStart(3, '0');
      issued.add(buildSaleInvoiceNo(YEAR, sequence, `11111111-1111-4111-8111-11111111a${hex}`));
      issued.add(buildSaleInvoiceNo(YEAR, sequence, `22222222-2222-4222-8222-22222222b${hex}`));
    }
    expect(issued.size).toBe(400);
  });

  it('a third device joining mid-year collides with neither', () => {
    const issued = new Set([
      buildSaleInvoiceNo(YEAR, SEQUENCE, deviceASaleId),
      buildSaleInvoiceNo(YEAR, SEQUENCE, deviceBSaleId),
      buildSaleInvoiceNo(YEAR, SEQUENCE, '33333333-3333-4333-8333-3333333333cc'),
    ]);
    expect(issued.size).toBe(3);
  });
});

describe('rejects a sequence that could not have come from a real count', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %p', (sequence) => {
    expect(() => buildSaleInvoiceNo(2026, sequence, uuid('abc'))).toThrow(
      /Invoice sequence must be a positive integer/,
    );
  });
});

describe('purchase invoices', () => {
  // Stock received from a supplier carries the same defect and the same cure:
  // the running number is counted from THIS device's purchases table, so the
  // owner receiving stock on the back-room phone and the manager receiving on
  // the counter phone both reach PUR-2026-000011 and the second is dropped by
  // purchases_shop_invoice_unique.
  it('is PUR-{year}-{6-digit sequence}-{12-char suffix}', () => {
    expect(buildPurchaseInvoiceNo(2026, 11, '4d3c2b1a-0000-4000-8000-00000000004f')).toBe(
      'PUR-2026-000011-00000000004F',
    );
  });

  it('matches the documented shape for any sequence', () => {
    for (const sequence of [1, 9, 10, 999, 1000, 999999]) {
      expect(buildPurchaseInvoiceNo(2026, sequence, uuid('1a2b3c'))).toMatch(
        /^PUR-\d{4}-\d{6}-[0-9A-F]{12}$/,
      );
    }
  });

  it('preserves the readable local sequence, zero-padded to six', () => {
    expect(buildPurchaseInvoiceNo(2026, 1, uuid('abc'))).toContain('-000001-');
    expect(buildPurchaseInvoiceNo(2026, 112, uuid('abc'))).toContain('-000112-');
    expect(buildPurchaseInvoiceNo(2026, 123456, uuid('abc'))).toContain('-123456-');
  });

  it('keeps a sequence wider than six digits intact rather than truncating it', () => {
    expect(buildPurchaseInvoiceNo(2026, 1234567, uuid('abc'))).toContain('-1234567-');
  });

  it('is deterministic — the same purchase id always yields the same number', () => {
    const id = uuid('c0ffee');
    expect(buildPurchaseInvoiceNo(2026, 11, id)).toBe(buildPurchaseInvoiceNo(2026, 11, id));
  });

  it('rejects an id too short to derive a suffix from', () => {
    expect(() => buildPurchaseInvoiceNo(2026, 11, 'abc-def')).toThrow(
      /Cannot derive an invoice suffix/,
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses sequence %p',
    (sequence) => {
      expect(() => buildPurchaseInvoiceNo(2026, sequence, uuid('abc'))).toThrow(
        /Invoice sequence must be a positive integer/,
      );
    },
  );

  it('never collides with a sale that shares its year and sequence', () => {
    // Same shop, same day, same id space: the prefix is what separates the two
    // ledgers, and it has to survive the suffix change.
    const id = uuid('abc');
    expect(buildPurchaseInvoiceNo(2026, 11, id)).not.toBe(buildSaleInvoiceNo(2026, 11, id));
  });
});

describe('two devices receiving stock, same year, same local sequence', () => {
  const YEAR = 2026;
  const SEQUENCE = 11;
  const deviceAPurchaseId = '11111111-1111-4111-8111-1111111111aa';
  const deviceBPurchaseId = '22222222-2222-4222-8222-2222222222bb';

  it('produces different purchase invoice numbers', () => {
    const a = buildPurchaseInvoiceNo(YEAR, SEQUENCE, deviceAPurchaseId);
    const b = buildPurchaseInvoiceNo(YEAR, SEQUENCE, deviceBPurchaseId);

    expect(a).toBe('PUR-2026-000011-1111111111AA');
    expect(b).toBe('PUR-2026-000011-2222222222BB');
    expect(a).not.toBe(b);
  });

  it('still shows the shop the same readable running number on both', () => {
    const a = buildPurchaseInvoiceNo(YEAR, SEQUENCE, deviceAPurchaseId);
    const b = buildPurchaseInvoiceNo(YEAR, SEQUENCE, deviceBPurchaseId);
    const readable = 'PUR-2026-000011'.length;
    expect(a.slice(0, readable)).toBe(b.slice(0, readable));
    expect(a.slice(0, readable)).toBe('PUR-2026-000011');
  });

  it('survives a season of both devices racing on identical sequences', () => {
    // The per-device marker has to live in the LAST four hex characters. Put it
    // anywhere else in the UUID and both phones derive the same suffix.
    const issued = new Set<string>();
    for (let sequence = 1; sequence <= 200; sequence += 1) {
      const hex = sequence.toString(16).padStart(3, '0');
      issued.add(buildPurchaseInvoiceNo(YEAR, sequence, `11111111-1111-4111-8111-11111111a${hex}`));
      issued.add(buildPurchaseInvoiceNo(YEAR, sequence, `22222222-2222-4222-8222-22222222b${hex}`));
    }
    expect(issued.size).toBe(400);
  });

  it('a third device joining mid-year collides with neither', () => {
    const issued = new Set([
      buildPurchaseInvoiceNo(YEAR, SEQUENCE, deviceAPurchaseId),
      buildPurchaseInvoiceNo(YEAR, SEQUENCE, deviceBPurchaseId),
      buildPurchaseInvoiceNo(YEAR, SEQUENCE, '33333333-3333-4333-8333-3333333333cc'),
    ]);
    expect(issued.size).toBe(3);
  });
});
