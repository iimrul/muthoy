-- H-7 security hardening: database authority for cross-shop writes, and read
-- parity between the sync pull and RLS.
--
-- Additive only. Nothing here edits an applied migration; every function is
-- extended by the established rename-then-wrap pattern, and every policy is
-- dropped-then-recreated by name so a re-run converges instead of stacking two
-- generations of restrictive predicates.
--
-- WHAT THE AUDIT FOUND, AND WHAT EACH SECTION CLOSES
--
-- C-1  sync_apply_row accepted a row whose shop_id named ANOTHER shop, as long
--      as the row id did not already exist. The insert arm of
--      sync_apply_row_base carries its p_caller_shop_id predicate only on the
--      ON CONFLICT DO UPDATE branch, and sync_existing_row_owned_or_missing
--      answers true for a missing row by definition. Executed against a real
--      Postgres, a Shop A caller planted a medicine and a customer into Shop B
--      and invented a brand-new shops row, all returning 'applied'. The only
--      thing standing in the way was push.ts's TypeScript check.
--
-- H-1  sync_pull_changes_b2 gated fifteen tables on nothing but "is the caller
--      a live user of this shop". A default Staff member (sales +
--      inventory_view) whose RLS read of `expenses` and `payments` returns
--      zero rows was nevertheless sent every expense and every payment in the
--      shop, straight into their device's SQLite.
--
-- M-1  Six B2 tables carried a bare `shop_id = jwt shop_id` read policy with no
--      liveness check, so a deactivated staff member kept reading them for the
--      remaining life of their access token.
--
-- M-2  The `staff_id = jwt app_user_id` branch of the sale-history policies had
--      no liveness check either — the other branch got one for free from
--      auth_has_permission, that one did not.
--
-- M-4  b4_user_within_current_staff_limit and b4_shop_write_permitted returned
--      an unconditional true whenever billing_account_id was null.
--
-- M-5  custom_access_token_hook's fallback branch mints fully decorated claims
--      for a principal the primary branch would refuse. REPORTED, IMPLEMENTED,
--      AND REVERTED — section 6 records the evidence. The finding is real; the
--      fix broke revocation reporting, and the claims confer nothing because
--      every consumer re-reads liveness from the tables.

-- ── 1. C-1: the row's shop is the caller's shop, before any dispatch ────────
--
-- Mirrors sync_apply_b2_row's own first check (20260821010000, line 455), which
-- has always been right; this brings the pre-B2 dispatcher — medicines,
-- batches, customers, sales, users, credits, payments, everything — up to the
-- same standard.
--
-- IMMUTABLE and total: it answers for every table, including ones added later,
-- because the default arm demands shop_id rather than exempting the unknown.

create or replace function h7_row_shop_matches_caller(
  p_table text, p_row jsonb, p_caller_shop_id uuid
) returns boolean language sql immutable set search_path = public as $fn$
  select case
    -- `permissions` is the one synced table with no shop_id column at all. Its
    -- owning shop is reached through role_id, and sync_apply_row_base already
    -- proves that with assert_fk_same_shop('roles', ...) before it writes.
    when p_table = 'permissions' then true
    -- A shops row IS its own shop. Without this a caller could invent an
    -- arbitrary new shop, which is exactly what the audit demonstrated.
    when p_table = 'shops' then (p_row ->> 'id') is not distinct from p_caller_shop_id::text
    else (p_row ->> 'shop_id') is not distinct from p_caller_shop_id::text
  end
$fn$;

