-- H-5 — the SMS dispatch ledger behind Supabase Auth's Send SMS hook.
--
-- Supabase Auth generates and verifies every OTP. The hook
-- (functions/auth-send-sms) only DELIVERS the code, through REVE SMS — and
-- REVE has no request id of its own: every call it accepts is one SMS and one
-- charge, so a repeated call is a second SMS. This ledger is the only thing
-- that can say "this code has already gone out", and the only place the
-- per-number daily cap can be counted.
--
-- ONE ROW IS ONE PROVIDER CALL. It is claimed before the call and settled
-- after it, so a crash between the two leaves a pending row that still counts
-- against the cap and still blocks a duplicate. Nothing is ever retried from
-- here: an outcome nobody can confirm stays 'ambiguous'.
--
-- TWO DUPLICATE KEYS, because GoTrue mints a NEW webhook-id for every retry
-- attempt (supabase/auth internal/hooks/hookshttp, read 2026-10-01):
--   webhook_id   the Standard Webhooks id — an exact replay of one request.
--   content_key  HMAC(number, code) — the same code for the same number, which
--                is what a GoTrue retry is. Matched only inside the OTP's own
--                five-minute lifetime, so a coincidentally repeated code later
--                is sent normally instead of being swallowed.
--
-- NO PHONE NUMBER AND NO CODE IS STORED. phone_key and content_key are
-- HMAC-SHA256 under SMS_DISPATCH_HASH_KEY, an Edge Function secret this
-- database never sees. key_id names WHICH key wrote a row — a fingerprint of
-- the key, not the key.
--
-- ROTATING THAT KEY must not reset the cap or reopen a duplicate: a row
-- written under the old key is invisible to a caller holding only the new
-- one. So a claim reads rows under its current key AND an optional previous
-- key (SMS_DISPATCH_HASH_KEY_PREVIOUS), writes only under the current one,
-- and REFUSES — 'unknown_key', no send — while any row from the last 24 hours
-- (the widest window either check reads) was written under a key it does not
-- hold. Rotate by setting the new key and the old one as previous together,
-- and drop the previous key only once 24 hours have passed. Done wrong or
-- early, sends stop; they are never doubled.
--
-- No foreign keys (CLAUDE.md rule 2): this table references nothing and
-- nothing references it.

create table auth_sms_dispatches (
  webhook_id text primary key
    check (char_length(webhook_id) between 1 and 200),
  key_id text not null check (key_id ~ '^[0-9a-f]{16}$'),
  phone_key text not null check (phone_key ~ '^[0-9a-f]{64}$'),
  content_key text not null check (content_key ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'ambiguous')),
  reason text check (reason is null or reason ~ '^[a-z_]{1,40}$'),
  provider_status text
    check (provider_status is null or provider_status ~ '^-?[0-9]{1,6}$'),
  provider_message_id text
    check (provider_message_id is null or provider_message_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint auth_sms_dispatches_settlement_check
    check ((status = 'pending') = (settled_at is null))
);

create index auth_sms_dispatches_phone_idx on auth_sms_dispatches (phone_key, created_at);
create index auth_sms_dispatches_content_idx on auth_sms_dispatches (content_key, created_at);
create index auth_sms_dispatches_created_idx on auth_sms_dispatches (created_at);

-- RLS on with no policy, and no table privilege for ANY API role, service_role
-- included: the two functions below are the whole interface. An accidental
-- later GRANT still meets RLS and reads nothing.
alter table auth_sms_dispatches enable row level security;
revoke all on table auth_sms_dispatches from public, anon, authenticated, service_role;

