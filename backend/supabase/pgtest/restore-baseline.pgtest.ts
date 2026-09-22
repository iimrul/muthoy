import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, OWNER_A, seedShops, SHOP_A, T0, type Harness } from './harness';

const BASELINE_SQL = readFileSync(
  resolve('backend/supabase/checks/restore_baseline.sql'),
  'utf8',
);
const MEDICINE = '71000000-0000-4000-8000-000000000001';
const BATCH = '71000000-0000-4000-8000-000000000002';
const MOVEMENT = '71000000-0000-4000-8000-000000000003';
const EXPENSE = '71000000-0000-4000-8000-000000000004';
const PAYMENT = '71000000-0000-4000-8000-000000000005';
const DRAWER = '71000000-0000-4000-8000-000000000006';

type Fingerprint = { scope: string; rows: number | bigint; total_paisa: number | bigint; digest: string };
const normalized = (rows: Fingerprint[]) => rows.map((row) => ({
  ...row,
  rows: String(row.rows),
  total_paisa: String(row.total_paisa),
}));

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
  await seedShops(h);
  await h.exec(`
    insert into medicines (id,shop_id,name,created_at,updated_at)
      values ('${MEDICINE}','${SHOP_A}','Restore medicine','${T0}','${T0}');
    insert into batches (id,shop_id,medicine_id,batch_no,stock,purchase_price,sale_price,created_at,updated_at)
      values ('${BATCH}','${SHOP_A}','${MEDICINE}','RESTORE-B1',0,1000,1500,'${T0}','${T0}');
    insert into inventory_movements
      (id,shop_id,batch_id,change_qty,reason,created_by,created_at,updated_at)
      values ('${MOVEMENT}','${SHOP_A}','${BATCH}',10,'adjustment','${OWNER_A}','${T0}','${T0}');
    insert into expenses (id,shop_id,category,amount,created_by,created_at,updated_at)
      values ('${EXPENSE}','${SHOP_A}','utilities',5000,'${OWNER_A}','${T0}','${T0}');
    insert into payments (id,shop_id,type,amount,method,ref_id,created_by,created_at,updated_at)
      values ('${PAYMENT}','${SHOP_A}','expense',5000,'cash','${EXPENSE}','${OWNER_A}','${T0}','${T0}');
    insert into cash_drawer
      (id,shop_id,business_date,opening_cash,opened_by,opened_at,closing_expected,closing_counted,created_at,updated_at)
      values ('${DRAWER}','${SHOP_A}','2026-08-19',0,'${OWNER_A}','${T0}',-5000,-5000,'${T0}','${T0}');
  `);
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('restore_baseline.sql on disposable PostgreSQL', () => {
  it('detects executable value corruption and returns exactly after restore', async () => {
    const baseline = normalized(await h.all<Fingerprint>(BASELINE_SQL));
    const counts = Object.fromEntries(baseline.map((row) => [row.scope, row.rows]));

    await h.exec(`
      update expenses set category='rent', amount=5001 where id='${EXPENSE}';
      update payments set amount=5001 where id='${PAYMENT}';
      begin;
      select set_config('muthoy.ledger_apply','on',true);
      update batches set stock=9 where id='${BATCH}';
      commit;
    `);
    const corrupted = normalized(await h.all<Fingerprint>(BASELINE_SQL));
    expect(Object.fromEntries(corrupted.map((row) => [row.scope, row.rows]))).toEqual(counts);
    expect(corrupted).not.toEqual(baseline);
    for (const scope of ['expenses', 'payments', 'batches']) {
      expect(corrupted.find((row) => row.scope === scope)?.digest)
        .not.toBe(baseline.find((row) => row.scope === scope)?.digest);
    }

    await h.exec(`
      update expenses set category='utilities', amount=5000 where id='${EXPENSE}';
      update payments set amount=5000 where id='${PAYMENT}';
      begin;
      select set_config('muthoy.ledger_apply','on',true);
      update batches set stock=10 where id='${BATCH}';
      commit;
    `);
    expect(normalized(await h.all<Fingerprint>(BASELINE_SQL))).toEqual(baseline);
  });
});
