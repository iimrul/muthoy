# Batch 3 — execution of the six consolidated founder decisions

**Date:** 2026-10-31 (second pass, same day as the closure report)
**Baseline:** `origin/main` = `4107a4b`; accepted code revision `2ffad52`; CI `41187573456` success
**Classification after this pass:** **TECHNICALLY ACCEPTED — OPERATIONAL GATES PENDING.** Unchanged, and this document does not claim otherwise.

Read with [the closure report](muthoy-batch-3-final-operational-closure-2026-10-31.md), whose §4 dependency table this pass **corrects**.

---

## The short version

| # | Decision | Outcome of this pass |
|---|---|---|
| 1 | E11 / migration 37 — read-only preflight + deployment prep | **Prepared, and one prerequisite came back NO.** The hosted migration ledger does not support applying 37 while 35–36 are held. Decision 1 is gated on Decision 3. |
| 2 | E4-H — hold 35 and 36 | **Recorded and honoured.** Order 35 → 36 preserved; all evidence intact. |
| 3 | H-11 C5 — real backup/restore rehearsal | **Minimum safe action designed.** The provider's own documentation contradicts itself on whether the Free plan has a restorable backup, so step one is a capability read, not a restore. |
| 4 | Android Preview — one current-revision `internal` build | **Prepared and costed with real evidence.** Quota is not a constraint; the build costs $0. Not submitted. Two-device checklist written. Zero devices available. |
| 5 | Admin metrics — consume the canonical server verdict | **DELIVERED.** The parallel interpretation is deleted, not patched. Evidence at three layers plus a mutation probe. |
| 6 | Logout wording + `ADMIN_ROLES` | **Half delivered, half refused with evidence.** The all-device logout behaviour the wording describes **does not exist in this codebase**. I did not ship the sentence. |

**Nothing hosted was mutated. No production deployment. No EAS build submitted. No credential value is printed in this document. Batch 4 is not begun.**

---

## 1. Decision 1 — migration 37: the ledger says no, and that is the finding

> *"Before applying, verify target history, complete backup readiness, rollback implications and safe handling of applying migration 37 while 35–36 remain unapplied. Do not treat functional independence as proof that the hosted migration ledger supports the order."*

That instruction was right to separate the two, and the two give different answers.

### 1.1 Schema independence: yes — but my earlier claim was overstated

The closure report's §4 table said migration 37 depends on **"B4 only"**, and said the dependency had been *measured rather than assumed*. **The row was wrong and the measurement did not measure it.**

Migration 37 calls `h7_shop_billing_bootstrap_allowed` three times. That function is created by migration **23** (`20260907000000_h7_security_hardening`) and amended by **25** (`20260907020000_h7_fix_pass_b`). The test I pointed at applies 37 onto a B4-only chain and **succeeds** — because a PL/pgSQL body is not resolved at `CREATE` time — and it never called either H-7 gate. So a missing dependency presented itself as independence.

Both halves are now measured, in `backend/supabase/pgtest/e11-entitlement-verification.pgtest.ts`:

- 37 applied onto the **actual DEV chain (migrations 1–34)**, with 35 and 36 asserted absent, then **all five** gates it redefines are called by name: `b4_shop_write_permitted` (on the branch that reaches the bootstrap helper), `b4_user_within_current_staff_limit`, `b4_user_has_premium`, `b4_staff_row_within_limit` and `b4_reconcile_plan_limits`.
- 37 applied onto **B4 alone** raises **`42883 undefined_function`**, and the message names `h7_shop_billing_bootstrap_allowed`.

> **CORRECTION within this same pass.** The first version of that test called
> **three** of the five gates while its name said "every gate", and the reviewer
> falsified it the way it deserved: by replacing `b4_staff_row_within_limit`
> with a body calling a nonexistent function and watching every assertion still
> pass. That is the third universal claim of mine in this batch — "B4 only",
> "every gate", and earlier "every capacity decision" — that a reviewer
> falsified. **I write quantifiers I have not enumerated.** The staff-admission
> call now asserts a *value* rather than the absence of an error: `false` while
> the snapshot is unbacked (free allows one non-owner staff and Manager A
> already holds it) and `true` once the backed trial is restored (ultra carries
> no staff limit), so the tier lookup inside it is what the assertion depends
> on.

