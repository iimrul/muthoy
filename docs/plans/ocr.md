# ML Kit Text Recognition (OCR) — Sale Entry + Add Medicine

## Context

This is Volume 6's "OCR PROMPT" (`docs/playbook/06-ai-prompt-library.md` §13), documented as **P1 — post-beta fast-follow**, not part of the 15-day P0 sprint (`docs/playbook/00-execution-roadmap.md`, `TECH_STACK.md` Volume 4). Beta hadn't shipped when this was requested: Day 13 (sync) had just landed, but Day 14 (Basic Admin Panel) was only a README stub and Day 15 (Beta Readiness Checklist) hadn't run. **The user was flagged this scope-lock conflict explicitly (per CLAUDE.md rule 13) and chose to proceed with OCR now anyway** — an intentional, explicit override, not an oversight.

Goal: let a cashier or stock clerk point the camera at a printed medicine strip instead of typing.
- **Sale Entry**: scan → look up in local inventory → read-only, no confirmation gate.
- **Add Medicine**: scan → prefill form fields → user must still tap Save (never auto-commit).

A stub existed at `apps/mobile/native/scanner.ts` with this exact spec written into its comments (`scanText()`, previously `throw new Error('TODO...')`). Per `native/README.md`, `native/` is **"the ONLY code in this app that imports native modules (camera, location, biometrics, notifications)"** — this is the hard constraint the whole design routes around.

## Architecture

```
native/scanner.ts         — scanText(imageUri) wrapping ML Kit. Pure .ts, no JSX.
native/ScannerCamera.tsx  — the one deliberate .tsx exception in native/, commented as such.
                             Owns expo-camera's CameraView + useCameraPermissions. Thin: live
                             preview + imperative capture()/requestPermission() via ref handle.
                             No styling/copy/business logic.
components/scanner/MedicineTextScanner.tsx — polished, reusable full-screen scan modal. Imports
                             ONLY native/ScannerCamera.tsx + native/scanner.ts — never expo-camera
                             or the ML Kit package directly. Owns permission-state copy, viewfinder
                             chrome, capture/processing/error states. Shared by both screens via a
                             `mode: 'lookup' | 'prefill'` prop (copy only, no branching logic).
domain/ocrText.ts, domain/ocrDateNormalizer.ts — pure, framework-free parsing heuristics,
                             unit-testable exactly like the existing domain/fefo.ts.
```

This satisfies the native/-only-imports-native-modules rule literally (only two files import `expo-camera`/ML Kit), while giving the camera UI a real component home.

**Visual reference only** (CLAUDE.md rule 15): `apps/prototype-web/Muthoy (prototype)/src/app/screens/OCRScan.tsx` shows the intended look — full-screen dark camera overlay, rounded viewfinder frame, top-right close, "Search manually instead" escape link. Reuse the visual language only, not its code or continuous-scan state machine (see Camera UX below for why this plan uses tap-to-capture instead).

## Files

**New:**
- `apps/mobile/native/ScannerCamera.tsx` — camera primitive (`CameraView` + permissions), ref-exposed `requestPermission()` / `captureAsync(): Promise<string | null>` (local file URI or null on failure, never throws).
- `apps/mobile/components/scanner/MedicineTextScanner.tsx` — full-screen scan modal, `{ visible, mode, onClose, onTextRecognized }` props. State machine: `ready → capturing → processing → success (auto-closes) | error (retry)`, plus a mirrored camera-permission state (`checking / deniable / blocked / granted`) with a "Grant access" / "Open Settings" (`Linking.openSettings()`) path. Always has a "Search manually instead" escape → `onClose()`.
- `apps/mobile/domain/ocrText.ts` (+ `.test.ts`) — pure heuristics over raw OCR text:
  - `extractMedicineNameCandidate(rawText): string | null` — first plausible line after dropping label lines (`MFG`, `EXP`, `B.NO`, `BATCH`, `LOT`, `MRP`, price/date-heavy lines).
  - `extractBatchNoCandidate(rawText): string | null` — regex on a batch/lot label followed by an alphanumeric token; `null` if unlabeled (never guess a bare token).
  - `extractExpiryCandidateText(rawText): string | null` — only ever returns an `EXP`/`EXPIRY`-labeled date token; no unlabeled-token fallback (an unlabeled date can't be told apart from a MFG/MFD date or a promotional date, and `isoDateSchema`'s "today or later" check cannot catch an OCR digit misread that turns a past manufacture date into an apparently-future one — revised after Codex review round 1, see "Post-review revisions" below).
  - `normalizeMedicineName(name): string`, `findExactNameMatch(candidateName, matches): T | null` — case/whitespace-insensitive exact-identity check used to gate Sale Entry's auto-add (see Behavior spec below).
  - `parseScannedMedicineStrip(rawText): { name, batchNo, expiryDate }` — composes the three extractors, running the expiry candidate through the date normalizer.
