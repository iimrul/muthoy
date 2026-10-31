# Batch 3 final closure — what was executed on 2026-10-31

**Verdict: TECHNICALLY ACCEPTED, OPERATIONAL GATES PENDING.** Not closed.

This run was authorised to complete every safely executable part of Batch 3 in
one pass and to return CLOSED only if the gates genuinely passed. They did not,
and the reasons are structural rather than a matter of effort. Three of the five
operational gates cannot be reached from this host at all; the fourth is blocked
by a safety check that is working as designed; the fifth produced real new
evidence and a new tool.

Starting point, verified rather than assumed: `origin/main` and local `HEAD` both
at **`85e5c90`**, `git rev-list --left-right --count HEAD...origin/main` = `0 0`,
working tree carrying only the four pre-existing untracked/modified
`apps/prototype-web` entries. Accepted code revision **`5083321`**, CI
**`41199969353`** success with its Test step confirmed at 490 s.

---

## 1. H-11 C5 — the first rehearsal this host could actually run

Every previous attempt recorded the same obstacle. `h9_pg17_restore.md` says it
plainly: *"The local Docker daemon was unavailable; no image was downloaded or
container started."* That changed. The daemon is up (29.7.2, linux) and
**`public.ecr.aws/supabase/postgres:17.6.1.159` was already cached**, so an
isolated, Supabase-flavoured PostgreSQL 17 target was available locally at zero
cost, with no new Supabase project and nothing bought.

Two containers were started bound to **127.0.0.1 only**, ports 54329 and 54330,
each reporting `server_version_num = 170006` (PostgreSQL 17.6), zero non-system
databases, and a **PG17.6 `pg_dump` inside the image** — which quietly resolves
the toolchain problem, because this host's own client is 18.6 and the procedure
refuses a PG18 toolchain.

All data below is synthetic. No DEV credential was requested, retrieved or used;
no hosted project was contacted.

### 1.1 Migration 33's own `cron.schedule` call ran against real `pg_cron`, and it passed

**A correction first.** An earlier draft of this section claimed this branch ran
"for the first time anywhere". That is false, and it is the fourth unenumerated
quantifier I have written in this batch. `docs/plans/h9-verification-report.md`
records the hosted H-9 rehearsal of 2026-10-15 with pg_cron 1.6.4 enabled before
the chain, migrations 32-33 applied at 05:28:01-05:28:07Z with 0 failures, and a
`cron` check section passing 5/5. Finding F10 there is explicit: *"migration 33
applied and verified B2's job."* Hosted execution is stronger evidence than a
local container, and it already existed.

What is new is narrower and worth keeping. That rehearsal notes *"B2 created cron
job 1 itself"*, so migration 33 found `v_jobs = 1` and took its **verify**
branch - it never called `cron.schedule`. This run had no pre-existing job, so it
took the `v_jobs = 0` branch and **migration 33 scheduled the job itself**, which
is the path its own header describes as *"one where the job is missing gets it
here."* So the two runs cover the two halves of that conditional, and only now
are both halves covered against real pg_cron rather than a stand-in.

`backend/supabase/pgtest/h9-cron-cleanup.pgtest.ts` says what it is in its own
header: *"PGlite cannot load pg_cron, so the 'installed' path runs against a
[stand-in]… This proves guards, not a scheduler."* The stub hardcodes
`nodename: 'localhost'` and `nodeport: 5432`.

The container reports `cron.timezone=GMT`, `cron.host=localhost`,
`cron.use_background_workers=off` — the exact configuration migration 33's
comment describes. So migration `20261008000100` was applied **verbatim** against
real `pg_cron 1.6.4`, on real PG17.6, after creating B2's cleanup function as B2
ships it. It exited 0 and produced exactly one job whose every column matches the
stub:

