-- DEV SQL Editor ONLY. NOT APPROVED FOR EXECUTION YET.
-- Require dev_harness_12_preflight.sql safe_to_delete_12 = 1, a fresh DEV
-- schema/data backup, and separate approval of the exact output first.
-- This file ends in ROLLBACK. The twelve targets are derived ONLY from the
-- strict proof join; the other two stamped accounts are never selected.
-- Never run on PROD. Never use a billing account as a shop selector.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Freeze every auth/public table before scope, blocker and cascade checks.
-- A concurrent child-table INSERT must not appear after its zero-row check.
-- Lock timeout fails closed; this is a brief DEV maintenance transaction.
do $locks$
declare v_table regclass;
begin
  for v_table in
    select c.oid::regclass
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('auth', 'public') and c.relkind in ('r', 'p')
      and not c.relispartition
    order by c.oid
  loop
    execute format('lock table %s in share row exclusive mode', v_table);
  end loop;
end
$locks$;

create temporary table h5_stamped_auth on commit drop as
  select id from auth.users where raw_app_meta_data->>'dev_harness' = 'true';

-- Every shop must independently name its stamped claimant. The Owner row,
-- binding, role, and singleton account must all agree with THAT shop; no shop
-- is added merely because its billing_account_id matches another target.
create temporary table h5_cleanup_scope on commit drop as
  select c.shop_id, c.claimed_by_user_id as auth_user_id,
    s.owner_id, ba.id as account_id
  from public.shop_claims c
  join h5_stamped_auth a on a.id = c.claimed_by_user_id
  join public.shops s on s.id = c.shop_id and s.name = 'DEV Test Shop'
  join public.users u on u.id = s.owner_id and u.shop_id = s.id and u.phone is null
  join public.roles r on r.id = u.role_id and r.shop_id = s.id
    and r.name = 'owner' and not r.is_deleted
  join public.auth_bindings ab on ab.app_user_id = u.id
    and ab.auth_user_id = c.claimed_by_user_id
  join public.billing_accounts ba on ba.principal_owner_user_id = u.id
    and ba.primary_shop_id = s.id and s.billing_account_id = ba.id;

create unique index on h5_cleanup_scope(shop_id);
create unique index on h5_cleanup_scope(auth_user_id);
create unique index on h5_cleanup_scope(account_id);

create temporary table h5_cleanup_auth on commit drop as
  select auth_user_id as id from h5_cleanup_scope;
create unique index on h5_cleanup_auth(id);
create temporary table h5_excluded_auth on commit drop as
  select a.id from h5_stamped_auth a
  where not exists (select 1 from h5_cleanup_auth t where t.id = a.id);
create unique index on h5_excluded_auth(id);

-- Compare the two excluded identities and their core relationships after
-- deletion. Only hashes live in this transaction; no row values are output.
create temporary table h5_excluded_before on commit drop as
  select e.id,
    md5(to_jsonb(a)::text) as auth_digest,
    md5(to_jsonb(sc)::text) as claim_digest,
    md5(to_jsonb(s)::text) as shop_digest,
    md5(to_jsonb(u)::text) as owner_digest,
    md5(to_jsonb(r)::text) as role_digest,
    md5(to_jsonb(ab)::text) as binding_digest,
    md5(to_jsonb(ba)::text) as account_digest
  from h5_excluded_auth e
  join auth.users a on a.id = e.id
  left join public.shop_claims sc on sc.claimed_by_user_id = e.id
  left join public.shops s on s.id = sc.shop_id
  left join public.users u on u.id = s.owner_id
  left join public.roles r on r.id = u.role_id
  left join public.auth_bindings ab on ab.auth_user_id = e.id
  left join public.billing_accounts ba on ba.id = s.billing_account_id;
create unique index on h5_excluded_before(id);

-- Preserve every unrelated core row byte-for-byte, not merely its count.
-- Digests and UUID keys are transaction-local and are never returned.
create temporary table h5_unrelated_before on commit drop as
  select 'auth.users'::text as entity, a.id, md5(to_jsonb(a)::text) as digest
    from auth.users a where a.id not in (select id from h5_cleanup_auth)
  union all select 'public.shops', s.id, md5(to_jsonb(s)::text)
    from public.shops s where s.id not in (select shop_id from h5_cleanup_scope)
  union all select 'public.users', u.id, md5(to_jsonb(u)::text)
    from public.users u where u.id not in (select owner_id from h5_cleanup_scope)
  union all select 'public.billing_accounts', ba.id, md5(to_jsonb(ba)::text)
    from public.billing_accounts ba where ba.id not in (select account_id from h5_cleanup_scope);
