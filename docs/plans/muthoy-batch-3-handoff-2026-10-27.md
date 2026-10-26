# Muthoy Batch 3 — handoff, 2026-10-27

**Read this first**, then `docs/plans/muthoy-batch-3-plan.md` (revision 5,
accepted) and `docs/plans/muthoy-batch-3-handoff-2026-10-26.md` for steps 1–7.

This session completed **steps 8, 9 and 10**, closed both deferred validations,
finished the four inherited pages, and then ran **Gate 5**, which returned
**REVISE with 17 findings**. **All five P1 findings are fixed and verified.
Twelve P2 findings are open.**

**NOTHING IS PUSHED.** Gate 6 requires FINAL ACCEPT and the verdict is REVISE.

---

## 1. State, verified

| Thing | Value |
|---|---|
| Branch | `main` |
| Local HEAD | `d4cca3b` |
| `origin/main` | `c25924e` — **nothing pushed for Batch 3** |
| Commits ahead | **26** |
| Protected untracked paths | **38, untouched** (26 `scripts/h9/**`, 8 `docs/plans/h9-*`, 4 prototype) |
| `audit-artifacts/**` | **clean — not one file modified** |
| H-9 baseline hashes in the E4 manifest | **unchanged** (`361a400a…`, `0b949fa9…`) and still asserted |

### This session's six commits, oldest first

| SHA | What |
|---|---|
| `437dcb0` | the four inherited pages finished to their §8 scope |
| `5a00012` | **step 8** — W2-03 |
| `1f12f99` | §8.4's missing W4-04 section, and both deferred validations |
| `75a13f0` | **step 9** — the documentation |
| `07ee95a` | **step 10** — the definitive suite record |
| `d4cca3b` | **Gate 5's five P1 findings** |

---

## 2. Step 10 is MET — the handoff's blocker is resolved

```
npx vitest run --pool=threads --poolOptions.threads.maxThreads=4

  Test Files  288 passed (288)
       Tests  6397 passed (6397)
      Errors  none
    Duration  966.13s
  VITEST_EXIT 0
```

Captured as `VITEST_EXIT=$?` immediately after the process — **not** a
background wrapper's code.

The previous run's two `[vitest-worker]: Timeout calling "onTaskUpdate"`
reporter-RPC errors are gone under the bounded worker count plan §11 itself
prescribes. **`vitest.config.ts`'s execution settings were NOT touched** —
`teardownTimeout` was not raised and the reporter was not quietened. The only
change to that file is one added test file in `include`.

Also green: turbo `lint` + `typecheck` **14/14 tasks, 0 errors**; `eslint .` in
`apps/admin` exit 0; `next build` exit 0, **19 routes**.

**Two suites fail under CPU contention and pass standalone** — plan §11 predicts
exactly this class. `apps/mobile/tests/eas-archive.test.ts` (45/45 alone) and
`apps/admin/app/adminRoutes.contract.test.tsx` (81/81 alone). **Re-run anything
that fails in a parallel run before treating it as a regression.**

---

## 3. Gate 5 — the verdict and what was done about it

Reviewer: Codex `gpt-6.1-sol`, via `codex exec --sandbox read-only`. The full
output and the brief are in this session's scratchpad as `gate5-result.txt` and
`gate5-review-brief.md` — **a session-scoped temp path, so copy them somewhere
durable before relying on them.** Every finding is reproduced in §4 below, so
the scratchpad is a convenience rather than the record.

The reviewer could not run Vitest (`spawn EPERM` under its sandbox), so it did
**not** independently reproduce the 6 397-test result. It did reproduce every
defect below with Node and in-memory probes.

### The five P1s — ALL FIXED in `d4cca3b`

Each was verified against the code before being fixed; all five were real. The
commit message carries the full reasoning. Summary:

1. **Session revocation restored access** — wrote the environment role and
   `isActive: true` unconditionally, so revoking a disabled, narrowed account
   re-enabled it at full authority. Now reads and preserves the stored row.
