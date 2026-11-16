> Source integration — 2026-11-15: Admin fixes and hardware-readiness suites are now in D:/Muthoy.
> The account below remains the historical Claude workstream record. Duplicate patch bundles
> remain in D:/cc/docs/plans/claude-parallel-2026-11-12/; they were not imported.

# Claude parallel workstream — 2026-11-12

Secondary implementation and verification work alongside Codex. **Production remains NO GO.**
Nothing here is committed, pushed, merged, deployed or run on a device.

| # | Deliverable | File |
|---|---|---|
| 1 | Admin E15 independent implementation and local test report | [01-admin-e15-local-report.md](01-admin-e15-local-report.md) |
| 2 | Android 39-screen remaining-defect and test matrix | [02-android-39-screen-matrix.md](02-android-39-screen-matrix.md) |
| 3 | Java Dialog crash root-cause findings | [03-java-dialog-crash.md](03-java-dialog-crash.md) |
| 4 | Printer/OCR/hardware test readiness | [04-printer-ocr-hardware-readiness.md](04-printer-ocr-hardware-readiness.md) |
| 5 | Exact changed files and tests | below |
| 6 | Integration and conflict-risk handoff for Codex | below |
| 7 | Remaining scoped Founder approvals | below |

## Isolation record

- Work happened only in **`D:\cc`**: a fresh `git clone --no-hardlinks` of `D:\Muthoy` at `a23ca61`,
  remote removed (nothing can push back), branch `claude/admin-e15-20261111`, its own
  `node_modules/.pnpm` (frozen install, lockfile untouched; packages hard-linked from the shared
  content store, so nothing under `node_modules` was edited).
- **`D:\Muthoy` unchanged:** `git status --porcelain -uall` byte-identical to the session-start
  baseline; `git diff` SHA-256 `a926871b…e79401` before and after; HEAD `a23ca61` before and after.
