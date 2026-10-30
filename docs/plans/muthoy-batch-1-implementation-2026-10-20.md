# Muthoy POS — Batch 1 implementation record

**Date:** 2026-10-20
**Baseline:** `origin/main` @ `354fa2a`
**Plan:** `muthoy-batch-1-plan.md` (revision 8, Codex **PLAN ACCEPT**)
**Scope delivered:** 9 of 11 assigned tasks. W4-04 and W4-05 are
**BLOCKED — DEFERRED TO BATCH 3** (`muthoy-five-batch-delivery-ledger.md`).

## Status vocabulary — why nothing here says DONE

`DEVELOPMENT_RULES.md`'s Definition of Done requires, as clause 2, that a
feature *"has been tested on a real Android device, offline"*, and closes with
*"Looks right in the emulator is NOT done. AI said it works is NOT done."*

This batch's authorization explicitly excludes physical-device operations
without separate approval, and the founder's Samsung Galaxy A04s installation
must not be touched. So **no task in Batch 1 can be DONE by the project's own
definition**, however green the suite is. Every task below is therefore labelled
**CODE-COMPLETE — pending device validation**, which means:

- the behaviour is implemented and covered by automated tests that were run, and
- clauses 2 and 3 (real-device test, Validation Checklist) are **outstanding**.

The Validation Checklists owed before any of this can be called DONE are listed
under *Remaining external verification* at the end of this record. Reporting
these as DONE would be precisely the failure clause 2 exists to prevent.

## Test evidence

| Run | Result |
|---|---|
| Full suite, `pnpm test --maxWorkers=2 --minWorkers=1` | **243 files, 5062 tests, 0 failures, exit 0** (2026-10-21, post-closure) |
| Pre-change baseline, same command | 232 files, 4859 tests, exit 0 |
| Net new | **+11 files, +203 tests** vs the pre-Batch-1 baseline |
| `tsc --noEmit` (apps/mobile) | clean |
| `eslint` on every new and changed module | clean |

The earlier Gate 3 run (238 files / 4937 tests / exit 0) is **historical**: the
Gate 5 remediation added test files and changed others, so that result does not
describe this tree. It was held as PENDING rather than carried forward — an
exit-0 claim that predates the code it vouches for is worse than no claim — and
the row above is the re-established result on the final tree.

The exit-0 requirement comes from `DEVELOPMENT_RULES.md`'s working-commit rule;
`--maxWorkers=2 --minWorkers=1` is the command `DECISIONS.md` (2026-10-05)
records as the zero-exit one. A default-worker run reproduces a known 5-second
timeout in `h7-pin-reservation.sqlite.test.ts` under load — that file passes 9/9
alone at a 60-second timeout, so it is load, not a defect.

---

## W3-01 — H-6 conflict queue

**Before:** `NOT DONE`. `conflict_queue` has existed since migration `0000` and
**nothing had ever written to it**. A pull discarded a remote row whenever the
local copy was newer or equal and said nothing; a push was told `'applied'` by
`sync_apply_row` even when its `updated_at < excluded.updated_at` predicate
wrote nothing at all.
**After:** CODE-COMPLETE — detection, de-duplication, retry handling, security tests.

**Source**

| File | Change |
|---|---|
| `apps/mobile/db/migrations/0031_h6_conflict_queue.sql` | new — 9 columns, a partial unique index for de-duplication, one lookup index. No FKs (reason in the header) |
| `apps/mobile/db/migrations/meta/_journal.json`, `migrations.js` | entry 31 |
| `apps/mobile/db/schema.ts` | `conflictQueue` extended |
| `apps/mobile/db/conflicts.ts` | new — `recordConflict`, `listConflicts`, `countVisibleConflicts`, `resolveConflict`, `purgeConflictsForTables` |
| `apps/mobile/domain/serverOwnedFields.ts` | new, pure — which columns the server owns, and the explicit client-owned list |
| `apps/mobile/domain/conflictTables.ts` | new, pure — per-table read/write gates |
| `apps/mobile/db/sync-helpers.ts` | fail-soft detector in `applyToTable`; `preservedLocalFields` extracted; `applyConflictRemoteRow` added; `purgeUnreadableTables` drops conflicts for unreadable tables |