2. **An audit failure could crash the login path** — queued promises could
   reject with nobody flushing. Now handled in the same turn they are created;
   `flush` still reports the failure.
3. **W2-03 did not survive ordinary use** — the app's own medicine writes never
   set `search_key`, so a renamed medicine kept answering to its old name and
   the backfill never repaired it. One shared `searchKeyFor` now folds at every
   write path.
4. **The k=5 floor was bypassed** on `activity_summary` via union contributors.
   Per-value gating added; the test that asserted the bypass is retargeted.
5. **`/revenue` could announce "No billing exception"** while three of §8.4's
   five classes went unchecked. All five are now computed.

---

## 4. WHAT IS LEFT — the twelve P2 findings

**These are the work.** Verify each against the code first: one P1 above —
a test rationalising a privacy bypass as "safe BECAUSE five shops stand behind
the row" — shows that a test can encode a defect and still sound reasonable.

| # | File | Finding | Prescription |
|---|---|---|---|
| 6 | `app/audit/page.tsx:212` | Action options such as `authz.` and `session.` are submitted through `plan`, **whose schema rejects dots** — the Action filter is unusable. **Mine, from this session.** | Add a bounded action-filter field to `adminListQuerySchema` (dots allowed, e.g. `/^[a-z_.]*$/`, ≤64) rather than reusing `plan`; submit the **rendered** options in a test |
| 7 | `app/analytics/page.tsx:114` | Dates reach queries without shared-schema validation; the 400-day limit appears only as page text | Validate through the shared schema **before** loading; test invalid, reversed and oversized ranges |
| 8 | `app/analytics/page.tsx:208` | §8.5's conversion, subscription growth, recorded-cancellation series and sales-volume **count** are absent; conversion is absent from the billing page too | Implement with populated route tests. **The acceptance record claims these — correct it if the work is deferred** |
| 9 | `lib/adminReports.ts:448` | Several reports **ignore the selected status** while the subtitle claims it applies; a suspended-only pharmacy-sales report returned the full total | Filter per report, or **reject an unsupported filter explicitly**. An export whose subtitle contradicts its rows is the worst option |
| 10 | `lib/adminPlatformQueries.ts:509` | Registration buckets use **UTC string slicing**, not the Dhaka day; `adminReports.ts:456` repeats it. A `2026-10-25T20:00:00Z` registration lands on Oct 25 instead of Oct 26 | Reuse `dhakaDayLabel` (already in `lib/adminDashboard.ts`) in both places; test the midnight boundary. **The Dashboard already does this correctly, so the three views disagree today** |
| 11 | `app/page.tsx:124` | The active/trial cards count **literal statuses** rather than §5.1c's canonical entitlement predicates, so expired rows stay counted and grace/canceled differ | Reuse the canonical predicates from `lib/adminMetrics.ts`; assert numeric results across statuses and expiry boundaries |
| 12 | `lib/adminLabels.test.ts:309` | Mutation 2 **never evaluates its mutant against a rejecting guard** and targets collected payments rather than MRR; a fabricated pharmacy anchor passed all assertions | Make the mutant actually fail a guard, and strengthen the second provenance anchor so a fabricated `pharmacyNetSalesPaisa` does not satisfy link 1 |
| 13 | `app/adminRoutes.contract.test.tsx:269` | Authorized-empty tests accept **any sufficiently long error notice**; the query-failure injection also breaks `admin_role_assignments`, so business reads never happen | Keep authorization healthy during table-specific failures; require populated successful results and the intended reads per route |
| 14 | `app/support/page.tsx:146` | Only a status filter; §8.7's **search, transition history and account context** are absent | Implement and test matching, non-matching and historical fixtures |
| 15 | `app/admins/page.tsx:359` | §8.8's **security history filtered to `admins.*`, `login`, `session.*`** is absent | Add it with positive/negative filtering tests |
| 16 | `app/shops/[id]/page.tsx:187` | "Support notes" renders case **summaries without reading notes**; owner information and latest activity are absent. **Mine, from this session.** | Read `admin_support_notes` for the shop's cases; add owner and latest activity to the detail model; test two-shop isolation with real note fixtures |
| 17 | `app/maps/page.tsx:57` | §8.6's **district and subscription-status filters** are absent from page and canvas | Implement and test behind the existing consent/provider gates |

