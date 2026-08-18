import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Reads the Postgres ledger migration as TEXT, the same technique grants.test.ts
// uses. Postgres is not available in this suite, so this asserts the structural
// guarantees the cloud half rests on rather than executing them.
//
// Stated plainly so nobody mistakes its reach: this proves the migration SAYS
// the right things. The SQLite half of the identical design is genuinely
// executed, with the same trigger semantics, in
// apps/mobile/db/inventory-ledger.sqlite.test.ts. Running this migration
// against a real Postgres remains a pre-merge step.

const LEDGER_SQL = readFileSync(
  resolve('backend/supabase/migrations/20260818000000_inventory_movement_ledger.sql'),
  'utf8',
);
const INITIAL_SQL = readFileSync(
  resolve('backend/supabase/migrations/20260813000000_initial_schema.sql'),
  'utf8',
);
const SYNC_FIX_SQL = readFileSync(
  resolve('backend/supabase/migrations/20260818000100_sync_batches_stock_server_derived.sql'),
  'utf8',
);

/** The batches branch of sync_apply_row, as the corrective migration defines it. */
const BATCHES_BRANCH = SYNC_FIX_SQL.slice(
  SYNC_FIX_SQL.indexOf("elsif p_table='batches' then insert into batches"),
  SYNC_FIX_SQL.indexOf("elsif p_table='inventory_movements' then insert into inventory_movements"),
);

describe('the cloud cannot accept an absolute stock quantity', () => {
  test('a BEFORE trigger strips stock from every non-ledger write to batches', () => {
    expect(LEDGER_SQL).toMatch(
      /create trigger batches_stock_guard\s+before insert or update on batches\s+for each row execute function batches_stock_is_ledger_derived\(\)/i,
    );
    // INSERT opens empty, UPDATE keeps what the ledger already put there.
    expect(LEDGER_SQL).toMatch(/new\.stock\s*:=\s*0;/i);
    expect(LEDGER_SQL).toMatch(/new\.stock\s*:=\s*old\.stock;/i);
  });

  test('the guard is bypassed only by the ledger, via a transaction-local flag', () => {
    expect(LEDGER_SQL).toMatch(/current_setting\('muthoy\.ledger_apply',\s*true\)/i);
    // `true` as set_config's third argument is what scopes the flag to the
    // transaction; a session-wide flag would leak across pooled connections
    // and silently disarm the guard for unrelated callers.
    expect(LEDGER_SQL).toMatch(/set_config\('muthoy\.ledger_apply',\s*'on',\s*true\)/i);
    expect(LEDGER_SQL).toMatch(/set_config\('muthoy\.ledger_apply',\s*'off',\s*true\)/i);
  });

  test("the initial schema's whole-row batches upsert is the defect being neutralised", () => {
    // Documents WHY the guard exists: that upsert still lists `stock` among the
    // columns it overwrites on conflict. The guard is what makes it harmless.
    // If a future migration removes stock from this list, this test should be
    // revisited, not deleted.
    expect(INITIAL_SQL).toMatch(/p_table='batches'[\s\S]*?excluded\.stock/);
  });
});

