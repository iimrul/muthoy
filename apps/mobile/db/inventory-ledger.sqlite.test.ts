import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { invoiceSuffix } from '../domain/invoice';
import { sqlite } from './test/expo-sqlite';
import { withoutLedgerDeleteGuard } from './test/ledger';

// Multi-device inventory consistency, on real SQLite with the real ledger
// triggers (migration 0006) installed.
//
// HOW TWO DEVICES ARE MODELLED. A movement's delta is computed from the
// QUANTITY SOLD, never from the stock the device happened to observe — that
// independence is the entire point of the design, and it is what these tests
// exercise. So "device A sells 2 while device B sells 2" is faithfully
// represented as two independently-produced -2 movements that both reach the
// same store, which is exactly what `applyRemoteRows` does when a pull
// delivers another phone's rows. No amount of interleaving can change the
// outcome, because addition commutes and each movement applies at most once.
//
// The two halves that together prove the product requirement:
//   (a) a real sale EMITS a delta and no absolute  -> the `emits` test below
//   (b) deltas from any number of devices COMBINE correctly -> the rest
// Either half alone would be insufficient; the old code failed (a).

const { db } = await import('./client');
const { batches, medicines, roles, shops, users } = await import('./schema');
const { applyRemoteRows, listPendingSyncRows, markSyncRowSent } = await import('./sync-helpers');
const { createSaleTransaction } = await import('./sales');
const { displayableStock, ledgerSum } = await import('./stockLedger');
const { eq } = await import('drizzle-orm');

const SHOP_ID = '20000000-0000-4000-8000-000000000001';
const ROLE_ID = '20000000-0000-4000-8000-000000000002';
const USER_ID = '20000000-0000-4000-8000-000000000003';
const MEDICINE_ID = '20000000-0000-4000-8000-000000000004';
const BATCH_ID = '20000000-0000-4000-8000-000000000005';
const NOW = '2026-08-18T09:00:00.000Z';

function applyMigration(fileName: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', fileName), 'utf8'));
}

/** The projection the shop actually sees. */
function stock(): number {
  return (
    sqlite.prepare('SELECT stock FROM batches WHERE id = ?').all(BATCH_ID) as { stock: number }[]
  )[0]!.stock;
}

function oversoldAt(): string | null {
  return (
    sqlite.prepare('SELECT oversold_at FROM batches WHERE id = ?').all(BATCH_ID) as {
      oversold_at: string | null;
    }[]
  )[0]!.oversold_at;
}

function movementCount(): number {
  return (
    sqlite
      .prepare('SELECT count(*) AS n FROM inventory_movements WHERE batch_id = ?')
      .all(BATCH_ID) as { n: number }[]
  )[0]!.n;
}

/**
 * One device's outbound movement, as it appears on the wire: snake_case,
 * carrying its own immutable id. Building these by hand is how a SECOND phone
 * is represented — this process only has one database.
 */
function remoteMovement(
  id: string,
  changeQty: number,
  reason: 'sale' | 'purchase' | 'return' | 'adjustment',
  at = NOW,
): { tableName: 'inventory_movements'; row: Record<string, unknown> } {
  return {
    tableName: 'inventory_movements',
    row: {
      id,
      shop_id: SHOP_ID,
      batch_id: BATCH_ID,
      change_qty: changeQty,
      reason,
      ref_id: null,
      created_by: USER_ID,
      created_at: at,
      updated_at: at,
      is_deleted: false,
      deleted_at: null,
      deleted_by: null,
    },
  };
}

/** Everything this device is waiting to push, grouped by table. */
function outboxByTable(): Record<string, Record<string, unknown>[]> {
  const grouped: Record<string, Record<string, unknown>[]> = {};
  for (const row of listPendingSyncRows(SHOP_ID, 500)) {
    (grouped[row.tableName] ??= []).push(JSON.parse(row.payload) as Record<string, unknown>);
  }
  return grouped;
}