-- Claims one provider call, or says why there must not be one.
--
--   {"decision":"send"}                      claimed; call the provider
--   {"decision":"duplicate","status":"..."}  this request, or this code for
--                                            this number, is already in the
--                                            ledger: replay its outcome
--   {"decision":"capped"}                    the number has used its daily cap
--   {"decision":"unknown_key"}               the last day holds rows written
--                                            under a key this caller lacks, so
--                                            neither check below can be trusted
--
-- The p_previous_* trio is the rotation overlap: all three or none, and a
-- different key from the current one.
--
-- p_daily_cap is supplied by the Edge Function (default 10) and may only ever
-- LOWER the locked ceiling of 10 — a DEV project tests the cap at 2.
create or replace function h5_claim_sms_dispatch(
  p_webhook_id text,
  p_key_id text,
  p_phone_key text,
  p_content_key text,
  p_previous_key_id text,
  p_previous_phone_key text,
  p_previous_content_key text,
  p_daily_cap integer
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_now timestamptz;
  v_has_previous boolean := p_previous_key_id is not null;
  v_existing auth_sms_dispatches%rowtype;
  v_sent integer;
begin
  if p_webhook_id is null or char_length(p_webhook_id) not between 1 and 200
     or p_key_id is null or p_key_id !~ '^[0-9a-f]{16}$'
     or p_phone_key is null or p_phone_key !~ '^[0-9a-f]{64}$'
     or p_content_key is null or p_content_key !~ '^[0-9a-f]{64}$'
     or p_daily_cap is null or p_daily_cap not between 1 and 10 then
    raise exception 'invalid sms dispatch claim' using errcode = 'MU080';
  end if;
  if v_has_previous then
    if p_previous_key_id !~ '^[0-9a-f]{16}$' or p_previous_key_id = p_key_id
       or p_previous_phone_key is null or p_previous_phone_key !~ '^[0-9a-f]{64}$'
       or p_previous_content_key is null or p_previous_content_key !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid sms dispatch claim' using errcode = 'MU080';
    end if;
  elsif p_previous_phone_key is not null or p_previous_content_key is not null then
    raise exception 'invalid sms dispatch claim' using errcode = 'MU080';
  end if;

  -- One decision at a time, ledger-wide: the cap count and both duplicate
  -- checks must see every claim committed before this one. ONE lock rather
  -- than one per number, because during a rotation the same number has a
  -- different phone_key under each key, and a per-key lock would let two
  -- callers on different keys decide about it at once. A claim is a few
  -- index lookups — the provider call happens after it commits — so at Auth's
  -- own SMS rate limits this is never meaningfully contended. Transaction-
  -- scoped: released when this call commits.
  perform pg_advisory_xact_lock(hashtextextended('h5_sms_dispatch', 0));
  -- Read AFTER the lock: a claim that waited must judge every window, and
  -- stamp its row, by when it decided rather than when it arrived.
  v_now := clock_timestamp();

  -- A ledger this caller cannot fully read decides nothing. Its duplicate and
  -- cap checks only see rows under keys it holds; a recent row under any other
  -- key could be this very number and code. Refuse rather than send.
  if exists (
    select 1 from auth_sms_dispatches
    where created_at > v_now - interval '24 hours'
      and key_id <> p_key_id
      and (not v_has_previous or key_id <> p_previous_key_id)
  ) then
    return jsonb_build_object('decision', 'unknown_key');
  end if;

  select * into v_existing from auth_sms_dispatches
  where webhook_id = p_webhook_id;
  if found then
    return jsonb_build_object('decision', 'duplicate', 'status', v_existing.status);
  end if;

  select * into v_existing from auth_sms_dispatches
  where ((key_id = p_key_id and content_key = p_content_key)
      or (v_has_previous and key_id = p_previous_key_id and content_key = p_previous_content_key))
    and created_at > v_now - interval '5 minutes'
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object('decision', 'duplicate', 'status', v_existing.status);
  end if;

  -- Every provider call counts, whatever its outcome: a rejected or
  -- unconfirmable call still reached REVE. Under both keys, so a rotation
  -- does not hand a number a fresh day.
  select count(*) into v_sent from auth_sms_dispatches
  where ((key_id = p_key_id and phone_key = p_phone_key)
      or (v_has_previous and key_id = p_previous_key_id and phone_key = p_previous_phone_key))
    and created_at > v_now - interval '24 hours';
  if v_sent >= p_daily_cap then
    return jsonb_build_object('decision', 'capped');
  end if;

  -- Retention. Nothing older than a day decides anything; a week is kept for
  -- support lookups by provider message id. Bounded, so no single
  -- registration pays for a backlog.
  delete from auth_sms_dispatches
  where webhook_id in (
    select webhook_id from auth_sms_dispatches
    where created_at < v_now - interval '7 days'
    order by created_at
    limit 200
  );

  -- Written under the current key only.
  insert into auth_sms_dispatches (webhook_id, key_id, phone_key, content_key, status, created_at)
  values (p_webhook_id, p_key_id, p_phone_key, p_content_key, 'pending', v_now);

  return jsonb_build_object('decision', 'send');
end
$fn$;

-- Settles a claimed call exactly once. Returns false when there is no pending
-- row to settle (already settled, or never claimed); an outcome is never
-- overwritten.
create or replace function h5_record_sms_dispatch(
  p_webhook_id text,
  p_status text,
  p_reason text,
  p_provider_status text,
  p_provider_message_id text
) returns boolean language plpgsql security definer set search_path = public as $fn$
begin
  if p_webhook_id is null
     or p_status is null or p_status not in ('accepted', 'rejected', 'ambiguous') then
    raise exception 'invalid sms dispatch outcome' using errcode = 'MU080';
  end if;

  update auth_sms_dispatches set
    status = p_status,
    reason = p_reason,
    provider_status = p_provider_status,
    provider_message_id = p_provider_message_id,
    settled_at = clock_timestamp()
  where webhook_id = p_webhook_id
    and status = 'pending';
  return found;
end
$fn$;

-- Explicit, per function, to service_role only — on a hosted project only an
-- explicit GRANT counts (pgtest/harness.ts, HOSTED_FUNCTION_EXECUTE_MODEL).
alter function h5_claim_sms_dispatch(text, text, text, text, text, text, text, integer) owner to postgres;
alter function h5_record_sms_dispatch(text, text, text, text, text) owner to postgres;

revoke all on function h5_claim_sms_dispatch(text, text, text, text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function h5_record_sms_dispatch(text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function h5_claim_sms_dispatch(text, text, text, text, text, text, text, integer)
  to service_role;
grant execute on function h5_record_sms_dispatch(text, text, text, text, text) to service_role;
