# Printer, OCR and release-test readiness

**Date:** 2026-11-12. **Method:** source review of `D:\md\apps\mobile` (read-only) plus new **off-device**
tests in the isolated clone `D:\cc`. No device, Bluetooth, camera, adb, gradle, expo, Metro or app run;
no real printer or transaction. Every hardware item below is **NOT RUN — needs authorized hardware**.

## In plain English

Neither printing nor scanning is ready for a hardware test yet.

- **Printing has a definite bug that ruins every printout:** the code turns every "new line" into a
  question mark, so the paper comes out as one long run-on line. I confirmed this myself in the code,
  and the new tests prove it. It is a one-character fix, but it is in Codex's area and needs approval.
- Two more problems will probably stop the phone finding the printer at all on some Android versions
  (missing Android permissions). Only a real phone can confirm.
- After a connection drop, the app **reprints the whole job automatically**, which can print a receipt
  twice. That conflicts with the written acceptance rule, so it needs your decision.
- **There is no sale-receipt printing at all** — only end-of-day, monthly and test prints. If customer
  receipts are expected, that is a scope decision.
- Scanning works only for English text; Bangla text on a strip or prescription cannot be read.

## Which source the tests target

Default target is `D:\cc` (a23ca61). Of the tested files, only `native/printer.ts` differs in `D:\md`
(an iOS early return at lines 28–29). `modules/muthoy-ble-printer/android`, its `src/`, and
`domain/escpos.ts` are unchanged versus a23ca61. The harness also ran read-only against `D:\md`
(`HW_TARGET_ROOT=D:/md`): identical counts; only the iOS platform test switched branch. (Process
disclosure: that run read `D:\md` files through Vitest; `D:\md`'s git-status hash and `.vite`
timestamp were checked unchanged before and after.)

## 1. Inventory

**Printer** — BLE GATT only (no Classic/SPP, no bonding, no MTU request, no UUID filter).
`modules/muthoy-ble-printer/android/.../MuthoyBlePrinterModule.kt`: unfiltered scan (:41) 1.5–12 s,
JS passes 5000 ms (`native/printer.ts:49`); `connectGatt` TRANSPORT_LE (:79) to the first writable
characteristic of any service (:72); 180-byte chunks (:57); write-without-response paced at 25 ms (:61);
20 s whole-job timeout (:80). JS wrapper `native/printer.ts`: paired device in MMKV (:12-25), errors
mapped by substring (:39-46), **one automatic full-job retry** (:55-61). Permissions: Android 12+ SCAN +
CONNECT, ≤11 FINE_LOCATION (`printer.ts:31-33`); `app.json:26-30` declares SCAN, CONNECT,
FINE_LOCATION — **no `neverForLocation`, no legacy BLUETOOTH/BLUETOOTH_ADMIN**; minSdk 24.
Encoding `domain/escpos.ts`: 32 columns (:5), NFKD then everything outside 0x20–0x7E → `?` (:9);
jobs: test print (:26), monthly P&L (:31), end-of-day (:49). Bangla: none (Founder decision D-7, prints
`?`). Call sites: `printer-settings.tsx:37`, `end-of-day.tsx:69` (premium-gated),
`reports/monthly-report.tsx:59`. **No sale receipt, no reprint feature.**

**OCR** — `@infinitered/react-native-mlkit-text-recognition` 5.0.1 → ML Kit `text-recognition:16.0.1`,
on-device, **Latin only**. `native/scanner.ts:42-45` keeps only `.text` (drops `blocks`). Tap-to-capture
q=0.8 (`native/ScannerCamera.tsx:32,86-96`); permission state `domain/cameraPermissionState.ts:23-40`.
Pure parsers: `domain/ocrText.ts`, `ocrDateNormalizer.ts`, `prescriptionLines.ts`, `medicineMatch.ts`.
Used by sale lookup, checkout prescription, purchase invoice, Add Medicine prefill. Temporary JPEG
deleted in `finally`; recognized text not persisted; prescription images stored and synced to Storage.

