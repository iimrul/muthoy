#!/usr/bin/env node
// scripts/generate-history-fixture.mjs — H-11 C2.
//
// Builds a populated, UNENCRYPTED SQLite database that looks like a pharmacy
// that has been trading for a year, so the two things H-3 could not measure
// can finally be measured:
//
//   1. How long the plain -> SQLCipher migration takes at real scale. H-3's
//      sign-off measured 4.3-5.0 s for 249 rows / 811 KB on one low-end device
//      and recorded that a shop with a year of history had NOT been measured.
//   2. Whether the restore drill (backend/supabase/checks/restore_drill.md)
//      completes on a database that is not a toy.
//
// PRODUCTION-EQUIVALENT FINANCIAL GRAPH. The first version generated sales and
// movements only, which made it useless for the half of the drill that matters:
// a restore that loses a credit ledger, a payment allocation or a cash drawer
// row is a restore that loses money, and a fixture with none of those cannot
// detect it. This one writes the whole graph the real schema carries —
// suppliers, purchases and purchase items, batches created from them, cash,
// credit and split sales, the credit ledger, customer payments with their
// allocations, per-day cash drawer rows, expenses, and audit rows — with every
// foreign key pointing at a row that exists.
//
// Every invariant the product depends on is produced the way the app produces
// it, and then CHECKED before the file is reported as usable:
//   - batches.stock is never written directly; it is driven entirely by
//     inventory_movements through migration 0006's trigger.
//   - money is integer paisa everywhere, never a float.
//   - sale payment arithmetic satisfies migration 0010's validation trigger.
//   - a credit's balance equals its amount minus its allocations.
//   - sales carry an explicit Asia/Dhaka business_date.
//
// It writes ONLY to the path given as --out, and REFUSES to run if that path
// exists. It contains no delete call, so it cannot be pointed at a real shop
// database by accident. Nothing in the app imports it, deliberately.
//
// Usage:
//   node scripts/generate-history-fixture.mjs --out ./history.db
//   node scripts/generate-history-fixture.mjs --out ./history.db --days 365 \
//        --sales-per-day 40 --medicines 600 --seed 7

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const MIGRATIONS_DIR = resolve('apps/mobile/db/migrations');
const DHAKA_OFFSET_MINUTES = 6 * 60;

function parseArgs(argv) {
  const options = { out: null, days: 365, salesPerDay: 40, medicines: 600, seed: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--out': options.out = value; i += 1; break;
      case '--days': options.days = Number(value); i += 1; break;
      case '--sales-per-day': options.salesPerDay = Number(value); i += 1; break;
      case '--medicines': options.medicines = Number(value); i += 1; break;
      case '--seed': options.seed = Number(value); i += 1; break;
      default: throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!options.out) throw new Error('--out <path> is required');
  for (const key of ['days', 'salesPerDay', 'medicines', 'seed']) {
    if (!Number.isInteger(options[key]) || options[key] < 0) {
      throw new Error(`--${key} must be a non-negative integer`);
    }
  }
  return options;
}

/** Deterministic: a fixture that differs between runs cannot be compared. */
function makeRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function applyMigrations(db) {
  const journal = JSON.parse(readFileSync(resolve(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  for (const entry of journal.entries) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) db.exec(trimmed);
    }
  }
  return journal.entries.length;
}

