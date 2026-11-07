# H-11 Part B: debugger-assisted measurement procedure and security boundaries

Written 2026-11-04 under the founder's approval to *"Replace the withdrawn A1
census approach with debugger-assisted, read-only measurement on an isolated
debuggable APK."* **This is a procedure for review, not an executed result.**
Part B remains NOT PASS, and §6 records what is still unproven.

It supersedes nothing in `backend/supabase/checks/restore_drill.md`; it describes
*how* that file's steps 11 and 14 are to be executed.

---

## 1. Why a key-assisted route, and what was ruled out

The withdrawn in-app census rested on the claim that `sync_queue` is unreadable
from outside the app process. That claim was false for a debuggable build:
`MuthoyDbKeyModule.kt:20` states the SQLCipher key *"never leaves this module
except as the hex string"*, `getOrCreateDatabaseKeyHexAsync` returns 64 hex
characters to JavaScript (`:104-110`), and `apps/mobile/db/databaseKey.ts:30,110`
caches that plaintext for the life of the process.

The founder's instruction is to **prefer in-process read-only inspection that
avoids exporting the plaintext key**. Three candidates, assessed honestly:

| Candidate | Status |
|---|---|
| **Android Studio Database Inspector** (App Inspection) | **RULED OUT — verified 2026-11-07, no device needed.** It cannot read a SQLCipher database at all. This is not an `expo-sqlite` quirk: a plain SQLite client does not understand SQLCipher's encryption scheme, so neither Database Inspector nor **Android's own on-device `sqlite3` binary** can open one. Corroborated by CommonsWare's SQLCipher-for-Android reference, a community Room+SQLCipher sample reporting the same, and a Stack Overflow report of the database always showing as "closed". **This replaces the earlier "expected not to attach, unverified" entry** — the expectation was right for the wrong reason, and the real reason is stronger and needs no hardware. |
| **Android's on-device `sqlite3`** | **RULED OUT**, same reason, same sources. |
| **Hermes JS debugger, evaluating a query in-process** | **Still unverified, and needs the device.** React Native's Hermes inspector is gated on dev support, which a `release` variant does not ship even with `android:debuggable=true`. If it did work it would be the only key-free route, because the query would run inside the process that already holds the key. |
| **JDWP (Java/Kotlin debugger) breakpoint on the key accessor** | Available: `android:debuggable=true` enables JDWP regardless of build type. This is the key-assisted route below. |

**So the honest conclusion is narrower than the founder's preference allows.**
The instruction was to *"prefer in-process read-only inspection that avoids
exporting the plaintext encryption key"*. Two of the in-process candidates are
now ruled out on verified grounds, and the third (Hermes) is unlikely on a
release build and untestable while the handset is detached. **Unless Hermes
works, key-assisted decryption is not a third preference — it is the only
route**, which is the case the founder's fallback clause anticipated.

Hermes is still attempted first when the device returns, and the outcome is
recorded either way.

### Host-side tooling: what will actually open the copy

The earlier finding that this host has **no SQLCipher tooling** stands. Nothing
has been installed. What follows is the identification the founder asked for —
licensing, version and integrity verified first — and a request, not an action.

**What the tool has to match**, read from the app rather than assumed:

| Property | Value | Source |
|---|---|---|
| SQLCipher version | **4.7.0 community** | `CIPHER_VERSION_NUMBER` / `CIPHER_VERSION_BUILD` in expo-sqlite's vendored amalgamation |
| Underlying SQLite | 3.49.1 | same file, `SQLITE_VERSION` |
| Crypto provider | OpenSSL | `-DSQLCIPHER_CRYPTO_OPENSSL` in expo-sqlite's `android/build.gradle:34` |
| Key form | **raw**: `PRAGMA key = "x'<64 hex>'"` | `apps/mobile/db/databaseKey.ts:62` |
| KDF | **skipped** — the raw form bypasses key derivation | `databaseKey.ts:51` |
| Cipher parameters | **defaults** (4096-byte pages, HMAC-SHA512) | no `cipher_page_size` / `kdf_iter` / `cipher_hmac_algorithm` / `cipher_compatibility` pragma anywhere under `apps/mobile/db/` |