| Column | Real `pg_cron` 1.6.4 | Stub expectation |
|---|---|---|
| `schedule` | `17 3 * * *` | same |
| `command` | `select public.sync_cleanup_incomplete_operations();` | same |
| `nodename` | `localhost` | same |
| `nodeport` | `5432` | same |
| `database` | `postgres` | same |
| `username` | `postgres` | same |
| `active` | `true` | same |

**The PGlite stub was faithful.** That is worth recording in a project where the
recurring defect is a test that passes without exercising the behaviour: this
time the stand-in told the truth on the scheduling path too, and we now know it
rather than hoping it.

### 1.2 Four findings that would have cost the real maintenance window

These are defects in the written procedure, found for free with synthetic data,
before the founder spends the one DEV password entry on it.

1. **`cron.job` IS carried by a dump.** `pg_restore --list` shows
   `3418; 0 16669 TABLE DATA cron job supabase_admin` — pg_cron marks its job
   table for extension config dump. I had expected the schedule to be lost; the
   measurement corrected me.
2. **The Supabase image's `postgres` database is never empty.** It ships `auth`,
   `cron`, `vault` and `storage` pre-created, so a restore there with
   `--single-transaction --exit-on-error` dies immediately on
   `ERROR: schema "auth" already exists`. Step 8 of the procedure demands an
   "EMPTY isolated target" and step 9 forbids `--clean`. A freshly created
   database *is* empty (`public` + `plpgsql`, nothing else).
3. **A `pg_cron`-enabled dump needs the scheduler's own database.** pg_cron
   refuses the extension outside its configured database, in its own words:
   *"can only create extension in database postgres… the pg_cron background
   worker reads job descriptions from this database."* Combined with (2), the
   procedure as written has nowhere to put such an archive: the only database it
   permits is the one that is never empty.
   **Corrected scope, after review:** on a *local* target `cron.database_name` is
   changeable with a server restart, so this is a **configuration requirement**,
   not an impossibility. An earlier draft called it impossible; that was
   overstated. On a hosted project, where the setting is not yours, it remains a
   hard stop. The guard in `dev-backup.mjs` compares the archive against the
   target's **effective** setting, which is correct in both cases.
4. **Owner preservation needs superuser, which hosted Supabase does not grant.**
   Restoring `supabase_admin`-owned objects needs `SET ROLE supabase_admin`.
   Measured: `postgres super=false`, and `postgres` is **not** a member of
   `supabase_admin` (its memberships are `pg_read_all_data, pg_monitor,
   pg_signal_backend, pg_create_subscription, authenticator, authenticated,
   anon, service_role, supabase_privileged_role`). A hosted project only ever
   gives you `postgres`.

### 1.3 A postgres-owned synthetic subset restores cleanly

Finding 3 sounds alarming and then stops being alarming, because **DEV has no
`pg_cron`**. That is deliberate, and migration 33 says why: *"DEV, where enabling
the scheduler could delete retained staging data and needs its own founder
decision."* So DEV's dump contains no `CREATE EXTENSION pg_cron` and finding 3
cannot fire for it. Finding 3 is a **PROD** problem, since enabling pg_cron first
is the intended PROD order.

A DEV-shaped source (postgres-owned, no pg_cron) was dumped and restored into a
freshly created database with `--exit-on-error --single-transaction`:

- `pg_restore` **exit 0**
- rows restored: 2 of 2
- `fn_secdef=true`, `owner=postgres`, `anon_exec=false`, `svcrole_exec=true`

Ownership, `SECURITY DEFINER` and the ACLs all survived.

**What that does and does not establish.** An earlier draft of this section said
"the procedure works for the target that is actually authorised." That exceeds
the evidence and the independent review was right to say so. Two postgres-owned
rows are a **subset** of DEV's shape, not DEV's shape:
`docs/plans/h9-pg17-extension-verification-2026-10-19.md` records DEV carrying
`supabase_admin`-owned extensions, including `plpgsql` and `supabase_vault`,
which this fixture did not contain - and those are exactly the objects finding 3
above says need superuser. So the honest claim is narrower: **the capture and
restore mechanics work, and the ownership class that broke is absent from this
fixture rather than shown to be absent from DEV.** Whether DEV restores cleanly
is still unmeasured, and measuring it needs the founder's password entry.

