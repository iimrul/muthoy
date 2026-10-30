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

### 1.7 Apply

Migration 35 only. No other migration exists to apply — the chain is 35 long and
`POST_E4_MIGRATIONS` is empty, which the new live-chain gate asserts.

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

## 4. What this document does not do

It applies no migration, creates no deployment, builds no APK, retrieves no
credential and does not modify the Preview worktree. Every section is a plan
whose first line is a request for an exact target.

**None of these three gates is a defect in the reviewed code.** They are
operations no agent can perform without you naming where.
