# Batch 3 — reconciling "twenty device checks" with the six documented cases

Asked for: reconcile the earlier *twenty device checks* against the six
high-level acceptance cases the repository documents, without inventing a
twenty-item authoritative matrix, and separate completed from unverified.

## 1. There is no twenty-item matrix, and there never was one

Searched every `.md` under `docs/` plus `DECISIONS.md`. The number **twenty**
appears as a **bare count with no list attached**:

| Where | Text |
|---|---|
| `muthoy-batch-3-operational-closure-readiness-2026-10-30.md:1225` | §16 Two-device mobile acceptance — *"Zero of twenty cases executed."* |
| `muthoy-batch-3-final-closure-execution-2026-10-31.md:399` | *"None of the twenty Batch 3 …"* |
| `muthoy-batch-3-final-operational-closure-2026-10-31.md:894` | *"The device scenarios …"* |

No file enumerates twenty device cases. The **only** enumerated set is
`muthoy-batch-3-hosted-and-device-gate-packages-2026-10-30.md` §3.3,
*"What to test, and why these six"*, with six numbered cases and an explicit
acceptance rule: *"each case recorded with the device, the build revision and
the observed result. A case that cannot be run is recorded as not run."*

An earlier correction of mine claimed "the twenty" appeared **only** in my two
2026-10-31 documents. That was also wrong: it predates them, at line 1225 above.

**Conclusion: six is authoritative. Twenty was never a matrix.**

## 2. The individual checks, derived from the requirements

The six cases are aggregates. Decomposing each into the atomic assertions its own
text and the cited CLAUDE.md rules actually require yields the table below.

This decomposition is **derived here**, from requirements — it is not a recovered
original list. It happens to total twenty, which may be where the number came
from, but nothing in the repository supports treating that as more than a
coincidence, and it is recorded as a derivation rather than a discovery.

| # | Check | Source | Status |
|---|---|---|---|
| 1.1 | A new owner can register on a device a previous owner used | §3.3 case 1 | NOT RUN |
| 1.2 | The new owner sees **no** trace of the previous owner's shop | CLAUDE.md r7 | NOT RUN |
| 1.3 | Every shop has a unique, non-hardcoded id | CLAUDE.md r7 | NOT RUN |
| 2.1 | Shop A's rows never reach Shop B | §3.3 case 2 | NOT RUN |
| 2.2 | Shop B's rows never reach Shop A | §3.3 case 2 | NOT RUN |
| 2.3 | Isolation holds while both devices sync concurrently | §3.3 case 2 | NOT RUN |
| 3.1 | A sale completes with no network at all | §3.3 case 3 | **PASS** |
| 3.2 | The queue drains on reconnect | §3.3 case 3 | **PASS** (client-side) |
| 3.3 | It drains **once** — no duplicate | §3.3 case 3 | **PASS** (client-side) |
| 3.4 | Totals match after the drain | §3.3 case 3 | **PASS** (client-side) |
| 3.5 | Same, with the app killed during the sync window | §3.3 case 3 | **PASS** (client-side) |
| 3.6 | No sync conflicts are produced | §3.3 case 3 | **PASS** |
| 4.1 | A refund for a sale from another day lands in that day's period | §3.3 case 4 | NOT RUN |
| 5.1 | Opening cash defaults to 0 | CLAUDE.md r5 | **PASS** |
| 5.2 | The user can set opening cash | CLAUDE.md r5 | NOT RUN |
| 5.3 | It resets at midnight and never inherits yesterday | CLAUDE.md r5 | NOT RUN |
| 6.1 | The expiry day-count is correct for the day it is read | CLAUDE.md r3 | **PASS** |
| 6.2 | Ordering uses the real expiry date, not a stored day-count | CLAUDE.md r3 | **PASS in source**, not on device |
| 6.3 | The earliest-expiring batch **within one medicine** is selected | CLAUDE.md r3 | NOT RUN |
| 6.4 | A sale larger than one batch spills to the next by expiry | CLAUDE.md r3 | NOT RUN on device |

**7 PASS, 13 NOT RUN.**

## 3. Why each NOT RUN is not a software defect

| Checks | Blocker |
|---|---|
| 1.1–1.3 | Requires registering a second owner, i.e. signing out of the only configured test shop. Those credentials are the founder's. |
| 2.1–2.3 | Requires a second physical handset. One is attached. |
| 4.1 | Requires a sale dated to a **previous business day**. Sales history was empty at the start of the run, and the device clock is not settable without root — which is prohibited. |
| 5.2–5.3 | Same clock limitation: no day boundary can be crossed, and this shop has no prior-day cash session to inherit from. |
| 6.3–6.4 | **Was physically impossible until 2026-11-01.** The build then installed had no way to place two batches under one medicine — Manual Entry forked a parallel medicine row instead, and Edit Medicine exposed only "Edit batch". That defect is fixed in `9ed99b4`; these two checks need a Preview build carrying it. |

## 4. Caveat on the six that did pass

Checks 3.2–3.5 are marked *client-side*. Every observation came from the device's
own store; no DEV credential was available, so it was never confirmed that either
sale reached the hosted database, nor that it arrived once. "The queue drains
once" is shown for the **local** queue only. Settling it needs a service-role
read of DEV.

Check 3.5 is additionally weaker than its name suggests: the app was force-stopped
2.5 s after the radios were re-enabled, and nothing was captured proving a request
was in flight at that instant. The defensible claim is restart recovery, not
mid-flight interruption.

Check 6.2 passes **in source** — `domain/fefo.ts`'s `sortByExpiry` orders by the
real `expiryDate` with null last and recomputes per call — but the device evidence
originally offered for it was wrong. The sale list is ordered
`ORDER BY m.name COLLATE NOCASE, m.id`, so the observed order was a tiebreak on
`m.id`, not FEFO. Recorded in the 2026-11-01 `DECISIONS.md` entry.

## 5. Build status for checks 6.3 and 6.4

The restocking correction is `9ed99b4` (CI `41313642939`, success). A Preview
build carrying it exists and is verified:

| | |
|---|---|
| EAS build | `47c9f0aa-34e9-4655-a24e-31af8dfcbed3` |
| Commit | `9ed99b4fc457d96458dea2d9ac355b5008a58e38` |
| Status | FINISHED |
| Size | 215,951,244 bytes |
| sha256 | `6239d705335b8799db5462c786248fdf47a0cc430461e318fc68c618774ac61d` |
| Validator | `Mobile environment validation PASS` (archive + identity), exit 0 |

It is **not installed**. The handset disconnected from USB before the build
finished, so checks 6.3 and 6.4 remain NOT RUN for a physical reason and not a
technical one. Installing this build and running them is the only remaining step
for case 6; everything it depends on is done.