**The two detected cases.** `pull_local_pending` — a remote change arrives for a
row with unpushed outbox work, compared against the **queued payload** rather
than the local row (the row is only whichever side LWW wrote last; the payload
is what this device intends to send). `push_superseded` — the newest outbox row
is `sent`, `remote.updated_at` is **exactly equal** to the pushed timestamp, and
a client-owned field differs. That is provably the strict-`<` predicate writing
nothing while the function answered `'applied'`.

Deliberately silent: `remote > pushed` is ordinary LWW; `remote < pushed` is a
stale pull page and proves nothing.

**Fail-soft.** `sync_queue.payload` is unvalidated `TEXT`, so a legacy or corrupt
value is reachable. A throw inside the apply transaction would wedge the pull —
an incremental pull does not advance its cursor on failure and would re-fetch
the identical page forever. Detection therefore catches everything, records
nothing, throws nothing, emits `sync.conflict_detector.failed`, and lets the row
apply.

**Tests:** `db/h6-conflict-queue.sqlite.test.ts` (14),
`tests/server-owned-fields.test.ts` (18). The second derives the field
classification from **four** sources — `upsertRemoteRow`, `toSyncPayload`, the
migration SQL's pin-vs-conditional-fallback forms, and `push.ts`'s non-SQL
profile write — because an over-exclusion blinds the detector *silently*.

---

## W3-02 — Conflict resolution UI

**Before:** no surface at all.
**After:** CODE-COMPLETE.

`apps/mobile/app/sync-conflicts.tsx` (new), a `RULES` entry in
`navigation/routes.ts`, a count-gated row in `app/settings/settings.tsx`, and 36
catalog keys in both locales.

**`keep_remote` needed a dedicated path.** `applyRemoteRow` returns
`skipped_stale` the moment `local.updatedAt >= remote.updatedAt` — true of every
row a conflict detector flags — so routing the decision through it would have
been a silent no-op on 100% of real conflicts. `applyConflictRemoteRow`
deliberately bypasses the LWW gate and reuses `preservedLocalFields`, so
`batches.stock` and `users.accessLockedAt` are protected by the same code the
pull path uses.

**Superseded outbox rows are DELETED, not status-marked.** Marking them `failed`
would re-raise the same conflict on every pull, trigger stuck-sync warnings for a
row the owner discarded deliberately, and — the security point —
`protectedOutboxGraph` shields `pending|failed` rows from
`purgeUnreadableTables`, which never deletes `sync_queue` rows under *any*
status. The exact bytes are preserved in `conflict_queue.superseded_payloads`,
which the ACL purge does remove.

**Grouped operations refuse `keep_remote`** entirely — absent, not disabled. A
torn sale, refund or purchase group is worse than an unresolved notice.

**Tests:** `db/h6-conflict-resolution.sqlite.test.ts` (15),
`tests/sync-conflicts.test.tsx` (12).

---

## W3-04 — H-8 monitoring core

**Before:** nothing existed. `dev/runtimeDiagnostics.ts` said *"H-8 will add
deliberate observability; until then production emits nothing."*
**After:** CODE-COMPLETE, core only. **H-8 itself stays `NOT DONE`.**

`domain/errorRedaction.ts` (pure), `monitoring/{provider,sink,report,index}.ts`,
wired into `db/init.ts` and `sync/index.ts`.

