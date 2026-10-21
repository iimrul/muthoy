# Muthoy POS — Batch 1 complete implementation plan

**Status:** **CODEX PLAN ACCEPT** (revision 8, round 8 — `NO REMAINING OCCURRENCE`). Gate 2 CLOSED. Gates 3 and 4 CLOSED. Gate 5: Codex final review returned REVISE with 11 findings; all 11 remediated in-batch (see the implementation record, *Gate 5*). Awaiting a targeted delta review before commit. **Scope: W4-04 and
W4-05 are BLOCKED on the H-9 migration-chain seal** (§14). Nine tasks reach
CODE-COMPLETE — implemented and automatically tested, with Definition-of-Done
clauses 2–3 (real-device, Validation Checklist) still outstanding.

> Four review rounds completed, all `PLAN REVISE`, every finding verified against
> the code and fixed. Round 4's two new HIGHs were both **internal
> contradictions introduced by revision 4's own scope change** — the document
> said "no Postgres migration" in §6/§14 while other sections still told an
> implementer to add one. Revision 5 is a consistency sweep plus two real
> corrections (the `shops` identity fields, and the audit trail for deleted
> outbox rows). Gate 3 starts on `PLAN ACCEPT`.
**Date:** 2026-10-20
**Baseline:** `origin/main` @ `354fa2a` (verified; working tree carries **40** uncommitted
pre-existing H-9 paths that this batch must preserve and must never stage — enumerated in §10)
**Scope:** one cohesive Batch 1 covering all 11 assigned task IDs. No sub-batches.

> **Revision 2 changed the substance, not just the wording.** Two of revision 1's
> factual claims were wrong and the reviewer caught both: partial sale refunds do
> not exist in this codebase, and the W4-05 privilege-escalation chain is already
> blocked by `MU015`. §13 logs every finding and its disposition.

---

## 0. Ground rules this plan obeys

| Rule | How this plan satisfies it |
|---|---|
| CLAUDE.md 1 — SQLite is the only source of truth for app screens | the conflict queue, its UI, and the monitoring sink are all SQLite/MMKV-local; no screen calls Supabase |
| CLAUDE.md 2 — every FK needs an explicit `onDelete` | `conflict_queue` deliberately gets **no** FKs (same reasoning as migration `0030`, stated in the migration header); no new FK is introduced anywhere |
| CLAUDE.md 3 — FEFO sorts on real `expiryDate` | untouched |
| CLAUDE.md 4 — cash formula is fixed | untouched. W4-04 reuses `db/reports.ts`'s existing `netSales = saleTotal − refundTotal` definition rather than deriving a second one |
| CLAUDE.md 5 — opening cash defaults to 0 | untouched |
| CLAUDE.md 6 — money uses the DM Mono variable | all new money rendering goes through `formatMoney`; `tests/font-tokens.test.ts` keeps guarding it |
| CLAUDE.md 7 — no cross-owner data | every new read/write is `shop_id`-scoped; `purgeUnreadableTables` is extended to drop conflict snapshots for tables the device may no longer hold |
| CLAUDE.md 8 — PINs never logged | W3-04's redactor denies PIN/OTP/token/phone/money/name fields by **allowlist**, not by denylist |
| CLAUDE.md 9 — no seed/demo data | every new test builds its own fixture; nothing ships |
| CLAUDE.md 10 — propose a plan for db/sync/money work, wait for approval | this document is that plan; Gate 2 is the approval |
| CLAUDE.md 11 — contradictions stated explicitly | §12 lists every deviation and every deferral |
| CLAUDE.md 15 — `apps/prototype-web` is reference-only | consulted for the one new screen's layout, navigation and interaction patterns; **none** of its React-Web architecture, CSS, business logic, state management or data layer is copied (see §12 item 7) |
| Batch safety | no hosted Supabase op, no deploy, no EAS build, no paid SMS/payment, no device operation. **No Postgres migration file is created at all** — not written, not applied: the chain is sealed by H-9 (§14). The one SQL artefact W4-05 produces lives outside `backend/supabase/migrations/` and is never part of the chain |

---

## 1. Verified repository baseline (Gate 1 evidence)

```
HEAD                354fa2a70597cb3c40c459e480530674c85eff21
branch              main  ->  origin/main (in sync)
remote              https://github.com/iimrul/muthoy.git  (PUBLIC)
PG migrations       34   (rollback-classification.json: 34 postgres entries)
SQLite migrations   31   (0000..0030, journal entries = 31)
```

Working tree already dirty with H-9 work that is **ON HOLD until Batch 3**: 3
modified files (`DECISIONS.md`, `scripts/h9/install-local-runtime.ps1`,
`apps/prototype-web/Muthoy (prototype)/pnpm-workspace.yaml`) and 37 untracked
paths (8 `docs/plans/h9-*` documents, 26 `scripts/h9/**` files, 3 prototype
artefacts) — **40 paths exactly**, enumerated in §10.
**None of these may be staged by Batch 1.** `DECISIONS.md` is the one shared file
Batch 1 must also edit; §10 states exactly how that is handled.

### Facts established by reading the code (not assumed)

1. **`conflict_queue` exists and is dead.** `db/schema.ts:1326` and migration
   `0000` define it; nothing in the repo ever writes to it. Grep for
   `conflictQueue` outside `schema.ts` returns nothing. This is H-6 in the
   pre-RC master plan, status **NOT DONE**.
2. **Pull-side LWW discards silently.** `db/sync-helpers.ts`'s `applyToTable`
   returns `"skipped_stale"` whenever `local.updatedAt >= remote.updatedAt`.
   The remote row is dropped with no record, even when the local row has
   unpushed outbox work.
3. **Push-side LWW fails silently, and the client is told `applied`.**
   `sync_apply_row_base` (migration `20260818000100`) upserts with
   `... on conflict (id) do update set (...) where <table>.updated_at < excluded.updated_at`.
   When the predicate is false the upsert writes **nothing**, then
   `get diagnostics v_affected = row_count; if v_affected=0 and owned → return 'applied'`.
   `functions/sync/push.ts` maps `'applied'` to `{status:"applied"}` and
   `sync/push.ts` calls `markSyncRowSent`. The device's edit is gone with no trace.
   The server predicate is strict `<`, so **equal** timestamps are dropped too —
   which is the provable, reproducible case this batch detects.
4. **`sent` outbox rows are retained forever.** `markSyncRowSent` only flips
   `status`; nothing deletes from `sync_queue`. The last payload this device
   pushed for any `(shop, table, row)` is therefore still on disk and usable as
   the comparison basis — no new echo table is needed.
5. **Append-only tables cannot conflict.** `upsertRemoteRow` uses
   `onConflictDoNothing` for `inventory_movements`, `sale_refunds`,
   `refund_tenders`, `credit_payment_allocations`, `inventory_imports`,
   `audit_logs`. Only the LWW-updated tables can lose a write.
6. **No monitoring exists.** Grep for `Sentry|captureException|reportError`
   across `apps/`, `backend/` returns nothing. `dev/runtimeDiagnostics.ts`
   states in its own header: *"H-8 will add deliberate observability; until then
   production emits nothing from this module."*
7. **D8 confirmed.** `app/sale/confirmation.tsx` has **zero** `useI18n` usage —
   all nine strings are hardcoded English.
8. **D9 confirmed.** `app/reports/sales-history.tsx` has 5 `t(...)` uses but 8
   hardcoded English strings (header title, empty state, refund copy, a11y labels).
9. **D10 confirmed.** `app/(tabs)/inventory.tsx:72` loads with
   `useEffect(..., [reloadMedicines])` and an explicit
   *"Load-once-on-mount"* comment. Tab screens are not remounted on return, so the
   list is stale after Add Medicine. Nine other screens already use
   `useFocusEffect` — the fix is to adopt the existing pattern.
10. **D11 confirmed.** `app/(tabs)/dashboard.tsx:412` renders a fixed `h-14`
    header with no top inset; nothing in `app/` or `components/` calls
    `useSafeAreaInsets`/`SafeAreaView` except `components/auth/AuthShell.tsx`.
    `StandardHeader` already has the correct `safeAreaTop` mechanism — three
    hand-rolled headers simply don't use it.
11. **W4-04 confirmed.** `apps/admin/lib/queries.ts`'s `getPlatformStats` sums
    `sales.total` only. No refund table is read. `apps/admin/lib/adminGrants.test.ts`
    asserts `QUERIED_TABLES === ['sales','shops']` and requires a
    `grant select ... to service_role` migration per queried table;
    `sale_refunds` currently has no such grant.