/** Asia/Dhaka calendar date for an instant, matching migration 0024's rule. */
function businessDate(instant) {
  return new Date(instant.getTime() + DHAKA_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

function idFactory(prefix) {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${String(counter).padStart(8, '0')}`;
  };
}

/**
 * Every invariant the generated file must satisfy, expressed as SQL that
 * returns the OFFENDING rows. Each must return zero.
 *
 * This is the difference between a fixture and a pile of rows. A drill run
 * against a file that already violates the ledger or the credit ledger cannot
 * tell a restore failure from a fixture failure.
 */
export const INVARIANTS = [
  {
    name: 'batches.stock equals the sum of its movements',
    sql: 'SELECT b.id FROM `batches` b WHERE b.`stock` <> COALESCE('
      + '(SELECT SUM(m.`change_qty`) FROM `inventory_movements` m WHERE m.`batch_id` = b.`id`), 0)',
  },
  {
    name: 'no batch is oversold without being flagged',
    sql: 'SELECT id FROM `batches` WHERE `stock` < 0 AND `oversold_at` IS NULL',
  },
  {
    name: 'sale totals equal subtotal minus discount',
    sql: 'SELECT id FROM `sales` WHERE `total` <> `subtotal` - `discount_amount`',
  },
  {
    name: 'sale cash and credit split sums to the total',
    sql: 'SELECT id FROM `sales` WHERE `cash_applied` + `credit_amount` <> `total`',
  },
  {
    name: 'sale line totals sum to the sale subtotal',
    sql: 'SELECT s.id FROM `sales` s WHERE s.`subtotal` <> COALESCE('
      + '(SELECT SUM(i.`line_total`) FROM `sale_items` i WHERE i.`sale_id` = s.`id`), 0)',
  },
  {
    name: 'every credit matches the credit amount of its sale',
    sql: 'SELECT c.id FROM `credits` c JOIN `sales` s ON s.`id` = c.`sale_id` '
      + 'WHERE c.`amount` <> s.`credit_amount`',
  },
  {
    name: 'credit balance equals amount minus its allocations',
    sql: 'SELECT c.id FROM `credits` c WHERE c.`balance` <> c.`amount` - COALESCE('
      + '(SELECT SUM(a.`amount`) FROM `credit_payment_allocations` a WHERE a.`credit_id` = c.`id`), 0)',
  },
  {
    name: 'no credit balance is negative or above its amount',
    sql: 'SELECT id FROM `credits` WHERE `balance` < 0 OR `balance` > `amount`',
  },
  {
    name: 'allocations never exceed their payment',
    sql: 'SELECT p.id FROM `payments` p WHERE COALESCE('
      + '(SELECT SUM(a.`amount`) FROM `credit_payment_allocations` a WHERE a.`payment_id` = p.`id`), 0) > p.`amount`',
  },
  {
    name: 'customer payments are fully represented by allocations',
    sql: "SELECT p.id FROM `payments` p WHERE p.`type` = 'customer_payment' AND p.`amount` <> COALESCE("
      + '(SELECT SUM(a.`amount`) FROM `credit_payment_allocations` a WHERE a.`payment_id` = p.`id`), 0)',
  },
  {
    name: 'allocations point at a credit of the same customer',
    sql: 'SELECT a.id FROM `credit_payment_allocations` a JOIN `credits` c ON c.`id` = a.`credit_id` '
      + 'WHERE a.`customer_id` <> c.`customer_id`',
  },
  {
    name: 'purchases are never overpaid',
    sql: 'SELECT id FROM `purchases` WHERE `paid_amount` < 0 OR `paid_amount` > `total`',
  },
  {
    name: 'purchase totals equal the sum of their received lines',
    sql: 'SELECT p.id FROM `purchases` p WHERE p.`total` <> COALESCE('
      + '(SELECT SUM(i.`qty` * i.`purchase_price`) FROM `purchase_items` i WHERE i.`purchase_id` = p.`id`), 0)',
  },
  {
    name: 'supplier payments link to a real purchase for the same supplier',
    sql: "SELECT pay.id FROM `payments` pay LEFT JOIN `purchases` p ON p.`id` = pay.`ref_id` "
      + "WHERE pay.`type` = 'supplier_payment' AND (p.`id` IS NULL OR p.`supplier_id` <> pay.`party_id`)",
  },
  {
    name: 'purchase paid amount equals linked supplier payments',
    sql: 'SELECT p.id FROM `purchases` p WHERE p.`paid_amount` <> COALESCE('
      + "(SELECT SUM(pay.`amount`) FROM `payments` pay WHERE pay.`type` = 'supplier_payment' "
      + "AND pay.`ref_id` = p.`id` AND pay.`is_deleted` = 0), 0)",
  },
  {
    name: 'expense detail has one matching expense payment',
    sql: 'SELECT e.id FROM `expenses` e WHERE e.`amount` <> COALESCE('
      + "(SELECT SUM(pay.`amount`) FROM `payments` pay WHERE pay.`type` = 'expense' "
      + "AND pay.`ref_id` = e.`id` AND pay.`is_deleted` = 0), 0)",
  },
  {
    name: 'one cash drawer row per shop per business date',
    sql: 'SELECT `business_date` FROM `cash_drawer` GROUP BY `shop_id`, `business_date` HAVING COUNT(*) > 1',
  },
  {
    name: 'cash drawer close uses the complete production cash equation',
    sql: 'SELECT d.id FROM `cash_drawer` d WHERE d.`closing_expected` <> d.`opening_cash` '
      + '+ COALESCE((SELECT SUM(s.`cash_applied`) FROM `sales` s WHERE s.`shop_id`=d.`shop_id` '
      + "AND s.`is_deleted`=0 AND date(s.`created_at`, '+06:00')=d.`business_date`),0) "
      + '+ COALESCE((SELECT SUM(pay.`amount`) FROM `payments` pay WHERE pay.`shop_id`=d.`shop_id` '
      + "AND pay.`type`='customer_payment' AND pay.`method`='cash' AND pay.`is_deleted`=0 "
      + "AND date(pay.`created_at`, '+06:00')=d.`business_date`),0) "
      + '- COALESCE((SELECT SUM(e.`amount`) FROM `expenses` e WHERE e.`shop_id`=d.`shop_id` '
      + "AND e.`is_deleted`=0 AND date(e.`created_at`, '+06:00')=d.`business_date`),0) "
      + '- COALESCE((SELECT SUM(pay.`amount`) FROM `payments` pay WHERE pay.`shop_id`=d.`shop_id` '
      + "AND pay.`type`='supplier_payment' AND pay.`method`='cash' AND pay.`is_deleted`=0 "
      + "AND date(pay.`created_at`, '+06:00')=d.`business_date`),0) "
      + '- COALESCE((SELECT SUM(pay.`amount`) FROM `payments` pay WHERE pay.`shop_id`=d.`shop_id` '
      + "AND pay.`type`='withdrawal' AND pay.`method`='cash' AND pay.`is_deleted`=0 "
      + "AND date(pay.`created_at`, '+06:00')=d.`business_date`),0) "
      + '- COALESCE((SELECT SUM(t.`amount`) FROM `refund_tenders` t WHERE t.`shop_id`=d.`shop_id` '
      + "AND (t.`kind`='cash' OR (t.`kind`='collection_refund' AND t.`method`='cash')) "
      + "AND t.`is_deleted`=0 AND date(t.`created_at`, '+06:00')=d.`business_date`),0) "
      + '- COALESCE((SELECT SUM(r.`refund_amount`) FROM `sales_returns` r WHERE r.`shop_id`=d.`shop_id` '
      + "AND r.`refund_id` IS NULL AND r.`refund_method`='cash' AND r.`is_deleted`=0 "
      + "AND date(r.`created_at`, '+06:00')=d.`business_date`),0)",
  },
  {
    name: 'no negative money anywhere it is impossible',
    sql: 'SELECT id FROM `sales` WHERE `total` < 0 OR `cash_applied` < 0 OR `credit_amount` < 0 '
      + 'UNION ALL SELECT id FROM `payments` WHERE `amount` < 0 '
      + 'UNION ALL SELECT id FROM `expenses` WHERE `amount` < 0 '
      + 'UNION ALL SELECT id FROM `cash_drawer` WHERE `opening_cash` < 0',
  },
];

export function validateHistoryFixture(db) {
  const failures = [];
  for (const invariant of INVARIANTS) {
    const offenders = db.prepare(invariant.sql).all();
    if (offenders.length > 0) {
      failures.push(`${invariant.name}: ${offenders.length} offending row(s)`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Fixture is invalid:\n  - ${failures.join('\n  - ')}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const outPath = resolve(options.out);
  if (existsSync(outPath)) {
    throw new Error(`${outPath} already exists. Choose another --out path.`);
  }
  mkdirSync(dirname(outPath), { recursive: true });

  const random = makeRandom(options.seed);
  const db = new DatabaseSync(outPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const startedAt = Date.now();
  const migrationCount = applyMigrations(db);

  const nextId = {
    medicine: idFactory('med'), batch: idFactory('bat'), movement: idFactory('mov'),
    sale: idFactory('sal'), saleItem: idFactory('sit'), expense: idFactory('exp'),
    customer: idFactory('cus'), supplier: idFactory('sup'), purchase: idFactory('pur'),
    purchaseItem: idFactory('pit'), credit: idFactory('crd'), payment: idFactory('pay'),
    allocation: idFactory('alo'), drawer: idFactory('drw'), audit: idFactory('aud'),
  };

  const shopId = 'shop-history-fixture';
  const ownerId = 'user-owner';
  const staffId = 'user-staff';
  const now = new Date();
  // Anchor each generated day at Asia/Dhaka midnight. Adding 8-20 hours below
  // must remain on that business date; anchoring at the current wall-clock
  // time makes late-day rows spill into tomorrow and falsifies cash close.
  const todayDhaka = businessDate(now);
  const firstDay = new Date(
    new Date(`${todayDhaka}T00:00:00+06:00`).getTime()
      - options.days * 24 * 60 * 60 * 1000,
  );
  const iso = (value) => value.toISOString();

  const insert = (table, row) => {
    const columns = Object.keys(row);
    const sql = `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) `
      + `VALUES (${columns.map(() => '?').join(', ')})`;
    db.prepare(sql).run(...columns.map((c) => row[c]));
  };

  const base = (createdAt) => ({
    created_at: createdAt, updated_at: createdAt,
    // Synced history, not an outbox backlog: a shop a year old has pushed.
    is_dirty: 0, is_deleted: 0,
  });

  const audit = (createdAt, action, target) => {
    insert('audit_logs', {
      id: nextId.audit(), ...base(createdAt), shop_id: shopId,
      actor_id: ownerId, action, target, meta: null,
    });
  };

  db.exec('BEGIN');

  insert('shops', {
    id: shopId, ...base(iso(firstDay)), owner_id: ownerId,
    name: 'History Fixture Pharmacy', phone: '+8801712000001', plan: 'free',
  });
  for (const [roleId, name] of [['role-owner', 'owner'], ['role-manager', 'manager'], ['role-staff', 'staff']]) {
    insert('roles', { id: roleId, ...base(iso(firstDay)), shop_id: shopId, name, is_system: 1 });
  }
  insert('shop_b2_settings', { id: 'settings-1', ...base(iso(firstDay)), shop_id: shopId });

  // A bcrypt hash of a value no 4-digit PIN can equal. This fixture is never a
  // real shop, and no PIN it would accept exists.
  const inertPinHash = '$2b$10$orrIQmGHjWZq8S.W0sHN/OtwZonfF.hpvxleIR9TlFHSBxIaFcByO';
  insert('users', {
    id: ownerId, ...base(iso(firstDay)), shop_id: shopId, name: 'Fixture Owner',
    phone: '+8801712000001', pin_hash: inertPinHash, role_id: 'role-owner', is_active: 1,
  });
  insert('users', {
    id: staffId, ...base(iso(firstDay)), shop_id: shopId, name: 'Fixture Staff',
    phone: '+8801712000002', pin_hash: inertPinHash, role_id: 'role-staff', is_active: 1,
  });
  audit(iso(firstDay), 'shop_created', shopId);

  const suppliers = [];
  for (let i = 0; i < 12; i += 1) {
    const id = nextId.supplier();
    suppliers.push(id);
    insert('suppliers', {
      id, ...base(iso(firstDay)), shop_id: shopId,
      name: `Supplier ${i + 1}`, phone: `+8801713${String(100000 + i).slice(-6)}`,
      manufacturer: `Manufacturer ${i % 40}`,
    });
  }

  const customers = [];
  for (let i = 0; i < Math.max(1, Math.round(options.medicines / 20)); i += 1) {
    const id = nextId.customer();
    customers.push(id);
    insert('customers', {
      id, ...base(iso(firstDay)), shop_id: shopId,
      name: `Customer ${i + 1}`, phone: `+88017120${String(10000 + i).slice(-5)}`,
    });
  }

  // Stock arrives the way it does in the shop: a supplier invoice, its lines,
  // and a batch plus an opening movement per received line. Nothing invents a
  // batch out of nowhere, so purchase totals and stock agree by construction.
  const batches = [];
  const medicinesPerPurchase = 25;
  let purchaseCount = 0;
  for (let i = 0; i < options.medicines; i += 1) {
    const medicineId = nextId.medicine();
    insert('medicines', {
      id: medicineId, ...base(iso(firstDay)), shop_id: shopId,
      name: `Medicine ${i + 1}`, generic: `Generic ${i % 120}`,
      manufacturer: `Manufacturer ${i % 40}`, unit_of_measure: 'piece',
    });

    if (i % medicinesPerPurchase === 0) purchaseCount += 1;
    const purchaseId = `pur-${String(purchaseCount).padStart(8, '0')}`;
    if (i % medicinesPerPurchase === 0) {
      insert('purchases', {
        id: purchaseId, ...base(iso(firstDay)), shop_id: shopId,
        invoice_no: `PINV-${String(purchaseCount).padStart(5, '0')}`,
        supplier_id: suppliers[purchaseCount % suppliers.length],
        // Filled in once its lines are known; the invariant check below proves
        // the two agree.
        total: 0, payment_terms: purchaseCount % 3 === 0 ? 'cod' : 'credit',
        paid_amount: 0, invoice_date: businessDate(firstDay),
      });
      nextId.purchase();
    }

    for (let b = 0; b < 2; b += 1) {
      const batchId = nextId.batch();
      const purchasePrice = 500 + Math.floor(random() * 4_000);
      const salePrice = purchasePrice + 100 + Math.floor(random() * 1_500);
      const expiry = new Date(now.getTime() + (30 + Math.floor(random() * 700)) * 24 * 60 * 60 * 1000);
      const batchNo = `B${i + 1}-${b + 1}`;
      const opening = 200 + Math.floor(random() * 400);

      insert('purchase_items', {
        id: nextId.purchaseItem(), ...base(iso(firstDay)), shop_id: shopId,
        purchase_id: purchaseId, medicine_id: medicineId, batch_no: batchNo,
        expiry_date: iso(expiry).slice(0, 10), qty: opening,
        purchase_price: purchasePrice, sale_price: salePrice,
        status: 'received', received_at: iso(firstDay),
      });
      insert('batches', {
        id: batchId, ...base(iso(firstDay)), shop_id: shopId, medicine_id: medicineId,
        batch_no: batchNo, expiry_date: iso(expiry).slice(0, 10),
        // Never written directly — the opening movement below sets it.
        stock: 0, purchase_price: purchasePrice, sale_price: salePrice,
      });
      insert('inventory_movements', {
        id: nextId.movement(), ...base(iso(firstDay)), shop_id: shopId, batch_id: batchId,
        change_qty: opening, reason: 'purchase', ref_id: purchaseId, created_by: ownerId,
      });
      batches.push({ batchId, medicineId, salePrice, purchasePrice });
    }
  }

  // Now the invoice totals can be derived from the lines that exist.
  db.exec(
    'UPDATE `purchases` SET `total` = COALESCE((SELECT SUM(i.`qty` * i.`purchase_price`) '
    + 'FROM `purchase_items` i WHERE i.`purchase_id` = `purchases`.`id`), 0)',
  );
  const purchaseLedger = db.prepare(
    'SELECT `id`, `supplier_id`, `total` FROM `purchases` ORDER BY `id`',
  ).all();

  const openCredits = [];
  let invoiceCounter = 0;
  for (let day = 0; day < options.days; day += 1) {
    const dayStart = new Date(firstDay.getTime() + day * 24 * 60 * 60 * 1000);
    const date = businessDate(dayStart);

    // Opening cash resets daily and is never inherited (CLAUDE.md rule 5);
    // the fixture writes a fresh drawer row per business date.
    insert('cash_drawer', {
      id: nextId.drawer(), ...base(iso(dayStart)), shop_id: shopId,
      business_date: date, opening_cash: 0, opened_by: ownerId,
      opened_at: iso(dayStart),
    });

    for (let s = 0; s < options.salesPerDay; s += 1) {
      const at = new Date(dayStart.getTime() + (8 + Math.floor(random() * 12)) * 3_600_000);
      const createdAt = iso(at);
      const saleId = nextId.sale();
      const lineCount = 1 + Math.floor(random() * 4);
      const lines = [];
      let subtotal = 0;
      for (let l = 0; l < lineCount; l += 1) {
        const batch = batches[Math.floor(random() * batches.length)];
        const qty = 1 + Math.floor(random() * 3);
        const lineTotal = batch.salePrice * qty;
        subtotal += lineTotal;
        lines.push({ batch, qty, lineTotal });
      }

      // Three payment shapes, because migration 0010's validation trigger
      // enforces different arithmetic for each and a fixture that only ever
      // writes cash never exercises two thirds of it.
      const roll = random();
      const kind = roll < 0.12 ? 'credit' : roll < 0.2 ? 'split' : 'cash';
      const cashApplied = kind === 'cash' ? subtotal : kind === 'split' ? Math.max(1, Math.floor(subtotal / 2)) : 0;
      const creditAmount = subtotal - cashApplied;
      const customerId = kind === 'cash' ? null : customers[Math.floor(random() * customers.length)];

      invoiceCounter += 1;
      insert('sales', {
        id: saleId, ...base(createdAt), shop_id: shopId,
        invoice_no: `INV-${String(invoiceCounter).padStart(7, '0')}`,
        total: subtotal, paid: cashApplied, change: 0,
        payment_type: kind, customer_id: customerId,
        staff_id: random() < 0.5 ? ownerId : staffId,
        business_date: date, subtotal, discount_amount: 0,
        cash_applied: cashApplied, credit_amount: creditAmount,
      });
      for (const line of lines) {
        insert('sale_items', {
          id: nextId.saleItem(), ...base(createdAt), shop_id: shopId, sale_id: saleId,
          medicine_id: line.batch.medicineId, batch_id: line.batch.batchId,
          qty: line.qty, unit_price: line.batch.salePrice, discount_amount: 0,
          line_total: line.lineTotal, cogs: line.batch.purchasePrice * line.qty,
        });
        insert('inventory_movements', {
          id: nextId.movement(), ...base(createdAt), shop_id: shopId,
          batch_id: line.batch.batchId, change_qty: -line.qty, reason: 'sale',
          ref_id: saleId, created_by: ownerId,
        });
      }

      if (creditAmount > 0 && customerId) {
        const creditId = nextId.credit();
        insert('credits', {
          id: creditId, ...base(createdAt), shop_id: shopId, customer_id: customerId,
          sale_id: saleId, amount: creditAmount, balance: creditAmount,
        });
        openCredits.push({ creditId, customerId, balance: creditAmount });
      }
    }

    // Collections: a customer pays, the payment is ALLOCATED against their
    // oldest open credits (FIFO, as db/customers.ts does), and each credit's
    // balance drops by exactly what was allocated to it. Partial collections
    // are the common case and are what the balance invariant is guarding.
    if (day % 3 === 0 && openCredits.length > 0) {
      const collectAt = iso(new Date(dayStart.getTime() + 17 * 3_600_000));
      const target = openCredits[Math.floor(random() * openCredits.length)];
      const settled = random() < 0.5;
      const amount = settled ? target.balance : Math.max(1, Math.floor(target.balance / 2));
      if (amount > 0) {
        const paymentId = nextId.payment();
        insert('payments', {
          id: paymentId, ...base(collectAt), shop_id: shopId,
          type: 'customer_payment', party_id: target.customerId, amount,
          method: 'cash', ref_id: null, created_by: ownerId, note: null,
        });
        insert('credit_payment_allocations', {
          id: nextId.allocation(), ...base(collectAt), shop_id: shopId,
          customer_id: target.customerId, payment_id: paymentId,
          credit_id: target.creditId, amount,
        });
        db.prepare('UPDATE `credits` SET `balance` = `balance` - ? WHERE `id` = ?')
          .run(amount, target.creditId);
        target.balance -= amount;
        if (target.balance === 0) {
          openCredits.splice(openCredits.indexOf(target), 1);
        }
        audit(collectAt, 'credit_collected', target.customerId);
      }
    }

    // A supplier payment every fortnight, so the payable derivation has both
    // sides of its ledger.
    if (day % 14 === 0 && purchaseLedger.length > 0) {
      const payAt = iso(new Date(dayStart.getTime() + 18 * 3_600_000));
      const paymentIndex = Math.floor(day / 14);
      const purchase = purchaseLedger[paymentIndex % purchaseLedger.length];
      const currentPaid = Number(db.prepare('SELECT `paid_amount` FROM `purchases` WHERE `id` = ?')
        .get(purchase.id).paid_amount);
      const remaining = Number(purchase.total) - currentPaid;
      const amount = paymentIndex % 2 === 0 ? remaining : Math.max(1, Math.floor(remaining / 2));
      insert('payments', {
        id: nextId.payment(), ...base(payAt), shop_id: shopId,
        type: 'supplier_payment', party_id: purchase.supplier_id,
        amount, method: 'cash', ref_id: purchase.id, created_by: ownerId, note: null,
      });
      db.prepare('UPDATE `purchases` SET `paid_amount` = `paid_amount` + ? WHERE `id` = ?')
        .run(amount, purchase.id);
    }

    if (day % 7 === 0) {
      const expenseId = nextId.expense();
      const expenseAmount = 50_000 + Math.floor(random() * 100_000);
      insert('expenses', {
        id: expenseId, ...base(iso(dayStart)), shop_id: shopId,
        // Canonical taxonomy from migration 0018; anything else is rewritten
        // by that migration's triggers and the fixture would drift.
        category: 'utilities', amount: expenseAmount,
        description: 'Weekly utilities', created_by: ownerId,
      });
      insert('payments', {
        id: nextId.payment(), ...base(iso(dayStart)), shop_id: shopId,
        type: 'expense', party_id: null, amount: expenseAmount, method: 'cash',
        ref_id: expenseId, created_by: ownerId, note: null,
      });
    }

    if (day % 10 === 5) {
      insert('payments', {
        id: nextId.payment(), ...base(iso(new Date(dayStart.getTime() + 19 * 3_600_000))),
        shop_id: shopId, type: 'withdrawal', party_id: null, amount: 10_000,
        method: 'cash', ref_id: null, created_by: ownerId, note: 'Fixture bank deposit',
      });
    }

    // Closing the day is what makes the drawer row reconcilable, and a
    // reconciled day is the one shape the restore drill compares against.
    const closedAt = iso(new Date(dayStart.getTime() + 20 * 3_600_000));
    const cash = db.prepare(
      'SELECT '
      + 'COALESCE((SELECT `opening_cash` FROM `cash_drawer` WHERE `shop_id`=? AND `business_date`=?),0) '
      + '+ COALESCE((SELECT SUM(`cash_applied`) FROM `sales` WHERE `shop_id`=? AND `business_date`=? AND `is_deleted`=0),0) '
      + "+ COALESCE((SELECT SUM(`amount`) FROM `payments` WHERE `shop_id`=? AND `type`='customer_payment' AND `method`='cash' AND date(`created_at`, '+06:00')=? AND `is_deleted`=0),0) "
      + '- COALESCE((SELECT SUM(`amount`) FROM `expenses` WHERE `shop_id`=? AND date(`created_at`, \'+06:00\')=? AND `is_deleted`=0),0) '
      + "- COALESCE((SELECT SUM(`amount`) FROM `payments` WHERE `shop_id`=? AND `type` IN ('supplier_payment','withdrawal') AND `method`='cash' AND date(`created_at`, '+06:00')=? AND `is_deleted`=0),0) AS expected",
    ).get(shopId, date, shopId, date, shopId, date, shopId, date, shopId, date);
    db.prepare(
      'UPDATE `cash_drawer` SET `closed_by` = ?, `closed_at` = ?, `closing_expected` = ?, '
      + '`closing_counted` = ?, `reconciled_counted_amount` = ?, `reconciled_at` = ?, '
      + '`reconciled_by` = ?, `updated_at` = ? WHERE `business_date` = ? AND `shop_id` = ?',
    ).run(
      ownerId, closedAt, Number(cash.expected), Number(cash.expected),
      Number(cash.expected), closedAt, ownerId, closedAt, date, shopId,
    );
  }

  db.exec('COMMIT');

  // Prove the fixture is usable BEFORE reporting it as one. A file that
  // violated any of these would fail the drill's own postchecks later, at the
  // point where telling a fixture bug from a restore bug is most expensive.
  validateHistoryFixture(db);

  const counts = {};
  let total = 0;
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all();
  for (const row of tables) {
    const n = Number(db.prepare(`SELECT COUNT(*) AS n FROM \`${row.name}\``).get().n);
    if (n > 0) counts[row.name] = n;
    total += n;
  }

  const money = db.prepare(
    'SELECT (SELECT COALESCE(SUM(`total`), 0) FROM `sales`) AS sales_paisa,'
    + ' (SELECT COALESCE(SUM(`credit_amount`), 0) FROM `sales`) AS credit_paisa,'
    + ' (SELECT COALESCE(SUM(`balance`), 0) FROM `credits`) AS receivable_paisa,'
    + ' (SELECT COALESCE(SUM(`amount`), 0) FROM `payments`) AS payments_paisa,'
    + ' (SELECT COALESCE(SUM(`total` - `paid_amount`), 0) FROM `purchases`) AS payable_paisa,'
    + ' (SELECT COALESCE(SUM(`stock`), 0) FROM `batches`) AS units_in_stock',
  ).get();

  // Fold the write-ahead log back in so the reported size is what a device
  // would actually have to migrate.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();

  const bytes = statSync(outPath).size;
  const taka = (paisa) => (Number(paisa) / 100).toFixed(2);
  console.log(`fixture:      ${outPath}`);
  console.log(`migrations:   ${migrationCount} applied`);
  console.log(`rows:         ${total} across ${Object.keys(counts).length} tables`);
  console.log(`size:         ${(bytes / 1024 / 1024).toFixed(2)} MiB (${bytes} bytes)`);
  console.log(`generated in: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(`invariants:   ${INVARIANTS.length} checked, all pass`);
  console.log('');
  console.log(`sales:        BDT ${taka(money.sales_paisa)}`);
  console.log(`  of which credit: BDT ${taka(money.credit_paisa)}`);
  console.log(`receivable:   BDT ${taka(money.receivable_paisa)} still owed`);
  console.log(`payments in:  BDT ${taka(money.payments_paisa)}`);
  console.log(`payable:      BDT ${taka(money.payable_paisa)} owed to suppliers`);
  console.log(`stock:        ${money.units_in_stock} units`);
  console.log('');
  for (const [table, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${table.padEnd(34)} ${n}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}
