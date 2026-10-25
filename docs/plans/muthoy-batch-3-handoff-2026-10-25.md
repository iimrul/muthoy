# Muthoy Batch 3 — handoff, 2026-10-25

**Read this first, then `docs/plans/muthoy-batch-3-plan.md` (revision 5, accepted).**
This session continued Batch 3 from checkpoint `60d3cce` and completed plan §12
**steps 4, 5 and part of step 6**. Nothing has been pushed. Steps 6 (remainder)
through 10 are outstanding.

Do **not** restart steps 1–5. They are committed, green, and summarised below.

---

## 1. State, verified

| Thing | Value |
|---|---|
| Branch | `main` |
| Local HEAD | `919e84e` |
| `origin/main` | `c25924e` — **nothing pushed for Batch 3** |
| Commits ahead of origin | 8 |
| Dirty working-tree paths | 65 (48 pre-existing, plus the lockfile and this document) |

### The eight local Batch 3 commits, oldest first

| SHA | What |
|---|---|
| `b8fca1e` | E4 migration 35 and its successor acceptance mechanism |
| `76d235f` | the five migration-chain gates and E4's evidence manifest |
| `28a4c11` | W4-05 owner-controlled shop sync |
| `16a1ad1` | W4-04 refund-net sales, one definition, both apps |
| `60d3cce` | E11 — the unsafe admin entitlement refresh withdrawn |
| `b509eaf` | **step 4** — permissions narrow, sessions revoke per user |
| `e568dba` | **step 5** — the audit is awaited, the actor is qualified |
| `919e84e` | **step 6 part 1** — money definitions, k-anonymity, CSV, PDF |

Test state at `919e84e`: **29 files pass** (23 `apps/admin`, 6
`packages/validation`). `apps/admin` and `packages/validation` both typecheck and
lint clean. The **full repository suite has not been run since step 3** — that is
step 10's gate, and it is the largest remaining unknown.

---

## 2. What steps 4 and 5 actually built

Enough detail to review them without re-reading the diffs.

### Step 4 — `b509eaf`

`admin_role_assignments` (migration 35) is now read on **every** request. A row
can do exactly three things, none of which can widen authority:

1. **narrow** — the effective permission set is the INTERSECTION of the
   `ADMIN_ROLES` role's permissions and the row's. A row naming `super_admin`
   against an environment role of `read_only` grants `read_only` and no more.
2. **deny outright** — `is_active = false` denies, and never falls back to
   `ADMIN_ROLES`.
3. **deny one cookie** — an `iat` at or before `sessions_revoked_at` is refused.
   `ADMIN_SESSION_EPOCH` remains the all-or-nothing break-glass.

An **unreadable store DENIES**, with its own audited reason
(`role_store_unavailable`). The availability cost is deliberate and documented.

New files: `lib/adminAssignments.ts` (the pure decision), `lib/adminIdentityStore.ts`
(the only writer of that table), `lib/adminIdentityActions.ts` (the authorized
surface — it performs no direct table write, by design, so §8.12's writer
allowlist stays exact).

Permissions went 7 → 19; the seven W4-06 names are unchanged. `adminRoles.test.ts`
transcribes the §4.2 matrix **independently** and checks all 76 cells.

### Step 5 — `e568dba`

- `AdminAuditSink` gained optional `flush(): Promise<void>`; `write` stayed
  synchronous so no existing non-sensitive call site changed.
- `lib/adminAuditStore.ts` is the durable sink and the only writer of
  `admin_audit_log` (insert only). `recordAdminActionDurably` resolves only once
  the row has committed or failed, and **never throws** — a throw would unwind a
  mutation that had already committed.
- Durability is reported as `'durable' | 'stderr_only' | 'failed'`. Three values,
  not a boolean: "nothing durable configured" is not a failure.
- **The denial audit moved** out of `requirePermission` (synchronous, throws, so
  nothing could await it) into `requireAdminPermission`, which catches
  `AdminForbiddenError`, awaits the record, then rethrows. The ordering test
  asserts flush-then-reject, not merely that both happened.
- `actor_verified` is true only for a verified session cookie, checked with
  `=== true`. Every login-path entry is `false`, including a **successful**
  login, because the cookie it mints has not been presented yet. The login path
  reaches the durable sink but does **not** await it — awaiting a database
  round-trip inside credential verification would add a timing signal to
  deliberately constant-work code.