**A closed-enum DTO, not a scrubber.** `error.message`, `error.cause` and the
stack are **discarded, not redacted** — there is no code path that forwards them.
`error.name` is caller-assignable (`e.name = pin` is legal), so it is mapped
through a known-name table and anything unrecognised becomes `'unknown'`. A
stack's first line *is* the message, so Batch 1 ships **no stack capture at
all**; a safe one needs a validated module-id allowlist that does not exist yet.
`dev/runtimeDiagnostics.ts` keeps its DEV-only raw context and is asserted
**not** to be imported by `monitoring/`.

**Tests:** `domain/errorRedaction.test.ts` (13) drives adversarial inputs — a PIN
in `error.name`, an OTP three levels deep in a `cause` chain, a JWT and a phone
number in the message, a query-bearing route, a throwing context getter — and
asserts none appears in the serialised output.
`monitoring/monitoring.test.ts` (11) covers the bounded FIFO sink, the
no-provider no-op, never-throws, corrupt storage, and static module-graph
assertions (no `fetch`/`XMLHttpRequest`, no `runtimeDiagnostics` import, no
`.message`/`.cause`/`.stack` read).

---

## W3-06 — Payment integration testing

**Before:** the provider contract was covered; the **pipeline** was unreachable
because `payment-webhook/index.ts` called `Deno.serve` at import time.
**After:** CODE-COMPLETE, synthetic only.

`backend/supabase/functions/payment-webhook/handler.ts` — a **pure move** of the
pipeline out of the `Deno.serve` wiring, mirroring the split
`functions/sync/index.ts` (9 lines) and `auth-send-sms` already use. No
predicate, status code or branch altered.

**Tests:** `payment-webhook/webhook.test.ts` (23) — method/signature/body-cap
refusals, the per-IP rate limit and its window reset, form and JSON parsing,
terminal cancel/fail, the keyed idempotent apply, a tampered amount recorded as
`rejected/verification_mismatch` granting nothing, a 500 that leaks no SQLSTATE,
and that no branch echoes the store password.
`sync/payment-integration.test.ts` (24) — non-owner refusal, fail-closed before
any checkout reuse, input validation, `clientRequestId` idempotency, the
`payment_in_progress` 409, the `downgrade_at_expiry` 409, a provider failure
flipping the order to `failed/init_failed`, the server-side amount, and that
`finalizeBillingAttempt` never grants an entitlement.

**No merchant request, no real credential, no live endpoint.** Every provider
call is a double; store id/password are fabricated.

---

## W3-08 — Localization

**Before:** D8 (`app/sale/confirmation.tsx`) had **zero** `useI18n` usage — all
nine strings hardcoded English. D9 (`app/reports/sales-history.tsx`) had no
translator at all, and neither did three sibling screens.
**After:** CODE-COMPLETE (partially — see the gap below). 38 keys added to both `en` and `bn`; six screens fixed —
`sale/confirmation.tsx`, `reports/sales-history.tsx`, `inventory/batches.tsx`,
`inventory/expiry.tsx`, `sale/held.tsx`, plus the new conflicts screen.

The `capitalize`-styled payment type is now a catalog lookup: `capitalize` on the
raw `cash`/`credit` slug could never be translated.

**Tests:** `tests/localization-and-ui-consistency.test.ts` (24) — the W3-08/09/10
ratchet. It scans prop literals, tag text, JSX fallbacks, state-setter
arguments, expression-valued props and template literals, using the catalog's
own key set to tell a key from a sentence; forbids `.message` outright on the
fully-localized screens; and derives three completeness checks from source
(the `SaleHistoryStatus` union, `CONFLICT_TABLE_GATES`, and the error classes
`db/conflicts.ts` throws). Two of its own cases exist only to prove it can
still fail.

`catalog.ts`'s compile-time `_bnParity` check and `i18n/catalog.test.ts` both
pass, so no key exists in one locale only.

---

## W3-09 — Inventory refresh on focus (D10)