**Apply-time success is not evidence of a satisfied dependency.** The corrected claim is narrower and true: *37 is independent of 35 and 36 specifically, not of the chain.* DEV's ledger tail is migration 34, so 21, 23 and 25 are all long applied there, and the hosted answer does not change.

### 1.2 Ledger independence: NO

The sanctioned applier for this project is **`supabase db push --linked`** ([H-9 plan](H-9-production-environment-eas-secrets.md) lines 1101–1102). Its unit of selection is *every local migration absent from the remote ledger, in version order.* There is no per-migration selector: the CLI help receipt captured in a previous session (CLI **2.117.0**, receipt `audit-artifacts/h9-remediation/cli-help.log`, recorded in `backend/supabase/deploy/H9-LOCAL-REMEDIATION.md`) lists `--project-ref` and `--skip-vault` for `db push` and nothing that names one migration.

DEV's recorded ledger tail is **34** (`20261015000000`). Pending locally: **35, 36, 37**.

> **So a single `db push` against DEV applies 35, 36 AND 37.**

The two ways to apply 37 alone are both forbidden by this project's own standing policy, in writing:

| Route | Why it is unavailable |
|---|---|
| `supabase migration repair --status applied` on 35 and 36 | `H9-LOCAL-REMEDIATION.md`: *"Never use `--include-all`, `--include-roles`, `--include-seed`, `db reset` or migration repair."* It would also record 35 and 36 as applied when they never ran — a ledger that lies, and a later real apply becomes impossible. |
| Execute 37's SQL out of band, then record it | Same prohibition, and it leaves 35/36 pending **behind** an applied 37. That is an out-of-order ledger, which only `--include-all` can later push — also forbidden by name. |

**Decision 1 and Decision 2 therefore cannot both be executed as written.** Holding 35 and 36 holds 37 as well.

### 1.3 What that makes the sequence

Because any push that carries 37 also carries **35**, and 35 is **class C with restore-dependent recovery**, the apply inherits 35's recovery class. So:

> **Decision 3 (the restore rehearsal) must precede Decision 1, and then 35 → 36 → 37 go in one ordered push.**

That is also the order `db push` uses unaided — ascending version — so Decision 2's *"preserve exact order 35 → 36"* is satisfied by the tool rather than by care.

**Recommended revision to Decision 1:** approve the read-only preflight now (below); defer the apply until Decision 3 returns a recovery verdict; then apply all three in one push.

**The alternative, stated so it is your choice and not mine:** if E11's exposure on DEV matters more than 35's recovery class, 37 can go first by renaming it to a version between 34 and 35. I **recommend against** it — the file is already pushed to a public repository, recorded in five declaration files and two hash manifests, and renaming it would rewrite all of them to buy a few days.

### 1.4 The read-only preflight, which is approved and ready

Every command is read-only. None mutates. Run in order; any surprise stops.

```
# 1. The H-9 preflight. Needs SUPABASE_ACCESS_TOKEN (Management API) and the
#    MUTHOY_ENVIRONMENT / MUTHOY_SUPABASE_PROJECT_REF pair.
node scripts/h9-prod-preflight.mjs

# 2. The ledger, as the CLI sees it.
supabase migration list --linked

# 3. THE ONE THAT SETTLES 1.2 WITH HOSTED EVIDENCE. Prints the apply set and
#    changes nothing. If it names 35, 36 and 37, the finding above is confirmed
#    against the live project rather than against a captured help receipt.
supabase db push --linked --dry-run

# 4. The pre-apply history snapshot, kept as evidence.
select version, name from supabase_migrations.schema_migrations order by version;

# 5. The pre-E4 acceptance check, which must pass on the CURRENT history.
backend/supabase/checks/h9_postmigration_checks.sql
```

Expected at step 2/4: 34 versions, tail `20261015000000`. Expected at step 3: **35, 36 and 37**.

**Limit of my evidence, stated plainly.** I did not run the CLI this session — it is not installed on this machine, and `npx supabase` would have downloaded 2.122.0. The flag contract above is a prior session's receipt for **2.117.0**, and `H9-LOCAL-REMEDIATION.md` itself warns: *"Do not use an unreviewed CLI version's flag contract."* Step 3 is what converts my finding into hosted fact.