So the requirement is specific: read the **SQLCipher 4** format with a **raw**
64-hex key. A tool that only accepts passphrases is useless here, and a GUI
cannot be scripted into repeatable evidence.

#### Recommendation CORRECTED 2026-11-07

**My first recommendation, `@journeyapps/sqlcipher` 6.0.0, was wrong and is
withdrawn.** The founder flagged that its upstream release dropped Windows
support, and the package metadata confirms it at the strongest possible level:

```
npm view @journeyapps/sqlcipher@6.0.0 os   ->   [ 'darwin', 'linux' ]
```

An `os` field excluding `win32` means a Windows install is refused outright
(`EBADPLATFORM`), not merely awkward. The 6.0.0 release notes also remove
node-pre-gyp, prebuilt binary publishing and the vendored Windows OpenSSL
toolchain. I had reasoned about the package's *design* (it links real SQLCipher,
so raw keys are correct by construction) and never checked whether it runs on
this machine's platform at all — the right property, the wrong question.

**The recommendation is now `better-sqlite3-multiple-ciphers`**, verified against
each property the founder asked for:

| Property | Finding | How established |
|---|---|---|
| Version | **13.0.3** | `npm view` |
| License | **MIT** | `npm view` |
| Node compatibility | `engines.node >= 22`; this host runs **v22.22.2** | `npm view` + `node --version` |
| Integrity | `sha512-UYabM82r1J84TLWc/SszoHs6XopWpl/2HCg3Nui1JUaFXg/VLswzkPowYiRhK/4CftI8dgtikwyZQecMldrGxQ==` | `npm view dist.integrity` |
| **Windows binaries** | **`prebuilds/win32-x64.node` (2.3 MB)** and `win32-arm64.node` ship inside the tarball; no `os`/`cpu` restriction | jsDelivr file listing of the published package |
| Compiler needed? | **No** — which matters, because `cl.exe` is **absent** on this host | the bundled prebuild above |
| Raw-key support | `PRAGMA key = "x'<hex>'"` is supported, and **only** the sqleet and SQLCipher AES-256 schemes accept raw keys; first 32 bytes are the key, next 16 the salt | SQLite3MultipleCiphers official pragma documentation |

Our key is 64 hex = 32 bytes, so it supplies the key and leaves SQLCipher to
read the salt from the file header, exactly as on device. The scheme must be
selected explicitly: `cipher='sqlcipher'` and `legacy=4` for the SQLCipher 4
format, *before* the key pragma.

**Also rejected**, with reasons: `node-sqlite3-wasm` and every other WASM build
on npm — plain SQLite, no SQLCipher (`sqlite3mc` is not published to npm, so
there is no compiler-free WASM route); the `sqlcipher` CLI — BSD-style licensed
and fine in principle, but Zetetic publishes no Windows community binary, so it
would need an OpenSSL + MSVC source build on a host with no compiler.

#### Proposed isolated installation — NOT performed, approval required

1. A directory **outside the repository**, in the session scratchpad, with its
   own `package.json`. Nothing enters the repo's dependency tree, `pnpm-lock.yaml`
   or `apps/mobile`, and the repo's committed `.npmrc` is untouched.
2. Install with the integrity hash above pinned, and
   `--ignore-scripts` — the package needs no install script, because the Windows
   prebuild is already in the tarball, so nothing from the package should be
   allowed to execute at install time.
3. The decrypted database and the key never leave a session-scoped temporary
   directory, per §3.

**What integrity does and does not prove.** The `sha512` is what the registry
serves and what the package manager verifies. It proves the tarball matches the
registry record. It does **not** prove the code is benign — hence the isolated
directory and `--ignore-scripts`.

#### The key-free round-trip test, and what it will NOT prove

No real database, no device key, no credential. Using a freshly generated random
64-hex key:

1. Create a database with `cipher='sqlcipher'`, `legacy=4`, then
   `PRAGMA key = "x'<random 64 hex>'"`; write a few rows; close.
2. Re-open with the same key and confirm the rows read back.
3. Re-open with a **different** random key and confirm it fails rather than
   returning an empty database — the same fail-closed property the measurement
   tool already has.
