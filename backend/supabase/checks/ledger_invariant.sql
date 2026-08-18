-- Post-migration validation for the inventory movement ledger.
--
-- RUN BY HAND against Dev/Test after applying 20260818000000 and
-- 20260818000100, before promoting either anywhere else. This file lives
-- OUTSIDE supabase/migrations/ on purpose: the CLI applies that directory and
-- only that directory, so nothing here can ever run as a migration.
--
--     psql "$DATABASE_URL" -f backend/supabase/checks/ledger_invariant.sql
--
-- Read-only: every statement is a select. It is safe to run on a live database
-- and safe to run repeatedly.
--
-- PASS looks like: status = 'PASS' from check 0, zero rows from checks 1
-- through 4, and 'present' for all four triggers in check 5. Anything else
-- means do not promote.

\echo '-- 0. the invariant, over every batch in every shop --------------------'

-- The whole design in one row. `batches.stock` is a projection of the ledger;
-- if these disagree anywhere, some quantity was written without a movement or
-- some movement failed to apply.
select
  count(*)                                        as batches_checked,
  count(*) filter (where b.stock <> b.ledger_sum) as batches_off_invariant,
  case when count(*) filter (where b.stock <> b.ledger_sum) = 0
       then 'PASS' else 'FAIL' end                as status
from (
  select b.id, b.stock, coalesce((
    select sum(m.change_qty) from inventory_movements m where m.batch_id = b.id
  ), 0) as ledger_sum
  from batches b
) b;

\echo '-- 1. which batches are off it (expect zero rows) ----------------------'

-- Soft-deleted batches are INCLUDED, deliberately. A tombstoned batch still
-- carries a quantity and can still be restored, and batches_stock_guard makes
-- an off-invariant row permanently unrepairable: correcting it would need an
-- absolute write, which the guard refuses.
select b.shop_id, b.id as batch_id, b.is_deleted, b.stock,
       coalesce(l.ledger_sum, 0) as ledger_sum,
       b.stock - coalesce(l.ledger_sum, 0) as gap
from batches b
left join lateral (
  select sum(m.change_qty) as ledger_sum from inventory_movements m where m.batch_id = b.id
) l on true
where b.stock <> coalesce(l.ledger_sum, 0)
order by abs(b.stock - coalesce(l.ledger_sum, 0)) desc
limit 100;

\echo '-- 2. movements whose batch does not exist (expect zero rows) ----------'

-- apply_inventory_movement raises MU005 on these, so they should be
-- unreachable. If any exist, their delta is in the ledger and in no projection.
select m.id as movement_id, m.shop_id, m.batch_id, m.change_qty
from inventory_movements m
where not exists (select 1 from batches b where b.id = m.batch_id)
limit 100;

\echo '-- 3. shops holding a stock gap with no user to attribute it to --------'

-- The backfill raises MU008 rather than skipping these, so after a successful
-- migration this is empty by construction. Kept as a standing check because a
-- later data import could reintroduce the condition.
select b.shop_id, count(*) as batches
from batches b
where not exists (select 1 from users u where u.shop_id = b.shop_id)
  and b.stock <> coalesce(
    (select sum(m.change_qty) from inventory_movements m where m.batch_id = b.id), 0)
group by b.shop_id;

\echo '-- 4. duplicate backfill movements for one batch (expect zero rows) ----'

-- The synthetic id is derived from the batch id (version nibble set to '8') so
-- the device and the cloud mint the SAME primary key for the same historical
-- gap. More than one adjustment sitting in a batch's backfill slot would mean
-- the two stores reconciled it twice and the quantity doubled.
select m.batch_id, count(*) as backfill_movements
from inventory_movements m
where m.id = overlay(m.batch_id::text placing '8' from 15 for 1)::uuid
group by m.batch_id
having count(*) > 1;

\echo '-- 5. the guards are actually installed --------------------------------'

select expected.name as trigger_name,
       case when t.tgname is null then 'MISSING' else 'present' end as status
from (values
  ('batches_stock_guard'),
  ('inventory_movement_applies_delta'),
  ('inventory_movement_immutable'),
  ('inventory_movement_no_delete')
) as expected(name)
left join pg_trigger t on t.tgname = expected.name and not t.tgisinternal
order by expected.name;
