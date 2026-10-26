# Admin audit and security — storage, the awaited path, and what is not claimed

**Batch 3. The code path is complete and tested. Hosted durability is NOT
claimed: migration 35 is unapplied, so the record of account today is the
structured line written to stderr.**

## 1. Where an audit entry goes

Three sinks, in a deliberate order:

1. **stderr, first and always.** A structured line, written synchronously. It
   runs **before** the database sink, so a database outage cannot lose the line.
   The host platform's log retention is what keeps it.
2. **The in-memory ring buffer**, which is what `/audit`'s platform view reads.
   It holds this instance's most recent entries only: a restart clears it and
   another instance has its own. **The page says exactly that.**
3. **`admin_audit_log` in Postgres** — written by `recordAdminActionDurably`,
   which returns a promise that resolves once the insert has committed or
   failed. **The table ships in unapplied migration 35.**

## 2. The sink is AWAITED on every sensitive path

A `write(entry): void` plus a durable sibling is not enough on its own, because
`lib/adminActions.ts`'s local `audit()` wrapper was synchronous and every call
site used it. So:

- `AdminAuditSink` keeps `write(entry): void` and gains an optional
  `flush?(): Promise<void>`, so **no existing non-sensitive call site changed**;
- `lib/adminActions.ts`'s `audit()` wrapper is now **`async`, and every action
  awaits it on every success and failure return path**. A test asserts each
  action's audit promise is awaited before its return value is produced.

### Denials needed their own fix

An async `audit()` inside an action cannot cover a denial at all:
`requirePermission` is **synchronous**, and it **throws** — so control never
returns to the action body where the wrapper lives.

So the denial audit moved to where it can be awaited:

- `requirePermission` keeps its exact signature and its throw, but **no longer
  records** the denial, so nothing is recorded twice;
- `requireAdminPermission` (already async) catches `AdminForbiddenError`,
  **awaits** `recordAdminActionDurably`, then rethrows — the denial is persisted
  before the caller sees the throw;
- `currentAdminSession`'s `session.role_revoked`, `session.role_mismatch` and
  `role_store_unavailable` records became awaited calls on the same path.

Tests: the denial audit settles **before** `requireAdminPermission` rejects; a
denied call constructs **no Supabase client and reaches no business query**; a
direct `requirePermission` call still throws the same error and records nothing;
and **removing the `await` fails the first assertion**.

**"No query at all" would be a false claim**, and is not made: durable denial
auditing necessarily performs an insert of its own. The claim is "no **business**
query", and the route-contract tests measure it against a named two-table
exclusion list — `admin_role_assignments`, which IS the gate, and
`admin_audit_log`, which is the denial's own entry. A test asserts no business
table has been added to that list.

## 3. Committed-but-unaudited is its own outcome

If a mutation committed and the audit insert then failed, returning an ordinary
failure would invite a retry — and duplicate a non-idempotent write such as a
support note.

So an action can return a **third shape**:

```
{ ok: false, committed: true, code: 'audit_write_failed', message }
```

The UI states that the change **was applied but not recorded, and must not be
retried**. The stderr line and the server log carry the record.

Where the write is a single statement that can carry its own audit row, the two
are issued in **one transaction** and this shape cannot arise. The shape exists
for the paths where they cannot be, and a test drives both.

That three-state result does not fit a boolean redirect, so
`outcomeQuery(action, ok)` gained a third value, `?applied_unrecorded=`, and
each page's notice block gained the matching sentence. A test asserts all three
query values map to distinct, non-empty notices and that the third **never reads
as a plain failure**.

## 4. `actor_verified`

A failed login is audited with the **claimed** subject and
`actor_verified = false`, because a login attempt by nature precedes a session
and there is no verified cookie to read. Everything performed under a verified
session cookie records `actor_verified = true`.

`/audit` **shows the distinction** in its own column, as "verified session" or
"claimed, unverified" — flattening it would let an unauthenticated attempt read
as an authenticated action. A test asserts an unauthenticated caller cannot
produce a row with `actor_verified = true`.

## 5. Redaction, enumerated

Only scalars, only allowlisted keys. Batch 3 adds exactly these:

| Key | Type | Rule |
|---|---|---|
| `caseId` | string | UUID shape, or dropped |
| `settingKey` | string | one of the six allowed setting keys, else dropped |
| `targetUsername` | string | ≤ 64 chars, no whitespace |
| `fromRole` / `toRole` | string | one of the four role names, else dropped |
| `reportId` | string | an allowlisted report id |
| `rowCount` | number | finite integer |
| `durationMs` | number | finite integer |
| `actorVerified` | boolean | — |

Existing keys, lengths, the scalars-only rule, the BD-phone and long-token
scrubbers and the UUID-safe phone pattern are **unchanged**.

Rejection tests: a nested object, an array, a function, `null`, an over-long
string, an unlisted key, a non-enum role, and a phone-shaped value inside
`reason` are each dropped or scrubbed.

**The error path carries no message, cause, stack or name.** `error.message` is
arbitrary caller text (`new Error(pin)` is legal), `error.stack`'s first line
*is* the message, and `error.name` is caller-assignable — so the name is mapped
through a closed `KNOWN_ERROR_KINDS` list and anything unrecognised becomes
`unknown`. Event slugs are a closed allowlist too: a slug not listed cannot be
sent.

## 6. The two views on `/audit`

### (a) The platform admin audit

Actor, `actor_verified`, role, action, target, outcome, timestamp and the
redacted context. **Failed and denied operations are included** — a denial is
the entry most worth keeping. Filters on actor (exact), action (prefix, because
action names are dotted namespaces), outcome and a Dhaka date range, plus free
text over the actor, role, action, target and meta pairs, and paging whose total
is the **filtered** count.

The date filter compares the **Dhaka day**, not the raw UTC date. A UTC
comparison looks right and silently drops the evening of every Dhaka day, so
"what happened on the 25th" would be missing six hours and would not say so.
There is a mutation check planting exactly that mistake.

### (b) The per-shop `audit_logs` view

Gated on `shop_audit.read` — super_admin and support only, per Volume 5's
*"support/debugging use only"*. **Scoped to one validated shop id, always**:
`audit_logs` is shop-scoped, so an unfiltered read would be every pharmacy's
internal history at once.

**Read-only in the database, not merely in the page.** §3.5 revokes every
privilege on that table from the panel's role and grants back `SELECT` alone, so
a write fails in Postgres. A source test additionally asserts the read module
contains no `insert`, `update`, `delete` or `upsert`.

`meta` is **deliberately not selected**. It is free-form shop-authored text that
has passed through no admin redaction allowlist, and the action, target, actor
and timestamp serve the support purpose. Reading a column in order to not render
it would be the wrong instinct.

The permission is checked **before** the id is validated and before any read, so
a caller without it cannot learn whether an id is well-formed — let alone
whether it exists — from the shape of the refusal.

## 7. What is NOT claimed

- **No hosted audit persistence.** Migration 35 is unapplied. Until it is
  applied, the page continues to say stderr is the record of account, and so
  does this document.
- **No claim that the in-memory view survives a restart.** It does not, and the
  page says so.
- **No claim about a deployed bundle.** The service-role key's protection is
  build-enforced and test-asserted; the deployed devtools check is gate **E15**.
- **No audit export has been exercised against hosted data.** `audit.export` is
  super_admin-only and is covered by local tests only.