describe('the ledger applies deltas atomically', () => {
  test('stock moves by relative addition, never by assignment', () => {
    expect(LEDGER_SQL).toMatch(/set stock = stock \+ new\.change_qty/i);
    // The read-modify-write that would reintroduce the race.
    expect(LEDGER_SQL).not.toMatch(/set stock = \(select/i);
  });

  test('it fires AFTER INSERT only, so a redelivered movement cannot reapply', () => {
    expect(LEDGER_SQL).toMatch(
      /create trigger inventory_movement_applies_delta\s+after insert on inventory_movements/i,
    );
    expect(LEDGER_SQL).not.toMatch(
      /create trigger inventory_movement_applies_delta[\s\S]*?after insert or update/i,
    );
  });

  test('a movement against an unknown batch fails loudly instead of vanishing', () => {
    expect(LEDGER_SQL).toMatch(/if not found then/i);
    expect(LEDGER_SQL).toMatch(/errcode = 'MU005'/);
  });

  test("the applied batch is pushed past every other device's pull cursor", () => {
    expect(LEDGER_SQL).toMatch(/updated_at = greatest\(updated_at, now\(\)\)/i);
  });
});

describe('the ledger is append-only', () => {
  test('change_qty and batch_id cannot be rewritten after they have applied', () => {
    expect(LEDGER_SQL).toMatch(
      /create trigger inventory_movement_immutable\s+before update on inventory_movements/i,
    );
    expect(LEDGER_SQL).toMatch(
      /old\.change_qty <> new\.change_qty or old\.batch_id <> new\.batch_id/i,
    );
    expect(LEDGER_SQL).toMatch(/errcode = 'MU006'/);
  });
});

describe('oversell is recorded, never discarded', () => {
  test('no constraint or clamp can reject a movement that drives stock negative', () => {
    // A `check (stock >= 0)` here would abort the transaction and lose a sale
    // that physically happened — the one outcome the requirement forbids.
    expect(LEDGER_SQL).not.toMatch(/check\s*\(\s*stock\s*>=\s*0\s*\)/i);
    expect(LEDGER_SQL).not.toMatch(/greatest\(\s*0\s*,\s*stock \+ new\.change_qty\s*\)/i);
  });

  test('the shortfall is marked for reconciliation', () => {
    expect(LEDGER_SQL).toMatch(/oversold_at = case[\s\S]*?stock \+ new\.change_qty < 0/i);
  });
});

describe('cross-device propagation and privilege', () => {
  test('batches is published to realtime, guarded against a repeat add', () => {
    expect(LEDGER_SQL).toMatch(/alter publication supabase_realtime add table batches/i);
    expect(LEDGER_SQL).toMatch(/from pg_publication_tables/i);
  });

  test('no ledger function is executable by anon or authenticated', () => {
    for (const fn of [
      'batches_stock_is_ledger_derived',
      'apply_inventory_movement',
      'inventory_movement_is_immutable',
    ]) {
      expect(LEDGER_SQL).toMatch(
        new RegExp(`revoke execute on function ${fn}\\(\\) from public, anon, authenticated`, 'i'),
      );
    }
  });

  test('existing shops are backfilled onto the invariant', () => {
    // Pre-ledger rows carry a stock that was never expressed as movements;
    // without this, stock == SUM(movements) would be false from day one and
    // every later delta would compound the gap.
    expect(LEDGER_SQL).toMatch(/v_gap := v_batch\.stock - v_ledger/i);
    expect(LEDGER_SQL).toMatch(/insert into inventory_movements[\s\S]*?v_gap, 'adjustment'/i);
  });
});

describe('sync_apply_row no longer writes client batch stock', () => {
  test('the initial schema DID write it — this is the defect being corrected', () => {
    const original = INITIAL_SQL.slice(
      INITIAL_SQL.indexOf("elsif p_table='batches' then insert into batches"),
      INITIAL_SQL.indexOf("elsif p_table='inventory_movements' then insert into inventory_movements"),
    );
    // Pinning the bug: whole-row LWW folded stock in, so the later push won and
    // the earlier device's sale vanished from inventory.
    expect(original).toContain('excluded.stock');
  });

  test('the corrected branch names neither stock nor oversold_at', () => {
    expect(BATCHES_BRANCH).not.toContain('excluded.stock');
    expect(BATCHES_BRANCH).not.toContain(',stock,');
    expect(BATCHES_BRANCH).not.toContain('excluded.oversold_at');
  });

  test('metadata is still last-write-wins, so batch edits keep syncing', () => {
    for (const column of ['excluded.batch_no', 'excluded.expiry_date', 'excluded.sale_price', 'excluded.purchase_price']) {
      expect(BATCHES_BRANCH).toContain(column);
    }
    expect(BATCHES_BRANCH).toContain('batches.updated_at<excluded.updated_at');
  });

  test('the INSERT arm cannot smuggle an absolute in either', () => {
    // jsonb_populate_record would otherwise carry the client's stock onto a
    // brand-new row, where there is no OLD value for the guard to restore.
    expect(SYNC_FIX_SQL).toMatch(/if p_table='batches' then\s+p_row := p_row \|\| jsonb_build_object\(/i);
    expect(SYNC_FIX_SQL).toMatch(/'stock',\s*coalesce\(\(select b\.stock from batches b where b\.id=v_row_id\),0\)/i);
    expect(SYNC_FIX_SQL).toMatch(/'oversold_at',\s*\(select to_jsonb\(b\.oversold_at\) from batches b where b\.id=v_row_id\)/i);
  });

  test('shop scoping, FK assertions and SECURITY DEFINER all survive', () => {
    expect(SYNC_FIX_SQL).toContain('security definer');
    expect(SYNC_FIX_SQL).toContain('set search_path = public');
    expect(SYNC_FIX_SQL).toContain('batches.shop_id=p_caller_shop_id');
    expect(SYNC_FIX_SQL).toContain("assert_fk_same_shop('medicines'");
    expect(SYNC_FIX_SQL).toContain('sync_existing_row_owned_or_missing');
    // Same signature, so the initial schema's grants still bind.
    expect(SYNC_FIX_SQL).toContain('grant execute on function sync_apply_row(text,text,jsonb,uuid) to service_role');
    expect(SYNC_FIX_SQL).toMatch(/revoke execute on function sync_apply_row\(text,text,jsonb,uuid\) from public,anon,authenticated/);
  });

  test('the applied historical migration is not edited', () => {
    // 20260813000000 is history. The fix is additive: create or replace.
    expect(SYNC_FIX_SQL).toContain('create or replace function sync_apply_row(');
    expect(INITIAL_SQL).toContain('excluded.stock');
  });

  test('every other table branch is carried over unchanged', () => {
    for (const table of ['sales', 'sale_items', 'purchases', 'purchase_items', 'sales_returns', 'purchase_returns', 'credits', 'payments', 'cash_drawer', 'inventory_movements']) {
      expect(SYNC_FIX_SQL).toContain(`elsif p_table='${table}' then insert into ${table}`);
    }
  });
});

const BACKFILL = LEDGER_SQL.slice(LEDGER_SQL.indexOf('BACKFILL:'));

describe('the backfill lands existing shops ON the invariant, not past it', () => {
  test('it rewinds the projection to the ledger before appending the gap', () => {
    // The trap: the apply trigger ADDS the gap movement. Inserting it without
    // first dropping stock to the ledger sum doubles every existing batch —
    // the migration would corrupt exactly the data it was meant to rescue.
    expect(BACKFILL).toMatch(/update batches set stock = v_ledger where id = v_batch\.id;/i);

    const rewindAt = BACKFILL.indexOf('update batches set stock = v_ledger');
    const insertAt = BACKFILL.indexOf('insert into inventory_movements');
    expect(rewindAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(rewindAt);
  });

  test('the gap is the difference between the projection and the ledger', () => {
    expect(LEDGER_SQL).toMatch(/v_gap\s*:=\s*v_batch\.stock\s*-\s*v_ledger;/i);
    expect(LEDGER_SQL).toMatch(/continue when v_gap = 0;/i);
  });

  test('the rewind is the only write that bypasses the guard, and it re-arms', () => {
    expect(BACKFILL).toMatch(/set_config\('muthoy\.ledger_apply', 'on', true\)/);
    expect(BACKFILL).toMatch(/set_config\('muthoy\.ledger_apply', 'off', true\)/);
  });

  test('it covers EVERY batch, soft-deleted ones included', () => {
    // Skipping tombstoned batches leaves rows the guards can never afterwards
    // repair: correcting one later needs an absolute write, and
    // batches_stock_guard refuses those outright. The skipped batch is stuck
    // off the invariant permanently.
    expect(BACKFILL).toMatch(/for v_batch in select id, shop_id, stock from batches loop/i);
    expect(BACKFILL).not.toMatch(/from batches where is_deleted = false/i);
  });

  test('a soft-deleted user is still a usable actor', () => {
    // created_by is `not null references users(id)`, so what matters is that
    // the foreign key resolves — a tombstoned user row still does. Filtering
    // on is_deleted is what used to leave whole shops silently skipped.
    expect(BACKFILL).toMatch(
      /select id into v_actor from users\s+where shop_id = v_batch\.shop_id\s+order by created_at, id limit 1;/i,
    );
    expect(BACKFILL).not.toMatch(/where shop_id = v_batch\.shop_id and is_deleted = false/i);
  });

  test('a gap with no possible actor fails the migration instead of being skipped', () => {
    expect(BACKFILL).not.toMatch(/continue when v_actor is null;/i);
    expect(BACKFILL).toMatch(/if v_actor is null then[\s\S]*?raise exception/i);
    expect(BACKFILL).toMatch(/errcode = 'MU008'/);
  });

  test('the synthetic movement id is derived from the batch, never generated', () => {
    // The device's migration 0006 derives it the same way. Both stores meet
    // this same historical gap independently, so they must mint the SAME
    // primary key — otherwise both deltas apply and every pre-existing batch
    // in the install base silently doubles.
    expect(BACKFILL).toContain("overlay(v_batch.id::text placing '8' from 15 for 1)::uuid");
    expect(BACKFILL).not.toMatch(/values \(gen_random_uuid\(\)/i);
  });

  test('it asserts the invariant over every batch before finishing', () => {
    // A backfill that half-worked and reported success is worse than one that
    // refused: the guards would reject writes to the batches it missed with
    // nothing left to say why.
    expect(BACKFILL).toMatch(/select count\(\*\) into v_violations from batches b/i);
    expect(BACKFILL).toMatch(/where b\.stock <> coalesce\(/i);
    expect(BACKFILL).toMatch(/if v_violations > 0 then[\s\S]*?raise exception/i);
    expect(BACKFILL).toMatch(/errcode = 'MU009'/);
  });
});

describe('the ledger is append-only against DELETE too', () => {
  test('a physical delete is refused', () => {
    // A deleted movement takes its delta out of the ledger while leaving it
    // inside batches.stock, and the apply trigger is INSERT-only so nothing
    // subtracts it back — the same silent divergence the UPDATE guard
    // prevents, reached through a different verb.
    expect(LEDGER_SQL).toMatch(/create or replace function inventory_movement_is_undeletable\(\)/i);
    expect(LEDGER_SQL).toMatch(
      /create trigger inventory_movement_no_delete\s+before delete on inventory_movements/i,
    );
    expect(LEDGER_SQL).toMatch(/errcode = 'MU007'/);
  });

  test('the tombstone path sync actually uses is untouched', () => {
    // sync_apply_row's delete branch soft-deletes inventory_movements, and a
    // tombstoned movement deliberately stays in the ledger sum.
    expect(INITIAL_SQL).toMatch(
      /p_table='inventory_movements' then update inventory_movements set is_deleted=true/i,
    );
  });

  test('the new function is not executable by clients', () => {
    expect(LEDGER_SQL).toMatch(
      /revoke execute on function inventory_movement_is_undeletable\(\) from public, anon, authenticated/i,
    );
  });
});