- `apps/mobile/domain/ocrDateNormalizer.ts` (+ `.test.ts`) — `normalizeScannedExpiryDate(candidateText): string | null`. Format normalization only (`DD/MM/YYYY`, `MM/YYYY` → last day of month, 2-digit years → `20YY`, day-first on ambiguous 3-part dates per Bangladesh convention). The "must be today or later" business rule stays exclusively in `isoDateSchema` — not duplicated here.
- `apps/mobile/domain/latestRequestGuard.ts` (+ `.test.ts`) — `createLatestRequestGuard()`: a tiny "which async call is still the latest" counter, extracted from Sale Entry's pre-existing inline request-id ref so the guarantee is independently unit-tested.
- `apps/mobile/domain/cameraPermissionState.ts` (+ `.test.ts`) — `resolveCameraPermissionState(permission, hasMountError)` and `requestPermissionErrorMessage(succeeded)`: the scanner's permission/error state-transition rules, extracted out of `native/ScannerCamera.tsx` so they're unit-tested without a React Native rendering harness (see "Post-review revisions round 2" below).

**Modified:**
- `apps/mobile/native/scanner.ts` — implement `scanText(imageUri: string): Promise<TextScanResult | null>` (signature gains the required `imageUri` param — the stub's parameterless version can't work, since ML Kit has nothing to process without an image). `scanBarcode` left untouched.
- `apps/mobile/app/(tabs)/sale.tsx` — scan button + `handleScanResult`.
- `apps/mobile/app/inventory/add-medicine.tsx` — scan button + `handleScanResult`.
- `packages/validation/src/inventory.ts` — export the previously-private `isoDateSchema` (already re-exported package-wide via `export * from './inventory'` in `packages/validation/src/index.ts`) so the Add Medicine screen can validate a normalized scanned date before touching form state.
- `apps/mobile/app.json`, `apps/mobile/package.json` — see Expo config below.

## Behavior spec