### 1.5 Rollback implications for 37, read rather than guessed

- **Class B** (`rollback-classification.json`, `ROLLBACK.md`).
- Reverses by re-applying **seven** predecessor bodies — `20260831000000` lines 261-273, 350-384, 562-616, 620-630, 870-878, and `20260907000000` lines 140-174 and 177-203 — then dropping `b4_entitlement_claim_backed`.
- **Every predecessor it needs comes from migrations 21 and 23, both applied on DEV.** So 37's reversal does not depend on 35 or 36 either.
- There is **no down migration**. Reversal is a redeploy of function bodies, not a data operation — the same shape as migration 35's W4-05 wrappers.
- **Reverting re-opens both defects**: the unconditional `verified_at` stamp and the unconditional apply of an unverified snapshot. `e11-entitlement-verification.pgtest.ts` executes that reversal for real, so this is measured and not asserted.

### 1.6 Backup readiness

Not established, and it cannot be established by me: see Decision 3. This is the prerequisite that makes §1.3's ordering unavoidable.

---

## 2. Decision 2 — the hold, recorded

Migrations 35 and 36 are **held** pending genuine H-11 C5 recovery acceptance.

- Order **35 → 36** preserved. 36's function inserts into `admin_audit_log`, which 35 creates, so 36-before-35 fails at **runtime, not apply time** — it would appear to succeed.
- Applied to **no** hosted project.
- All historical evidence intact: the E4 evidence manifest and the E4-B successor manifest both show **no drift**, and the five sealed declaration files are unchanged (verified in §7).

Nothing was executed for this decision, which is the decision.

---

## 3. Decision 3 — H-11 C5: the minimum safe action

> *"Do not transfer real DEV pharmacy/customer data onto the Windows host without a separately approved data-protection procedure. Prefer provider-managed isolated recovery where feasible. Identify the minimum safe action and credential-handling requirements."*

### 3.1 The first step is a capability read, not a restore

The repo already names this as prerequisite 1 of the drill (`backend/supabase/checks/restore_drill.md`): *"The free tier's retention may not support a point-in-time restore. **Founder decision** — the drill cannot be designed around a capability the project does not have."*

Checking that today produced a result worth recording: **Supabase's own documentation contradicts itself.**

- Its Free-plan FAQ says there are **no automatic backups** on Free and directs you to manual CLI backups.
- Its Database Backups guide says **all** Free, Pro, Team and Enterprise projects are backed up **daily**.
- **Point-in-time recovery** is a paid add-on for Pro and above — roughly **$100/month per 7 days of retention** — and is not included on Free.
- **"Restore to a new project"** — the shape that would keep data inside the provider — is **not confirmed** by any Supabase source I could read. Third-party guides describe a dashboard "Point in Time" tab; none states whether it lands in a new project or overwrites the current one.

So the capability cannot be assumed in either direction, and **no restore should be designed until the dashboard is read.** That read is free, read-only, and needs no database password — only a dashboard login.

### 3.2 The minimum safe action

Three steps, cheapest first. Stop at whichever one answers.

**Step A — capability read (free, read-only, no password).**
In the Supabase dashboard for DEV `btfprhticjgeihcngpif`: Settings → Billing (which plan) and Database → Backups (whether any restorable backup exists, its retention, and whether the restore target is a new project or in place). Record what is actually offered. **This is the whole of prerequisite 1.**

**Step B — rehearse on a disposable project seeded with SYNTHETIC data. Recommended.**
This is the step I recommend, and it is stronger than it sounds:

- It exercises **the provider's real restore path on a real Supabase project** — which the accepted local PG17 drill explicitly did not.
- It carries **zero** pharmacy or customer data, so the founder's data-protection constraint is satisfied by construction rather than by procedure.
- The fixture already exists: `node scripts/generate-history-fixture.mjs --out ./history.db` — 97,165 rows / 21.8 MiB across 24 tables, all synthetic.
- The verdict it produces is the one the drill asks for: recovery time, rows lost, and **values returned** via `restore_baseline.sql`'s per-table digests.

**Gate on Step B:** it needs a **new** disposable project. DEV and `jwjrijvprbsndukfhlvf` are both recorded as forbidden disposable targets, and this account's Free-project slot eligibility and capacity remain **UNVERIFIED** (the H-9 N0 record). So Step B is gated on a slot/eligibility read, which is itself free and read-only.

