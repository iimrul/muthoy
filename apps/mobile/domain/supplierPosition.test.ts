import { describe, expect, it } from 'vitest';
import { ZERO_PAISA, addPaisa, asPaisa, subtractPaisa } from '@muthoy/types';
import { computeSupplierPosition, effectivePayableFor, type SupplierPurchaseInput } from './supplierPosition';

function purchase(
  purchaseId: string,
  createdAt: string,
  totalTaka: number,
  paidTaka: number,
  ownReturnCreditTaka = 0,
): SupplierPurchaseInput {
  return {
    purchaseId,
    createdAt,
    total: asPaisa(totalTaka * 100),
    paidAmount: asPaisa(paidTaka * 100),
    ownReturnCredit: asPaisa(ownReturnCreditTaka * 100),
  };
}

describe('computeSupplierPosition', () => {
  it('returns zero payable and zero credit for an empty supplier', () => {
    const position = computeSupplierPosition([]);
    expect(position.invoices).toEqual([]);
    expect(position.outstandingPayable).toBe(ZERO_PAISA);
    expect(position.supplierCredit).toBe(ZERO_PAISA);
  });

  it('a purchase with no return behaves exactly like raw total - paidAmount', () => {
    const position = computeSupplierPosition([purchase('P1', '2026-08-20T00:00:00.000Z', 1000, 300)]);
    expect(position.invoices).toEqual([{
      purchaseId: 'P1',
      originalRemaining: asPaisa(70000),
      returnCreditApplied: ZERO_PAISA,
      supplierCreditApplied: ZERO_PAISA,
      effectivePayable: asPaisa(70000),
    }]);
    expect(position.outstandingPayable).toBe(asPaisa(70000));
    expect(position.supplierCredit).toBe(ZERO_PAISA);
  });

  it('rule A: a return offsets its own purchase remaining first, exactly, when it fits', () => {
    // Total 1000, paid 700 -> remaining 300. Own return 200 fits entirely within it.
    const position = computeSupplierPosition([purchase('P1', '2026-08-20T00:00:00.000Z', 1000, 700, 200)]);
    const [p1] = position.invoices;
    expect(p1?.returnCreditApplied).toBe(asPaisa(20000));
    expect(p1?.effectivePayable).toBe(asPaisa(10000)); // 300 - 200 = 100 taka remaining
    expect(position.supplierCredit).toBe(ZERO_PAISA); // nothing left over
  });

  it("the founder's exact worked example: Supplier Credit ৳2,000 + new invoice remaining ৳5,000 → payable ৳3,000", () => {
    // P1: fully paid at creation (COD), then a ৳2,000 return against it.
    const p1 = purchase('P1', '2026-08-20T00:00:00.000Z', 10000, 10000, 2000);
    // P2: created later, remaining ৳5,000, no return of its own.
    const p2 = purchase('P2', '2026-08-21T00:00:00.000Z', 5000, 0);
    const position = computeSupplierPosition([p1, p2]);

    const found1 = position.invoices.find((i) => i.purchaseId === 'P1');
    const found2 = position.invoices.find((i) => i.purchaseId === 'P2');
    expect(found1?.effectivePayable).toBe(ZERO_PAISA);
    expect(found2?.effectivePayable).toBe(asPaisa(300000)); // ৳3,000
    expect(position.outstandingPayable).toBe(asPaisa(300000));
    expect(position.supplierCredit).toBe(ZERO_PAISA);
  });

  it('rule C: credit exceeding every open invoice combined becomes standalone supplier credit', () => {
    // Only purchase, fully paid, ৳5,000 return against it — nothing to absorb the excess.
    const position = computeSupplierPosition([purchase('P1', '2026-08-20T00:00:00.000Z', 1000, 1000, 5000)]);
    // remaining was already 0 (fully paid), so returnCreditApplied caps at 0,
    // and the FULL 5000 becomes standalone pool/credit.
    expect(position.invoices[0]?.returnCreditApplied).toBe(ZERO_PAISA);
    expect(position.invoices[0]?.effectivePayable).toBe(ZERO_PAISA);
    expect(position.outstandingPayable).toBe(ZERO_PAISA);
    expect(position.supplierCredit).toBe(asPaisa(500000));
  });

  it('rule B: FIFO applies the pool to the OLDEST open invoice first, not an arbitrary one', () => {
    const oldest = purchase('OLD', '2026-08-01T00:00:00.000Z', 1000, 0); // remaining 1000
    const newest = purchase('NEW', '2026-08-10T00:00:00.000Z', 1000, 0); // remaining 1000
    const returnSource = purchase('SRC', '2026-08-05T00:00:00.000Z', 500, 500, 800); // fully paid, generates 800 excess
    const position = computeSupplierPosition([newest, returnSource, oldest]); // deliberately unordered input

    const oldPos = position.invoices.find((i) => i.purchaseId === 'OLD')!;
    const newPos = position.invoices.find((i) => i.purchaseId === 'NEW')!;
    // Oldest purchase (by createdAt) absorbs the pool first: 800 applied to OLD's 1000 remaining.
    expect(oldPos.supplierCreditApplied).toBe(asPaisa(80000));
    expect(oldPos.effectivePayable).toBe(asPaisa(20000));
    // Nothing left for NEW.
    expect(newPos.supplierCreditApplied).toBe(ZERO_PAISA);
    expect(newPos.effectivePayable).toBe(asPaisa(100000));
    expect(position.supplierCredit).toBe(ZERO_PAISA);
  });

  it('stable tiebreak: identical createdAt resolves by purchaseId, deterministically, regardless of input order', () => {
    const same = '2026-08-20T00:00:00.000Z';
    const a = purchase('AAA', same, 1000, 0);
    const b = purchase('BBB', same, 1000, 0);
    const src = purchase('SRC', same, 500, 500, 400);

    const order1 = computeSupplierPosition([src, b, a]);
    const order2 = computeSupplierPosition([a, src, b]);
    // Both orderings must produce the identical result — the algorithm's own
    // internal sort, not input order, decides FIFO. AAA sorts before BBB
    // lexicographically at an identical timestamp.
    expect(order1).toEqual(order2);
    const aaa = order1.invoices.find((i) => i.purchaseId === 'AAA')!;
    expect(aaa.supplierCreditApplied).toBe(asPaisa(40000));
  });

  it('never produces a negative effectivePayable even with malformed over-paid input', () => {
    // paidAmount exceeding total should never happen in practice, but the
    // function must not propagate a negative remaining if it does.
    const position = computeSupplierPosition([purchase('P1', '2026-08-20T00:00:00.000Z', 100, 500)]);
    expect(position.invoices[0]?.effectivePayable).toBe(ZERO_PAISA);
    expect(position.outstandingPayable).toBe(ZERO_PAISA);
  });

  it('effectivePayableFor returns zero for an unknown purchase id', () => {
    const position = computeSupplierPosition([purchase('P1', '2026-08-20T00:00:00.000Z', 1000, 0)]);
    expect(effectivePayableFor(position, 'UNKNOWN')).toBe(ZERO_PAISA);
  });

  describe('invariants (property-style, across many generated scenarios)', () => {
    function randomPurchases(seed: number): SupplierPurchaseInput[] {
      // Deterministic pseudo-random generator (no external dependency) so the
      // test suite stays hermetic and reproducible across runs.
      let state = seed;
      const next = (): number => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
      };
      const count = 1 + Math.floor(next() * 8);
      const list: SupplierPurchaseInput[] = [];
      for (let i = 0; i < count; i += 1) {
        const totalTaka = Math.floor(next() * 10000);
        const isCod = next() > 0.5;
        const paidTaka = isCod ? totalTaka : Math.floor(next() * totalTaka);
        const ownReturnTaka = next() > 0.5 ? Math.floor(next() * totalTaka * 1.5) : 0;
        const day = 1 + Math.floor(next() * 27);
        list.push(purchase(`P${i}-${seed}`, `2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z`, totalTaka, paidTaka, ownReturnTaka));
      }
      return list;
    }

    it('SUM(effectivePayable) === outstandingPayable, always', () => {
      for (let seed = 1; seed <= 50; seed += 1) {
        const position = computeSupplierPosition(randomPurchases(seed));
        const sum = position.invoices.reduce((acc, inv) => addPaisa(acc, inv.effectivePayable), ZERO_PAISA);
        expect(sum).toBe(position.outstandingPayable);
      }
    });

    it('no effectivePayable is ever negative, and outstandingPayable/supplierCredit are never both non-zero', () => {
      for (let seed = 1; seed <= 50; seed += 1) {
        const position = computeSupplierPosition(randomPurchases(seed));
        for (const inv of position.invoices) {
          expect(inv.effectivePayable).toBeGreaterThanOrEqual(0);
          expect(inv.supplierCreditApplied).toBeGreaterThanOrEqual(0);
          expect(inv.returnCreditApplied).toBeGreaterThanOrEqual(0);
        }
        expect(position.outstandingPayable).toBeGreaterThanOrEqual(0);
        expect(position.supplierCredit).toBeGreaterThanOrEqual(0);
        // No double-use / no overpayment: never both a payable AND a credit
        // sitting open at once — one side must be fully zeroed.
        expect(position.outstandingPayable === ZERO_PAISA || position.supplierCredit === ZERO_PAISA).toBe(true);
      }
    });

    it('total credit conservation: SUM(ownReturnCredit) === SUM(returnCreditApplied) + SUM(supplierCreditApplied) + supplierCredit', () => {
      for (let seed = 1; seed <= 50; seed += 1) {
        const input = randomPurchases(seed);
        const position = computeSupplierPosition(input);
        const totalReturnCredit = input.reduce((acc, p) => addPaisa(acc, p.ownReturnCredit), ZERO_PAISA);
        const totalApplied = position.invoices.reduce(
          (acc, inv) => addPaisa(acc, addPaisa(inv.returnCreditApplied, inv.supplierCreditApplied)),
          ZERO_PAISA,
        );
        expect(subtractPaisa(totalReturnCredit, addPaisa(totalApplied, position.supplierCredit))).toBe(ZERO_PAISA);
      }
    });

    it('running the same input twice (idempotent, order-independent) reproduces the identical position', () => {
      for (let seed = 1; seed <= 20; seed += 1) {
        const input = randomPurchases(seed);
        const shuffled = [...input].reverse();
        expect(computeSupplierPosition(input)).toEqual(computeSupplierPosition(shuffled));
      }
    });
  });
});
