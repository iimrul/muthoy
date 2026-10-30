# H-9 — N0 / PG17 / A2 / A3 readiness and local preparation, 2026-10-19

**Status: LOCAL PREPARATION COMPLETE — ALL HOSTED WORK STILL BLOCKED ON FOUNDER APPROVAL**

Base revision `354fa2a`. CI run `39226904368` = **success** on that exact commit.
Uncommitted working document. No commit, push, Supabase write, migration, secrets
change, deployment, EAS build, SMS or device operation occurred. No Personal Access
Token was retrieved and no authenticated API request was made.

Sensitive locations are referred to by role, not path. No credential value, no raw
protected evidence and no secrets-directory contents appear in this document.

## 1. Verdict summary

| Track | Verdict | Blocked on |
|---|---|---|
| CI | **PASS** | — |
| N0 (account capacity) | **BLOCKED** | founder approval of the new read executor |
| PG17 (recovery) | **MISSING** | software provisioning approval |
| A2 (fresh 34-chain) | **BLOCKED** | N0 result, then a disposable project |
| A3 (historical upgrade) | **BLOCKED** | N0 result, a second database, DEV credential |
| Local preparation (this batch) | **COMPLETE** | — |

## 2. CI

Run `39226904368`, event `push`, attempt 1, `head_sha` equal to `354fa2a`.
Conclusion **success**; no failing step. Reproduced locally: the offline H-9
contract suite passes **65/65, exit 0**.

## 3. N0 — why it is blocked, precisely

The blocker recorded on 2026-10-18 (a permission failure writing the CLI's own
telemetry file) is **resolved**. The pinned CLI 2.117.0 now starts cleanly and
reports its version with exit 0, and its binary still matches the hash recorded
during the H1 execution. That is no longer the obstacle.

The real obstacle is structural:

- An account-scoped Personal Access Token **does exist**, held in Windows
  Credential Manager. It would answer N0 outright.
- The only approved path to that token is the protected launcher, which is
  hash-pinned to start **exactly one** child program — the DEV read-only
  inventory script — with a fixed argument list. There is no route through it
  to an organizations or projects listing.
- The launcher additionally refuses to run if a token is already present in the
  inherited environment, so a token cannot be supplied from outside.

Reading the token directly from Credential Manager was **not** done. That would be
credential retrieval outside the reviewed path and would defeat the custody design,
whose entire purpose is that only a hash-pinned, permission-checked program ever
touches it.

### The capacity question that remains open

The account-wide Free allowance is two active projects; paused projects do not
count, and creating another organization does not raise it. If DEV and the F12
rehearsal are both active, they consume **2 of 2**, leaving **zero** slots for A2
and A3. The rehearsal is recorded as still running. This single unknown decides
whether A2/A3 cost nothing or cost money, and it cannot be settled without one
authenticated read.

## 4. PG17 — missing, and no local work is available

| Requirement | Present on this machine |
|---|---|
| PG17 client (`pg_dump` / `pg_restore` / `psql`) | **No** — only 18.6 |
| Isolated PG17 server | **No** |
| Docker daemon | Installed (per-user), **not running** |
| In-memory Postgres used by tests | 18.3 — wrong major |

The recovery contract refuses anything that is not major 17 on both the dump tool
and the restore target, and the contract document itself states that missing tools
block and that installation is a separate decision. The host's 18.6 tools therefore
cannot produce an acceptable dump, and the in-memory engine used by the local tests
is supplemental only. **No safe local PG17 preparation step exists** that does not
require installing software.

### Minimal provisioning strategy (track D — design only, nothing installed)

**Recommended: one pinned `supabase/postgres` 17.x container, loopback-only.**

The reason is extension parity, not convenience. The migration chain declares no
extension of its own — only the built-in procedural language, plus a *conditional*
dependency on the cron extension that degrades to a no-op when absent. Every other
extension in a DEV dump comes from Supabase's own project provisioning, so a stock
upstream `postgres:17` image would fail the restore on Supabase-specific extensions.
The Supabase image also ships PG17 `pg_dump`/`pg_restore`, which removes the need to
install any PostgreSQL client on the host at all.

