# Prototype Functional Gap Audit

Date: 2026-08-21  
Mode: read-only functional audit; this file is the only change.  
Scope: Volume 12 V3, repo rules/decisions, current `apps/mobile`, and the latest `apps/prototype-web/Muthoy (prototype)` sources.

Visual mismatch is excluded. Prototype code is used only for WHAT/flow. Production SQLite/domain/auth/sync/RLS rules remain authoritative for HOW.

## Result

### 39 screens

| Status | Count |
|---|---:|
| DONE | 5 |
| PARTIAL | 18 |
| MISSING | 15 |
| SUPERSEDED | 1 |
| **Total** | **39** |

### Shared features

| Status | Count |
|---|---:|
| DONE | 2 |
| PARTIAL | 19 |
| MISSING | 13 |
| SUPERSEDED | 0 |
| **Total** | **34** |

### Combined audit

| Status | Count |
|---|---:|
| DONE | 7 |
| PARTIAL | 37 |
| MISSING | 28 |
| SUPERSEDED | 1 |
| **Total** | **73** |

`SUPERSEDED` applies to the prototype's same-device staff-picker login. Volume 12 V3 and current hardened auth require phone + PIN on a fresh device and local PIN on an enrolled device.

## 39-screen matrix

| # | Screen | Status | Prototype expectation | Current production state | Smallest next task |
|---:|---|---|---|---|---|
| 1 | Role Select | DONE | New shop, Owner login, or Staff login entry. | Three explicit entry paths exist in `app/(auth)/role-select.tsx`; role is resolved from credentials. | — |
| 2 | Registration | DONE | Shop name + phone only; start OTP registration. | RHF/Zod form sends OTP and preserves the two-field contract. DEV bypass is dev-gated. | — |
| 3 | OTP Verification | DONE | Verify/resend OTP and continue setup/recovery. | Verify, cooldown/resend, retry, device linking, interrupted-registration recovery, and hydration exist. | — |
| 4 | PIN Setup | DONE | Confirmed four-digit custom keypad; store securely. | Reusable confirmed `PinPad`; native bcrypt path; hashed persistence; session starts after save. | — |
| 5 | Owner / PIN Login | DONE | Routine login without OTP; enrolled login works offline. | Enrolled local PIN login plus fresh-device phone + PIN and Owner recovery exist. | — |
| 6 | Staff Login | SUPERSEDED | Prototype staff picker followed by PIN-only entry. | Hardened fresh-device Staff phone + PIN and enrolled-device local PIN replace the picker; deactivation/revocation are validated. | — |
| 7 | Morning Dashboard / Owner Home | PARTIAL | Owner metrics, alerts, recent activity, cash/opening context, notifications, shop switch, and quick actions. | Greeting, shop name, permission-filtered route tiles, and Switch User exist; dashboard business summaries and top-level controls do not. | Add one SQLite owner-dashboard summary query and render today's sales/count/alerts. |
| 8 | Staff Home | MISSING | Dedicated Staff landing with own sales/count/average/recent transactions, shift context, and allowed quick actions. | Staff lands on the Owner dashboard shell with tiles filtered; Volume 12 explicitly forbids this. | Add a role-routed `/staff-home` shell backed by a shop-and-user-scoped today summary query. |
| 9 | Sale Entry | PARTIAL | Permission-aware FTS search, FEFO price, scan, cart access, stock/empty/error states. | FTS5, FEFO active price, OCR lookup/auto-add, FlatList, cart count, and states exist; route-level `sales` denial is absent. | Add `sales` route guard and `AccessDenied` handling. |
| 10 | Cart | PARTIAL | Quantity/edit/remove, discounts, totals, continue sale, checkout. | Quantity/remove-by-zero, safe paisa totals, empty state, and checkout exist; no user-facing discount control. | Add a validated line-discount modal that writes `CartLine.discount`. |
| 11 | Checkout | PARTIAL | Cash, credit, split payment, customer select/create, discount, tender/change, hold/cancel, prescription context. | Atomic cash/credit FEFO checkout, customer select/create, discounts from cart, stock/cash/credit writes, and confirmation exist; split/hold/cancel/Rx UI do not. | Plan the split-payment money/credit transaction contract and tests before implementation. |
| 12 | Sales History | MISSING | Search/filter sales, transaction detail, receipt/print, and permissioned refund path. | Route and `db/reports.ts` query are explicit TODO stubs. | Implement a shop-scoped paginated sales-history read query and list/detail route first. |
| 13 | Staff Sales View | MISSING | Permissioned staff/audit sales summary with user/range/action filters. | Route is a TODO placeholder; no scoped query exists. | Add a shop-scoped, actor-authorized staff-sales summary/list query. |
| 14 | Inventory | PARTIAL | Search/filter, stock/batches, FEFO active batch, add, edit, delete/archive, batch expansion, CSV entry. | Shop-scoped list and batch detail/add exist; no search/filter, medicine edit, batch edit, or archive actions. | Add local inventory search/filter to the existing list without changing writes. |
| 15 | Add Medicine | PARTIAL | Validated medicine + first batch, OCR prefill, manufacturer/supplier selection, purchase terms. | RHF/Zod, OCR prefill, full medicine fields, batch uniqueness, ledger opening stock, and safe write exist; pickers/supplier linkage do not. | Add a reusable manufacturer picker to the existing form. |
| 16 | OCR / Scan | MISSING | Dedicated global scanning surface with repeated results/cart handoff and manual-search escape. | Native OCR modal is reused in Sale/Add Medicine, but no `/scan` route or global scan flow exists. | Add `/scan` by reusing `MedicineTextScanner` and the cart store. |
| 17 | Expiry Management | PARTIAL | Real-date grouping/filtering plus permissioned discount and supplier-return actions. | Correct shop-isolated FEFO/expiry list and statuses exist; actions and configurable window do not. | Add a permissioned per-batch discount action using the existing discount domain contract. |
| 18 | Credit Sales | PARTIAL | Search/filter/overdue customers, balances, quick collection, detail. | Customer create/list/balance and detail navigation exist; no search/overdue/quick-collection UI. | Add local name/phone search to the loaded customer list. |
| 19 | Customer Credit Detail | PARTIAL | Customer facts, unpaid/partial versus settled history, FIFO allocation detail, collection. | Atomic cash collection and combined credit/collection ledger exist; no active/settled split or allocation detail. | Split the existing ledger presentation into outstanding and settled sections. |
| 20 | Cash Summary | PARTIAL | Fixed expected-cash breakdown, opening edit, actual count/variance, withdrawal, summary sheet. | Correct fixed formula, opening cash, expense/EOD navigation, loading/error, and protected DB reads/writes exist; actual count and withdrawal do not. | Add a non-closing actual-count/variance interaction backed by an approved persistence contract. |
| 21 | Expense Tracking | PARTIAL | Quick categories/keypad, duplicate warning, ledger, analytics, delete, staff limits. | Validated category/description/amount record and current-day list exist; ledger/analytics/delete/duplicate warning/receipt capture do not. | Add month selection and a shop-scoped monthly expense list query. |
| 22 | End of Day | PARTIAL | Period summary/comparison plus daily cash close context. | Production has the safer real daily close, counted cash, variance, and immutable closed-day guard; prototype period selection/comparison is absent. | Add read-only previous-period comparison to the current close screen. |
| 23 | Reports | MISSING | Offline date-range KPIs, trends/top items/payment mix, shortcuts, multi-shop comparison where allowed. | Screen and all `db/reports.ts` totals are TODO stubs. | Implement tested shop-scoped date-range totals in `db/reports.ts`. |
| 24 | Monthly Report | MISSING | Monthly P&L/COGS/expenses, prior-month trends, CSV/XLS/print actions. | Screen and monthly query are TODO stubs. | Implement tested local monthly P&L aggregation before the screen. |
| 25 | Data Export | MISSING | Select export dataset/date/format and create/share a local file. | Screen and export function are TODO stubs. | Lock the Beta export contract from the prototype: CSV datasets and date range. |
| 26 | Suppliers | PARTIAL | Searchable supplier list, payable summaries, create, purchase entry. | Validated enriched supplier create, list/payables, detail, and purchase entry exist; search is absent. | Add local name/phone/contact search. |
| 27 | Supplier Detail | PARTIAL | Profile edit/archive, invoice/payment history, payable, record payment, create invoice. | Profile, payable, history, and new purchase exist; rows are not openable and edit/archive/payment actions are absent. | Make a purchase row open a new read-only invoice-detail route. |
| 28 | Supplier Invoices / Purchase History | MISSING | Cross-supplier invoice list with status/filter and create entry. | History exists only inside one Supplier Detail; no dedicated route/query. | Add a shop-scoped paginated purchase-history query and route. |
| 29 | Supplier Invoice Create / Purchase Create | PARTIAL | OCR/manual start, supplier/date/terms, line matching/new medicine, duplicate warning, review/confirm. | Safe multi-line COD/credit purchase, supplier/medicine selection, batch validation, ledger stock, payable/cash effects exist; OCR/new-medicine/date/duplicate/review flow is absent. | Add a review step before the existing atomic `createPurchase` call. |
| 30 | Supplier Invoice Detail | MISSING | Invoice header/lines/payments/status plus receive/void actions. | No route; purchase list query lacks line/detail read model. | Add a shop-scoped read-only purchase-detail query and screen. |
| 31 | Staff Management | PARTIAL | Roster, add, detail, activation, PIN reset, permission matrix, performance, removal/archive. | Add with phone/PIN/permissions, edit permissions, reset PIN, deactivate, stale-session protection, sync/RLS permission versions exist; no reactivate, performance, removal, or Manager assignment. | Add safe staff reactivation using the existing deactivation/auth invalidation model. |
| 32 | Settings | PARTIAL | Shop/account, thresholds, notifications, tax/report choices, language, printer, backup/security, plan, logout. | Only secure change-own-PIN is surfaced; profile DB functions exist but are not wired. | Wire shop profile read/edit with `getShopProfile`/`updateShopProfile`. |
| 33 | Notification Center | PARTIAL | Severity/unread states, mark one/all read, action navigation, empty/error/loading. | Offline history, severity cards, unread badges, mark-one-read, pull-to-refresh, empty/error, low-stock/expiry/cash/sync creation exist; mark-all/action routing absent. | Add a shop/user-scoped `markAllAsRead` DB action and header control. |
| 34 | Printer Settings | MISSING | Pair/re-pair/unpair BLE ESC/POS printer and print a test receipt with errors. | TODO placeholder only; no native printer wrapper. | Confirm supported printer protocol/hardware and write the native-wrapper plan. |
| 35 | Plans | MISSING | Current Free/Pro/Ultra/trial state, monthly/yearly comparison, feature/limit table, upgrade entry. | TODO screen, `PlanBadge`, `PremiumGate`, and `usePlan`; subscription schema/sync substrate exists. | Implement a local read-only `usePlan`/plan selector from shop + subscription rows. |
| 36 | Plan Payment | MISSING | Selected plan/term, bKash or SSLCommerz, processing/failure, server-confirmed activation. | TODO placeholder; no payment Edge Function/webhook flow. | Define the server-owned payment initiation/callback/webhook contract. |
| 37 | Plan Success | MISSING | Confirm activated plan and return Home. | No production route/file. | Add the route only after server-confirmed subscription state can be read locally. |
| 38 | Multi-Shop Management | MISSING | Owner all-shop summary; add/rename/archive/restore/switch; enforce plan limits and isolation. | Schema and sync are shop-scoped, but no active-shop registry/switcher/management surface exists. | Plan active-shop session switching and sync teardown/start invariants before UI. |
| 39 | Not Found / route fallback | MISSING | Friendly fallback with Back/Home actions inside and outside auth shell. | No Expo Router `+not-found.tsx`. | Add `app/+not-found.tsx` with Back and root actions. |