**Step C — restore DEV itself, only if Step A shows a provider-managed isolated target.**
If and only if the dashboard offers a restore **into a separate project**, DEV's own backup can be rehearsed with no raw row reaching this machine:

- `restore_baseline.sql` emits, per table, a row count, a summed paisa total and an `md5` digest over ordered per-row values. **Those are aggregates.** Comparing the digest from the source against the digest from the restored project proves values returned without a single pharmacy row leaving the provider.
- That is the design that satisfies *"prefer provider-managed isolated recovery"* and *"do not transfer real data onto the Windows host"* at the same time, and it needs **no separately approved data-protection procedure**, because no personal data is transferred.

**What is NOT the minimum safe action:** `supabase db dump` of DEV to this Windows host. That transfers real pharmacy and customer rows onto the host and is exactly what the decision withholds.

### 3.3 Credential-handling requirements

| Credential | Needed for | Handling |
|---|---|---|
| Dashboard login | Step A, and the slot read | Interactive, in a browser. Never pasted into this session. |
| DEV database password | Steps B/C only, and only for the digest reads | Through the **approved protected prompt** only. Never into the repo, a file, a shell history, an environment file, or this transcript. Custody directory `C:\Users\Imrul\.muthoy-h9-f12-exec` is already hardened for exactly this. |
| `SUPABASE_ACCESS_TOKEN` | Decision 1's preflight (§1.4) | Same. Management API only; it is not the database password. |

No credential value appears in any document produced by this pass, and none was retrieved.

---

## 4. Decision 4 — the Android Preview build, prepared and costed

> *"Prepare one current-revision EAS `internal` build using `com.muthoy.pos.preview`, isolated DEV configuration and existing approved signing. Check quota and potential costs before submission."*

### 4.1 The build is prepared; the identity is verified from the current revision

Resolved today by `expo config` at the current working revision, with `APP_VARIANT=preview`:

| Field | Value |
|---|---|
| Android package | **`com.muthoy.pos.preview`** |
| iOS bundle | `com.muthoy.pos.preview` |
| Display name | **Muthoy POS Preview** |
| URL scheme | `muthoy-preview` |
| Version | `0.1.0` |
| EAS project id | `075497e0-eac5-4ed9-8552-3c6e70f6efa9` |

Production stays `com.muthoy.pos`. **Side-by-side install is safe by configuration**, not by convention.

The command, when authorised — and not run:

```
cd apps/mobile && eas build --platform android --profile internal
```

**The profile is `internal`.** `eas.json` has no profile named "preview"; `internal` is the one that sets `APP_VARIANT=preview` and `distribution: internal`, `buildType: apk`. `production` would build over the production identity.

**The pinned CLI matches.** `eas.json` requires `cli.version: 21.8.0` and the installed CLI is exactly `eas-cli/21.8.0`. (A newer 26.0.0 exists; upgrading would break the pin.)

### 4.2 Quota and cost — measured, not estimated

Read today from the EAS account (read-only, `eas build:list`):

| Build | Profile | Commit | Status | Created |
|---|---|---|---|---|
| `76ee0fcb…` | internal | **`bd0fa4d`** | FINISHED | 2026-10-29 |
| `0b88af8d…` | internal | `5a9ffe9` | **ERRORED** | 2026-10-26 |
| `2e10c054…` | development | `ca213b4` | FINISHED | 2026-08-21 |

Three builds in the account's entire history. This also **confirms from the provider's own record** that the existing Preview APK is `bd0fa4d` on profile `internal`.

Against the Free plan's published allowance — **15 Android builds per month, 1 concurrent, low-priority queue, 45-minute cap** — October used **two** (one of which errored). So:

> **Quota is not a constraint, and one `internal` build costs $0.**

No paid resource would be consumed and no production signing touched. **I did not submit it.**

### 4.3 Blockers, corrected