## 2. Gaps and risks

| ID | Severity | Status | Where | Finding |
|---|---|---|---|---|
| **P1** | **CRITICAL** | **VERIFIED** (also by me, by reading the source) | `escpos.ts:9` via `ascii()` :21 | `thermalText` turns `\n` into `?`. **Every job has zero LF bytes**: rows run together and wrap mid-word; the last text is still buffered when the cut arrives. Existing `escpos.test.ts` misses it (substring checks only). |
| P2 | MEDIUM | VERIFIED | `escpos.ts:45-46` | Monthly report's `rows.filter(Boolean)` removes its trailing blank lines: 1 LF before the cut vs 3 on end-of-day; plan PR-11 wants 3. |
| **P3** | HIGH | VERIFIED — **decision** | `printer.ts:55-61`; Kotlin :80 | After disconnected / send-failed / out-of-range (incl. the 20 s timeout firing mid-job) the **whole job is re-sent once** → partial + full copy on paper. Conflicts with T33 "no automatic second print after uncertain completion"; Codex's `printer.test.ts:33-38` asserts the retry as intended. |
| P4 | HIGH | VERIFIED manifest; consequence SUSPECTED | `app.json:26-30` | No BLUETOOTH/BLUETOOTH_ADMIN with minSdk 24 → Android ≤11 likely SecurityException (scan "unknown", print "permission-denied"). |
| P5 | HIGH | SUSPECTED — **first device test** | `app.json:27`; `printer.ts:31-32` | Android 12+: SCAN declared without `neverForLocation`, location never requested → the stack may drop scan results ("No BLE printers found"). |
| P6 | HIGH | SUSPECTED | Kotlin :57-60 | No MTU request but 180-byte chunks → truncation (no-response) or reliance on long writes (with-response). |
| P7 | HIGH | SUSPECTED | Kotlin :49-63,75-77 | No-response mode schedules the next chunk twice (25 ms timer and `onCharacteristicWrite`); shared state mutated from two threads. |
| P8 | MEDIUM | VERIFIED | Kotlin :37,72 | Unfiltered scan lists earbuds/TVs as "BLE Printer"; bytes go to the first writable characteristic of any service (plan PR-10 names service 0x18F0 / char 2AF1). |
| P9 | MEDIUM | VERIFIED | `printer.ts:6,23-25,56` | "Success" = transport resolved, never paper out; no paper-status query; settings says "test print completed". |
| P10 | MEDIUM | VERIFIED | Kotlin :43,47,82; `printer.ts:35-44` | Bluetooth-off while printing shows as out-of-range and is retried; all Android scan failures show 'unknown'; denied vs don't-ask-again indistinguishable; no Settings hand-off. |
| P11 | MEDIUM | VERIFIED — **scope decision** | — | No sale receipt / reprint, yet T33 acceptance expects receipt totals = ledger (`IMPLEMENTATION_TASK_MATRIX.md:399`). |
| P12 | LOW–MED | VERIFIED (D-7) | `escpos.ts:9` | Bangla shop name prints as `?`s. |
| P13 | LOW | VERIFIED | `escpos.ts:5,19,44,58` | 32 columns on 80 mm; EOD "NET PROFIT -50.00" vs monthly "NET LOSS"; "-0.00". |
| P14 | LOW | VERIFIED | `printer.ts:51-63` | Android does not serialize overlapping prints (iOS answers BUSY); disabled buttons mitigate. |
| P15 | LOW | SUSPECTED | `monthly-report.tsx:59` vs `end-of-day.tsx:69` | Monthly and test print skip the premium 'printer' gate EOD applies. |
| P16 | LOW | SUSPECTED | Kotlin :41 | Android ≤11 also needs Location Services on; not checked → empty list. |
| P17 | INFO | SUSPECTED | `printer-settings.tsx:48` | Listed Epson/Star models may be Classic Bluetooth; module is BLE-only. |
| P18 | SCOPE | VERIFIED | uncommitted `ios/`, `printer.ts:28-29` | Codex added iOS printer code while docs say iOS is on hold. |
| O1 | HIGH | VERIFIED | ML Kit; `ocrText.ts:18` | Latin-only recognizer + Latin-letter name rule → Bangla unreadable. |
| O2 | MEDIUM | VERIFIED | `ocrText.ts:146` → `prescriptionLines.ts:71` | A prescription line with nothing extractable is **dropped** from review, contradicting `prescriptionLines.ts:57-61`. |
| O3 | MEDIUM | SUSPECTED | `ocrText.ts:137`; `scanner.ts:43-45` | Invoice split on blank lines but ML Kit blocks discarded → one candidate for a whole invoice. |
| O4 | MEDIUM | VERIFIED | `ocrText.ts:64-75`; `ocrDateNormalizer.ts:39-43` | Expiry missed for "Exp. 12/2027", "EXP DEC 2027", "2027-12", Bangla digits; "Lotion" → batch "ion". User-confirmed prefills, not silent saves. |
| O5 | LOW | VERIFIED | `ocrText.ts:13-31` | Manufacturer line or "Tk 45.00" can become the name; invoice header offered as a medicine. |
| O6 | LOW | VERIFIED | `cameraPermissionState.ts:47,57-59` | Camera messages hard-coded English (same as 39-screen V-08). |

