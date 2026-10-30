-- E4-B / Batch 3 — the financial publication snapshot. Migration 36.
--
-- THE SUCCESSOR, under founder Option B (approved 2026-10-30). Migration 34
-- (H-9) and migration 35 (E4) are sealed historical artifacts and are not
-- touched. The E4 fixtures keep describing the 35-file chain they were signed
-- off against; the LIVE chain is asserted by
-- backend/supabase/pgtest/live-chain-succession.pgtest.ts, which fails until
-- this file is declared in POST_E4_MIGRATIONS, classified for rollback, pinned
-- by digest in post-e4-source-hashes.json and present in the preflight's
-- EXPECTED_CHAIN and E4_MIGRATIONS tail.
--
-- ROLLBACK CLASS: B (reversible), and that is a DESIGN CONSTRAINT rather than a
-- happy accident. The obvious shape for this table was "a second append-only
-- evidence store", which would have made it class C like admin_audit_log — and
-- a second class-C migration is a second thing whose only recovery is a restore
-- that H-11 C5 has never rehearsed. So the EVIDENCE of a publication lives in
-- admin_audit_log, which is already class C, and this table is the SERVING copy
-- of it. Dropping this table loses what the panel reads; it does not lose the
-- record of what was published, and a later republish at a different value
-- would contradict the audit log and be detectable. One class-C store, not two.
--
-- ───────────────────────────────────────────────────────────────── WHY IT EXISTS
--
-- apps/admin/lib/adminSuppression.ts has withheld every pharmacy money figure
-- since 2026-10-30 because a RECOMPUTED figure can change. The reviewer read
-- 457.00 and then 450.00 from the same whole-month query; both answers cleared
-- every k=5 floor, and the difference was one pharmacy's 7.00 refund. No
-- stateless rule closes that, because each answer is individually legitimate
-- and the disclosure is in the PAIR. Muthoy is offline-first by design, so "a
-- month is final once it ends" is false here: a device offline for three days
-- syncs rows carrying their original business dates.
--
-- The only fix is to stop recomputing. A published figure must be READ, not
-- derived — fixed at publication time, and never revised. That is persisted
-- state, which is this file.
--
-- WHAT THIS DOES NOT DO, stated here because the opposite would be the easiest
-- thing to believe about it. It does NOT make pharmacy money visible. There are
-- two independent reasons a figure is withheld, and this closes exactly one:
--
--   1. revisability — closed here, by construction;
--   2. the k=5 floor on the REFUND side of every day in the period — untouched.
--
-- At beta scale (ten pharmacies) almost no day has five distinct refunding
-- pharmacies, so almost nothing becomes eligible to publish. This migration
-- makes the system correct at scale; it does not manufacture a crowd that does
-- not exist. Publishing nothing is the right output for that population.
--
-- ───────────────────────────────────────────────── THE PRIVILEGE PATTERN, REUSED
--
-- Exactly migration 35's pattern and for its reason: the hosted platform's
-- default privileges give service_role MORE than select/insert on a new public
-- table (measured profile service_role=Dxtm — TRUNCATE, REFERENCES, TRIGGER,
-- MAINTAIN). So: revoke from every role including service_role, grant only what
-- is needed, enable RLS with NO policy so the API roles reach nothing at all.
--
-- ONE DIFFERENCE, AND IT IS THE POINT. service_role does not get INSERT here.
-- It gets SELECT and EXECUTE on publish_financial_snapshot(), a SECURITY
-- DEFINER function that re-checks eligibility in SQL and writes the
-- admin_audit_log row in the SAME transaction. A panel that could INSERT
-- directly could publish a figure with no audit row and no eligibility check,
-- and the two writes could diverge. They cannot diverge if there is only one
-- way in.
--
-- Everything here is idempotent: `if not exists`, `create or replace`,
-- `drop trigger if exists`.

begin;