### 1.4 What C5 still owes, and why this is not it

This is tooling verification, exactly as the founder already classified it. It is
not hosted recovery acceptance, for three independent reasons:

- **No real DEV data moved.** `h9_pg17_restore.md` states *"Founder already has
  the DEV password"* — it is not in custody here. `%USERPROFILE%\.muthoy-secrets\`
  holds `h9-rehearsal.env`, `h5-dev.env` and `dev-test-otp.env`; the only
  database password among them is `H9_REHEARSAL_DB_PASSWORD`, which is the
  rehearsal project's, not DEV's.
- **The provider capability is still unread**, though the documentation question
  is settled and an earlier draft of this had it wrong. Supabase's Database
  Backups guide specifies automatic backups for **paid** plans and recommends
  **exports** on Free, and restoring into a **separate new project** is
  documented but **paid-only**. So the route exists and is not available on Free.
  What is still a founder dashboard read is what `btfprhticjgeihcngpif` offers
  today.
- **C5 is larger than Part A.** `restore_drill.md` Part B is a device restore and
  Part C is the encryption migration at 21.8 MiB with a mid-migration kill. Both
  need a physical handset. `adb` is not installed and zero devices are attached,
  so **C5 cannot pass in any session without hardware**, however the server half
  goes.

---

## 2. E4-H — migrations 35, 36 and 37 are held

Held, and the hold is now doubly determined.

The founder's conditional authorisation applies *"ONLY after the approved real
backup-and-restore acceptance has PASSED."* C5 has not passed (§1.4), so the
condition is unmet and no hosted apply was attempted.

Independently, the sanctioned applier is absent: **`supabase` is not installed on
this host** and not in `node_modules/.bin`. So `supabase migration list --linked`
and `supabase db push --linked --dry-run` could not be run either, which means
the hosted ledger remains read from a prior session's receipt rather than live.
The previously recorded conclusion is unchanged and unweakened: one push applies
35, 36 and 37 together in version order, the two routes to 37 alone are forbidden
in writing, and so any push carrying 37 inherits class-C migration 35's recovery
requirement.

Migration 35's class-C requirement was not weakened to manufacture closure.
`backend/supabase/migrations/` is byte-clean and all five sealed declarations are
unchanged.

---

## 3. E15 — Admin: two items verified, the browser walkthrough NOT VERIFIED

**Production build: PASS.** `turbo run build --filter=@muthoy/admin` →
`1 successful, 1 total`, exit 0.

**Service-role confinement in the browser bundle: PASS, with controls.** Six
patterns were scanned across `apps/admin/.next/static` (the client chunks):
`SUPABASE_SERVICE_ROLE_KEY`, `service_role`, `sb_secret_`, a JWT header prefix,
`SERVICE_ROLE`, `ADMIN_ROLES` — **0 files each.** Three controls establish the
scan was not vacuous:

- it finds strings that *are* there (`use strict` 19 files, `React` 5,
  `createElement` 9);
- `SUPABASE_SERVICE_ROLE_KEY` **does** appear in the server build (1 file under
  `.next/server`), so the identifier is in the build and the client-side zero is
  real separation rather than absence everywhere;
- a canary appended to a *copy* of a client chunk was detected.

Stated precisely: this proves the identifier does not reach client chunks. It is
**not** a substitute for the route walkthrough.

**The eleven-route browser acceptance is NOT VERIFIED**, per the founder's own
fallback instruction, and for two reasons that are both environmental:

- **No browser driver.** Neither Playwright nor Puppeteer is installed, there is
  no `playwright.config.*`, and the configured `chrome-devtools` MCP server
  **failed to connect** (`CONNECT_TIMEOUT` after 30 s). That is a connection
  failure, not a missing capability — it may simply need a retry.