## Shared-feature matrix

| Shared feature | Status | Current production state | Smallest next task |
|---|---|---|---|
| Main layout / app shell | PARTIAL | Root Stack, three-tab shell, auth gate, notification/sync bootstrap exist; role-aware global shell is incomplete. | Create one role-aware shell contract for tabs, More, Scan, lock, and global controls. |
| Standard headers | PARTIAL | Reusable header exists and many operational screens use it; language control and several routes are missing. | Add language-control slot after the i18n store exists. |
| Bottom navigation | PARTIAL | Dashboard/Sale/Inventory tabs exist; no role-driven tab set, center Scan, or More. | Replace static tab declarations with permission/role-derived tab options. |
| Elevated center Scan action | MISSING | Scanner exists only as screen-local modal buttons. | Add a center tab action targeting `/scan`. |
| More surface | MISSING | Secondary navigation is a long Dashboard tile list. | Add a permission-filtered More sheet fed by one route registry. |
| Global Bangla / English toggle | MISSING | Bangla font is loaded, but no locale store, translations, persistence, or toggle exists. | Add a persisted `bn`/`en` locale store plus a `t(bn,en)` helper. |
| Logout confirmation | PARTIAL | Dashboard Switch User uses a native confirmation alert; Settings logout and reusable confirmation are absent. | Extract the existing confirmation into a reusable lock/logout action. |
| Staff logout / lock behavior | PARTIAL | Switch User clears session/cart and returns through root gate; it is reachable only from Dashboard. | Put Lock/Switch User in the shared shell for every role. |
| Shop switcher sheet | MISSING | No active-shop UI/session-switch operation. | Build only after active-shop switching invariants are approved. |
| Add staff modal/flow | DONE | Validated name/phone, permissions, confirmed PIN, secure hash, duplicate checks, transaction, sync, and progress exist. | — |
| Reset staff PIN modal/flow | DONE | Confirmed keypad, secure reset, auth invalidation, audit/sync protection exist. | — |
| Staff detail sheet | PARTIAL | Roster rows expose permissions/reset/deactivate actions, but no unified detail surface or reactivation/removal. | Open existing actions from one staff-detail sheet/screen. |
| Staff active/deactivated handling | PARTIAL | Deactivation blocks login/writes and stale claims; no reactivate UI. | Add the reactivation action and test stale-device behavior. |
| Manager behavior | MISSING | `manager` is deliberately denied and cannot log in; prototype defines a Manager dashboard/role. | Design the Manager grant defaults and session/RLS mapping before enabling login. |
| Permission controls | PARTIAL | Per-staff overrides are enforced in UI, SQLite actions, sync claims, and server authorization; prototype vocabulary/Manager mapping and some route guards remain incomplete. | Publish one prototype-to-production permission-key map and cover every route. |
| Add/Edit Medicine flow | PARTIAL | Add is complete; edit/archive is absent. | Add a validated medicine-metadata edit action that does not mutate stock. |
| Add/Edit Batch flow | PARTIAL | Add batch is complete; edit is absent and stock must remain ledger-derived. | Plan an edit contract separating metadata/price from stock adjustment. |
| Manufacturer picker | MISSING | Manufacturer is free text. | Add a reusable local picker with free-text fallback. |
| Supplier picker | PARTIAL | Purchase Create selects existing suppliers; Add Medicine has no supplier/purchase association picker. | Extract the Purchase supplier selector into a reusable component. |
| CSV import | MISSING | No parser, preview, validation, or atomic import path. | Define and validate one CSV row schema with preview-only parsing first. |
| Discount modal | MISSING | Discount domain and persisted line fields exist; no control sets a discount. | Add a cart line discount modal. |
| Cash cards/modals | PARTIAL | Expected-cash cards and opening input exist inline; no actual-count/withdrawal/previous-day sheets. | Extract the opening-cash interaction into a reusable modal/sheet. |
| Notification cards/states | PARTIAL | Severity cards, unread state, empty/error, background rules and OS delivery exist; action routes and mark-all are absent. | Add action-route metadata handling for existing notification types. |
| Plan badge | MISSING | File is a visible TODO stub. | Implement after local plan state read exists. |
| Trial banner | MISSING | Trial columns exist; no banner/countdown/expiry state. | Add a pure trial-state resolver from `trialEndsAt` and current time. |
| Premium lock / gate | MISSING | Component is a visible TODO stub; creation limits are not surfaced/enforced. | Define server/DB-authoritative feature and creation-limit rules per tier. |
| Form sheets/modals | PARTIAL | Scanner modal, Alerts, and inline forms exist; no reusable native sheet/base modal pattern. | Create one accessible bottom-sheet/base-modal primitive. |
| Skeletons | MISSING | Loading is text/spinner only. | Add one shared list-card skeleton primitive. |
| Toasts | MISSING | Success/error feedback uses inline text or Alerts. | Add one shared transient toast host/API. |
| Empty states | PARTIAL | Shared `EmptyState` is used on core lists; many screens use ad-hoc text or TODO placeholders. | Replace one repeated ad-hoc empty list with `EmptyState`, then reuse. |
| Error / retry states | PARTIAL | Startup retry and many inline errors exist; several list loads lack retry actions. | Add retry to the shared `EmptyState`/error-state contract. |
| Loading states | PARTIAL | Auth/submit/search/startup progress exists; most SQLite list loads initially resemble empty data. | Add explicit first-load state to the shared list-screen pattern. |
| Virtualized long lists | PARTIAL | Sale, Inventory, Expiry, Notifications, and Cart use FlatList; credit/supplier/staff/history surfaces use ScrollView/maps. | Convert the first potentially unbounded credit list to FlatList. |
| Keyboard / safe-area behavior | PARTIAL | Some ScrollViews preserve taps; no consistent SafeArea/KeyboardAvoiding shell is used. | Add safe-area and keyboard avoidance to the shared authenticated shell. |

