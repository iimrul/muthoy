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

The earlier finding that this host has **no SQLCipher tooling** stands. The same
sources name the usable options, and the choice matters because a GUI cannot be
scripted into repeatable evidence:

- **`sqlcipher` CLI** — scriptable, the natural fit as the measurement tool's
  input stage; not installed.
- **DB Browser for SQLite** — documented as supporting SQLCipher, but a GUI;
  acceptable for a one-off look, not for repeatable evidence.
- **A language binding** (`better-sqlite3-multiple-ciphers`, `sqlcipher3`) —
  scriptable, and would make decrypt-and-measure a single command.

Obtaining one is a dependency decision, listed in §6 rather than taken
unilaterally.

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

**One compatibility gap found, and it affects step 19 rather than step 18.** The
fixture has **no `__drizzle_migrations` table** and `user_version = 0`:
`scripts/generate-history-fixture.mjs:82-87` applies each migration's SQL
directly without writing Drizzle's bookkeeping. But `apps/mobile/db/init.ts:88`
runs `migrate(db, migrations)` on every boot and skips only what
`__drizzle_migrations` records. So after loading the fixture the app would try to
re-apply every migration against a database that already has all 56 tables, and
fail on the first `CREATE TABLE`.

Consequence: step 18 (timing the encryption migration) is a file-level
copy-verify-swap and is unaffected. **Step 19 (SIGKILL mid-migration, then
relaunch) needs the app to boot afterwards, and it would not.**

### Scoped Rule 10 plan for the fixture's migration metadata — PROPOSAL, not applied

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

**Why Rule 10 applies:** it changes a tool that produces database input for a
money-and-stock acceptance drill. Approval is requested before writing it.

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
`sqlcipher3` / `pysqlcipher3`, no `better-sqlite3-multiple-ciphers`. The
decryption step of §2 therefore cannot run until such a tool is obtained, and
obtaining one is a dependency decision rather than something to do silently. The
measurement tool itself needs none of it — it reads plain SQLite — which is why
§4's proofs stand regardless.

So §4 proves the measurement is correct and repeatable; §2 remains an
**untested procedure**. Those are different claims, and this document does not
merge them.