**Before:** `useEffect(..., [reloadMedicines])` with an explicit
*"Load-once-on-mount"* comment. Tab screens are not remounted on return, so the
list still read "inventory is empty" after adding a medicine.
**After:** CODE-COMPLETE. `useFocusEffect` (the pattern nine other screens already use)
plus `domain/latestRequestGuard.ts`, so a slow earlier read cannot overwrite a
newer one and repeated focus events do not stack. The expanded-batch cache is
cleared on reload rather than served stale.

Existing `tests/inventory/inventory-remediation.test.tsx` (11) still passes.

---

## W3-10 — UI consistency

**Before:** nothing in `app/` or `components/` read safe-area insets except
`components/auth/AuthShell.tsx`. Three hand-rolled headers
(`(tabs)/dashboard.tsx`, `(tabs)/staff-home.tsx`,
`components/staff/ManagerDashboard.tsx`) rendered under the status bar, so taps
at y ≤ 45px — the language toggle, menu, sync and bell — were swallowed by
system UI.
**After:** CODE-COMPLETE.

1. **D11:** all three read `SafeAreaInsetsContext` and pad by `insets.top`, using
   AuthShell's `?? 0` degradation so a screen rendered outside the provider gets
   zero instead of throwing.
2. **Alert → Toast:** the one **success** confirmation ("Refund committed")
   became a card Toast. Failures and destructive confirmations keep their
   dialogs — `Toast.tsx`'s own contract says a toast is never how a failure is
   reported, and a confirmation needs a button.
3. **Touch targets:** `hitSlop` on every new control whose visual box is under
   44px.
4. **Semantic tokens:** four raw `#047857` literals replaced with the existing
   `auth-heroEnd` token (identical value). No new palette invented.

---

## W3-11 — Core workflow regression

**Before:** every workflow had its own suite; nothing tested them **in sequence**
against shared state.
**After:** CODE-COMPLETE. `db/core-workflow-regression.sqlite.test.ts` (18).

Drives a business day on real SQLite — open the drawer at 0, stock a medicine,
two cash sales, an expense, the day's totals — and re-asserts after **every**
step:

- `batches.stock == SUM(inventory_movements.change_qty)` per batch;
- `netSales == saleTotal − refundTotal` and `taxCollected == saleTax − refundTax`,
  recomputed from raw rows and compared against `db/reports.ts`;
- every money column is an integer.

Checking only at the end would hide a step that broke and a later step that
compensated.

Also: the ledger triggers refuse a direct `stock` assignment **and** a movement
delete, and the offline half proves every queued operation group is complete,
correctly sequenced and single-kind — so a reconnect cannot apply half a sale.

