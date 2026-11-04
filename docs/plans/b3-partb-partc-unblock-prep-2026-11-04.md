# H-11 Part B/C unblock preparation

Baseline `70e60b8`. Written 2026-11-04. **Read-only investigation and design.**
Nothing was built, installed, prebuilt, cleared, or sent. No OTP. No device
state changed — every device interaction was a read (`adb devices`,
`pm list packages`). The Preview installation and `com.muthoy.pos` are
untouched.

Part B's previous run is **NOT PASS** and nothing here presents its partial
evidence as acceptance.

---

## 0. The short version

| Question | Answer |
|---|---|
| Can a compliant build be made at zero cost? | **Yes** — locally, no EAS, no new build profile |
| Application ID | **`com.muthoy.pos.dev`** (already in the frozen policy) |
| EAS Free quota | **Available** — 2 of ~30 used in November; irrelevant to the recommendation |
| Does the build need an environment-policy change? | **No** |
| Can `sync_queue` counts be read with `run-as` alone? | **No — structurally impossible.** This is the real blocker |
| Is the drill's own step 11/14 arithmetic sound? | **No.** Step 14 is unsatisfiable as written |
| Approvals needed | **Three**, listed in §5 |

The headline finding is not about the build. It is that **steps 11 and 14 of
`restore_drill.md` cannot both be satisfied as written**, in any reading,
because they compare two different units. That is a defect in the acceptance
contract, and it is also the thing my previous run got wrong — I substituted a
number rather than reporting that the specified one was ill-defined.

---

## 1. The acceptance contract: steps 11 and 14

### 1.1 What the queue actually holds

Verified in source, not inferred:

| Fact | Evidence |
|---|---|
| `status` is exactly `pending \| sent \| failed` | `db/schema.ts:1385-1387` |
| A successful push sets `sent` and **deletes nothing** | `db/sync-helpers.ts:1804-1809` |
| A permanent failure sets `failed` | `db/sync-helpers.ts:1811-1816` |
| A transient failure re-queues as `pending`, or `failed` at `attempts >= 8` | `db/sync-helpers.ts:1818-1839` |
| Only `pending` rows are ever claimed for push | `db/sync-helpers.ts:1797` |
| **Nothing purges the queue.** The one production delete is the conflict `take_remote` path, which removes only `pending`/`failed` rows superseded by a remote decision | `db/conflicts.ts:362-383`; every other `DELETE FROM sync_queue` in the tree is test setup |
| `recordChange` inserts **exactly one row per call** | `db/sync-helpers.ts:622-637` |

So the founder's premise is confirmed: **`sent` rows accumulate for the life of
the installation, and a total queue count is not lost unsynced data.** The
quantity that a device restore cannot return is `pending + failed`.

### 1.2 Why step 14 is unsatisfiable as written

> Step 11: "Read the `sync_queue` row count."
> Step 14: "Compare per-table row counts against step 10's device state. The
> difference must equal exactly the step 11 outbox count — no more."

Step 11's number counts **queue rows** (operations). Step 14's number is a
difference of **business-table rows**. These are not the same unit and cannot
be equal except by coincidence. Two independent reasons:

**One business event produces many queue rows.** `db/sales.ts:685-692` computes
the group size directly:

```
expectedCount = 1                                  // the sales row
              + itemDrafts.length * 2              // sale_items + movement
              + (creditAmount > 0 ? 2 : 0)
              + (newCustomer ? 1 : 0)
              + (attachment ? 1 : 0)
              + drawerOperationCount               // 1 if today's drawer row exists, else 2
              + 1                                  // audit_logs
```

A one-item cash sale is therefore **5 or 6 queue rows** against **4 or 5**
inserted business rows. A one-item credit sale is 6 queue rows. The step-10
workload as specified — a cash sale, a credit sale, a stock adjustment and an
expense — would produce roughly 15-20 queue rows for roughly 12-14 business
rows. Neither number is derivable from the other without the per-row breakdown.

**`update` and `delete` operations change no row count at all.** A lost
`update` queue row leaves every per-table count identical while a *value* is
wrong. That is precisely the failure Part A was rewritten to catch — "The drill
proves VALUES return, not that row counts match" — and step 14 as written
cannot see it.