- **Devices: zero.** `adb` is not installed on this machine, so no device is attached and none can be.
- **JDK: a correction.** I previously listed "only a JRE 1.8, Gradle needs JDK 17" as a blocker. Java here is indeed `1.8.0_471`, but that only blocks a **local** build (`--local`). A cloud `eas build` compiles on EAS's runners, so the local JDK is irrelevant. The honest blocker list is devices and authorisation, not Java.
- **EAS account identity, flagged not judged.** The authenticated EAS account is `imrulkaesh` — which is already the `owner` in `apps/mobile/app.json`, so the Preview build would be owned there as expected. Its login address is **not** the `muthoy.dev` address this project is otherwise identified by. That address is deliberately not written down here: this repository is public, and a personal email is not something a delivery record needs to publish. If the split is intentional, nothing needs doing.
- **Unverified:** `eas env:list --environment preview` **timed out at 90 seconds** and returned nothing, so whether EAS's `preview` environment carries the DEV Supabase configuration is **not confirmed**. `expo config` shows no `extra.supabaseUrl`, so the app's DEV endpoint must come from that EAS environment. **Confirm it before the build**, or the APK may install and point nowhere.

### 4.4 The two-device acceptance checklist

Synthetic data only. Neither device may hold a real pharmacy's records.

| # | Step | Pass condition |
|---|---|---|
| 1 | Install the APK on device A alongside production | Both apps present; Preview shows "Muthoy POS Preview" |
| 2 | Register a new shop on A | Empty shop; **no seed or demo data** (CLAUDE.md rule 9) |
| 3 | Record a sale, an expense and a stock movement on A | Each persists offline; money uses the DM Mono figures |
| 4 | Go offline, repeat step 3, come back online | Queue drains; no duplicate rows |
| 5 | Install on device B; sign in to the same shop | B hydrates the shop's data |
| 6 | Sale on A, then pull on B | B shows A's sale |
| 7 | **Sign out on B** | B returns to PIN login |
| 8 | **Check A** | **A stays signed in.** See Decision 6 — this is the real behaviour, and it is not what the proposed wording says |
| 9 | Reset the PIN on A | **B requires the new PIN** — this is the genuine cross-device effect |
| 10 | Register a second owner on the same device | **No previous owner's data is visible** (CLAUDE.md rule 7) |

Steps 1–10 are **PENDING**, not failed. No device is available.

---

## 5. Decision 5 — DELIVERED

> *"Approve the local correction of the entitlement counts … Consume the canonical server entitlement verdict, not a parallel interpretation."*

### 5.1 What changed

The Admin Dashboard used to decide entitlement itself, with a TypeScript transcription of the status/date rule and three exported predicates. **Those are deleted, not patched.** Migration 37 made every server-side decision additionally require the snapshot to AGREE with the `billing_subscriptions` row behind it, and that is not transcribable — the evidence lives in another table, and a second implementation of a two-table rule is a second thing to drift.

`entitlementCounts` now takes `EntitlementVerdictRow`, carrying `b4_effective_tier`'s own answer, fetched per account for the page's single instant.

**The function takes no clock.** There is no date left to judge, so there is nothing for a future edit to re-derive. A test asserts the arity, because that is the guarantee.

The split between *trialing* and *currently paid* is a **label, not a second judgement**: `b4_effective_tier` answers `'ultra'` for both a live trial and a paid Ultra plan, so the snapshot's own `status` separates them. The two branches are provably disjoint — a `trialing` row can reach only the trial arm of the CASE, and no other status can reach it — so the total is now added rather than re-counted.

### 5.2 Evidence, at three layers

None of the three is sufficient alone, which is why there are three.

| Layer | What it settles |
|---|---|
| `backend/supabase/pgtest/e11-entitlement-verification.pgtest.ts` | On **real PostgreSQL**: the full status/date matrix (13 cases), the strict-`>` boundary to the microsecond, and the **three reproductions** each answering `free` then returning to `pro`/`ultra` when the evidence is restored |
| `apps/admin/lib/adminEntitlementVerdicts.test.ts` (new) | The RPC is **asked at all** — once per account, with the page's own instant as `p_now`, no write RPC issued, a failure raising rather than answering with the half that replied, and a null coalescing to `free` exactly as the SQL callers do |
| `apps/admin/app/adminRoutes.contract.test.tsx` | The **rendered figures** move when the verdict moves and the snapshot does not: the same `pro`/`past_due` fixture prints `1` currently-paid under a `pro` verdict and `0` under `free` |

### 5.3 The three reproductions