revoke execute on function h7_row_shop_matches_caller(text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function h7_row_shop_matches_caller(text, jsonb, uuid) to service_role;

-- Reapply-safe: a second application replaces the wrapper below rather than
-- renaming that wrapper into its own callee, which would recurse until the
-- stack depth blew — in production, on every sync write.
do $rename_apply_row$
begin
  if to_regprocedure('public.sync_apply_row_pre_h7(text,text,jsonb,uuid,uuid,text)') is null then
    alter function sync_apply_row(text, text, jsonb, uuid, uuid, text)
      rename to sync_apply_row_pre_h7;
  end if;
end
$rename_apply_row$;

-- The 5-argument overload needs no change: PostgreSQL re-resolves a SQL
-- function body's callees BY NAME after a rename, so
-- sync_apply_row(t,o,r,shop,user) -> sync_apply_row(...,null) lands on this
-- wrapper automatically. Verified by the pgtest below, which drives BOTH
-- arities rather than assuming it.
create or replace function sync_apply_row(
  p_table text, p_op text, p_row jsonb,
  p_caller_shop_id uuid, p_caller_user_id uuid, p_device_id text
) returns text language plpgsql security definer set search_path = public as $fn$
begin
  if not h7_row_shop_matches_caller(p_table, p_row, p_caller_shop_id) then
    raise exception 'row does not belong to the authenticated shop'
      using errcode = 'MU003';
  end if;
  return sync_apply_row_pre_h7(
    p_table, p_op, p_row, p_caller_shop_id, p_caller_user_id, p_device_id
  );
end
$fn$;

revoke execute on function sync_apply_row_pre_h7(text,text,jsonb,uuid,uuid,text),
  sync_apply_row(text,text,jsonb,uuid,uuid,text) from public, anon, authenticated;
grant execute on function sync_apply_row_pre_h7(text,text,jsonb,uuid,uuid,text),
  sync_apply_row(text,text,jsonb,uuid,uuid,text) to service_role;

-- ── 2. M-4: the null-billing fail-open becomes a bounded window ────────────
--
-- Canonical onboarding creates the shop AND its billing account inside one
-- link-device call, so a live shop without an account is a stuck bootstrap, not
-- a normal state. It was previously granted unlimited staff and unlimited
-- writes, forever.
--
-- Three distinct cases, deliberately answered differently:
--   * no shops row yet   -> allowed. b4_onboard_owner creates it, so this is
--                           the gap between onboarding and the first sync push.
--   * archived / deleted -> refused. The old code reached its `return true`
--                           through exactly this path.
--   * present, no account-> allowed only inside the bootstrap window.

create or replace function h7_shop_billing_bootstrap_allowed(
  p_shop_id uuid, p_now timestamptz default now()
) returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare v_shop shops%rowtype;
begin
  select * into v_shop from shops where id = p_shop_id;
  if not found then return true; end if;
  if v_shop.is_deleted or v_shop.archived_at is not null then return false; end if;
  if v_shop.billing_account_id is not null then return true; end if;
  return v_shop.created_at > p_now - interval '24 hours';
end
$fn$;

revoke execute on function h7_shop_billing_bootstrap_allowed(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function h7_shop_billing_bootstrap_allowed(uuid, timestamptz) to service_role;

create or replace function b4_user_within_current_staff_limit(
  p_app_user_id uuid, p_now timestamptz default now()
) returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare v_user users%rowtype; v_role text; v_account uuid; v_tier text := 'free';
  v_limit integer; v_ordinal integer;
begin
  select * into v_user from users
  where id = p_app_user_id and is_active and not is_deleted;
  if not found then return false; end if;
  select name into v_role from roles
  where id = v_user.role_id and shop_id = v_user.shop_id and not is_deleted;
  if not found then return false; end if;
  if v_role = 'owner' then return true; end if;
  select billing_account_id into v_account from shops
  where id = v_user.shop_id and not is_deleted and archived_at is null;
  -- H-7 M-4: bounded, not unconditional.
  if v_account is null then
    return h7_shop_billing_bootstrap_allowed(v_user.shop_id, p_now);
  end if;
  select case when status = 'trialing' and trial_ends_at > p_now then 'ultra'
    when status in ('active','canceled') and paid_through > p_now then tier
    when status in ('active','past_due','grace') and grace_ends_at > p_now then tier
    else 'free' end into v_tier
  from entitlement_snapshots where billing_account_id = v_account;
  select max_active_non_owner_staff_per_shop into v_limit from plan_offerings
  where tier = coalesce(v_tier,'free') and billing_cycle = 'monthly';
  if v_limit is null then return true; end if;
  select ordinal into v_ordinal from (
    select u.id, row_number() over (order by u.created_at, u.id) ordinal
    from users u join roles r on r.id = u.role_id
    where u.shop_id = v_user.shop_id and u.is_active and not u.is_deleted and r.name <> 'owner'
  ) ranked where id = p_app_user_id;
  return coalesce(v_ordinal <= v_limit, false);
end
$fn$;

create or replace function b4_shop_write_permitted(
  p_shop_id uuid, p_now timestamptz default now()
) returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare v_account uuid; v_tier text := 'free'; v_limit integer; v_ordinal integer;
begin
  select billing_account_id into v_account from shops
  where id = p_shop_id and is_deleted = false and archived_at is null;
  -- H-7 M-4: bounded, and an archived shop now answers false here instead of
  -- falling through the same `return true` a bootstrapping shop used.
  if v_account is null then
    return h7_shop_billing_bootstrap_allowed(p_shop_id, p_now);
  end if;
  select case
    when status = 'trialing' and trial_ends_at > p_now then 'ultra'
    when status in ('active','canceled') and paid_through > p_now then tier
    when status in ('active','past_due','grace') and grace_ends_at > p_now then tier
    else 'free' end into v_tier from entitlement_snapshots where billing_account_id = v_account;
  select max_active_shops into v_limit from plan_offerings
    where tier = coalesce(v_tier,'free') and billing_cycle = 'monthly';
  if v_limit is null then return true; end if;
  select ordinal into v_ordinal from (
    select id, row_number() over (order by created_at, id) ordinal from shops
    where billing_account_id = v_account and is_deleted = false and archived_at is null
  ) ranked where id = p_shop_id;
  return coalesce(v_ordinal <= v_limit, false);
end
$fn$;

-- ── 3. H-1: one definition of "may this caller read this table" ────────────
--
-- The pull and the readable-table set below are both expressed through this
-- function, so they cannot drift from each other. Keeping the predicates here
-- rather than inline in the union is the whole point: the previous version
-- duplicated the rule for eight tables and simply omitted it for fifteen more.
--
-- Every arm mirrors the effective `muthoy_read` / `b2_*_read` policy for that
-- table. user_has_permission already resolves inactive, soft-deleted,
-- plan-suspended and archived-shop callers to false, so liveness rides along.
--
-- The sales family answers `true` here and is filtered ROW BY ROW in the union
-- instead: eligibility there depends on sale_history versus the caller's own
-- staff_id, which is not a table-level question.

create or replace function sync_table_readable(p_app_user_id uuid, p_table text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case p_table
    -- Shop identity, the role/permission model, and the roster. RLS reads these
    -- through auth_is_live_user(); the caller gate in the pull is the same test.
    -- users carries pin_hash by design: PIN login on an enrolled device matches
    -- offline against every live user's hash. Encryption at rest for that is
    -- H-3/SQLCipher, not a read predicate.
    when 'shops' then true
    when 'subscriptions' then true
    when 'roles' then true
    when 'permissions' then true
    when 'users' then true
    when 'user_permissions' then true
    when 'shop_b2_settings' then true

    when 'medicines' then user_has_permission(p_app_user_id,'inventory_view')
                        or user_has_permission(p_app_user_id,'inventory_write')
    when 'batches' then user_has_permission(p_app_user_id,'inventory_view')
                      or user_has_permission(p_app_user_id,'inventory_write')
    -- Promotions set the price a cashier charges, so selling requires reading
    -- them even without an inventory grant.
    when 'batch_promotions' then user_has_permission(p_app_user_id,'inventory_view')
                               or user_has_permission(p_app_user_id,'inventory_write')
                               or user_has_permission(p_app_user_id,'sales')
    when 'inventory_movements' then user_has_permission(p_app_user_id,'inventory_view')
                                  or user_has_permission(p_app_user_id,'sales')

    when 'customers' then user_has_permission(p_app_user_id,'sales')
                        or user_has_permission(p_app_user_id,'credit_management')

    -- Row-filtered in the union: sale_history, or the caller's own receipts.
    when 'sales' then true
    when 'sale_items' then true
    when 'sale_attachments' then true
    when 'sale_refunds' then true
    when 'sales_returns' then true
    when 'refund_tenders' then true

    when 'sale_drafts' then user_has_permission(p_app_user_id,'sales')
    when 'sale_draft_items' then user_has_permission(p_app_user_id,'sales')

    when 'suppliers' then user_has_permission(p_app_user_id,'inventory_view')
                        or user_has_permission(p_app_user_id,'inventory_write')
    when 'purchases' then user_has_permission(p_app_user_id,'inventory_view')
                        or user_has_permission(p_app_user_id,'inventory_write')
    when 'purchase_items' then user_has_permission(p_app_user_id,'inventory_view')
                             or user_has_permission(p_app_user_id,'inventory_write')
    when 'purchase_returns' then user_has_permission(p_app_user_id,'inventory_view')
                               or user_has_permission(p_app_user_id,'inventory_write')

    when 'credits' then user_has_permission(p_app_user_id,'sales')
                      or user_has_permission(p_app_user_id,'credit_management')
    -- The allocation ledger is a credit-desk artefact; a refund needs it to
    -- rebuild collection_refund tenders, hence sale_return.
    when 'credit_payment_allocations' then user_has_permission(p_app_user_id,'credit_view')
                                         or user_has_permission(p_app_user_id,'credit_management')
                                         or user_has_permission(p_app_user_id,'sale_return')
    -- A credit sale writes a reconciliation row inside its own atomic graph, so
    -- plain 'sales' has to be able to see it.
    when 'credit_reconciliation_states' then user_has_permission(p_app_user_id,'sales')
                                           or user_has_permission(p_app_user_id,'credit_view')
                                           or user_has_permission(p_app_user_id,'credit_management')
                                           or user_has_permission(p_app_user_id,'sale_return')

    when 'expenses' then user_has_permission(p_app_user_id,'cash_management')
    when 'payments' then user_has_permission(p_app_user_id,'cash_management')
                       or user_has_permission(p_app_user_id,'credit_management')
                       or user_has_permission(p_app_user_id,'inventory_write')
    when 'cash_drawer' then user_has_permission(p_app_user_id,'sales')
                          or user_has_permission(p_app_user_id,'cash_management')

    when 'inventory_imports' then b2_user_is_owner(p_app_user_id)
    when 'audit_logs' then b2_user_is_owner(p_app_user_id)
    -- Unknown table: refuse. A table added later is invisible until somebody
    -- names its rule here, which is the safe direction to forget in.
    else false
  end
$fn$;

revoke execute on function sync_table_readable(uuid, text) from public, anon, authenticated;
grant execute on function sync_table_readable(uuid, text) to service_role;

-- What the caller may currently pull, as a set the DEVICE can act on.
--
-- sync/pull.ts returns this to the client so a device whose permissions were
-- narrowed can DROP the local rows it is no longer entitled to. Without it a
-- revoked cash_management holder keeps every expense row ever synced, since a
-- pull that simply stops sending rows cannot un-send the ones already on disk.
create or replace function sync_readable_tables(p_shop_id uuid, p_app_user_id uuid)
returns text[] language sql stable security definer set search_path = public as $fn$
  select coalesce(array_agg(t.name order by t.name), array[]::text[])
  from unnest(array[
    'shops','subscriptions','roles','permissions','users','user_permissions',
    'shop_b2_settings','medicines','batches','batch_promotions',
    'inventory_movements','customers','sales','sale_items','sale_drafts',
    'sale_draft_items','sale_attachments','sale_refunds','sales_returns',
    'refund_tenders','suppliers','purchases','purchase_items','purchase_returns',
    'credits','credit_payment_allocations','credit_reconciliation_states',
    'expenses','payments','cash_drawer','inventory_imports','audit_logs'
  ]) as t(name)
  where sync_table_readable(p_app_user_id, t.name)
    and exists(
      select 1 from users u
      where u.id = p_app_user_id and u.shop_id = p_shop_id
        and u.is_active and not u.is_deleted
    )
$fn$;

revoke execute on function sync_readable_tables(uuid, uuid) from public, anon, authenticated;
grant execute on function sync_readable_tables(uuid, uuid) to service_role;

-- The pull itself. Same signature, same ordering, same pagination contract —
-- every union arm now carries its table's read rule.
create or replace function sync_pull_changes_b2(
  p_shop_id uuid, p_app_user_id uuid, p_since_updated_at timestamptz,
  p_since_table text, p_since_id uuid, p_limit integer
)
returns table(table_name text, row_id uuid, updated_at timestamptz, row_data jsonb)
language sql security definer set search_path = public as $fn$
  with caller as (
    select user_has_permission(p_app_user_id,'sale_history') can_history
    where exists(select 1 from users u where u.id = p_app_user_id and u.shop_id = p_shop_id
      and u.is_active and not u.is_deleted)
  ), readable as (
    select t.name from unnest(array[
      'shops','subscriptions','roles','permissions','users','user_permissions',
      'shop_b2_settings','medicines','batches','batch_promotions',
      'inventory_movements','customers','sales','sale_items','sale_drafts',
      'sale_draft_items','sale_attachments','sale_refunds','sales_returns',
      'refund_tenders','suppliers','purchases','purchase_items','purchase_returns',
      'credits','credit_payment_allocations','credit_reconciliation_states',
      'expenses','payments','cash_drawer','inventory_imports','audit_logs'
    ]) as t(name)
    where exists(select 1 from caller) and sync_table_readable(p_app_user_id, t.name)
  ), all_changes as (
    select 'shops'::text table_name,id row_id,updated_at,to_jsonb(t.*) row_data from shops t where id=p_shop_id
    union all select 'subscriptions',id,updated_at,to_jsonb(t.*) from subscriptions t where shop_id=p_shop_id
    union all select 'roles',id,updated_at,to_jsonb(t.*) from roles t where shop_id=p_shop_id
    union all select 'permissions',id,updated_at,to_jsonb(t.*) from permissions t where role_id in(select id from roles where shop_id=p_shop_id)
    union all select 'users',id,updated_at,to_jsonb(t.*) from users t where shop_id=p_shop_id
    union all select 'user_permissions',id,updated_at,to_jsonb(t.*) from user_permissions t where shop_id=p_shop_id
    union all select 'shop_b2_settings',id,updated_at,to_jsonb(t.*) from shop_b2_settings t where shop_id=p_shop_id
    union all select 'medicines',id,updated_at,to_jsonb(t.*) from medicines t where shop_id=p_shop_id
    union all select 'batches',id,updated_at,to_jsonb(t.*) from batches t where shop_id=p_shop_id
    union all select 'batch_promotions',id,updated_at,to_jsonb(t.*) from batch_promotions t where shop_id=p_shop_id
    union all select 'inventory_movements',id,updated_at,to_jsonb(t.*) from inventory_movements t where shop_id=p_shop_id
    union all select 'customers',id,updated_at,to_jsonb(t.*) from customers t where shop_id=p_shop_id
    -- Row-level, exactly as b2_sales_history_read reads it.
    union all select 'sales',id,updated_at,to_jsonb(t.*) from sales t where shop_id=p_shop_id
      and exists(select 1 from caller c where c.can_history or t.staff_id=p_app_user_id)
    union all select 'sale_items',id,updated_at,to_jsonb(t.*) from sale_items t where shop_id=p_shop_id
      and exists(select 1 from sales s, caller c where s.id=t.sale_id and (c.can_history or s.staff_id=p_app_user_id))
    union all select 'sale_drafts',id,updated_at,to_jsonb(t.*) from sale_drafts t where shop_id=p_shop_id
    union all select 'sale_draft_items',id,updated_at,to_jsonb(t.*) from sale_draft_items t where shop_id=p_shop_id
    union all select 'sale_attachments',id,updated_at,to_jsonb(t.*) from sale_attachments t where shop_id=p_shop_id
      and exists(select 1 from sales s, caller c where s.id=t.sale_id and (c.can_history or s.staff_id=p_app_user_id))
    union all select 'sale_refunds',id,updated_at,to_jsonb(t.*) from sale_refunds t where shop_id=p_shop_id
      and exists(select 1 from sales s, caller c where s.id=t.sale_id and (c.can_history or s.staff_id=p_app_user_id))
    union all select 'sales_returns',id,updated_at,to_jsonb(t.*) from sales_returns t where shop_id=p_shop_id
      and exists(select 1 from sales s, caller c where s.id=t.sale_id and (c.can_history or s.staff_id=p_app_user_id))
    union all select 'refund_tenders',id,updated_at,to_jsonb(t.*) from refund_tenders t where shop_id=p_shop_id
      and exists(select 1 from sale_refunds r join sales s on s.id=r.sale_id cross join caller c
        where r.id=t.refund_id and (c.can_history or s.staff_id=p_app_user_id))
    union all select 'suppliers',id,updated_at,to_jsonb(t.*) from suppliers t where shop_id=p_shop_id
    union all select 'purchases',id,updated_at,to_jsonb(t.*) from purchases t where shop_id=p_shop_id
    union all select 'purchase_items',id,updated_at,to_jsonb(t.*) from purchase_items t where shop_id=p_shop_id
    union all select 'purchase_returns',id,updated_at,to_jsonb(t.*) from purchase_returns t where shop_id=p_shop_id
    union all select 'credits',id,updated_at,to_jsonb(t.*) from credits t where shop_id=p_shop_id
    union all select 'credit_payment_allocations',id,updated_at,to_jsonb(t.*) from credit_payment_allocations t where shop_id=p_shop_id
    union all select 'credit_reconciliation_states',id,updated_at,to_jsonb(t.*) from credit_reconciliation_states t where shop_id=p_shop_id
    union all select 'expenses',id,updated_at,to_jsonb(t.*) from expenses t where shop_id=p_shop_id
    union all select 'payments',id,updated_at,to_jsonb(t.*) from payments t where shop_id=p_shop_id
    union all select 'cash_drawer',id,updated_at,to_jsonb(t.*) from cash_drawer t where shop_id=p_shop_id
    union all select 'inventory_imports',id,updated_at,to_jsonb(t.*) from inventory_imports t where shop_id=p_shop_id
    union all select 'audit_logs',id,updated_at,to_jsonb(t.*) from audit_logs t where shop_id=p_shop_id
  )
  -- The table gate is a JOIN rather than a per-arm predicate so that adding a
  -- union arm without a rule in sync_table_readable yields nothing at all,
  -- instead of yielding everything.
  select a.table_name,a.row_id,a.updated_at,a.row_data
  from all_changes a join readable r on r.name = a.table_name
  where (p_since_updated_at is null or (a.updated_at,a.table_name,a.row_id)>
      (p_since_updated_at,coalesce(p_since_table,''),coalesce(p_since_id,'00000000-0000-0000-0000-000000000000'::uuid)))
  order by a.updated_at,a.table_name,a.row_id limit p_limit
$fn$;

revoke execute on function sync_pull_changes_b2(uuid,uuid,timestamptz,text,uuid,integer)
  from public, anon, authenticated;
grant execute on function sync_pull_changes_b2(uuid,uuid,timestamptz,text,uuid,integer)
  to service_role;

-- ── 4. M-1: liveness (and permission) on the bare B2 read policies ─────────
--
-- These were created as `shop_id = jwt shop_id` and nothing else, and the B4
-- commercial pass skipped them because it keyed on tables carrying a
-- muthoy_insert policy, which these do not. auth_is_live_user() is the same
-- predicate the Group A tables use; it also covers plan suspension, the staff
-- limit, and an archived shop.

drop policy if exists b2_shop_read on shop_b2_settings;
drop policy if exists h7_shop_b2_settings_read on shop_b2_settings;
create policy h7_shop_b2_settings_read on shop_b2_settings for select using (
  shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and auth_is_live_user()
);

drop policy if exists b2_shop_read on batch_promotions;
drop policy if exists h7_batch_promotions_read on batch_promotions;
create policy h7_batch_promotions_read on batch_promotions for select using (
  shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and auth_is_live_user()
  and (auth_has_permission('inventory_view') or auth_has_permission('inventory_write')
    or auth_has_permission('sales'))
);

drop policy if exists b2_shop_read on sale_drafts;
drop policy if exists h7_sale_drafts_read on sale_drafts;
create policy h7_sale_drafts_read on sale_drafts for select using (
  shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and auth_is_live_user() and auth_has_permission('sales')
);

drop policy if exists b2_shop_read on sale_draft_items;
drop policy if exists h7_sale_draft_items_read on sale_draft_items;
create policy h7_sale_draft_items_read on sale_draft_items for select using (
  shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and auth_is_live_user() and auth_has_permission('sales')
);

drop policy if exists b2_shop_read on credit_payment_allocations;
drop policy if exists h7_credit_payment_allocations_read on credit_payment_allocations;
create policy h7_credit_payment_allocations_read on credit_payment_allocations for select using (
  shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and auth_is_live_user()
  and (auth_has_permission('credit_view') or auth_has_permission('credit_management')
    or auth_has_permission('sale_return'))
);

drop policy if exists b2_shop_read on credit_reconciliation_states;
drop policy if exists h7_credit_reconciliation_states_read on credit_reconciliation_states;
create policy h7_credit_reconciliation_states_read on credit_reconciliation_states for select using (
  shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and auth_is_live_user()
  and (auth_has_permission('sales') or auth_has_permission('credit_view')
    or auth_has_permission('credit_management') or auth_has_permission('sale_return'))
);

-- ── 5. M-2: the own-receipts branch gets the liveness it never had ─────────
--
-- `auth_has_permission('sale_history')` resolves a deactivated caller to false
-- on its own, so the first branch was always closed. `staff_id = <claim>` is a
-- bare column comparison and was not. Wrapping the whole predicate in
-- auth_is_live_user() closes the second without changing the first.

drop policy if exists b2_sales_history_read on sales;
create policy b2_sales_history_read on sales for select using (
  shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and auth_is_live_user()
  and (auth_has_permission('sale_history')
    or staff_id = nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid)
);

drop policy if exists b2_sale_items_history_read on sale_items;
create policy b2_sale_items_history_read on sale_items for select using (
  shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and auth_is_live_user()
  and exists(select 1 from sales s where s.id=sale_items.sale_id and s.shop_id=sale_items.shop_id
    and (auth_has_permission('sale_history')
      or s.staff_id = nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid))
);

drop policy if exists b2_refund_history_read on sale_refunds;
create policy b2_refund_history_read on sale_refunds for select using (
  shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and auth_is_live_user()
  and exists(select 1 from sales s where s.id=sale_refunds.sale_id and s.shop_id=sale_refunds.shop_id
    and (auth_has_permission('sale_history')
      or s.staff_id = nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid))
);

drop policy if exists b2_refund_tender_history_read on refund_tenders;
create policy b2_refund_tender_history_read on refund_tenders for select using (
  shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and auth_is_live_user()
  and exists(select 1 from sale_refunds r join sales s on s.id=r.sale_id
    where r.id=refund_tenders.refund_id and r.shop_id=refund_tenders.shop_id
      and (auth_has_permission('sale_history')
        or s.staff_id = nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid))
);

drop policy if exists b2_attachment_history_read on sale_attachments;
create policy b2_attachment_history_read on sale_attachments for select using (
  shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and auth_is_live_user()
  and exists(select 1 from sales s where s.id=sale_attachments.sale_id and s.shop_id=sale_attachments.shop_id
    and (auth_has_permission('sale_history')
      or s.staff_id = nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid))
);

drop policy if exists b2_returns_history_read on sales_returns;
create policy b2_returns_history_read on sales_returns for select using (
  shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and auth_is_live_user()
  and exists(select 1 from sales s where s.id=sales_returns.sale_id and s.shop_id=sales_returns.shop_id
    and (auth_has_permission('sale_history')
      or s.staff_id = nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid))
);

-- The storage-object predicate for prescription attachments reads the same
-- history rule through user_has_permission, which already covers liveness. It
-- gains the shop/live check explicitly so the three paths stay identical.
create or replace function auth_can_access_sale_attachment_path(p_name text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select split_part(p_name, '/', 1) = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')
    and split_part(p_name, '/', 4) = ''
    and auth_is_live_user()
    and exists(
      select 1 from sale_attachments a join sales s on s.id=a.sale_id and s.shop_id=a.shop_id
      join users u on u.id=nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid
      where a.shop_id=nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
        and a.sale_id::text=split_part(p_name,'/',2)
        and a.id::text=split_part(p_name,'/',3) and a.storage_path=p_name
        and u.shop_id=a.shop_id and u.is_active and not u.is_deleted
        and (user_has_permission(u.id,'sale_history') or s.staff_id=u.id)
    )
$fn$;

-- ── 6. M-5: DELIBERATELY NOT CHANGED — see the reasoning below ────────────
--
-- The audit flagged an asymmetry that is real: the primary membership lookup
-- demands an active, non-suspended actor in a live shop, while the fallback
-- demands only `is_deleted = false`. So a deactivated or plan-suspended
-- principal still receives shop_id, role and permission_version.
--
-- Adding the missing liveness checks was implemented, tested, and REVERTED,
-- because it converts a revocation into an infrastructure error:
--
--   no claims -> _shared/auth.ts's requireCallerAppUserId raises 503
--   `hook_not_configured` -> sync/requestFailure.ts classifies that as `config`
--   -> isRetriableFailure() is false -> the client HALTS and tells the
--   pharmacist the server is misconfigured.
--
-- A deactivated staff member must instead get 401 `permissions_changed` (one
-- refresh) and then 403 "Account is no longer active", which is what happens
-- only while the token still carries app_user_id and permission_version.
-- pgtest/security.pgtest.ts's "carries the CURRENT permission_version, so a
-- refresh picks up a revocation" pins exactly that, and it is the test that
-- caught the regression.
--
-- The claims themselves confer nothing. Every consumer re-reads the database:
-- auth_is_live_user(), user_has_permission(), auth_is_owner(),
-- b4_auth_shop_write_permitted() and assertCallerCurrent() all resolve
-- is_active / plan_suspended_at / archived_at from the tables, never from the
-- token. `role` and `billing_account_id` are carried but never used for an
-- authorization decision — assertCallerCurrent derives both from the row.
--
-- The function is therefore restated here UNCHANGED from
-- 20260831000000_b4_commercial_platform.sql, so this file is a complete and
-- self-describing statement of the hook rather than leaving a reader to guess
-- whether H-7 touched it. h7_token_hook_decorates_revoked_principal in
-- pgtest/h7-security.pgtest.ts pins the behaviour as intentional.

create or replace function custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_claims jsonb := coalesce(event->'claims','{}'::jsonb);
  v_metadata jsonb := coalesce(event->'claims'->'app_metadata','{}'::jsonb);
  v_principal uuid;
  v_requested_shop uuid;
  v_user record;
  v_billing uuid;
begin
  select app_user_id into v_principal from auth_bindings
  where auth_user_id = (event->>'user_id')::uuid limit 1;
  if not found then return event; end if;

  begin v_requested_shop := nullif(v_metadata->>'active_shop_id','')::uuid;
  exception when invalid_text_representation then v_requested_shop := null; end;

  select u.id,u.shop_id,u.permission_version,u.is_active,r.name as role_name,m.billing_account_id
    into v_user
  from shop_memberships m join users u on u.id=m.actor_user_id and u.is_deleted=false
  join roles r on r.id=u.role_id and r.is_deleted=false
  join shops active_shop on active_shop.id=m.shop_id and active_shop.is_deleted=false and active_shop.archived_at is null
  where m.principal_user_id=v_principal and m.shop_id=v_requested_shop and m.is_active=true
    and u.is_active=true and u.plan_suspended_at is null
  limit 1;

  if not found then
    -- Deliberately WITHOUT the primary branch's liveness conditions. A revoked
    -- principal must still be identifiable, or the server cannot tell them
    -- apart from an unconfigured hook. See the block comment above.
    select u.id,u.shop_id,u.permission_version,u.is_active,r.name as role_name,s.billing_account_id
      into v_user
    from users u join roles r on r.id=u.role_id and r.is_deleted=false
    join shops s on s.id=u.shop_id
    where u.id=v_principal and u.is_deleted=false limit 1;
  end if;
  if not found then return event; end if;
  v_billing := v_user.billing_account_id;

  v_metadata := v_metadata || jsonb_build_object(
    'shop_id',v_user.shop_id,'active_shop_id',v_user.shop_id,'app_user_id',v_user.id,
    'principal_user_id',v_principal,'billing_account_id',v_billing,'role',v_user.role_name,
    'permission_version',v_user.permission_version,'is_active',v_user.is_active
  );
  return jsonb_set(event,'{claims,app_metadata}',v_metadata);
end
$fn$;

grant execute on function custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function custom_access_token_hook(jsonb) from public, anon, authenticated;

-- ── 7. Defence in depth ───────────────────────────────────────────────────
--
-- DELETE was never revoked from the API roles on the synced tables. Every
-- delete in this system is a tombstone (is_deleted/deleted_at/deleted_by) that
-- travels by sync; a physical DELETE through PostgREST would vanish from the
-- cloud while surviving on every device, with no tombstone left to propagate.
-- Foreign keys happen to block the realistic cases today, which is not a
-- guarantee and not the intent.
do $revoke_deletes$
declare v_table text;
begin
  foreach v_table in array array[
    'shops','subscriptions','roles','permissions','users','user_permissions',
    'shop_b2_settings','medicines','batches','batch_promotions',
    'inventory_movements','customers','sales','sale_items','sale_drafts',
    'sale_draft_items','sale_attachments','sale_refunds','sales_returns',
    'refund_tenders','suppliers','purchases','purchase_items','purchase_returns',
    'credits','credit_payment_allocations','credit_reconciliation_states',
    'expenses','payments','cash_drawer','inventory_imports','audit_logs'
  ] loop
    execute format('revoke delete on table %I from anon, authenticated', v_table);
  end loop;
end
$revoke_deletes$;

-- Superseded by sync_pull_changes_b2 since 20260821010000 and unreferenced by
-- any Edge Function since. It applied NO permission filtering at all — it
-- returned every audit_logs row for a shop to any caller who could reach it —
-- so leaving a service_role-executable copy in place was a standing liability.
drop function if exists sync_pull_changes(uuid, timestamptz, text, uuid, int);

-- RLS with no policy already denies these to anon/authenticated. The explicit
-- revoke means a future `create policy` on either table cannot accidentally
-- open an identity map or a lockout counter.
revoke all on table auth_bindings, login_attempts from public, anon, authenticated;
grant select, insert, update on table auth_bindings to service_role;