Prerequisites, each requiring its own approval:

1. Start the Docker daemon. Docker Desktop is installed per-user and its Linux
   backend exists but is stopped, so this is a start, not an install.
2. Pull exactly one image **by digest, not by tag** (this is outbound network use).
3. Verify inside the container that the client reports 17.x and the server reports a
   version number at or above 170000 and below 180000. A tag is not proof.
4. Prove extension parity **per extension** against the DEV inventory already
   captured by the A5 read. That inventory is the authoritative list; the repository
   is not, because the extensions are not created by our migrations.
5. Isolate: bind only to loopback on an unused high port (or run with no network),
   use a fresh uniquely-named restore database, prove it empty before restoring, and
   disable cron/scheduler workers in the target.
6. Confirm free disk space, and use an owner-only encrypted backup directory outside
   the repository and outside any build archive.

**Fallback if Docker cannot be started:** a PG17 binaries-only archive extracted to a
user directory and started on a loopback port — no installer, no service, fully
removable. It yields genuine PG17 client and server, but extension parity is then
unproven, and any Supabase-only extension present in the dump will block the restore.
Last resort only.

**Not viable:** the host 18.6 tools (wrong major, refused by contract), the in-memory
18.3 engine (wrong major, and not a Supabase project), and stock upstream `postgres:17`
(no extension parity).

## 5. A2 / A3 — blocked by design, not by oversight

The migration gate requires a target that is **not** DEV and **not** the rehearsal,
carries an approval identifier, names an organization and region, matches the reviewed
source-revision label, and declares a zero cost ceiling. A2 and A3 therefore cannot
run against either existing project — the gate refuses such a target outright. They
structurally require a newly created disposable project, which makes them entirely
downstream of N0.

A3 additionally needs a second database and either the DEV database credential or the
CLI login role, to restore a DEV schema dump as its starting point.

### Verified intact this session

- Migration 34's bytes still match its reviewed hash.
- The three evaluator identity pins still match.
- The protected staging workspace holds files **byte-identical** to the current
  working tree for all eight staged paths.
- The launcher's full precondition chain — ownership and permission checks, all file
  hashes, and the pinned interpreter — **passes now**, reporting verification with
  credentials explicitly not read, exit 0.

### Local preliminary evidence obtained

The four H-9 database test files pass **417/417** against a real Postgres engine,
exercising migration 34's actual behaviour. This is genuine evidence that the
migration is correct, and it is **not** a substitute for hosted acceptance: the local
engine is major 18, and it is not a Supabase project (no platform administrator role,
and none of the provisioned platform roles or extensions). Hosted A2/A3 remain required.

## 6. What was built locally in this batch

| Item | Status |
|---|---|
| N0 account-inventory executor (GET-only, three endpoints) | Implemented, tested, **not executed** |
| A2/A3 execution adapter (identity reader, apply writer, target guards, A3 staging) | Implemented and tested |
| Content-addressed runtime staging guard | Applied and verified |
| Focused test suite for the above | **38/38 pass** |
| Full offline H-9 contract suite (regression check) | **65/65 pass** |

### Independent review of the credential boundary

An independent review of the credential-access boundary was run before any execution,
as required. Its conclusion on the two questions it was commissioned to answer:

- **Credential disclosure: none reachable.** The token reaches only process memory and
  the HTTPS authorization header. Transport and timeout failures are replaced with a
  static refusal code, discarding the original message and stack. Output is projected,
  sanitised, then serialised; standard output and error carry fixed fields and codes
  only. No path puts the token in a URL, query string, evidence file, log, stack or on
  disk.
- **Endpoint allowlist: no bypass.** Exact scheme, host and path are enforced; unicode,
  percent-encoding, backslashes, ports, embedded credentials and project-scoped paths
  all fail. The method is fixed to GET. The organization-detail read is gated on a slug
  the account itself returned, immediately before each read.