-- ══════════════════════════════════════════════════════════════════════════
-- a. financial_publications — the immutable published figure
-- ══════════════════════════════════════════════════════════════════════════
--
-- THE IDENTITY is (metric_family, cohort_key, period_grain, period_start), and
-- it is UNIQUE. That unique index is also the concurrency protection: two
-- operators publishing the same period race to one row, the loser conflicts,
-- and nobody gets a second row to difference against the first.
--
-- THE COHORT IS A SINGLE DECLARED VALUE, enforced by CHECK, and this is a
-- privacy control rather than a simplification. Complementary release is not
-- solvable by per-publication checks: publish "all shops, October" and "Banani
-- shops, October" and the difference is "non-Banani shops, October", which need
-- not clear any floor even though both publications did. The general problem is
-- query auditing across the whole publication history. The defensible answer
-- available to this code is to have no second cohort to difference against, so
-- `platform_all` is the only value the column accepts. Widening this CHECK is a
-- privacy decision, not a schema change, and must be reviewed as one.
--
-- THE PERIOD IS A WHOLE MONTH, enforced by CHECK. A caller-chosen window is the
-- round-11 differencing attack: October 1 alone reads 500.00, October 1-2 reads
-- 580.00, and the 80.00 difference is the withheld day. A published bucket must
-- be independent of the request that asked for it.
create table if not exists public.financial_publications (
  id uuid primary key default gen_random_uuid(),

  -- ── publication identity
  --
  -- Only the one money metric that has a period. `subscription_revenue_and_
  -- renewals` is Muthoy's own billing (founder decision 4) and is published
  -- without a pharmacy floor by apps/admin/lib/adminReports.ts, so it needs no
  -- snapshot and deliberately cannot have one here.
  metric_family text not null
    check (metric_family in ('refund_net_pharmacy_sales')),
  cohort_key text not null check (cohort_key = 'platform_all'),
  period_grain text not null check (period_grain = 'month'),
  period_start date not null,
  period_end date not null,

  -- ── the published value, and its provenance
  --
  -- W4-04's subtraction, RESTATED as a constraint rather than re-derived. If
  -- the shared formula the panel and the device share ever stops agreeing with
  -- `gross - refunds`, this CHECK fails the insert instead of silently storing
  -- a figure no reader can reproduce (CLAUDE.md rule 4).
  -- CAPPED AT THE READER'S RANGE, not at `bigint`'s.
  --
  -- ROUND 20 FINDING 4. `bigint` accepts values above 2^53-1, which JavaScript
  -- cannot represent exactly — so the RPC accepted a gross of
  -- 9007199254740993, `readPublishedMonths` correctly refused to convert it,
  -- and because the conversion spans every fetched publication, that ONE row
  -- aborted the whole lookup. An immutable row that permanently breaks the
  -- reader is the worst possible interaction with a table whose entire premise
  -- is that nothing can be edited or deleted.
  --
  -- 9007199254740991 paisa is about 90 trillion taka, so the ceiling costs
  -- nothing real. It exists so the database cannot store a figure the reader
  -- cannot serve.
  gross_paisa bigint not null
    check (gross_paisa >= 0 and gross_paisa <= 9007199254740991),
  refunds_paisa bigint not null
    check (refunds_paisa >= 0 and refunds_paisa <= 9007199254740991),
  value_paisa bigint not null
    check (value_paisa >= -9007199254740991 and value_paisa <= 9007199254740991),

  -- WHAT THE FIGURE WAS COMPUTED FROM. Row counts and a digest over the
  -- contributing source rows, so a later recomputation that disagrees can be
  -- shown to disagree. This is for DETECTION, never for correction: the served
  -- value is this row, drift or no drift. A publication that self-corrected
  -- would be a revision, which is the channel this table exists to close.
  source_sale_rows integer not null check (source_sale_rows >= 0),
  source_refund_rows integer not null check (source_refund_rows >= 0),
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),

  -- ── the eligibility that was true AT publication time
  --
  -- Recorded rather than recomputed, because the population changes and the
  -- question "was this publishable when it was published" has to stay
  -- answerable afterwards.
  -- ROUND 18 FINDING 5. This was `>= 1`, which made the k=5 floor
  -- caller-selectable: the reviewer reached the RPC with one selling and one
  -- refunding pharmacy by passing k=1, and SQL stored it. The floor is 5 by
  -- founder decision §8.5, so 5 is what the column accepts. A test that wants
  -- to exercise the PREDICATE at another k still can — `periodEligibility`
  -- takes k — but nothing can STORE a publication made under a weaker floor.
  k_floor integer not null check (k_floor >= 5),
  contributor_count integer not null check (contributor_count >= 0),
  -- Days inside the period that CARRY TRADE and therefore need the refund-side
  -- floor, and how many of them cleared it. The application owns the rule
  -- (`daysReleasable` in apps/admin/lib/adminSuppression.ts, one copy, because
  -- two copies of this rule is how rounds 13-15 happened); the database
  -- enforces the CONCLUSION, so an ineligible figure cannot be stored even if
  -- the application layer is wrong or bypassed.
  days_requiring_floor integer not null check (days_requiring_floor >= 0),
  days_clearing_floor integer not null check (days_clearing_floor >= 0),

  -- ── attribution
  published_at timestamptz not null default now(),
  published_by text not null check (length(published_by) between 1 and 200),

  constraint financial_publications_identity
    unique (metric_family, cohort_key, period_grain, period_start),

  -- FINITE DATES, and this constraint is the reason the one below means anything.
  --
  -- ROUND 19 FINDING 5. `-infinity` is a valid `date`, and every check that
  -- examined it evaluated to NULL — a CHECK passes on NULL, because it only
  -- fails on FALSE. So `period_start = period_end = '-infinity'` satisfied the
  -- whole-month rule vacuously, and `to_char(-infinity, 'YYYY-MM')` is NULL,
  -- which made the audit `target` NULL and the republication guard's equality
  -- predicate match nothing. One unrepresentable date defeated three controls
  -- at once, every one of them by being NULL rather than by being wrong.
  constraint financial_publications_finite_period check (
    isfinite(period_start) and isfinite(period_end)
  ),

  -- A whole calendar month, both ends.
  constraint financial_publications_whole_month check (
    extract(day from period_start) = 1
    and period_end = (period_start + interval '1 month' - interval '1 day')::date
  ),

  constraint financial_publications_net
    check (value_paisa = gross_paisa - refunds_paisa),

  -- EVERY day that needed the floor cleared it. Not "most", not "the month's
  -- union": a month differenced against a day published elsewhere discloses the
  -- difference, so composition has to hold downwards.
  constraint financial_publications_days_eligible
    check (days_clearing_floor = days_requiring_floor),

  -- A PERIOD MUST HAVE TRADED, AND MUST CLEAR THE FLOOR.
  --
  -- ROUND 18 FINDING 3, and this constraint used to say the opposite:
  -- `days_requiring_floor = 0 or contributor_count >= k_floor`, which let an
  -- EMPTY period be published with zero contributors. I justified that on
  -- privacy grounds — an empty month discloses nothing about anybody — and the
  -- privacy reasoning was right while the rest was wrong twice over:
  --
  --   1. FINALITY. A month can look empty because no device has SYNCED, which
  --      is the exact condition this whole mechanism exists to handle.
  --      Publishing 0.00 freezes a figure that was never the figure, and the
  --      database refuses every correction by design.
  --   2. EXISTENCE. The reviewer's repro: publish an inactive month as zero,
  --      and with empty sources the report shows no row. Add ONE late refund
  --      and the report gains a published `0.00` row. The amount never moved,
  --      but the ROW APPEARING discloses that a refund arrived. Round 3
  --      finding 1 exists because a month with no sales appearing at all
  --      announces the refund; publishing zero re-opened that by another door.
  --
  -- There is nothing to gain from publishing an empty period: the reader
  -- already reports `no_activity` for it, accurately, with no snapshot.
  constraint financial_publications_cohort_eligible check (
    days_requiring_floor > 0 and contributor_count >= k_floor
  )
);