function drainOutbox(): void {
  for (const row of listPendingSyncRows(SHOP_ID, 500)) {
    markSyncRowSent(row.id);
  }
}

/** Rewinds to a known opening quantity by replacing the whole ledger. */
function resetBatchTo(quantity: number): void {
  withoutLedgerDeleteGuard(() => {
    sqlite.exec('DELETE FROM inventory_movements');
  });
  sqlite.exec('DELETE FROM sale_items');
  sqlite.exec('DELETE FROM sales');
  sqlite.exec('DELETE FROM sync_queue');
  sqlite.exec('DELETE FROM cash_drawer');
  sqlite.prepare('UPDATE batches SET stock = 0, oversold_at = NULL WHERE id = ?').run(BATCH_ID);
  if (quantity !== 0) {
    applyRemoteRows([remoteMovement(`opening-${quantity}`, quantity, 'purchase')]);
  }
  drainOutbox();
}

beforeAll(() => {
  applyMigration('0000_open_senator_kelly.sql');
  applyMigration('0001_medicines_fts.sql');
  applyMigration('0002_furry_celestials.sql');
  applyMigration('0003_curious_wild_pack.sql');
  applyMigration('0004_deep_boomer.sql');
  applyMigration('0005_eminent_legion.sql');
  applyMigration('0006_inventory_movement_ledger.sql');
  applyMigration('0007_staff_device_login.sql');

  db.insert(shops).values({ id: SHOP_ID, ownerId: USER_ID, name: 'Ledger Shop', phone: '01700000900', createdAt: NOW, updatedAt: NOW }).run();
  db.insert(roles).values({ id: ROLE_ID, shopId: SHOP_ID, name: 'owner', isSystem: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(users).values({ id: USER_ID, shopId: SHOP_ID, name: 'Owner', phone: '01700000900', pinHash: 'hash', pinSetAt: NOW, roleId: ROLE_ID, isActive: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(medicines).values({ id: MEDICINE_ID, shopId: SHOP_ID, name: 'Napa', unitOfMeasure: 'piece', threshold: 10, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(batches).values({ id: BATCH_ID, shopId: SHOP_ID, medicineId: MEDICINE_ID, batchNo: 'B1', expiryDate: '2027-01-01', stock: 0, purchasePrice: asPaisa(500), salePrice: asPaisa(800), createdAt: NOW, updatedAt: NOW }).run();
});

beforeEach(() => {
  resetBatchTo(5);
});

describe('1. two devices selling the same batch concurrently', () => {
  it('applies both sales: stock 5, A sells 2, B sells 2, final stock is 1', () => {
    expect(stock()).toBe(5);

    // Neither device saw the other's sale — each computed -2 from its own view
    // of 5, which is precisely the situation that used to lose one of them.
    applyRemoteRows([remoteMovement('device-a-sale', -2, 'sale')]);
    applyRemoteRows([remoteMovement('device-b-sale', -2, 'sale')]);

    expect(stock()).toBe(1);
    expect(ledgerSum(db as never, BATCH_ID)).toBe(1);
  });

  it('reaches the same stock 1 whichever device is applied first', () => {
    applyRemoteRows([remoteMovement('device-b-sale', -2, 'sale')]);
    applyRemoteRows([remoteMovement('device-a-sale', -2, 'sale')]);
    expect(stock()).toBe(1);
  });

  it('reaches stock 1 when both arrive in one pull page', () => {
    applyRemoteRows([
      remoteMovement('device-a-sale', -2, 'sale'),
      remoteMovement('device-b-sale', -2, 'sale'),
    ]);
    expect(stock()).toBe(1);
  });

  it('emits a delta and NEVER an absolute batch quantity — the regression guard', async () => {
    await createSaleTransaction({
      shopId: SHOP_ID,
      staffId: USER_ID,
      isStillActive: () => true,
      paymentType: 'cash',
      amountTendered: asPaisa(1600),
      lines: [{ medicineId: MEDICINE_ID, deductions: [{ batchId: BATCH_ID, quantityDeducted: 2 }], unitPrice: asPaisa(800) }],
    });

    const outbox = outboxByTable();
    // The old code pushed a whole batches row carrying stock=3 here; two of
    // those from two phones is the lost update. There must be none.
    expect(outbox.batches).toBeUndefined();
    expect(outbox.inventory_movements).toHaveLength(1);
    expect(outbox.inventory_movements![0]).toMatchObject({ change_qty: -2, reason: 'sale', batch_id: BATCH_ID });
  });
});

describe('2. a sale and a purchase racing on one batch', () => {
  it('applies both: stock 5, sale -2, purchase +10, final stock is 13', () => {
    applyRemoteRows([remoteMovement('the-sale', -2, 'sale')]);
    applyRemoteRows([remoteMovement('the-purchase', 10, 'purchase')]);
    expect(stock()).toBe(13);
  });

  it('reaches 13 with the purchase applied first — order cannot matter', () => {
    applyRemoteRows([remoteMovement('the-purchase', 10, 'purchase')]);
    applyRemoteRows([remoteMovement('the-sale', -2, 'sale')]);
    expect(stock()).toBe(13);
  });
});

describe('3. duplicate delivery of one sync event', () => {
  it('applies a redelivered movement exactly once', () => {
    const event = remoteMovement('delivered-twice', -2, 'sale');

    applyRemoteRows([event]);
    expect(stock()).toBe(3);

    applyRemoteRows([event]);
    expect(stock()).toBe(3);
    expect(movementCount()).toBe(2); // the +5 opening and this one sale
  });

  it('deduplicates a movement repeated inside a single pull page', () => {
    const event = remoteMovement('page-duplicate', -2, 'sale');
    applyRemoteRows([event, event]);
    expect(stock()).toBe(3);
  });
});

describe('4. crash and retry mid-apply', () => {
  it('applies a movement once across an interrupted-then-retried delivery', () => {
    const page = [
      remoteMovement('crash-1', -1, 'sale'),
      remoteMovement('crash-2', -1, 'sale'),
    ];

    // First attempt: the process dies after the page is applied but before the
    // cursor is persisted, so the very same page is delivered again on restart.
    applyRemoteRows(page);
    expect(stock()).toBe(3);

    applyRemoteRows(page);
    expect(stock()).toBe(3);
    expect(movementCount()).toBe(3);
  });

  it('survives a partially-applied page being replayed in full', () => {
    applyRemoteRows([remoteMovement('partial-1', -1, 'sale')]);
    applyRemoteRows([
      remoteMovement('partial-1', -1, 'sale'),
      remoteMovement('partial-2', -1, 'sale'),
    ]);
    expect(stock()).toBe(3);
  });
});

describe('5. concurrent FEFO sales cannot over-decrement', () => {
  it('keeps the ledger exact when two devices each take 3 from a batch of 5', () => {
    applyRemoteRows([remoteMovement('fefo-a', -3, 'sale')]);
    applyRemoteRows([remoteMovement('fefo-b', -3, 'sale')]);

    // -1, not 2 and not 0: both sales are recorded in full. Neither was
    // silently dropped to keep the number non-negative, and neither
    // overwrote the other.
    expect(stock()).toBe(-1);
    expect(ledgerSum(db as never, BATCH_ID)).toBe(-1);
    expect(movementCount()).toBe(3);
  });

  it('refuses a local over-deduction on the device that can see the shortfall', async () => {
    await expect(
      createSaleTransaction({
        shopId: SHOP_ID,
        staffId: USER_ID,
        isStillActive: () => true,
        paymentType: 'cash',
        amountTendered: asPaisa(8000),
        lines: [{ medicineId: MEDICINE_ID, deductions: [{ batchId: BATCH_ID, quantityDeducted: 9 }], unitPrice: asPaisa(800) }],
      }),
    ).rejects.toThrow(/has 5 in stock; 9 requested/);

    // Rejected before anything committed: stock intact, nothing queued.
    expect(stock()).toBe(5);
    expect(outboxByTable().inventory_movements).toBeUndefined();
  });
});

describe('6. offline movements from two devices reconcile', () => {
  it('loses nothing when a day of both devices\' offline work syncs at once', () => {
    // Device A, offline all day: three sales. Device B, also offline: a
    // delivery received and one sale. Everything reconnects together.
    applyRemoteRows([
      remoteMovement('a-1', -1, 'sale'),
      remoteMovement('a-2', -2, 'sale'),
      remoteMovement('a-3', -1, 'sale'),
    ]);
    applyRemoteRows([
      remoteMovement('b-1', 20, 'purchase'),
      remoteMovement('b-2', -3, 'sale'),
    ]);

    expect(stock()).toBe(18); // 5 - 1 - 2 - 1 + 20 - 3
    expect(ledgerSum(db as never, BATCH_ID)).toBe(18);
    expect(movementCount()).toBe(6);
  });

  it('is unaffected by the order the two devices happen to reconnect in', () => {
    applyRemoteRows([remoteMovement('b-1', 20, 'purchase'), remoteMovement('b-2', -3, 'sale')]);
    applyRemoteRows([
      remoteMovement('a-1', -1, 'sale'),
      remoteMovement('a-2', -2, 'sale'),
      remoteMovement('a-3', -1, 'sale'),
    ]);
    expect(stock()).toBe(18);
  });

  it('covers returns and adjustments by the same rule', () => {
    applyRemoteRows([
      remoteMovement('sale', -4, 'sale'),
      remoteMovement('sale-return', 2, 'return'),
      remoteMovement('purchase-return', -1, 'return'),
      remoteMovement('stock-count', 3, 'adjustment'),
    ]);
    expect(stock()).toBe(5); // 5 - 4 + 2 - 1 + 3
  });
});

describe('7. offline oversell has an explicit, deterministic result', () => {
  it('keeps every movement, drives the ledger negative, and marks the batch', () => {
    expect(oversoldAt()).toBeNull();

    applyRemoteRows([remoteMovement('over-a', -4, 'sale')]);
    applyRemoteRows([remoteMovement('over-b', -4, 'sale')]);

    // Deterministic policy: the sales happened, so the movements are kept and
    // the shortfall is made visible rather than quietly absorbed.
    expect(stock()).toBe(-3);
    expect(oversoldAt()).not.toBeNull();
    expect(movementCount()).toBe(3);
    // What the shop is SHOWN never goes negative; the ledger keeps the truth.
    expect(displayableStock(stock())).toBe(0);
  });

  it('clears back to a positive figure when the shortfall is restocked', () => {
    applyRemoteRows([remoteMovement('over-a', -4, 'sale'), remoteMovement('over-b', -4, 'sale')]);
    expect(stock()).toBe(-3);

    applyRemoteRows([remoteMovement('restock', 10, 'purchase')]);
    expect(stock()).toBe(7);
    // The marker persists: the shop still needs to know a recount happened.
    expect(oversoldAt()).not.toBeNull();
  });
});

describe('8. the second device observes the resulting quantity', () => {
  it('reflects the other phone\'s sale as soon as its movement is pulled', () => {
    expect(stock()).toBe(5);

    // What sync/realtime.ts triggers: the other device sold 2, its movement
    // arrives on the next incremental pull, and this device's projection moves
    // without any absolute quantity crossing the wire.
    applyRemoteRows([remoteMovement('other-phone-sale', -2, 'sale')]);

    expect(stock()).toBe(3);
  });

  it('ignores a remote batch row\'s stock, deriving the quantity from movements', () => {
    applyRemoteRows([remoteMovement('local-unpushed-sale', -2, 'sale')]);
    expect(stock()).toBe(3);

    // A batches row arrives carrying a stale absolute (and a newer timestamp,
    // so LWW would accept it). Metadata must land; the quantity must not.
    applyRemoteRows([
      {
        tableName: 'batches',
        row: {
          id: BATCH_ID, shop_id: SHOP_ID, medicine_id: MEDICINE_ID,
          batch_no: 'B1', expiry_date: '2027-01-01',
          stock: 999, oversold_at: null,
          purchase_price: 500, sale_price: 950,
          is_discounted: false, original_price: null,
          created_at: NOW, updated_at: '2026-08-19T09:00:00.000Z',
          is_deleted: false, deleted_at: null, deleted_by: null,
        },
      },
    ]);

    expect(stock()).toBe(3); // not 999
    const row = db.select().from(batches).where(eq(batches.id, BATCH_ID)).get()!;
    expect(row.salePrice).toBe(950); // metadata still last-write-wins
  });
});

describe('9. the existing single-device sale is unchanged', () => {
  it('deducts correctly, prices correctly, and stays fast', async () => {
    const startedAt = Date.now();
    const result = await createSaleTransaction({
      shopId: SHOP_ID,
      staffId: USER_ID,
      isStillActive: () => true,
      paymentType: 'cash',
      amountTendered: asPaisa(2000),
      lines: [{ medicineId: MEDICINE_ID, deductions: [{ batchId: BATCH_ID, quantityDeducted: 2 }], unitPrice: asPaisa(800) }],
    });
    const elapsed = Date.now() - startedAt;

    expect(result.total).toBe(1600);
    expect(result.change).toBe(400);
    // The invoice carries the collision-proof suffix, derived from this very
    // sale's UUID — proves the wiring, not just domain/invoice.ts in isolation.
    expect(result.invoiceNo).toMatch(/^INV-\d{4}-\d{6}-[0-9A-F]{12}$/);
    expect(result.invoiceNo.endsWith(invoiceSuffix(result.saleId))).toBe(true);
    expect(stock()).toBe(3);
    expect(ledgerSum(db as never, BATCH_ID)).toBe(3);
    // Local SQLite writes stay interactive — the ledger added an insert, not a
    // round trip. Generous bound: a smoke check against accidentally
    // introducing a network call or a full-table scan, not a benchmark.
    expect(elapsed).toBeLessThan(250);
  });

  it('keeps stock and ledger identical across a run of ordinary sales', async () => {
    for (let index = 0; index < 3; index += 1) {
      await createSaleTransaction({
        shopId: SHOP_ID,
        staffId: USER_ID,
        isStillActive: () => true,
        paymentType: 'cash',
        amountTendered: asPaisa(800),
        lines: [{ medicineId: MEDICINE_ID, deductions: [{ batchId: BATCH_ID, quantityDeducted: 1 }], unitPrice: asPaisa(800) }],
      });
    }
    expect(stock()).toBe(2);
    expect(ledgerSum(db as never, BATCH_ID)).toBe(2);
  });
});

describe('10. two independent devices, each with its own offline queue', () => {
  // Sections 1-9 model the second device by hand-building the rows it would
  // have produced. This one goes further: each device gets its own OUTBOX,
  // both start from the same stale snapshot of stock 5, and the merge is done
  // by id the way the server does it. That is what makes "no delta is lost"
  // and "duplicate delivery applies once" separable claims rather than one.

  interface DeviceQueue {
    readonly name: string;
    readonly rows: { tableName: 'inventory_movements'; row: Record<string, unknown> }[];
  }

  /**
   * One phone working offline. `snapshot` is the stock it last saw — and it is
   * deliberately never consulted when building a delta, which is exactly why
   * two devices holding the same stale number cannot corrupt each other.
   */
  function device(name: string, snapshot: number, work: readonly [number, 'sale' | 'purchase' | 'return' | 'adjustment'][]): DeviceQueue {
    expect(snapshot).toBe(5); // both phones genuinely start from the same stale view
    return {
      name,
      rows: work.map(([qty, reason], i) => remoteMovement(`${name}-${i}`, qty, reason)),
    };
  }

  /** The server's merge rule: first writer of an id wins, replays are no-ops. */
  function mergeOnServer(queues: readonly DeviceQueue[]): Map<string, number> {
    const applied = new Map<string, number>();
    for (const queue of queues) {
      for (const { row } of queue.rows) {
        const id = row.id as string;
        if (!applied.has(id)) applied.set(id, row.change_qty as number);
      }
    }
    return applied;
  }

  it('merges both queues losing nothing, whatever the interleaving', () => {
    const a = device('dev-a', stock(), [[-2, 'sale'], [-1, 'sale'], [3, 'return']]);
    const b = device('dev-b', stock(), [[-4, 'sale'], [10, 'purchase']]);

    const expected = 5 + [...mergeOnServer([a, b]).values()].reduce((t, q) => t + q, 0);

    // Delivered interleaved, as two flaky connections actually would: a, b, a…
    applyRemoteRows([a.rows[0]!]);
    applyRemoteRows([b.rows[0]!, b.rows[1]!]);
    applyRemoteRows([a.rows[1]!, a.rows[2]!]);

    expect(stock()).toBe(expected);
    expect(stock()).toBe(11); // 5 - 2 - 1 + 3 - 4 + 10
    expect(ledgerSum(db as never, BATCH_ID)).toBe(stock());
    expect(movementCount()).toBe(6); // opening + 5
  });

  it('applies a duplicated queue exactly once', () => {
    const a = device('dev-a', stock(), [[-2, 'sale'], [-1, 'sale']]);
    const b = device('dev-b', stock(), [[-4, 'sale']]);

    applyRemoteRows([...a.rows, ...b.rows]);
    const afterFirstDelivery = stock();
    expect(afterFirstDelivery).toBe(-2); // 5 - 2 - 1 - 4, legitimately negative

    // Both phones retry their whole outbox — a dropped ack, an app restart
    // mid-push, a pull that re-serves rows the cursor already covered.
    applyRemoteRows([...a.rows, ...b.rows]);
    applyRemoteRows([...b.rows, ...a.rows]);

    expect(stock()).toBe(afterFirstDelivery);
    expect(movementCount()).toBe(4); // opening + 3, not 3 + 9
    expect(ledgerSum(db as never, BATCH_ID)).toBe(stock());
  });

  it('a device that never reconnects loses nothing when it finally does', () => {
    const a = device('dev-a', stock(), [[-2, 'sale']]);
    const b = device('dev-b', stock(), [[-1, 'sale'], [20, 'purchase']]);

    applyRemoteRows(b.rows);
    expect(stock()).toBe(24); // 5 - 1 + 20; A is still dark

    // A comes back a week later. Its delta is still valid — it was never a
    // statement about what the total should be, only about what it sold.
    applyRemoteRows(a.rows);
    expect(stock()).toBe(22);
    expect(ledgerSum(db as never, BATCH_ID)).toBe(22);
  });

  it('documents the oversell outcome when both offline queues outrun real stock', () => {
    const a = device('dev-a', stock(), [[-4, 'sale']]);
    const b = device('dev-b', stock(), [[-4, 'sale']]);

    applyRemoteRows([...a.rows, ...b.rows]);

    // EXPECTED, documented behaviour — not a bug and not an error path:
    //   * both movements are KEPT; the medicine left the shop twice over
    //   * authoritative stock goes NEGATIVE and stays there (-3)
    //   * the batch is flagged oversold so reconciliation can surface a recount
    //   * only the DISPLAYED figure is clamped to 0
    // Refusing the second sale was never an option: device B was offline and
    // could not have known. Dropping its movement would lose a real sale.
    expect(stock()).toBe(-3);
    expect(oversoldAt()).not.toBeNull();
    expect(displayableStock(stock())).toBe(0);
    expect(movementCount()).toBe(3);
    expect(ledgerSum(db as never, BATCH_ID)).toBe(-3);
  });
});