**Sale Entry** (`app/(tabs)/sale.tsx`) — reuses `searchMedicinesForSale(shopId, query)` from `db/sales.ts:57` as-is, no new matching logic:
- Extract `runSearch(value)` from the existing `handleQueryChange` body (query/results/searchError/isSearching + the `requestId` race guard) so scan and manual typing share the exact same path.
- `handleScanResult(recognizedText)`: run `extractMedicineNameCandidate(recognizedText) ?? recognizedText.trim()` through `runSearch`.
  - Auto-adds via the existing `addItem()` (same `CartLine` shape already used by the manual tap handler) **only when both hold**: (1) the search is still the most recent one — `runSearch` now returns `{ matches, isLatest }` via `domain/latestRequestGuard.ts`, so a scan whose search resolves after a newer manual retype is discarded rather than silently adding a stale result; (2) the sole result's own name is an *exact* normalized match for the scanned text (`domain/ocrText.ts`'s `findExactNameMatch`) — `searchMedicinesForSale` does FTS **prefix** matching, so "exactly one result" alone was not sufficient evidence (a truncated OCR read like "Napa" could be the only prefix match without being that product). Revised after Codex review round 1 — see "Post-review revisions" below.
  - Anything less certain (0/2+ results, or a single result that's only a prefix match) just populates `results`/`query`; the existing `FlatList`/`EmptyState` already handles both (no dead end, same as typing an ambiguous query).
- Small inline banner (`text-brand-green`, mirrors the existing `text-error` `searchError` pattern) confirms what was auto-added; cleared on next manual keystroke.

**Add Medicine** (`app/inventory/add-medicine.tsx`) — `useForm` gains `setValue`/`getValues`:
- `handleScanResult(recognizedText)`: run `parseScannedMedicineStrip(recognizedText)`.
  - For each of `name`, `firstBatch.batchNo`: set only if the field is currently empty — never clobbers something the user already typed.
  - For `expiryDate`: additionally gate through `isoDateSchema.safeParse(...)` before `setValue` — a malformed or past-dated candidate is silently dropped, field stays blank. `extractExpiryCandidateText` itself never returns an unlabeled or MFG/MFD-labeled date (see Files above), so this gate gets only genuinely `EXP`-labeled candidates; it is not the sole line of defense against a manufacture date being mistaken for an expiry date.
  - All fields remain fully editable afterward. **Save button is the only commit path — unchanged.** No new confirmation modal; matches this codebase's existing pattern (`app/sale/checkout.tsx`) of "the editable form itself is the review step."

**Camera UX**: tap-to-capture (`expo-camera`'s `takePictureAsync`), not continuous live scanning — no `react-native-vision-camera`/frame-processor pipeline exists anywhere in this codebase (only Reanimated for UI animation), and building one is out of scope for a P1 fast-follow.

## Expo / native config changes

- **`app.json`**: `expo-camera` plugin config is `{ "cameraPermission": "Muthoy needs camera access to scan medicine strips.", "microphonePermission": false, "recordAudioAndroid": false }`. Auto-writes iOS `NSCameraUsageDescription` and Android's `CAMERA` permission; `microphonePermission: false` and `recordAudioAndroid: false` suppress the mic/`RECORD_AUDIO` permissions the plugin writes by default — this feature only ever calls `takePictureAsync` (never `recordAsync`/video), so audio access is unused on both platforms (revised after Codex review round 1).
- **`package.json`**: `expo-camera` added via `npx expo install expo-camera` (SDK-aligned version resolved by Expo's own tooling). `@infinitered/react-native-mlkit-text-recognition` added (Expo Module, built for Expo's managed workflow; transitively pulls `@infinitered/react-native-mlkit-core@3.1.0`). See "Dependency verification" below for why this package was kept rather than switched.
- **`native/ScannerCamera.tsx` permission/mount handling** (revised after Codex review round 1): `useCameraPermissions()`'s 3rd tuple element (a manual `getCameraPermissionsAsync` re-check) is called on every `AppState` foreground transition, so a `blocked` state clears on its own after the user grants access from the OS Settings app instead of trapping them. `CameraView`'s `onCameraReady`/`onMountError` are wired so `captureAsync()` refuses to call `takePictureAsync` before the camera is actually ready, and a native mount failure surfaces as a new `'unavailable'` permission state (generic message + the existing "Search manually instead" escape) rather than leaving a broken preview on screen. `requestPermission()` is wrapped in try/catch so a native-call failure can't produce an unhandled rejection.
- **New EAS development build required, not optional**: the currently-installed dev-client binary on any test device has neither native module linked. A new `eas build --profile development` + reinstall on-device is required before any OCR testing.
- **ML Kit text recognition does not run on the iOS simulator** — physical device required for all OCR testing.

## Dependency verification

**Round 1** — checked whether `@infinitered/react-native-mlkit-text-recognition` should be swapped, using structural evidence: both it and `@infinitered/react-native-mlkit-core@3.1.0` ship a real `expo-module.config.json`, and the Android `build.gradle` applies `ExpoModulesCorePlugin.gradle`/`applyKotlinExpoModulesCorePlugin()` — genuine Expo Module, not a classic bridge module, last published 2025-11-25/2025-11-17. Concluded: keep. **Codex correctly flagged this as insufficient** — a package being built on the Expo Modules API doesn't by itself mean the *maintainers* have tested or declared support for a specific later SDK.

**Round 2** — fetched the package's own primary-source compatibility table (`raw.githubusercontent.com/infinitered/react-native-mlkit/main/README.md`) instead of inferring from architecture:

| Expo SDK | MLKit version |
|---|---|
| ^49.0.0 | <= 0.7.7 |
| ^50.0.0 | ^1.0.0 |
| ^51.0.0 | ^2.0.0 |
| ^52.0.0 | ^3.0.0 |
| ^53.0.0 | ^4.0.0 |
| ^54.0.0 | ^5.0.0 |
| ^56.0.0 | ^6.0.0 |

The installed `react-native-mlkit-text-recognition@5.0.1` (confirmed current — `npm view ... dist-tags` shows `latest: 5.0.1`, no hidden newer release) maps only to Expo `^54.0.0`. **No row exists for SDK 57 at all, at any version.** Codex's concern is confirmed true, not assumed.

Checked three alternatives for a credibly SDK-57-compatible replacement, all against primary sources (READMEs, registry metadata, repo activity):

| Package | SDK 57 claim | New Arch claim | Last real activity | Maturity |
|---|---|---|---|---|
| `@infinitered/react-native-mlkit-text-recognition` (current) | None (caps at ^54 per own table) | Structural only (Expo Modules API) | 2025-11-25 | Org-backed, established |
| `@react-native-ml-kit/text-recognition` | None found | None found | 2025-09-06 push | Single maintainer, 25 open issues |
| `react-native-text-recognition` (JoeyEamigh) | None found | Unverified 2024 marketing claim | 2024-06-27 | Stuck on `2.0.0-alpha.1`, effectively abandoned |
| `rn-mlkit-ocr` (ahmeterenodaci) | None found | None found | 2026-01-22 push | Pre-1.0 (0.3.1), 30 stars, solo maintainer, unproven |

**No candidate — including the current package — has a primary-source-confirmed Expo SDK 57 claim.**

**Round 3 — why "documented ≤54" is not the same as "incompatible with 57".** Read the installed package's actual native build files and sources rather than only its docs:

- **No version pins anywhere.** Android `build.gradle`: `implementation project(':expo-modules-core')` — a *project* reference, so it compiles against whatever `expo-modules-core` the app ships (SDK 57's). iOS podspec: `s.dependency 'ExpoModulesCore'` with **no version constraint**. Android SDK levels/Kotlin version all use `safeExtGet(...)` fallbacks that Expo's root Gradle overrides. There is no mechanism in this package that can pin it to SDK 54.
- **Only the long-stable Expo Modules DSL is used.** Kotlin: `Module`, `ModuleDefinition`, `Name`, `AsyncFunction`, `Promise`, `CodedException`, `appContext.reactContext`. Swift: `Module`, `ModuleDefinition`, `Name`, `AsyncFunction`, `Promise`. These primitives are unchanged across SDK 50→57 — the package uses no experimental or recently-churned API surface.
- **`npx expo-doctor` on this project: 20/21 checks passed.** The single failure is pre-existing patch-version drift in Expo's *own* packages (`expo`, `expo-router`, `expo-notifications`, …) — unrelated to OCR and out of scope for this change. **Neither `@infinitered/react-native-mlkit-text-recognition` nor `expo-camera` was flagged**, and `expo-camera@57.0.3` is confirmed at its correct SDK 57 version. expo-doctor's dependency/native-module validation is Expo's own tooling, so this is empirical project-level evidence, not inference.
- **A hand-written local Expo module was considered and rejected**: it would contain the same `com.google.mlkit:text-recognition` dependency, the same Expo Modules DSL, and compile the same way — so it offers **no compatibility advantage**, while replacing zero-implementation-risk third-party code with untested hand-written Kotlin/Swift. Strictly worse.

**Decision: keep `@infinitered/react-native-mlkit-text-recognition` — this is the safest minimal approach, not a default-by-inertia.** The "SDK 54" label is a *tested-against* claim by the maintainers, not a technical constraint; the package is structurally unpinned and API-conservative, the project's own Expo tooling raises no issue with it, and every alternative is more stale, less architecturally sound, or unproven. Residual risk is real but narrow and named: (a) a source-level Expo Modules API break between 54 and 57 that the stable-DSL analysis missed, (b) an iOS CocoaPods conflict on `GoogleMLKit`/`GoogleUtilities` (remedy: `expo-build-properties`, already noted above).

**Build-verification strategy** (cheapest signal first — each step is a real gate, not a formality):

1. `npx expo-doctor` — **done, 20/21 pass**, OCR packages clean.
2. `npx expo prebuild --clean --platform android` locally — generates the native project and resolves Gradle/autolinking. Catches an expo-modules-core API break or autolink failure in minutes, with no EAS credits spent. **This is the first step that can actually falsify the decision above.**
3. `eas build --profile development --platform android` — Android first: no provisioning profiles, fastest turnaround, and the platform where ML Kit is bundled rather than pod-resolved.
4. Install on a physical Android device, run one capture→OCR round trip. This is the real New Architecture / Fabric verification — a TurboModule registration failure surfaces here, not at compile time.
5. Only then iOS: `expo prebuild --platform ios` + `pod install` (where a `GoogleMLKit` pod conflict would appear; apply `expo-build-properties` only if it actually occurs), then an EAS iOS dev build and on-device test. ML Kit text recognition does not run on the iOS simulator.
6. **Rollback trigger**: if step 2 or 3 fails on an `expo-modules-core` API incompatibility, re-evaluate `rn-mlkit-ocr` (most recently active alternative, 2026-01-22) or write the local Expo module against SDK 57 directly — both become justified *only* once the incumbent is empirically shown broken. If step 4 fails at runtime, OCR is paused pending upstream SDK 57 support; the app is unaffected because every OCR entry point is additive and manual entry remains fully functional.

The previously-flagged quality smell is unchanged: `@infinitered/react-native-mlkit-core@3.1.0` ships `@testing-library/jest-native`, `@testing-library/react-hooks`, and `@types/jest` as production `dependencies` rather than `devDependencies` — confirmed unused at app runtime, cosmetic only.

## Test plan

- **Unit** (`domain/ocrText.test.ts`, `domain/ocrDateNormalizer.test.ts`, `domain/latestRequestGuard.test.ts`): realistic strip text blob → correct `name`/`batchNo`/`expiryDate` extraction; ambiguous/garbage input → fields correctly `null`; date-format table incl. invalid dates → `null`; an MFG-labeled-only strip (no `EXP` label) → `expiryDate` stays `null`; `findExactNameMatch` returns `null` for a prefix-only match and for 2+ results, and returns the match only on exact normalized identity; `createLatestRequestGuard` reports an earlier-started id as no longer latest once a newer one starts.
- **Manual, on-device only**: permission grant/deny/blocked→Settings; 2+ real physical medicine strips; Sale Entry unique match (auto-add, correct FEFO batch, no prompt), ambiguous match (list shown), unknown medicine (empty state); Add Medicine partial-confidence prefill with all fields still editable and Save still required; airplane-mode offline check.

## Out of scope

`scanBarcode` (separate future prompt), a generic reusable camera-modal library beyond these two screens, OCR touching money/price fields, a new confirmation-modal component, continuous/multi-item scan sessions.

## Post-review revisions (Codex review round 1, 2026-08-15)

Codex reviewed the initial implementation of this plan and returned CHANGES REQUIRED. Fixed, all scoped to OCR safety — no change to FEFO/cart/stock/money/sync/auth behavior, Add Medicine's empty-field-only-prefill-plus-Save-only-commit contract, or barcode staying unimplemented:

1. **Sale Entry auto-add tightened** — was "exactly one FTS result"; now also requires that result's name to be an *exact* normalized match for the scanned text (`findExactNameMatch`), since FTS prefix-matches. See Behavior spec above.
2. **Stale-result race fixed** — `runSearch` now reports whether it's still the latest request (`domain/latestRequestGuard.ts`); a scan whose search resolves after a newer manual retype is discarded instead of auto-adding. See Behavior spec above.
3. **Android `RECORD_AUDIO` / iOS microphone permission removed** — this feature never records audio or video. See Expo / native config changes above.
4. **Camera permission refresh + mount/ready safety** — foreground re-check via `AppState`, `onCameraReady`/`onMountError` handling, safe `requestPermission()` failure handling. See Expo / native config changes above.
5. **Unlabeled expiry-date fallback removed** — `extractExpiryCandidateText` now only ever returns an `EXP`-labeled date; no more "single unlabeled token" guess. See Files and Behavior spec above.
6. **Tests added** for all of the above: `domain/ocrText.test.ts` (exact-match gating, MFG-only-no-fallback), `domain/latestRequestGuard.test.ts` (staleness semantics). The camera permission-refresh/mount-error handling in `native/ScannerCamera.tsx` is not independently unit-tested — this repo has no React Native component-testing harness installed (it uses Vitest for pure-logic tests only; no `jest-expo`/`@testing-library/react-native`), and standing one up was judged out of scope for a targeted fix pass. Covered instead by the manual physical-device test plan.
7. **Dependency verified, not switched** — see "Dependency verification" above.

## Post-review revisions (Codex review round 2, 2026-08-15)

1. **Dependency re-verified from primary sources, not architecture inference** — round 1's "keep" was under-evidenced; the package's own compatibility table caps at SDK 54, confirmed, and no alternative is better-evidenced for SDK 57 either. See "Dependency verification" above — same decision (keep), now honestly qualified as unverified-but-safest-available, gated on the required physical-device build test.
2. **Scanner permission/error UX hardened** — `native/ScannerCamera.tsx`'s permission-state decision moved to `domain/cameraPermissionState.ts` (pure, tested). `requestPermission()` now reports success/failure so `MedicineTextScanner.tsx` can show a distinct "couldn't request camera access" message instead of the button silently doing nothing. The `'unavailable'` (mount error) state gained a real **Retry** button — `MedicineTextScanner.tsx` now remounts `ScannerCamera` in place via a `key` bump rather than requiring the user to close and reopen the whole modal. Every `CameraPermissionState` now has a reachable, actionable UI branch — no dead state.
3. **Focused tests added** for the extracted decision logic: `domain/cameraPermissionState.test.ts` covers all five permission states (including mount-error priority over a stale `granted` read) and both request-outcome branches. Component-level rendering tests were deferred at this point and added in round 3 below.

## Post-review revisions (Codex review round 3, 2026-08-15)

1. **Dependency: kept, now on empirical rather than documentary evidence** — see "Round 3" in Dependency verification above, plus the staged build-verification strategy that follows it. Short version: the package has no Expo version pins in either build file, uses only the stable Expo Modules DSL, and `npx expo-doctor` passes 20/21 on this project without flagging it (the one failure is unrelated pre-existing Expo patch drift). A hand-written local Expo module was considered and rejected as offering no compatibility advantage at strictly higher implementation risk.
2. **`Linking.openSettings()` failure now handled visibly** — it was a floating promise, so a rejection (no resolvable Settings activity, seen on some Android OEM builds) left the button silently doing nothing. Now awaited in a try/catch; on failure the user sees a message carrying the manual navigation path (`Settings › Apps › Muthoy › Permissions › Camera`), the button stays pressable to retry, and the "Search manually instead" escape remains available throughout. Copy lives in `domain/cameraPermissionState.ts`'s `openSettingsErrorMessage()` so it is asserted by both the pure and component test suites.
3. **Real scanner component tests added** — `components/scanner/MedicineTextScanner.test.tsx` (14 tests) renders the actual component under jsdom, with React Native primitives stubbed and `native/ScannerCamera` + `native/scanner` mocked at the module boundary, so no expo-camera or ML Kit native module is loaded. Covers: deniable→grant (success, failure message, error clearing on retry), blocked→Settings (success, failure with fallback path, retry after failure, manual-search escape), unavailable→in-place camera retry, capture failure, no-text-detected, OCR throw, retry-returns-to-capturable, and the success path handing text to the caller and closing. Required adding `jsdom` + `@testing-library/react` as `apps/mobile` devDependencies and one `include` glob in `vitest.config.ts`; the default `node` environment is unchanged for every other test (the new file opts in via its own `@vitest-environment jsdom` docblock).