- **`D:\md` and `D:\MuthoyAudit-20261109`: read only.** Disclosures: one `git status --short` in `D:\md`
  (may refresh git's index stat cache; no content change); one Vitest run that *read* `D:\md` sources
  (its status hash and `.vite` timestamp were checked unchanged); `git apply --check` dry runs
  (write nothing). The DEV phone was not touched.
- Housekeeping: two stray temp files I created outside the scratchpad (a status listing in
  `%LOCALAPPDATA%` and two logs in `%TEMP%`) were deleted the same session.

## 5. Changed files and tests

**Tracked changes (6 files, +49 / −4), all in `apps/admin`:**

| File | Change | Finding |
|---|---|---|
| `app/shops/[id]/page.tsx` | per-shop audit link when the session holds `shop_audit.read` | A-02 |
| `app/adminRoutes.contract.test.tsx` | +4 tests (support, super_admin: link; billing, read_only: none) | A-02 |
| `app/layout.tsx` | nav `flex-wrap` + row gap | A-03 |
| `app/pharmacies/page.tsx` | table in `overflow-x-auto` | A-04 |
| `app/admins/page.tsx` | identities table in `overflow-x-auto` | A-04 |
| `README.md` | `SUPABASE_URL` (was `NEXT_PUBLIC_SUPABASE_URL`) | A-01 |

**New files (not in any Vitest include list; run by hand):**

- `apps/admin/test/local-acceptance/` — `mock-supabase.mjs`, `fixture.mjs`, `run-role-matrix.mjs`
- `apps/mobile/tests/hardware-readiness/` — 11 files (config, fakes, support, 4 `.hwtest.ts`, positive control)
- this folder — 4 reports, this index, and two patches:
  - `admin-e15-local.patch` (718 lines) SHA-256 `990a3a29447fd3596b6955698b760c2a4852b0e28860ab04da4c0c6bddbdd269`
  - `hardware-readiness-tests.patch` (1300 lines) SHA-256 `94590894edbd8d51d8f871d13ad3b4a69901b1c1e1c2697590f6936e4c66f5f9`

**Results (all from `D:\cc`, exit codes measured without a pipe):**

| Suite | Result |
|---|---|
| `npx vitest run apps/admin` | 40 files / **1611 tests pass**, exit 0 (baseline 1607; one baseline run hit the known 5 s load flake, passed 2/2 in isolation) |
| Admin `typecheck` / `lint` / `build` | exit 0 / 0 / 0 |
| `run-role-matrix.mjs --fixture synthetic` | 84/84 (was 83/84 before A-02) |
| `run-role-matrix.mjs --fixture empty` | 80/80 + 4 explicit skips |
| Browser layout, 45 page×width checks | 44 clean; `/support` @360 = 1 px (LOW). Before: 45/45 overflowing |
| Hardware readiness harness | 89 pass / **8 fail by design** (pin P1/P2/P3) / 1 skip; positive control 8/8 |

## 6. Handoff and conflict risk for Codex

- **Both patches apply cleanly to the current `D:\md` tree** (`git apply --check`, dry run, 2026-11-12).
  Codex's only `apps/admin` changes are `package.json` and `eslint.config.mjs`; mine touch neither.
- **Re-verify after applying, because D:\md differs from my base:** Next `15.5.29` (I built and tested on
  `15.5.23`), Vitest `5.1.0` (I used the a23ca61 version), and Codex's edited root `vitest.config.ts`.
  Re-run: `npx vitest run apps/admin`, admin `typecheck`/`lint`/`build`, both role-matrix fixtures, and the
  hardware harness (its config imports the root aliases — check it still resolves).
- **No overlap with Codex's three priorities:** no change to sync, recovery, rehydration, SQLite, money,
  native, iOS, migrations, RLS, Edge Functions, dependencies, lockfiles or root config.
- **Mobile defects for Codex's queue** (not touched by me): V-01 Checkout tail under the tab bar (P1),
  V-07 closed-day Cash Summary, V-02/V-03/V-04 rule-6 font and digit inconsistencies, printer P1/P2
  (`domain/escpos.ts`, unchanged since a23ca61). Several of these files are in Codex's current diff on
  other lines — see the "Codex diff touches file?" column in report 02.
- **Doc fix for Codex/Founder:** the E15 staging package
  (`docs/plans/muthoy-batch-3-hosted-and-device-gate-packages-2026-10-30.md` §2) names
  `NEXT_PUBLIC_SUPABASE_URL`; the code reads `SUPABASE_URL`. Not edited (dated plan, Codex-owned area).
- **Privacy:** `evidence\android-supplier-detail-20261110.png` shows a real phone number — redact before
  sharing.
- **Tooling notes:** settle ≥2.5 s before measuring Admin layout (streaming skeletons under-report at
  400 ms); under DevTools mobile emulation use `element.click()`, not coordinate clicks; screenshots
  time out with `mobile,touch` emulation — use `360x780x1`.

## 7. Founder approvals still needed (each separately scoped)

**Admin**
1. Commit/merge authority for the six Admin changes and the local-acceptance harness (into Codex's
   branch or main) — after Codex re-verifies on Next 15.5.29.
2. Ruling on A-05: phone numbers in DM Mono on `/pharmacies` vs CLAUDE.md rule 6.
3. Rule-10 approval if A-08 (escape the NUL/SOH separators in `adminPlatformQueries.ts`) is wanted.
4. Correction of the E15 staging package's env-var table.
5. E15 itself (unchanged): an approved **staging** URL, four role accounts plus a narrowed and a
   disabled one, migration 35 on that project first (E4-H), then the deployed devtools/bundle check.

**Android screens**

6. Fix scope for V-01 (Checkout Hold/Cancel unreachable) and V-07 (closed-day Cash Summary).
7. Decision on money digits in Bangla (V-04) and the rule-6 font conflicts (V-02, V-03, S-09).
8. Adding off-device jsdom tests (T01–T12) to the root Vitest include list.
9. One device session per the plan in report 02 §5, plus each device-setting change (dark mode,
   3-button navigation, display density) as its own approval.

**Crash**

10. `logcat -b all` capture and the `Dialog.dismiss` logpoint in that session (F0). F1 (debug-only
    MainActivity hook) would need a native rebuild and a new exact-APK approval.

**Printer / OCR**

11. Fix plan for printer P1 (no line feeds — critical) and P2.
12. Decision on P3: keep or remove the automatic full-job reprint (conflicts with T33).
13. Manifest changes for P4/P5 (native rebuild).
14. Scope decision on P11 (no sale receipt / reprint) and D-7 (Bangla prints as `?`).
15. Hardware: a BLE ESC/POS printer and paper, an Android ≤11 phone, a camera-permission scope and
    synthetic OCR packets.
16. Whether the uncommitted iOS printer code (P18) belongs in scope while iOS is on hold.
