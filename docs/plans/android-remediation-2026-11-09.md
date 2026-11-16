> Integration note — 2026-11-15: the approved source now lives in D:/Muthoy.
> Workspace paths, approvals, tests and restrictions below describe the historical external run.
> This phase authorizes source integration and isolated tests only; no hosted/device/credential operations.

# Android remediation implementation — 9–10 November 2026

Implementation is isolated in D:/md, branch remediation/android-metro-20261109,
baseline a23ca61262497474bf85ede78948ca831657c8db. Main D:/Muthoy and its
unrelated dirty files remain preserved. Changes are uncommitted. No production GO.

## Claude review remediation — current round

Founder approved F-01 test-only, F-05/F-06/F-11 fixture and F-08 precision scopes,
plus a single new pgtest include. A separate F-06 amendment corrected the review's
three-key premise: actual recordChange rereads complete rows and stores snake_case.
Current fixtures snapshot those rows at refund time, not after later sales/close.
The actual refund/sale/close SQLite regression and fixture tests passed 85 cases;
server/SQLite Staff grant, revocation, tenant and replay tests passed 27 cases.
T20 remains PARTIAL until Staff hosted and hardware acceptance is verified.

The amended full fixture has 96771 synthetic rows / 33 tables / 34 migrations /
31 invariants. Earlier fixture artifacts and the superseded three-key candidate
remain private evidence. Shared money validation rejects raw excess decimals while
preserving 1. and 1.00 editing; both real forms save exact integer paisa in SQLite.
F-03 adds staff-home to light status routes. F-04's reproduced scanner contrast
uses a white status strip above the black body; camera permissions/capture logic,
navigation and financial writers are unchanged in this round. A Java dialog-dismiss
exception during the earlier live refresh is retained as an open device finding;
a later settled scanner contrast/normal-close check passed on current Metro.

Full unfiltered validation, final build/browser checks and Claude independent
re-review for this round remain required. No commit/push/merge or release GO.
See [approved scopes and amendment](claude-review-remediation-2026-11-10.md).

## Prior implementation and tested baseline

- Independent history sale/movement oracle and deterministic refund, return,
  allocation, conflict and group fixtures; 97166 synthetic rows, 33 tables,
  34 migrations, 29 invariants. Authentic recovery remains a separate gate.
- Seven signed cash terms and existing refund projection; no domain formula change.
- Receipt-less inventory_edit form, separate premium Owner receipt path, parent
  shop/nondeleted guard and synchronous SQLite rollback. Seventeen other approved
  transaction boundaries now keep synchronous writes inside their transactions.
- Read-only shop-scoped pending/failed exposure; an empty queue is not a backup.
- Safe-area header, explicit editable-text palette, More icons, localization,
  decimal-string preservation, native/modal status-bar contrast and readable
  44dp Checkout quantities. Existing closed-day error now uses its bilingual label.
- Approved Next15.5.29 and compatible transitive patches, Vitest5.1.0,
  Zod4.6.6 with Zod3 unchanged, isolated short virtual store and frozen installation.
- Local Admin build and 28 actual HTTP/browser checks; hosted roles/data remain open.

The pre-review final unfiltered run passed 310 files / 7226 tests in 1662.19s,
exit 0, including the closed-day copy and More status-area corrections. Workspace
lint and types each passed 7/7. The canonical private receipt is
evidence/final-acceptance-full-unfiltered-receipt-20261110.json.
These results predate the Claude review corrections and are not a PASS for this
new round. T20 is PARTIAL pending Staff server/hardware acceptance.
No exclusions, relaxed timeouts, removed assertions or rewritten seals are allowed.

## Native runtime and Metro

Founder approved the upstream four-file [screens PR4413](https://github.com/software-mansion/react-native-screens/pull/4413)
backport to4.26.2, retaining Expo57/RN0.86.2. Frozen installed sources match the
approved candidate after pnpm line-ending normalization. Native build passed
29m53s, 672 tasks; the compiled library has the new listener symbols.

Exact separately approved Dev APK SHA256:
cd649abe5370d168c7f00f64840bf7e57cba62434fcb7a2ce99b70860dbbe6ee.
Package com.muthoy.pos.dev, arm64, Android Debug signer, SQLCipher,
allowBackup=false. Data-preserving install-r passed; encrypted session reopened.
Production/Preview version/install/update metadata remained unchanged.

Twenty authorized normal Dev cold starts were consumed. The first fixed36s
readiness probe failed; nineteen later state/PID checks passed, with no new
own crash-buffer markers in the bounded run. Debug readiness44–58s does not
pass the release performance gate. No additional cold loops are authorized.
Physical Fast Refresh showed a temporary marker while preserving a runtime
nonce; source and nonce were restored. Current JS loads through Metro, using
USB reverse8081, IPv4-first and a supported eager-bundle local workaround.
APK hash identifies native runtime; later Metro JS changes are not claimed
as embedded APK content. Every replacement APK needs exact-artifact approval.

A stale generated autolinking JSON pointed to the former dependency store.
The owned initial build was stopped; exactly that generated JSON was preserved
and removed, then regenerated against the patched D:/v package. No app-data
clear or project-wide clean. All pnpm validation sets the machine-local
virtual-store environment; no absolute store path is committed.

## Bounded H-5 synthetic acceptance

Founder-authorized DEV project btfprhticjgeihcngpif,
synthetic H-5 shop (private evidence), phone RZ8W40HDRMK.
Private Owner login and exact actor/shop/project binding were verified.
Only newly identified synthetic rows were used. Purchase, receipt-less restock,
cash/credit/split sales, FIFO collection, same-day full cash refund, actual
offline split/reconnect, fixed-ID read-time FEFO and EOD closure were exercised.

Changing only a new batch's expiry while retaining IDs/prices/stocks produced
7+1 allocation in an eight-unit,1600paisa cash sale. Null-expiry stock remained
untouched; exhausted stock was skipped. Past-date restocking was rejected before
writes in both languages; expired-stock native allocation is not thereby proved.
Final new stocks early2/late0/null1, customer balance50paisa, cash2150paisa:
0+2500+450-0-800-0-0. Counted2150 closed the day; server acknowledged the closure.
A later200paisa attempt was refused with unchanged ledgers; unsold cart was removed.
Exact IDs, before/after movements, amounts and server receipts stay in private evidence.

All47 original captured server rows retained their minimized baseline values.
Original local batch timestamp metadata already differed from server timestamps;
compare it against its earlier local receipt, not a fabricated exact metadata match.
No credential, PIN, key, token or contact export is permitted.

## Open acceptance gates

Nine detailed reports and the resume are in
D:/MuthoyAudit-20261109/implementation/. Original40task,39screen,16workflow and
sixcase identities remain intact. Source/unit checks do not earn complete
physical or hosted PASS. Required role/language/width/state/keyboard dimensions,
two-device convergence, BLE paper output, OCR packets, signed release performance,
deployed Admin and authentic C5 recovery remain open as individually recorded.

Latest advisory diagnosis: all0critical/6high/5moderate/1low; production0/4/4/1.
Unreplicated sole-copy loss remains FAIL. No independent recovery journal,
owner-factor custody or replay watermark was implemented. DEV31 versus repository37
migrations remains an open parity gate; no hosted migration or Edge deployment ran.
No paid infrastructure, Production deployment, real OTP/payment call, app clear,
uninstall, clock manipulation, bulk import or other-shop write was performed.

B6-01 licensed medicine data and B6-02 direct bKash are mandatory deferred.
iOS is unimplemented. Legacy SSLCommerz initiation stays disabled. RC, pilot
and Production acceptance remain NO GO while critical gates are open.