- §8.9d's third outcome exists: `{ ok: false, committed: true, code:
  'audit_write_failed' }`, surfaced through `lib/adminOutcomes.ts` as
  `?applied_unrecorded=`. The two pages that each had their own `done`/`failed`
  reader now share one tested function.
- All ten §8.13 schemas are in `packages/validation/src/admin.ts`. The shared
  UUID deliberately is **not** Zod's `z.string().uuid()` (which accepts the nil
  UUID and any variant nibble); a test walks seven candidates through both it and
  `isUuid` so the write path can never be looser than the read path.

---

## 3. Step 6 — what is done and what is left

Done and committed (`919e84e`): `adminMetrics.ts`, `adminSuppression.ts`,
`adminCsv.ts`, `adminPdf.ts`, each with its test file.

**Still to write — five libraries plus tests:**

| Library | Plan ref | Notes |
|---|---|---|
| `lib/adminFilters.ts` | §8.2 | search by name and phone (`ilike`, metacharacters escaped), district/plan/status filters, sort, `.range()` pagination with an exact count. Consumes `adminListQuerySchema`, already written. |
| `lib/adminReports.ts` | §8.10 | the six reports named in `ADMIN_REPORT_IDS`. Every aggregate through `suppressBelowK`; `readAllPages` with an explicit cap and a hard assertion that exported rows equal counted rows. |
| `lib/adminGeo.ts` | §8.6 | the consent predicate. A non-null `location_captured_at` is **not** sufficient — no real marker is plotted until gate E13's consent record exists. The tile URL is unset by default (gate E14), and with it unset no third-party request is attempted. |
| `lib/adminSupport.ts` | §8.7 | case and note shaping. The writer module must be added to §8.12's manifest **and** to `adminValidation.test.ts`'s `WRITE_MODULES`. |
| `lib/adminSettings.ts` | §8.11 | `isFeatureEnabled`, read by the Analytics, Maps and Reports-PDF routes. The three notification templates are read-only; `adminSettingUpdateSchema` already refuses them. |

**Two §5.2 items are deferred by necessity, not by choice:**

1. The `/revenue` mutation checks — relabelling that page's pharmacy-sales metric
   as `revenue` must fail, and pointing its MRR metric at `netSalesPaisa` must
   fail — need the page, which is step 7.
2. `definitionRef` resolution — every ref must resolve to a heading in
   `docs/plans/admin-metric-definitions.md` — needs that document, which is
   step 9. The refs currently in `ADMIN_METRICS` are: `MRR`, `Collected
   subscription payments`, `Pharmacy sales (refund-net)`, `Counts, named for what
   they measure`, `Currently paid entitlements`, `Recorded cancellations`.
   **Write that document with exactly those headings**, or update the refs.

---

## 4. Steps 7–10, unchanged from the plan

- **Step 7** — eleven pages, the Recharts/Leaflet client components, nav, the
  export route, loading/empty/error states. Gate: route contract tests,
  client-boundary tests, admin typecheck, lint and `next build` clean.
- **Step 8** — W2-03: SQLite migration `0033_medicine_search_key.sql`, the
  chunked backfill, the raw-OR-folded union query, sync safety.
- **Step 9** — the ten documents in §13.
- **Step 10** — definitive full suite, then Codex FINAL, then push.

---

## 5. Gotchas this session paid for

1. **GateGuard's fact-forcing hook fires on the first Bash call and on the first
   Edit/Write of every file.** It is ENABLED and must stay enabled. The protocol
   that works: run a search (Grep/Bash) naming the file, then in the **next**
   message state importers, affected API, data schema and the user's verbatim
   instruction, then make the call. A facts statement with no preceding search is
   sometimes refused; stating the facts and retrying the identical call then
   succeeds.
2. **Write TypeScript with the Write/Edit tools, not Bash heredocs.** This repo
   has been bitten by heredoc `0x08` corruption six times. Python
   `io.open(..., newline='\n')` replacements are safe, and were used for surgical
   multi-site edits.
3. **`@muthoy/validation` needed a real `pnpm install`.** Adding it to
   `apps/admin/package.json` is not enough — the workspace symlink
   (`apps/admin/node_modules/@muthoy/validation`) only appears after
   `pnpm install --filter @muthoy/admin`. That changed `pnpm-lock.yaml` by
   10 insertions / 7 deletions, committed in `b509eaf`.
4. **Three existing guards fire on legitimate Batch 3 code and must be
   re-pointed rather than relaxed.** All three are already handled, but the
   pattern recurs with every new module:
   - `adminGrants.test.ts` — now §8.12's `(module, table, operation)` manifest.
     **Every new writer module must be added**, or "only the manifest modules
     perform a direct table write" fails.
   - `adminLabels.test.ts` — `revenue` is permitted only as the `revenue.read`
     identifier and inside two report ids; `lib/adminMetrics.ts` is exempt from
     the word scan, and that exemption is itself asserted.
   - `adminValidation.test.ts` — its `WRITE_MODULES` list must grow with each new
     write module.
5. **Tests that inject `AdminActionDeps` must pass `readAssignment: async () =>
   null`.** Otherwise the real store runs, finds no Supabase client, and the
   request is denied with `role_store_unavailable` — correct fail-closed
   behaviour, and a confusing test failure.
6. **`apps/admin/app/**/*.test.tsx` is not in the vitest `include` list.** The
   §11 route contract test must be added explicitly, and it must live under
   `apps/admin/` so pnpm resolves `react-dom`.
7. **`isMrrEligible` filters on tier before pricing.** A fixture using a tier
   outside `pro`/`ultra` never reaches the pricing step, so to exercise the
   unpriced path use a paid tier on an uncovered cycle.
8. Line endings: `git add` warns "LF will be replaced by CRLF" on every file.
   That is this repo's normal `core.autocrlf` behaviour. `.gitattributes` pins
   `eol=lf` on nine hash-recorded H-9 paths, and **none of those was touched.**

---

## 6. Preserved, and verified preserved

- The historical H-9 sealed SQL is **byte-identical**: no file under
  `audit-artifacts/**` was modified and no H-9 migration was touched.
- The E4 evidence manifest is still at
  `backend/supabase/migrations/e4-source-hashes.json`.
- Migration 35 is **not applied to any hosted project.** Durability, RLS and ACL
  behaviour is claimed for the code path only.
- The 48 pre-existing protected working-tree paths are untouched. Every commit
  staged explicit paths only. No `reset`, `amend`, `stash`, `clean` or force push
  was used.
- `DECISIONS.md` has **not** been appended to yet — that is step 9, and §13
  requires the append to go at the very end only.

---

## 7. External gates — unchanged

E1, E2, E3, E6, E7, E8 and E9 are open as before. **E11 is resolved locally**
(commit `60d3cce`): the defect was the unsafe *caller*, not the RPC, so no
money-path SQL change was needed. The RPC is untouched and named in
`FORBIDDEN_ADMIN_RPCS`; `b4_reconcile_plan_limits` stays. E10, E12, E13, E14, E15
and E4-H all still require founder-controlled operations, and none was performed.

**Nothing in this handoff claims device or hosted verification of any kind.**
