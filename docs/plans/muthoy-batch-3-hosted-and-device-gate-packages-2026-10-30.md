# Batch 3 — the hosted and device gate packages

**Date:** 2026-10-30
**Authorization:** founder directive of 2026-10-30, sections 5, 6 and 7
**Status: PREPARED, NOT EXECUTED.** No hosted SQL was run, no project was
altered, no credential was retrieved, no deployment was created, no build was
made, and `D:\Muthoy-Preview-Test` was not touched.

Each section below is an execution package. None has been executed, and each
needs a separate authorization naming its exact target.

---

## 1. E4-H — the hosted migration-35 application package

What migration 35 contains, what it was verified against, and how each component
reverses are already written up in [the E4 runbook](e4-migration-and-rollback.md).
This section adds the six things that runbook does not state: the target, the
remote state, the credentials, the backup position, the ordered preflight, and
the post-apply assertions.

### 1.1 The blocker you should see first

**Migration 35 is classified C, and class C means "restore from backup" is the
recovery path.** `ROLLBACK.md` is explicit about what every class C row depends
on: a schema **and** data backup taken before the apply, and "a migration
applied without one has no way back at all."

**No real restore has ever been rehearsed on this project.** H-11 C5 — the
restore rehearsal — is still open, and the runbook records why in a sentence I
will not soften: *"Local PGlite validation is never reported as a real
restore."*

The honest position is this. Migration 35 destroys nothing when applied — it
creates tables and narrows grants. The irreversibility is on the way back:
dropping `admin_audit_log` destroys the audit rows in it, and an audit log you
roll back by deleting is not evidence. That is exactly why the classification
was declared C rather than left at the B the mechanical rule would have given
it.

**So:** before this is applied anywhere you care about, either a real
backup-and-restore path is proven on the target, or you accept in advance that
this migration's recovery route is untested. That is a decision, not a defect,
but it should be made knowingly rather than discovered later.

### 1.2 Exact target project and environment — yours to name

I will not assume a target. Two hosted projects are known to this repository,
and **both refs already appear in tracked files**, so naming them here discloses
nothing new:

| Project | Ref | What is known | Suitability |
|---|---|---|---|
| H-9 rehearsal | `jwjrijvprbsndukfhlvf` | migration 34 applied 2026-10-16, 15/15 checks passed; left running | the natural first target: a rehearsal project already carrying the 34-chain |
| DEV | `btfprhticjgeihcngpif` | ships in `apps/mobile/config/environmentPolicy.js` | holds real DEV data, so a class C apply here is a larger decision |
| production | — | **no production project is known to this repository** | n/a |

**Required from you:** the project ref, and confirmation of whether that project
has an automated backup you can actually restore from. On a Free-tier project
that needs checking rather than assuming, and §1.1 is why it matters.

### 1.3 Current remote migration state — step one, not an assumption

This cannot be read from here: it needs a credential and an authorization, and
neither was used. The apply must begin by **capturing** it.

1. `select version, name from supabase_migrations.schema_migrations order by version;`
2. The tail must be `20261015000000` (migration 34), and all three H-9 versions
   must be present.
3. Record the full list verbatim as the pre-apply snapshot.
4. If the tail is already `20261023000000`, migration 35 is applied and this
   package is finished before it starts.
5. If the history does not match the expected 34-chain, **stop**. A mismatch
   means the target is not the project this package was prepared for.

### 1.4 Required credentials and permissions

| Need | Why |
|---|---|
| a role that can `create table`, `create function`, `create index` in `public` | migration 35 creates 5 tables, 5 indexes, 3 functions |
| `grant` / `revoke` authority on `service_role` and the API roles | 13 GRANT and 12 REVOKE statements |
| authority to `alter table … enable row level security` | every new table enables RLS |
| the pinned CA, and a non-GSS connection | the custody work pinned Supabase Root 2021 (`70072358…`) and `gssencmode=disable`; use them rather than trusting the default chain |

**Not needed, and must not be used:** any mobile anon key, and any credential
belonging to a pharmacy. Nothing in this migration touches pharmacy data.

### 1.5 Privilege and role impact — the part that is not additive

Four of the five tables are new and start closed: `revoke all from public, anon,
authenticated, service_role`, then one narrow grant. That part is additive, and
reverses by dropping the object.

**The part that is not additive** is the re-grant on two existing tables:

| Table | Before | After | Consequence |
|---|---|---|---|
| `public.sale_refunds` | `service_role` held select, insert, update, delete (from `20260821010000`) | **select only** | anything running as `service_role` that wrote refunds stops being able to |
| `public.audit_logs` | the hosted default for `service_role` | **select only** | audit rows can no longer be written through `service_role` |