- **No DEV service-role credential.** It is not in custody, and the panel cannot
  serve real DEV data without it.

No build or unit-test evidence is offered in its place. The working code is
preserved and untouched.

---

## 4. Android Preview — approval #2 answered YES; the build is blocked by a designed check

### 4.1 What is now confirmed

The preview identity resolves from the current revision exactly as pinned in
`apps/mobile/config/environmentPolicy.js`: name **Muthoy POS Preview**, scheme
**`muthoy-preview`**, `android.package` **`com.muthoy.pos.preview`**, owner
`imrulkaesh`, projectId `075497e0-eac5-4ed9-8552-3c6e70f6efa9`,
`extra.supabaseProjectRef = btfprhticjgeihcngpif`.

**The previously unconfirmed environment read is now done, and it passes.** EAS's
`preview` environment carries both required variables:

| Name | Visibility | Value |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | PUBLIC | `https://btfprhticjgeihcngpif.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | SENSITIVE | not requested, not read, not printed |

The URL is the DEV project, matching both the resolved config and the policy's
pinned `DEV_PROJECT_REF`. **Outstanding approval #2 is satisfied by evidence.**

Two mechanical notes worth keeping, because they cost time twice:
`eas env:list` fails with the opaque `env:list command failed` unless
**`APP_VARIANT` is set**, because it evaluates `app.config.js`, which fails closed
on an unset variant; and the sensitive value can be supplied to a checker without
ever being displayed, via `eas env:exec preview "<command>"`.

### 4.2 The new blocker, which did not exist in the earlier plan

With the preview environment injected, the gating validator's refusal **changed**
from `configuration-invalid` to **`native-project-stale`**. The environment and
the public-key fingerprint therefore validate; something else refuses.

The cause is exact. `apps/mobile/android/app/build.gradle` carries
`applicationId 'com.muthoy.pos.h3scratch'`, and `assertNativeProjects` refuses
when a generated native project's id does not match the variant being built.
Proven in isolation against the exported function: no native project → passes; a
matching `com.muthoy.pos.preview` → passes; the `h3scratch` leftover → refuses.

It is tempting to call this a false positive, because the directory is untracked,
gitignored (`apps/mobile/.gitignore:43`), excluded by `.easignore:27`, and
**0 of the 440 files EAS would upload come from it**. That reading is wrong on
both counts:

- **The refusal is intended and asserted.**
  `apps/mobile/tests/environment-policy.test.ts:100` enumerates
  `com.muthoy.pos.h3scratch` among the packages that must "refuse before build".
- **`h3scratch` is retained state, not junk.** `DECISIONS.md` records it across
  H-3, H-4, H-10, A2.3 and H-5, and the H-9 remediation report states *"Android
  scratch remains `com.muthoy.pos.h3scratch`."*

So the remedy — removing or renaming the generated native project — deletes
another workstream's retained device-testing state, and the authorisation was
explicitly *"after these checks pass."* They do not pass.

**And this is not merely a local advisory.** The repository's sanctioned build
command is `pnpm build:eas`, which is
`validate-mobile-environment.mjs --eas-build`; `main()` calls
`assertNativeProjects` **unconditionally** (line 252) *before* it ever spawns
`eas build`. So the only sanctioned entry point refuses, rather than warning.

**But refusing to build was still wrong, and the route was already written down.**
`docs/plans/H-9-production-environment-eas-secrets.md` says it in the context of
exactly this problem - `requireCommit=false` lets working-tree files into an
archive - and prescribes: *"Use a fresh dedicated checkout, keep inspection
outputs outside it."* A fresh checkout of a committed revision has **no generated
native project** (so `assertNativeProjects` passes) and **no dirt** (so
`assertCleanRevision` passes), without touching `h3scratch` or the prototype-web
files at all. The precedent is in this repository: `git worktree list` shows
`D:\Muthoy-Preview-Test` at `bd0fa4d`, which is how the existing Preview APK was
produced. I missed it, concluded the founder had to sacrifice retained device
state, and recorded that as a required decision. That was a refusal of authorised
work, not caution.
Worth noting for the eventual fix: the EAS worker path (`--worker`, wired as
`eas-build-pre-install`) carries the opposite guard — it fails with
`worker-native-project` if a native directory arrives at all — which is why the
archive legitimately contains none, and why scoping the local check to
archive-included files is not a safe one-line change.

**A second, independent refusal.** `assertCleanRevision` runs
`git status --porcelain=v1 --untracked-files=all` and refuses `revision-dirty` on
**any** dirt anywhere in the tree. Five pre-existing `apps/prototype-web` entries
(one modified `pnpm-workspace.yaml`, plus `.expo/README.md`,
`.expo/devices.json`, `pnpm-lock.yaml`, `tsconfig.json`) make the revision dirty
**independently of this run's work**, and that tree is reference-only under
CLAUDE.md rule 15. Measured against `85e5c90` itself: REFUSES. So the build needs
those five resolved as well, which is a founder call because I did not create
them.

**Therefore no build was submitted.** Quota is confirmed not to be the
constraint, and the build would have cost nothing; the gates are safety checks,
not a budget.

### 4.3 Device acceptance: BLOCKED — PHYSICAL HARDWARE REQUIRED

`adb` is not installed; zero devices are attached. None of the twenty Batch 3
device scenarios was run and no device log was fabricated.

The logout behaviour was **not** rewritten. A normal shift logout remains the
narrowest possible clear, and `signOutDevice` keeps `scope: 'local'` with the
test that asserts it. Option A wording stands, because nothing in this run
demonstrated the behaviour is other than as recorded.

---

## 5. New: a repeatable backup executor

`scripts/h11/dev-backup.mjs`, with `scripts/h11/test/backup-contract.test.mjs`
(24 tests), wired into `package.json` as `test:h11-backup` and into CI as
"H11 C5 backup executor contracts".

It is the machine-repeatable part of `h9_pg17_restore.md`: the version and
emptiness gates, the archive inventory, the hashes and a manifest. It performs no
hosted write — `pg_dump` is read-only — and it refuses before connecting if a
password appears in argv or `PGPASSWORD`. The connection is named only by a libpq
service, so no credential reaches the command line, the manifest or any log.

Its refusals encode §1.2 rather than restating it in prose: a PG18 client is
refused, a non-17 `server_version_num` is refused, the Supabase image's own
`postgres` database fails the emptiness gate, and a `pg_cron`-enabled archive
aimed at anything other than `cron.database_name` is refused up front instead of
failing halfway through a restore. Its fixtures are the **real** captured
strings, not invented ones. The manifest's `hostedRecoveryAcceptance` is
hard-wired to `null`: this tool cannot assert the thing only the founder can.

**The first revision of this file did not deserve to ship, and the independent
review is why it does now.** Its verdict was REVISE with ten findings, four of
them HIGH, and the sharpest one was the project's own recurring defect in pure
form: *replacing the entire CLI with an immediate throw still left 12/12 tests
passing*, because every test exercised a helper and none exercised `main()`.
Worse, `main()` never called three of the guards this file advertises -
`assertServerVersionNum`, `assertTargetEmpty` and `assertRestoreTargetCompatible`
were exported, documented, tested in isolation, and wired to nothing. A manifest
could therefore record `pgMajor: 17` for a PG16 archive.

What changed in response:

- **The gates are enforced, not merely exported.** `main()` takes injectable
  dependencies, version-checks both binaries, pins the **archive's own** source
  major from its header (`Dumped from database version:`), and gained a real
  `--restore` path that checks the target's `server_version_num`, its emptiness
  and the pg_cron rule before `pg_restore` runs. Nine CLI-level tests assert the
  command sequence and that each refusal happens *before* anything is dumped or
  restored.
- **Credential detection was leaky.** The review got a password through as
  `--service "h9_dev_verified password = 'SYNTHETIC'"` - libpq permits whitespace
  around `=`, which a `password=` substring check misses - and again as
  `--dbname=postgresql://user:pass@host`, which the URL pattern missed because it
  was anchored to the start of the argument. A service name is now validated as
  an identifier, the password pattern tolerates whitespace, the URL pattern is
  unanchored, and `PGPASSFILE`, `PGSERVICEFILE` and `PGSERVICE` are refused
  alongside `PGPASSWORD`.