12. **W4-05 confirmed.** `sync_row_permitted` gates the whole `shops` table on
    one permission (`settings_manage`), and `sync_apply_row_base`'s `shops`
    branch rewrites `name, name_en, phone, latitude, longitude, thana, district,
    location_captured_at` wholesale from the pushed payload. Two gaps follow:
    (a) there is **no field-level owner gate** on shop identity — any caller who
    holds `settings_manage` for any reason rewrites the whole identity row;
    (b) the client and server **disagree** on `settings_manage`:
    `domain/permissions.ts`'s `resolvePermission` hardcodes `false` for every
    non-owner, while `user_has_permission` honours a `user_permissions` override
    row with `key='settings_manage'`. **This is not self-grantable** —
    `20260819000000_staff_device_login.sql` raises `MU015` ("only an owner may
    change permissions"), so no non-owner can write such a row. The exposure is
    owner-initiated only; see W4-05's corrected threat model.
13. **W5-15 preliminary.** A sanitized scan (location + shape only, no secret
    printed) of all tracked files finds 6 credential-shaped strings, all in test
    files, all demonstrably fabricated (`e30.` = base64url `{}`, suffixes
    `.fabricated` / `.fake` / `demo-not-a-real-key`). History pickaxe on
    `sb_secret_` and `eyJhbGciOiJIUzI1NiI` surfaces 8 commits; every hit resolves
    to either those fixtures or a base64 **pagination-cursor example** in
    `.claude/skills/api-design/SKILL.md`. No decodable `role: service_role` token
    bound to the DEV project ref was found. §2 W5-15 defines the remaining work
    needed to close the verdict.

---

## 2. Task-by-task architecture and exact changes

### W3-01 — H-6 conflict queue (durable detection + persistence)

**The mechanism.** A conflict is recorded at **apply time**, inside the same
transaction that applies (or discards) the pulled row, by comparing the arriving
remote row against this device's own outbox history for the same key. Two
provable cases:

| Reason code | Condition | Why it is a real conflict |
|---|---|---|
| `pull_local_pending` | the newest `sync_queue` row for `(shopId, tableName, rowId)` has status `pending` or `failed` **and** the arriving remote row differs from the local row on a *comparable* field (§2 "Comparable fields") | whichever side LWW picks, the other side's change is at risk: either the local unpushed edit is overwritten on disk, or the remote edit is discarded and the local edit will later overwrite it |
| `push_superseded` | the newest `sync_queue` row for that key has status `sent`, **and** `remote.updated_at` is **exactly equal** to `pushed.updated_at`, **and** the remote row differs from the pushed payload on a *comparable* field | provably a silent server-side LWW drop. The server's predicate is `<`, so an equal timestamp wrote nothing while `sync_apply_row` still answered `'applied'`. The server row is therefore somebody else's write at the same instant, and a difference on a client-owned field proves our content is not there |

**Revision 2 narrowed `push_superseded` from `<=` to exact equality.** Revision 1
also fired on `remote.updated_at < pushed.updated_at`, which proves nothing: if
the server row is *older* than our push, the predicate was TRUE and our push
applied — the older row simply came from a pull page fetched before our push
landed. That is a stale read, not a lost write, and treating it as a conflict
would queue a false positive on every overlapping push/pull.

Everything else is ordinary, correct LWW and is **not** queued. The plan
deliberately does not guess at `remote.updated_at > pushed.updated_at` cases:
a later writer legitimately winning is not a failure, and flagging it would fill
the queue with noise a shopkeeper cannot act on.

#### Comparable fields

The diff is field-scoped, and the exclusion list has to be **complete** or
`push_superseded` false-positives on the server's own legitimate rewrites. A
field is comparable only when it is both:

1. named in that table's server `on conflict (id) do update set (...)` list, and
2. not **server-owned** — not pinned by any effective `sync_apply_row` wrapper,
   not stripped outbound by `toSyncPayload`, and not preserved locally by
   `applyToTable`.

The server-owned set, derived from the effective wrapper chain:

| Table | Server-owned fields | Source |
|---|---|---|
| `batches` | `stock`, `oversold_at` | base dispatcher pins both from the server (`20260818000100`); `applyToTable` preserves both locally |
| `shops` | `plan`, `trial_ends_at`, `billing_account_id`, `commercial_status`, `commercial_reason`, `archived_at`, `cloud_linked_at` | B4 wrapper pins the first six (`20260831000000`); `toSyncPayload` strips `cloudLinkedAt` |
| `users` | `permission_version`, `pin_lookup_tag`, `pin_lookup_pin_set_at`, `plan_suspended_at`, `plan_suspension_reason`, `access_locked_at`, plus the actor-dependent `role_id`, `is_active`, `is_deleted`, `pin_hash`, `pin_set_at` | `toSyncPayload` strips the first six; the rest are rewritten by the staff-device wrapper and by `revokeSessionsIfNeeded` |
| `sales` | `tax_amount`, `tax_rate_bp`, `tax_label` | `20260827010000` refuses a changed snapshot with `MU024` and then **pins all three to the existing values** on any update. Client-defaulted on insert only, which `push_superseded` never examines |
| `expenses` | `category` | `functions/sync/push.ts` rewrites it through `canonicalizeExpensePayload` before apply, so a pushed value can legitimately come back canonicalised |
| `sale_attachments` | `local_uri`, `upload_status`, `upload_error` | `toSyncPayload` strips all three |

**Explicitly CLIENT-owned, and therefore comparable** — listing these matters as
much as the exclusions, because wrongly excluding a field blinds the detector:

| Table | Field | Why it is client-owned |
|---|---|---|
| `cash_drawer` | the B3 reconcile columns | `20260823020000` fills them **only when the key is absent** (`if not p_row ? '…'`), and its own comment says *"explicit JSON null from a new client remains an intentional value under the ordinary LWW contract."* `recordChange` always sends a complete row, so the client's value always wins |
| `users` | `address`, `email` | `push.ts`'s `applyUserProfileFields` writes the **client's** values in a separate statement predicated `.lte('updated_at', pushed)`, so on the equal-timestamp drop they land even though the main upsert did not. Revision 3 wrongly listed them as server-owned |
| `shops` | `name`, `name_en`, `phone`, `latitude`, `longitude`, `thana`, `district`, `location_captured_at` | **client-owned TODAY.** W4-05's wrapper would pin them for non-owner callers, but W4-05 is deferred (§14), so no wrapper pins them and nothing rewrites them. Revision 3 excluded them anyway, which bought nothing and cost an equal-timestamp blind spot on the Owner's own shop-profile edit |

**The `shops` identity fields track whether W4-05 is applied, and the guard test
is what makes that safe.** Today nothing pins them, so they are client-owned and
comparable. When W4-05 is promoted into the chain in Batch 3 they become pinned
for non-owner callers, and the declaration must move them to server-owned. That
is not left to memory: the guard test parses the *actual* chain, so the moment
W4-05's wrapper lands the test fails until the declaration is updated. The
forcing function is the point — revision 3 pre-emptively excluded them "so the
detector is correct before and after", which bought nothing (no wrapper exists
yet) and cost a real equal-timestamp blind spot on the Owner's own edit.

**This table took four review rounds to get right**, and every single error was
in the same direction — excluding a field that is actually client-owned, which
blinds the detector *silently* rather than failing loudly. That asymmetry is why
the guard test is mandatory rather than nice-to-have, and why the client-owned
column above is written out explicitly instead of being left implicit.

**This list is mechanically guarded, not asserted.** A new pure module
`apps/mobile/domain/serverOwnedFields.ts` declares it, and
`apps/mobile/tests/server-owned-fields.test.ts` parses **four** sources and fails
on drift against any of them:

1. each table's `on conflict do update set (...)` column list in the migration SQL;
2. every effective wrapper's `jsonb_build_object(...)` pin list — including the
   *conditional* `if not p_row ? '…'` form, which must be classified as
   client-owned, not server-owned;
3. `toSyncPayload`'s `delete payload.*` lines and `applyToTable`'s preservations
   in `sync-helpers.ts`;
4. **`functions/sync/push.ts`'s `applyUserProfileFields`** — the `address`/`email`
   write lives in TypeScript, so a SQL-only parser would miss it entirely.

Same read-the-source technique `adminGrants.test.ts` and
`migration-rollback-classification.test.ts` already use. It is what converts "the
list is complete" from a claim into a test — and the two errors revision 2 made
in this very table are why the test is in scope rather than optional.

**Alternative not taken.** Stamping the pushing actor onto each outbox row would
let the detector reason about actor-dependent `users` fields instead of excluding
them. Rejected: it adds a column and a write to the hot sale path to buy
detection on a table whose conflicts are security state rather than shop data,
and excluding those fields is strictly safer. Recorded so the choice is visible.

**Tables in scope.** Only LWW-updated tables. Excluded as structurally
conflict-free (`onConflictDoNothing` / append-only):
`inventory_movements`, `sale_refunds`, `refund_tenders`,
`credit_payment_allocations`, `inventory_imports`, `audit_logs`.

**Deduplication.** A partial unique index on `(shop_id, table_name, row_id)
WHERE resolved = 0` makes one unresolved conflict per row the hard invariant.
A repeat detection bumps `occurrences`, refreshes both snapshots and
`updated_at`, and leaves `created_at` as the first sighting. This is what keeps a
pull that re-delivers the same page from growing the table without bound.

**Retry handling — detection is FAIL-SOFT.** Revision 1 let the detector throw,
reasoning that it "cannot fail for data reasons". That was wrong:
`sync_queue.payload` is unvalidated `TEXT`, so a legacy or corrupt payload makes
`JSON.parse` throw inside the apply transaction. A throw there wedges the pull —
full hydration loses the entire apply, and incremental pull loses the page
*without advancing the cursor*, so it re-fetches the identical page forever. The
deferred-row throw `applyRemoteRows` already performs is safe only because a
parent arriving later changes the outcome; a malformed payload never does.