create unique index on h5_unrelated_before(entity, id);

do $safety$
declare
  v_count bigint;
  v_table record;
  v_auth_fk_issues bigint;
  v_shop_ids uuid[];
  v_account_ids uuid[];
begin
  select array_agg(shop_id), array_agg(account_id)
    into v_shop_ids, v_account_ids from h5_cleanup_scope;
  if (select count(*) from h5_stamped_auth) <> 14
     or (select count(*) from h5_cleanup_auth) <> 12
     or (select count(*) from h5_cleanup_scope) <> 12
     or (select count(distinct account_id) from h5_cleanup_scope) <> 12
     or (select count(*) from h5_excluded_auth) <> 2
     or (select count(*) from h5_excluded_before) <> 2
     or (select count(*) from public.shop_claims c
         join h5_stamped_auth a on a.id = c.claimed_by_user_id) <> 14
     or (select count(*) from public.shop_claims c
         join h5_excluded_auth e on e.id = c.claimed_by_user_id) <> 2
     or (select count(*) from public.auth_bindings ab
         join h5_excluded_auth e on e.id = ab.auth_user_id) <> 2 then
    raise exception 'DEV harness 12 cleanup stopped: expected 14 stamped, 12 exact targets and 2 excluded';
  end if;

  if exists (select 1 from auth.users a join h5_cleanup_auth h on h.id = a.id
      where a.phone is not null or a.is_anonymous)
     or exists (select 1 from auth.identities i join h5_cleanup_auth h on h.id = i.user_id
      where i.provider <> 'email') then
    raise exception 'DEV harness 12 cleanup stopped: target account has a phone or non-email identity';
  end if;

  if exists (select 1 from h5_cleanup_scope p
      join public.shops s on s.id = p.shop_id
      join public.users u on u.id = p.owner_id
      join auth.users a on a.id = p.auth_user_id
      where s.name <> 'DEV Test Shop' or s.name = 'H-5 E2E Test Shop'
        or u.phone is not null or a.phone is not null) then
    raise exception 'DEV harness 12 cleanup stopped: an H-5 phone/E2E scope was selected';
  end if;

  if exists (select 1 from public.users u
      where u.shop_id in (select shop_id from h5_cleanup_scope)
        and u.id not in (select owner_id from h5_cleanup_scope))
     or exists (select 1 from public.shops s
      where s.billing_account_id in (select account_id from h5_cleanup_scope)
        and s.id not in (select shop_id from h5_cleanup_scope))
     or exists (select 1 from public.shop_memberships m
      where m.billing_account_id in (select account_id from h5_cleanup_scope)
        and m.shop_id not in (select shop_id from h5_cleanup_scope))
     or exists (select 1 from public.auth_bindings ab
      join public.users u on u.id = ab.app_user_id
      where u.shop_id in (select shop_id from h5_cleanup_scope)
        and ab.auth_user_id not in (select id from h5_cleanup_auth))
     or exists (select 1 from public.auth_bindings ab
      where ab.auth_user_id in (select id from h5_cleanup_auth)
        and ab.app_user_id not in (select owner_id from h5_cleanup_scope)) then
    raise exception 'DEV harness cleanup stopped: a target account or shop has an outside relationship';
  end if;

  select coalesce(sum(n), 0) into v_count from (
    select count(*)::bigint as n from public.shop_memberships m
      join h5_cleanup_scope p on p.shop_id = m.shop_id
      where m.principal_user_id <> p.owner_id or m.actor_user_id <> p.owner_id
    union all select count(*) from public.user_permissions x
      join h5_cleanup_scope p on p.shop_id = x.shop_id where x.user_id <> p.owner_id
    union all select count(*) from public.shop_devices d
      join h5_cleanup_scope p on p.shop_id = d.shop_id
      where d.enrolled_by_user_id <> p.owner_id
        or (d.revoked_by is not null and d.revoked_by <> p.owner_id)
    union all select count(*) from public.shop_device_bindings b
      join h5_cleanup_scope p on p.shop_id = b.shop_id
      where b.actor_user_id <> p.owner_id
        or (b.bound_by_user_id is not null and b.bound_by_user_id <> p.owner_id)
        or (b.revoked_by is not null and b.revoked_by <> p.owner_id)
    union all select count(*) from public.device_registry_events e
      join h5_cleanup_scope p on p.shop_id = e.shop_id
      where (e.actor_user_id is not null and e.actor_user_id <> p.owner_id)
        or (e.target_user_id is not null and e.target_user_id <> p.owner_id)
    union all select count(*) from public.auth_session_devices sd
      join h5_cleanup_scope p on p.shop_id = sd.shop_id
      left join auth.sessions s on s.id = sd.auth_session_id
      where sd.actor_user_id <> p.owner_id
        or (s.user_id is not null and s.user_id <> p.auth_user_id)
    union all select count(*) from public.device_enrollment_holds h
      join h5_cleanup_scope p on p.shop_id = h.shop_id
      where h.actor_user_id <> p.owner_id or h.held_by_user_id <> p.owner_id
        or (h.approved_by_user_id is not null and h.approved_by_user_id <> p.owner_id)
  ) parts;
  if v_count <> 0 then
    raise exception 'DEV harness cleanup stopped: a structural row references another principal';
  end if;

  -- Paid/commercial orders are not stale registration residue. A shop that
  -- ever traded needs a bespoke, separately reviewed disposal plan instead.
  if exists (select 1 from public.payment_orders
      where billing_account_id in (select account_id from h5_cleanup_scope))
     or exists (select 1 from public.billing_subscriptions
      where billing_account_id in (select account_id from h5_cleanup_scope))
     or exists (select 1 from public.entitlement_snapshots
      where billing_account_id in (select account_id from h5_cleanup_scope)
        and tier <> 'free')
     or exists (select 1 from public.subscriptions
      where shop_id in (select shop_id from h5_cleanup_scope)
        and (plan <> 'free' or status <> 'trialing')) then
    raise exception 'DEV harness 12 cleanup stopped: target account has payment or paid entitlement activity';
  end if;

  -- Every populated public shop_id table must be one of the specifically
  -- reviewed structural tables below. This catches new migrations and real
  -- trading data before a cascading DELETE can touch either.
  for v_table in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'shop_id'
      and a.atttypid = 'uuid'::regtype and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relname not in (
        'shop_claims', 'roles', 'users', 'subscriptions', 'user_permissions',
        'shop_b2_settings', 'h7_shop_billing_bootstrap_windows',
        'shop_memberships', 'shop_devices', 'shop_device_bindings',
        'device_registry_events', 'auth_session_devices', 'device_enrollment_holds'
      )
  loop
    execute format('select count(*) from %I.%I where shop_id = any($1)',
      v_table.nspname, v_table.relname)
      into v_count using v_shop_ids;
    if v_count <> 0 then
      raise exception 'DEV harness cleanup stopped: nonstructural target-shop rows exist';
    end if;
  end loop;

  -- Account-only tables other than the reviewed subscription/snapshot/order
  -- set must not be silently cascaded by a future migration.
  for v_table in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'billing_account_id'
      and a.atttypid = 'uuid'::regtype and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relname not in ('shops', 'shop_memberships',
        'billing_subscriptions', 'entitlement_snapshots', 'payment_orders')
  loop
    execute format('select count(*) from %I.%I where billing_account_id = any($1)',
      v_table.nspname, v_table.relname)
      into v_count using v_account_ids;
    if v_count <> 0 then
      raise exception 'DEV harness cleanup stopped: unreviewed account-linked rows exist';
    end if;
  end loop;

  if exists (select 1 from public.sync_operation_chunks c
      join public.sync_operation_staging s on s.operation_id = c.operation_id
      where s.shop_id in (select shop_id from h5_cleanup_scope))
     or exists (select 1 from auth.refresh_tokens rt
      join auth.sessions s on s.id = rt.session_id
      where s.user_id in (select id from h5_cleanup_auth)
        and rt.user_id is distinct from s.user_id::text)
     or exists (select 1 from auth.refresh_tokens rt
      where rt.user_id in (select id::text from h5_cleanup_auth)
        and rt.session_id is not null
        and not exists (select 1 from auth.sessions s where s.id = rt.session_id
          and s.user_id::text = rt.user_id)) then
    raise exception 'DEV harness cleanup stopped: an indirect child has ambiguous ownership';
  end if;

  if exists (
    select 1 from pg_constraint fk
    join pg_class parent on parent.oid = fk.confrelid
    join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
    join pg_class child on child.oid = fk.conrelid
    join pg_namespace child_ns on child_ns.oid = child.relnamespace
    where fk.contype = 'f' and parent_ns.nspname = 'public' and child_ns.nspname = 'public'
      and parent.relname in ('shops', 'users', 'roles', 'permissions',
        'shop_claims', 'subscriptions', 'user_permissions', 'shop_b2_settings',
        'h7_shop_billing_bootstrap_windows', 'billing_accounts',
        'shop_memberships', 'billing_subscriptions', 'entitlement_snapshots',
        'payment_orders', 'sync_operation_staging', 'shop_devices',
        'shop_device_bindings', 'device_registry_events',
        'auth_session_devices', 'device_enrollment_holds')
      and child.relname not in ('permissions', 'billing_accounts',
        'payment_provider_events', 'sync_operation_chunks')
      and not exists (select 1 from pg_attribute a where a.attrelid = child.oid
        and a.attname in ('shop_id', 'billing_account_id') and not a.attisdropped)
  ) then
    raise exception 'DEV harness cleanup stopped: an unreviewed public FK child exists';
  end if;

  -- Auth child FKs must all CASCADE from a stamped user, never SET NULL or
  -- reach public data. The exact child-table counts are in the preflight.
  with recursive auth_tree(relid, seen) as (
    select 'auth.users'::regclass::oid, array['auth.users'::regclass::oid]
    union all
    select fk.conrelid, t.seen || fk.conrelid
    from auth_tree t
    join pg_constraint fk on fk.confrelid = t.relid and fk.contype = 'f'
      and fk.confdeltype = 'c' and cardinality(fk.conkey) = 1
      and cardinality(fk.confkey) = 1
    where cardinality(t.seen) < 9 and not fk.conrelid = any(t.seen)
  )
  select count(*) into v_auth_fk_issues from (
    select 1 from pg_constraint fk
    join auth_tree t on t.relid = fk.confrelid
    join pg_class child on child.oid = fk.conrelid
    join pg_namespace ns on ns.oid = child.relnamespace
    where fk.contype = 'f' and (
      fk.confdeltype <> 'c' or cardinality(fk.conkey) <> 1
      or cardinality(fk.confkey) <> 1 or ns.nspname <> 'auth'
    )
    union all
    select 1 from auth_tree group by relid having count(*) > 1
    union all
    select 1 from auth_tree t
      join pg_constraint fk on fk.confrelid = t.relid and fk.contype = 'f'
        and fk.confdeltype = 'c'
      where cardinality(t.seen) = 9 and not fk.conrelid = any(t.seen)
  ) problems;
  if v_auth_fk_issues <> 0 then
    raise exception 'DEV harness cleanup stopped: auth FK graph is not cascade-only and auth-local';
  end if;