4. Confirm the file is not readable as plain SQLite.

**The honest limit:** this proves the tool round-trips its *own* output and
handles raw keys. It does **not** prove it can read a file written by
expo-sqlite's vendored SQLCipher **4.7.0**, because establishing that needs
either a device-written file or a local build of that amalgamation, and this host
has no compiler. Cross-compatibility is *likely* — same cipher scheme, same
default parameters, `legacy=4` selecting the v4 format — but it stays **unproven
until there is a real encrypted file to open**, and that is gated on the handset.
I am not going to record "verified" for a property that only the device can
settle.

## 2. The key-assisted route, if it is needed

1. **Attach** to `com.muthoy.pos.dev` only. Never to `com.muthoy.pos`,
   `com.muthoy.pos.preview`, either `h3scratch` package, or any non-Muthoy app.
   The package is checked before attaching, not after.
2. **Read** the cached key hex at a breakpoint in the key accessor.
3. **Quiesce and copy.** The device database is in **WAL** mode, so the newest
   committed rows — which on this drill are exactly the step-10 workload and its
   queue rows — may live only in `-wal`. Either force-stop the app first so
   SQLite checkpoints and removes the sidecars, or copy `muthoy.enc.db`, `-wal`
   and `-shm` together and open them as a set. Record which. Copying the main
   file alone can silently understate `Q_at_risk`.
4. **Decrypt** into a controlled temporary directory.
5. **Measure** with the read-only tool in §4.
6. **Destroy** the key material and the decrypted copy (§3).

## 3. Security boundaries

Constraints on the operator, stated so a reviewer can check them:

- The key and the decrypted database exist **only** inside one session-scoped
  temporary directory outside the repository. Neither is ever written into the
  working tree.
- **Never** in: logs, terminal output quoted into a report, commit contents,
  commit messages, CI artifacts, screenshots, or any third-party service
  including review tools. The key is a 64-hex string; a reviewer must be able to
  grep the evidence pack for `[0-9a-f]{64}` and find nothing.
- The decrypted copy and the key are deleted when measurement finishes. The
  **measurements** are the artifact that survives; the plaintext database is not.
- Credentials are extracted from the **DEV test package only**. Preview,
  production and personal packages are out of bounds, and the guarded ADB helper
  already refuses input to any foreground package but the one named.
- The key belongs to a disposable synthetic shop (`B3-PARTB-SYNTH`) on the DEV
  project. It is still treated as a live credential.
- Nothing here modifies the device database. Every read is read-only, and the
  measurement tool opens SQLite with `readOnly: true`.

**What this route does NOT weaken.** It works only because the *test* APK is
deliberately debuggable. On the shipped release the same extraction needs a
rooted device, because `android:debuggable` is false and `allowBackup=false`.
The Keystore wrapping key stays non-exportable in both cases; what is readable
here is the plaintext the app itself derives, in a process we deliberately made
inspectable.

## 4. The measurement tool, and the proofs it has already passed

A host-side, read-only tool — **no application code, nothing on the handset**.
It runs against a plain SQLite file: the Part C fixture, or a decrypted copy.

Design rule, learned from the withdrawn bundle verifier that returned success
when it could not parse its input: **anything it cannot determine, it refuses.**
It emits measurements, never verdicts, and never prints a zero it did not
measure. It is staged outside the repository pending this review.

It captures, per `restore_drill.md` step 11: `sync_queue` total / pending /
failed / sent and the derived at-risk count; the full at-risk **row identity
set** `(table_name, row_id, op, status, operation_group_id, seq)`; operation
groups with `operation_expected_count` against rows present; `conflict_queue`
contents; and per-table row counts, row identities and value fingerprints across
sixteen tables.

Proved against the 21.87 MiB Part C fixture (97,105 rows, 56 tables):