- **Emptiness needed positive evidence.** `assertTargetEmpty()` with no argument
  returned `true`, and a `public`-only inventory reads identically whether
  `public` is empty or full. It now requires the inventory *and* a relation count.
- **The TOC parser was matching loosely.** Real, legal entries
  `cron.job-archive`, `cron."job.old"` and a table literally named
  `EXTENSION - pg_cron` were misclassified. Parsing is now anchored on the
  descriptor with exact schema and name comparison.
- **The manifest accepted contradictions** - `clientMajor: 18` beside an asserted
  `pgMajor: 17`. Fields must now agree.

Nine mutation probes now confirm the tests bite, including the review's own
counterexample: the CLI replaced by a throw, the extension rejection removed, the
emptiness gate removed from the CLI, the archive-source gate removed, the target
version gate removed, `carriesCronJob` loosened to a prefix, the password check
returned to no-whitespace, the service-name pattern loosened, and the URL check
re-anchored - **all nine killed**. The two mutations the review found surviving
are among them.

---

## 6. Verification

Recorded in the commit for this run, with the measured numbers rather than a
claim that checks were run.

---

## 7. The founder action package

Three items, consolidated - one fewer than the first draft of this report, because
the review showed item 2 was my error rather than a founder decision. Nothing else
is waiting on anything I can do.

