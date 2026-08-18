-- Server-authoritative, delta-based inventory. The cloud mirror of
-- apps/mobile/db/migrations/0006_inventory_movement_ledger.sql.
--
-- What was wrong: sync_apply_row's batches branch (initial schema) folded
-- `stock` into a whole-row last-write-wins upsert. Two phones selling the same
-- batch each computed an absolute locally and pushed it; the later push won
-- outright. Stock 5, A sells 2, B sells 2, cloud lands on 3 instead of 1 --
-- one sale's stock effect gone, while its sales/sale_items rows survived to
-- prove it had happened. Purchases against a concurrent sale lost the same way.
--
-- What is true from here on:
--
--     batches.stock == SUM(inventory_movements.change_qty) for that batch
--
-- Enforced here by triggers. The companion migration 20260818000100 then takes
-- `stock` out of sync_apply_row's batches branch outright, so the sync contract
-- states the rule rather than relying on a trigger to quietly undo it; the
-- triggers below remain as the second line of defence for any other writer.

alter table batches add column if not exists oversold_at timestamptz;

-- ── batches.stock is not writable by sync ─────────────────────────────────
-- sync_apply_row still upserts batches for metadata (price, expiry, batch_no),
-- and that is still correctly last-write-wins. This strips `stock` out of
-- every such write, so a client absolute can never land. Movements are the
-- only way in, and they arrive through the ledger trigger below, which
-- announces itself with a transaction-local flag.
create or replace function batches_stock_is_ledger_derived()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if coalesce(current_setting('muthoy.ledger_apply', true), 'off') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- A newly synced batch opens empty; its opening quantity arrives as the
    -- movement the client recorded alongside it. Seeding it here as well would
    -- double-count the moment that movement applies.
    new.stock := 0;
    new.oversold_at := null;
  else
    new.stock := old.stock;
    new.oversold_at := old.oversold_at;
  end if;
  return new;
end $fn$;

drop trigger if exists batches_stock_guard on batches;
create trigger batches_stock_guard
  before insert or update on batches
  for each row execute function batches_stock_is_ledger_derived();

-- ── the ledger applies deltas atomically ──────────────────────────────────
-- `stock = stock + delta` under Postgres row-level locking: two concurrent
-- transactions touching one batch serialize, the second reads the first's
-- committed value, and both deltas survive. This is the serialization point
-- the whole design rests on -- no advisory locks, no retry loop, no read-
-- modify-write in application code that could interleave.
--
-- AFTER INSERT only. A redelivered movement conflicts on its primary key in
-- sync_apply_row and updates nothing (identical updated_at fails that branch's
-- `updated_at < excluded.updated_at` predicate), so this never fires twice for
-- one movement. The movement id IS the idempotency key.
create or replace function apply_inventory_movement()
returns trigger language plpgsql set search_path = public as $fn$
begin
  perform set_config('muthoy.ledger_apply', 'on', true);
  update batches
     set stock = stock + new.change_qty,
         -- Deliberately allowed to go negative. Offline sales on two phones
         -- can together outrun real stock; those sales physically happened and
         -- the customers left with the medicine. Refusing the movement to keep
         -- the number tidy would be the actual data loss. Mark it instead, so
         -- reconciliation can surface a recount, and let reads clamp what they
         -- DISPLAY at zero.
         oversold_at = case
           when stock + new.change_qty < 0 and oversold_at is null then now()
           else oversold_at
         end,
         -- Forces this batch past every device's pull cursor, so the other
         -- phone learns the new quantity on its next incremental pull.
         updated_at = greatest(updated_at, now())
   where id = new.batch_id;

  if not found then
    perform set_config('muthoy.ledger_apply', 'off', true);
    raise exception 'inventory movement % references unknown batch %', new.id, new.batch_id
      using errcode = 'MU005';
  end if;

  perform set_config('muthoy.ledger_apply', 'off', true);
  return new;