| Property | Evidence |
|---|---|
| Measures the whole fixture | 16/16 census tables measured, 0 absent |
| **Repeatable** | two runs, byte-identical JSON apart from the timestamp; stable digest `03e3a14c6509f440…` both times |
| **Detects a value-only change** | one `expenses.amount` incremented by 1 → **only** the `expenses` fingerprint moved (`71a0f576…` → `53212dc8…`), row count unchanged at 53. This is the step-14(b) property the whole correction exists for |
| **Refuses a garbage/encrypted file** | exit 1, *"cannot read as plain SQLite (file is not a database)"* — it does **not** report an empty database |
| **Refuses a non-Muthoy database** | exit 1, *"sync_queue is absent"* |
| **Refuses a missing file** | exit 1 |
| Still measures a valid file | exit 0 |

Fingerprint construction, after the previous attempt was faulted for collisions:
fields are joined with `U+0000` and rows with `U+0001`, so no value containing
`|`, `=` or a newline can forge a boundary; `NULL` and `''` are distinguished
explicitly; rows are sorted so the digest does not depend on physical order.
Free-text and credential-shaped columns are excluded from the hashed input by
name.

## 5. Part C fixture

Generated into the isolated area: **22,933,504 bytes (21.87 MiB)**, exit 0 —
matching the documented 21.8 MiB. 56 tables, **97,105 rows**, plain SQLite
(opens with no key), WAL journal mode. That is the correct *input* state for
H-3's plain → SQLCipher copy-verify-swap.

**One compatibility gap was found; it is now FIXED** — see the applied record
below. It affected step 19 rather than step 18. As generated before 2026-11-07 the
fixture had **no `__drizzle_migrations` table** and `user_version = 0`:
`scripts/generate-history-fixture.mjs:82-87` applies each migration's SQL
directly without writing Drizzle's bookkeeping. But `apps/mobile/db/init.ts:88`
runs `migrate(db, migrations)` on every boot and skips only what
`__drizzle_migrations` records. So after loading the fixture the app would try to
re-apply every migration against a database that already has all 56 tables, and
fail on the first `CREATE TABLE`.

Consequence: step 18 (timing the encryption migration) is a file-level
copy-verify-swap and is unaffected. **Step 19 (SIGKILL mid-migration, then
relaunch) needs the app to boot afterwards, and it would not.**

### Scoped Rule 10 fix for the fixture's migration metadata — APPLIED 2026-11-07

**The mechanics, read from the installed migrator** rather than assumed
(`drizzle-orm/sqlite-core/dialect.cjs:665-690`):

```sql
CREATE TABLE IF NOT EXISTS __drizzle_migrations (
  id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric
)
```

It then reads **only the newest row** —
`SELECT id, hash, created_at … ORDER BY created_at DESC LIMIT 1` — and applies a
migration when `!lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis`.

Two consequences that make the fix smaller and more certain than it first looked:

- **`hash` is never consulted for the skip decision.** It is written, not read.
  `apps/mobile/db/migrations/migrations.js` carries no precomputed hashes
  either — it imports the journal and the raw `.sql` files.
- **One row suffices.** `created_at` set to the journal's maximum `when`
  (**`1791417600000`**, entry `0033_medicine_search_key`, 34 entries total) makes
  every migration skip.

**Proposed change** — `scripts/generate-history-fixture.mjs`, which already
reads `meta/_journal.json` at `:82`:

> **HISTORICAL — this is the plan as proposed on 2026-11-04, kept for the
> record. Two of its three steps were superseded by what was actually built;
> see "What was actually written" below for the current behaviour.**

1. Create `__drizzle_migrations` with the DDL above.
2. Insert **one** row: `created_at = max(entry.when)` from the journal, and
   `hash` set to the sha256 of that migration's `.sql` content — a real,
   derivable value rather than a placeholder, so nothing in the fixture is
   fabricated.
   **SUPERSEDED 2026-11-07:** `hash` is the **empty string**, because that is
   what the app itself writes (`expo-sqlite/migrator.cjs:42`). The sha256 was
   valid and never read, but made the fixture unlike every real device.
3. Add a test asserting the generated fixture's `max(created_at)` equals the
   journal's `max(when)`. **This is the part that matters:** without it, adding
   migration `0034` would silently re-break step 19, exactly as today.
   **SUPERSEDED 2026-11-07:** that test was necessary but not sufficient — it
   regenerates the fixture first, so it only proves the *generator* tracks the
   journal, never that a stale fixture *file* is rejected. The rejection now
   lives in `validateHistoryFixture`.