**No critical findings.** The review returned *revise* on five items, none of which
concerned the credential boundary itself — three on capacity arithmetic and two on
custody wiring and overstated feasibility. **All five were fixed and covered by tests:**

1. *(High)* Failure and transition project states were classified as releasing a Free
   slot. A project stuck mid-pause or mid-restore may still hold quota, so only the two
   states documented to release a slot now do; everything else counts. Fixed.
2. *(High)* A truncated, filtered or foreign project listing still produced a
   "verified" verdict. DEV is now a mandatory completeness witness — its absence proves
   the listing cannot be trusted and refuses. The rehearsal is deliberately *not*
   mandatory, because deleting it is an approved future step. Fixed.
3. *(High)* The new executor performed none of the child-side runtime verification the
   A5 runtime applies to itself. It now proves ownership, permissions, per-file hashes
   and the pinned interpreter **before** the token is touched and again afterwards.
   This means the executor **refuses to run until it is properly staged**, which is the
   intended safety property, and it makes the staging requirement explicit rather than
   silent. Fixed.
4. *(Medium)* An unrecognised plan string was treated as paid merely because it lacked
   the word "free", which manufactured phantom capacity. Free is now the default and
   only a recognised paid tier is excluded. Fixed.
5. *(Medium)* Feasibility was asserted without acknowledging what the read cannot see.
   It now carries an explicit caveat that payment eligibility, and another Owner or
   Administrator having exhausted their own quota in a shared organization, can still
   refuse creation. Fixed.

Every fix moves capacity reporting in the conservative direction: this read can now
under-report available capacity, but not over-report it. Over-reporting was the
dangerous direction, because it would spend a founder approval on a create that then
fails.

### N0 executor — enforced properties

Three account-scoped reads only (organizations list, projects list, organization
detail). Method is fixed to GET with no body; no mutating method appears anywhere in
the file. Every URL is rebuilt and re-parsed before use, proving scheme, host and
path, and refusing any project-scoped route, query string, fragment or embedded
credentials. Redirects are refused, including a transport that silently followed one.
Response size is capped and non-JSON refuses.

An organization detail read is permitted **only** for a slug the account itself
returned. The token is validated for shape, sent solely in an `Authorization` header,
and never appears in a URL — asserted by test. Output is a strict projection: unknown
fields such as connection strings, database hosts and secrets are **dropped, not
redacted**, and the result then passes through the same sanitiser the A5 runtime uses,
which refuses if any credential-shaped value reached the output.

Capacity arithmetic fails safe in one direction only. Just the two project states
documented to release a slot are excluded; every other state — including failure and
transition states, and an explicitly unknown one — counts against the limit. An
entirely unclassified status refuses rather than guessing. An organization plan is
treated as Free unless it is a recognised paid tier, so an unknown or renamed plan
cannot manufacture capacity. DEV must appear in the project listing as a completeness
witness; its absence proves the listing is truncated, filtered or not this account's,
and refuses. The result therefore may under-report available capacity but cannot
over-report it.

Execution is gated twice. The program refuses without an explicit founder approval
identifier, and it proves its own staged runtime — ownership, permissions, per-file
hashes and the pinned interpreter — before the token is touched and again after the
read, refusing if the manifest changed in between. Until it is admitted to an approved
staged runtime it therefore refuses to run at all.

### A2/A3 adapter — enforced properties

It supplies only the two callbacks the reviewed gate already required and contains no
transport of its own — every hosted operation is an injected callback, asserted by a
test that permits only the two reviewed module imports. Existing gates are reused
unchanged, never re-derived.

Both protected project references are refused at three independent layers (target
validation, identity read, and write). The identity read additionally requires a
healthy status, a well-formed region, a major-17 database and a well-formed instance
fingerprint. The write accepts only migration 34's exact reviewed bytes, checking both
the declared hash and the bytes themselves, refuses an expired permit so a stale
receipt cannot authorise a write, and requires the writer's receipt to name this exact
project and version.