-- The reader looks up one period by identity; the unique constraint already
-- indexes that. This second index is for the "what has been published" list the
-- evidence manifest and the drift check walk, newest first.
create index if not exists financial_publications_published_idx
  on public.financial_publications (metric_family, period_start desc);

alter table public.financial_publications enable row level security;

revoke all on table public.financial_publications
  from public, anon, authenticated, service_role;
-- SELECT ONLY. No INSERT: the only way in is publish_financial_snapshot()
-- below. No UPDATE and no DELETE, not even column-level: a published figure
-- that can be edited is a figure that can be revised, and the revision is the
-- disclosure. No TRUNCATE.
grant select on table public.financial_publications to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- b. Immutability that survives a re-grant
-- ══════════════════════════════════════════════════════════════════════════
--
-- The REVOKE above is the real control for the API roles. This trigger is for
-- the case the revoke does not cover: a future migration, or an operator at a
-- superuser psql prompt, who re-grants UPDATE without reading this file. A
-- trigger cannot stop a superuser who disables it, and it is not claimed to —
-- it stops the accident, and it states the invariant in the schema where
-- someone editing the schema will see it.
create or replace function public.financial_publications_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'financial_publications is append-only: % is not permitted. A published figure is never revised; publish the next period instead.',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists financial_publications_no_revision on public.financial_publications;
create trigger financial_publications_no_revision
  before update or delete on public.financial_publications
  for each row execute function public.financial_publications_immutable();