**What this deliberately does NOT claim.** One row is not a faithful
reconstruction of a real device's migration history — a real device has 34 rows
with real hashes and real timestamps. It is sufficient for the *skip* decision
and nothing more. If a future drill needs the fixture to look like a genuine
upgrade history, that is a different change. `apps/mobile/db/encryptionVerify.ts:175`
compares `__drizzle_migrations` rows and hashes across the encryption copy, which
stays self-consistent either way because both sides are the same file.

**Why Rule 10 applied:** it changes a tool that produces database input for a
money-and-stock acceptance drill. The founder granted a scoped, generator-only
approval, and this is what was then written.

#### What was actually written, and the evidence it works

**Revised 2026-11-07 after an independent Codex review returned REVISE with
three findings, all of which were real.** What that review caught, and what
changed, is in the next sub-section; this describes the result.

`scripts/generate-history-fixture.mjs` — three new private functions,
`recordMigrationMetadata` (called at the end of `applyMigrations`),
`newestJournalEntry` (exported, so its refusals are testable) and
`migrationMetadataFailures` (wired into `validateHistoryFixture`). No change to
production migrations, hosted databases, sync or money logic. The DDL and the
insert's column list are copied verbatim from the migrator, so its own
`CREATE TABLE IF NOT EXISTS` stays a no-op and the row looks like a device's.

The row written: `{ id: null, hash: '', created_at: 1791417600000 }`. **`hash` is
the empty string because that is what the app itself writes** —
`drizzle-orm/expo-sqlite/migrator.cjs:42` builds every migration with
`hash: ""`. The first revision stored a sha256 of the migration SQL here, which
was valid and never read, but made the fixture unlike every real device for no
benefit.

**52/52 pass**, `vitest` exit 0; `tsc --noEmit` exit 0 in `apps/mobile`; the two
encryption suites that touch this table pass 36/36. Full fixture regenerates:
97,106 rows / 21.88 MiB / 34 migrations / 19 invariants.

A passing test proves nothing on its own, so every guard was checked against a
mutation that should kill it — **including the wrong-but-passing implementation
the reviewer found**:

| Mutation of the generator | Result |
|---|---|
| `id SERIAL PRIMARY KEY **DEFAULT 0**` — the reviewer's case, which passed all 47 tests before this revision | **killed**: the real-migrator test fails on the next insert |
| metadata check removed from `validateHistoryFixture` | **killed**: 3 stale-artifact tests fail |
| duplicate-timestamp guard disabled | **killed**: the ambiguous-journal test fails |
| `hash` set to a sha256 instead of `''` | **killed**: the hash-fidelity test fails |
| `recordMigrationMetadata` call removed entirely | **killed harder**: the generator now REFUSES to emit the fixture, and `vitest` exits **1** |
| restored | 52 pass, exit 0 |

The last row's exit code was measured without a pipeline. An earlier attempt
read `$?` after piping vitest through `sed` and so reported the exit status of
`sed` — the same mistake that previously made a failing Gradle build look like a
success.

#### What the independent review caught

Three findings, each reproduced by the reviewer, each a genuine gap:

1. **Stale-metadata rejection was not actually tested.** Every test regenerated
   the fixture first, so they all checked *fresh* output. The real risk is a
   fixture **file** on disk that goes stale when a migration lands later, and
   `validateHistoryFixture` — the function the drill trusts to say "this file is
   usable" — did not look at migration metadata at all. **Fixed** by making
   `validateHistoryFixture` compare the artifact's recorded `created_at` against
   the journal as it exists now, so a stale file fails validation instead of
   failing at boot. It also rejects a missing table and a non-integer
   `created_at` (text sorts above integers in the migrator's `ORDER BY`, which
   could hide the real newest row and make `Number()` yield `NaN`).