## 3. Off-device harness (created in `D:\cc\apps\mobile\tests\hardware-readiness\`)

`vitest.hardware.config.ts` (standalone, reuses root aliases; no root config edited) · `fakes\`
(`react-native.ts`, `expo.ts`, `fake-ble-printer.ts` — scripted fake native module recording bytes and
simulating partial delivery, `escpos-paper.ts` — a model of the ESC/POS command set, not a printer) ·
`support\target.ts` (loads modules from the default target or `HW_TARGET_ROOT`), `support\fixtures.ts`
(synthetic snapshots) · tests: `escpos-golden.hwtest.ts` (26), `printer-transport.hwtest.ts` (23),
`ocr-parsers.hwtest.ts` (41), `release-requirements.hwtest.ts` (8, **expected red until fixed**) ·
`positive-control\make-mutant.cjs` (writes patched copies only; throws if a patch does not apply).
The `.hwtest.ts` suffix keeps them out of the root suite. `tsc -p apps/mobile/tsconfig.json --noEmit`
exits 0 with them included.

| Command (from `D:\cc`) | Result | Exit |
|---|---|---|
| `npx vitest run --config apps/mobile/tests/hardware-readiness/vitest.hardware.config.ts` | **89 passed / 8 failed / 1 skipped (98)** — re-run independently by me on 2026-11-12 with the same numbers | 1 |
| same, three characterization files only | 89 passed / 1 skipped | 0 |
| `HW_TARGET_ROOT=D:/md` + full command | 89 / 8 / 1 | 1 |
| positive control: `node …/positive-control/make-mutant.cjs`, then `HW_TARGET_ROOT=…/.mutant-control` on `release-requirements.hwtest.ts` | 8/8 pass (copies deleted afterwards) | 0 |

The 8 failures **are the defects**: P1 ×4, P2 ×1, P3 ×3. The skip is the iOS branch test. The positive
control proves both directions: with the fixes applied to copies, requirement tests pass and the
characterization tests fail exactly where they pin the defects. Off-device testing cannot show GATT
behaviour, MTU, pairing dialogs, paper sensors or OCR accuracy.

## 4. Physical acceptance procedure — all NOT RUN

Preconditions: an Android 12+ phone (Galaxy A04s, gate E1) **and** an Android ≤11 phone (minSdk 24);
a named BLE ESC/POS 58 mm printer (80 mm optional) and paper; a current-source debug build; the
synthetic H-5 shop. Evidence per step: screen recording, photo of paper beside a ruler, app message
text, device/OS/printer model.

1. **Android 12+ pairing.** Fresh install → Printer Settings → Select. PASS: Nearby-devices prompt; after
   Allow the printer is listed within 5 s. Empty list → grant Location and rescan; if it then appears,
   P5 is confirmed. Record Deny / don't-ask-again / Bluetooth-off messages (P10); non-printers listed → P8.
2. **Android ≤11**, Location Services on then off. PASS: listed, test print succeeds. Expected today:
   SecurityException-type failure (P4/P16).
3. **Test print.** PASS: 4 centred rows, bold title, full rule, ≥2 blank lines, clean cut, no `?`.
   Expected today: FAIL (P1).
4. **End-of-day print** (stands in for receipts) after one cash, one credit, one split synthetic sale —
   only within authorized write scope. PASS: printed totals equal the on-screen report to the paisa,
   one row per line. Repeat with UI in Bangla and a Bangla shop name (header `?` — D-7).
5. **Monthly report print.** Same; measure the feed before the cut (P2).
6. **Sale receipt (cash/credit/split, Bangla): NOT APPLICABLE** — feature does not exist (P11).
7. **Reprint** (press Print again). PASS: identical output, one copy per press.
8. **Disconnect and recovery**: power off mid-job; out of range; Bluetooth off mid-print. Count copies on
   paper — an automatic second copy is a FAIL per T33 (P3). Reconnect, print once: one clean copy.
9. **Paper out.** PASS: app does not claim completion. Expected today: reports success (P9).
10. **Write path** with a write-without-response-only printer, longest job. PASS: no truncated/garbled
    chunks, < 20 s (P6/P7).
11. **Interruptions**: double tap Print; background mid-print; revoke Bluetooth permission then print.
    PASS: no crash, truthful message.
12. **Exactly-32-character rows** (after P1 fix). PASS: no blank line between rows.
13. **Camera permission states** (needs Founder-approved camera scope): first prompt → Deny → Deny +
    don't-ask (Open Settings) → grant in Settings and return → Allow. Record Settings-failure copy (O6).
14. **Invoice packets, airplane mode** (synthetic printed packets, no real patient/supplier data):
    A clean 3-item; B dense table; C "Exp."/month-name dates; D Bangla. PASS: one candidate per item,
    raw text visible, nothing auto-commits, manual fallback works. Record field-by-field vs ground truth.
15. **Strip scans** in Add Medicine and Sale lookup: confirm sheet, nothing auto-added.
16. **Checkout prescription capture**: image kept, sale completes even when unreadable; record whether a
    Bangla line is dropped (O2).
17. Lighting, rotation, blur, no-text: each a retryable error.
18. Temporary-capture deletion and attachment survival across restart (debuggable build, authorized
    file inspection).

## 5. Release-test readiness

| Gate | Status | Why |
|---|---|---|
| Off-device harness | READY | 89 characterization tests green; 8 requirement tests red by design; positive control proven |
| T33 P-3 printer | BLOCKED | code: P1 (critical), P2; decisions: P3, P11; likely device blockers P4–P7; no printer/paper |
| T34 W2-01/E9 OCR | BLOCKED | camera/packet/permission runs not authorized; O1–O4 known; E9 deferred |
| T06 / E1 (Galaxy A04s) | BLOCKED | needs a current-source build carrying P1/P4/P5 fixes. The release checklist itself has **no printer/OCR line** — coverage lives only in T33/T34 |
| T19 / T25 (workflows, 39 screens) | BLOCKED | Printer Settings and scanner states in both languages not covered |
| T36 Batch 5 RC | BLOCKED | depends on all of the above |
| iOS | ON HOLD | uncommitted iOS printer code exists (P18) |
| D-7 English-only output | DECISION | Bangla shop name prints as `?` |

Before any hardware session is worth booking: fix P1 and P2, decide P3, add manifest fixes for P4
(legacy permissions capped at SDK 30) and P5 (`neverForLocation`, or request location). P6–P8 need
native hardening (MTU negotiation, one write scheduler, UUID filter). Per CLAUDE.md rule 10 these
need a plan and approval first; none were made.
