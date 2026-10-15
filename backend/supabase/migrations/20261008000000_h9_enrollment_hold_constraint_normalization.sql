-- H-9 (migration 32) — one canonical consumption CHECK on device_enrollment_holds.
--
-- Fresh bootstrap leaves TWO identical consumption CHECKs here. 20260923000000
-- creates one inline and unnamed — Postgres names it
-- device_enrollment_holds_check1, after the approval CHECK's
-- device_enrollment_holds_check — and 20260926000000 adds the named
-- device_enrollment_holds_consumption_check because it guards on that NAME.
-- Projects migrated through the earlier, recorded 0923 (DEV) carry only the
-- named one. This converges every path on exactly one canonical, validated
-- consumption CHECK beside the unchanged approval CHECK.
--
-- Equivalence is proved on the parse trees Postgres stored for THIS relation
-- (pg_constraint.conbin, conkey, connoinherit), against temporary NOT VALID
-- probes written with the exact rules — never by name, substring or
-- reformatted SQL text. PostgreSQL 17+ stores those trees without source
-- locations, which is what makes the comparison exact; older servers refuse.
--
-- It touches no row, function, grant, policy or other constraint, and a
-- second run is a no-op. Every unexpected shape aborts the whole migration
-- for review: an unvalidated or different canonical, a check1 that means
-- something else, any further equivalent duplicate, a missing approval CHECK,
-- or a row that violates the rule (it is refused, never repaired).
--
-- One DO block on purpose: it is atomic under any runner, so a failure can
-- never leave a probe behind or let a later statement drop a constraint.
-- Rollback: nothing to reverse — only an equivalent duplicate is ever dropped
-- (see ROLLBACK.md).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $h9_normalize$
declare
  v_table regclass := to_regclass('public.device_enrollment_holds');
  v_probe pg_constraint%rowtype;
  v_approval pg_constraint%rowtype;
  v_canonical pg_constraint%rowtype;
  v_check1 pg_constraint%rowtype;
  v_count integer;
