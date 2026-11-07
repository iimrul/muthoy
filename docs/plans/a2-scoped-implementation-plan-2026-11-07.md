# A2 scoped implementation plan — four items, none implemented

Written 2026-11-07 at the founder's instruction. **Nothing here is implemented.
The Pre-RC criterion stays FAILED and `pre-rc-master-plan.md:383` is untouched.**
Each item below touches sync or money-adjacent paths, so each needs its own
Rule 10 approval; this document is the proposal, not the change.

It builds on [`a2-offline-loss-change-proposal-2026-11-07.md`](a2-offline-loss-change-proposal-2026-11-07.md),
which argued *what* the gap is. This one says *how* it would be closed, and at
what cost.

**One correction to that earlier document first.** It cited the settings entry
as `settings.tsx:219-221`. The real path is
`apps/mobile/app/settings/settings.tsx:221`; there is no
`apps/mobile/app/settings.tsx`. The substance was right, the citation was not.

---

## 0. The facts any implementation must respect

Measured from source, not assumed:

- **`pending + failed` is an upper bound on at-risk operations, not measured
  loss.** `apps/mobile/sync/push.ts:258` completes the server call and only then
  marks rows sent individually (`:306`, `:313`), so an already-applied row can
  sit `pending`. Any UI count is therefore "not yet confirmed backed up", never
  "will be lost".
- **There is a fourth kind of loss outside `pending`/`failed`.** A row marked
  `sent` whose value the server discarded under `sync_apply_row`'s strict `<`
  predicate (`apps/mobile/db/sync-helpers.ts:828-845`) is also destroyed by a
  clear, and no queue count will ever show it.
- **Scale.** One one-item cash sale is 5-6 queue rows
  (`apps/mobile/db/sales.ts:685-692`). A day on a weak connection is hundreds.
- **CLAUDE.md rule 1**: screens read SQLite only, never Supabase. Every count
  below is a local query.
- **CLAUDE.md rule 6**: any figure rendered as money uses the DM Mono variable;
  a plain row *count* is not money and uses Plus Jakarta Sans.

## 1. Visible pending/failed sync indicators

**What exists.** `countFailedSyncRows(shopId)`
(`apps/mobile/db/sync-helpers.ts:1842`) counts `status = 'failed'` and is
covered by four test files. **No screen, banner or badge reads it.** There is no
pending equivalent at all — `listPendingSyncRows(shopId, limit)` (`:1777`)
returns rows under a limit, which cannot answer "how many".

**Change.**

1. `countPendingSyncRows(shopId)` in `sync-helpers.ts`, mirroring
   `countFailedSyncRows` exactly, with `status = 'pending'`. Deliberately *not*
   a combined helper: the two numbers mean different things (`failed` has
   exhausted retries; `pending` has not been tried or is mid-flight) and
   collapsing them hides which one the owner is looking at.
2. A dashboard indicator on `apps/mobile/app/(tabs)/dashboard.tsx`.
3. A line in Settings beside the existing *Sync conflicts* row
   (`apps/mobile/app/settings/settings.tsx:221`), which is currently the only
   sync surface in the app and is about `conflict_queue`, not queue depth.

**The refresh trap, which I have already fallen into once.** A
`useEffect([session?.shopId])` does not re-run when the tab regains focus, so
the number would silently go stale — exactly the defect that made the withdrawn
A1 census unreliable. The indicator must refresh on focus
(`useFocusEffect`) **and** after each push attempt completes, not on mount
alone.

**Wording.** "N changes not yet backed up" or similar. Never "N will be lost":
§0 shows that number can include rows the server already has.

**Tests.** `pending`-only count; `failed`-only count; a `sent` row must **not**
be counted (the `sent`-rows-are-retained semantics are the whole reason a total
is meaningless); zero state renders nothing alarming; count refreshes on focus;
count refreshes after a push.

**Closes:** the "owner could not have known" half. **Does not close:** the gate.
The data is still destroyed if a reset happens.

## 2. Warnings before destructive actions

**The honest limitation first, because it decides how much this is worth.**
The main loss path — Settings → Apps → *Clear data*, and uninstall — happens in
the Android system UI. **The app gets no callback and cannot intercept, delay or
warn.** A warning therefore cannot cover the path that the drill actually
exercises. Anyone reading a plan that promises "warn before destructive actions"
should know it does not reach the destructive action that matters most.

**What is interceptable**, and worth covering:

| Action | Where |
|---|---|
| Sign-out / session end | the auth flow |
| Device unbinding | device-auth paths |
| Server-side re-pull that overwrites local state | `recoverDatabaseFromServer`, `apps/mobile/sync/databaseRecovery.ts` |