end
$safety$;

-- The only updated rows are independently proven shops. This breaks B4's
-- mutual RESTRICT pair without touching any other shop on the account.
update public.shops set billing_account_id = null
where id in (select shop_id from h5_cleanup_scope);

delete from public.shop_memberships
where shop_id in (select shop_id from h5_cleanup_scope);
delete from public.entitlement_snapshots
where billing_account_id in (select account_id from h5_cleanup_scope);
delete from public.billing_subscriptions
where billing_account_id in (select account_id from h5_cleanup_scope);
delete from public.billing_accounts
where id in (select account_id from h5_cleanup_scope);

-- A2.3's RESTRICT links require leaf-first deletion. Every predicate is the
-- independently proven shop_id; no current-session or device-wide operation.
delete from public.device_enrollment_holds
where shop_id in (select shop_id from h5_cleanup_scope);
delete from public.auth_session_devices
where shop_id in (select shop_id from h5_cleanup_scope);
delete from public.device_registry_events
where shop_id in (select shop_id from h5_cleanup_scope);
delete from public.shop_device_bindings
where shop_id in (select shop_id from h5_cleanup_scope);
delete from public.shop_devices
where shop_id in (select shop_id from h5_cleanup_scope);

delete from public.auth_bindings
where auth_user_id in (select id from h5_cleanup_auth);
delete from public.user_permissions
where shop_id in (select shop_id from h5_cleanup_scope);
delete from public.permissions
where role_id in (select id from public.roles
  where shop_id in (select shop_id from h5_cleanup_scope));
