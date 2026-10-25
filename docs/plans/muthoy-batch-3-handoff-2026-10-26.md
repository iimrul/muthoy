# Muthoy Batch 3 — handoff, 2026-10-26

**Read this first, then `docs/plans/muthoy-batch-3-plan.md` (revision 5, accepted),
then `docs/plans/muthoy-batch-3-handoff-2026-10-25.md` for steps 1–5.**

This session completed plan §12 **step 6 in full and step 7 in full**. Nothing has
been pushed. **Steps 8, 9 and 10 are outstanding, plus §11's route contract
tests.**

Do **not** restart steps 1–7. They are committed and green.

---

## 1. State, verified

| Thing | Value |
|---|---|
| Branch | `main` |
| Local HEAD | `274bcba` |
| `origin/main` | `c25924e` — **nothing pushed for Batch 3** |
| Commits ahead of origin | 18 |
| Inherited dirty working-tree paths | **47, untouched** |

### The nine commits this session added, oldest first

| SHA | What |
|---|---|
| `b48c7a3` | **step 6 complete** — filters, geo, support, settings, reports + a schema drift fix |
| `f5ab312` | **step 7 pt 1** — `lib/adminPlatformQueries.ts`, the reads the pages need |
| `d32c839` | **step 7 pt 2** — the client boundary (Leaflet/Recharts), proved by a real build |
| `d3cc729` | **step 7 pt 3** — Settings, page furniture, loading states, eleven-entry nav |
| `d602986` | **step 7 pt 4** — Support, Reports, the export endpoint |
| `676900f` | **step 7 complete** — Revenue, Analytics, Admins; three guards strengthened |
| `dcaeffc` | this handoff |
| `9381652` | **§8.2** — the pharmacy list searched, filtered, sorted and paged |
| `274bcba` | **§11 route contract tests** — 62 tests, all eleven pages invoked and rendered |

Earlier Batch 3 commits (previous session): `b8fca1e`, `76d235f`, `28a4c11`,
`16a1ad1`, `60d3cce`, `b509eaf`, `e568dba`, `919e84e`, `62fe90c`.

### Verification at `274bcba`

- **1109 tests, 35 files, exit 0** (`npx vitest run apps/admin packages/validation`)
- `apps/mobile/components` + `i18n`: **270 tests, 16 files, exit 0** — run to
  confirm the `esbuild.jsx` config change disturbed nothing
- `apps/admin` **typecheck exit 0**, **lint clean**
- **`next build` exit 0**, all 19 routes, run against a placeholder URL and key
- **Step 7's gate is now fully met**: route contract tests, client-boundary
  tests, typecheck, lint and build.
### The full repository suite — RUN, and the result is mixed

`npx vitest run` at `274bcba`, 920 seconds:

```
 Test Files  284 passed (284)
      Tests  6255 passed (6255)
     Errors  2 errors
```

**Every test passed. The process exited 1.** Both errors are identical and are
Vitest's own infrastructure, not product code:

```
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
 ❯ Object.onTimeoutError …/vitest/dist/chunks/rpc.-pEldfrD.js:53:10
 ❯ Timeout._onTimeout …/vitest/dist/chunks/index.B521nVV-.js:59:62
```

That is a worker→main **reporter RPC** timeout: a worker took too long to report
a task update. It is consistent with this suite's shape — 920 s in total, with
individual SQLCipher migration tests at 2–17 s each — and it is not attributable
to any assertion.

**It is nevertheless a step-10 BLOCKER, and must not be waved through.** §12
step 10's gate is "exit 0 recorded", and the exit was 1. Options, in the order I
would try them:

1. **Re-run once** to establish whether it is intermittent. I did not, because a
   second 15-minute run was not a good use of the remaining budget — so
   intermittency is genuinely unknown.
2. If reproducible, raise `teardownTimeout` in `vitest.config.ts`, or reduce
   reporter chatter (`reporters: ['dot']`) so fewer task updates cross the RPC
   boundary on a run this long.
3. **Do not** paper over it by ignoring the exit code. A config change here
   alters how the whole suite is executed and should be visible to Codex rather
   than buried.

This is **not** caused by this session's `esbuild.jsx` change: that affects only
how JSX is transformed, and the failure is in the worker's reporting channel.
`apps/mobile/components` + `i18n` (270 tests) were run separately after that
change and passed.

---

## 2. A DRIFT I FOUND AND FIXED — read this before trusting any schema