2. **The test and the generator shared an assumption.** Both picked the newest
   entry with the same reduction, so independent *execution* was not independent
   *reasoning*: with two journal entries sharing a `when`, the reduction keeps
   the older one, the strict `<` predicate skips the newer migration, and the
   fixture silently lacks its schema — with all assertions still passing.
   **Fixed** two ways: the generator now refuses a journal with duplicate or
   non-safe-integer `when` values, and the test's expectation no longer depends
   on how the maximum is chosen (it asserts the recorded value is ≥ every entry
   and equal to one of them).
3. **The tests re-implemented the migrator instead of running it.** They
   reproduced the predicate, which proves the reproduction. Changing the DDL to
   `id SERIAL PRIMARY KEY DEFAULT 0` passed all 47 tests and then broke a real
   upgrade with `UNIQUE constraint failed: __drizzle_migrations.id`. **Fixed** by
   running drizzle's actual `migrate()` — imported from the same module the app
   boots through (`apps/mobile/db/init.ts:1`) — against a copy of the generated
   fixture: it must apply nothing and leave the schema identical, and a
   synthetic newer migration must still apply and insert its own row.

The reviewer also confirmed the one-row scheme itself matches the installed
contract, that the NULL `id` is safe (verified independently here: SQLite
accepts multiple NULLs in that non-rowid PRIMARY KEY, and `ORDER BY id` survives
a logical copy — tested with 34 NULL-id rows), and that nothing in the change
touches production migrations, hosted operations, sync or money.

**Measured effect on the fixture.** Default run after the change: **97,106 rows,
22,941,696 bytes (21.88 MiB), 57 tables** (27 populated), 34 migrations applied,
19 invariants pass. Before the change: 97,105 rows / 22,933,504 bytes / 56
tables. The delta is exactly the one bookkeeping row and its table.

The row itself: `created_at = 1791417600000` (the journal maximum, entry
`0033_medicine_search_key`), `hash = ''` — the empty string the app itself
writes (`expo-sqlite/migrator.cjs:42`) — and `id = NULL`. The NULL id is not a
defect: `id SERIAL PRIMARY KEY` is not an INTEGER-PRIMARY-KEY rowid alias in
SQLite, so it does not autoincrement, and the migrator's own insert names only
`("hash", "created_at")` — a real device's rows are written the same way.
SQLite permits NULL in a non-rowid PRIMARY KEY, and NULLs are distinct in a
UNIQUE index, which is why real devices
accumulate many such rows without conflict.

**One consequence worth stating.** `apps/mobile/db/encryptionVerify.ts`
excludes only `sqlite_*` and FTS shadow tables (`isInternalTable`, `:43-45`), so
`__drizzle_migrations` is now inside H-3's copy-verify comparison. That is
strictly more verification, not less, and it is deterministic: one row, ordered
by its primary key, with both sides being the same copied file.

**Still not claimed.** This is one row, not a 34-row upgrade history, and the
fixture has only ever been proven to *generate*. Whether a device boots from it
is step 19, and step 19 needs the handset.

## 6. What is NOT proven, and why

**The handset is physically detached.** `adb devices` lists nothing and Windows
reports no Samsung device, so none of the following has been executed:

- whether the **Hermes** inspector is reachable on a release build — now the
  only remaining key-free candidate, since Database Inspector and the on-device
  `sqlite3` are ruled out (§1);
- whether the key-assisted route works end to end;
- `run-as` availability on the new package;
- the APK's startup behaviour and environment resolution;
- any Part B prerequisite that needs login, sync or a measurement.

**There is also no SQLCipher tooling on this host.** No `sqlcipher` CLI, no
`sqlcipher3` / `pysqlcipher3`, no `better-sqlite3-multiple-ciphers`. Two
candidates are now identified with their licence, version and integrity hash in
§1, together with the exact SQLCipher 4.7.0 raw-key requirement they have to
meet and the key-free round-trip test that must pass before either touches
anything real. **Nothing is installed, and installation is not authorized** —
that request is what §1 ends with. The measurement tool itself needs none of it
— it reads plain SQLite — which is why §4's proofs stand regardless.

So §4 proves the measurement is correct and repeatable; §2 remains an
**untested procedure**. Those are different claims, and this document does not
merge them.