### Five of these contradict the acceptance record

**Findings 8, 14, 15, 16 and 17 mean `docs/plans/admin-architecture-rbac.md` §4
currently overstates five pages.** Either implement the missing functionality or
**correct that document** — it is the founder's per-page acceptance record, and
an overstatement there is worse than a missing feature.

---

## 5. The order I would work in

1. **Findings 6, 10, 11, 12** — small, three of them mine, and three are
   correctness/consistency bugs the Dashboard already gets right.
2. **Finding 9** — an export contradicting its own subtitle is a money-adjacent
   honesty problem.
3. **Finding 13** — it weakens every route contract, so fixing it may surface
   more.
4. **Findings 8, 14, 15, 16, 17** — the page-scope work. Update the acceptance
   record in the same commit as each.
5. **Re-run Gate 5** on the full delta. Only FINAL ACCEPT unblocks Gate 6.

---

## 6. Gotchas this session paid for

1. **GateGuard fires on the first Bash call and the first Edit/Write of every
   file.** State importers / affected API / data schema / the user's verbatim
   instruction, then retry the identical call. It also fires on `DELETE FROM`
   **inside a string in a test file** — use the Edit tool there, not Bash.
2. **Heredocs corrupt on long TypeScript payloads.** Write to the scratchpad
   with the Write tool and `cat` it onto the target, or patch with Python.
3. **Drizzle emits every declared column.** Adding `searchKey` to the schema
   broke 22 SQLite fixtures with curated migration lists; each needed
   `0033_medicine_search_key.sql`. Fixtures that apply the whole directory were
   unaffected.
4. **The inventory ledger refuses a batch opened at non-zero stock**, and
   `inventory_movements` refuses a physical delete. A fixture must open a batch
   at 0 and move stock through a movement.
5. **`process.cwd()` in a test is the repo root**, not the app — use
   `import.meta.dirname`.
6. **The fold does not converge for `c`/`k`** — `সেক্লো`→`seklo`,
   `seclo`→`seclo`. Asserted as a recorded limit; do not "fix" a test by
   assuming convergence.
7. **Two suites fail only under contention.** Re-run alone before believing a
   regression.

---

## 7. Preserved, and verified preserved

- **38 protected untracked paths untouched**, never staged.
- **No `audit-artifacts/**` file modified.** H-9's sealed evidence is
  byte-identical, and the E4 manifest's two H-9 baseline hashes are unchanged
  and still asserted on every run.
- **No Postgres migration added or altered.** Migration 35 remains **unapplied**
  to any hosted project. Migration 0033 is **SQLite**, to which the H-9 chain
  seal does not apply.
- **`DECISIONS.md` appended at the very END only**, leaving the founder's
  uncommitted hunk and the Batch 2 append in place.
- Every commit staged **explicit paths by name**. No `add .`, `add -A`,
  `reset`, `amend`, `stash`, `clean` or force push.
- **No hosted SQL, no hosted write, no credential retrieval, no deployment, no
  real payment, no EAS build, no device operation.** The Galaxy A04s is
  untouched; both Supabase Free projects are untouched.

---

## 8. External gates — unchanged

E1, E2, E3, E4-H, E5, E6, E7, E8, E9, E10, E12, E13, E14 and E15 all remain
open. E11 stays resolved locally. **No admin page is DONE until E15.**

Batch 6 still contains **exactly two** deliverables: B6-01 the real ~21K
licensed medicine dataset, B6-02 the direct bKash merchant gateway. **Barcode
remains EXCLUDED.**
