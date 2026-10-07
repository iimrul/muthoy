-- H-5 — every dispatch claim gets an OWNER (live DEV finding, 2026-10-04).
--
-- Additive on purpose: 20261001000000 is already applied to DEV, so it is not
-- edited.
--
-- WHAT HAPPENED. On the first real DEV send the hook's claim committed, but
-- its reply came back after the hook had stopped waiting (750 ms, on a cold
-- first call through PostgREST). The hook answered 503, GoTrue failed /otp
-- with it, /otp then ran a second time with a NEW code (DECISIONS.md,
-- 2026-10-04), and the first row stayed 'pending' for good: a claim nobody
-- would ever settle.
--
-- WHAT CHANGES. The hook now waits longer, and when a claim's reply is lost
-- it asks once more. That is only safe if the ledger can tell "my own claim,
-- whose answer I never heard" from "somebody else's claim on the same
-- request" — a replay of one webhook, or a GoTrue retry of one code. So a
-- claim now names its owner: a random value the invoking hook makes once,
-- holds only in memory, and shows again to resume or to settle that claim.
--
--   - A claim is idempotent for its owner. The row for this webhook id, still
--     pending and carrying the caller's owner, answers 'send' again, marked
--     resumed: one row, one cap slot, one provider call — the provider has
--     not been called for it, because its owner never heard 'send'. Anyone
--     else, and the owner too once the row is settled, gets the duplicate
--     answer it always got.
--   - Only the owner settles its row.
--
-- Rows claimed before this migration are given an owner no invocation holds:
-- they can be neither resumed nor settled — right for claims whose
-- invocations are long gone — and they still count against the cap and still
-- block a duplicate.
--
-- Both functions change signature, so the old ones are dropped. A hook build
-- older than this fails closed against it — no claim, no SMS — so apply this
-- migration first and deploy the matching auth-send-sms right after.

alter table auth_sms_dispatches
  add column claim_owner uuid not null default gen_random_uuid();
-- The default existed only to fill the rows above. A new claim must name its
-- owner; one that does not is refused before anything is written.
alter table auth_sms_dispatches alter column claim_owner drop default;

drop function h5_claim_sms_dispatch(text, text, text, text, text, text, text, integer);
drop function h5_record_sms_dispatch(text, text, text, text, text);

-- Claims one provider call, or says why there must not be one.
--
--   {"decision":"send","resumed":false}      claimed now; call the provider
--   {"decision":"send","resumed":true}       the caller's own claim, made by
--                                            an earlier ask whose reply was
--                                            lost; still pending, so the
--                                            provider has not been called —
--                                            call it, once
--   {"decision":"duplicate","status":"..."}  this request, or this code for
--                                            this number, is already in the
--                                            ledger under someone else's
--                                            claim, or is settled: replay
--                                            its outcome
--   {"decision":"capped"}                    the number has used its daily cap
--   {"decision":"unknown_key"}               the last day holds rows written
--                                            under a key this caller lacks, so
--                                            neither check below can be trusted
--
-- p_claim_owner is the caller's own random value; asking again with it is
-- always safe. The p_previous_* trio is the rotation overlap: all three or
-- none, and a different key from the current one.
--
-- p_daily_cap is supplied by the Edge Function (default 10) and may only ever
-- LOWER the locked ceiling of 10 — a DEV project tests the cap at 2.
create or replace function h5_claim_sms_dispatch(
  p_webhook_id text,
  p_claim_owner uuid,
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
     or p_claim_owner is null
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
  -- scoped: released when this call commits. An owner's second ask that
  -- arrives while its first is still running waits here, then resumes it.
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
    -- The caller's own claim, whose reply it never received. Still pending,
    -- so its owner never heard 'send' and the provider has not been called.
    -- Only the holder of this random owner can take this branch.
    if v_existing.claim_owner = p_claim_owner and v_existing.status = 'pending' then
      return jsonb_build_object('decision', 'send', 'resumed', true);
    end if;
    return jsonb_build_object('decision', 'duplicate', 'status', v_existing.status);
  end if;

  -- Never the caller's own row: its own claim is always under this webhook id.
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

  -- Written under the current key only, with the caller as its owner.
  insert into auth_sms_dispatches
    (webhook_id, claim_owner, key_id, phone_key, content_key, status, created_at)
  values (p_webhook_id, p_claim_owner, p_key_id, p_phone_key, p_content_key, 'pending', v_now);

  return jsonb_build_object('decision', 'send', 'resumed', false);
end
$fn$;

-- Settles a claimed call exactly once, and only for its owner. Returns false
-- when there is no pending row of this owner's to settle (already settled,
-- never claimed, or someone else's); an outcome is never overwritten.
create or replace function h5_record_sms_dispatch(
  p_webhook_id text,
  p_claim_owner uuid,
  p_status text,
  p_reason text,
  p_provider_status text,
  p_provider_message_id text
) returns boolean language plpgsql security definer set search_path = public as $fn$
begin
  if p_webhook_id is null or p_claim_owner is null
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
    and claim_owner = p_claim_owner
    and status = 'pending';
  return found;
end
$fn$;

-- Explicit, per function, to service_role only — on a hosted project only an
-- explicit GRANT counts (pgtest/harness.ts, HOSTED_FUNCTION_EXECUTE_MODEL).
alter function h5_claim_sms_dispatch(text, uuid, text, text, text, text, text, text, integer)
  owner to postgres;
alter function h5_record_sms_dispatch(text, uuid, text, text, text, text) owner to postgres;

revoke all on function h5_claim_sms_dispatch(text, uuid, text, text, text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function h5_record_sms_dispatch(text, uuid, text, text, text, text)
  from public, anon, authenticated;

grant execute on function h5_claim_sms_dispatch(text, uuid, text, text, text, text, text, text, integer)
  to service_role;
grant execute on function h5_record_sms_dispatch(text, uuid, text, text, text, text) to service_role;
