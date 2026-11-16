# Android 39-screen — remaining defects and test matrix

**Date:** 2026-11-12. **Method:** read-only review of the Codex matrix and evidence in
`D:\MuthoyAudit-20261109\implementation\`, about 25 evidence screenshots, and the source under test in
`D:\md\apps\mobile` (uncommitted, branch `remediation/android-metro-20261109`). No device, adb, build or
Metro command. Shop/user/drawer IDs, the phone serial, the project ref, phone numbers and names are
redacted.

> **No status was upgraded.** Every row keeps the matrix's complete-screen verdict: **BLOCKED**.
> Source and unit checks never earn a physical PASS.

## In plain English

Nothing on the phone app is fully accepted yet — every one of the 39 screens still needs a proper
check on a real phone. Reading the evidence and the code turned up 13 real problems. The most
important: on **Checkout, the "Hold sale" and "Cancel sale" buttons are hidden under the bottom menu
bar and cannot be pressed**, and after switching Owner → Staff → Owner the phone **lost the Owner's
history** (Codex is already fixing that one). There are also 13 likely problems that only a phone can
confirm, a list of tests, and a one-session plan for the next phone test.

## Read first

- **D:\md is still changing.** After the 13:10 checkpoint on 11 Nov (317 files / 7,459 tests), about
  45 files changed (13:47–14:35), including `db/sync-helpers.ts`, `db/schema.ts`, a new
  `db/migrations/0034_recovery_journal.sql`, recovery files, iOS modules, `native/printer.ts`,
  `app.json` and `vitest.config.ts`. None of the UI files cited below changed after 13:13. Even so, any
  device session must be tied to a freshly frozen source hash.
- Many captures show the Expo dev gear or the Metro "Refreshing…" banner — development overlays, not
  app defects. Captures taken during "Refreshing…" stay provisional.
- `screens-4413-edit\` is a react-native-screens source copy, not screenshots.
- **Privacy:** `evidence\android-supplier-detail-20261110.png` shows a real phone number. Redact it
  before the file is shared.
- `android-credit-sales-bangla-verified-20261110.png` actually shows *customer detail* (misnamed).

## 1. The 39 screens

Codes: R = routes, L = language, Th = theme; b = bounded PASS, NR = not run, src = source only,
obs = default palette observed. **Missing on every row (set C):** 360 dp and ≥411 dp widths (only the
384 dp Galaxy A04s was used); OS dark mode (`userInterfaceStyle:"automatic"` + DayNight, but no dark
palette); 3-button navigation; the full field/route appendix; recapture on the current frozen hash
after a verified rehydration (V-13).

| # | Screen | Matrix | Missing beyond C | Defects |
|---|---|---|---|---|
| 1 | RoleSelect | R b · L both-b · Th obs (captures predate status-bar/AuthShell changes) | current-source EN/BN; registration branch; stale-fallback check | – |
| 2 | Registration | NR | everything; submit needs authorized test OTP | – |
| 3 | OTPVerification | NR | timer/resend/wrong/expired/rate-limit/offline; keyboard; EN/BN | – |
| 4 | PINSetup | NR | mismatch/backspace; EN/BN | – |
| 5 | PINLogin (+forgot) | NR | wrong PIN/lockout/forgot; revoked actor; EN/BN; offline | – |
| 6 | StaffLogin | NR | fresh-device phone+PIN; inactive/hold denial; keyboard | – |
| 7 | MorningDashboard | R b · L both-b · Th obs | tiers; empty shop; loading/error; offline; sync pending/failed; shop switch | V-10, V-13, S-01 |
| 8 | StaffHome | NR (Nov 10 Manager + cashier homes, EN only) | BN; populated list; revoke while open; End Shift; scanner from green home | V-02, V-05, V-06, V-11, S-12 |
| 9 | SaleEntry | R b · L both-b | Staff/Manager; no-match; keyboard; held list; offline | V-04, S-02 |
| 10 | Cart | R b · L both-b | discount; held restore; stock boundary; keyboard | V-04, S-02 |
| 11 | Checkout | R b · L both-b | Rx; discount; double submit; interruption; **Hold/Cancel (blocked by V-01)**; roles; keyboard | **V-01**, V-04 |
| 12 | SalesHistory | R b · L NR | BN; date filters; invoice modal; prior-day refund; roles; empty/error | S-02 |
| 13 | StaffSalesView | NR (sparse EN/BN) | populated events; invalid dates; Manager; long names | V-03, V-09, S-13 |
| 14 | Inventory | R b · EN-b | BN; filters; Staff view-only; CSV import; long names | S-06, S-10 |
| 15 | AddMedicine (+add-batch) | R b · L both-b | Staff receipt-less restock (T20 PARTIAL); supplier picker; keyboard; OCR prefill | – |
| 16 | OCRScan | NR (camera-denied states, EN) | BN; blocked→Settings; from both green homes; capture/OCR (not authorized) | V-08, V-12, S-08 |
| 17 | ExpiryManagement | NR | everything | S-02 |
| 18 | CreditSales | NR · EN-b | BN; search; empty; Staff credit_view | S-02 |
| 19 | CustomerCreditDetail | R b · BN-b | EN; settled tab; refund after collection; Staff; payment-sheet keyboard | V-03, V-04, S-02, S-04 |
| 20 | CashSummary | R b · L both-b | nonzero expense/supplier/withdrawal; sheets with keyboard; Manager; closed-day; error | **V-07**, V-13, S-02, S-04 |
| 21 | ExpenseTracking | NR (Free refusal held) | premium; tabs; keyboard; delete permissions | S-04 |
| 22 | EndOfDay | R b · EN-b | BN; nonzero terms; repeat-close error; print/export/share | V-02, S-07 |
| 23 | Report | R b · EN-b | BN; invalid range; export; Manager | S-07 |
| 24 | MonthlyReport | NR | everything | S-07 |
| 25 | DataExport | NR (Free boundary only) | premium export; file re-read; invalid range | S-07 |
| 26 | Suppliers | NR | create/archive validation; search; BN; empty | – |
| 27 | SupplierDetail | NR | payment (premium); archive; invoice row | V-03, S-02 |
| 28 | SupplierInvoices | NR | premium; empty/many | – |
| 29 | SupplierInvoiceCreate | NR | COD/credit; new medicine; keyboard; BN | V-04 |
| 30 | SupplierInvoiceDetail | NR | receive/return/void/payment; denials | S-02 |
| 31 | StaffManagement | NR | add/edit/disable/PIN reset/13 permissions | S-07 |
| 32 | Settings | NR | everything | S-07 |
| 33 | NotificationCenter | NR | read/unread/mark-all/routes | – |
| 34 | PrinterSettings | NR | permission-denied states; paper output blocked (no printer) | – |
| 35 | Plans | NR | Free/trial state | – |
| 36 | PlanPayment | NR | refusal/unavailable states only (B6-02 deferred) | – |
| 37 | PlanSuccess | NR | forged/no-orderId URL must say "not verified" | – |
| 38 | MultiShopManagement | NR | needs Pro fixture; Free state | – |
| 39 | NotFound | NR | unknown deep link with/without session; EN/BN | – |

## 2. Verified defects

| ID | Screens | Defect | Evidence | `D:\md` file:line | Codex diff touches file? |
|---|---|---|---|---|---|
| **V-01 (P1)** | 11 | At maximum scroll the Checkout tail sits under the fixed tab bar: SCAN overlaps "Confirm", and **Hold sale / Cancel sale cannot be reached** | `android-controlled-fefo-reviewed-confirm-button-20261110.png` (Confirm bottom ≈72 dp above screen edge) | `app/sale/checkout.tsx:541` (ScrollView only `p-4`), `:816-838`; `components/navigation/AppNavigationShell.tsx:148` (`-mt-7 h-20`), `:315-316` (bar `absolute bottom-0 h-20`) | Yes (other lines) |
| V-02 | 8, 22 | Plain counts/labels in DM Mono (rule 6) | cashier home "0" slashed zero; EOD "Counted cash:" label | `app/(tabs)/staff-home.tsx:37,247-250`; `components/staff/ManagerDashboard.tsx:45,298-301,316-319,520-523`; `app/end-of-day.tsx:96` | mixed |
| V-03 | 13, 19, 27 | Money not in DM Mono (rule 6) | staff sales, customer detail, supplier detail captures | `app/staff/sales-view.tsx:134,138,142`; `app/credit/customer-detail.tsx:109,111`; `app/suppliers/detail.tsx:357` | mixed |
| V-04 | many | Two money formatters: `useI18n().formatMoney` (Bengali digits in BN) vs `@muthoy/utils` (Latin digits, "pair with DM Mono"). Digits change screen to screen; DM Mono has no Bengali digits, so rule 6 cannot hold for Bengali-digit money. 5 files import both | ৳২.০০ (checkout BN) vs ৳4.50 (cash BN) | `state/localeStore.ts:83-92` vs `packages/utils/src/formatMoney.ts:12-19`; mixed importers: `app/inventory/batches.tsx`, `app/suppliers/purchase-create.tsx`, `components/credit/PaymentSheet.tsx`, `components/suppliers/SupplierPaymentSheet.tsx`, `components/expenses/LedgerTab.tsx` | No (pre-existing) |
| V-05 | 8 | "1 customers" — plural not handled; helper and key exist | Manager home capture | `components/staff/ManagerDashboard.tsx:311`; `i18n/display.ts:158`; `i18n/catalog.ts:417` | Yes (other lines) |
| V-06 | 8 | Raw "cash"/"credit" in recent rows, untranslated in BN | source | `app/(tabs)/staff-home.tsx:338`; `ManagerDashboard.tsx:472`; correct pattern `reports/sales-history.tsx:89,299` | mixed |
| **V-07 (P2)** | 20 (21) | Closed business day: Edit Opening / Withdraw / Reconcile / Complete Day stay live; writers refuse with DayClosedError but the UI shows the raw English message in BN, although a mapping exists | `android-claude-cash-seven-bn-top-20261110.png` + drawer with `closed_at` set | `app/cash-summary.tsx:219-240,251-270,321-329,171-173`; `components/cash/OpeningCashModal.tsx:74-77`; `WithdrawSheet.tsx:50-51`; unused mapping `i18n/display.ts:84,201` | Yes (precision lines) |
| V-08 | 16 | Camera permission / Settings failure messages hard-coded English | source | `domain/cameraPermissionState.ts:46-48,56-60` | No |
| V-09 | 13 | "-৳0.00" for zero values | staff sales capture | `app/staff/sales-view.tsx:138,142` | Yes (other lines) |
| V-10 | 7 | Sync-exposure card double margin (`m-4` inside `px-4`) — inset ≈14 dp vs siblings | home capture | `components/sync/SyncExposureStatus.tsx:30`; `app/(tabs)/dashboard.tsx:582-584` | Yes (new Codex file) |
| V-11 | 8 | Quick Access grid `w-[48%]` + `gap-2` → uneven right gutter | Manager home capture | `ManagerDashboard.tsx:407-427` | Yes (other lines) |
| V-12 | 16 / app | Java Dialog crash (see report 03) | `android-claude-round-java-crash-20261110.log` | no source line | — |
| V-13 (P1 data) | 7, 12, 13, 20, 22–24 | Owner → Staff → Owner left 0 local sales while the server is intact; screens showed wrong figures | `claude-owner-return-ledger-counts-20261110.json` | Codex's candidate repair in `sync/pull.ts`, `sync/cursorStore.ts` — local only, **not device-verified** | Yes |

## 3. Suspected — needs device confirmation

| ID | Screens | Suspicion | Basis |
|---|---|---|---|
| S-01 | shell | 3-button nav overlays tab-bar labels (no `insets.bottom`, edge-to-edge on, transparent nav bar) | `AppNavigationShell.tsx:315-316`; `android/gradle.properties:47` |
| S-02 | 9,10,12,13,17–20,27,30 | Same tail clipping as V-01 (`p-4` against an 80 dp bar + 28 dp SCAN) | the listed screens' ScrollViews |
| S-03 | all | OS dark mode: uncoloured Text and placeholder-less inputs may vanish; Alerts go dark | e.g. `sales-view.tsx:91,112`; `OpeningCashModal.tsx:135-141` |
| S-04 | 19,20,21,27,30 | Keyboard covers amount + Save in raw bottom-sheet Modals (no KeyboardAvoidingView; `BaseModal` has one) | sheet files |
| S-05 | most | Bangla in `font-sans` (no Bengali glyphs) → system fallback, not Hind Siliguri | `packages/config/tailwind/native-preset.js:90-100` |
| S-06 | 8,13,14,22 | Truncation at 360 dp in BN / large paisa | `staff-home.tsx:28-41`; `(tabs)/inventory.tsx:196-233` |
| S-07 | 7,8,15,22–25,31,32 | Raw exception text / English fallback in error states | e.g. `dashboard.tsx:140,241`; `settings.tsx:177,379,461,586`; `report.tsx:52,60` |
| S-08 | 16 / any modal | V-12 outside hot reload (modal dismissed after navigation/backgrounding) | `AppNavigationShell.tsx:255-264` |
| S-09 | 20,22 | Seven-term caption money in `font-sans` (T23-approved, conflicts with rule 6 — Founder ruling) | `cash-summary.tsx:213-215`; `end-of-day.tsx:92` |
| S-10 | 14 | 32 dp buttons / 36 dp search below 44 dp touch target | `(tabs)/inventory.tsx:202,214,228` |
| S-11 | 8 | Emoji bell and "⌗" glyph — prototype-parity call | `staff-home.tsx:230,283` |
| S-12 | 8,7,16 | Status-bar style after `/scan` → green home unverified | `AppNavigationShell.tsx:31-33,191-193` |
| S-13 | 13 | Long actor name pushes amount off-screen at 360 dp | `sales-view.tsx:108-116` |

## 4. Test catalogue

**OFF** = jsdom component test on the existing `components/scanner/MedicineTextScanner.test.tsx`
pattern. New files need adding to the explicit `include` list in the root `vitest.config.ts`, which
is approval-gated — so none were added in this round. **DEV** = the authorized DEV phone, synthetic H-5
shop, after separate approval.

| TC | Covers | Steps → expected | Mode |
|---|---|---|---|
| T01 | V-01, S-02 | every shell scroll container's bottom padding ≥ 112 dp, or last action outside the scroll | OFF |
| T02 | V-02 | StaffHome cashier: count node not `font-mono`, money nodes are | OFF |
| T03 | V-02 | ManagerDashboard + closed EOD, EN/BN: counts/labels not mono, amounts mono | OFF |
| T04 | V-03, V-09 | every money node mono; zero = "৳0.00" unsigned; refund signed | OFF |
| T05 | V-04 | BN: one digit set across Checkout and CashSummary per Founder decision | OFF |
| T06 | V-05 | 1 / 2 customers, EN and BN | OFF |
| T07 | V-06 | cash/credit/split localized; never raw | OFF |
| T08 | V-07 | closed drawer; writers throw DayClosedError → actions gated or BN label shown, never English | OFF |
| T09 | V-08 | BN scanner, permission false + openSettings rejects → Bangla strings | OFF |
| T10 | V-10, V-11 | one margin owner; flex-sized grid | OFF |
| T11 | S-07 | static ratchet: no rendered `.message` / English fallback in the 39 route files | OFF |
| T12 | S-12 | `/staff-home` → `/scan` → back: last `setBarStyle` is light-content | OFF |
| T13 | V-13 | existing `db/role-switch-rehydration.sqlite.test.ts` (passes locally; device still owed) | OFF |
| D01 | V-13 gate | read-only census → reconnect → local counts equal server census; today's opening = 0 | DEV |
| D02 | V-01, S-02 | scroll every tail; last control fully above the bar. **No Confirm/Hold tap unless writes approved** | DEV |
| D03 | all rows, L | EN then BN sweep, top + bottom of every scroll | DEV |
| D04 | S-04 | focus each money/text input; field + Save visible; **no Save tap** | DEV |
| D05 | S-03 | OS Dark (needs approval), then restore | DEV |
| D06 | S-01 | 3-button nav (needs approval), then restore | DEV |
| D07 | widths | density override ≈360 dp / ≈411 dp (needs approval) or a second device | DEV |
| D08 | 8, 16, V-12 | Manager: home EN/BN; scanner from green home ×10 incl. backgrounding; logcat watch | DEV |
| D09 | 8–11 | Cashier: home EN/BN; sale tail; denied routes show no data | DEV |
| D10 | V-13 | Owner return census unchanged from D01 | DEV |
| D11 | 37, 39 | unknown deep link; plan-success without orderId | DEV |
| D12 | offline | airplane mode on 7, 9, 12, 20, 32 (read-only) | DEV |
| D13 | premium | **BLOCKED** until an approved Pro/Ultra synthetic fixture exists | — |
| D14 | auth 2–6 | **BLOCKED** for submits (no OTP authority); render/validation only | DEV (partial) |

## 5. One-session device run plan (needs approval)

1. Preflight: freeze and record the D:\md source hash and the installed DEV APK hash; confirm package,
   Owner identity/shop, camera still denied; phone offline.
2. **D01 rehydration gate.** Stop on any count or actor/shop mismatch — every data screen is invalid
   until this passes.
3. Owner, EN, light, gesture nav, 384 dp: D03 in route order with D02 and D04 on the same visit, then
   D11, then D12 (offline last).
4. Owner, BN: repeat D03/D04.
5. D05 (dark) and D06 (3-button) — each a separately approved device-setting change, restored after.
6. D07 width overrides on the BN high-risk subset; reset.
7. D08 Manager (crash watch with `logcat -b all`).
8. D09 Cashier.
9. D10 Owner census — mirror loss must not recur.
10. Stop rules: wrong actor/shop, any ledger difference, a crash, or any unapproved write → stop and
    preserve.

Out of scope for that session unless separately approved: sales, refunds, opening cash, EOD close,
payments, premium, real OTP, camera grant/OCR, BLE paper, two-device convergence.
