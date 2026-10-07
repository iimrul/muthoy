-- DEV SQL Editor ONLY. READ-ONLY. Run this entire file before considering the
-- separate cleanup file. It returns counts and fixed labels, never row values.
-- A stamped auth user is only a candidate. A shop is in scope ONLY when its
-- own shop_claims row, Owner row, auth binding, and singleton billing account
-- all agree. A shared billing account is a blocker, not a selector.
begin transaction read only;

with recursive
marker_auth as materialized (
  select id from auth.users
  where raw_app_meta_data->>'dev_harness' = 'true'
),
marker_claims as materialized (
  select sc.shop_id, sc.claimed_by_user_id as auth_user_id
  from public.shop_claims sc
  join marker_auth a on a.id = sc.claimed_by_user_id
),
proven as materialized (
  select c.shop_id, c.auth_user_id, s.owner_id, ba.id as account_id
  from marker_claims c
  join public.shops s on s.id = c.shop_id and s.name = 'DEV Test Shop'
  join public.users u on u.id = s.owner_id and u.shop_id = s.id and u.phone is null
  join public.roles r on r.id = u.role_id and r.shop_id = s.id
    and r.name = 'owner' and not r.is_deleted
  join public.auth_bindings ab on ab.app_user_id = u.id
    and ab.auth_user_id = c.auth_user_id
  join public.billing_accounts ba on ba.principal_owner_user_id = u.id
    and ba.primary_shop_id = s.id and s.billing_account_id = ba.id
),
ids as (
  select
    'ARRAY[' || coalesce((select string_agg(quote_literal(id::text), ',') from marker_auth), '') || ']::uuid[]' as auth_sql,
    'ARRAY[' || coalesce((select string_agg(quote_literal(shop_id::text), ',') from proven), '') || ']::uuid[]' as shop_sql,
    'ARRAY[' || coalesce((select string_agg(quote_literal(account_id::text), ',') from proven), '') || ']::uuid[]' as account_sql
),
shop_tables as (
  select n.nspname, c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'shop_id'
    and a.atttypid = 'uuid'::regtype and not a.attisdropped
  where n.nspname = 'public' and c.relkind in ('r', 'p')
),
shop_counts as (
  select t.relname,
    (xpath('/table/row/n/text()', query_to_xml(
      format('select count(*) as n from %I.%I where shop_id = any (%s)',
        t.nspname, t.relname, ids.shop_sql), false, false, ''
    )))[1]::text::bigint as n
  from shop_tables t cross join ids
),
account_tables as (
  select n.nspname, c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'billing_account_id'
    and a.atttypid = 'uuid'::regtype and not a.attisdropped
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'shops'
    and not exists (select 1 from pg_attribute sa
      where sa.attrelid = c.oid and sa.attname = 'shop_id' and not sa.attisdropped)
),
account_counts as (
  select t.relname,
    (xpath('/table/row/n/text()', query_to_xml(
      format('select count(*) as n from %I.%I where billing_account_id = any (%s)',
        t.nspname, t.relname, ids.account_sql), false, false, ''
    )))[1]::text::bigint as n
  from account_tables t cross join ids
),
-- Enumerate every auth table reached by an ON DELETE CASCADE FK, including
-- indirect descendants (session refresh tokens, MFA claims/challenges, etc.).
auth_paths(relid, depth, from_sql, seen) as (
  select 'auth.users'::regclass::oid, 0, 'auth.users t0'::text,
    array['auth.users'::regclass::oid]
  union all
  select fk.conrelid, p.depth + 1,
    format('%I.%I t%s join %s on t%s.%I = t%s.%I',
      ns.nspname, child.relname, p.depth + 1, p.from_sql,
      p.depth + 1, child_col.attname, p.depth, parent_col.attname) collate "default",
    p.seen || fk.conrelid
  from auth_paths p
  join pg_constraint fk on fk.confrelid = p.relid and fk.contype = 'f'
    and fk.confdeltype = 'c' and cardinality(fk.conkey) = 1
    and cardinality(fk.confkey) = 1
  join pg_class child on child.oid = fk.conrelid
  join pg_namespace ns on ns.oid = child.relnamespace
  join pg_attribute child_col on child_col.attrelid = fk.conrelid
    and child_col.attnum = fk.conkey[1]
  join pg_attribute parent_col on parent_col.attrelid = fk.confrelid
    and parent_col.attnum = fk.confkey[1]
  where p.depth < 8 and not fk.conrelid = any(p.seen)
),
auth_counts as (
  select ns.nspname, c.relname, p.relid,
    (xpath('/table/row/n/text()', query_to_xml(
      format('select count(*) as n from %s where t0.id = any (%s)',
        p.from_sql, ids.auth_sql), false, false, ''
    )))[1]::text::bigint as n
  from auth_paths p
  join pg_class c on c.oid = p.relid
  join pg_namespace ns on ns.oid = c.relnamespace
  cross join ids
  where p.depth > 0
),
target_sessions as (
  select id from auth.sessions where user_id in (select id from marker_auth)
),
business_rows as (
  select coalesce(sum(n), 0)::bigint as n from shop_counts
  where relname not in (
    'shop_claims', 'roles', 'users', 'subscriptions', 'user_permissions',
    'shop_b2_settings', 'h7_shop_billing_bootstrap_windows',
    'shop_memberships', 'shop_devices', 'shop_device_bindings',
    'device_registry_events', 'auth_session_devices', 'device_enrollment_holds'
  )
),
unreviewed_account_rows as (
  select coalesce(sum(n), 0)::bigint as n from account_counts
  where relname not in ('billing_subscriptions', 'entitlement_snapshots', 'payment_orders')
),
cross_owner_rows as (
  select coalesce(sum(n), 0)::bigint as n from (
    select count(*)::bigint as n from public.shop_memberships m
      join proven p on p.shop_id = m.shop_id
      where m.principal_user_id <> p.owner_id or m.actor_user_id <> p.owner_id
    union all select count(*) from public.user_permissions x
      join proven p on p.shop_id = x.shop_id where x.user_id <> p.owner_id
    union all select count(*) from public.shop_devices d
      join proven p on p.shop_id = d.shop_id
      where d.enrolled_by_user_id <> p.owner_id
        or (d.revoked_by is not null and d.revoked_by <> p.owner_id)
    union all select count(*) from public.shop_device_bindings b
      join proven p on p.shop_id = b.shop_id
      where b.actor_user_id <> p.owner_id
        or (b.bound_by_user_id is not null and b.bound_by_user_id <> p.owner_id)
        or (b.revoked_by is not null and b.revoked_by <> p.owner_id)
    union all select count(*) from public.device_registry_events e
      join proven p on p.shop_id = e.shop_id
      where (e.actor_user_id is not null and e.actor_user_id <> p.owner_id)
        or (e.target_user_id is not null and e.target_user_id <> p.owner_id)
    union all select count(*) from public.auth_session_devices sd
      join proven p on p.shop_id = sd.shop_id
      left join auth.sessions s on s.id = sd.auth_session_id
      where sd.actor_user_id <> p.owner_id
        or (s.user_id is not null and s.user_id <> p.auth_user_id)
    union all select count(*) from public.device_enrollment_holds h
      join proven p on p.shop_id = h.shop_id
      where h.actor_user_id <> p.owner_id or h.held_by_user_id <> p.owner_id
        or (h.approved_by_user_id is not null and h.approved_by_user_id <> p.owner_id)
  ) parts
),
guard_rows as (
  select 'stamped_auth_accounts'::text as entity, count(*)::bigint as n from marker_auth
  union all select 'stamped_shop_claims', count(*) from marker_claims
  union all select 'independently_proven_shops', count(*) from proven
  union all select 'distinct_proven_billing_accounts', count(distinct account_id) from proven
  union all select 'unproven_stamped_accounts_BLOCK', count(*) from marker_auth a
    where not exists (select 1 from proven p where p.auth_user_id = a.id)
  union all select 'multiple_claims_per_stamped_account_BLOCK', count(*) from (
    select auth_user_id from marker_claims group by auth_user_id having count(*) <> 1
  ) q
  union all select 'marked_phone_or_phone_identity_BLOCK', count(*) from auth.users a
    where a.id in (select id from marker_auth) and (
      a.phone is not null or a.is_anonymous
      or exists (select 1 from auth.identities i where i.user_id = a.id and i.provider <> 'email')
    )
  union all select 'extra_users_in_target_shops_BLOCK', count(*) from public.users u
    where u.shop_id in (select shop_id from proven)
      and u.id not in (select owner_id from proven)
  union all select 'nonharness_shops_on_target_accounts_BLOCK', count(*) from public.shops s
    where s.billing_account_id in (select account_id from proven)
      and s.id not in (select shop_id from proven)
  union all select 'outside_memberships_on_target_accounts_BLOCK', count(*) from public.shop_memberships m
    where m.billing_account_id in (select account_id from proven)
      and m.shop_id not in (select shop_id from proven)
  union all select 'outside_auth_bindings_in_target_shops_BLOCK', count(*) from public.auth_bindings ab
    join public.users u on u.id = ab.app_user_id
    where u.shop_id in (select shop_id from proven)
      and ab.auth_user_id not in (select id from marker_auth)
  union all select 'stamped_bindings_outside_target_BLOCK', count(*) from public.auth_bindings ab
    where ab.auth_user_id in (select id from marker_auth)
      and ab.app_user_id not in (select owner_id from proven)
  union all select 'payment_orders_on_target_accounts_BLOCK', count(*) from public.payment_orders po
    where po.billing_account_id in (select account_id from proven)
  union all select 'nonstructural_target_shop_rows_BLOCK', n from business_rows
  union all select 'unreviewed_account_linked_rows_BLOCK', n from unreviewed_account_rows
  union all select 'structural_rows_reference_other_principal_BLOCK', n from cross_owner_rows
  union all select 'auth_cascade_multiple_paths_BLOCK', count(*) from (
    select relid from auth_paths where depth > 0 group by relid having count(*) > 1
  ) q
  union all select 'auth_non_cascade_or_composite_fk_BLOCK', count(*) from pg_constraint fk
    where fk.contype = 'f' and fk.confrelid in (select relid from auth_paths)
      and (fk.confdeltype <> 'c' or cardinality(fk.conkey) <> 1 or cardinality(fk.confkey) <> 1)
  union all select 'auth_cascade_into_public_BLOCK', count(*) from auth_counts
    where nspname <> 'auth'
  union all select 'auth_cascade_depth_limit_BLOCK', count(*) from auth_paths p
    join pg_constraint fk on fk.confrelid = p.relid and fk.contype = 'f'
      and fk.confdeltype = 'c' where p.depth = 8 and not fk.conrelid = any(p.seen)
  union all select 'auth_refresh_token_user_mismatch_BLOCK', count(*) from auth.refresh_tokens rt
    where (rt.session_id in (select id from target_sessions)
      and rt.user_id is distinct from (select s.user_id::text from auth.sessions s where s.id = rt.session_id))
      or (rt.user_id in (select id::text from marker_auth) and rt.session_id is not null
        and not exists (select 1 from auth.sessions s where s.id = rt.session_id
          and s.user_id::text = rt.user_id))
  union all select 'unreviewed_public_indirect_fk_BLOCK', count(*)
    from pg_constraint fk
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
),
delete_rows as (
  select 'auth.users'::text as entity, 'service-role harness stamp'::text as reason,
    count(*)::bigint as n from marker_auth
  union all select 'public.shops', 'own claim + Owner binding + singleton account', count(*) from proven
  union all select 'public.billing_accounts', 'primary shop and principal both proven', count(distinct account_id) from proven
  union all select 'public.auth_bindings', 'bound to stamped auth user', count(*) from public.auth_bindings
    where auth_user_id in (select id from marker_auth)
  union all select 'public.permissions', 'role belongs to proven shop', count(*) from public.permissions p
    join public.roles r on r.id = p.role_id where r.shop_id in (select shop_id from proven)
  union all select 'public.sync_operation_chunks', 'staging row belongs to proven shop', count(*)
    from public.sync_operation_chunks c join public.sync_operation_staging s on s.operation_id = c.operation_id
    where s.shop_id in (select shop_id from proven)
  union all select 'public.payment_provider_events', 'order belongs to proven account', count(*)
    from public.payment_provider_events e join public.payment_orders o on o.id = e.payment_order_id
    where o.billing_account_id in (select account_id from proven)
  union all select 'auth.refresh_tokens', 'stamped user or one of its sessions', count(*)
    from auth.refresh_tokens rt where rt.user_id in (select id::text from marker_auth)
      or rt.session_id in (select id from target_sessions)
  union all select 'public.' || relname, 'exact independently proven shop_id', n from shop_counts
  union all select 'public.' || relname, 'singleton proven billing_account_id', n from account_counts
  union all select nspname || '.' || relname, 'cascade from stamped auth user', n from auth_counts
    where nspname = 'auth' and relname <> 'refresh_tokens'
),
exclusion_rows as (
  select 'other_DEV_auth_accounts_excluded'::text as entity, count(*)::bigint as n
    from auth.users where id not in (select id from marker_auth)
  union all select 'other_DEV_app_users_excluded', count(*) from public.users
    where shop_id not in (select shop_id from proven)
  union all select 'other_DEV_shops_excluded', count(*) from public.shops
    where id not in (select shop_id from proven)
  union all select 'phone_OTP_auth_accounts_excluded', count(*) from auth.users
    where phone is not null and id not in (select id from marker_auth)
  union all select 'phone_OTP_shops_excluded', count(*) from public.shop_claims sc
    join auth.users a on a.id = sc.claimed_by_user_id
    where a.phone is not null and a.id not in (select id from marker_auth)
  union all select 'same_account_nonharness_shops_excluded', count(*) from public.shops s
    where s.billing_account_id in (select account_id from proven)
      and s.id not in (select shop_id from proven)
),
report as (
  select 'GUARD'::text as section, entity, n as row_count,
    '14 for first four; every *_BLOCK must be zero'::text as reason from guard_rows
  union all select 'DELETE', entity, n, reason from delete_rows
  union all select 'EXCLUDED', entity, n, 'not selected for deletion' from exclusion_rows
  union all select 'DECISION', 'safe_to_delete_1_yes',
    case when (select n from guard_rows where entity = 'stamped_auth_accounts') = 14
       and (select n from guard_rows where entity = 'stamped_shop_claims') = 14
       and (select n from guard_rows where entity = 'independently_proven_shops') = 14
       and (select n from guard_rows where entity = 'distinct_proven_billing_accounts') = 14
       and not exists (select 1 from guard_rows where entity like '%_BLOCK' and n <> 0)
      then 1::bigint else 0::bigint end,
    '1 only if exact scope is proved; still take a fresh backup and approve cleanup'
)
select section, entity, row_count, reason from report
order by case section when 'DECISION' then 0 when 'GUARD' then 1
  when 'DELETE' then 2 else 3 end, entity;

commit;