This is a deliberate **narrowing**. But it means the reverse is not a no-op:
restoring the pre-E4 state restores the write privileges the revoke existed to
remove. Decide which state you want **before** reversing, not during.

### 1.6 Migration preflight — ordered, all read-only

1. `node scripts/h9-prod-preflight.mjs` against the target. It must pass before
   anything is applied.
2. Capture and record the migration history (§1.3).
3. Run `backend/supabase/checks/h9_postmigration_checks.sql`. It must **pass**
   on the pre-E4 history — that file is byte-identical and hash-pinned at
   `361a400a…` precisely so this check still means something here.
4. Run `backend/supabase/checks/e4_postmigration_checks.sql`. It must **fail**
   on `history_has_no_missing_version`, naming `20261023000000`.
5. Confirm the backup from §1.1 exists, and record how it would be restored.

Steps 3 and 4 together are the useful pair: the baseline check passing while the
successor check fails is the signature of a correct pre-apply state. Either one
alone can be satisfied by the wrong project.

### 1.7 Apply — and the order is now forced, which it was not when this was written

**CORRECTED 2026-10-30, later the same day.** This section said: *"Migration 35
only. No other migration exists to apply — the chain is 35 long and
`POST_E4_MIGRATIONS` is empty, which the new live-chain gate asserts."* Both
halves of that stopped being true when migration 36 was declared. The sentence
is quoted rather than deleted because the rest of this package was prepared
against a 35-file chain, and a reader needs to know which parts were written
before the chain grew.

**The chain is now 36 long.** `POST_E4_MIGRATIONS` declares
`20261030000000_e4b_publication_snapshots.sql`, and
`live-chain-succession.pgtest.ts` asserts that declaration against the
directory, the rollback classification, the preflight's `EXPECTED_CHAIN` and
`E4_MIGRATIONS` tail, and a byte-pin in `post-e4-source-hashes.json`.

| Order | Migration | Class | Why this order |
|---|---|---|---|
| 1 | `20261023000000_e4_batch3_admin_platform.sql` (35) | **C** | creates `admin_audit_log` |
| 2 | `20261030000000_e4b_publication_snapshots.sql` (36) | B | its `publish_financial_snapshot()` **inserts into `admin_audit_log`**, so 35 must already be applied or the function body references a table that does not exist |

**The dependency is real and one-directional.** Migration 36's SECURITY DEFINER
function writes the publication's audit row into `admin_audit_log`, which
migration 35 creates. Applying 36 first does not fail at apply time — PL/pgSQL
bodies are not resolved until the function runs — so this is worse than a hard
error: the migration would appear to succeed and the first publish attempt
would fail at runtime with a missing relation. **Apply 35, assert it, then 36.**

**Two separate authorizations, not one.** Migration 35 is class C and its
recovery path is the untested restore in §1.1 and §5. Migration 36 is class B
and reverses by `drop function` then `drop table`, executed and asserted in
`e4b-publication.pgtest.ts`. Those are different risk decisions and should not
be bundled: you may reasonably authorize 35 and hold 36, or hold both.

**Applying 36 changes no behaviour on its own.** No page reads
`financial_publications` yet (`publicationQueries.ts` says why), and nothing
publishes without an explicit `super_admin` action. So the apply is inert until
somebody publishes a period, and at beta scale almost no period is eligible.

### 1.8 Post-apply assertions — all five sections must pass

`e4_postmigration_checks.sql` has five sections, and the apply is not accepted
until every check in every one returns true:

| Section | What it proves |
|---|---|
| `history_e4` | the chain is exactly the 35 expected versions, the H-9 trio intact and contiguous, E4 the only thing after it |
| `e4_objects` | the five tables exist |
| `e4_privileges` | the new tables' grants are exactly as narrow as intended |
| `e4_legacy_privileges` | `sale_refunds` and `audit_logs` are select-only for `service_role` |
| `e4_functions` | the W4-05 owner predicate exists |

Then re-run `h9_postmigration_checks.sql` and expect it to **fail on exactly the
two assertions that moved** — its count, and its "nothing after migration 34"
bound. That is not a regression; it is the documented succession, and
`e4-chain-succession.pgtest.ts` asserts the same relationship locally.

### 1.9 Failure and rollback