`packages/validation/src/admin.ts`, written in step 5 (`e568dba`), had **drifted
from the hash-sealed migration 35 and from accepted plan §3.4** on three value
spaces:

| Thing | Validation said | Migration + plan §3.4 say |
|---|---|---|
| support statuses | `open, investigating, waiting, resolved, closed` | `open, pending, resolved, closed` |
| support categories | `billing, sync, inventory, account, device, other` | `onboarding, sync, payment, data, device, account, other` |
| settings keys | `feature.*`, `…subscription_renewed` | `flag.*_enabled`, `…subscription_expired` |
| `shopId` | nullable | `shop_id uuid NOT NULL` |
| summary / body caps | 500 / 4 000 | 2 000 / 8 000 (the CHECK bounds) |

§8.11's "six keys in three places with a test asserting they are identical"
**passed**, because all three TypeScript copies had drifted *together* and the
test only compared copies to copies. Had this shipped, every support-case write
and every settings write would have passed validation and then failed at the
CHECK constraint.

`adminSettings.test.ts` now **parses the migration SQL** and compares all four
places. Apply the same suspicion anywhere else a list is "asserted identical":
**compare against the database, not against another copy.**

---

## 3. What step 6 built (all committed, all tested)

| File | § | Notes |
|---|---|---|
| `lib/adminFilters.ts` | 8.2 | TWO injection surfaces, escaped separately — the SQL LIKE pattern (`%`, `_`, `\`, and PostgREST's `*` alias) and the PostgREST **filter grammar**, where an unquoted comma inside `.or()` opens a filter the caller never wrote. `searchOrExpression` is the only place an `.or()` argument is built. `applyShopListFilters` is the filters-only variant the exact count uses. |
| `lib/adminGeo.ts` | 8.6 | A capture timestamp is **not** consent. Both tile halves (URL **and** attribution) gate `ready`. |
| `lib/adminSupport.ts` + `…Store.ts` + `…Actions.ts` | 8.7 | Shaping / sole writer / authorized surface. |
| `lib/adminSettings.ts` + `…Actions.ts` | 8.11 | `featureState` is **three-valued**: no row = `enabled`, row false = `disabled`, unreadable store = `unknown`. |
| `lib/adminReports.ts` | 8.10 | Six reports; two kinds only (registration metadata, k-suppressed aggregate). `assertCompleteRead` runs **before** any table is built. |

---

## 4. What step 7 built

**All eleven pages exist, are permission-gated, and build.**

| # | Page | Route | New? |
|---|---|---|---|
| 1 | Dashboard | `/` | existing, **not yet extended — see §6b** |
| 2 | Pharmacy Management | `/pharmacies`, `/shops/[id]` | existing, **not yet extended — see §6b** |
| 3 | Subscriptions | `/subscriptions` | existing, **not yet extended — see §6b** |
| 4 | Revenue & Billing | `/revenue` | NEW |
| 5 | Analytics | `/analytics` | NEW |
| 6 | Maps | `/maps` | NEW |
| 7 | Support | `/support` | NEW |
| 8 | Admins & Roles | `/admins` | NEW |
| 9 | Audit Logs | `/audit` | existing, **not yet extended — see §6b** |
| 10 | Reports + CSV/PDF | `/reports` + `/api/reports/export` | NEW |
| 11 | Settings | `/settings` | NEW |

Plus: `lib/adminPlatformQueries.ts` (all the new reads), `components/PageParts.tsx`,
`components/PageSkeleton.tsx`, 13 `loading.tsx` routes, `components/charts/*`
(3 files), `components/map/*` (2 files), six new form actions, and the
eleven-entry nav.

`/accounts`, `/accounts/[id]` and `/payments` left the top nav per §8.4 and
**lost no functionality** — `/payments` is linked from Revenue, `/accounts/[id]`
from the drill-down.

### The SSR hazard, and why the build is the gate

`next build` is green and **Leaflet appears in no shared chunk**. The three
things that make that true, all required by §8:

1. `MapCanvas.tsx` imports Leaflet with `await import('leaflet')` **inside
   `useEffect`** — a module-scope import throws `window is not defined` during
   the build, because a `'use client'` boundary is not an SSR boundary;
2. `MapLoader.tsx` is a client file containing **nothing else**, because
   `next/dynamic(..., { ssr: false })` is rejected inside a Server Component in
   Next 15;
3. `MapLoader`'s props carry a **required** `tileUrl: string`, so the
   unconfigured state cannot reach it and the dynamic import is never triggered.

---

## 5. Guards re-pointed this session — the pattern recurs

Five guards fired on legitimate new code. **All five were made stronger, none
relaxed.** Expect the same with every new module:

1. **`adminGrants.test.ts`** — §8.12's `(module, table, operation)` manifest
   gained three writer entries. Every new writer module must be added.
2. **`adminValidation.test.ts`** — `WRITE_MODULES` gained the two action
   surfaces, **and its `clientCalls` needle list gained the new store
   functions**. Without the second half, a module whose only database reach is
   an unlisted function scores zero client calls and the test passes vacuously.
3. **`adminLabels.test.ts`** — §5.2 said the manifest "will eventually allow
   the word on the one page that earns it". That page now exists, so
   `app/revenue/page.tsx` is exempt the way `lib/adminMetrics.ts` is — and the
   exemption is **backed** by a test asserting every `MetricTile` on it resolves
   its caption through `requireMetric`, plus two negative controls. The acronym
   `MRR` is **avoided rather than exempted**: the `runRate` field and the prose
   follow the manifest's own label, which never says it.
4. **`serviceRoleExposure.test.ts`** — "zero client files" became an allowlist
   of exactly four files, plus four new assertions (allowlisted paths exist, no
   *page* is a client component, no client file reaches a `server-only` module
   **transitively**, no client component names a raw row type).
5. **`adminAuthz.test.ts`** — the page list grew to 16 **and** the
   gate-before-read loader list grew with it.

The `ADMIN_ACCOUNTS` containment guard was kept **literal**: the Admins page
renders those names as data from `lib/adminIdentity.ts`'s exported
`ACCOUNTS_ENV_NAMES`, rather than becoming a second module that names a secret
just to render a sentence. `lib/env.ts` and `lib/adminSession.ts` gained the
same kind of presence helper for the Settings diagnostics panel.

---

## 6. WHAT IS LEFT, precisely

### 6a. §11's route contract tests — DONE (`274bcba`)

`apps/admin/app/adminRoutes.contract.test.tsx`, 62 tests, listed explicitly in
`vitest.config.ts`'s `include`. **Step 7's gate is met in full.**

Two things that file established, worth knowing before extending it:

- **The exclusion list is itself a test.** A denial legitimately touches
  `admin_role_assignments` (§4.3 reads it on every request — it IS the gate) and
  `admin_audit_log` (§8.9c). Those two are named, and a test asserts no business
  table has been added to that list.
- **The Supabase fake is PER TABLE.** One shared rows array made the
  authorization read of `admin_role_assignments` receive a shop row, which
  `adminIdentityStore` correctly threw on — so every page failed closed and the
  test measured nothing while appearing to pass its denial assertions.

### 6b. Four existing pages are NOT yet extended to their §8 scope

`/pharmacies` **is now done** (`9381652`): search, three filters, sort and
`.range()` paging with an exact count, all pushed into the query. The remainder
work and are gated, but still carry their Batch 2 feature set:

- **`/` (§8.1)** — needs the nine metrics and the five computed alert classes.
- **`/shops/[id]` (§8.2)** — needs the support-notes block and the
  consent-gated location block.
- **`/subscriptions` (§8.3)** — needs the status/tier/cycle filters, next
  billing date, renewal history from verified `payment_orders`, and §8.3's
  *visibly unavailable with reason* lifecycle-override notices (gate E10).
- **`/audit` (§8.9)** — needs its filters.

### 6c. Step 8 — W2-03, not started

SQLite migration `0033_medicine_search_key.sql`, the chunked backfill, the
raw-OR-folded union query, sync safety. Plan §9. **The H-9 migration-chain seal
applies to Postgres migrations only — this is a SQLite one, so it is not
blocked.**

### 6d. Step 9 — documentation, not started

The ten documents in §13. **`admin-metric-definitions.md` must carry exactly
these six headings**, or the `definitionRef` values must be updated:

```
MRR
Collected subscription payments
Pharmacy sales (refund-net)
Counts, named for what they measure
Currently paid entitlements
Recorded cancellations
```

### 6e. The two deferred validations — STILL DEFERRED, still tracked

1. **§5.2 `/revenue` mutation checks.** The page now exists, so **these can be
   run.** Two mutations must FAIL: relabelling the pharmacy-sales metric as
   revenue, and pointing the collected-payments metric at `netSalesPaisa`.
2. **`definitionRef` resolution** — needs §6d's document first.

### 6f. Step 10 — final acceptance, not started

Full suite with real exit code, repo lint/typecheck, admin build, E4/H-9
integrity, Codex FINAL ACCEPT, then push. **Do not push on REVISE or failing
tests.**

**The full suite has been run once (see §1): 6255/6255 tests pass and the
process exits 1 on two Vitest reporter-RPC timeouts.** That is the first thing
step 10 has to resolve, and §1 records the diagnosis and the options. Until the
exit code is 0 — or the non-zero exit is explicitly accepted with its reason
recorded — **step 10's gate is not met and nothing may be pushed.**

---

## 7. Gotchas this session paid for

1. **GateGuard fires on the first Bash call and the first Edit/Write of every
   file.** It is ENABLED and must stay so. The protocol that works: run a
   search naming the file, then state importers / affected API / data schema /
   the user's verbatim instruction, then make the call. A refusal is often
   cleared by restating the facts and **retrying the identical call**.
2. **Heredocs corrupt. Again.** A `python - <<'PY'` with a long TypeScript
   payload failed with "unexpected EOF". Use the Write tool for TypeScript, and
   for scripted edits write the Python to the scratchpad and run it by path.
   Windows paths inside Python need `os.path.join(os.environ['TEMP'], …)` — a
   literal `'C:\Users\…'` is a unicode-escape SyntaxError.
3. **`\u0027` in a Write payload is decoded on write.** Writing
   `'=cmd|\u0027 /c calc\u0027!A1'` produced a real apostrophe and broke the
   string literal. Use double-quoted TypeScript strings for payloads containing
   apostrophes.
4. **PostgREST's builder types defeat structural inference.** Two failures, both
   fixed properly rather than suppressed:
   - a recursive generic bound (`Self extends ListQueryBuilder<Self>`) makes tsc
     emit "type instantiation is excessively deep". Use **`this`-typed
     methods**. And `ListFilterBuilder` must be the **base interface the full
     one extends** — `Pick<>` strips the polymorphic `this`;
   - `.select()` with a **non-literal** column string loses the row type and
     returns `GenericStringError[]`. Narrow the builder once at a boundary you
     own, with literal column lists at each call site.
5. **React's purity rule refuses `Date.now()` in a render body**, and
   `next build` fails on it (`react-hooks/purity`). Read the clock inside the
   async loader — which is also the more honest reading.
6. **Recharts' `formatter` receives `ValueType | undefined`**, not `number`.
7. **`business_date` is a DATE column** and takes bare `YYYY-MM-DD` bounds;
   `created_at` / `verified_at` are `timestamptz` and take `+06:00` instants.
   Postgres will cast between them and happens to get it right — do not rely on
   it.
8. **`({})['__proto__']` is the prototype object, not `undefined`**, so a
   `?? fallback` over an object literal keyed by untrusted text returns `{}` as
   a "colour" or a "label". Use a `Map`. This was caught by a test written
   against my own code, in both `adminGeo.ts` and `adminSupport.ts`.
9. **Line endings:** `git add` warns "LF will be replaced by CRLF" on every
   file. Normal for this repo. `.gitattributes` pins `eol=lf` on nine
   hash-recorded H-9 paths and **none was touched.**

---

## 8. Preserved, and verified preserved

- The **47 inherited dirty working-tree paths are untouched.** Every commit
  staged explicit paths only. No `reset`, `amend`, `stash`, `clean` or force
  push was used.
- **No `audit-artifacts/**` file was modified**; the historical H-9 sealed SQL
  is byte-identical.
- **No Postgres migration was added or altered**, so the H-9 migration-chain
  seal is intact. Migration 35 remains **unapplied to any hosted project**.
- `DECISIONS.md` has **not** been appended to — that is step 9, and §13 requires
  the append at the very end only.
- `apps/admin/package.json` gained `recharts@3.10.1`, `leaflet@1.9.4` and
  `@types/leaflet` — the TECH_STACK locked stack. `react-leaflet` was
  deliberately **not** added. `pnpm-lock.yaml` changed accordingly.

---

## 9. External gates — unchanged

E1, E2, E3, E6, E7, E8, E9, E10, E12, E13, E14, E15 and E4-H all remain open.
E11 stays resolved locally (`60d3cce`).

**Nothing in this handoff claims device or hosted verification of any kind.**
The `next build` runs were executed against a placeholder Supabase URL and a
placeholder key; no hosted call was made, no SQL was deployed, and no device was
touched.