A third, subtler point: **`sent` is not proof the server kept the value.**
`db/sync-helpers.ts:828-845` documents the provable silent-drop case —
`sync_apply_row`'s predicate is a strict `<`, so an equal `updated_at` wrote
nothing while the function still answered `applied`. Such a row is recorded in
`conflict_queue`, so it is detectable, but a drill that only counts rows would
miss it.

### 1.3 Proposed interpretation — for approval, not yet applied

`restore_drill.md` is a signed acceptance contract and I have not edited it.
This is the proposal.

**Step 11 becomes five numbers and one breakdown, not one number:**

| Symbol | Definition | Meaning |
|---|---|---|
| `Q_pending` | `count(*) where status='pending'` | queued, never sent |
| `Q_failed` | `count(*) where status='failed'` | gave up, never sent |
| `Q_sent` | `count(*) where status='sent'` | already on the server; **not loss** |
| **`Q_lost`** | **`Q_pending + Q_failed`** | **the number Part B exists to measure** |
| `G_lost` | `count(distinct operation_group_id)` over those rows | business events affected |

plus the breakdown of the `Q_lost` rows by `(table_name, op)`, which is what
makes step 14 checkable. The query is one line and already appears verbatim in
`db/push-replay.sqlite.test.ts:189`, so the shape is proven:
`SELECT status, COUNT(*) FROM sync_queue WHERE shop_id = ? GROUP BY status`.

**Step 14 becomes three checks with matched units:**

- **(a) Row counts.** For each table, `after_recovery − before_clear` must equal
  exactly `−(count of Q_lost rows for that table with op='insert')`. Updates and
  deletes are excluded because they change no count.
- **(b) Values.** Every row NOT named by a `Q_lost` row must match the server's
  value, per `restore_baseline.sql`'s digests. A row named by a lost `update`
  must equal the **server's** value — the local edit is gone by design, and
  that is a pass, not a failure.
- **(c) Operation-group integrity.** No `operation_group_id` may be partially
  applied server-side. `sync/push.ts:144-165` already enforces
  `operationExpectedCount`, so a half-landed group is a defect to report, not
  acceptable loss. `conflict_queue` must also be empty, or every row in it
  accounted for (§1.2).

**What this preserves:** step 11's original sentence — "everything in it is
what a device restore cannot return" — is correct about `pending` and `failed`
and wrong only about `sent`. The historical spec is not being weakened; it is
being made arithmetically possible to satisfy.

**Approval needed:** editing `restore_drill.md` steps 11 and 14, and its result
table rows "Rows lost on device restore". No code change.

---

## 2. The build design

### 2.1 Application ID: `com.muthoy.pos.dev`

This is forced, not chosen. `config/environmentPolicy.js:29` hard-refuses any
variant outside `{development, preview, production}`, and
`native/environmentIdentity.ts:33` compares `expo-application`'s **real native
applicationId** against the selected policy's `nativeApplicationId`, refusing
startup with `native-identity-invalid` on a mismatch.

Consequences:

- A **new** application ID (`…drill`, `…partb`) would require editing the frozen
  `ENVIRONMENT_POLICIES`, the variant allowlist, and `validateBuildProfile` —
  environment-policy code, i.e. rule 10, for no benefit.
- The existing local native project's `applicationId 'com.muthoy.pos.h3scratch'`
  (`android/app/build.gradle:96`) **is in no policy**, so that package would
  refuse startup. This is almost certainly why the H-3 scratch APK was only ever
  used for ciphertext inspection and never run as an app.
- `development` already maps to `com.muthoy.pos.dev`, the DEV project
  `btfprhticjgeihcngpif`, and the same pinned anon-key fingerprint as Preview.
  **Zero policy change.**

Isolation confirmed: `com.muthoy.pos.dev` is **not installed** on the device
(`pm list packages` shows `com.muthoy.pos`, `.preview`, `.h3scratch`,
`.h3scratch2` only). It has its own data directory and cannot reach Preview's.

Credentials verified read-only, without printing them: `apps/mobile/.env`
supplies `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`; the URL
equals `https://btfprhticjgeihcngpif.supabase.co` exactly, and the key's sha256
is `8c231a25…a870ec7`, **matching the pinned `DEV_PUBLIC_KEY_SHA256`** byte for
byte, with `role=anon`. So `verifyEnvironmentIdentity()` will pass. The file is
gitignored.

### 2.2 Build shape: local Gradle `assembleRelease`, debuggable

Not EAS, and not a development client. The **release** variant is correct
precisely because it is the one that is normally non-debuggable:

| Requirement | How release satisfies it |
|---|---|
| Runs without Metro | release embeds the bundle |
| No dev launcher | `expo-dev-launcher` is debug-only, so release boots straight to `MainActivity` |
| `run-as` works | `debuggable true` on the release build type |
| `allowBackup` not weakened | the `withAndroidBackupProtection` plugin still applies |
| Representative for Part C | Hermes **bytecode**, `minifyEnabled` default `false` — same as the EAS `internal` profile |

**This is not theory.** `android/app/build.gradle:112-135` already carries that
exact configuration from H-3, and the artifact it produced is still on disk at
`android/app/build/outputs/apk/release/app-release.apk`, dated 2026-09-17 —
H-3's sign-off date. Inspected with `aapt2`:

```
package: name='com.muthoy.pos.h3scratch'  versionCode='1'  targetSdkVersion:'36'
android:debuggable  = true
android:allowBackup = false            <- protection plugin survived
launchable-activity: com.muthoy.pos.MainActivity
assets/index.android.bundle            6,494,652 bytes
  -> magic c6 1f bc 03 c1 03 19 1f    = Hermes bytecode
lib/arm64-v8a/libexpo-sqlite.so        (SQLCipher)
DevLauncher entries: 0
```

So every requirement in the assignment is already demonstrated on a real
artifact built on this machine. What that APK cannot do is **run**, because its
package is in no policy (§2.1).

### 2.3 Build provenance — and why the fingerprint is the wrong tool

The accepted Preview artifact is EAS build `47c9f0aa`, commit
`9ed99b4fc457d96458dea2d9ac355b5008a58e38`, profile `internal`, finished
2026-11-01, EAS fingerprint `9304bc0c…`.

`eas fingerprint:compare` reports the local directory differs. **That comparison
is not sound evidence here**, and I am not going to present it as such: two
different tools computed two different fingerprints for the *same* working tree
—

- `expo-updates@58.0.21` (fetched by `npx`; the project is SDK 57) → `c84897dc…`
- `eas-cli@27.4.1` → `0fa3a9ad…`

— so the hash is not comparable across tool versions, and the differences it
lists are dominated by `node_modules` hoisting churn (`chalk`, `ansi-styles`)
and by the local `android/` directory existing at all, which flips the project
from managed to bare.

**Git settles it properly.** Across the 11 commits `9ed99b4..70e60b8`:

```
git diff --stat 9ed99b4 HEAD -- apps/mobile/package.json apps/mobile/app.json \
  apps/mobile/app.config.js apps/mobile/plugins apps/mobile/modules \
  apps/mobile/config/environmentPolicy.js apps/mobile/.gitignore \
  apps/mobile/assets pnpm-lock.yaml package.json
  -> (empty)
```

**Every native-relevant source path is byte-identical.** And every module Part B
or Part C measures is unchanged:

| Module | 9ed99b4 → HEAD |
|---|---|
| `db/encryptionMigration.ts` | unchanged |
| `db/databaseRecovery.ts` | unchanged |
| `sync/databaseRecovery.ts` | unchanged |
| `db/sync-helpers.ts` | unchanged |
| `db/schema.ts` | unchanged |
| `sync/push.ts`, `sync/pull.ts` | unchanged |

The whole JS delta is 10 UI/i18n files (`reports/`, `expenses/`, `staff/`,
`end-of-day`, `settings`, `i18n/`) plus 2 tests. So a build at HEAD is
native-identical to the accepted artifact and identical in every code path
either Part measures.

### 2.4 Part C: executable is not representative, and I will say which

A debuggable release differs from the shipping release in three ways, and all
three must be recorded with any step-18 number:

1. `android:debuggable=true` — ART disables some optimisations for debuggable
   processes. SQLCipher encryption is mostly native C and file I/O, so the
   effect should be small, but "should be" is not a measurement.
2. Debug signing key (no functional effect on timing).
3. The 10-file JS delta — none of it on the migration path.

**Recommendation:** time step 18 on this build, then flip `debuggable` to
`false` in the same build.gradle and time it again. That is a one-line change
to a gitignored file and gives the delta directly, rather than arguing about it.
H-3 already ran a `debuggable=false` comparison for a different purpose
(`android/app/build.gradle:125-128`), so the manoeuvre is known to work. If the
two numbers straddle a decision boundary, the non-debuggable number governs.

