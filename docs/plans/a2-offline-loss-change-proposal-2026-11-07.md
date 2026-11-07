# Change proposal: offline data loss and the Pre-RC no-irreversible-loss gate

Raised 2026-11-07, out of H-11 Part B. **A proposal for the founder's decision.
Nothing here is implemented, and the signed acceptance criterion is unchanged.**

The criterion in question, verbatim from
[`pre-rc-master-plan.md:383`](pre-rc-master-plan.md) (BACKUP / RECOVERY,
CRITICAL):

> cloud backup verified · restore drill on a new device · migration
> recovery/rollback rehearsed (H-11) · **no irreversible data loss in any tested
> path**

**Status: FAILED, and not closable by changing the drill.** This document exists
because three successive attempts to resolve it inside `restore_drill.md` were
each rejected by independent review for being quietly weaker than what they
replaced — the last by redefining which run counts as the tested path. The gate
is a product question, so it is put here as one.

---

## 1. Two populations of data, and only one of them is recoverable

This distinction is the whole proposal. Conflating them is what produced three
bad drafts.

| | **Cloud-confirmed records** | **Unacknowledged offline transactions** |
|---|---|---|
| What they are | Rows the server has accepted and stored | Rows written on the device whose push has not been acknowledged — `sync_queue.status` `pending` or `failed` |
| Survive an app-data clear? | **Yes.** `recoverDatabaseFromServer` re-pulls them in full (`apps/mobile/sync/databaseRecovery.ts`, `pullChanges(shopId, null)`) | **No.** The server never had them; the clear removes the only copy |
| Survive a key-unwrap failure? | Yes, same path | No, identically |
| Measurable | Yes, per `restore_drill.md` steps 11 and 14 | Yes — as an **upper bound**; see §2 |
| Pre-RC exposure | None. This half of the drill can pass | **This is the entire failure** |

A third, smaller population: **device-local-only state** — the H-4 attempt
budget, pull cursor, printer pairing, locale, business-day state. It is
deliberately never synced and rebuilds itself. It is not business value and is
not part of this proposal.

## 2. What "expected loss" actually equals, and why the number is a bound

`pending + failed` is an **upper bound on at-risk operations, not measured
loss**. `apps/mobile/sync/push.ts:258` completes the server call and only then
marks rows sent individually (`:306`, `:313`), so a lost response or a crash
between those two steps leaves an **already-applied** row sitting `pending`.
Such a row is at risk on the device and present on the server.

In the other direction the bound is not a floor either: a row marked `sent`
whose value the server discarded under `sync_apply_row`'s strict `<` predicate
(`apps/mobile/db/sync-helpers.ts:828-845`) is also destroyed by a clear, and it
sits outside the `pending`/`failed` set entirely.

So the honest statement of exposure is: **everything written since the last
acknowledged push, plus anything superseded in that push, is at risk.** Only
reconciling row identities against the server converts that into a measurement.

**Scale, for the decision.** One one-item cash sale is 5-6 queue rows
(`apps/mobile/db/sales.ts:685-692`). A pharmacy working a full day on a weak
connection accumulates hundreds of queue rows. The exposure is not a rounding
error; it is a day's takings.

## 3. User-facing warning: what exists today, and what does not

Today the app has **one** sync surface, and it is the wrong one for this risk:

- **Exists:** Settings → *Sync conflicts* (`apps/mobile/app/sync-conflicts.tsx`,
  reached from `apps/mobile/app/settings/settings.tsx:221` — corrected
  2026-11-07; the path first recorded here, `settings.tsx:219-221`, does not
  exist), which lists `conflict_queue` rows and lets the owner resolve them.
- **Does not exist anywhere:** any indication of **how much unsynced work is at
  risk**. `countFailedSyncRows` (`apps/mobile/db/sync-helpers.ts:1842`) is
  implemented and **surfaced nowhere**; no screen, banner or badge reads the
  queue's depth. A grep over `app/`, `components/` and `state/` returns nothing.

**So an owner cannot currently know they are carrying unsynced work**, which
means they cannot choose to reconnect before doing anything risky, and cannot be
said to have accepted the risk. That is the gap a warning would close, and it is
the cheapest item in §4.

## 4. Options, cheapest first

None is implemented. Costs are relative shape, not schedule. All touch sync or
money and therefore need a scoped Rule 10 approval of their own.

### Option 1 — Surface the exposure (low cost, no architecture change)

Show unsynced depth where the owner will see it: a dashboard badge and a line in
Settings beside the existing conflicts entry, reading `pending + failed` for the
shop. Warn before any destructive or risky action while the count is non-zero.

- **Closes:** the "owner could not have known" half of the problem.
- **Does not close:** the gate. The data is still destroyed if a reset happens.
- **Residual risk:** an owner who reads the warning and proceeds anyway; and a
  reset that is not voluntary — corrupt database, failed key unwrap — gives no
  opportunity to read anything.

### Option 2 — Make the outbox survive a reset (medium cost, closes the clear path)

Persist the unsynced queue outside the app data a reset destroys, so recovery can
replay it: an append-only export of `pending`/`failed` rows and their payloads,
written on enqueue or on a short timer, consumed by `recoverDatabaseFromServer`.

- **Closes:** the app-data-clear path, and a reinstall.
- **Does not close:** a device lost, stolen or physically destroyed.
- **Residual risks, and they are real.** `sync_queue.payload` holds full
  business rows, so the export inherits the SQLCipher threat model — written in
  plaintext it would be a straight regression against H-3. It needs its own
  replay idempotency, because the outbox is already at-least-once and a replayed
  export must not duplicate a sale. And `allowBackup=false` is deliberate, so
  Android auto-backup is not available as the destination.

### Option 3 — Narrow the window (medium cost, reduces exposure, closes nothing)

Push more aggressively when connectivity returns; warn hard when the queue has
been non-empty beyond some age.

- **Closes:** nothing. It shrinks the window.
- **Residual risk:** the whole exposure still exists, for less time.

### Option 4 — Scope the criterion (no engineering cost, founder decision only)

Amend `pre-rc-master-plan.md:383` so "any tested path" explicitly excludes
deliberate destruction of unacknowledged offline work, and record that exclusion
as an accepted risk with its magnitude from §2.

- **Closes:** the gate, by definition rather than by engineering.
- **This is a legitimate option and is stated as one.** It is also precisely what
  the three rejected drafts were doing implicitly; the difference is that this
  one is explicit, costed, and leaves an audit trail.

## 5. Recommendation

**Option 1 regardless of what else is chosen** — an owner who cannot see the risk
cannot manage it, the change is small, and it has no architectural consequence.

Then **either Option 2 or Option 4, as a deliberate choice**: build outbox
survival, or accept and record the loss. Option 3 is worth having alongside one
of those, never instead of one.

What should **not** happen is the gate quietly passing. Until the founder
decides, `restore_drill.md` records it FAILED and H-11 C5 cannot report a Part B
pass of this criterion.

## 6. What this document does not do

- It changes no acceptance criterion. `pre-rc-master-plan.md` is untouched.
- It implements nothing and proposes no migration.
- It does not estimate calendar effort.
- It does not decide. Per CLAUDE.md's review workflow anything touching money or
  stock is the founder's call, and the loss here is money.