## Evidence highlights

- Strong production foundations already present: SQLite-only screen reads, FEFO domain logic, integer-paisa money, cash close/closed-day guards, inventory movement ledger, atomic credit/purchase/sale writes, native PIN crypto, device auth, sync/hydration, stale-session protection, per-staff permissions, notification scheduling, and shop-scoped DB queries.
- Explicit production placeholders: `app/reports/*`, `db/reports.ts`, `app/staff/sales-view.tsx`, `app/settings/plans.tsx`, `app/settings/plan-payment.tsx`, `app/settings/printer-settings.tsx`, `PlanBadge.tsx`, `PremiumGate.tsx`, and `usePlan.ts`.
- Missing production routes: Staff Home, dedicated Scan, Supplier Invoice list/detail, Plan Success, Multi-Shop, and Not Found.
- No visual-only difference affected a status.
- No runtime/device claims were made. This is static functional evidence only.

## Top remaining blockers

1. No dedicated Staff Home; Manager is intentionally denied; role navigation is not prototype-complete.
2. No global language system, center Scan action, More surface, or shop switcher.
3. Reports, sales history, monthly P&L, export, and printer are stubs/missing.
4. Plans/trial/premium/payment and multi-shop have schema hints but no production product flow or authoritative limit enforcement.
5. Money/stock-sensitive prototype flows still lack production contracts: split payment, refund/return, batch edit/adjustment, supplier payment/void, and cash withdrawal/actual count.
6. Prototype commercial limit conflict: `SCREENS.md` says Pro allows 2 shops; latest `Plans.tsx` says 3. Resolve before plan or multi-shop enforcement.

## Next implementation group

**Volume 12 Phase B1 — Navigation + role/platform completeness**

First bounded slice:

1. Dedicated Staff Home + role routing.
2. Manager permission/session/RLS design.
3. Global Bangla/English store and toggle.
4. Role/permission-driven bottom navigation, center Scan, and More.
5. Shared Lock/Switch User, headers, safe-area/loading/error shell.

Do not start final visual parity yet.
