import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASELINE = readFileSync(resolve('backend/supabase/checks/restore_baseline.sql'), 'utf8');
const DRILL = readFileSync(resolve('backend/supabase/checks/restore_drill.md'), 'utf8');

describe('the canonical restore fingerprint', () => {
  it.each([
    'sales', 'sale_items', 'payments', 'credits', 'credit_payment_allocations',
    'credit_reconciliation_states', 'purchases', 'purchase_items', 'purchase_returns',
    'batches', 'inventory_movements', 'expenses', 'cash_drawer', 'sale_refunds',
    'sales_returns', 'refund_tenders',
  ])('fingerprints %s values', (table) => {
    expect(BASELINE).toContain(`'${table}'`);
    expect(BASELINE).toContain(`FROM public.${table}`);
  });

  it('uses ordered hashes and financial totals, not counts alone', () => {
    expect(BASELINE).toContain('md5(');
    expect(BASELINE).toContain('string_agg');
    expect(BASELINE).toContain('ORDER BY id');
    expect(BASELINE).toContain('total_paisa');
  });

  it('is SELECT-only', () => {
    const sql = BASELINE.replace(/--[^\n]*/g, ' ').toUpperCase();
    for (const keyword of ['INSERT ', 'UPDATE ', 'DELETE ', 'DROP ', 'ALTER ', 'CREATE ']) {
      expect(sql).not.toContain(keyword);
    }
  });
});

describe('the operational drill classification', () => {
  it('uses the trigger-aware ledger seam rather than impossible direct corruption', () => {
    expect(DRILL).toContain("set_config('muthoy.ledger_apply','on',true)");
    expect(DRILL).toContain('Never disable or drop the trigger');
  });

  it('does not pretend automated PGlite execution rehearsed C5', () => {
    expect(DRILL).toMatch(/automated\s+SQL and trigger validation only/);
    expect(DRILL).toMatch(/not the C5 backup-provider restore\s+rehearsal/);
    expect(DRILL).toContain('_not run_');
  });

  it('requires baseline, visible corruption, restore, and exact equality', () => {
    expect(DRILL.indexOf('Capture the canonical fingerprint'))
      .toBeLessThan(DRILL.indexOf('Corrupt actual VALUES'));
    expect(DRILL).toContain('MUST differ');
    expect(DRILL).toMatch(/must match\s+exactly/);
  });

  it('retains the corrected forward-only count', () => {
    expect(DRILL).toContain('seven of twenty-six');
  });
});