Each is executed, and each restores the evidence afterwards so it cannot pass because the fixture was broken.

1. **A paid claim with no subscription** — snapshot `pro`/`active`, both dates in the future, no `billing_subscriptions` row → **`free`**.
2. **A trial longer than the grant** — `trial_ends_at` at grant + 400 days → **`free`**; back to grant + 14 days → `ultra`.
3. **An `active` claim a `canceled` subscription backs** — tier and both dates still matching, only the subscription's status moved → **`free`**.

### 5.4 Non-vacuity, proved rather than asserted

A mutation probe narrowed one arm of `b4_effective_tier` from `('active','canceled')` to `('active')`. **Two tests failed** — `canceled, still paid -> pro` and REPRODUCTION 3 — and no others. The migration was then restored and its blob verified byte-identical (`d27580c87b8dc94244af171d490e1d204afb109a`), with `git status` clean on `backend/supabase/migrations/`.

### 5.5 One honest dependency

`b4_effective_tier` has existed since migration 21. Against a project where **migration 37 is not yet applied**, it is the pre-E11 function — status and dates, no backing check — so these counts **still over-report there**. The call site is correct either way; what closes the misreport is applying 37, which is Decision 1, which is gated on Decision 3. Decision 5 does not close the misstatement on its own, and saying otherwise would be the kind of claim this batch exists to stop making.

### 5.6 A guard added

`adminGrants.test.ts` now asserts that `b4_effective_tier(uuid,timestamptz)` is granted to `service_role` **and** revoked from `public, anon, authenticated` in the migration chain — the read path only works if the first is true, and the verdict must not be probeable by a browser session holding only a shop's token. It also asserts the query layer calls that RPC and has **not** grown its own status/date reading.

---

## 6. Decision 6 — one half delivered, one half refused with evidence

### 6.1 The logout wording describes behaviour this codebase does not have

> *"Keep the existing all-device logout security behavior. Use the wording: 'Signing out signs this shop out on every device. Sign in again on each phone you use.'"*

**I did not ship that sentence, because it is not true of this app.** The premise came from my own §7 of the closure report, where I converted a line of the master prompt into user-facing copy **without once opening the logout code.** That is the same mistake as the CI claim: repeating a brief's premise as a finding.

What the code actually does:

| Path | Scope | Evidence |
|---|---|---|
| The Logout button → `state/switchUser.ts` | **This phone only.** Ends the local shift and the cart. Does not even drop the Supabase token. | Its own comment: *"A destructive 'Sign Out Device' — dropping the Supabase session and unlinking the device — is a DIFFERENT action … intentionally not built here."* |
| `state/signOutDevice.ts` | **This phone only**, deliberately. | `supabase.auth.signOut({ scope: 'local' })`, with the comment *"'local' scope on purpose"* and a test asserting the scope: *"a stale token on this handset is no reason to sign the same owner out of their other phone."* |
| A second device signing in | **Does not revoke the first.** `shop_device_bindings` is unique on `(device_id, actor_user_id)`, so a new handset **inserts** a binding and touches no other. | `20260923000000_a23_device_registry.sql` |
| Sessions cut across every device | **Four paths, not three.** Staff **deactivation** and a **role change** call `signOutAppUser` → `revokeAuthUserSessions`. A **PIN reset** takes a different route — `revokeCallerSessionsGlobally` in `recoverPin.ts:204`. And **rebinding an auth identity** revokes the old auth user's sessions on its own. My first wording said all three went through `signOutAppUser` and used the word "only"; both were wrong, and a second review round said so. | `_shared/auth.ts`, `recoverPin.ts:204`, `_shared/identity.ts:154` |
| An Owner revoking a device | **That handset only for live sessions** — `a23_revoke_device` updates `shop_devices` `where id = v_device.id` and that device's bindings, and a second handset keeps its own. **But it is not without wider effect:** enrolling the same actor on a FRESH handset afterwards raises **`MU070`** and needs another administrator's approval, because the revocation leaves a persistent enrollment hold. Targeted for sessions, deliberately not targeted for future enrollment — and my first correction said "that device only" without the second half. | `20260923000000_a23_device_registry.sql:1343-1356`, `20260926000000_a23_persistent_enrollment_holds.sql` |