### 2.5 Toolchain — one real gotcha

`java` on PATH is **JDK 1.8.0_471**, which cannot build React Native 0.86.
The usable JDK is Android Studio's JBR:

```
/c/Program Files/Android/Android Studio/jbr   ->  OpenJDK 25.0.2
```

`JAVA_HOME` must be set to it explicitly. Also present: Gradle 9.3.1 (wrapper),
build-tools 35/36, platforms android-36/37, SDK at
`C:/Users/Imrul/AppData/Local/Android/Sdk`, `reactNativeArchitectures=arm64-v8a`
(single ABI, so the build is much faster than EAS's).

### 2.6 The exact sequence, when approved

1. Back up the H-3 native config — **already done**, at
   `C:\Users\Imrul\AppData\Local\Temp\claude\05cdc886abc1eb43\e3b81de0-5557-41d7-9c41-7f52ae057fbf\scratchpad\h3scratch-native-backup\`
   (`app-build.gradle`, `root-build.gradle`, `gradle.properties`,
   `settings.gradle`, `local.properties`).
2. `APP_VARIANT=development npx expo prebuild --clean --platform android`
   → regenerates `android/` at HEAD with `applicationId com.muthoy.pos.dev`.
3. Re-apply **one** native edit: `debuggable true` in the release build type.
   This is the only hand change, and it is the one listed in §5 for approval.
4. `JAVA_HOME=<JBR> ./gradlew :app:assembleRelease` with `APP_VARIANT=development`.
5. Verify the APK before it touches the device: package `com.muthoy.pos.dev`,
   `debuggable=true`, `allowBackup=false`, `assets/index.android.bundle`
   present and Hermes, 0 DevLauncher entries, `libexpo-sqlite.so` present.
6. `adb install` — a new package; nothing is cleared, nothing uninstalled.
7. Launch with no Metro running; confirm it reaches the login screen rather than
   an environment refusal. **This is the step with real residual risk:** nothing
   has ever run as `com.muthoy.pos.dev`, so the identity guard is unexercised
   for that package. §2.1 argues it will pass; only the run proves it.
8. `adb shell run-as com.muthoy.pos.dev ls files/SQLite` — confirm `run-as`.

**Step 2 was attempted and refused by this session's sandbox** (it deletes a
directory). That refusal is consistent with the founder's own instruction not to
make unreviewed changes to native code, so it is recorded as an approval gate
rather than worked around.

---

## 3. Cost

**EAS Free quota is available and the recommendation does not need it.**

Account `imrulkaesh`, project `@imrulkaesh/muthoy-pos`. Full build history is
**20 builds**: 15 in 2026-08, 3 in 2026-10, **2 in 2026-11** (9 finished, 11
errored). Expo's Free plan provides on the order of 30 low-priority builds per
month, resetting monthly, **with no overage charges on Free**, and since a 2024
change builds that fail early are not counted. So an EAS build would also be
zero marginal cost.

The founder's point is confirmed: **a new profile does not imply a charge.**

EAS is still not the recommendation, for three non-cost reasons:

1. `validateBuildProfile` (`config/environmentPolicy.js:72-82`) admits only
   `development`, `internal`, `production`, `production-smoke`. A new profile is
   an environment-policy change — rule 10 — to buy something a local build gives
   free.
2. The `development` profile sets `developmentClient: true`, i.e. the
   Metro-dependent client the assignment rules out; and EAS cannot produce a
   *debuggable release* without a profile change.
3. Observed EAS wall-clock on this account is **3h20m** per build (`9ed99b4`:
   20:10 → 23:30). A local arm64-only build is minutes.

**No paid build is proposed. No payment approval is sought.**

---

## 4. Instrumentation — the actual blocker

### 4.1 No shell route exists, by design

`modules/muthoy-db-key/android/.../MuthoyDbKeyModule.kt` states it, and the code
matches: the 32-byte SQLCipher key is persisted **only as ciphertext**, wrapped
by an AES-256-GCM key generated inside AndroidKeyStore that **cannot be
exported**. The wrapped blob and IV sit in app-private SharedPreferences and are
"useless on their own".

So with `run-as` on a debuggable build one can read the wrapped blob and the
`.db` file, and **neither can be decrypted off-device**. There is no
`sqlite3`/`sqlcipher` route, no `adb backup` route (`allowBackup=false`, and not
to be weakened). The key has `setUserAuthenticationRequired(false)`, so no
biometric is involved — it is simply hardware-bound to the app's uid.

**Therefore the queue census must execute inside the app process.** `run-as`
remains necessary — to read the census *output* — but is not sufficient.

This also means my previous session's framing was wrong in a way worth naming:
I described Part B as blocked on "a debuggable build". A debuggable build is
necessary and not sufficient; the missing piece is in-app instrumentation.

### 4.2 `__DEV__` cannot be the gate

In a release build `__DEV__` is false — `dev/README.md` states it directly ("a
release build emits no timing lines"). So the existing `dev/` modules are inert
in exactly the build Part B needs, and a `__DEV__`-gated census would emit
nothing.

`dev/README.md` is also explicit that this is not a boundary anyway: *"A
`__DEV__` guard is not a production boundary. Metro does not tree-shake."*

### 4.3 Proposed gate: the signed native application id

Gate the census on `appVariant === 'development'`, read through the existing
`readEnvironmentConfiguration()`. This is a **stronger** boundary than
`__DEV__`, and it is the repo's own mechanism:

- `ENVIRONMENT_POLICIES` is frozen and `selectEnvironment` refuses anything else.
- `verifyEnvironmentIdentity()` cross-checks the **real native applicationId**.
- The production package `com.muthoy.pos` maps only to variant `production`. A
  production build therefore **cannot** report `development` — not "is unlikely
  to", cannot.

Against `dev/README.md`'s rule that anything which can grant access is deleted
rather than guarded: a census **grants nothing**. It does not authenticate,
authorize, register, link a device, or route. It emits counts only — never a
value, id, phone, PIN, token, or customer identifier.

### 4.4 Shape, output, and the folder pin

- **Lives in** `apps/mobile/dev/queueCensus.ts` (+ its test). `dev/` is pinned
  to an exact five-filename list by
  `tests/dev-production-safety.test.ts:164-172`, so adding a file **must** edit
  that assertion. That is the "argued for in review" path the README prescribes,
  and it is one of the approvals in §5.
- **Emits** a JSON line to app-private storage, read back with `run-as`. Not
  logcat — a log is the one place a stray value could leak, and `run-as` is
  already required.
- **Fields only:** `capturedAt`, `shopId` (already known), the five counts from
  §1.3, the `(table_name, op, status)` breakdown, `operationGroupId` counts, and
  per-table business row counts. No payloads. The queue's `payload` column holds
  full business rows and must never be read by this module.
- **Trigger:** written automatically on app foreground, appended. This adds **no
  new trigger surface** — no receiver, no deep link, no screen, no route — and
  gives both snapshots the drill needs (after the offline work; after recovery).

### 4.5 How the instrumentation is itself verified

A census that lies is worse than none — the same objection that got H-9's
capture executor deleted. So, before it is trusted:

1. **Unit test against a known fixture.** Build a SQLite database with a
   hand-placed mix of `pending`/`sent`/`failed` rows and assert the census
   reproduces each count. The in-process SQLite test harness already exists and
   `db/push-replay.sqlite.test.ts:189` already runs the identical GROUP BY.
2. **Variant-isolation test.** Assert the census returns empty for `preview` and
   `production`.
3. **No-value test.** Assert the emitted object's keys are a fixed allowlist and
   that `payload` appears nowhere in the module.
4. **Pin update** in `dev-production-safety.test.ts`, deliberately, not silently.
5. **On-device cross-check.** The census's `sales` count must equal what the
   Sales screen shows, and its `sent` count must reconcile against the server's
   row count for a synced table. An instrument that disagrees with the UI is
   wrong until proven otherwise.

Only after 1-5 pass does any Part B number derived from it mean anything.

---

## 5. What needs founder approval

Three items. Each is scoped, and none is started.

| # | Change | Why it needs approval | Risk if wrong |
|---|---|---|---|
| **A1** | `apps/mobile/dev/queueCensus.ts` + test, gated on `appVariant === 'development'`, plus the `dev/` pin update | New file in a folder deliberately pinned against new files; touches the DEV/production boundary | A guard that fails open would ship a diagnostic reader in the store build. §4.3/§4.5 is the argument it does not |
| **A2** | `restore_drill.md` steps 11, 14 and the result table | Edits a signed acceptance contract | Weakening the drill. §1.3 argues it only makes it satisfiable |
| **A3** | `debuggable true` on the release build type of the regenerated `android/` (gitignored, local, never shipped), and the `prebuild --clean` that precedes it | Security-relevant native change; the sandbox already refused the prebuild | A debuggable build of a DEV-only package on the founder's own handset |

**Not needed, and not asked for:** a new EAS profile, a new environment-policy
entry, a new application ID, a paid build, any OTP, any app-data clear, any
service-role grant widening, any migration, any PROD or H-9 work.

**Deliberately deferred to a separate request:** the app-data clear. §6 lists the
prerequisites that must be demonstrated first, and four of the eight cannot be
demonstrated until A1 and A3 land.

---

## 6. Prerequisite state for the next clear approval

The founder's eight prerequisites, honestly scored:

| # | Prerequisite | State |
|---|---|---|
| 1 | Build provenance verified | **MET, in advance** — §2.3, by git rather than fingerprint |
| 2 | Application runs without Metro | **Designed, unproven** — needs A3; the shape is proven by the Sep-17 APK |
| 3 | Isolated package confirmed | **MET** — `com.muthoy.pos.dev` absent from the device; own data dir |
| 4 | `run-as` / instrumented inspection works | **Blocked on A1 + A3.** `run-as` alone is insufficient (§4.1) |
| 5 | Correct queue status counts extractable | **Blocked on A1** — and the definition of "correct" needed A2 first |
| 6 | Cloud + device baseline captured | **Half met.** Server side works (`shopstate.py`, 4 readable tables); device side needs A1 |
| 7 | Recovery credentials available via protected local input | **MET** — `B3_PARTB_PIN` present in `%USERPROFILE%\.muthoy-secrets\b3-partb.env`, non-empty (length checked, value never read or printed) |
| 8 | No unintended data loss outside the disposable package | **MET by construction** — new package; the clear guard in `devctl.py` refuses any package but the named one |

So: **three met, one met in advance, one half met, three blocked on A1/A3.**
Requesting a clear now would be premature and I am not requesting one.

### 6.1 Reusing `B3-PARTB-SYNTH` needs no OTP — verified

The founder's condition was "reuse if legitimate phone+PIN login works". It
will, and no OTP is required:

- `sync/deviceAuth.ts:343-355` sends `action: 'device-login'` with the
  installation claim, phone and PIN. Its own comment: *"The installation travels
  WITH the credential. There is no separate enrolment call to make afterwards."*
- Server-side, `deviceLogin.ts:199-202` calls `prepareInstallationEnrollment`
  **after** the credential succeeds. `B3-PARTB-SYNTH` was never revoked, so no
  hold exists and `a23_prepare_enrollment` returns `allowed: true, held: false`.
- **The Preview installation is preserved.** There is no device cap in the
  registry — `devices_enforced_at` means "unbound legacy sessions are no longer
  accepted" (`20260923000000:63, 244`), not a count limit. Enrolling
  `com.muthoy.pos.dev` adds a second installation; it displaces nothing.

A useful side effect: once two installations exist for that actor, the
sole-owner lockout of the A2.3 concern no longer applies to the test shop, and
`a23_approve_enrollment` would have a second installation to call on.

---

## 7. Server-side reconciliation, least privilege

The service-role key can read only `shops`, `users`, `sales`, `roles`. Every
other table answers 403 / SQLSTATE 42501, because
`20260923000000:329-333` and the H-7/H-9 grant work revoked them. **Nothing here
widens a grant, and no privileged-access function is bypassed.**

Steps 14 and 15 need `inventory_movements`, `batches`, `cash_drawer`,
`expenses`, `credits`, `sale_items`, `sale_refunds`. Three routes were
considered:

| Route | Verdict |
|---|---|
| Widen service-role SELECT | **Refused.** Reopens exactly what H-7 closed |
| New `security definer` RPC returning aggregates only, `EXECUTE` to service_role | **Not recommended now.** It is a migration, and H-9 sealed the chain; a new file there is significant. Worth it only if repeated automated runs are wanted later |
| **The two read-only check scripts that already exist** | **Recommended** |

`backend/supabase/checks/restore_baseline.sql` already fingerprints exactly the
needed tables — `batches`, `cash_drawer`, `credits`, `expenses`,
`inventory_movements`, `sale_items`, `sale_refunds`, `sales` — with row count,
summed paisa, and an ordered md5 digest per table. Its header: *"SELECT-only and
safe to execute."*

`backend/supabase/checks/ledger_invariant.sql` already computes the step-15 stock
invariant directly — `batches.stock` against
`sum(inventory_movements.change_qty)` per batch (`:29`) — and its header states
*"Read-only: every statement is a select. It is safe to run on a live database
and safe to run repeatedly."* It lives outside `migrations/` on purpose so it can
never run as one.

**So the least-privilege answer is that no new capability is needed at all.** The
tooling exists, is read-only, and is already the drill's own Part A instrument.
What it needs is a database session: `psql "$DATABASE_URL" -f …`. Per
`restore_drill.md`'s 2026-10-31 addendum, the DEV database password "is the
founder's, by this project's own written rule, and is not in custody here."

**This is a founder-executed step, not a delegated one.** Two commands, both
read-only, output pasted back. That is strictly less privilege than any
credential I could be given.

---

## 8. A2.3 recovery concern — second review verdict

Revision 2 was sent for independent security/architecture review as instructed.
**Verdict: REJECT** — 1 BLOCKING, 4 MAJOR, 2 MINOR. Revision 3 is written and
committed. Full detail is in that document's §3, §5 and §8; the summary:

**The BLOCKING finding is correct and I verified every part of it against the
SQL.** Revision 2 claimed two unrecoverable states and called them exhaustive.
There is a third: an Owner can revoke **their own binding** on their only
installation. `a23_revoke_binding` asserts nothing but `a23_assert_device_admin`
(`:1208`) — **no self-target guard, no last-admin guard** — the device row stays
`active` while a hold is created (`:1238`), and `a23_approve_enrollment` then
refuses because it requires *the caller's own* binding to be active
(`:1480-1489`), which is what was just revoked. `a23-device-registry.pgtest.ts:338`
already executes that self-targeting call successfully, incidentally, while
testing registry versioning.

This is the same mistake twice: I **enumerated** the unrecoverable states
instead of stating the invariant. Revision 3 states it —

> Recovery is impossible whenever a hold exists for `(shop_id, actor_user_id)`
> and no accessible, active, session-bound Owner/Manager installation other
> than the hold's `source_device_id` remains.

— and lists the cases as instances.

The four MAJORs are all on Option D, and none is answered: it contradicts this
document's own "satisfy, never skip `a23_approve_enrollment`" rule; its
atomicity and anti-DoS properties are unspecified (a retry currently rewrites
`requested_at` and could burn the only code); a bearer code is an authenticator,
not identity proof; and it has no notification design despite requiring
contestability. Revision 3 records all four as requirements and downgrades
Option D from "RECOMMENDED" to "preferred direction, not yet a design".

One finding of my own, from writing it up: **Option D and Option C are not
alternatives.** D needs an independently verified second contact to be
contestable at all, which is C's machinery. Revision 2 presented them as
separate options; that was wrong.

**A cheaper thing surfaced that may matter more than the recovery mechanism:** a
last-admin / self-target guard on `a23_revoke_binding` and `a23_revoke_device`
would make two of the three dead-end states *impossible* rather than
*recoverable*. Refusing the call that strands the shop is a much smaller change
than building a way back from it. Recorded as open question 6 in revision 3, as
a proposal only.

**Nothing was implemented.** No credential, no hold-policy change, no migration.

---

## 9. Batch 3 tracker

| Item | Before | Now |
|---|---|---|
| H-11 Part B | NOT PASS | **NOT PASS** (unchanged; re-run gated on A1-A3) |
| H-11 Part C | blocked: "a debuggable build" | **blocked: a debuggable build + in-app instrumentation** — diagnosis corrected (§4.1) |
| Part B/C build route | unknown, assumed chargeable | **local, zero cost, no policy change** (§2) |
| Steps 11/14 contract | assumed sound | **defective; correction proposed** (§1) |
| A2.3 concern doc | revision 2, REJECT | **revision 3 committed**; second REJECT recorded (§8) |
| Checks 1.1-1.3, 2.1-2.3 | NOT RUN | NOT RUN (need a second physical device) |
| R1.1 `batches.tsx` diff | awaiting line-level approval | unchanged |
| `B3-PARTB-SYNTH` | in place | in place, reusable without an OTP (§6.1) |

**No Part B PASS is claimed.** Nothing in this document is acceptance evidence
for any drill row; every row of `restore_drill.md`'s result table still reads
*not run* or NOT PASS.