Totals are asserted **relatively** (against the system's own returned total)
rather than against a hardcoded figure, so the suite tests composition rather
than the fixture's tax arithmetic.

**Scope note:** the dedicated suites (`purchase-*.sqlite.test.ts`,
`b2-refunds.sqlite.test.ts`) still own each workflow in isolation. What this
file adds is the *sequencing* layer — the interaction none of them can see — and
after the Gate 5 delta review it covers the full assigned list: sales,
purchases (including a pending line), credit and collection, refunds, purchase
returns, stock movements, close-day accounting and offline behaviour.

At-least-once delivery has its own file, `db/push-replay.sqlite.test.ts`, which
drives `sync/push.ts`'s real loop against a stateful server double: the server
commits, the response is lost, the device retries the same bytes, and the
server ends with ONE record: one insert, zero updates and one NO-OP, because
`sync_apply_row`'s predicate is a strict `<` on `updated_at` and an identical
replay therefore writes nothing. The queue-state tests in
this file prove the outbox bookkeeping around that; they do not prove delivery,
and are titled accordingly.

---

## W5-15 — DEV credential exposure assessment

**Verdict: NO EXPOSURE FOUND.** Four passes — tracked tree, full public history,
entropy-and-proximity hunt for *partial* fragments, and the published surface.
All 6 credential-shaped hits are fabricated test fixtures; all 137
partial-fragment candidates are identifiers or SHA-256 content hashes; no token
decodes to `role: service_role`.

`docs/plans/muthoy-w5-15-dev-credential-assessment-2026-10-20.md`. No secret
material printed or committed; scanners kept in the scratchpad. **No rotation
performed** — it needs separate founder authorization, and §5 of that document
explains why it is not recommended on this evidence.

---

---

## Gate 5 — Codex final review, and what it changed

One comprehensive independent review of the staged scope returned **REVISE**
with 11 findings. All 11 were addressed in-batch. Six were real defects in
shipped behaviour, not documentation quibbles; two of those were in code the
earlier rounds had already approved, and three were in **my own tests**, which
is the more uncomfortable half of the list.

| # | Finding | Resolution |
|---|---|---|
| 1 | `keep_local` never bumped `updated_at`, so "keep mine" lost the next sync — and the test used `>=`, so it was vacuous | Bump to `max(local, remote, now) + 1ms` and re-queue; test now asserts a strict increase past both sides |
| 2 | A malformed queued payload fell back to the local row, manufacturing a false conflict | Unparseable payload now reports `sync.conflict_detector.failed` and declines to record |
| 3 | The resolver trusted a caller-supplied role; `subscriptions` and `batch_promotions` gates disagreed with the server | Actor re-derived from SQLite inside the transaction; gate union extended with `never`, checked before the owner shortcut |
| 4 | W3-11 claimed coverage it did not have | **Extended** (below), not narrowed |
| 5 | Payment idempotency asserted mock call counts, not no-double-charge | Rewritten as an outcome test (below) |
| 6 | `attempt` was an arbitrary integer channel — one test asserted a paisa amount survived redaction | Replaced with `ATTEMPT_BUCKETS`; the field can no longer carry a value |
| 7 | `/sync-conflicts` was only reachable from owner-only Settings, so staff could never see a conflict they are permitted to resolve | Added an explicit `allRoles` opt-in to `MORE_ROUTES` rather than relaxing the permission-less default |
| 8 | W3-08 left screens visibly English; the promised static test was absent | Test written (it found real misses); residual gap disclosed below |
| 9 | The focus read had no blur cancellation | Cleanup flips an `active` flag checked before every `setState`; asserted statically |
| 10 | The field-classification guard flattened fields across tables, so a misassigned field passed | Per-table parsing with extras and non-vacuity checks |
| 11 | Tasks were labelled DONE against a Definition of Done they cannot meet | Relabelled **CODE-COMPLETE — pending device validation** throughout |

### The delta review, and the six fixes that were not yet right

The targeted delta review of those 11 remediations returned **DELTA REVISE**:
findings 1, 2, 3, 6 and 7 were accepted as resolved; 4, 5, 8, 9, 10 and 11 were
not. It was correct on all six, and three of them were cases where the first fix
had made a *claim* rather than a change.

| # | What was still wrong | Second fix |
|---|---|---|
| 4 | The "replay" test called queue bookkeeping helpers directly — no push ran, so "applied exactly once" was unproved | New `db/push-replay.sqlite.test.ts` drives `sync/push.ts`'s **real loop** against a stateful server double: the server commits, the response is lost, the device retries the same bytes, and the server ends with **one insert, zero updates and one no-op** — a strict `<` on `updated_at` means an identical replay writes nothing. The queue-state tests were retitled to what they actually prove |
| 5 | The fake deduplicated on `p_event_key`; the real SQL upserts `on conflict (provider, validation_id)` and short-circuits on **order status**. Two validations against one order were being called "two payments", which is the opposite of what the database does | Fake rewritten from the migration: events keyed on `validation_id`, grant suppressed once the order is `verified`. The two-payment case now uses two distinct orders |
| 8 | "Fully localized" was false — Sales History still had five English strings, and the detector only saw prop literals and simple tag text | Eight more strings localized (including the raw `payment_type` enum slug and the English reason `db/refunds.ts` returns). Detector rewritten: prop literals **plus** tag text with punctuation **plus** `??`/`||`/`:` fallbacks inside JSX, using the catalog itself as the oracle for key-vs-prose, with a non-vacuity proof |
| 9 | `resolve()`'s post-await writes were still unguarded, so a resolution could overwrite fresher rows after a blur | A focus-generation token: the cleanup bumps it, and every async write re-checks it. `setBusyId` clears functionally and only for its own row — an unconditional clear looked safe and was not, since a resolution that lost its focus could clear a LATER one’s spinner and re-enable its button mid-flight |
| 10 | The "extras" check validated only table **names**, so a bogus extra field still passed and silently blinded that table's detector | Each declared field must now name its evidence — a needle in `sync-helpers.ts`, `push.ts` or the migrations — and the declared set must equal the evidenced set exactly. Verified by mutation: adding `sales.total` fails two tests |
| 11 | Three completion claims survived (`COMPLETE` in the ledger, `DONE`/`PASS` for H-6 in the pre-RC plan, "nine completed tasks" in the plan) | All three relabelled |

Finding 8's second pass is the one worth dwelling on: the first fix wrote a test,
the test passed, and the screen was still English. A test that cannot see the
defect is worse than no test, because it converts an open problem into a false
assurance — which is exactly what the ratchet's own non-vacuity case now guards
against.

### Finding 4 — W3-11 extended rather than narrowed

The original brief assigned W3-11 as tests for *"sales, purchases,
returns/refunds, stock movements, offline behavior, accounting"*. The first cut
covered sales, stock movements, expenses, reporting and offline queueing, and
the record claimed the rest. Narrowing the claim would have been honest but
would also have quietly shrunk an assigned deliverable, so the suite was
extended instead — now **18 tests**, adding:

- a supplier invoice where a **pending** line adds no stock until received
  (IC-11 — the ledger must not claim units nobody can sell), then the receipt
  that does move it;
- a **credit sale** (drawer untouched, `credits.balance` booked) and the
  **customer payment** that clears it;
- a **refund**, asserting gross is unchanged and only *net* falls — the W4-04
  defect in miniature, checked in both directions so a report that quietly
  reduced gross would still fail;
- a **purchase return**, through the ledger;
- **close-day**: `cashSales` against `SUM(sales.cash_applied)`, opening cash 0,
  the drawer's `closed_by` identity, every figure an integer;
- a **failed-then-successful push replay**: a transient failure stays queued and
  increments `attempts`, a send retires the row exactly once, a replayed send is
  idempotent, and only exceeding the attempt limit marks it failed.

Cash is asserted against the system's own `getCashSummary` figures, never
re-derived here — CLAUDE.md rule 4.

### Finding 5 — what the payment tests now prove

The no-double-charge guarantee lives in Postgres: `b4_apply_verified_payment`
identifies the event row by `(provider, validation_id)` and suppresses a second
grant when the ORDER is already `verified` — the event key is carried for
traceability, not for deduplication.
`backend/supabase/pgtest/b4.pgtest.ts` already proves against real Postgres that
a replay advances `version` exactly once and leaves exactly one event row. The
handler test was asserting `toHaveBeenCalledTimes(2)`, which would pass even if
the handler sent a different key every delivery.

It now drives three identical redeliveries through a fake that enforces the key
the way the SQL does, and asserts the **outcome**: one grant. Its mirror asserts
that two *different* validation ids stay two payments — the opposite failure, in
which a constant key swallows a second real payment and the shop pays twice for
one credit. It also asserts the handler sends **no** amount, so a tampered
callback cannot raise the credit.

### Finding 8 — the localization gap, and its closure

The static ratchet found hardcoded strings I had missed, which were fixed; it
then kept finding more, which was worth stating plainly rather than burying.
Through Batch 1 the position was:

- **Fully localized:** `sale/confirmation.tsx` (D8), `reports/sales-history.tsx`
  (D9), `sync-conflicts.tsx`.
- **Partially localized:** `inventory/batches.tsx`, `inventory/expiry.tsx`,
  `sale/held.tsx` — their verified error-dialog and empty-state defects fixed,
  their field labels and section titles still English.

**Closed 2026-10-21.** All three are now fully localized and promoted into the
single `FULLY_LOCALIZED_SCREENS` tier, so no screen is held to a weaker
standard. What the closing pass added:

- field labels, section titles, placeholders, button and accessibility labels;
- the **expiry band names** (`expired`/`critical`/`warning`/`ok`/`unknown`),
  which rendered from a dynamic expression and so were invisible to any literal
  scan — now keyed and checked for completeness against the `ExpiryStatus`
  union, which is composite, so the test resolves both unions;
- the `in stock` and `d left` suffixes, which sat **between two expressions**
  and could not be seen by the tag-text or prop passes — the detector now has
  a pass for that shape;
- the **batch-form field errors** (`DuplicateBatchError`,
  `BatchExpiryMismatchError`), which reached the user through
  react-hook-form's `setError({ message })` rather than a dialog.

The detector also stopped reporting `className` template literals, which were
two false positives — noise in a ratchet's output teaches the next reader to
ignore it.

The detector is now exercised directly rather than taken on trust: **17 planted
shapes** must each be reported (prop literals in both quote styles, tag text,
`??`/`||` fallbacks, both ternary branches, state-setter arguments, expression
props, template literals, prose before/between/after an interpolation including
across newlines, and a label that happens to be a JS keyword) and **5 planted
non-shapes** must not be (a catalog key, an enum comparison, a `className`
string, `} catch (`, `} else {`).

That matters because two earlier versions of this file were wrong in ways no
review caught: three regexes carried a literal `0x08` byte where `\b` was
intended, and the between-expressions pass excluded the very separator in the
example it cited — so it could not match `{qty} in stock · {expiry}`. A
mutation test I described as verifying that pass had in fact exercised an older
one. The exact-literal backstop is therefore **kept**, not retired: regex over
source under-matches by nature, and an AST-based check is the real answer when
this needs to scale.


---

## Remaining external verification

| Item | Owed to |
|---|---|
| H-8's five failure classes in a real provider, proven on a device | Batch 3+ |
| H-6's physical two-device conflict | post-RC / pilot, alongside H-7's convergence gap |
| Server-side `'stale'` return from `sync_apply_row` (closes the push-detection blind spot) | needs a migration **and** a function redeploy |
| W4-04 and W4-05 | Batch 3, behind the H-9 migration-chain seal |
| Migration `0031` on a real device | ships with the next build; additive `ALTER TABLE` on a table that is empty everywhere |

### Ownership addendum — 2026-10-23 (delivery regrouping, FIVE batches to SIX)

**Nothing above is retracted.** The table was written on 2026-10-20 and was
accurate then; Batch 6 did not exist. This addendum records only where two
items are owned NOW, after the founder extended the delivery grouping on
2026-10-23:

| Item from above | Owner when written | Owner now |
|---|---|---|
| Live payment acceptance (gate E6, raised during Batch 1 closure) | Batch 5 | **Batch 6, B6-02** — direct bKash merchant gateway |
| The payment-provider decision (gate E5) | founder, open | **CLOSED by the founder**: SSLCommerz is no longer approved and direct bKash is the only approved subscription gateway. Batch 2's W4-10 retired SSLCommerz initiation; delivery of bKash is **B6-02** |

Everything else in this table stands as written: H-8 and H-6 keep their owners,
and W4-04/W4-05 remain Batch 3 behind the H-9 seal. No Batch 1 task's status
changes — all nine remain CODE-COMPLETE and none is DEVICE-VERIFIED.