begin
  -- Bounds the lock waits below even where a runner gives SET LOCAL no
  -- transaction (psql in autocommit): set here, it lasts for this statement.
  perform set_config('lock_timeout', '5s', true);

  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'h9_normalize: PostgreSQL 17 or later is required';
  end if;
  if v_table is null then
    raise exception 'h9_normalize: public.device_enrollment_holds is missing';
  end if;
  select count(*) into v_count
    from pg_attribute
   where attrelid = v_table and attnum > 0 and not attisdropped
     and (attname::text, format_type(atttypid, atttypmod)) in (
       ('approved_at', 'timestamp with time zone'),
       ('approved_by_user_id', 'uuid'),
       ('approved_by_device_id', 'uuid'),
       ('approved_device_public_id', 'text'),
       ('consumed_at', 'timestamp with time zone'),
       ('consumed_device_id', 'uuid'));
  if v_count <> 6 then
    raise exception 'h9_normalize: device_enrollment_holds columns are not the expected shape';
  end if;
  if exists (
    select 1 from pg_constraint
     where conrelid = v_table
       and conname in ('h9_device_enrollment_holds_consumption_probe',
                       'h9_device_enrollment_holds_approval_probe')
  ) then
    raise exception 'h9_normalize: a probe constraint name is already in use';
  end if;

  -- The two rules, verbatim from 20260923000000. NOT VALID: no row is read.
  alter table public.device_enrollment_holds
    add constraint h9_device_enrollment_holds_consumption_probe check (
      (consumed_at is null and consumed_device_id is null)
      or
      (consumed_at is not null and consumed_device_id is not null and approved_at is not null)
    ) not valid;
  alter table public.device_enrollment_holds
    add constraint h9_device_enrollment_holds_approval_probe check (
      (approved_at is null and approved_by_user_id is null and approved_by_device_id is null
        and approved_device_public_id is null)
      or
      (approved_at is not null and approved_by_user_id is not null
        and approved_by_device_id is not null and approved_device_public_id is not null)
    ) not valid;
  select * into strict v_probe from pg_constraint
   where conrelid = v_table and conname = 'h9_device_enrollment_holds_consumption_probe';
  select * into strict v_approval from pg_constraint
   where conrelid = v_table and conname = 'h9_device_enrollment_holds_approval_probe';

  -- 1. The canonical constraint: kept if it is exactly the rule, else made.
  select * into v_canonical from pg_constraint
   where conrelid = v_table and conname = 'device_enrollment_holds_consumption_check';
  if found then
    if v_canonical.contype is distinct from 'c'
       or not v_canonical.convalidated
       or v_canonical.conbin::text is distinct from v_probe.conbin::text
       or v_canonical.conkey is distinct from v_probe.conkey
       or v_canonical.connoinherit is distinct from v_probe.connoinherit then
      raise exception 'h9_normalize: device_enrollment_holds_consumption_check is not the validated canonical rule';
    end if;
    alter table public.device_enrollment_holds
      drop constraint h9_device_enrollment_holds_consumption_probe;
  else
    alter table public.device_enrollment_holds
      rename constraint h9_device_enrollment_holds_consumption_probe
      to device_enrollment_holds_consumption_check;
    -- Scans every row. A violating row aborts here; nothing is repaired.
    alter table public.device_enrollment_holds
      validate constraint device_enrollment_holds_consumption_check;
  end if;
  select * into strict v_canonical from pg_constraint
   where conrelid = v_table and conname = 'device_enrollment_holds_consumption_check';

  -- 2. The one known duplicate, dropped only when provably the same rule.
  select * into v_check1 from pg_constraint
   where conrelid = v_table and conname = 'device_enrollment_holds_check1';
  if found then
    if v_check1.contype is distinct from 'c'
       or not v_check1.convalidated
       or v_check1.conbin::text is distinct from v_canonical.conbin::text
       or v_check1.conkey is distinct from v_canonical.conkey
       or v_check1.connoinherit is distinct from v_canonical.connoinherit then
      raise exception 'h9_normalize: device_enrollment_holds_check1 is not the equivalent fresh-bootstrap duplicate';
    end if;
    alter table public.device_enrollment_holds
      drop constraint device_enrollment_holds_check1;
  end if;

  -- 3. Any other equivalent duplicate is unknown: review it, never guess.
  select count(*) into v_count from pg_constraint
   where conrelid = v_table and contype = 'c'
     and conname <> 'device_enrollment_holds_consumption_check'
     and conbin::text = v_canonical.conbin::text;
  if v_count <> 0 then
    raise exception 'h9_normalize: another consumption-equivalent CHECK exists; review before normalizing';
  end if;

  -- 4. The approval CHECK is unchanged: exactly one validated copy of its rule.
  select count(*) into v_count from pg_constraint
   where conrelid = v_table and contype = 'c' and convalidated
     and conname <> 'h9_device_enrollment_holds_approval_probe'
     and conbin::text = v_approval.conbin::text
     and conkey is not distinct from v_approval.conkey
     and connoinherit is not distinct from v_approval.connoinherit;
  if v_count <> 1 then
    raise exception 'h9_normalize: expected exactly one validated approval CHECK';
  end if;
  alter table public.device_enrollment_holds
    drop constraint h9_device_enrollment_holds_approval_probe;

  -- 5. End state: no probe, exactly one consumption rule.
  if exists (
    select 1 from pg_constraint
     where conrelid = v_table
       and conname in ('h9_device_enrollment_holds_consumption_probe',
                       'h9_device_enrollment_holds_approval_probe')
  ) then
    raise exception 'h9_normalize: a probe constraint was left behind';
  end if;
  select count(*) into v_count from pg_constraint
   where conrelid = v_table and contype = 'c'
     and conbin::text = v_canonical.conbin::text;
  if v_count <> 1 then
    raise exception 'h9_normalize: expected exactly one consumption CHECK';
  end if;
end
$h9_normalize$;