drop trigger if exists financial_publications_no_truncate on public.financial_publications;
create trigger financial_publications_no_truncate
  before truncate on public.financial_publications
  for each statement execute function public.financial_publications_immutable();

-- ══════════════════════════════════════════════════════════════════════════
-- c. publish_financial_snapshot — the only way a figure gets published
-- ══════════════════════════════════════════════════════════════════════════
--
-- SECURITY DEFINER, so it executes as its OWNER and can write both tables while
-- service_role holds INSERT on neither this table nor a direct path to it. The
-- same device as sync_apply_row, for the same reason.
--
-- IT IS IDEMPOTENT AND IT NEVER REVISES. `on conflict do nothing` means the
-- second caller for a period writes nothing and reads back the FIRST caller's
-- row. The boolean it returns says which happened, so the panel can tell "I
-- published this" from "this was already published" without either of them
-- being an error — and without a second row existing to difference against the
-- first.
--
-- `search_path` is pinned: a SECURITY DEFINER function that resolves
-- `admin_audit_log` through a caller-controlled search_path executes the
-- caller's table as the owner.
-- Declared WITHOUT a schema prefix, and the grant below likewise, because
-- apps/admin/lib/adminGrants.test.ts (E11) verifies every RPC the admin sources
-- call against `create or replace function <name>(` and
-- `grant execute on function <name>(…) to …service_role` in the chain SQL. A
-- `public.` prefix there is not matched by those patterns, so the gate would
-- report an unverifiable RPC. Same form as b4_reconcile_plan_limits.
create or replace function publish_financial_snapshot(
  p_metric_family text,
  p_cohort_key text,
  p_period_start date,
  p_period_end date,
  p_gross_paisa bigint,
  p_refunds_paisa bigint,
  p_value_paisa bigint,
  p_source_sale_rows integer,
  p_source_refund_rows integer,
  p_source_digest text,
  p_k_floor integer,
  p_contributor_count integer,
  p_days_requiring_floor integer,
  p_days_clearing_floor integer,
  p_published_by text
)
returns table (publication_id uuid, published_now boolean, published_value_paisa bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_new boolean := false;
  v_value bigint;
begin
  -- FINITE DATES FIRST, because every check below depends on them.
  --
  -- ROUND 19 FINDING 5. The table's CHECK refuses a nonfinite date now, but it
  -- refuses it LAST — after the republication guard has already compared a NULL
  -- target against a NULL target and found no match. So the guard has to be
  -- reached with a real date, which means this is the first thing in the
  -- function and not the last. Raised rather than left to the constraint for
  -- the usual reason: the operator gets a sentence.
  if not isfinite(p_period_start) or not isfinite(p_period_end) then
    raise exception
      'refused: the reporting period must be two finite dates (got % to %). A nonfinite date makes every check below evaluate to NULL, which a constraint accepts.',
      p_period_start, p_period_end
      using errcode = 'restrict_violation';
  end if;

  -- THE ELIGIBILITY RE-CHECK, in SQL, before anything is written.
  --
  -- The table's CHECK constraints would reject an ineligible row anyway. This
  -- raises the specific reason first, because "constraint
  -- financial_publications_days_eligible violated" tells an operator nothing
  -- about which day failed or what to do, and a privacy refusal that cannot be
  -- read is a privacy refusal somebody works around.
  if p_days_clearing_floor <> p_days_requiring_floor then
    -- NO SIDE NAMED HERE, deliberately. ROUND 19 FINDING 6 was the application
    -- naming a side it had not established; this function receives only counts
    -- and cannot know which side failed, so it must not imply one. The readable
    -- per-side breakdown is `periodEligibility`'s job and it does it there.
    raise exception
      'refused: % of % trading days inside % did not clear the k=% floor. The period is not publishable.',
      p_days_requiring_floor - p_days_clearing_floor, p_days_requiring_floor,
      to_char(p_period_start, 'YYYY-MM'), p_k_floor
      using errcode = 'restrict_violation';
  end if;
  if p_days_requiring_floor > 0 and p_contributor_count < p_k_floor then
    raise exception
      'refused: % contributing pharmacies is below the k=% floor for %.',
      p_contributor_count, p_k_floor, to_char(p_period_start, 'YYYY-MM')
      using errcode = 'restrict_violation';
  end if;

  -- ROUND 18 FINDING 3. An EMPTY period is not publishable. See the
  -- `financial_publications_cohort_eligible` comment for both reasons; the
  -- short one is that "empty" and "not synced yet" are indistinguishable here.
  if p_days_requiring_floor = 0 then
    raise exception
      'refused: % records no trading activity. There is no figure to fix, and a period can look empty simply because no device has synced yet.',
      to_char(p_period_start, 'YYYY-MM')
      using errcode = 'restrict_violation';
  end if;

  -- A PERIOD STILL IN PROGRESS IS GUARANTEED TO CHANGE.
  --
  -- Not a reviewer finding — this one I went looking for after finding 3,
  -- because refusing empty periods alone does not stop the sharper version of
  -- the same act: publish December on December the 1st, after one trading day
  -- that happens to clear the floor, and the month is frozen at a day's worth
  -- of trade, irreversibly, by one click. A CHECK cannot express this because
  -- `current_date` is not immutable, and the function is the only writer, so
  -- here is where it belongs.
  -- THE DHAKA BUSINESS DATE, not the server's.
  --
  -- ROUND 19 FINDING 3. This was `current_date`, which is the database's own
  -- date in its own timezone — UTC on a hosted project. Dhaka is UTC+6, so at
  -- 2026-08-31T18:30Z it is already September 1st in Dhaka and August HAS
  -- ended, while `current_date` still says August 31st and this refused it for
  -- another six hours. The same class of defect as GATE 5 FINDING 10, which
  -- filed registrations under the UTC day while the Dashboard used the Dhaka
  -- one. This product's business day is Dhaka's, everywhere, including here.
  if p_period_end >= (now() at time zone 'Asia/Dhaka')::date then
    raise exception
      'refused: % has not ended in Dhaka (period_end %, Dhaka today %). A period still in progress is certain to change, and a published figure is never revised.',
      to_char(p_period_start, 'YYYY-MM'), p_period_end,
      (now() at time zone 'Asia/Dhaka')::date
      using errcode = 'restrict_violation';
  end if;

  -- REPUBLICATION AFTER A ROLLBACK.
  --
  -- ROUND 18 FINDING 4. The documented class-B reversal is `drop function` then
  -- `drop table`, and the reviewer walked straight through it: drop both,
  -- re-apply the migration, publish the same period at a DIFFERENT value, and
  -- both calls report a first publication. My class-B justification claimed a
  -- second value "would contradict the audit log and be detectable" — and
  -- detectable is not prevented when nothing reads the log.
  --
  -- So this reads it. admin_audit_log is the class-C store that SURVIVES the
  -- reversal, which is the whole reason the evidence was put there, and it is
  -- now authoritative rather than merely informative: a period that was
  -- published before cannot be published again at any value, even with the
  -- serving table freshly empty.
  --
  -- WHAT THIS GUARD DEPENDS ON, and ROUND 19 FINDING 2 is that it should be
  -- written down rather than assumed. The guard is exactly as strong as audit
  -- RETENTION: truncate admin_audit_log and a republication becomes possible
  -- again, because missing history reads as "never published".
  --
  -- That is a real limitation and it is not closable here. The alternative
  -- would be a second independent record of publications, which is a second
  -- append-only evidence store — the exact thing this migration was shaped to
  -- avoid, because it would be a second class C whose only recovery is the
  -- restore H-11 C5 has never rehearsed. A third manifest would have the same
  -- property one level up.
  --
  -- What bounds it instead: migration 35 grants admin_audit_log only INSERT and
  -- SELECT to service_role, with no DELETE, no UPDATE and no TRUNCATE, so the
  -- panel and its key cannot do this — the reviewer confirmed service_role
  -- truncation fails with 42501. It takes a privileged session at a superuser
  -- prompt, which is a deliberate act against an audit log, and migration 35
  -- already records that "retention is an operator decision taken outside the
  -- application". This guard inherits that decision; it does not replace it.
  if not exists (
        select 1 from public.financial_publications fp
         where fp.metric_family = p_metric_family
           and fp.cohort_key = p_cohort_key
           and fp.period_grain = 'month'
           and fp.period_start = p_period_start)
     and exists (
        select 1 from public.admin_audit_log al
         where al.action = 'publication.published'
           and al.target = p_metric_family || ':' || p_cohort_key || ':'
                           || to_char(p_period_start, 'YYYY-MM')) then
    raise exception
      'refused: % was published before and its serving row is absent. Restore it rather than publishing a new value -- republishing would create a second value for one period, which is the difference this table exists to prevent.',
      to_char(p_period_start, 'YYYY-MM')
      using errcode = 'restrict_violation';
  end if;

  insert into public.financial_publications as fp (
    metric_family, cohort_key, period_grain, period_start, period_end,
    gross_paisa, refunds_paisa, value_paisa,
    source_sale_rows, source_refund_rows, source_digest,
    k_floor, contributor_count, days_requiring_floor, days_clearing_floor,
    published_by
  ) values (
    p_metric_family, p_cohort_key, 'month', p_period_start, p_period_end,
    p_gross_paisa, p_refunds_paisa, p_value_paisa,
    p_source_sale_rows, p_source_refund_rows, p_source_digest,
    p_k_floor, p_contributor_count, p_days_requiring_floor, p_days_clearing_floor,
    p_published_by
  )
  on conflict on constraint financial_publications_identity do nothing
  returning fp.id, fp.value_paisa into v_id, v_value;

  if v_id is not null then
    v_new := true;
  else
    -- ALREADY PUBLISHED. Read back the existing row rather than failing: the
    -- caller asked for this period to be published and it is published. The
    -- value returned is the FIRST publication's, which is the whole point.
    select fp2.id, fp2.value_paisa into v_id, v_value
      from public.financial_publications fp2
     where fp2.metric_family = p_metric_family
       and fp2.cohort_key = p_cohort_key
       and fp2.period_grain = 'month'
       and fp2.period_start = p_period_start;
  end if;

  -- THE AUDIT ROW, in this transaction. A publication with no audit row cannot
  -- happen, because there is no path that writes one without the other.
  --
  -- ───────────────────────────── THE METADATA IS SPLIT, AND THAT IS A FIX
  --
  -- ROUND 18 FINDING 1 — I closed the report channel and opened an AUDIT
  -- channel. This insert used to record the caller's freshly computed
  -- `p_gross_paisa`, `p_refunds_paisa` and `p_source_digest` on EVERY attempt,
  -- including the repeat. So:
  --
  --   publish with refunds 10000            -> audit row says refunds 10000
  --   retry after a late refund, 10700      -> audit row says refunds 10700
  --
  -- The snapshot never moved. The two audit rows differ by exactly the 700
  -- paisa, the audit page and its CSV display `meta`, and that is the round-1B
  -- oracle rebuilt one table over. My own comment defended recording the
  -- repeat and then put the figures in it.
  --
  -- A FIRST publication records full provenance, because those numbers ARE the
  -- published figure and the audit row is its evidence. A REPEAT records who
  -- tried, which period, and the value that was ALREADY published -- all three
  -- already disclosed -- and nothing the caller computed. The attempt stays
  -- auditable; the recomputation does not leak.
  insert into public.admin_audit_log (at, actor, actor_verified, role, action, target, outcome, meta)
  values (
    now(), p_published_by, true, 'super_admin',
    case when v_new then 'publication.published' else 'publication.already_published' end,
    p_metric_family || ':' || p_cohort_key || ':' || to_char(p_period_start, 'YYYY-MM'),
    'success',
    case when v_new then
      jsonb_build_object(
        'value_paisa', v_value,
        'gross_paisa', p_gross_paisa,
        'refunds_paisa', p_refunds_paisa,
        'contributor_count', p_contributor_count,
        'k_floor', p_k_floor,
        'days_requiring_floor', p_days_requiring_floor,
        'source_digest', p_source_digest
      )
    else
      -- The STORED value, read back above, not the caller's. No gross, no
      -- refunds, no digest, no contributor count: every one of those is a
      -- recomputation, and a pair of recomputations is the disclosure.
      jsonb_build_object(
        'value_paisa', v_value,
        'already_published', true
      )
    end
  );

  return query select v_id, v_new, v_value;
end;
$$;

-- Revoke from every role INCLUDING service_role, then grant back exactly
-- EXECUTE — migration 35's pattern. A function's default is EXECUTE to PUBLIC,
-- which service_role inherits, so revoking `public` is what actually removes it
-- and naming service_role as well makes the intent explicit rather than
-- inherited.
revoke all on function publish_financial_snapshot(text,text,date,date,bigint,bigint,bigint,integer,integer,text,integer,integer,integer,integer,text) from public, anon, authenticated, service_role;
grant execute on function publish_financial_snapshot(text,text,date,date,bigint,bigint,bigint,integer,integer,text,integer,integer,integer,integer,text) to service_role;

comment on table public.financial_publications is
  'Immutable published pharmacy money figures. Append-only; the only writer is publish_financial_snapshot(). A published figure is read, never recomputed, because a recomputation that changes discloses the difference.';

commit;