delete from public.users
where id in (select owner_id from h5_cleanup_scope);
delete from public.roles
where shop_id in (select shop_id from h5_cleanup_scope);
delete from public.shop_claims
where shop_id in (select shop_id from h5_cleanup_scope);
delete from public.shops
where id in (select shop_id from h5_cleanup_scope);

-- Old session-less refresh tokens have no session FK to cascade through.
delete from auth.refresh_tokens
where user_id in (select id::text from h5_cleanup_auth);
delete from auth.users
where id in (select id from h5_cleanup_auth);

do $postcheck$
begin
  if exists (select 1 from auth.users where id in (select id from h5_cleanup_auth))
     or exists (select 1 from public.shops where id in (select shop_id from h5_cleanup_scope))
     or exists (select 1 from public.users where id in (select owner_id from h5_cleanup_scope))
     or exists (select 1 from public.billing_accounts where id in (select account_id from h5_cleanup_scope))
     or exists (select 1 from public.shop_claims where shop_id in (select shop_id from h5_cleanup_scope))
     or exists (select 1 from public.auth_bindings where auth_user_id in (select id from h5_cleanup_auth))
     or exists (select 1 from auth.sessions where user_id in (select id from h5_cleanup_auth))
     or exists (select 1 from auth.refresh_tokens where user_id in (select id::text from h5_cleanup_auth))
     or (select count(*) from auth.users where raw_app_meta_data->>'dev_harness' = 'true') <> 2
     or (select count(*) from auth.users a join h5_excluded_auth e on e.id = a.id) <> 2 then
    raise exception 'DEV harness 12 cleanup stopped: expected twelve removals and two retained stamps';
  end if;

  if exists (
    select 1 from h5_excluded_before b
    left join auth.users a on a.id = b.id
    left join public.shop_claims sc on sc.claimed_by_user_id = b.id
    left join public.shops s on s.id = sc.shop_id
    left join public.users u on u.id = s.owner_id
    left join public.roles r on r.id = u.role_id
    left join public.auth_bindings ab on ab.auth_user_id = b.id
    left join public.billing_accounts ba on ba.id = s.billing_account_id
    where b.auth_digest is distinct from md5(to_jsonb(a)::text)
       or b.claim_digest is distinct from md5(to_jsonb(sc)::text)
       or b.shop_digest is distinct from md5(to_jsonb(s)::text)
       or b.owner_digest is distinct from md5(to_jsonb(u)::text)
       or b.role_digest is distinct from md5(to_jsonb(r)::text)
       or b.binding_digest is distinct from md5(to_jsonb(ab)::text)
       or b.account_digest is distinct from md5(to_jsonb(ba)::text)
  ) then
    raise exception 'DEV harness 12 cleanup stopped: an excluded account or relationship changed';
  end if;

  if exists (
    with current_rows as (
      select 'auth.users'::text as entity, a.id, md5(to_jsonb(a)::text) as digest
        from auth.users a where a.id not in (select id from h5_cleanup_auth)
      union all select 'public.shops', s.id, md5(to_jsonb(s)::text)
        from public.shops s where s.id not in (select shop_id from h5_cleanup_scope)
      union all select 'public.users', u.id, md5(to_jsonb(u)::text)
        from public.users u where u.id not in (select owner_id from h5_cleanup_scope)
      union all select 'public.billing_accounts', ba.id, md5(to_jsonb(ba)::text)
        from public.billing_accounts ba where ba.id not in (select account_id from h5_cleanup_scope)
    )
    select 1 from h5_unrelated_before b
    full join current_rows c on c.entity = b.entity and c.id = b.id
    where b.digest is distinct from c.digest
  ) then
    raise exception 'DEV harness 12 cleanup stopped: unrelated DEV core data changed';
  end if;
end
$postcheck$;

-- Counts only. This transaction still ROLLS BACK by default.
select 'stamped_auth_remaining' as entity, count(*) as row_count from auth.users
where raw_app_meta_data->>'dev_harness' = 'true'
union all
select 'target_shops_remaining', count(*) from public.shops
where id in (select shop_id from h5_cleanup_scope)
union all
select 'target_claims_remaining', count(*) from public.shop_claims
where shop_id in (select shop_id from h5_cleanup_scope)
union all
select 'excluded_stamped_auth_remaining', count(*) from auth.users
where id in (select id from h5_excluded_auth);

rollback;