end $fn$;

drop trigger if exists inventory_movement_applies_delta on inventory_movements;
create trigger inventory_movement_applies_delta
  after insert on inventory_movements
  for each row execute function apply_inventory_movement();

-- ── the ledger is append-only ─────────────────────────────────────────────
-- Rewriting an applied delta would desynchronise stock from the sum of its
-- movements with nothing to correct it: the apply trigger is INSERT-only by
-- design, so it would never see the change.
create or replace function inventory_movement_is_immutable()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if old.change_qty <> new.change_qty or old.batch_id <> new.batch_id then
    raise exception 'inventory_movements is append-only: change_qty and batch_id are immutable'
      using errcode = 'MU006';
  end if;
  return new;
end $fn$;

drop trigger if exists inventory_movement_immutable on inventory_movements;
create trigger inventory_movement_immutable
  before update on inventory_movements
  for each row execute function inventory_movement_is_immutable();

-- ...and append-only has to cover DELETE, not only UPDATE. A deleted movement
-- takes its delta out of the ledger while leaving it inside batches.stock, and
-- the apply trigger (INSERT-only by design) never subtracts it back: the same
-- silent divergence the guard above prevents, reached through a different verb.
--
-- Nothing needs a physical delete. sync_apply_row's delete branch already
-- tombstones inventory_movements (is_deleted/deleted_at/deleted_by), and a
-- tombstoned movement deliberately STAYS in the ledger sum -- its delta really
-- happened, and the batch's stock still contains it. Note this also makes a
-- shop row undeletable while it holds any movement, since
-- inventory_movements.shop_id is `on delete cascade`. Intended: shop deletion
-- is a tombstone too, and a cascade that discarded a shop's entire stock
-- history should not be one statement away.
create or replace function inventory_movement_is_undeletable()
returns trigger language plpgsql set search_path = public as $fn$
begin
  raise exception 'inventory_movements is an append-only ledger: rows are never physically deleted; set is_deleted instead'
    using errcode = 'MU007';
end $fn$;

drop trigger if exists inventory_movement_no_delete on inventory_movements;
create trigger inventory_movement_no_delete
  before delete on inventory_movements
  for each row execute function inventory_movement_is_undeletable();

-- ── near-real-time propagation to the other device ────────────────────────
-- Realtime is used as a SIGNAL, not as a data channel: the client reacts by
-- running the incremental pull it already has, so there is exactly one apply
-- path (sync/pull.ts) and one place where FK ordering and idempotency live.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'batches'
     )
  then
    alter publication supabase_realtime add table batches;
  end if;
end $$;

revoke execute on function batches_stock_is_ledger_derived() from public, anon, authenticated;
revoke execute on function apply_inventory_movement() from public, anon, authenticated;
revoke execute on function inventory_movement_is_immutable() from public, anon, authenticated;
revoke execute on function inventory_movement_is_undeletable() from public, anon, authenticated;

-- ══ BACKFILL: bring EVERY existing batch onto the invariant ═══════════════
--
-- Shops running the old absolute-stock code have batches whose quantity was
-- never expressed as movements (db/inventory.ts wrote stock with no ledger row
-- at all, while purchases.ts and sales.ts wrote BOTH an absolute and a
-- movement). Emit one synthetic movement for the difference so
-- stock == SUM(movements) holds from here forward and the triggers above have
-- a consistent base to add to.
--
-- Every batch, including is_deleted = true. A tombstoned batch still carries a
-- quantity and can still be restored, and skipping it would leave a row the
-- guards can never afterwards repair -- correcting it later would need an
-- absolute write, which is exactly what batches_stock_guard refuses.
do $$
declare
  v_batch record;
  v_ledger integer;
  v_gap integer;
  v_actor uuid;
  v_violations integer;
