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

## Sync plan (for approval — rule 10)

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