So: detection is wrapped, parses with the guarded reader already in the file
(`parseProtectedPayload`'s shape-checking pattern), and on **any** failure
records nothing, throws nothing, and emits a `sync.conflict_detector.failed`
event to the W3-04 sink. The pulled row still applies. A conflict notice is worth
less than the sync that carries the shop's money, and the failure is visible
rather than swallowed.

**Files**

| File | Change |
|---|---|
| `apps/mobile/db/migrations/0031_h6_conflict_queue.sql` | **new.** `ALTER TABLE conflict_queue` → `reason`, `local_updated_at`, `remote_updated_at`, `detected_by`, `occurrences`, `updated_at`, `resolved_at`, `resolution`, `superseded_payloads`; partial unique index `conflict_queue_unresolved_row_unique`; index `conflict_queue_shop_resolved_idx`. No FKs, with the reason stated in the header |
| `apps/mobile/db/migrations/meta/_journal.json` | **edit.** append entry `idx: 31, tag: "0031_h6_conflict_queue"` |
| `apps/mobile/db/migrations/migrations.js` | **edit.** `import m0031` + registry entry |
| `apps/mobile/db/schema.ts` | **edit.** extend `conflictQueue` with the new columns + both indexes |
| `apps/mobile/db/conflicts.ts` | **new.** `recordConflict`, `listConflicts`, `countUnresolvedConflicts`, `resolveConflict`, `purgeConflictsForTables` |
| `apps/mobile/domain/conflictTables.ts` | **new, pure.** `CONFLICT_TABLE_GATES`: per-table read gate + write gate, mirroring `sync_row_permitted`; `CONFLICT_EXEMPT_TABLES` |
| `apps/mobile/domain/serverOwnedFields.ts` | **new, pure.** the per-table server-owned set and `comparableFields(table)`, guarded by a migration-parsing test |
| `apps/mobile/db/sync-helpers.ts` | **edit.** `applyToTable` calls the fail-soft detector before its LWW decision; the derived-field preservation it performs for `batches`/`users` is extracted into a shared `preservedLocalFields()` so W3-02's force-apply reuses one definition; `purgeUnreadableTables` also deletes conflict rows for now-unreadable tables |

### W3-02 — conflict resolution UI

**Permission model.** Visibility and resolution are separate, and both derive
from `domain/conflictTables.ts` so the client expresses the same rule the server
does:

- **visible** when the actor passes the table's *read* gate (Owner always passes);
- **resolvable** when the actor passes the table's *write* gate;
- a conflict the actor may see but not resolve renders read-only with the reason,
  not a disabled-looking button that would fail.

**Resolution semantics.**

- `keep_local` — re-reads the local row and re-enqueues it through the existing
  `recordChange` with a **fresh `updatedAt`**, so the next push beats the server's
  timestamp instead of being dropped by the same `<` predicate. It inherits
  `recordChange`'s commercial read-only gate for free.
- `keep_remote` — **a dedicated force-apply path, not `applyRemoteRow`.**

**Why revision 1's `keep_remote` was broken.** `applyRemoteRow` routes through
`applyToTable`, which returns `skipped_stale` the moment
`local.updatedAt >= remote.updatedAt`. Every conflict this feature detects is
*by definition* a row where local is newer or equal — so `keep_remote` would
have been a silent no-op on 100% of real cases. Two further defects in the same
place: the local `pending`/`failed` outbox rows would survive and overwrite the
chosen remote value on the next push, and a row belonging to an atomic operation
group cannot have one member cancelled without breaking the group.

Revision 2:

1. **Force-apply.** `db/conflicts.ts` gains `forceApplyConflictRow(tx, table,
   remoteRow)`, which deliberately bypasses the LWW gate and writes the stored
   snapshot through `upsertRemoteRow`, merged with `preservedLocalFields()` —
   the helper extracted from `applyToTable` in W3-01, so `batches.stock`,
   `batches.oversoldAt` and `users.accessLockedAt` are preserved by the *same*
   code path rather than a second copy of the rule.
2. **Supersede the local side — by DELETING the outbox row.**
   Two earlier attempts were both wrong. Revision 2 used
   `markSyncRowPermanentFailure`, which would have re-detected the conflict on
   every pull, raised false stuck-sync warnings, and — worst — kept the payload
   protected from the ACL purge by `protectedOutboxGraph`. Revision 3 added a
   `superseded` status to fix the first two, and claimed it fixed the third. It
   did not: **`purgeUnreadableTables` never deletes `sync_queue` rows at all**, so
   the payload stays on disk under any status.

   Revision 4 deletes the row, and revision 5 fixes its audit claim. Revision 4
   said `conflict_queue.local_value` already holds the discarded payload. It does
   not: `local_value` is a snapshot of the **local row at detection time**, which
   is not the same bytes as the queued payload — `recordChange` serialised that
   payload earlier, the local row may have changed since, and several queued rows
   may exist for one key. So `conflict_queue` gains
   **`superseded_payloads`**, a JSON array of the exact deleted rows
   (`{id, seq, op, payload}`), written in the same transaction as the delete.
   The audit trail is then byte-exact, and because it lives in `conflict_queue`
   it is removed by §5's purge extension when the actor loses read access to that
   table — which is the property the `superseded` status could never give it.

   Deleting is otherwise safe, and the reviewer confirmed each point against the
   code: `nextSeq` uses `max(seq)+1` so a gap is harmless; releasing
   `protectedOutboxGraph`'s FK protection is correct because the work is
   abandoned; `listPendingSyncRows` and `completeHeadGroup` only ever saw
   `pending` rows; and no ledger trigger is involved. Only **standalone** rows
   are ever deleted — grouped rows refuse `keep_remote` (3).
3. **Grouped operations: `keep_remote` is not offered.** When any outbox row for
   the key carries an `operation_group_id`, the conflict renders with
   `keep_local` only and an explanation. Cancelling one member of a sale, refund
   or purchase group would leave a torn operation, and a torn money operation is
   worse than an unresolved notice. Stated in the UI, not silently disabled.
4. The whole resolution is **one transaction** — snapshot apply, outbox
   supersession and the `resolved`/`resolved_at`/`resolution`/actor stamp commit
   together or not at all.

Both resolutions run under `assertSessionLive`, so a device handover
mid-resolution throws `StaleSessionError` rather than attributing the decision to
the wrong person.

**Safe resynchronization.** Resolving does not trigger a sync itself. It writes
the outbox row (or the supersession) and lets the existing engine drain it on its
own schedule, so a resolution taken offline is durable and a resolution taken
online is not racing the cycle that is already running. Convergence after the
next successful cycle is asserted, not assumed (§8 row 2).

**Files**

| File | Change |
|---|---|
| `apps/mobile/app/sync-conflicts.tsx` | **new.** permission-filtered list, per-row Keep-this-device / Keep-server actions, offline notice, error state, empty state via the existing `EmptyState` primitive |
| `apps/mobile/navigation/routes.ts` | **edit.** `RULES` entry `{ prefixes: ['/sync-conflicts'], dataGate: 'authenticated' }` (per-row filtering does the real work) + a `moreRoutes` entry |
| `apps/mobile/app/settings/settings.tsx` | **edit.** a row linking to `/sync-conflicts` with the unresolved count |
| `apps/mobile/i18n/catalog.ts` | **edit.** `en`/`bn` keys for every string the screen renders |

### W3-04 — H-8 monitoring core

A provider-agnostic sink with **no** hosted dependency. Hosted deployment is
explicitly later-production acceptance, per the batch brief.

**Architecture.**

```
domain/errorRedaction.ts   pure. allowlist-based scrubbing + shape classification
monitoring/report.ts       reportError / reportMessage / configureMonitoring
monitoring/sink.ts         bounded device-local ring buffer (MMKV), offline-safe
monitoring/provider.ts     the provider interface; UNSET by default => no-op
```

**Redaction is a closed-enum DTO, not a scrubber.** Revision 1 kept
`error.name` and reduced stacks to basenames. Both leak:

- `error.name` is caller-assignable — `const e = new Error(); e.name = pin` is legal;
- a stack's **first line is the message**, so "basename-only frames" still ships it
  unless the first line is dropped;
- stack source URLs can be `data:`/`eval`/query-bearing and carry tokens;
- `cause` recurses into arbitrary objects.

Revision 2: the provider interface accepts **only** a `MonitoringReport` DTO
whose every field is runtime-validated:

| Field | Type | Rule |
|---|---|---|
| `event` | closed enum | e.g. `db.init.failed`, `sync.cycle.failed`, `sync.conflict_detector.failed` |
| `errorKind` | closed enum | mapped from `error.name` through a known-name table; **anything unrecognised becomes `'unknown'`** |
| `route`, `component`, `syncPhase` | closed enums | never a live pathname, never a query string |
| `attempt` | non-negative integer | clamped |
| `contextKeysPresent` | `string[]` of enum keys | names only, never values |

`error.message`, `error.cause` and the stack are **discarded, not redacted** —
there is no code path that forwards them. Batch 1 ships **no stack capture at
all**; adding one is a later, separately reviewed change, because a safe stack
needs a validated module-id allowlist that does not exist yet. Losing the stack
costs debuggability; keeping it costs a possible PIN in a crash report, and rule 8
is absolute.

`dev/runtimeDiagnostics.ts` keeps its DEV-only raw message/stack/userId/shopId/
route and is **deliberately not wired to the provider**. The two must stay
disconnected; a test asserts the monitoring module graph does not import it.

**Offline-safe.** Writes go to a bounded MMKV ring buffer (fixed capacity, oldest
evicted). Nothing is awaited, nothing throws into the caller: `reportError`
returns `void` and swallows its own failures, because an error reporter that can
fail a sale is worse than no reporter.

**No-op without a provider.** With no provider configured, `reportError` records
to the ring buffer and returns. Nothing is sent anywhere. A static test asserts
no network call exists in the module graph.

**Recovery/startup reporting.** `db/init.ts` reports `db.init.failed` /
`db.recovery.pending`; `sync/index.ts` reports `sync.cycle.failed` with the
skip-reason slug; `payment-webhook` stays out of scope (hosted).

**Files**

| File | Change |
|---|---|
| `apps/mobile/domain/errorRedaction.ts` | **new, pure** |
| `apps/mobile/monitoring/report.ts`, `sink.ts`, `provider.ts`, `index.ts` | **new** |
| `apps/mobile/db/init.ts` | **edit.** report init/recovery failures |
| `apps/mobile/sync/index.ts` | **edit.** report a failed cycle and a halted sync |
| `apps/mobile/dev/runtimeDiagnostics.ts` | **edit.** replace the "H-8 will add…" note with the actual wiring note |

### W3-06 — payment integration testing (synthetic only)

No merchant request, no credential, no live transaction. Every provider call is a
`fetcher` double, exactly as the existing `sslcommerz.test.ts` does.

**Coverage added** (the existing file already covers config fail-closed, paisa
conversion, checkout-host allowlisting, hash contract and
`verificationMatchesOrder`; this does **not** re-cover those):

1. `initiateBilling` — non-owner refused; `clientRequestId` idempotency returns
   the same order; a second open order for a *different* tier returns 409
   `payment_in_progress`; incomplete owner profile returns 422; Ultra→Pro inside
   a paid term returns 409 `downgrade_at_expiry`; a provider failure flips the
   order to `failed/init_failed` and never leaves it `created`.
2. `finalizeBillingAttempt` — only `failed`/`canceled` accepted; a non-UUID
   `orderId` is 400; another account's order is 404; an already-terminal order is
   returned rather than re-written.
3. Webhook validation — forged `verify_sign` → 400; `verify_key` naming
   `store_passwd` → refused; missing `val_id` on a non-terminal return → 400;
   oversize body → 413; per-IP rate limit → 429; non-POST → 405.
4. Finalization + idempotency — a verified `val_id` applies once; re-delivery of
   the same `val_id` upserts on `(provider, validation_id)` and grants exactly
   one entitlement; a tampered amount is recorded as
   `rejected/verification_mismatch` and grants nothing.
5. Security — `b4_apply_verified_payment` is the only write path; no
   client-supplied field reaches an entitlement; the browser return is a 303 to
   the configured scheme only.
6. `PlanPaymentScreen` — a non-owner cannot initiate; `status=canceled`/`failed`
   deep-link params render the terminal card without a network call; the polling
   effect clears its interval on unmount; the plan activates **only** from
   server-reported `verified`.

**Files**: `backend/supabase/functions/sync/payment-integration.test.ts` (new),
`backend/supabase/functions/payment-webhook/webhook.test.ts` (new),
`apps/mobile/tests/plan-payment.test.tsx` (new), plus `vitest.config.ts` includes.

> **Compatibility note.** `payment-webhook/index.ts` is a single file whose
> `Deno.serve(...)` call runs at import time, so it cannot be imported under
> Node. Its testable units (`bodyFields`, `rateLimited`, `browserReturn`, and the
> request pipeline) are therefore extracted into
> `backend/supabase/functions/payment-webhook/handler.ts`, and `index.ts` becomes
> the `Deno.serve` wiring only. This mirrors exactly how
> `functions/sync/index.ts` (9 lines) already separates wiring from `handler.ts`,
> and how `auth-send-sms` is split. No behaviour changes.

### W3-08 — localization (D8/D9 + verified siblings)

Only **verified** hardcoded-English defects, using the existing
`catalog.ts` + `useI18n()` architecture. No new i18n machinery.

| File | Strings |
|---|---|
| `app/sale/confirmation.tsx` (D8) | all 9 — header, "Sale saved", Invoice/Total/Payment/Change labels, the `capitalize`d payment type (replaced with a localized label, since `capitalize` on `cash` cannot be translated), "New Sale", the a11y label |
| `app/reports/sales-history.tsx` (D9) | header title, "No sales found", "Sale" fallback, "Refund committed" + body, "Claiming authority…", "Full refund", "Internet required for refund", a11y labels |
| `app/inventory/batches.tsx` | "Something went wrong" / "Please try again." |
| `app/inventory/expiry.tsx` | "Cannot apply bulk promotion", "Cannot promote batch", "Cannot reverse promotion", "Try again." ×3 |
| `app/sale/held.tsx` | "Cannot resume", "Cannot cancel", "Try again." ×2 |

**Guard.** `apps/mobile/tests/localization-coverage.test.ts` (new) reads these
files as source — the same technique as `tests/font-tokens.test.ts` and
`tests/dev-production-safety.test.ts` — and fails if a user-visible string
literal reappears in them. Scoped to the files this batch fixes, so it is a
ratchet rather than a repo-wide gate that would fail on day one.

### W3-09 — inventory refresh on focus (D10)

Replace the load-once `useEffect` with `useFocusEffect` + the existing
`domain/latestRequestGuard.ts`, so:

- returning from Add/Edit Medicine shows the new row;
- a slow earlier load cannot overwrite a newer one (the stale-result defect the
  guard module exists for);
- repeated focus events do not stack concurrent reads;
- expanded batch rows are re-read rather than served from a stale
  `batchesById` cache for a medicine whose batches changed.

**Files**: `app/(tabs)/inventory.tsx`, and a regression test
`apps/mobile/tests/inventory/inventory-focus-refresh.test.tsx` (new).

### W3-10 — UI consistency

Four narrow, behavioural fixes. **No visual redesign.**

1. **D11 safe area.** The three hand-rolled headers
   (`app/(tabs)/dashboard.tsx`, `app/(tabs)/staff-home.tsx`,
   `components/staff/ManagerDashboard.tsx`) read
   `SafeAreaInsetsContext` and pad by `insets.top`, using the exact
   `useContext(SafeAreaInsetsContext) ?? ZERO_INSETS` degradation
   `components/auth/AuthShell.tsx` already established (so a screen rendered
   outside the provider gets 0 instead of throwing). This is what un-swallows the
   language toggle, menu, sync and bell taps at `y ≤ 45px`.
2. **Alert → Toast, for confirmations only.** `sales-history.tsx`'s
   "Refund committed" success `Alert` becomes a `showToast({variant:'card'})`.
   Failure and destructive-confirmation `Alert`s stay as dialogs, because
   `components/ui/Toast.tsx`'s own contract says *"a toast is never how a failure
   is reported"* and a confirmation needs a button. Stated rather than silently
   decided.
3. **Touch targets.** Every control changed in this batch carries a ≥44×44
   effective target via `hitSlop` where the visual box is smaller, matching
   `LanguageToggle`'s existing `hitSlop` precedent.
4. **Semantic tokens.** Replace raw hex literals with the tokens that already
   exist for exactly those values in `packages/constants/src/tokens/colors.json`
   — `#047857`→`authHeroEnd`, `#FEF3C7`→`warningBg`, `#92400E`→`authWarningInk`,
   `#D1FAE5`→`authRingEnd`, `#FEE2E2`→`authErrorCard`, `#9CA3AF`→
   `authPlaceholder`, `#ECFDF5`→`softGreen` — in the files this batch already
   touches. Where no token exists (`#A7F3D0`, `#0066B3`, `#E6F2FA`, `#FCA5A5`,
   `#F5F5F5`), **add** the semantic token rather than inventing a second palette.

**Guard**: `apps/mobile/tests/ui-consistency.test.ts` (new) — static assertions
that the three headers consume the inset context and that the touched files hold
no raw hex. Functional a11y assertions live in the render tests.

### W3-11 — core workflow regression

One cohesive synthetic integration suite on **real** `node:sqlite`, driving the
real `db/` functions across a full business day, asserting after **every** step:

```
INVARIANT      batches.stock == SUM(inventory_movements.change_qty)   (per batch)
ACCOUNTING     netSales     == saleTotal − refundTotal
               taxCollected == saleTax   − refundTax
               cashSales    == cash_applied − refundCash
               drawer       == opening + cash in − cash out      (Volume 3 formula, unchanged)
MONEY          every amount is an integer Paisa; no float appears anywhere
```

Flow: open the drawer at 0 → create a supplier → purchase + receive (stock in) →
sale (cash) → sale (credit) → customer payment → **full-sale refund** (the only
refund shape this codebase implements — see W4-04) with its per-line
`sales_returns` rows → purchase return → expense → read `db/reports.ts` totals →
close the day.
Then the offline half: queue the same operations with the network double
refusing, assert the outbox holds complete operation groups, assert the ledger
invariant still holds locally, then let the push double succeed and assert
nothing double-applies.

**File**: `apps/mobile/db/core-workflow-regression.sqlite.test.ts` (new).
Deliberately one file, not six: the defects this catches are the ones that only
appear when the workflows run **in sequence against shared state**, which is
precisely what the existing per-feature suites cannot see.

### W4-04 — admin revenue correction

`getPlatformStats` becomes refund-net, reusing the mobile app's canonical
definition instead of inventing a second one:

```
netSalesToday = Σ sales.total                  (is_deleted = false, business_date = Dhaka day)
              − Σ sale_refunds.total_amount    (is_deleted = false, business_date = Dhaka day)
```

- **No write path in this codebase produces a partial sale refund.**
  `db/refunds.ts`'s `refundValues` always sets `totalAmount: sale.total`;
  `unique(shop_id, sale_id)` permits exactly one refund row per sale; the server
  raises `MU024` unless the operation carries exactly one deterministic refund
  header; `push.ts` refuses an ungrouped `sales_returns` row outright; and the one
  `insert(salesReturns)` in business code always sets `refundId`. So every refund
  the app can create today is **full-sale**, and the tests say so. Revision 1
  planned partial-refund tests, which would have asserted behaviour the
  repository forbids.
  **Precision revision 2 got wrong:** `sales_returns.refund_id` is *nullable* on
  both stores, so this is a property of the current write path, not a schema
  guarantee — a row predating the refund-header model can exist with
  `refund_id IS NULL`. §12 item 12 records what that means for the figure.
- **Cancellation** is `sales.is_deleted = true`, already excluded.
- **Duplicate processing** — the sum is over distinct primary keys, and the unique
  constraint makes a second refund row for a sale impossible. Asserted explicitly
  as a negative control.
- **Day boundary — `business_date` for BOTH sides.** Revision 1 kept sales on
  `created_at` and put refunds on `business_date`, calling the asymmetry
  conservative. It is a defect: the two windows disagree for any row whose
  business date was backfilled (`20260827000000`) or whose device clock diverged
  from Dhaka midnight, so a sale could be counted on one day and its refund on
  another. `db/reports.ts` uses `business_date` for both; the admin panel now
  matches it exactly. `sales.business_date` exists and is backfilled on the
  server, so this is a read-side change only.
- **One definition, shared.** `DEVELOPMENT_RULES.md` forbids duplicating business
  logic between mobile and admin. The subtraction therefore lands in
  `packages/utils/src/netSales.ts` (built on `packages/types`' `subtractPaisa`),
  exported from the barrel, and consumed by `apps/admin` — not re-implemented as
  an admin-only `netSalesTotal`.
- **Tenant isolation** — the admin panel is deliberately cross-shop (it is the
  platform total). The isolation assertion is therefore that *per-shop*
  attribution never mixes: a refund in shop A reduces only the total it belongs
  to, and `listPharmacies` still exposes no sale or refund figure per shop.
- **Query-level behaviour** — the refund read goes through the same
  `readAllPages` pager as sales, so paging, the `is_deleted` filter and the
  `AdminDataError` path get their own test rather than being assumed.
- **Label** — the card reads "net of refunds" so the figure is not read as gross.

**The grant migration is BLOCKED (§14).** `sale_refunds` has no `service_role`
SELECT grant, `adminGrants.test.ts` proves BYPASSRLS does not substitute for one
(it is how the panel died with `42501` the first time), and the grant cannot be
added without breaking the H-9 chain seal. So the `queries.ts` read and the page
label are held for Batch 3, and **the dashboard still reports gross until then.**
What ships now is the shared definition and the arithmetic, fully tested, so the
held change is a two-line diff rather than a re-design.

**Files shipping in Batch 1**: `packages/utils/src/netSales.ts` (**new**, shared)
+ its barrel export and `packages/utils/src/netSales.test.ts`;
`apps/admin/lib/platformStats.ts` (`SaleRefundTotalRow`, `sumRefundTotals`, day
range applied to `business_date`); `apps/admin/lib/platformStats.test.ts`
(extend).

**Held for Batch 3**: `apps/admin/lib/queries.ts`, `apps/admin/app/page.tsx`,
`apps/admin/lib/adminGrants.test.ts`, `apps/admin/lib/queries.test.ts`, and the
grant migration + its manifest and rollback-document regeneration.

### W4-05 — shop sync permissions

#### Corrected threat model (revision 2)

Revision 1 claimed a Manager holding `staff_management` could self-grant
`settings_manage` and rewrite the shop. **That chain is already blocked.**
`20260819000000_staff_device_login.sql` raises `MU015` — *"only an owner may
change permissions"* — with a comment saying exactly why. A non-owner cannot
write `user_permissions` at all, and `hasPermission` gives no non-owner
`settings_manage` by default, so **there is no exploitable non-owner path to a
`shops` write today.**

What remains is real but **owner-initiated**: an Owner *can* write
`user_permissions`, and the server *does* honour a row with
`key='settings_manage'` (`user_has_permission`, `20260831000000:313`), while the
client hardcodes `false` for every non-owner (`domain/permissions.ts:166`). The
product UI never offers the key — it is absent from `PERMISSION_KEYS` — so the
two layers disagree about a capability the product does not expose. Any path
that writes such a row (a tampered client, a future UI, a support script) hands
a Manager the entire shop identity row through whole-row LWW. W4-05 closes that
divergence and adds a second, independent barrier.

So this task is **preventive hardening of a latent divergence**, not the closure
of a live hole. Stated plainly because claiming otherwise would overstate the
batch.

**(a) Permission gate, tightened.** `sync_row_permitted`'s `shops` arm becomes
**owner role**, not `settings_manage` — matching what `domain/permissions.ts` has
always told the product.

The `subscriptions` arm is **left alone**. Revisions 1–3 all proposed changing
it; all three were wrong. The *effective* definition is the B4 wrapper
(`20260831000000:425`, which renamed the previous one to
`sync_row_permitted_pre_b4`), and its very first branch is already
`when p_table='subscriptions' then false` — for everyone, Owners included. The
`when 'subscriptions' then true` I kept citing belongs to a **different
function**, `sync_table_readable` (`20260907000000:228`), which is the pull-side
*read* ACL and has nothing to do with push permission. Changing the arm would
have been a no-op dressed up as hardening.

**(b) Field-level pin on shop identity, as independent defence.** The same
migration wraps `sync_apply_row` so that when the caller is not the shop's owner,
`name`, `name_en`, `phone`, `latitude`, `longitude`, `thana`, `district` and
`location_captured_at` are pinned to the server's current values — the exact
mechanism `20260831000000_b4_commercial_platform.sql` already uses for the
commercial fields (`v_row := p_row || jsonb_build_object('plan', v_shop.plan, …)`).

With (a) in place this pin is **redundant by design**, and that is the point: the
gate and the pin fail independently, so a future change that loosens one does not
expose the identity row. Revision 1 justified pinning as "preserving legitimate
staff workflows" — there are none to preserve. Registration is owner-only; shop
rename/archive/restore go through the SECURITY DEFINER `b4_mutate_owned_shop`
RPC, which never consults `sync_row_permitted`. The pgtest therefore asserts the
honest property: **no currently-working path is refused.**

**ACL discipline (required for a rename-and-replace wrapper).** Following
`20260907020000_h7_fix_pass_b.sql`'s precedent, the migration must:

1. rename the current `sync_apply_row(text,text,jsonb,uuid,uuid,text)` to
   `sync_apply_row_pre_w405` only if that name does not already exist
   (`to_regprocedure` guard, so a replay is idempotent);
2. create the new wrapper at the original signature;
3. `revoke execute` on **both** from `public`, `anon`, `authenticated`;
4. `revoke execute` on `sync_apply_row_pre_w405` from `service_role` — the
   implementation must be unreachable except through the wrapper;
5. `grant execute` on the wrapper to `service_role` only.

Omitting step 4 would leave the un-gated implementation callable by the Edge
function's own role, which is the whole hole restated.

**Files in Batch 1 — NOTHING under `backend/supabase/migrations/`:**

| File | Note |
|---|---|
| `backend/supabase/proposed/w405_shop_identity_owner_fields.sql` | **new.** Outside the migration chain, so `migrationFiles()`, `rollback-classification.json`, the rollback documents, `scripts/h9-prod-preflight.mjs` and `h9_postmigration_checks.sql` are all untouched |
| `backend/supabase/pgtest/w405-shop-identity.pgtest.ts` | **new.** Loads that file by path and executes it in PGlite on top of the real chain, like `h7-security.pgtest.ts` does for its own migrations |
| `vitest.config.ts` | include the new pgtest |

**Classification, recorded for Batch 3 and NOT acted on here.** When this SQL is
eventually promoted into the chain it is class **`B`**, not `A`:
`scripts/classify-migrations.mjs` defines `B` as *"redeployable: ships a
function, policy, trigger or constraint whose previous definition is in git"*,
and this ships `create or replace function`; its rollback is a redeployment of
the previous definition, not an inverse DDL. Promotion will then also need
`rollback-classification.json`, the three generated documents, and
`apps/mobile/tests/migration-rollback-classification.test.ts` (which hardcodes
`pg.length` as `34` **twice** plus the counts in a test title, deliberately).
**None of that happens in Batch 1** — it is written down so Batch 3 does not have
to rediscover it.

> **Rollout caveat, stated explicitly.** W4-05 adds **no migration file** in this
> batch — not to the chain and not applied anywhere (§14). Its SQL lives at
> `backend/supabase/proposed/w405_shop_identity_owner_fields.sql`, which no
> migration runner, manifest, rollback document or H-9 check reads, and the
> deployed `sync` function is unchanged, so nothing about today's running system
> moves. Promotion into the chain and application are Batch 3 items alongside the
> H-9 hosted work. **The shop-identity gap therefore stays open on the server
> throughout Batch 1** — that is stated here rather than left to be inferred from
> the fix existing.

### W5-15 — DEV credential exposure assessment (private, sanitized)

No secret material is printed, quoted, or committed. Method:

1. Enumerate every credential-shaped string in the tracked tree and in the full
   public commit history, reporting **location + length + decoded role claim
   only** via a scanner kept in the session scratchpad, never in the repo.
2. Classify each as fabricated fixture / public identifier / real material.
3. Check the four places a *partial* key could hide and a shape scan would miss:
   truncated prefixes in `docs/`, `DECISIONS.md` prose, error/log strings, and
   the `apps/mobile/config/environmentPolicy.ts` fingerprints.
4. Confirm the published surface: `apps/admin`'s four-mechanism credential model
   (`lib/env.ts` naming, `server-only` imports, zero client components,
   `lib/errors.ts` sanitization) and `tests/eas-archive.test.ts`'s
   `archive-secret-material` refusal.
5. Write `docs/plans/muthoy-w5-15-dev-credential-assessment-2026-10-20.md`: a
   sanitized verdict, the evidence as counts and locations, the residual risk,
   and the rotation recommendation.

**Rotation is NOT performed.** It requires separate founder authorization and
this plan does not ask for it.

---

## 3. Dependencies and internal ordering

```
W3-04 monitoring        ─┐   (the detector's fail-soft path reports through it)
domain/conflictTables   ─┼─► W3-01 conflict queue ─► W3-02 conflict UI
domain/serverOwnedFields┤                              (shares catalog keys)
W3-08 localization      ─┘

packages/utils/netSales ──► W4-04 admin revenue

W3-09, W3-10, W3-06, W3-11, W4-05, W5-15   independent
```

Three real dependencies: W3-04 before W3-01 (the fail-soft detector needs the
sink), W3-01 before W3-02, and the shared `netSales` before W4-04's admin edit.
Everything else can be implemented in parallel and merged into one Batch 1 diff.

**Shared-file contention** (one writer at a time, to avoid a self-inflicted merge
conflict): `apps/mobile/i18n/catalog.ts`, `vitest.config.ts`,
`DECISIONS.md`. (`rollback-classification.json` is **not** in this list any more —
nothing in Batch 1 writes to it.)

---

## 4. Compatibility

| Risk | Resolution |
|---|---|
| New SQLite migration on an existing device | `0031` is additive `ALTER TABLE` + `CREATE INDEX` only. `conflict_queue` is empty on every device in existence (nothing has ever written to it), so the partial unique index cannot fail on legacy data |
| Drizzle snapshots | `meta/` only carries snapshots to `0017`; migrations `0018`–`0030` are hand-written SQL + journal entries. `0031` follows that established pattern; `db:generate` is not run |
| `db/test/migrations.ts` | reads the journal and SQL off disk, so it picks `0031` up with no change |
| Deployed `sync` Edge function | unchanged. The conflict detector is entirely client-side and needs no new server field |
| Currently deployed `sync_apply_row` | unchanged in production. W4-05's wrapper is a file; the client keeps working against today's function either way |
| Migration-count assertions | **Untouched.** No Postgres migration is added, so `rollback-classification.json`, `assertManifestMatchesMigrations()`, the three generated documents, `scripts/h9-prod-preflight.mjs` and `h9_postmigration_checks.sql` all stay exactly as they are (§6, §14) |
| H-9 migration 34's exact-privilege model | Not reached — the only privilege change W4-04 needs lives in the deferred grant migration. Recorded for Batch 3: a `service_role`-only grant leaves migration 34's checks (`api_roles_*`, `no_public_grants`, `supabase_admin_public_defaults_exact`) unaffected, since they concern `anon`/`authenticated`/`PUBLIC`/`supabase_admin` |
| `payment-webhook` handler extraction | pure move of three functions + the request pipeline into `handler.ts`; `index.ts` keeps only the `Deno.serve` wiring, mirroring `functions/sync/index.ts` |
| Vitest worker RPC timeout / H-7 load timeouts | pre-existing and **avoided, not tolerated**: `pnpm test --maxWorkers=2 --minWorkers=1` is the recorded zero-exit command (`DECISIONS.md` 2026-10-05). A default-worker baseline run on this machine reproduced it as a single 5 s timeout in `h7-pin-reservation.sqlite.test.ts`, which passes 9/9 alone at 60 s |
| `migration-rollback-classification.test.ts` hardcoded counts | **Not edited.** Its two `34`s and its `A 8 / B 18 / C 8` title stay correct because the chain does not change |
| `packages/utils` consumed by `apps/admin` | already a workspace dependency pattern — `apps/admin/app/page.tsx` imports `formatMoney`/`formatNumber` from `@muthoy/utils` today, so `netSales` needs no new wiring |

---

## 5. Security and tenant isolation

| Surface | Control |
|---|---|
| `conflict_queue` holds row payloads | every read/write is `shop_id`-filtered; `purgeUnreadableTables` deletes conflict rows for tables the server has stopped sending, so a cashier who loses `cash_management` loses the expense snapshots too |
| Conflict visibility | per-row read gate from `domain/conflictTables.ts`; Owner-only tables are invisible to staff |
| Conflict resolution | per-row write gate + `assertSessionLive`; a resolution cannot be attributed to the wrong actor across a handover |
| `keep_local` re-enqueue | goes through `recordChange`, so the B4 commercial read-only gate and the shop-limit gate both still apply |
| Monitoring reports | allowlist redaction: only enumerated literals survive. No PIN, OTP, token, phone, name, or money value can be carried, by construction, not by filtering |
| Monitoring sink | bounded ring buffer; no network; no provider configured ⇒ nothing leaves the device |
| Shop identity | server pins Owner-controlled fields for non-owner callers; `sync_row_permitted` requires the owner role for `shops`/`subscriptions` |
| Admin revenue | `service_role` SELECT only; no write grant; no `anon`/`authenticated` grant; no per-shop figure exposed |
| Payment tests | fabricated store id/password doubles only; no live endpoint, no real credential |
| W5-15 | sanitized output only; scanner lives in the scratchpad, never in the repo; no secret echoed into a doc or a test |

---

## 6. Required local migrations

| Migration | Scope | In this batch? |
|---|---|---|
| `apps/mobile/db/migrations/0031_h6_conflict_queue.sql` | SQLite, additive `ALTER TABLE` + 2 indexes | **Yes** — runs on-device/in-test, executed by the suite |
| Postgres migrations | — | **NONE.** See §14 |

**No Postgres migration is added, so nothing downstream of the chain moves:**
`rollback-classification.json` stays at 34 entries,
`migration-rollback-classification.test.ts`'s hardcoded `34` / `A 8 / B 18 / C 8`
stay correct, `scripts/h9-prod-preflight.mjs` stays correct,
`backend/supabase/checks/h9_postmigration_checks.sql` stays byte-identical and its
recorded hash stays reproducible, and the four pgtests that execute it stay green.
Revisions 1–3 each planned edits to some of these; revision 4 plans none.

#### Superseded by §14 — this migration is NOT added in Batch 1

Revision 3 planned to re-express `scripts/h9-prod-preflight.mjs`'s chain check so
two new migrations could land. The reviewer's answer was correct and decisive:
that **weakens a founder-signed-off H-9 seal** by permitting arbitrary post-H-9
migration identities, and it misses two further gates that cannot be edited at
all. See §14. **Neither migration file is created in Batch 1**; both are deferred
to Batch 3 along with their application. What W4-05 still delivers here is
reviewed, PGlite-tested SQL staged **outside** the migration chain, at
`backend/supabase/proposed/`.

---

## 7. Sync and accounting invariants this batch must not break

1. `batches.stock == SUM(inventory_movements.change_qty)` — asserted after every
   step of W3-11 and preserved by W3-01 (the detector reads; it never writes a
   business row).
2. `batches.stock` is never accepted from the wire — the conflict comparison
   excludes it, so a stock difference cannot be "resolved" into the projection.
3. `users.access_locked_at` is never pushed and never overwritten by a pull — the
   comparison excludes it and `keep_remote` routes through `applyRemoteRow`,
   which preserves it.
4. The outbox stays at-least-once; no detection path marks a row sent, failed, or
   deleted.
5. Grouped operations stay atomic — the detector never queues a conflict for a
   member of an incomplete group, because detection keys on the arriving pull
   row, not on the outbox group.
6. Integer paisa everywhere; `netSales = saleTotal − refundTotal` has exactly one
   definition, reused by the admin panel.
7. The Volume 3 cash formula is read, never re-derived.

---

## 8. Focused test matrix

| # | File | Kind | Proves |
|---|---|---|---|
| 1 | `apps/mobile/db/h6-conflict-queue.sqlite.test.ts` | real SQLite | pull-with-pending-outbox queues once; identical re-delivery bumps `occurrences` and does not insert; append-only tables never queue; `batches.stock`/`accessLockedAt`/stripped columns never trigger; `push_superseded` fires on an **equal**-timestamp server drop, does **not** fire on a clean server echo, and does **not** fire when `remote.updated_at < pushed.updated_at` (the stale-page false positive revision 1 would have produced); does not fire when the only difference is a server-pinned field (`shops.plan`, `users.role_id`); cross-shop rows invisible; access purge drops unreadable-table conflicts |
| 1a | same file | real SQLite | **fail-soft:** a malformed `sync_queue.payload` (invalid JSON, and valid JSON that is not an object) records no conflict, throws nothing, still applies the pulled row, and emits `sync.conflict_detector.failed`; incremental pull advances past the page instead of wedging |
| 2 | `apps/mobile/db/h6-conflict-resolution.sqlite.test.ts` | real SQLite | `keep_local` re-enqueues with a strictly newer `updatedAt`; **`keep_remote` force-applies a snapshot whose `updated_at` is older than the local row** (the case `applyRemoteRow` would have silently skipped) and preserves `batches.stock`/`oversoldAt`/`users.accessLockedAt`; pending/failed outbox rows for that key are **deleted**, cannot later overwrite the chosen value, and their exact bytes are preserved in `conflict_queue.superseded_payloads` (asserted byte-for-byte against what `recordChange` queued, including the case where the local row changed after queueing and the case of two queued rows for one key); a `superseded_payloads` entry is removed by the ACL purge when the table becomes unreadable; a grouped-operation row refuses `keep_remote` and offers only `keep_local`; the resolution is atomic (a mid-way failure leaves the conflict unresolved and the outbox untouched); resolution survives restart; a second resolve is a no-op; resolution without the write gate is refused; a handover mid-resolution throws `StaleSessionError`; commercial read-only blocks `keep_local`; **post-sync convergence** — after the next successful cycle the resolved row matches the chosen side |
| 3 | `apps/mobile/domain/conflictTables.test.ts` | pure | every synced table has a gate; the exempt list matches `upsertRemoteRow`'s `onConflictDoNothing` set exactly — 6 tables (read as source, so drift fails) |
| 3a | `apps/mobile/tests/server-owned-fields.test.ts` | static source + SQL | the declared server-owned set matches the migration SQL's `on conflict do update set (...)` lists and every wrapper's `jsonb_build_object(...)` pin list, plus `toSyncPayload`'s deletions and `applyToTable`'s preservations. Fails on drift, so "the exclusion list is complete" is enforced rather than asserted |
| 4 | `apps/mobile/tests/sync-conflicts.test.tsx` | render | Owner sees all; staff see only permitted rows; unresolvable rows render read-only; offline notice; error state; empty state; both locales |
| 5 | `apps/mobile/domain/errorRedaction.test.ts` | pure | adversarial inputs produce **no** trace of the secret: `error.name` set to a 4-digit PIN; a `cause` chain three deep holding an OTP; a `message` carrying a JWT and a `+8801…` phone; a paisa amount and a customer name in both; a `route` with a query string; a `data:`/`eval` source URL. Asserts `message`, `cause` and stack are absent from the DTO entirely, and an unrecognised `error.name` maps to `'unknown'` rather than passing through |
| 6 | `apps/mobile/monitoring/monitoring.test.ts` | unit + static | no-op without a provider; ring buffer bounded and FIFO-evicting; `reportError` never throws and never rejects; offline is indistinguishable from online to the caller; static assertions that no `fetch`/`XMLHttpRequest` appears in the module graph **and** that nothing in `monitoring/` imports `dev/runtimeDiagnostics` |
| 7 | `backend/supabase/functions/sync/payment-integration.test.ts` | unit | W3-06 items 1, 2, 5 |
| 8 | `backend/supabase/functions/payment-webhook/webhook.test.ts` | unit | W3-06 items 3, 4 |
| 9 | `apps/mobile/tests/plan-payment.test.tsx` | render | W3-06 item 6 |
| 10 | `apps/mobile/tests/localization-coverage.test.ts` | static source | the six fixed files hold no user-visible English literal; every new key exists in both `en` and `bn` |
| 11 | `apps/mobile/tests/sale-confirmation.test.tsx` | render | D8: the screen renders Bangla under `locale=bn` and English under `locale=en`; money still uses the mono face |
| 12 | `apps/mobile/tests/inventory/inventory-focus-refresh.test.tsx` | render | D10: refocus re-reads; a stale in-flight read cannot overwrite a newer one; repeated focus does not stack reads; navigation away cancels |
| 13 | `apps/mobile/tests/ui-consistency.test.ts` | static source | D11: the three headers consume the inset context; touched files hold no raw hex; `hitSlop` present where the visual box is under 44px |
| 14 | `apps/mobile/db/core-workflow-regression.sqlite.test.ts` | real SQLite | W3-11 in full, online and offline. Returns/refunds exercise the **full-sale refund** path only — the one the codebase implements |
| 15 | `packages/utils/src/netSales.test.ts` | pure | the shared subtraction: full refund → 0; refund-only day → negative; integer-paisa guard throws on a non-integer; safe-integer overflow refused |
| 15a | `apps/admin/lib/platformStats.test.ts` (extend) | pure | `business_date` day range on both sides; cancelled (`is_deleted`) sales excluded; a duplicate refund row is impossible by `unique(shop_id, sale_id)` (negative control); cross-shop attribution never mixes |
| 17 | `backend/supabase/pgtest/w405-shop-identity.pgtest.ts` | real Postgres (PGlite), loading the **proposed** SQL from `backend/supabase/proposed/` | `sync_row_permitted` refuses `shops` for a manager holding a `settings_manage` override (the owner-initiated case); a non-owner who reaches the dispatcher has identity fields pinned and still succeeds; the Owner's push changes them; cross-shop isolation; **no currently-working path is refused** (owner registration, `b4_mutate_owned_shop` rename/archive, and a staff sale/stock/cash push all still pass); the renamed `_pre_w405` implementation is **not** executable by `service_role`, `anon`, `authenticated` or `public`, and the wrapper is executable by `service_role` only |

Rows 15b, 16, 18 and 19 from revision 3 are **removed**: they all existed only to
accommodate a Postgres migration this batch no longer adds.

Plus the full existing suite via **`pnpm test --maxWorkers=2 --minWorkers=1`,
which must exit 0** (`DECISIONS.md` 2026-10-05 records this as the zero-exit
full-suite command; the default worker count is what produces the H-7 load
timeouts and worker-RPC noise), `tsc --noEmit` and `eslint` across the workspace,
`git diff --check`, and the sanitized secret scan.

---

## 9. Documentation changes

| Document | Change |
|---|---|
| `docs/plans/muthoy-five-batch-delivery-ledger.md` | **new.** the five-batch delivery map, Batch 1's 11 IDs with status before/after, and what each later batch still owns |
| `docs/plans/muthoy-batch-1-plan.md` | this file, updated with the Codex verdicts |
| `docs/plans/muthoy-batch-1-implementation-2026-10-20.md` | **new.** per-task: status before/after, source files, test evidence, acceptance result, remaining external verification |
| `docs/plans/pre-rc-master-plan.md` | H-6's row updated (detection + persistence + UI landed; the physical two-device run still owed). **H-8's row stays `NOT DONE`**, annotated with the core that landed and the five gate items that remain. The D8–D11 carry-forward note updated |
| `docs/plans/muthoy-w5-15-dev-credential-assessment-2026-10-20.md` | **new.** sanitized verdict |
| `DECISIONS.md` | the five genuine decisions only: the conflict-detection rule, the allowlist redactor, the admin day-boundary asymmetry, pin-rather-than-reject for shop identity, and Alert-vs-Toast |
| `apps/mobile/db/README.md`, `apps/mobile/sync/README.md` | conflict queue + monitoring sections |
| `backend/supabase/migrations/ROLLBACK.md`, `backend/supabase/migrations/README.md` | **not regenerated.** `scripts/render-rollback-docs.mjs` is not run, because no migration is added |

---

## 10. Staging discipline (Gate 5/6)

- Explicit paths only. **Never** `git add .` or `git add -A`.
- `DECISIONS.md` already carries uncommitted H-9 edits. Batch 1's additions are
  appended as their own section and staged with explicit hunk selection, so no
  H-9 line is swept in. If hunk isolation proves impossible, the Batch 1
  `DECISIONS.md` text is held back and reported as a preserved local file rather
  than mixed into an H-9 commit.
- The **40** pre-existing paths were snapshotted with NUL-safe parsing before any
  Batch 1 file was written (three of them have spaces in their names, which is
  why a naive `awk '{print $NF}'` miscounts). Both revision 1's "42" and the
  reviewer's "41" were wrong. The exact list:

```
 M DECISIONS.md
 M apps/prototype-web/Muthoy (prototype)/pnpm-workspace.yaml
 M scripts/h9/install-local-runtime.ps1
 ?? apps/prototype-web/Muthoy (prototype)/.expo/
 ?? apps/prototype-web/Muthoy (prototype)/pnpm-lock.yaml
 ?? apps/prototype-web/Muthoy (prototype)/tsconfig.json
 ?? docs/plans/h9-h5-encrypted-workflow-assessment-2026-10-19.md
 ?? docs/plans/h9-h5-preflight-and-recovery-proposal-2026-10-19.md
 ?? docs/plans/h9-n0-final-acceptance-2026-10-19.md
 ?? docs/plans/h9-n0-pg17-a2a3-readiness-2026-10-19.md
 ?? docs/plans/h9-pg17-extension-verification-2026-10-19.md
 ?? docs/plans/h9-pg17-final-runtime-verification-2026-10-19.md
 ?? docs/plans/h9-pg17-local-setup-2026-10-19.md
 ?? docs/plans/h9-pg17-runtime-verification-2026-10-19.md
 ?? scripts/h9/{a2a3-adapter,dev-extension-inventory,extension-runtime,h5-paging-gate,
      n0-account-inventory,n0-runtime,pg17-archive-guard}.mjs
 ?? scripts/h9/{extensions-with-token,n0-with-token,probe-h5-paging,
      stage-extension-runtime,stage-n0-runtime}.ps1
 ?? scripts/h9/{run-extensions,run-n0,verify-extensions,verify-n0}.cmd
 ?? scripts/h9/h5-approved-policy.json
 ?? scripts/h9/test/{dev-extension-inventory,h5-paging-gate,n0-a2a3,n0-acceptance,
      pg17-archive-guard,reproduce-before}.mjs
 ?? scripts/h9/test/{extension-launcher,n0-launcher,n0-staging}.test.ps1
```

- Gate 7 re-runs the same snapshot and asserts all 40 are still present and
  unmodified by Batch 1.
- Commits are grouped: `feat(h6)` conflict queue + UI, `feat(h8)` monitoring,
  `test(payment)`, `fix(i18n)`, `fix(inventory)`, `fix(ui)`, `test(workflow)`,
  `fix(admin)`, `feat(sync)` shop identity, `docs(batch-1)`.

---

## 11. Acceptance criteria

| Task | Accepted when |
|---|---|
| W3-01 | a forced two-device conflict is queued exactly once, survives restart, dedupes on re-delivery, no append-only or server-owned column can produce one, and a malformed outbox payload degrades to a reported detector failure rather than a wedged pull |
| W3-02 | Owner and staff see the rows their permissions allow and only those; `keep_remote` actually changes the row even when the local copy is newer; superseded outbox rows cannot re-overwrite it; a grouped-operation row is never torn; both resolutions work offline and converge after the next sync; a cross-shop row is unreachable |
| W3-04 | a forced init failure, a forced sync failure and a forced recovery-pending state each produce a DTO whose every field is a validated enum or integer, with `message`/`cause`/stack absent entirely; adversarial `name`/`cause`/`route` inputs carrying a PIN, OTP, token, phone, name or paisa amount leave no trace; with no provider configured nothing leaves the device. **H-8 itself remains `NOT DONE`** |
| W3-06 | all six W3-06 groups pass against doubles; no real credential or endpoint appears |
| W3-08 | both screens render Bangla under `locale=bn`; the static guard fails if an English literal returns |
| W3-09 | the list refreshes on focus; stale and repeated reads cannot corrupt it |
| W3-10 | the three headers pad by the real top inset; the toggle is tappable at the top of the screen; no raw hex in the touched files |
| W3-11 | the invariant and all four accounting identities hold after every step, online and offline |
| W4-04 | **BLOCKED (§14).** Partially accepted when the shared `packages/utils` definition and the refund-net arithmetic are correct and tested on `business_date` for both sides, with full-refund, cancelled and duplicate-impossible cases proven. The dashboard figure itself stays gross until the grant lands in Batch 3 |
| W4-05 | **BLOCKED (§14).** Partially accepted when the proposed SQL, staged outside the chain, proves in PGlite that a manager holding a `settings_manage` override can no longer write `shops`, that identity fields are pinned for any non-owner reaching the dispatcher, that the renamed implementation is unreachable by every role, and that **no currently-working path is refused** |
| W5-15 | a sanitized verdict exists, backed by counts and locations, with no secret material in the document, the diff, or this session's output |

### Rollback considerations

- `0031` is additive; reverting it is `DROP INDEX` ×2 + `ALTER TABLE ... DROP COLUMN` ×8, and `conflict_queue` carries no business data — losing it loses only unresolved *notices*, never a row.
- **No Postgres migration exists to roll back.** Batch 1 creates no file under `backend/supabase/migrations/`, so there is nothing in the chain to reverse. Reverting W4-05's contribution means deleting `backend/supabase/proposed/w405_shop_identity_owner_fields.sql` and its pgtest, neither of which any migration, manifest, document or H-9 check reads. (For Batch 3, when the SQL is promoted: the grant would be class `A`, reversed by `revoke select on sale_refunds from service_role`; the wrapper would be class `B`, reversed by redeploying the previous `sync_apply_row` definition from git and restoring its grants — not by an inverse DDL.)
- W3-04 is additive and inert without a provider; removing the `monitoring/` files and the three call sites fully reverses it.
- W3-08/09/10 are presentation-only reverts.
- W4-04 reverts to the gross sum by restoring one function; `packages/utils/netSales` can stay, unused and harmless.
- W4-05 reverts by deleting its proposed-path SQL and the pgtest. Nothing else references either.
- Nothing in Batch 1 deletes, rewrites, or migrates existing business data.

---

## 12. Explicit deviations, deferrals and stated risks

1. **H-8 stays `NOT DONE`.** The repository's H-8 gate
   (`pre-rc-master-plan.md`) requires a forced crash, migration failure, sync
   failure, payment failure and auth failure each appearing in a provider, with
   no PIN/OTP/token/phone/money payload. W3-04 delivers the *core* only:
   abstraction, closed-DTO redaction contract, bounded offline sink, and
   init/recovery/sync call sites. There is no provider, no payment or auth
   coverage, and no device proof. Revision 1 called this "core complete, hosted
   half owed", which reads like partial credit against a gate that is pass/fail.
   The pre-RC row therefore keeps **`NOT DONE`**, annotated with what landed.
2. **W4-04 and W4-05 are BLOCKED, not deferred by choice.** No Postgres
   migration can enter the chain without overwriting hash-recorded H-9 evidence.
   The shop-identity gap therefore remains open on the server and the admin
   dashboard keeps reporting gross revenue until Batch 3. §14 is the consolidated
   approval request; neither task is reported as PASS.
3. **Push-side detection covers the provable case only.** Only exact timestamp
   equality with a difference on a comparable field is queued. `remote >
   pushed` is ordinary LWW; `remote < pushed` is a stale pull page. Both are
   deliberately silent. The complete fix is a server-side `'stale'` return from
   `sync_apply_row`, which needs a migration **and** a function redeploy — both
   out of scope here. Recorded as owed. A corollary worth stating: if a dropped
   row's server timestamp never advances past this device's pull cursor, the row
   is never re-sent and no client-side mechanism can detect it. That residual
   blind spot closes only with the server-side change.
4. **No two-device physical test.** H-6's acceptance in the master plan names a
   forced two-device conflict. This batch proves it synthetically on real SQLite
   with both devices' timestamps simulated. The physical two-device run is the
   same gap H-7's convergence row already carries and is **not** claimed as done.
5. **`payment-webhook/index.ts` is refactored** to separate its handler from
   `Deno.serve`. This is the only structural change to shipped payment code in
   this batch, it changes no behaviour, and it exists solely because the current
   file cannot be imported by a test.
6. **The suite must exit 0.** Revision 1 proposed committing with exit 1,
   excused by the known worker-RPC noise. That violates
   `DEVELOPMENT_RULES.md`'s working-commit rule, and it is unnecessary:
   `DECISIONS.md` (2026-10-05) records `pnpm test --maxWorkers=2 --minWorkers=1`
   passing **exit 0** with nothing skipped and no timeout raised. This batch uses
   that command and requires exit 0. (A pre-change baseline run at default worker
   count reproduced the problem exactly: 4858/4859 tests passed with one 5-second
   timeout in `h7-pin-reservation.sqlite.test.ts`, which passes 9/9 alone at a
   60-second timeout — load, not a defect.)
7. **`apps/prototype-web` is consulted for UI/UX, not avoided.** Revision 1 said
   it would "not be read", which misstates CLAUDE.md rule 15: the prototype *is*
   the layout/navigation/interaction reference, and only its React-Web
   architecture, CSS, business logic, state management and data layer are
   off-limits. The one new screen (`/sync-conflicts`) takes its layout and
   interaction patterns from the prototype's equivalent surfaces; nothing is
   copied.
8. **Scope of the W3-08/W3-10 extras is assignment-authorised, not inferred.**
   The repository's own carry-forward list names only D8–D11. The additional
   screens and the token/Toast/touch-target work come from the Batch 1
   assignment text: W3-08 reads *"Fix D8/D9 **and other verified
   hardcoded-English UI defects** using the existing localization
   architecture"*, and W3-10 reads *"Improve **relevant semantic design tokens,
   Alert-to-Toast behavior**, D11 safe-area issues, **touch targets and
   functional accessibility**"*. Every string and token changed is a *verified*
   defect located by reading the file, not a sweep. No visual redesign.
9. **Credential rotation is not performed** (W5-15), and no secret is printed.
10. **`settings_manage` tightening is a behaviour change on the server.** After
    Batch 3 applies it, any shop that today has a `user_permissions` row granting
    `settings_manage` to a non-owner loses that capability. A pre-application
    query for such rows is a Batch 3 prerequisite, not an assumption.
    The `subscriptions` arm is **not changed at all** — the effective B4
    definition already returns `false` for everyone. Revisions 1–3 each
    mis-stated this by reading a superseded definition or the wrong function.
12. **The admin figure inherits a pre-existing blind spot, and does not widen it.**
    `sales_returns.refund_id` is nullable on both stores, so a row predating the
    refund-header model can carry a `refund_amount` with no `sale_refunds`
    parent. `db/reports.ts` already **INNER JOINs** `sales_returns` to
    `sale_refunds`, so the canonical mobile report ignores such rows too. The
    admin panel mirrors the canonical definition exactly, which means both
    under-report a legacy standalone return by the same amount. That is a
    pre-existing limitation of the canonical definition, not one Batch 1
    introduces, and fixing it would mean changing the mobile report — out of
    scope here and recorded as owed.
11. **W4-05's proposed SQL is validated in PGlite only, and Batch 1 adds no
    migration file to validate.** The single artefact is
    `backend/supabase/proposed/w405_shop_identity_owner_fields.sql`, outside the
    chain. PGlite is not Postgres 17 and does not carry the platform roles, so
    even that validation is partial; hosted verification is Batch 3's job,
    together with promoting the file into the chain.

---

## 13. Gate 2 — Codex PLAN review response (revision 1 → 2)

Reviewer: Codex `gpt-5.6-sol`, read-only, against the real tree.
Verdict on revision 1: **PLAN REVISE**, 13 findings. Every finding was
independently re-verified against the code before being accepted; none was taken
on the reviewer's word, and none was rejected.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | LOW | baseline, dead `conflict_queue`, retained `sent` rows all check out | confirmed, no change |
| 2 | LOW | silent push-side LWW and the effective wrapper chain check out | confirmed, no change |
| 3 | **CRITICAL** | `push_superseded` unsound: `remote < pushed` proves nothing, and equal-timestamp diffs false-positive on server pinning (`shops.plan`, actor-dependent `users.*`); exclusion list incomplete for server transformations | **ACCEPTED.** Narrowed to exact timestamp equality; added the per-table server-owned set and `domain/serverOwnedFields.ts`; added a migration-SQL-parsing test so completeness is enforced. The "store the pushing actor" alternative is recorded as considered and declined, with the reason |
| 4 | HIGH | letting the detector throw wedges pull; `sync_queue.payload` is unvalidated TEXT | **ACCEPTED.** Detection is fail-soft with guarded parsing; failures emit `sync.conflict_detector.failed` and never throw; malformed-payload tests added |
| 5 | **CRITICAL** | `keep_remote` is a no-op — `applyRemoteRow` returns `skipped_stale` for exactly the rows this feature detects; pending outbox rows would re-overwrite; grouped ops unsafe to cancel | **ACCEPTED.** Added `forceApplyConflictRow` reusing an extracted `preservedLocalFields()`; outbox supersession via `markSyncRowPermanentFailure`; `keep_remote` withheld for grouped rows; whole resolution in one transaction; restart + convergence tests |
| 6 | LOW | SQLite migration approach and test loader check out | confirmed, no change |
| 7 | HIGH | W4-05 is class `B` not `A`; counts hardcoded in the test; wrapper needs explicit ACL revokes | **ACCEPTED.** Reclassified `B`; totals → A 9 / B 19 / C 8 (36); the hardcoded test is now an explicit file in scope; the five required ACL statements are specified, including revoking `service_role` from the renamed implementation |
| 8 | HIGH | the claimed manager self-grant escalation is already blocked by `MU015`; pinning preserves no staff workflow; making `subscriptions` owner-permitted widens access | **ACCEPTED — revision 1 was factually wrong.** Threat model rewritten as an owner-initiated latent divergence; pinning restated as independent defence-in-depth; `subscriptions` → `false`, which narrows rather than widens |
| 9 | HIGH | partial sale refunds do not exist; the day-boundary asymmetry is a defect; the admin-only net function duplicates business logic | **ACCEPTED — revision 1 was factually wrong.** Partial-refund tests removed and the full-sale-only model documented with its three enforcement points; `business_date` on both sides; the subtraction moved to `packages/utils`; a query-level pager/filter/error test added |
| 10 | HIGH | the privacy claim is not guaranteed: `error.name` is caller-controlled, stack line 1 is the message, source URLs and `cause` can carry secrets; DEV diagnostics still hold raw context | **ACCEPTED.** Closed-enum DTO; `message`/`cause`/stack discarded outright; no stack capture in Batch 1; `dev/runtimeDiagnostics.ts` explicitly not wired, asserted by test; adversarial redaction tests |
| 11 | MEDIUM | W3-04 is not H-8 completion | **ACCEPTED.** H-8 stays `NOT DONE` |
| 12 | MEDIUM | exit-1 commit violates the working-commit rule and a zero-exit command is already recorded; the prototype rule was misstated; the extras need cited authority | **ACCEPTED.** `--maxWorkers=2 --minWorkers=1`, exit 0 required; prototype rule corrected; assignment text quoted as authority |
| 13 | LOW | protected-path count wrong | **ACCEPTED, and the reviewer's number was also wrong.** The true count is **40**, snapshotted with NUL-safe parsing and enumerated in §10 |

Net effect: 2 factual errors corrected, 1 unsound detector narrowed, 1
non-functional resolution path replaced, 1 wedge risk removed, 1 privacy
contract hardened, 1 misclassification fixed, and 3 process rules brought back
into line with the repository's own standards.

### Gate 2b — delta review of revision 2 (revision 2 → 3)

Verdict on revision 2: **PLAN REVISE** — B and G `FIXED`, six `PARTIALLY FIXED`,
one new HIGH. All eight re-verified against the code; all eight accepted.

| Item | Finding | Disposition |
|---|---|---|
| A | server-owned set wrong in two places: `shops` omitted W4-05's own pinned identity fields; `cash_drawer` reconcile fields are **client-owned** fill-if-absent fallbacks, not pinned; and the guard test could not see `push.ts`'s `applyUserProfileFields`, which lives in TypeScript | **ACCEPTED.** Identity fields added (unconditionally, since the outbox has no actor); `cash_drawer` removed with the wrapper's own comment quoted; the guard test now parses four sources including `push.ts`, and must classify the conditional `if not p_row ? '…'` form as client-owned |
| B | fail-soft design sufficient | FIXED, no change |
| C | **NEW HIGH** — marking superseded rows `failed` causes re-detection on every pull, false stuck-sync warnings, and (security) keeps the superseded payload protected from the ACL purge | **ACCEPTED.** New terminal status `superseded`; `sync_queue.status` has no CHECK constraint so no rebuild is needed; every existing consumer then behaves correctly untouched, and the row becomes purgeable |
| D | class B, totals and ACLs correct — **but adding migrations breaks `scripts/h9-prod-preflight.mjs`'s exact-34 and tail checks**, which the plan did not cover | **ACCEPTED.** Verified the file is not hash-recorded; the gate is re-expressed as "H-9 block present, contiguous, unmodified" with the length bumped, plus a new negative test proving it did not weaken; flagged for Batch 3 re-confirmation, with the W4-04 coupling recorded |
| E | `subscriptions → false` safe, but §1 still repeated the false self-grant chain and §12 overstated what changes | **ACCEPTED.** §1 fact 12 corrected to cite `MU015`; §12 item 10 now says the arm is inert in practice and explains why |
| F | `business_date` and `packages/utils` correct, but "partial sale refunds do not exist" is false as stated — `sales_returns.refund_id` is nullable and legacy NULL rows can exist | **ACCEPTED.** Restated as a property of the current write path, not the schema; the pre-existing INNER-JOIN blind spot in `db/reports.ts` recorded as §12 item 12 |
| G | redaction contract sufficient | FIXED, no change |
| H | H-8, worker command, authority and the 40 paths correct — but §0 still said the prototype is "not read" | **ACCEPTED.** §0 corrected to match §12 item 7 |

Two of revision 2's own corrections were themselves wrong (`cash_drawer`,
the partial-refund absolute), and one real blocker was missed entirely (the H-9
preflight). Both rounds of review earned their keep.

### Gate 2c — delta review of revision 3 (revision 3 → 4)

Verdict on revision 3: **PLAN REVISE** — F and H `FIXED`; A, C, D, E `NOT FIXED`;
one new HIGH **against revision 3's own fix**. All re-verified; all accepted.

| Item | Finding | Disposition |
|---|---|---|
| A | three more misclassifications: `sales.tax_amount/tax_rate_bp/tax_label` are pinned on update; `expenses.category` is canonicalised server-side; `users.address/email` are **client**-owned, not server-owned | **ACCEPTED.** All three corrected, and an explicit *client-owned* table added alongside the exclusions, because every error across three rounds was an over-exclusion that would silently blind the detector |
| C | the `superseded` status fixes re-detection and stuck warnings but **not** the security point — `purgeUnreadableTables` never deletes `sync_queue` rows under any status | **ACCEPTED.** The row is now **deleted**; the discarded payload already lives in `conflict_queue.local_value`, which §5's purge extension does remove. No new status value needed |
| D + NEW HIGH | re-expressing the preflight check **weakens** the H-9 seal by allowing arbitrary post-H-9 migrations, and misses `h9_postmigration_checks.sql` (hash-pinned) and `h9-cron-cleanup.pgtest.ts` | **ACCEPTED, and it changes the batch's scope.** Verified: that SQL file asserts `count(*)=34` and `not exists (version > '20261015000000')`, is pinned in `.gitattributes`, and is referenced by four pgtests — of which `h9-cron-cleanup` necessarily replays the complete chain and so necessarily goes red (round 5 corrected my original "executed by four"). No Postgres migration can be added without editing founder-signed-off sealed evidence. **Both PG migrations deferred — see §14** |
| E | item 10 false: the effective B4 `sync_row_permitted` already returns `false` for `subscriptions`, Owners included | **ACCEPTED.** The arm is no longer changed at all. I had been reading `sync_table_readable` (`20260907000000:228`), a different function |
| F, H | fixed | no change |

---

## 14. W4-04 and W4-05 are BLOCKED on the H-9 migration-chain seal

**One consolidated approval request, per the batch brief.** Nine of the eleven
tasks reach CODE-COMPLETE (device validation still outstanding). Two cannot,
and the reason is the same for both.

### The blocker

Both tasks need a Postgres migration — W4-04 a `select` grant on `sale_refunds`
for `service_role`, W4-05 a `sync_apply_row` wrapper. Adding **any** file to
`backend/supabase/migrations/` breaks three H-9 gates:

| Gate | Assertion | Editable? |
|---|---|---|
| `scripts/h9-prod-preflight.mjs:232` | `migrations.length === 34` **and** the H-9 files are the chain **tail** | Yes — not hash-recorded. But re-expressing it to allow later migrations **weakens** a signed-off invariant, which is why revision 3's approach was rejected |
| `backend/supabase/checks/h9_postmigration_checks.sql:369-382` | `count(*) = 34`, all three H-9 versions present, and `not exists (… where version > '20261015000000')` | **NO.** Pinned `text eol=lf` in `.gitattributes` *"for every file whose SHA-256 is recorded as H-9 evidence"*, and cited by `docs/plans/h9-*`. Editing it breaks a recorded hash |
| `backend/supabase/pgtest/h9-cron-cleanup.pgtest.ts:406` | records **all** `migrationFiles()` and then expects those checks to pass — so it goes red on the 35th migration | Only by editing the pinned SQL above |
| `h9-api-role-hardening`, `h9-api-role-privileges`, `h9-environment-parity` pgtests | **reference** `h9_postmigration_checks.sql` — `h9-api-role-hardening` reads it as text rather than executing it, and none necessarily replays the complete migration history, so whether any breaks depends on its own fixture. Listed for completeness only; the cron pgtest alone is sufficient to block | — |

So the honest position: Batch 1 cannot add a Postgres migration without
overwriting founder-signed-off H-9 sealed evidence, which the brief's
non-negotiable safety section forbids and which rule 13 warns against doing
"since it's quick".

### What ships anyway

| Task | Delivered in Batch 1 | Held for Batch 3 |
|---|---|---|
| **W4-04** | `packages/utils/src/netSales.ts` — the one shared, pure refund-net definition built on `subtractPaisa`, with tests (§8 rows 15, 15a); `platformStats.ts`'s `business_date` day range and refund summation, with tests | the `queries.ts` read of `sale_refunds` and the page label. `adminGrants.test.ts` globs the migrations directory and requires the grant to exist there, so the read cannot ship without the migration. **The dashboard still shows gross until Batch 3** |
| **W4-05** | the complete proposed SQL at `backend/supabase/proposed/w405_shop_identity_owner_fields.sql` (outside the chain, so no gate moves), reviewed and **executed in PGlite** by `w405-shop-identity.pgtest.ts` (§8 row 17), including the five ACL statements and the "no working path refused" proof | promotion into the migration chain, and application |

Neither task is reported as PASS. Both are **BLOCKED**, with reviewed and tested
artefacts ready to land unchanged the moment the seal question is answered.

### The decision the founder owns

One of:

- **(A) Defer** — W4-04 and W4-05 move to Batch 3, which already owns the H-9
  hosted work and can extend the chain and its checks in one reviewed step.
  *Recommended:* nothing is weakened, nothing is rushed, and Batch 3 is where the
  migration would be applied anyway.
- **(B) Re-open the H-9 seal** — update `h9_postmigration_checks.sql` (the count
  and the "nothing after H-9" predicate), `h9-prod-preflight.mjs`, the affected
  pgtests, and re-record the H-9 evidence hashes that change.

**This plan does not authorise (B), and Batch 1 will not perform it under any
reading of this document.** It is listed only so the founder can see the full
option set. Choosing it re-opens signed-off H-9 work during its hold and would
need its own plan, its own review and its own evidence re-recording — a larger
and riskier change than the two tasks it unblocks. **(A) is the recommendation.**

Until this is answered, Gate 6 ships the nine code-complete tasks and W4-04 and
W4-05 are reported BLOCKED.

---

## 15. Gate 2d — delta review of revision 4 (revision 4 → 5)

Verdict on revision 4: **PLAN REVISE**. E `FIXED`; A, C, D `NOT FIXED`; two new
HIGHs, both against revision 4 itself. All re-verified; all accepted.

| Item | Finding | Disposition |
|---|---|---|
| A + NEW HIGH 1 | with W4-05 deferred, nothing pins the eight `shops` identity fields, so excluding them is a pure loss — an equal-timestamp blind spot on the Owner's own shop-profile edit | **ACCEPTED.** Moved to the client-owned column. The guard test parses the real chain, so promoting W4-05 in Batch 3 will fail the test until the declaration is updated — the forcing function replaces the pre-emptive guess |
| C | deletion is safe on every count checked, **but** `conflict_queue.local_value` is a detection-time snapshot of the local row, not the deleted row's queued bytes; and §8 row 2 still described status-marking | **ACCEPTED.** New `superseded_payloads` column holds the exact deleted rows (`id, seq, op, payload`), written in the same transaction; §8 row 2 rewritten, including the two cases that distinguish the snapshot from the payload |
| D + NEW HIGH 2 | the seal, the hash evidence, the proposed-path approach and the W4-04 split all check out — **but** revision 4 still carried live instructions to add migrations, update `rollback-classification.json`, regenerate the rollback docs and change the chain counts; and only the cron pgtest necessarily replays the full history | **ACCEPTED.** Full consistency sweep: §2 W4-05's file list, §3's contention list, two §4 compatibility rows, §9's documentation row and the classification note are all now explicit that nothing touches the chain, with the Batch-3 knowledge retained as reference rather than instruction. §14's pgtest table corrected |
| E | `subscriptions` arm correctly left unchanged | FIXED, no change |

**What the four rounds cost and bought.** Six of my factual claims were wrong
(silent-LWW rule, `keep_remote`, fail-soft reasoning, the escalation chain,
partial refunds, the `subscriptions` arm), two of my corrections were wrong
(`cash_drawer`, the `superseded` status's purge claim), and one hard blocker was
missed entirely (the H-9 seal). Every error in the field-classification table ran
the same direction — over-exclusion, which blinds the detector silently. Reviews
3 and 4 found no new architectural problems, only my own inconsistency, which is
the signal that the design has converged.

---

## 16. Gate 2e — delta review of revision 5 (revision 5 → 6)

Verdict on revision 5: **PLAN REVISE**. **A `FIXED`. C `FIXED`.** D `NOT FIXED` —
three residual documentation imprecisions, no new design defect:

| Finding | Disposition |
|---|---|
| §§0, 2 and 11 still described Postgres migration files as created or deleted in Batch 1 | **ACCEPTED.** §0's "written, not applied" (a stale carry-over from the B3 Groups 4–7 precedent) now reads "no Postgres migration file is created at all"; §11's rollback bullets now say there is nothing in the chain to reverse |
| §14 option B "permits immediate sealed-chain edits" | **ACCEPTED.** Option B is now explicitly **not authorised by this plan**, listed only so the founder sees the full option set, with (A) stated as the recommendation |
| §14's pgtest table inaccurate — `h9-api-role-hardening.pgtest.ts` **reads** the checks SQL as text rather than executing it | **ACCEPTED.** Corrected to "reference", with the read-as-text distinction named; the cron pgtest remains the one that necessarily goes red |

Rounds 4 and 5 found **zero** new design defects — only places where the
document still disagreed with itself after the scope change. The design has
converged; what remained was editorial discipline.

---

## 17. Gate 2f — delta review of revision 6 (revision 6 → 7)

Verdict on revision 6: **PLAN REVISE**. Reasons 2 and 3 of item D `FIXED`.
Reason 1 `NOT FIXED` on exactly one surviving line:

> *"Both new PG migrations are **files only** in this batch."*

A revision-1 blockquote in §2 (W4-05's "Rollout caveat"), written when the plan
still intended to add two migration files, and missed by revision 5's sweep
because its wording did not match any of the patterns I grepped for. Rewritten:
W4-05 adds no migration file at all, its SQL sits at the proposed path that no
runner, manifest, document or H-9 check reads, and the shop-identity gap stays
open on the server throughout Batch 1.

**Lesson recorded:** a grep-driven consistency sweep only finds the phrasings you
think of. Revisions 5 and 6 each left one stale line that a full read caught.

## 18. Gate 2g — delta review of revision 7 (revision 7 → 8)

Round 7 found one more active statement, §12 item 11: *"Batch 1 cannot verify the
two PG migrations against a hosted database. They are validated in PGlite only."*
It implied two migration files exist and are validated here. Rewritten to name the
single proposed-path artefact and to say Batch 1 adds no migration file at all.

I then re-swept §§0–12 myself by reading rather than grepping, and tightened one
further line in §2's "superseded by §14" note that said "Both PG migrations are
deferred" without stating the files are never created.

**Rounds 5, 6 and 7 each found exactly one stale sentence and no design defect.**
The design has been closed since round 5 (items A and C accepted FIXED). What
these rounds measured was my editing discipline across a 1,250-line document
revised eight times, and the recurring lesson is the same one §17 recorded: a
grep-driven sweep only catches the phrasings you think to grep for.

**Gate 2 outcome: PLAN ACCEPT at revision 8** after 8 review rounds — 13 + 8 + 4 + 3 + 1 + 1 + 1 findings, all verified against the code and all fixed. Design closed at round 5; rounds 6-8 were prose consistency.