begin
  for v_batch in select id, shop_id, stock from batches loop
    select coalesce(sum(change_qty), 0) into v_ledger
      from inventory_movements where batch_id = v_batch.id;
    v_gap := v_batch.stock - v_ledger;
    continue when v_gap = 0;

    -- Deliberately NOT filtered on users.is_deleted. created_by is
    -- `not null references users(id)`, so what matters is that the foreign key
    -- resolves -- a tombstoned user row still does. Attributing a historical
    -- correction is a referential question, not a question of who may
    -- currently log in, and excluding soft-deleted users is what used to leave
    -- shops silently skipped.
    select id into v_actor from users
     where shop_id = v_batch.shop_id
     order by created_at, id limit 1;
    if v_actor is null then
      -- Never `continue`. Passing over a gap leaves a permanently unrepairable
      -- batch: the guards would then reject every write to it with nothing
      -- left to explain why. Fail the migration and let an operator decide.
      raise exception 'ledger backfill: batch % in shop % has a stock gap of % but the shop has no user row to attribute the movement to',
        v_batch.id, v_batch.shop_id, v_gap using errcode = 'MU008';
    end if;

    -- Drop the projection to what the ledger currently proves, THEN append the
    -- gap. The apply trigger adds v_gap on insert, landing back on the batch's
    -- original quantity. Inserting the movement without this rewind would have
    -- the trigger add the gap on top of a figure that already included it --
    -- every batch in every existing shop silently doubled by its own backfill.
    perform set_config('muthoy.ledger_apply', 'on', true);
    update batches set stock = v_ledger where id = v_batch.id;
    perform set_config('muthoy.ledger_apply', 'off', true);

    -- The id is DERIVED FROM THE BATCH ID, not generated, and the device's
    -- migration 0006 derives it the same way. Both stores meet this same
    -- historical gap independently and must not each add it: sharing a primary
    -- key makes the second copy to arrive an existing row, so sync_apply_row's
    -- `on conflict (id) do update` updates metadata and the INSERT-only apply
    -- trigger never fires twice. With gen_random_uuid() they would be two
    -- distinct movements and every pre-existing batch would silently double.
    --
    -- The mapping: take the batch's UUID and set the VERSION nibble -- the
    -- character right after the third hyphen, position 15 -- to '8'.
    --     batch     7f3a91c2-4d5e-4b8a-9c1d-2e6f8a0b3c4d
    --     movement  7f3a91c2-4d5e-8b8a-9c1d-2e6f8a0b3c4d
    --                             ^
    -- Total, injective and collision-free without hashing, which SQLite could
    -- not do in a migration anyway. Every id in this app comes from
    -- expo-crypto randomUUID and is therefore version 4, so version 4 is the
    -- only input nibble (making the map one-to-one) and no generated id can
    -- ever equal an output (no v4 id carries version 8). Version 8 means
    -- "custom" in RFC 9562, which is exactly what this is.
    insert into inventory_movements (id, shop_id, batch_id, change_qty, reason, ref_id, created_by, created_at, updated_at)
    values (overlay(v_batch.id::text placing '8' from 15 for 1)::uuid,
            v_batch.shop_id, v_batch.id, v_gap, 'adjustment', null, v_actor, now(), now());
  end loop;

  -- Assert the invariant now holds for EVERY batch, or fail the migration. A
  -- backfill that half-worked and reported success is worse than one that
  -- refused: the guards would reject writes to the batches it missed, with
  -- nothing left to say why. Raising here rolls the whole migration back --
  -- Supabase runs each file in a transaction -- so there is no partially
  -- migrated state to clean up.
  select count(*) into v_violations from batches b
   where b.stock <> coalesce(
     (select sum(m.change_qty) from inventory_movements m where m.batch_id = b.id), 0);
  if v_violations > 0 then
    raise exception 'ledger backfill left % batch(es) whose stock is not the sum of their inventory_movements', v_violations
      using errcode = 'MU009';
  end if;
end $$;
