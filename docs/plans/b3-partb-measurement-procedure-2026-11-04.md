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

**Candidates, with registry metadata read without installing anything**
(`npm view`, which fetches metadata only):

| Package | Version | License | Integrity (npm `dist.integrity`) |
|---|---|---|---|
| **`@journeyapps/sqlcipher`** | 6.0.0 | **BSD-3-Clause** | `sha512-YmWSQIR4cnv+5L38lYJoS/dIF/+bEZBaACATbeTyq4XKjMHcxdIlFnElBLiIqa9rwseOIimIYjudgOOCovud3Q==` |
| `better-sqlite3-multiple-ciphers` | 13.0.3 | **MIT** | `sha512-UYabM82r1J84TLWc/SszoHs6XopWpl/2HCg3Nui1JUaFXg/VLswzkPowYiRhK/4CftI8dgtikwyZQecMldrGxQ==` |

`node-sqlite3-wasm` was considered and **rejected**: it is plain SQLite with no
SQLCipher support. SQLCipher itself (the `sqlcipher` CLI) is BSD-style licensed
and permits commercial use provided the copyright notice and disclaimer are
reproduced; 4.7.0 was released 2025-03-25. Note the upstream licence pages
disagree on the copyright year (2008-2023 vs 2008-2024), so the `LICENSE` file
of whatever is actually fetched is the authority.

**Preference, and why.** `@journeyapps/sqlcipher` links *real* SQLCipher, so the
format and the raw-key behaviour are correct by construction rather than by
emulation — which matters when the whole point is to read a file the app wrote.
Its cost is a native build on Windows. `better-sqlite3-multiple-ciphers` is
lighter but reimplements the scheme via SQLite3MultipleCiphers, whose official
pragma documentation does confirm the `x'...'` raw form and states that only the
sqleet and SQLCipher AES-256 schemes support raw keys, with the first 32 bytes
as key and the next 16 as salt — our 64-hex value supplies the key and leaves
SQLCipher to take the salt from the file header, as on device.

**What integrity does and does not prove.** The `sha512` above is what the
registry serves and what the package manager verifies on install, and the
lockfile pins it. That proves the tarball matches the registry record. It does
**not** prove the code is benign, so if approved: install into an isolated
directory outside the repository, never into `apps/mobile`.

**The one property still unverified, and how it gets verified.** Neither
candidate's raw-key + SQLCipher-4 behaviour has been tested against a real file,
because that needs the tool installed. It can be settled with **no device and no
real key**: create a throwaway SQLCipher-4 database with a known random 64-hex
raw key, write a handful of rows, close it, re-open it with the tool, and confirm
the rows read back and that a wrong key fails. Only after that round-trip passes
should the tool ever be pointed at anything real. That test is the acceptance
condition for the install request in §6.

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

1. Create `__drizzle_migrations` with the DDL above.
2. Insert **one** row: `created_at = max(entry.when)` from the journal, and
   `hash` set to the sha256 of that migration's `.sql` content — a real,
   derivable value rather than a placeholder, so nothing in the fixture is
   fabricated.
3. Add a test asserting the generated fixture's `max(created_at)` equals the
   journal's `max(when)`. **This is the part that matters:** without it, adding
   migration `0034` would silently re-break step 19, exactly as today.

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

`scripts/generate-history-fixture.mjs` — one new private function
`recordMigrationMetadata(db, journal)`, called at the end of `applyMigrations`.
`+60` lines, no change to either export (`INVARIANTS`,
`validateHistoryFixture`), no change to production migrations, hosted
databases, sync or money logic. The DDL is copied verbatim from the migrator so
its own `CREATE TABLE IF NOT EXISTS` stays a no-op.

Five focused tests in `apps/mobile/tests/history-fixture.test.ts`. **47/47 pass**
(`npx vitest run apps/mobile/tests/history-fixture.test.ts`), `tsc --noEmit`
clean in `apps/mobile`.

A passing test proves nothing on its own — the withdrawn bundle verifier passed
while unable to read its input — so each test was checked against a mutation
that should kill it:

| Mutation of the generator | Tests failed |
|---|---|
| `recordMigrationMetadata` call removed entirely | **5** of 47 |
| `created_at` pinned to a stale constant (the "forgot to regenerate" case) | **3** of 47 |
| `hash` replaced with a placeholder string | **1** of 47 |
| restored | **0** — 47 pass |

The second row is the one the founder asked for: *stale metadata rejection* is
detected, not assumed. The fourth confirms the suite is green only with the fix
present.

**Measured effect on the fixture.** Default run after the change: **97,106 rows,
22,941,696 bytes (21.88 MiB), 57 tables** (27 populated), 34 migrations applied,
19 invariants pass. Before the change: 97,105 rows / 22,933,504 bytes / 56
tables. The delta is exactly the one bookkeeping row and its table.

The row itself: `created_at = 1791417600000` (the journal maximum, entry
`0033_medicine_search_key`), `hash` = the 64-hex sha256 of that migration's
`.sql`, and `id = NULL`. The NULL id is not a defect: `id SERIAL PRIMARY KEY` is
not an INTEGER-PRIMARY-KEY rowid alias in SQLite, so it does not autoincrement,
and the migrator's own insert names only `("hash", "created_at")` — a real
device's rows are written the same way. SQLite permits NULL in a non-rowid
PRIMARY KEY, and NULLs are distinct in a UNIQUE index, which is why real devices
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
