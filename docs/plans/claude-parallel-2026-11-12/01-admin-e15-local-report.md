# Admin E15 — independent local implementation and test report

**Date:** 2026-11-12. **Author:** Claude (secondary workstream). **Workspace:** isolated clone `D:\cc`,
branch `claude/admin-e15-20261111`, base `a23ca61`. Not committed, not pushed, not deployed.

> **E15 is NOT closed.** Everything below is LOCAL: a production build of the panel served on
> 127.0.0.1 against a synthetic stand-in for Supabase. It proves the panel's own rendering,
> navigation, authorization decisions and layout. It does not prove hosted data, RLS, grants, durable
> audit on a real project, multi-instance throttling, or the deployed devtools/bundle check that E15
> requires. Production remains NO GO.

## In plain English

- I ran the real Admin panel on this computer with fake data and signed in as each of the four admin
  roles. Every role could open exactly the pages it should and was refused the rest — no leaks.
- I found and fixed four real problems:
  1. **Support staff could not find a page they are allowed to use** (a pharmacy's own audit log).
     There was no link to it anywhere. Added one on each pharmacy's detail page.
  2. **The top menu did not fit the screen** — on every page, at every screen size. On a phone the
     whole page was three times wider than the screen. The menu now wraps onto extra lines.
  3. **Two tables pushed the page sideways on a phone** (Pharmacies, Admins). They now scroll inside
     their own box.
  4. **The setup guide named the wrong setting** for the database address. Fixed.
- All 1,611 Admin tests pass, including 4 new ones. Nothing was deployed and no real data was touched.

## What was run

| Check | Command (from `D:\cc`) | Result |
|---|---|---|
| Admin unit/contract suite, baseline | `npx vitest run apps/admin` | 1606/1607; 1 failure = 5 s timeout on the first route test under load. Same file re-run alone twice: 122/122 both times. Known parallel-load flake; test unchanged |
| Admin suite, after fixes | same | **40 files / 1611 tests, exit 0** (1607 + 4 new) |
| Typecheck / lint / production build | `pnpm typecheck`, `pnpm lint`, `pnpm build` in `apps/admin` | exit 0 / exit 0 / exit 0 (Next 15.5.23, the a23ca61 pin) |
| Four-role HTTP matrix, synthetic data, before fix | `node test/local-acceptance/run-role-matrix.mjs --fixture synthetic --out <dir>` | 84 checks, **1 failed** (A-02) |
| Same, after fix | same | **84/84 pass** |
| Four-role HTTP matrix, empty platform, after fix | `--fixture empty` | **80/80 pass, 4 explicit skips** (per-shop link needs a pharmacy to exist) |
| Browser layout, 15 pages × 360/768/1280 px, super_admin, settled 2.5 s | Chrome DevTools, same-origin iframes | before: **45/45 overflowing**; after: 44/45 clean, `/support` @360 = 1 px (LOW) |
| Browser click path, support role, 360 px | drill-down → link → `/audit?shop=` | renders the per-pharmacy view, not refused, no overflow |

What the HTTP matrix asserts for each of the four roles (`super_admin`, `billing`, `support`,
`read_only`), over real HTTP with a real signed session cookie:

- login returns 303 with a session cookie; logout returns 303 and clears it;
- 15 page routes and 2 export APIs: allowed exactly when the role's permission set grants them,
  refused otherwise (pages: inline refusal notice; APIs: 403);
- **a refused request issues no business-table read** — only the role-store read and the audit write;
- the nav shows only links the role may use;
- every permitted page family is reachable from some link;
- no response body contains the service-role key, the session secret or any password.

The role→permission table in the runner is a literal copy of `lib/adminRoles.ts`, on purpose: if
the source drifts, the matrix fails instead of silently following it.

## Defects found

| ID | Severity | Status | Defect | Evidence |
|---|---|---|---|---|
| A-01 | MEDIUM | **FIXED** (doc) | `apps/admin/README.md` told the deployer to set `NEXT_PUBLIC_SUPABASE_URL`; `lib/env.ts` has always read `SUPABASE_URL` (since `07cbff1`). A staging deploy following the README would boot "not configured". The same wrong name is in the E15 staging package table, `docs/plans/muthoy-batch-3-hosted-and-device-gate-packages-2026-10-30.md` §2 — **not edited** (dated plan; Codex/Founder to correct). | `lib/env.ts:25`, `.env.example` |
| A-02 | MEDIUM | **FIXED + tested** | `support` holds `shop_audit.read`, which `/audit?shop=<id>` accepts (round 13 finding 7), but **no link anywhere** led there: the nav's Audit entry needs `audit.read`, and the drill-down had no link. Found by the HTTP matrix (reachability check). | matrix receipt, before/after; 4 new contract tests |
| A-03 | HIGH (UX) | **FIXED** | Top nav was one non-wrapping flex row holding 11 links plus the account block. Measured nav overflow 823 px @360, 415 px @768, 144 px @1280; the **whole page** scrolled sideways on every route at every width. | DevTools measurement, before/after |
| A-04 | MEDIUM (UX) | **FIXED** | Two raw tables without a scroll wrapper widened the page at 360 px: `/pharmacies` (+132 px), `/admins` identities table (+177 px). Other raw tables did not overflow with this data. | DevTools, settled measurement |
| A-05 | LOW | OPEN — Founder ruling | `/pharmacies` renders the phone number in `font-mono` (`app/pharmacies/page.tsx:226`, deliberate per its comment). CLAUDE.md rule 6 reserves DM Mono for money. Flagged per rule 11, not changed. | source |
| A-06 | LOW | OPEN | Unknown shop id returns **HTTP 200** with not-found content (soft 404) — `notFound()` streams under the root `app/loading.tsx` Suspense boundary. Harmless for users; misleading for monitoring. | matrix receipt; browser fetch |
| A-07 | LOW | OPEN | `/support` at 360 px overflows by 1 px (sub-pixel, non-table). | DevTools |
| A-08 | LOW | OPEN — needs Rule-10 approval | `lib/adminPlatformQueries.ts:1412` holds raw NUL/SOH bytes inside a string literal (deliberate separators). Runtime-correct, but `grep`/`file` treat the whole query module as **binary**, so text searches and grep-based reviews silently skip it. Proposed: write them as `'\u0000'` / `'\u0001'` (byte-identical at runtime). Not changed because the file is a query module. | `file` → "data"; byte offsets 56143/56171 |

A process note for whoever measures layout next: a 400 ms settle **under-reported** `/admins`
(skeleton still streaming). Only settled measurements (2.5 s, zero `.animate-pulse` left) are cited.
Under mobile emulation the DevTools click tool hit the wrong element (clicking "Pharmacies" opened
the Dashboard) — dispatch `element.click()` instead.

## Changes (isolated clone only)

| File | Change |
|---|---|
| `apps/admin/app/shops/[id]/page.tsx` | +11: link "View this pharmacy's audit log" → `/audit?shop=<id>`, shown only when the session holds `shop_audit.read`. Presentation only; `/audit` still checks server-side |
| `apps/admin/app/layout.tsx` | nav: `flex-wrap`, `gap-x-6 gap-y-2` |
| `apps/admin/app/pharmacies/page.tsx` | table wrapped in `overflow-x-auto` |
| `apps/admin/app/admins/page.tsx` | identities table wrapped in `overflow-x-auto` |
| `apps/admin/README.md` | `SUPABASE_URL`, with a warning about the wrong name |
| `apps/admin/app/adminRoutes.contract.test.tsx` | +4 tests: link present for support and super_admin, absent for billing and read_only. RED before the fix (2 failed), GREEN after |
| `apps/admin/test/local-acceptance/mock-supabase.mjs` | new: 127.0.0.1-only in-memory PostgREST stand-in (filters, counts, single, insert/update, rpc), request log |
| `apps/admin/test/local-acceptance/fixture.mjs` | new: `empty` and `synthetic` fixtures (3 shops incl. a very long name and a Bangla name; phone fields deliberately not phone-shaped) |
| `apps/admin/test/local-acceptance/run-role-matrix.mjs` | new: the four-role HTTP matrix described above; secrets random per run, never written; server log redacted |

No shared auth contract, migration, RLS, Edge Function, dependency, lockfile, root config or
production setting was changed. The harness is not in the Vitest include list; it is run by hand.

## What E15 still needs (unchanged)

An approved **staging** deployment URL; four role accounts (plus a narrowed and a disabled one);
migration 35 applied on that project first (E4-H coupling); then the devtools network-tab and
bundle inspection on the deployed panel. The harness above can be pointed at nothing hosted — it is
local by construction.