Follow [the runbook's §6](e4-migration-and-rollback.md), and two rules from it:

- **Reverse the grants LAST.** Dropping a table whose privileges were already
  reverted fails on a missing privilege, and that failure misleads.
- **Drop `admin_support_notes` before `admin_support_cases`.** The FK is
  `RESTRICT`, so the order is forced.

If the apply fails part way: confirm on the target whether the migration runner
wraps it in one transaction before relying on that. If it does not, the
pre-apply snapshot plus §1.1's backup is the recovery path.

**Authorization needed: yes.** Hosted mutation. Not performed.

---

## 2. E15 — deployed-panel browser verification

### 2.1 The prerequisite, and a tooling limit that is mine

**No deployment exists.** There is no `vercel.json`, no `.vercel` directory and
no recorded deployment URL anywhere in the repository. E15 cannot be executed
against something that is not there, and the directive is explicit that I must
not create a production deployment merely to satisfy it.

**A second limit, which is mine rather than the project's:** the
browser-automation tool available to this session (`chrome-devtools`) **failed to
connect**. So even given a staging URL today, I could not drive a real browser
from here. E15 needs either that tool working in a later session, or a human
with devtools open.

**Required from you:** an approved **staging** deployment URL, and confirmation
that it is staging rather than production.

### 2.2 What to verify, once a staging deployment exists

**All eleven Admin routes, each as each of the four roles.** That is the part
that cannot be shortcut — a route that renders for the wrong role is the defect
this gate exists to catch.

| Area | Check |
|---|---|
| Authentication | an unauthenticated request to every route redirects to login and renders no data |
| Authorization | each role sees exactly its permitted routes; a forbidden route refuses rather than rendering empty |
| Real interaction | navigate by clicking, not by typing URLs — a working link and a working route are different claims |
| Loading / empty / error | each of the three states reachable and legible on at least one route |
| Network requests | with devtools open, no response body, JS bundle or sourcemap contains `SUPABASE_SERVICE_ROLE_KEY` or its value |
| Session cookie | carries `HttpOnly`, `Secure`, `SameSite` |
| Financial privacy | every withheld money figure renders as a **withholding with its reason** — never `0.00`, never blank |
| Export | a downloaded CSV carries the withholding note inside the file |
| Audit | an admin action appears in the audit view, and `sale_refunded` does not appear in the shop audit page |

**Evidence required:** a HAR per role, plus screenshots of one withheld money
figure and one audit view. A verbal report is not acceptance for this gate.

**Authorization needed: yes** — a staging deployment.

---

### 2.3 The staging deployment package — what to configure, exactly

Prepared, not executed. **No deployment was created.** The admin app's whole
configuration surface is four variables it reads directly plus two the server
config module owns, and that smallness is the point: there is very little to get
wrong, and each piece either fails closed or is load-bearing for a gate.

| Variable | Value for staging | Why it matters here |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the **staging/DEV** project URL | public by design; it is the one value that may reach the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | the staging project's key | **server only.** `lib/env.ts` is the only module that names it, and E15's central check is that it appears in no bundle, no sourcemap and no response body |
| `ADMIN_SESSION_SECRET` | a fresh ≥32-byte secret, **not production's** | a shared secret would let a staging cookie authenticate against production |
| `ADMIN_ROLES` | JSON, one test account per role | see below — this is also founder confirmation item 5 |
| `ADMIN_MAP_TILE_URL` | **leave unset** | gate E14. Unset means the Maps page makes no third-party request, which is the state to verify |
| `ADMIN_MAP_TILE_ATTRIBUTION` | leave unset | same |

**`ADMIN_ROLES` validation, before deploying rather than after.** It is
authoritative, re-read per request, and the panel fails closed when it is unset
or unparseable. It must be a JSON object mapping username → one of
`super_admin`, `billing`, `support`, `read_only`; it refuses a padded username,
an empty username, duplicate usernames differing only in case, a reserved
username, an array, a string, `null`, an empty object and an unknown role. Four
accounts are needed, one per role, because **E15's authorization matrix cannot
be exercised with one login** — the gate is "each role sees exactly its
permitted routes", and a single super_admin proves none of it.

**Secrets isolation, as a check rather than an intention.** `middleware.ts` runs
on the Edge and sees the session cookie and `ADMIN_ROLES` — **no password
material**. Confirm after deploying that `SUPABASE_SERVICE_ROLE_KEY` is not set
as a `NEXT_PUBLIC_*` variable under any name, because that single mistake is
exactly what E15 exists to catch and it would be invisible in the source.

**Database binding.** Point staging at a project whose chain the panel expects.
Migration 35 creates the five tables the Admins, Support and audit pages read,
so a staging project at migration 34 will surface errors on those pages that
look like application defects and are not. **So E15 and E4-H are coupled:**
verify the chain first, or expect to re-run E15 afterwards.

**Dummy data only.** No pharmacy name, phone number, coordinate or sale from a
real shop. The financial-privacy checks need **at least five distinct shops
with both sales and refunds** to exercise the floor's releasing branch; fewer
and every money figure withholds, which tests the withholding and nothing else.

**Access restriction.** Staging must not be publicly indexable or reachable
without a login. The panel refuses unauthenticated requests on its own, but a
public staging URL invites the one thing this gate is about.

**Rollback.** There is nothing to roll back in the app — it is stateless and
holds no migrations. Deleting the deployment and rotating
`ADMIN_SESSION_SECRET` is the whole reversal. Rotating it also invalidates every
staging session, which is the correct end state for a finished test run.

**Authorization needed: yes.** A deployment is an outward-facing act. Not
performed.

---

## 3. Mobile sync — physical-device acceptance plan

### 3.1 Why the existing APK does not count

The Preview worktree `D:\Muthoy-Preview-Test` sits detached at **`bd0fa4d`**,
and I verified it clean and untouched. **`bd0fa4d` does not certify current
Batch 3 code** — the owner-handover and tenant-isolation fixes landed after it.
An APK built from it would test the wrong revision, which is worse than testing
nothing, because it produces a pass that means nothing.

### 3.2 What is needed

| Step | Requirement |
|---|---|
| 1 | a **separately authorized** Preview build at the current accepted revision — not from `bd0fa4d`, and not by modifying the Preview worktree |
| 2 | **dummy data only.** No pharmacy's real stock, sales or customers |
| 3 | installation that does **not** overwrite a production identity on the device |
| 4 | **two** physical devices, because the fixes under test are about two devices |

### 3.3 What to test, and why these six

The 3 127 mobile tests all pass, and no device has run them. These are the cases
where a device can disagree with a test:

1. **Owner handover.** A new owner registers on a device a previous owner used.
   The new owner must see **no** trace of the previous owner's shop — CLAUDE.md
   rule 7, and the one that matters most on shared hardware.
2. **Tenant isolation under sync.** Two shops, two devices; neither shop's rows
   reach the other.
3. **Offline then online.** Sell offline, go online, confirm the queue drains
   once and the totals match — then repeat with the app killed mid-sync.
4. **Refund bucketing by business date.** The case the whole publication
   question rests on: a refund entered on one device for a sale from another day
   must land in the right period.
5. **Opening cash at midnight.** Rule 5 — it resets, and never inherits
   yesterday's value.
6. **FEFO at read time.** Rule 3 — sorted by real expiry date, recomputed, not
   by a stored day-count.

**Acceptance:** each case recorded with the device, the build revision and the
observed result. A case that cannot be run is recorded as not run.

**Authorization needed: yes** — a build, and a device session.

---

## 4. H-11 C5 — restore readiness, and the two blockers that stop it here

**Status: BLOCKED on tooling and on a target. Nothing destructive was run, no
backup was taken, no restore was attempted.**

This is the gate that makes migration 35's class C survivable. §1.1 states the
position: class C means restore-from-backup is the only way back, and no real
restore has ever been rehearsed. What follows is what a rehearsal needs, what
already exists for it, and precisely why it cannot be executed from here.

### 4.1 The verification half already exists, and is better than I expected

`backend/supabase/checks/restore_baseline.sql` is an **85-line, SELECT-only
restore fingerprint**, and its own first two lines state the position exactly:
*"H-11 automated restore fingerprint. SELECT-only and safe to execute. The
operational C5 restore rehearsal remains explicitly unexecuted."*

For each money and inventory scope it computes three things together — the row
count, the summed money column, and an `md5` over a field-wise `string_agg`
ordered by id. That triple is what makes a restore *verifiable* rather than
merely *completed*: a restore that loses rows fails the count, one that
corrupts amounts fails the total, and one that reorders or mangles a field
fails the digest while the first two still pass.

`backend/supabase/pgtest/restore-baseline.pgtest.ts` exercises it against a
real Postgres, so the fingerprint itself is tested.

**So the rehearsal does not need a new integrity check to be written. It needs
to be run — before and after — and the two fingerprints compared.**

### 4.2 Required backup scope

| Scope | Why it is in or out |
|---|---|
| `public` schema **and** data | the fingerprint reads row data, so a schema-only dump cannot be verified |
| `supabase_migrations.schema_migrations` | the pre-apply history snapshot of §1.3 is part of the recovery state; a restore that loses it leaves the chain unverifiable |
| roles, privileges and ownership | migration 35's whole effect is a privilege narrowing, so a restore that returns the data without the ACLs has not restored the thing that was changed |
| `auth` schema | **out of scope for the rehearsal.** It is not touched by 35 or 36, and dumping it moves real user records around for no gain |
| any pharmacy-identifying data to a local disk | **out.** A rehearsal must use the hosted provider's own restore into a hosted target, not a download |

### 4.3 Blocker one — the client tooling is the wrong major version

Measured on this machine, now:

| Tool | Version |
|---|---|
| `pg_dump` | **18.6** |
| `pg_restore` | **18.6** |
| `psql` | **18.6** |
| `supabase` CLI | **absent from PATH** |
| `docker` | installed, **daemon not running** |

Supabase hosted projects are not 18.x. `pg_dump` from a newer client against an
older server is supported; **restoring an 18.6-produced custom-format dump into
a PG15 or PG17 server is not.** So the obvious shape of a rehearsal — dump from
the source, restore into a fresh project — is not something this toolchain can
do correctly, and attempting it would produce either a failure or, worse, a
partial restore that the fingerprint would then correctly reject for the wrong
reason.

This matches the standing note that PG17 is missing locally. It is a
prerequisite, not a defect: **client tools matching the hosted major version**,
or the provider's own point-in-time restore, which does the work server-side
and needs no local client at all.

**The provider's own restore is the better route** and should be preferred: it
is what you would actually use in an incident, so rehearsing anything else
rehearses the wrong thing.

### 4.4 Blocker two — there is no safe isolated target

A restore must land somewhere that is not the source.

| Candidate | Verdict |
|---|---|
| `jwjrijvprbsndukfhlvf` (H-9 rehearsal) | **no.** It carries the 34-chain this package's preflight checks against. Restoring over it destroys the pre-apply baseline that makes §1.6 meaningful |
| `btfprhticjgeihcngpif` (DEV) | **no.** Holds real DEV data |
| a new disposable project | **yes, and this is the blocker.** It needs a free project slot, which has to be checked rather than assumed, and creating one is a hosted change this prompt does not authorize |

**Do not treat the rehearsal project as disposable because its name says
rehearsal.** It is the only artifact proving migration 34 applied cleanly to a
hosted project.

### 4.5 The rehearsal, ordered, for when both blockers clear

1. Confirm the target is a **new, empty** project, and record its ref.
2. On the source, run `restore_baseline.sql` and record every scope's triple.
3. Record `select version, name from supabase_migrations.schema_migrations order by version;`.
4. Take the backup, by the provider's own mechanism, and record how it is identified.
5. Restore **into the new project**, never over the source.
6. On the restored target, run `restore_baseline.sql` again.
7. Compare the two fingerprints scope by scope. Every count, total and digest
   must match. A mismatch in the digest alone is still a failure.
8. Re-run `h9_postmigration_checks.sql` and `e4_postmigration_checks.sql` on the
   target and record both results.
9. Verify roles, privileges and ownership — `has_table_privilege` for
   `service_role` on `sale_refunds` and `audit_logs` is the narrowest useful
   probe, because those two are exactly what migration 35 changed.
10. Record the elapsed **recovery time**. A restore path whose duration is
    unknown is not a recovery plan.
11. Record what failed, if anything, and what the recovery from that failure was.
12. Delete the disposable target only after the evidence is recorded.

### 4.6 What migration 36 changes about this picture

It **reduces** the class-C surface rather than adding to it, and that was a
design constraint rather than luck. The publication table could have been its
own append-only evidence store, which would have made it a second class C
whose only recovery is this same untested restore. Instead the publication
evidence is written to `admin_audit_log` — already class C — in the same
transaction, and `financial_publications` is the serving copy, reversible by
`drop function` then `drop table`.

That reversal is **executed**, not merely documented:
`e4b-publication.pgtest.ts` drops both objects, asserts they are gone, asserts
`admin_audit_log` survives, and then re-applies the migration twice to prove it
is idempotent forward. So migration 36 needs no restore to be reversible, and
the C5 gate remains about migration 35 alone.

**Authorization needed: yes**, twice — a free project slot and a hosted restore.
Not performed.

---

## 5. What this document does not do

It applies no migration, creates no deployment, builds no APK, retrieves no
credential and does not modify the Preview worktree. Every section is a plan
whose first line is a request for an exact target.

**None of these three gates is a defect in the reviewed code.** They are
operations no agent can perform without you naming where.