**Change.** A single reusable confirmation that (a) reads both counts from §1,
(b) refuses to proceed silently when either is non-zero, requiring an explicit
acknowledgement rather than a default-OK dialog, and (c) writes the
acknowledgement to `audit_logs` so the decision is reconstructable afterwards.

**Residual risk.** An owner who acknowledges and proceeds; and every
non-voluntary reset — corrupt database, failed key unwrap, device loss — which
offers no moment at which to show anything.

## 3. Secure offline outbox backup — feasibility, and a limitation I previously understated

The earlier proposal framed this as "an append-only export of `pending`/`failed`
rows, written on enqueue, consumed by `recoverDatabaseFromServer`". Having
looked at the key lifecycle, **that framing was too optimistic, and the reason
is worth stating plainly.**

**The key-availability problem.** The export must be encrypted —
`sync_queue.payload` holds whole business rows, so a plaintext export is a
straight regression against H-3's threat model. But the natural key is the
existing AndroidKeyStore-wrapped key, and **clearing app data or uninstalling
deletes the app's Keystore entries along with its data directory.** An export
encrypted with a local Keystore key is therefore unreadable after precisely the
event it exists to survive. Encrypting it locally does not work; leaving it
unencrypted is not allowed.

Three designs that genuinely survive, with their real costs:

| Design | Survives a clear? | Cost / objection |
|---|---|---|
| **Server-escrowed key** — fetch or register a wrapping key while online, encrypt the export to it | Yes | Needs connectivity at *some* point before the loss; a shop that has never synced has nothing escrowed. Also puts a recoverable key path on the server, a new attack surface to review. |
| **Owner-held recovery secret** — a code shown once at setup, used to derive the export key | Yes | Real UX burden, and a code nobody wrote down is a key nobody has. The PIN cannot substitute: it is bcrypt-hashed (CLAUDE.md rule 8) and deliberately unrecoverable. |
| **Push sooner** — shrink the window rather than survive it | No | Closes nothing. Honest about it. |

Two further constraints hold for all of them: `allowBackup=false` is deliberate,
so Android auto-backup is not available as a destination; and replay must be
idempotent, because push is already at-least-once and a replayed export must not
duplicate a sale.

**Conclusion for this item.** Outbox survival is feasible but is a
key-management project, not a file-writing one. It should not be costed as
"medium" alongside §1 and §2. If the founder wants the clear path genuinely
closed, server-escrowed key is the design I would take to a proper review; if
not, §4 is the honest alternative.

## 4. Explicit, auditable residual-risk policy

If the founder chooses to accept the exposure rather than engineer it away, the
acceptance should be a record, not a silence. Proposed shape:

- **A dated entry in `DECISIONS.md`** naming: the exposure (unacknowledged
  offline work is destroyed by an app-data clear, reinstall, or unrecoverable
  key failure); its magnitude as a *formula* rather than a number, since the
  number is per-shop and per-day — everything written since the last
  acknowledged push, plus anything superseded in that push; who accepted it; the
  date; and the conditions that would reopen it.
- **A pointer from the Pre-RC criterion** to that entry, so anyone reading
  "no irreversible data loss in any tested path" finds the recorded exception
  instead of assuming there is none.
- **The measurement method** it was accepted against: `restore_drill.md` steps
  11 and 14, which already specify the row-identity sets and the four kinds of
  loss.
- **A review trigger**: re-examine if the outbox design is built, if the loss is
  ever observed in the field, or at the next Pre-RC gate.

**What this is not.** It does not make the criterion pass on engineering merit.
It converts a silent failure into a recorded, owned decision. That is the whole
of its value, and it should not be presented as more.

## 5. Sequencing, and what each item actually buys

| | Item | Closes | Leaves open |
|---|---|---|---|
| 1 | Indicators | Owner cannot see risk | The loss itself |
| 2 | Warnings | Voluntary in-app destruction | The OS-level clear, and all involuntary loss |
| 3 | Outbox survival | The clear and reinstall paths | Device lost/stolen/destroyed; needs a key-management decision first |
| 4 | Risk policy | Nothing technically | Everything — it records, it does not fix |

§1 is worth doing whichever way the bigger question goes: it is small, it has no
architectural consequence, and an owner who cannot see the risk cannot manage
it. §2 is cheap once §1 exists but must be sold honestly, given its blind spot.
§3 is the only item that closes the gate, and it is the expensive one. §4 is the
alternative to §3, not a complement to it.

## 6. Approvals requested

None of this is authorized and none of it is started. The decision I need is
which of §3 or §4 the founder intends, because §1 and §2 are worth building
either way and §3 needs a key-management review before any code is written.
