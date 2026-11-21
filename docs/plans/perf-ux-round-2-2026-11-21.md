# Speed & UI round 2 — plan (founder decisions 2026-11-21)

Branch: `perf/fast-everywhere` (PR #4, stacked on PR #3). Device: Galaxy A04s
(SM-A047F, Android 14). Measure on the EAS `internal` build
(`com.muthoy.pos.preview`, tap probe on via `EXPO_PUBLIC_PERF_PROBE=1`); dev-mode
numbers are not a fair before/after on this phone.

## Decisions

1. **Approved:** frame-processor OCR — `react-native-vision-camera` 5.2.4,
   `react-native-vision-camera-worklets` 5.2.4, `react-native-nitro-modules`
   0.37.2, `react-native-nitro-image` 0.15.2, `react-native-vision-camera-ocr-plus`
   2.1.2 (all MIT, pinned). Installed 2026-11-21.
2. **Approved to PLAN (not to build yet — CLAUDE.md rule 10):** sync must never
   block the UI. See "Sync plan" below; needs its own approval before code.
3. **Approved:** profile and fix Home first open, tab switching, cart +/-.
4. **No Apple Developer account** → no iOS build or iOS testing is possible.
   Everything is shared code, so fixes apply to iOS, but nothing is verified there.
5. **New scope from the founder:** login/PIN, every More-menu page and the staff
   side must be equally fast; remove the "Loading Dashboard" screen (one tap →
   dashboard); fix ugly input fields; date fields open a calendar that matches
   the app UI instead of typed dates.

## Release baseline (2026-11-21, EAS build e6ea7b62, ms: first frame / settled)

| Tap | First | Settled |
|---|---|---|
| Add to cart | 132–177 | 165–219 |
| Filter | 120–146 | 268–285 |
| Home, first open | 279 | 2298 |
| Home / Sale / Inventory, kept | 216–428 | 378–624 |
| Open cart | 338 | 464 |
| Cart + / − | 200–296 | 200–296 |
| Live scan, per frame | ~600 (pipelined) | — |

Target: first response under 100 ms for every tap; no screen-wide loading
placeholder when local data is available.

## Work order

1. **OCR frame processor.** `native/` wrapper around ocr-plus `<Camera>` (Latin,
   scan region = viewfinder, lightweight mode, translate + non-Latin models off
   via its config plugin); `useLiveStripScan` consumes pushed lines. Keep the
   expo-camera capture loop as the fallback when the native module is absent
   (older builds) so nothing crashes. Matching/session code is unchanged.
2. **Dashboard: no "Loading Dashboard".** Render the dashboard frame at once;
   show the last loaded numbers (or zero placeholders inside the cards) while
   the deferred read runs. Then profile and cut `getOwnerDashboard` first-mount
   cost (2.3 s settled).
3. **Tab switch first frame (200–400 ms).** Find what re-renders on a tab tap
   (shell, pathname consumers, unfrozen tab); memoize the bottom bar; consider
   pre-mounting Home/Sale/Inventory after startup idle so first visits are warm.
4. **Cart + / − (~250 ms).** Profile the cart row re-render; isolate the hot
   path (memoized row, stable callbacks, no full-list re-render).
5. **Login / PIN, More pages, staff side.** Add each to the release driver,
   measure, fix outliers. Staff sign-in uses a DEV test PIN supplied by the
   founder at run time — never written to files, logs or commits (rule 8).
6. **Inputs and dates.** Audit every `TextInput` for the shared field style;
   build one in-app `DateField` (calendar sheet in the app's own design, no new
   native dependency) and replace typed date inputs with it.
7. EAS internal build → full release driver pass → numbers table → PR update.

## Progress (2026-11-21)

- **Done, committed:** frame-processor OCR (59c9373, fallback kept; the Sale tab
  scanner stays on the photo loop because VisionCamera 5 has no Android barcode
  output — founder decision pending); no dashboard / staff-home loading screen,
  cached Intl formatters, one-row cart updates (316fe3d); in-app calendar for
  every date field and the shared input style on 9 sheets (next commit).
- **Needs a new native build** to verify OCR on the phone.

## Release results (A04s, EAS build f59940f8 @ 6c48eeb, ms first frame / settled)

| Tap | Baseline | Now |
|---|---|---|
| Add to cart | 132–177 / 165–219 | 43–67 / 43–67 |
| Filter | 120–146 / 268–285 | 41–50 / 116–121 |
| Home, first open | 279 / 2298 | 136 / 942 |
| Kept tabs | 216–428 / 378–624 | 75–163 / 152–501 |
| Open cart | 338 / 464 | 159 / 251 |
| Cart + / − | 200–296 | 59–85 / 59–111 |
| More menu | — | 67–131 |
| More pages (12) | 157–438 / 306–820 (build 18b91f6) | 111–319 / 225–780 |
| Back to Sale from a page | 233–408 (build 18b91f6) | 110–198 |
| Calendar open | — | 245 / 375 |
| PIN key | — | 22–51 |
| Live scan, per reading | ~600 | ~170–190 (frame OCR) |

Android Back on a More page now returns to the app. Staff side NOT measured:
the staff PIN supplied by the founder does not belong to the preview build's
test shop (one wrong-PIN attempt, then stopped); the preview app was left on
the PIN pad. Still above 100 ms: Home first settle (942), Report page (319),
Expense page (285), tab-switch first frame (75–194). The staff-sales calendar
(26885f2) is not in this build.

## Dashboard query plan (for approval — rule 10)

**Measured** (dev build, Galaxy A04s, sequential): `getOwnerDashboard` 829 ms —
today 176, yesterday 189, supplier payable 101, credit 56, cash 55, staff 54,
recent 51, expiry 35, owner check 29, low stock 25, shop name 17, settings 9,
drawer 6.

**Cause.** 42 day filters across 9 db files are written
`date(s.created_at, '+6 hours') = $businessDate`. SQLite cannot use the existing
`sales (shop_id, created_at)` index through a function, so each one reads every
sale the shop ever made; one `getDaySummary` runs four of them and the dashboard
calls it twice. It gets slower every day the shop trades. Supplier payable
computes one position per supplier (N+1). The owner check runs once per
sub-query (~10 times).

**Proposal — results must stay identical:**
1. Put an index range IN FRONT of each unchanged filter:
   `s.created_at >= $from AND s.created_at < $to AND date(s.created_at, '+6 hours') = $businessDate`,
   with `$from/$to` the business day widened by a day on each side. The exact
   original condition stays, so no row can be added or lost; the range only lets
   SQLite use the index.
2. One owner check per dashboard load.
3. Supplier payable: measure again after 1–2; change only if still slow.
4. Not touched: the cash formula, any money arithmetic, the business-date rule.

**Tests:** for every changed query, a SQLite test that runs old and new SQL on a
fixture with sales at 23:59 / 00:00 Dhaka and at UTC midnight and asserts equal
results; an `EXPLAIN QUERY PLAN` test that asserts the index is used; a check
that every stored `created_at` is ISO text (the range relies on it).

Status: **APPROVED by the founder 2026-11-21; item 1 implemented** —
`db/dhakaDay.ts` `onDhakaDay()`, applied to the 22 day-equality filters in
cash.ts, ownerDashboard.ts, staffDashboard.ts, notifications.ts and purchases.ts
(overdue `<` filters, month ranges and sales-history filters left unchanged).
Equivalence pinned on 7 timestamp shapes × 5 days × both Dhaka-midnight edges;
`EXPLAIN QUERY PLAN` shows `sales_shop_created_idx (shop_id=? AND created_at>? AND created_at<?)`.
Synthetic year of sales (60,000 rows, same 165-row answer): 53.4 ms → 0.47 ms per
query on the dev PC. Items 2–3 not done yet.

Other founder decisions 2026-11-21: **Android 8.0 (API 26) minimum** (the OCR
package needs it; EAS build 7a5b9287 failed below it); **Sale tab scanner = fast
OCR + a Barcode button**.

## Sync plan (for approval — rule 10)

Founder 2026-11-21: **NOT approved** in this round — sync code stays untouched.

**Problem.** A sync cycle runs ~20 s on the JS thread, and the local apply work
is synchronous SQLite. A tap that lands during it waits (one filter tap measured
10 s settled in dev mode while a cycle overlapped).

**Proposal (no change to what is synced, conflict rules or the push/pull
contract):**
- Apply pulled rows in bounded chunks (e.g. 50 rows per transaction) and yield
  to the UI between chunks (`setTimeout(0)` / idle callback), so no single JS
  task exceeds ~16–30 ms.
- Push: build each batch payload in a chunked loop with the same yields.
- Never start a cycle while the user is interacting (defer while a touch or a
  navigation transition happened in the last ~500 ms).
- Keep every transaction boundary exactly where correctness needs it: a chunk
  is one transaction; a cycle that is interrupted resumes from the cursor.
- Tests: existing sync suites unchanged + a test that no single apply task
  processes more than the chunk size; device check that taps stay < 100 ms
  during a full cycle.

Status: **awaiting founder approval** before any sync code changes.