| # | Action | Cost | Unblocks |
|---|---|---|---|
| **1** | **Read DEV's backup capability** in the Supabase dashboard — does `btfprhticjgeihcngpif` offer a restore, and can it target a separate project? | 5 minutes, no password | `restore_drill.md` prerequisite 1, and therefore the whole C5 design |
| **2** | ~~Decide the `h3scratch` native project~~ **WITHDRAWN.** No decision is needed: H-9's own prescription is a fresh dedicated checkout, which passes both gates without touching `h3scratch` or the prototype-web files. See §4.2 | free | nothing - this was my error |
| **3** | **Supply two physical Android devices**, or one plus willingness to wipe | hardware | the twenty device scenarios, **and** C5 Parts B and C |
| **4** | **Authorise the hosted apply of 35 → 36 → 37 in one ordered push**, naming the project — only after (1) and the resulting C5 acceptance | — | E4-H, and the hosted E11 verification |

Item 1 is blocked on nothing and is the root of the chain. Item 2 is new in this
run. Item 3 is the hard constraint: **C5 cannot complete without it**, so Batch 3
cannot be closed by any amount of further server-side work.

---

## 8. Boundaries honoured

No hosted SQL executed. No hosted project contacted, altered, created, deleted or
paused — both Supabase Free projects and the H-9 rehearsal project are untouched.
**No hosted migration applied.** (Migration 33 *was* applied, verbatim, to a
disposable local container holding synthetic rows — §1.1. An earlier draft said
"no migration applied anywhere", which contradicted that.) No credential requested, retrieved, printed or
written to disk; the one sensitive EAS value was deliberately never fetched. No
EAS build submitted. No paid resource consumed and nothing purchased. No device
operation. No production signing or package identity changed. No
`audit-artifacts/**` file modified. No real pharmacy or customer record left any
system, because none was ever read — every row in this rehearsal was synthetic.
The `h3scratch` native project was read and left exactly as found. The Preview
worktree `D:\Muthoy-Preview-Test` was not touched.

The two local containers are disposable and hold nothing but synthetic rows.

*Batch 4 is not begun.*