So there is **no all-device logout** to keep. The instruction to *preserve* the behaviour is satisfiable and satisfied — I changed nothing — but the sentence would have told every pharmacist something false, and the cross-device consequence it gestures at belongs to **PIN reset**, where the app already says it correctly: *"Your other devices will need to sign in again with the new PIN."*

**Your options, so this is your call:**

| | Wording | Note |
|---|---|---|
| **A — recommended** | Keep the shipped note: *"Your shift ends on this phone and it returns to the PIN screen. The next person signs in with their own PIN."* | Already accurate. Silent about other devices, which is the truth. Zero change. |
| B | Make the scope explicit: *"Your shift ends on this phone only. Other phones signed in to this shop stay signed in."* | Also true, and removes a possible misreading. A one-line copy change plus its Bangla translation. |
| C | Ship your sentence **and change the behaviour to match** — a global sign-out. | A security and behaviour change. It contradicts an explicit code comment and a passing test, needs its own approved plan, and would sign an owner out of their other phone because a colleague ended a shift. **I recommend against it.** |

Nothing in `apps/mobile/i18n/catalog.ts` was changed pending your choice.

### 6.2 `ADMIN_ROLES` — the verification procedure

> *"Verify production-bound ADMIN_ROLES configuration in staging before release. Do not disclose credential values."*

Still **not performable**: nothing is deployed, so there is no staging to verify in. What can be stated now is that the verification is already mechanised and **fails closed at boot**. `parseAdminRoles` (`apps/admin/lib/adminRoles.ts:183`) refuses to start the panel when the value is unset, not valid JSON, not an object of username → role, contains a reserved key (`__proto__`, `constructor`, `prototype`), carries a username that account management could not later revoke, or repeats a username in different cases.

The procedure, when a staging deployment exists:

1. Set the production-bound `ADMIN_ROLES` as a staging environment variable. **Do not print it**; a wrong value is reported by the panel refusing to boot, which needs no transcript.
2. Load any admin page. **It must render.** A boot refusal means the value is invalid, and the server log names the offending field while the browser gets a fixed sentence.
3. For each configured account, sign in and confirm the role the panel resolves is the intended one. The role is re-resolved from `ADMIN_ROLES` on **every** request, not read from the cookie, so this checks the live value.
4. Confirm an account **absent** from `ADMIN_ROLES` is denied.
5. Record only: the number of accounts, the set of roles, and pass/fail. **No username and no value.**

---

## 6A. The independent review of this pass, and what it cost