A3 staging is explicit: restore a DEV dump and prove the authentic 31-version history,
then commit the two intermediate versions, then a **fresh** preflight and separately
pinned 34. A later stage failing never implies an earlier stage rolled back.

### Content-addressed staging guard — and one deliberate consequence

The staging script previously refused unless the repository head equalled the revision
`b8ca5d8`. The reviewed runtime files were in fact *authored* while head was that
revision and *committed afterwards*, so that check refused every later revision even
when the staged bytes were identical to the reviewed ones — a latent blocker on any
re-stage. The guard is now content-addressed: it pins the exact reviewed hash of each
of the eight staged files and verifies all of them, all-or-nothing, before the first
copy. Verified by isolated extraction: the current tree is **accepted (exit 0)**, while
an appended byte or a removed source is **refused (exit 1)**.

Historical provenance was **not** rewritten. The manifest still records the same
revision label, because that value identifies the reviewed byte set and is what the
sealed H1 and F12 artifacts already attest to. The sealed artifacts were not modified.

**Recorded consequence:** editing the staging script changed its own bytes, so the
hash recorded for it in the 2026-10-18 source-hash audit artifact no longer reproduces.
That artifact is a historical record and is **not** enforced by any test, so it was
deliberately left untouched rather than rewritten. This drift is intentional and is
recorded here so it is not later mistaken for tampering.

**Known gap:** the content-addressed guard has no PowerShell test harness of its own.
It was verified by extracting the guard and exercising it directly, and by a parse-only
syntax check. Neither existing PowerShell test invokes the staging script, so neither
was run — running them would have written next to sealed evidence for no added coverage.

## 7. Founder approvals required, grouped

**Group 1 — N0 account read.** Approve running the new GET-only account-inventory
executor against the three account-scoped read endpoints, using the existing custody
path, to establish organizations, plans, project statuses and remaining Free capacity.
No writes, no project mutation, no project-scoped reads.
**This is the only item not downstream of something else. Approve it first and alone.**

Group 1 carries one unavoidable cost that should be decided consciously. The executor
refuses to run until it is part of an approved staged runtime, and admitting it means
extending the launcher's pinned program list and the runtime file closure, then
re-staging. Extending that closure changes the bytes of one already-reviewed file, so
the staged manifest is regenerated and the previously recorded manifest hash for the
H1 configuration no longer describes the new staging. The sealed H1 evidence itself is
untouched and still verifies against what it recorded; what changes is that a *new*
staging exists alongside it. The independent review also noted the broader point
plainly: the token is account-scoped and potentially mutating, and it is restrained by
this executor's code-enforced read-only behaviour rather than by any limit on the token
itself. Adding a second program to the trusted set enlarges that surface. That is the
real trade being approved — not the three reads, which are harmless, but one more
program being trusted with an account-wide credential.

**Group 2 — A2/A3 allocation decision.** Blocked until Group 1 reports the slot count.
Then one decision: two slots means two parallel disposable projects; one slot means
sequential work (complete A2, preserve its evidence, then separately approve deleting
that disposable and creating a fresh one for A3); zero slots means A2/A3 stay blocked
and the choice is between paying for a slot or retiring the rehearsal. No zero-cost
route that preserves both existing projects has been established.

**Group 3 — A2/A3 execution wiring.** Review the new adapter and connect it to a real
transport, then stage it under the content-addressed guard. Code and local review only;
no hosted calls. Can proceed in parallel with Group 1.

**Group 4 — PG17 provisioning.** Approve, as separate decisions: starting the Docker
daemon, and pulling one image by digest. Only then does any H5 backup/restore work
exist. Nothing in this group is partially doable without that approval.

## 8. Next executable gate

Group 1. Everything else is downstream of knowing whether this account has any Free
project capacity left.