**Two rounds. Round 1: REVISE, four findings. Round 2: ACCEPT, no blocking
items**, with all four fixes VERIFIED by execution and two further LOW
documentation findings (both corrected above, in §6.1's table).

Round 2 verified each fix with its own PostgreSQL probe rather than by reading:
the `trialing → backed pro/active` transition now raises instead of reporting
`trialing/pro`; real billing polling advances `verified_at` and `version`
**without** a false refusal; the dependency test's own callback passes and then
**fails with `42883`** when staff admission is replaced with a broken body — the
same counterexample that falsified the previous version; and the partial-failure
test now has the successful peer it lacked. It also confirmed the exclusion of
the stamp columns is sound because the SQL never reads them, and agreed the
dashboard's own read is the right anchor since it supplies the status returned.

**One honest residual it names, and I am not rounding it up.** The check is
**optimistic**: an injected `trialing → active → trialing` sequence inside the
fan-out window would still return `trialing/pro`. No application writer performs
that reverse transition — payment application moves status forward and the trial
row is written once — so it is unreachable today rather than impossible. A
genuine renewal or signup during a dashboard load can require a reload, which is
the intended cost.

Round 1. **Four findings, every one mine, two of them blocking.** The reviewer
could **not execute Vitest** — esbuild `spawn EPERM` during configuration
loading, **zero Vitest tests ran** — and said so rather than reasoning in its
place. It ran its own Node/PGlite probes instead, which is how it found the
first item.

**MEDIUM 1 — the two halves of a classification could describe different
versions of the same row.** `status` came from the snapshot read and
`effectiveTier` from a later round trip. The reviewer executed the gap on real
PostgreSQL: read an account as `trialing`, move it to a backed `pro/active`,
then fetch the verdict — and the panel reported **`trialing/pro`**, a pair the
SQL CASE cannot produce, counting a paying customer as a trial.

Its one-line diagnosis is the part worth keeping: ***"`p_now` fixes the clock,
not the database snapshot."*** I had spent this whole fix arguing that
clock-independence was the point, and introduced **snapshot** incoherence while
congratulating myself on removing the clock. My own comment claimed the two
branches were "provably disjoint" — true of one coherent snapshot, which my
code did not guarantee.

**Fixed by refusing rather than answering.** The verdict-relevant columns are
re-read after the fan-out and compared; if anything that could move an answer
moved, the page raises instead of printing a figure. `verified_at` and `version`
are deliberately **excluded** from that comparison — the device's billing-status
poll stamps both on every call, so including them would refuse almost every
dashboard load. A second test pins exactly that: a verification stamp must
**not** be treated as a move. Two tests, one for the refusal and one for the
non-refusal, because a check that is too strict fails as badly as one that is
too loose.

**MEDIUM 2 — "every gate" named five and called three.** Recorded above, in
§1.1.

**LOW 3 — my partial-failure test only ever tested total failure.** The stub's
error was global, so both accounts failed and no successful peer existed — so
the test did not establish the property it was named for. It now fails **one**
account while the other replies, and a second test covers total failure.

**LOW 4 — I documented a targeted operation as a global one.** I listed "an
Owner revoking a device" among the paths that cut sessions across every device.
`a23_revoke_device` updates `shop_devices` `where id = v_device.id` and that
device's bindings; a second handset keeps its own. Corrected here and in
`DECISIONS.md`.

**What the reviewer confirmed**, each by execution rather than reading: the
trial/paid arms are exclusive for one coherent snapshot and the addition counts
every non-`free` verdict once; no snapshot-date entitlement predicate remains
anywhere in `apps/admin`, and the retained MRR and active-subscription
predicates answer separate reporting questions; the bounded pool reached a
maximum concurrency of exactly **8** over 23 accounts, completed out of order
and preserved the returned order, with null correctly becoming `free`; the
minimal chain **1–21 + 23 + 25 + 37** works through every replaced gate and
B4-only reproduces `42883` naming the H-7 helper, with **no further post-21
dependency**; and §1.2's ledger finding **holds**, with the added observation
that a temporary 37-only migration directory would merely postpone the same
forbidden out-of-order problem. It also confirmed that **refusing the founder's
logout sentence was correct.**

---

## 7. Repository state after this pass

| | |
|---|---|
| Sealed declaration files changed | **0 of 5** |
| `backend/supabase/migrations/` dirty | **no** — the mutation probe was reversed and the blob verified byte-identical |
| Migration 37 applied to a hosted project | **no** |
| E4 evidence manifest / E4-B successor manifest | **no drift** |
| Preview worktree `D:\Muthoy-Preview-Test` | untouched, still `bd0fa4d` |
| Credentials retrieved | **none** |
| Hosted mutations | **none** |

---

## 8. The exact outstanding external approvals

Six things need you, and two of them need nothing from me first.

| # | What | Needs | Blocked on |
|---|---|---|---|
| 1 | **Read DEV's backup capability** in the dashboard (Decision 3 Step A) | A dashboard login, 5 minutes | Nothing. **Start here** — it unblocks the chain. |
| 2 | **Confirm the EAS `preview` environment** carries the DEV Supabase configuration | A dashboard login | Nothing. Needed before any Preview build is worth making. |
| 3 | **Authorise the restore rehearsal** (Decision 3 Step B or C) | A disposable-project slot read, then the DEV password via the protected prompt | #1 |
| 4 | **Authorise the hosted apply** of 35 → 36 → 37 in one ordered push, naming the project | `SUPABASE_ACCESS_TOKEN` + the read-only preflight of §1.4 | #3 — because the push carries class-C migration 35 |
| 5 | **Authorise one EAS `internal` build**, and supply two devices | Your go-ahead; $0 and 1 of 15 monthly builds | #2 |
| 6 | **Choose the logout wording** — A, B or C in §6.1 | A one-word answer | Nothing |

Batch 3 stays **TECHNICALLY ACCEPTED — OPERATIONAL GATES PENDING**. It is not closed, and local tests passing is not closure.

**Batch 4 is not begun.**
