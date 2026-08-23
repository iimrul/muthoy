# Phase B3 — Customer / Supplier / Finance Completeness (Exact Prototype Parity)

Date: 2026-08-22
Mode: read-only audit + plan. No implementation, commit, deploy, or remote migration execution.
Source rule: the **latest prototype** (`apps/prototype-web/Muthoy (prototype)/src/app`) is the complete B3 product/function source of truth. The **current production architecture** (`apps/mobile`, `backend/supabase`) is the safe implementation source of truth (CLAUDE.md rule 15).

Scope boundary (Volume 3 §12 "B3. Customer / supplier / finance completeness"): credit/customer details, supplier invoice flows, purchases, cash/expenses/EOD, reports/monthly report, export, printer settings — plus the Settings rows and the Tax/VAT and Credit-Period contracts that `phase-b1-navigation-roles.md` and `phase-b2-sales-inventory.md` explicitly deferred to B3.

Explicitly excluded (stated once, enforced throughout): B4 plans/trial/premium gating/payment/multi-shop and shop switching; the Admin Panel and any location surface; Phase-C visual polish. Where a prototype B3 screen contains a B4 block, the block is named and excluded rather than silently dropped.

**Update — 2026-08-22:** Founder decisions D-1…D-11 (§9) are now locked. Also locked: (1) one business-date definition for every money read/write — **Asia/Dhaka**, regardless of device timezone (resolves W-1/B-1); (2) the route-rule/data-layer permission-key fix stays scoped to Group 1 (resolves W-2/B-5); (3) every prototype-visible B3 feature ships unless this plan explicitly marks it SUPERSEDED (§4) or a founder decision names a visible-behavior change (D-1, D-9) — now a founder-confirmed constraint, not a drafting assumption. No implementation has occurred; this remains a plan document (CLAUDE.md rule 10).

---

## 1. PROTOTYPE B3 INVENTORY

Every screen, section, modal, sheet, card, filter, action, setting, empty/loading/error state, navigation path, and interaction found by direct inspection. Nothing here is omitted; each item is graded in §2.

### 1.1 Credit Sales — `screens/CreditSales.tsx` → `/app/credit`

| # | Prototype element | Behavior |
|---|---|---|
| CS-1 | `StandardHeader` "বাকি বিক্রয় / Credit Sales" | Standard back/title chrome |
| CS-2 | Header-right Sync button | `RefreshCw`, spin class while syncing, 1500 ms simulated delay, reload, `lastSynced` dot, tooltip "Last synced: HH:MM:SS" |
| CS-3 | Total Outstanding card | `৳ sum(customer.amount)`, money font, plus `N customers` line |
| CS-4 | Search bar | Filters on `name`, `nameEn`, `phone` (substring), `id.toString()` |
| CS-5 | Customer card — identity | `name` (bn) / `nameEn` (en), phone in money font, `Last Transaction: {lastDate}` |
| CS-6 | Customer card — "Sold by" | Derived: `customer.lastTransactionId` → `transactions[id].staffName`; rendered only when resolvable |
| CS-7 | Customer card — balance | `৳ amount`, colored green when `0`, black otherwise |
| CS-8 | Settled pill | `CheckCircle` + "পরিশোধিত / Settled" when `amount === 0` |
| CS-9 | Overdue badge | Red "মেয়াদোত্তীর্ণ / Overdue" when `customer.overdue` is truthy |
| CS-10 | "Make Payment" button | Rendered only when `amount > 0`; opens CS-12 |
| CS-11 | "View Details" button | Always rendered; → `/app/credit/{id}` |
| CS-12 | Payment modal | Header + X close; customer block (name, phone, Total Outstanding in red); amount `<Input type=number max=amount min=0>`; quick buttons **Half / Full / Clear**; footer Cancel + "Confirm Payment" (disabled when empty or `<= 0`) |
| CS-13 | Payment validation | `alert("Please enter a valid amount")` when `NaN`, `<= 0`, or `> amount` |
| CS-14 | FIFO allocation | Collects that customer's unpaid/partial credit transactions sorted **oldest-first**, allocates `min(remaining, txnDue)` per transaction, marks each `settled` or `partial` |
| CS-15 | Writes on payment | `transactions` (updated), `lastPaymentAllocation`, `settledCreditHistory` (id, customerId/name/nameEn/phone, purchaseId, settlementDate, settlementTimestamp, amount, `paymentMethod:"cash"`, `referenceId: REF-{ts}`, staffName, `syncStatus:"local"`, allocations), `creditData` (amount, lastDate, lastPaymentDate, `hasSettledHistory`) |
| CS-16 | Cash coupling | `notifyCashUpdated()` after writing settled history |
| CS-17 | Zero-balance retention | Customer stays in the list at `amount === 0` (comment: "KEEP customer in list even if balance is zero") |
| CS-18 | Empty state | "কো বাকি গ্রাহক নেই / No credit customers yet" + "Make credit sales from checkout" |
| CS-19 | Permission guard | `!isOwner && !hasPermission("credit_view")` → `replace('/app/staff-home')`, deferred via `queueMicrotask` |
| CS-20 | Fresh-shop seeding | No seed customers; writes `{customers: []}` when key absent |
| CS-21 | Active-shop reload | `useActiveShopReload(loadCreditData)` |

### 1.2 Customer Credit Detail — `screens/CustomerCreditDetail.tsx` → `/app/credit/:customerId`

| # | Prototype element | Behavior |
|---|---|---|
| CD-1 | Header | Customer name (bn/en) |
| CD-2 | Customer info card | Name, phone (`Phone` icon), `ID: {id}` (`User` icon), Total Due in red |
| CD-3 | Two tiles | **Total Purchases** (count of all credit-related txns), **Settled** (count of settled) |
| CD-4 | View-mode tabs | **Purchase History** \| **Settled History** |
| CD-5 | Status filter (purchases view only) | `<select>` All Status / Unpaid / Partial |
| CD-6 | Purchase list rule | Only `status !== "settled"`, sorted newest-first by timestamp |
| CD-7 | Settled list rule | Only `status === "settled" && amountDue === 0`, newest-first; partial payments never appear here |
| CD-8 | Purchase card | `#id`, status badge (Settled green / Partial amber / Unpaid red), sync indicator (`CheckCircle` when `syncStatus==="synced"`, grey dot otherwise), `Clock` + relative date (`Today`/`Yesterday`/localized date) + time, amount |
| CD-9 | Items summary | First 2 items (`nameBn`/`name` + `Nx`), then "+N more" |
| CD-10 | Payment status block | For partial/settled: `Paid:` (green) and `Due:` (amber, only when `> 0`) |
| CD-11 | Settled card | Gradient card, `CheckCircle` + "Settlement Complete", `#id`, sync dot, date/time, amount; items summary; payment summary rows Total Amount / Paid / Due |
| CD-12 | Empty — purchases | `Receipt` icon + "No purchase history found" |
| CD-13 | Empty — settled | `CheckCircle` icon + "No settled history" |
| CD-14 | Status derivation | `creditPaid` → settled; `isPartialPayment` → partial (auto-promoted to settled when remaining is 0); `isCreditSale && !creditPaid` → unpaid |
| CD-15 | Not-found fallback | Renders an `Unknown / N/A / 0` customer rather than an error state |

### 1.3 Cash Summary — `screens/CashSummary.tsx` → `/app/cash-summary`

| # | Prototype element | Behavior |
|---|---|---|
| CH-1 | Header | "নগদ সারসংক্ষেপ / Cash Summary" |
| CH-2 | Hero card | "Expected in drawer today" + `৳ expected` + inline formula string: `Open X + Sales Y (+ Collected Z) (− Exp E) (− W/d W)` — conditional terms only when non-zero |
| CH-3 | Quick action — Edit Opening | Opens `OpeningCashModal` in `editMode`; refreshes on close |
| CH-4 | Quick action — Withdraw | Opens the withdrawal bottom sheet |
| CH-5 | Breakdown sheet (`CashSummarySheet`) | Rows: Opening Cash (neutral); Cash Sales (in); Credit Collections (in, expandable); Expenses (out, expandable); Withdrawals (out); Supplier Payments (out, rendered **only when `> 0`**); footer "Expected in Drawer" |
| CH-6 | Cash Sales seller split | When staff/owner split data exists, Cash Sales renders as a grouped card: Owner sub-row (`Crown`), Staff sub-row (`User`, count, expand chevron), per-staff expansion rows (name, `৳ totalSales · txnCount`) |
| CH-7 | Credit Collections detail rows | Per settled record today: customer name + amount |
| CH-8 | Expenses detail rows | Per expense today: `category` or `category — note` + amount |
| CH-9 | Sign prefixes | `+` on "in" rows, `−` on "out" rows, only when value `> 0` |
| CH-10 | Actual count section | `Wallet` icon + "আজ ড্রয়ারে আসলে কত টাকা আছে? / How much cash is actually in the drawer?" + helper text + `৳` numeric input |
| CH-11 | Reconcile button | Disabled while input empty; saves actual, recomputes summary, shows toast |
| CH-12 | Difference card | `match` (green) "Matches — no difference"; `surplus` (amber) `৳X more (surplus)`; `shortage` (red) `৳X less (shortage)`; sub-line "Counted: ৳A · Expected: ৳B"; hidden while status is `unknown` |
| CH-13 | Saved toast | "সংরক্ষণ হয়েছে / Saved" with `CheckCircle2`, auto-dismiss 1800 ms |
| CH-14 | Withdrawal sheet | "How much are you withdrawing?" + hint "e.g. bank deposit or personal use." + `৳` amount input + optional note input + Cancel / Save (disabled unless `> 0`); backdrop-dismiss |
| CH-15 | Live refresh | `CASH_UPDATED_EVENT` + `window focus` listeners |
| CH-16 | `OpeningCashModal` | Quick chips **500 / 1000 / 2000 / 5000** (active state), manual `৳` input, "Save Opening Cash" (disabled unless `> 0`), always-visible Cancel; drag handle; resets input on open |
| CH-17 | `ExpectedCashCard` (dashboard widget) | Compact card: label, `Details ›` → `/app/cash-summary`, `৳ expected`, formula caption, inline **`set`** link when `openingCash === 0`; refreshes on cash event, storage, focus, `activeShopChanged`, and an 8 s interval |
| CH-18 | `PreviousDaySummaryModal` | Green header "YESTERDAY SUMMARY" + full date + `৳ total` + trend vs the day before (`TrendingUp/Down`, `N% more/less`); 2×2 grid Cash Sales / Credit Sales / Transactions / Avg Sale; divider; "Top Sold" top-3 (rank chip, name, qty + unit) with "No sales yesterday." empty state; Close button |
| CH-19 | Day-rollover service | `lastSeenCashDay` key; `checkDayRollover()` returns the previous day key when `lastSeen < today`, `null` on first run or same day; `markTodayAsSeen()` |
| CH-20 | Cash formula (prototype) | `expected = opening + cashSales + creditCollections − expenses − withdrawals − supplierPayments` |
| CH-21 | Opening-cash store | `cashOpening: {YYYY-MM-DD: number}`, per-day, `null` when unset |
| CH-22 | Actual-count store | `cashActualCounts: {YYYY-MM-DD: number}`; `getDifference` treats `|diff| < 0.5` as `match` |
| CH-23 | Supplier-payment term | Sums `supplierInvoices[].payments[]` whose `date === today` |

### 1.4 Expenses — `screens/ExpenseTracking.tsx` → `/app/expense`

| # | Prototype element | Behavior |
|---|---|---|
| EX-1 | Header | "খরচ / Expenses" + right chip `Save` icon + "লোকাল সেভ / Local Save" |
| EX-2 | Persistent summary strip | Rendered only when `canViewTotals` (`isOwner \|\| hasPermission("reports")`): **This Month** total, **Today** total, **Entries** count |
| EX-3 | View tabs | **Quick Log** \| **Ledger** \| **Analytics** (Analytics hidden unless `canViewTotals`) |
| EX-4 | Category selector | 5 circular buttons: **Rent** (`Home`), **Salary** (`Briefcase`), **Utilities** (`Zap`), **Conveyance** (`Car`), **Other** (`MoreHorizontal`); bn/en labels; selected state scales and inverts colors; 48 px min target |
| EX-5 | Amount display card | `৳ {amount \|\| "0"}` in money font + clear `X` when non-empty |
| EX-6 | Staff limit warning | When `expenseLimit < Infinity` and amount exceeds it: `AlertTriangle` + "সীমা অতিক্রম করেছে / Exceeds limit" |
| EX-7 | Numeric keypad | 3-col grid `1..9`, `.`, `0`, `⌫`; single-decimal guard; leading-zero replacement |
| EX-8 | Optional note | Free-text input "বিস্তারিত যোগ করুন / Add details" |
| EX-9 | Log Expense button | Disabled when empty, `<= 0`, or over the staff limit |
| EX-10 | Category default | Saving with no category selected defaults to **Other** |
| EX-11 | Duplicate detection | Same `category` + same `amount` + same calendar day → modal "সদৃশ খরচ সনাক্ত / Duplicate Detected" with the previous expense shown, **Cancel** / **Log Anyway** |
| EX-12 | Success banner | Inline "খরচ সংরক্ষিত হয়েছে / Expense saved" with a 2000 ms keyframe fade; form resets |
| EX-13 | Ledger — month navigator | `ChevronLeft` / `ChevronRight`, localized `Month YYYY` label, **next disabled on the current month** |
| EX-14 | Ledger — month total | Right-aligned "মোট / Total: ৳X" |
| EX-15 | Ledger — grouping | Grouped by calendar day, newest day first; day header with **Today / Yesterday / D MMM** and that day's sum |
| EX-16 | Ledger — expense row | Category icon in a circle, category label (bn/en), `loggedBy`, note (truncated), `৳ amount` in red |
| EX-17 | Ledger — delete | Trash button → inline confirm ("মুছবেন? / Delete?" + check + X) |
| EX-18 | Ledger — empty | `Banknote` icon + "কোনো খরচ নেই / No expenses yet" |
| EX-19 | Analytics — Monthly Trend | This-month total, MoM `±N.N%` (red when up, green when down), "Last month: ৳X" |
| EX-20 | Analytics — By Category | Top 5 categories by amount: icon, label, `%`, `৳`, gradient progress bar |
| EX-21 | Analytics — Summary Stats | **Total Expenses** (+ entry count) and **Avg. Expense** |
| EX-22 | Expense record shape | `id, category, amount, date, timestamp, note?, supplier?, loggedBy` |
| EX-23 | Cash coupling | `notifyCashUpdated()` on both save and delete |
| EX-24 | Staff spend cap | `expenseLimit = isStaff ? 500 : Infinity` |
| EX-25 | Active-shop reload | `useActiveShopReload(loadExpenses)` |

### 1.5 End of Day — `screens/EndOfDay.tsx` → `/app/end-of-day`

Prototype title is **"বিক্রয় রিপোর্ট / Sales Report"** — it is a date-range P&L view, not a day-locking workflow.

| # | Prototype element | Behavior |
|---|---|---|
| EOD-1 | Header | "Sales Report" + LanguageToggle + Sync (tick-based re-render) |
| EOD-2 | "Today so far" chip | `Clock` + "আজ পর্যন্ত / Today so far" when today is inside the range **and** the local hour `< closingTimeHour` (from `appSettings`, default 20) |
| EOD-3 | Date range card | Start (`max=endDate`) and End (`min=startDate`, `max=today`) date inputs + "N Day Report" caption |
| EOD-4 | Hero | "মোট বিক্রয় / Total Sales" `৳ netSales` + trend line: "N% more/less than previous period" or "No previous period data" |
| EOD-5 | Previous-period comparison | Equal-length window ending the day before `startDate` |
| EOD-6 | Metrics grid | **Transactions** (count), **Average Sale** |
| EOD-7 | Expected cash card | 1-day range → full cash service `expected`, caption "Opening + Cash Sales + Collections − Expenses − Withdrawals"; multi-day → sum of cash + split-paid amounts, caption "Direct cash and split payments" |
| EOD-8 | Outstanding credit card | Total across all customers + caption |
| EOD-9 | Estimated Net Profit card | `netSales − COGS − expenses`, with a "(partial COGS)" marker when any line lacks a captured cost |
| EOD-10 | COGS card | Rendered only when `cogs > 0`; shows COGS and, when present, "Other expenses: ৳X" |
| EOD-11 | Export row | Three buttons **Print / Export / Share** — **no `onClick` handlers in the prototype** |
| EOD-12 | Permission guard | `cash_drawer`, else → `/app/staff-home` |
| EOD-13 | Active-shop reload | `useActiveShopReload(handleSync)` |

### 1.6 Report — `screens/Report.tsx` → `/app/report`

| # | Prototype element | Behavior |
|---|---|---|
| RP-1 | Header | "রিপোর্ট / Report" + **Download** (CSV) + **Share** icon buttons |
| RP-2 | Report Period card | Presets **Today / Yesterday / Week (last 7 d) / Month (last 30 d)** + Start/End date inputs |
| RP-3 | Hero band | Total Sales + `↑/↓ N%` pill vs the previous equal-length period; 3-up grid **Transactions / Avg Sale / Profit** |
| RP-4 | Profit figure | `estimatedProfit = round(totalSales × 0.26)` — a flat 26 % margin, not COGS |
| RP-5 | Sales Trend | Hand-rolled SVG sparkline: area fill, polyline, hover points (r 3→5), dashed hover guide, `৳value` tooltip, adaptive x-axis labels; empty "কোনো ডাটা নেই / No data available" |
| RP-6 | Payment Breakdown | Hand-rolled SVG donut, Cash (`#059669`) vs Credit (`#D97706`), zero-value series filtered out, legend with values; empty "No data" |
| RP-7 | Cash/credit derivation | Prefers `originalPaidAmount` / `originalCreditAmount`; else `cash`→total, `split`→`partialPaidAmount` / `partialRemainingAmount`, `credit`→total |
| RP-8 | Top Medicines | Top 5 by revenue: rank chip, name, `qty units · ৳revenue`; empty "No data" |
| RP-9 | Download CSV | Header `Date,Time,Total,Discount,Payment Type,Items`, one row per transaction, then a `Summary` block (Total Sales, Total Transactions, Average Sale, Cash Sales, Credit Sales, Total Discount, Estimated Profit); filename `sales-report-{start}-to-{end}.csv`; `alert("No data to download")` when empty |
| RP-10 | Share | `navigator.share` with a formatted emoji summary; clipboard fallback + "Report copied to clipboard!"; `alert("No data to share")` when empty |
| RP-11 | Permission guard | `reports`, else → `/app/staff-home` |
| RP-12 | Refresh triggers | `visibilitychange`, `focus`, `storage` (`transactions` / `creditData`), `useActiveShopReload` |
| RP-13 | **Multi-Shop Comparison block** | Comparison date + Today/Yesterday presets, grand total, horizontal bar race, side-by-side stat cards with trophy/rank, winner callout — **B4, excluded from B3** |

### 1.7 Monthly Report — `screens/MonthlyReport.tsx` → `/app/monthly-report`

| # | Prototype element | Behavior |
|---|---|---|
| MR-1 | Header | "মাসিক রিপোর্ট / Monthly Report" + gear toggling the costing panel |
| MR-2 | Month cursor | Prev/next chevrons + localized `MonthName YYYY` (Bangla month table) |
| MR-3 | Costing panel | Info line "changes apply only to future data; historical entries are not recomputed"; **FIFO** \| **ভারিত গড় (WAC)** buttons persisted to `reportSettings.costingMethod` |
| MR-4 | Empty state | "এই মাসে কোনো বিক্রয় নেই / No sales recorded this month" when `txnCount === 0` |
| MR-5 | Net Profit hero | Green gradient for profit, **red gradient + "Net Loss" + `TrendingDown`** when negative; month label + txn count |
| MR-6 | Partial-COGS warning | Amber card listing the first 5 medicines with no purchase price, then `…` |
| MR-7 | No-expenses info card | Blue card "No expenses recorded — showing gross profit." + inline **"Add expenses"** link → `/app/expense` |
| MR-8 | P&L statement | `Total Sales Revenue` → `− Total Discounts` → `= Net Sales Revenue` → `− COGS` → `= Gross Profit` → `− Operating Expenses` (+ indented per-category lines) → `= Net Profit / Net Loss`, with rule dividers and a strong divider before the net line |
| MR-9 | 6-Month Trend | Recharts grouped bars: Net Sales (`#A7F3D0`) and Net Profit (`#059669`) over the trailing 6 months, `৳` tooltip, legend |
| MR-10 | Expense by Category | This vs last month per category (Rent/Salary/Utilities/Conveyance/Other) with `±N%` delta and a bar; rendered only when expenses exist |
| MR-11 | Actions row | **Print** (ESC/POS) \| **CSV** \| **Excel** — each with a loading state |
| MR-12 | Print payload | `buildReceipt` rows: Total Sales, Discounts, **Net Sales (bold)**, `Tax/VAT` (only when `totalTax > 0`), COGS, **Gross Profit (bold)**, Expenses, **Net Profit (bold)**; shop name from `currentUser.shopName`/`shopNameEn`; title `Monthly P&L — {month}` |
| MR-13 | Print error handling | Localized map for `out-of-paper`, `out-of-range`, `disconnected`, `send-failed`, `no-device`, `unsupported`, `unknown`; red banner + **Retry** |
| MR-14 | Export rows | Item/Amount table incl. `Tax/VAT Collected` when `> 0`, per-category expense lines, and Net Profit; filename `pnl-{start}-to-{end}` |
| MR-15 | Export delivery | `shareBlob` (Web Share with files) first, download fallback |
| MR-16 | Active-shop reload | `useActiveShopReload(reload)` |

### 1.8 Data Export — `screens/DataExport.tsx` → `/app/export`

| # | Prototype element | Behavior |
|---|---|---|
| DE-1 | Header | "ডেটা এক্সপোর্ট / Data Export" |
| DE-2 | Date range card | Start (default `today − 29 d`) / End (default today), each bounded by the other |
| DE-3 | Dataset multi-select | **Sales Records** (`ShoppingBag`), **Inventory Data** (`Package`), **Credit Records** (`CreditCard`), **Expense Records** (`Receipt`); each with its own tint/bg; Sales pre-selected |
| DE-4 | Format toggle | **CSV** \| **Excel (.xls)** |
| DE-5 | Sales columns | `Date, Time, Total, Discount, PaymentType, Items` (items joined `name xQty`) |
| DE-6 | Inventory columns | `ID, Name, Barcode, RxRequired, Stock, PurchasePrice, SalePrice`; stock summed from batches with a flat fallback |
| DE-7 | Credit columns | `CustomerName, Phone, Outstanding, DueDate` |
| DE-8 | Expense columns | `Date, Category, Amount, Note` |
| DE-9 | Offline pre-check | `!navigator.onLine` → amber `WifiOff` banner "Offline — internet connection required for share/download", **no export attempt** |
| DE-10 | Progress card | Spinner + "Exporting…" + `N%` + gradient bar; 120 ms artificial step per dataset |
| DE-11 | Result banner | Green `CheckCircle2` "Shared successfully" / "Download complete", amber for the offline case |
| DE-12 | Primary button | "Export & Share" when `navigator.share` exists, else "Export & Download"; disabled while busy or with zero datasets selected |
| DE-13 | Multi-dataset delivery | Builds a blob per dataset but only shares the **first**; the rest rely on the download side effect |
| DE-14 | Date filtering | Applies to Sales and Expenses only; Inventory and Credit export in full |

### 1.9 Suppliers — `screens/Suppliers.tsx` → `/app/suppliers`

| # | Prototype element | Behavior |
|---|---|---|
| SU-1 | Header | "সরবরাহকারী / Suppliers" |
| SU-2 | Search | Name or phone substring |
| SU-3 | Supplier card | Truck avatar; name; manufacturer (green); phone with `Phone` icon or `—`; stats row: `Inv: N`, `৳ totalPurchase`, `lastPurchaseDate`, and `৳X due` in bold red when `outstanding > 0` |
| SU-4 | Card tap | → `/app/suppliers/{id}` |
| SU-5 | Row action — Invoice | → `/app/invoices/new` carrying `{supplierId, supplierName}` |
| SU-6 | Row action — Edit | Opens the edit modal |
| SU-7 | FAB | `+` → Add Supplier modal |
| SU-8 | Add modal fields | Name; Phone with fixed **`+880`** prefix, digits-only, `maxLength 10`, placeholder `1XXX XXX XXX`; `ManufacturerPicker`; Notes (optional) |
| SU-9 | Add validation | "Name required" / "Phone required"; duplicate (same normalized name **and** phone, non-archived) → "Supplier already exists" |
| SU-10 | Add success | Saves, closes, refreshes, **navigates to the new supplier's detail** |
| SU-11 | Edit modal | Name, Phone (same +880 control), ManufacturerPicker, Notes; same required-field errors |
| SU-12 | Empty state | `Truck` icon + "কোনো সরবরাহকারী নেই / No suppliers yet" + "Add a supplier to get started" |
| SU-13 | Sort + filter | Archived excluded; sorted by `lastPurchaseDate` descending |
| SU-14 | Refresh triggers | `storage` events on `suppliers`/`supplierInvoices`; `useActiveShopReload` |

### 1.10 Supplier Detail — `screens/SupplierDetail.tsx` → `/app/suppliers/:id`

| # | Prototype element | Behavior |
|---|---|---|
| SD-1 | Header | Supplier name, back → `/app/suppliers`, right pencil → edit modal |
| SD-2 | Profile card | Avatar, name, manufacturer, phone, notes |
| SD-3 | Stat tiles | **Total Purchase**; **Outstanding** (red when `> 0`); **Invoices** count; **This Month** `৳X (+N%)` vs last month, tinted by delta sign |
| SD-4 | Last purchase line | "সর্বশেষ ক্রয় / Last purchase: {date}" or `—` |
| SD-5 | Actions | **New Invoice** (carries supplier preset) \| **Archive** (`confirm()` → archive → back to list) |
| SD-6 | Invoice History | Per invoice: date as a blue link → `/app/invoices/{id}`; expand chevron when payments exist; status pill **Paid** / **Partial** / **Pending**; stock-addition italic label (`{matchedName} Stock`) for `manualBatchEntry`; `N items`; `৳ total` |
| SD-7 | Expanded payment history | "পেমেন্ট ইতিহাস / Payment History" rows: date, optional `— note`, `+৳amount` in green |
| SD-8 | Due row | When `remaining > 0`: "বাকি / Due: ৳X" + **Pay** button |
| SD-9 | Payment modal | Title "পেমেন্ট রেকর্ড / Record Payment"; Due line; amount prefilled to `remaining`; **live over-amount error** "Amount cannot exceed remaining ৳X"; optional note; Save |
| SD-10 | Payment capping | `recordInvoicePayment` caps at remaining and `alert`s "Payment capped to remaining balance: ৳X"; refuses when already fully paid |
| SD-11 | Cash coupling | `notifyCashUpdated()` after a supplier payment |
| SD-12 | Not-found state | `Truck` icon + "Supplier not found" + Back button |
| SD-13 | Display vs payable sets | Display list hides **COD** stock-addition placeholders; purchase aggregates include every non-voided invoice; payable counts **credit-terms invoices only** |
| SD-14 | Strict resolution | Invoices resolve by `supplierId` only — never by name |

### 1.11 Supplier Invoices — `screens/SupplierInvoices.tsx` → `/app/invoices`

| # | Prototype element | Behavior |
|---|---|---|
| SI-1 | Header | "সরবরাহ ইনভয়েস / Supplier Invoices" |
| SI-2 | Search | Supplier name, invoice date substring, or any line's matched/raw medicine name |
| SI-3 | Invoice row | `FileText` chip; supplier name; `{invoiceDate} · N items` + amber `Clock` + pending count when `pendingCount > 0`; `৳ total`; chevron |
| SI-4 | Row tap | → `/app/invoices/{id}` |
| SI-5 | Empty state | Circle `FileText` + "কোনো চালান নেই / No invoices yet" + "Tap the button below to add one" |
| SI-6 | FAB | Pill button "নতুন চালান / New Invoice" → `/app/invoices/new` |
| SI-7 | Sort | `createdAt` descending |

### 1.12 Supplier Invoice Create — `screens/SupplierInvoiceCreate.tsx` → `/app/invoices/new`

| # | Prototype element | Behavior |
|---|---|---|
| IC-1 | Stepper | 3 numbered steps `method → review → confirm` with a progress rail |
| IC-2 | Header per step | "New Invoice" / "Review & Match" / "Confirm"; back goes `confirm → review → method → router back` |
| IC-3 | Method — Scan | Camera capture (`accept=image/* capture=environment`) → `mockOCR` |
| IC-4 | Method — Manual | Seeds one empty line and jumps to review |
| IC-5 | Busy card | Spinner + "চালান পড়া হচ্ছে... / Reading invoice…" |
| IC-6 | OCR result handling | Sets supplier hint, invoice date, and lines; each line auto-matched against inventory at **score ≥ 0.7**; overall confidence `< 0.5` flips the source back to `manual` |
| IC-7 | Low-confidence warning | Shown when overall confidence `< 0.6`: "Low OCR confidence — please verify each item." |
| IC-8 | Supplier field | `SupplierPicker`, required; "OCR suggested: **{name}**" hint when unresolved |
| IC-9 | Invoice date field | Date input, defaults to today |
| IC-10 | Line card | `#index`, `StatusBadge` (**matched** green / **unmatched** red / **pending** amber / **new** blue), trash delete, name input (editing clears any match), 2×2 grid **Qty / Cost / Batch # / Expiry date** |
| IC-11 | Line actions | Unmatched → **Match** + **Add as new**; matched → **Change match**; always a **Pending** checkbox ("বাকি/পরে আসবে") |
| IC-12 | Inline match picker | Search box seeded from the raw name, up to 8 candidates (name + generic), "No matches" state |
| IC-13 | Add Item | Dashed-border button appending an empty line |
| IC-14 | Sticky summary bar | `N items`, `⚠ unmatched`, `⏳ pending`, `৳ total`, **Continue** |
| IC-15 | Continue validation | Supplier required; ≥ 1 line; every non-pending line needs a name and `qty > 0`; every non-pending line needs `purchasePrice > 0` |
| IC-16 | Duplicate detection | Same normalized supplier name + same date + total within `max(1, 0.5 %)` → amber card + **"I verified — save anyway"** checkbox gating Confirm |
| IC-17 | Confirm summary | Supplier, Date, Items, Pending (amber), Unmatched (amber), Total |
| IC-18 | Payment terms | **নগদ পরিশোধ / Cash on Delivery** \| **বাকিতে নেওয়া / On Credit**; default **credit** for formal invoices |
| IC-19 | Confirm action | Persists the invoice, applies non-pending lines to stock, `alert("Invoice saved. Stock applied: N, new: N, pending: N")`, `navigate(detail, {replace:true})` |
| IC-20 | Caption | "নিশ্চিত করার পরে স্টক আপডেট হবে / Stock will be updated only after confirmation." |
| IC-21 | COD settlement | A COD invoice auto-records a full payment for the total so payable nets to zero |
| IC-22 | Total rule | `computeTotal` excludes pending lines |
| IC-23 | Stock application | Pushes a new batch (`batchNo`, `expiryDate`, `stock`, `purchasePrice`, `salePrice`, `invoiceId`, `supplierId`, `receivedAt`) and increments `med.stock`; skips pending lines and any line with `qty <= 0` or `price <= 0`; creates a new medicine for `new` lines with `salePrice = round(price × 1.26)` |

### 1.13 Supplier Invoice Detail — `screens/SupplierInvoiceDetail.tsx` → `/app/invoices/:id`

| # | Prototype element | Behavior |
|---|---|---|
| ID-1 | Header | Own header (not `StandardHeader`): back → `/app/invoices`, title "চালান বিবরণ / Invoice Details", LanguageToggle |
| ID-2 | Voided badge | Red `XCircle` + "বাতিল করা হয়েছে / VOIDED" + void date |
| ID-3 | Header card | Supplier (label + name), then grid **Date / Total / Items / Source** (`ocr` or `manual`) |
| ID-4 | Void action | Confirm dialog "Do you want to void this invoice? This cannot be undone."; **blocked** when any line is already `matched`/`new` with the reason text; writes an `invoice_void` audit log with amount and supplier |
| ID-5 | Line card | `#index`, status pill + icon, name, grid **Qty / ৳price / expiry-or-`—`**, `Batch: X` line |
| ID-6 | Mark Received | Pending lines only: spinner "Processing…" → applies that line to stock, refreshes, writes a `stock` audit log; failure shows `alert("Failed: …")` |
| ID-7 | Recount on receive | Recomputes `pendingCount` and `total` after a line is applied |
| ID-8 | Not-found state | `FileText` icon + "চালান পাওয়া যায়নি / Invoice not found" + Back |

### 1.14 Printer Settings — `screens/PrinterSettings.tsx` → `/app/printer`

| # | Prototype element | Behavior |
|---|---|---|
| PR-1 | Header | "প্রিন্টার / Printer" |
| PR-2 | Unsupported warning | Amber card "Web Bluetooth isn't supported in this browser — running in demo mode." |
| PR-3 | Device card | Bluetooth chip; paired name or "কোনো প্রিন্টার পেয়ার করা নেই / No printer paired"; sub-line `Paired: {timestamp}` or "ESC/POS compatible (Epson TM, Star SM)" |
| PR-4 | Pair button | "পেয়ার করুন / Pair" or "পুনরায় পেয়ার / Re-pair"; disabled while busy |
| PR-5 | Test Print button | Disabled without a paired printer; prints a receipt with Date / Time / **Status: OK (bold)** |
| PR-6 | Remove printer | Visible only when paired; clears storage + info banner "প্রিন্টার সরানো হয়েছে / Printer removed" |
| PR-7 | Status banner | ok (green) / err (red) / info (blue) with icon; error banner carries an underlined **Retry** that re-runs the test print |
| PR-8 | Error map | `out-of-paper`, `out-of-range`, `disconnected`, `send-failed`, `no-device`, `unsupported`, `unknown` — all localized |
| PR-9 | Supported Models card | Epson TM-m30/T20/T82; Star SM-L200/L300/T300i; "Most generic BLE ESC/POS printers" |
| PR-10 | `printer.ts` transport | BLE serial service `0x18F0`, char `00002af1-…`; persisted `printerInfo {id, name, pairedAt}`; reconnect via `getDevices()` then re-prompt; **200-byte chunked writes** with `writeValueWithoutResponse` → `writeValue` fallback; `printBytes(bytes, {retry:1})`; message→code error mapping; demo mode logs and resolves |
| PR-11 | `escpos.ts` builder | `init/text/ln/align/bold/size/hr/feed/cut`; `buildReceipt({shopName, title, rows, footer?, width=32})` — centered bold double-height shop name, title, rule, label/value rows with computed padding, rule, centered footer (defaults to the local timestamp), 3-line feed, cut |
| PR-12 | Second printer surface | `Settings.tsx` has its **own** printer modal (Name, Model, Connection Type **WiFi/USB/BT**, IP Address when WiFi, Disconnect / Cancel / Connect-Update, success toast) writing the **same** `printerInfo` key with a different shape |

### 1.15 Receipt printing (cross-screen)

| # | Prototype element | Behavior |
|---|---|---|
| RC-1 | Monthly P&L print | `MonthlyReport` → `buildReceipt` → `printBytes` (see MR-11..MR-13) |
| RC-2 | Printer test print | `PrinterSettings` → `buildReceipt` (see PR-5) |
| RC-3 | Sales-report print button | `EndOfDay` Print button — **decorative, no handler** |
| RC-4 | Sale receipt print | **Not present in the prototype** — no checkout/sales-history receipt print path exists |

### 1.16 Tax / VAT

| # | Prototype element | Behavior |
|---|---|---|
| TX-1 | Settings row | "ট্যাক্স / ভ্যাট / Tax / VAT" showing `N% {label}` or "নিষ্ক্রিয় / Disabled" |
| TX-2 | Tax modal | Helper text; `−/+` spinner in **0.5 %** steps clamped to `0..100`; label buttons **VAT** \| **GST**; Cancel / Save |
| TX-3 | Storage | `reportSettings.taxRate`, `reportSettings.taxLabel` (defaults `0`, `"VAT"`) |
| TX-4 | Checkout math | `taxAmount = (subtotal − discount) × taxRate/100`; `total = subtotal − discount + taxAmount` |
| TX-5 | Checkout display | Line "`{taxLabel} ({taxRate}%)`" |
| TX-6 | Transaction fields | `tax`, `taxRate`, `taxLabel` persisted on the sale |
| TX-7 | Reporting | Monthly Report sums `transaction.tax` over the period and shows/exports/prints "Tax/VAT Collected" only when `> 0` |

### 1.17 Credit Period / Overdue

| # | Prototype element | Behavior |
|---|---|---|
| CP-1 | Settings row | "বাকি সর্বোচ্চ দিন / Credit Period" → `{creditMaxDays} days max` |
| CP-2 | Credit-period modal | SpinnerModal, range `1..365`, step 1, blue theme, Cancel / Save → `appSettings.creditMaxDays` (default **7**) |
| CP-3 | Credit Sales overdue badge | Reads `customer.overdue`, a boolean **only ever written as `false`** at customer creation — never recomputed |
| CP-4 | Dashboard overdue count | `customers.filter(c => c.amount > 0 && new Date(c.lastDate) < today).length` — **ignores `creditMaxDays` entirely** |
| CP-5 | Overdue notification | Scheduler pushes `overdue_credit` when any customer has `amount > 0 && lastDate < today`, dedupe key `overdue_credit_daily`, action route `/app/credit`; gated by `settings.creditAlerts` |
| CP-6 | Data Export | Exports a `DueDate` column reading `c.dueDate`, a field the prototype never writes |

### 1.18 Related B3 Settings — `screens/Settings.tsx`

| # | Prototype row / modal | Behavior |
|---|---|---|
| ST-1 | **Credit Period** (SALES & CREDIT) | See CP-1/CP-2 |
| ST-2 | **Costing Method** (INVENTORY) | FIFO \| Weighted Average, two-card radio modal, `appSettings.costingMethod`; a parallel FIFO/WAC control exists in Monthly Report writing `reportSettings.costingMethod` |
| ST-3 | **Notifications** modal | Master "All Notifications" toggle; Stock / Expiry / **Credit** alert toggles (disabled while master is off); **Cash Summary** toggle "Closing-time drawer summary" requesting browser permission, with an alert when denied |
| ST-4 | **Closing-Time Prompt** | Hour spinner `(h+23)%24` / `(h+1)%24`, label `h:00 AM/PM`, saved to `appSettings.closingTimeHour` (default 20) |
| ST-5 | **Tax / VAT** | See TX-1/TX-2 |
| ST-6 | **Printer** row | See PR-12 |
| ST-7 | Cash-notification service | 8 PM default, tab-resident timer, per-day `cashNotificationFired` dedupe, fires immediately if the app opens after the trigger, in-app bell entry always written even when OS permission is denied, click → `/app/cash-summary` |

### 1.19 Navigation paths into B3

| Entry point | Destination |
|---|---|
| More-menu tile "ক্যাশ ড্রয়ার / Cash Drawer" (`cash_drawer`) | `/app/cash-summary` |
| More-menu tile "দৈনিক ক্লোজিং / End of Day" (`cash_drawer`) | `/app/end-of-day` |
| More-menu tile "রিপোর্ট / Report" (`reports`) | `/app/report` |
| More-menu tile "খরচ / Expense" (owner-only) | `/app/expense` |
| More-menu tile "সাপ্লাইয়ার ইনভয়েস / Supplier Invoices" (owner-only) | `/app/invoices` |
| More-menu tile "সাপ্লাইয়ার লিস্ট / Suppliers" (owner-only) | `/app/suppliers` |
| Bottom tab "বাকি বিক্রয় / Credit Sales" (staff only; hidden for owner) | `/app/credit` |
| Dashboard supplier widget | `/app/suppliers` |
| Dashboard credit widget | `/app/credit` |
| Dashboard report widget | `/app/report` |
| Settings → Printer row | printer modal (and `/app/printer` as the dedicated screen) |
| Monthly Report → "Add expenses" | `/app/expense` |
| Suppliers row → Invoice / Supplier Detail → New Invoice | `/app/invoices/new` (with supplier preset) |
| Supplier Detail invoice date link | `/app/invoices/:id` |
| Credit Sales → View Details | `/app/credit/:customerId` |
| Cash notification click | `/app/cash-summary` |
| Overdue-credit notification | `/app/credit` |

---

## 2. B3 AUDIT

Status reflects current production after Phase B1 + the Owner-Dashboard parity recovery. Visual-only differences are excluded (CLAUDE.md rule 15; Phase-C owns polish).

| Surface | Status | Existing production behavior to preserve | B3 functional gap / smallest safe completion |
|---|---|---|---|
| Credit Sales (`/credit/credit-sales`) | **PARTIAL** | Owner-gated `credit_view`/`credit_manage`, SQLite `listCustomersWithBalance` (ledger-derived balance, 50-row cap), create-customer with Zod + outbox + session guard, `AccessDenied`, stale-session guards. | Add search (name/phone/id), Total Outstanding + customer-count header card, per-customer last-transaction date and sold-by, Settled pill at zero balance, **derived** overdue badge, and the Make-Payment sheet (Half/Full/Clear, capped at balance) so collection is reachable from the list. Remove the 50-row cap or paginate. Keep zero-balance customers visible. |
| Customer Credit Detail (`/credit/customer-detail`) | **PARTIAL** | Ledger rows (`credits` ∪ `customer_payment` payments), `remainingBalance`, `collectPayment` with FIFO allocation across open credits, balance cap, closed-day guard, allocation rows, drawer refresh, outbox operation grouping. | Add the Purchase History / Settled History tab split, the All/Unpaid/Partial filter, per-purchase cards (invoice ref, status badge, sync indicator, Today/Yesterday date, item preview + "+N more", Paid/Due block), the two count tiles, and both empty states. Show payment method and reference on collections. |
| Credit collection / payment / history | **PARTIAL** | Atomic collection: payment row, per-credit allocations, credit balance decrement, drawer row + `closing_expected` recompute, deterministic operation counting, over-balance rejection. | Surface allocation results (which sale credits a collection cleared) in the UI, expose a settled-history view, add the non-cash `method` selector already supported by `CollectPaymentInput`, and add a collection **reversal/void** path (currently only reachable through B2's refund graph). |
| Cash Summary (`/cash-summary`) | **PARTIAL** | Fixed `expectedCash` formula in `domain/cashFormula.ts`, all seven terms read from SQLite, `cash_management` gate on read and write, opening cash per business date defaulting to 0, session-liveness guards, sync trigger. | Add the hero formula caption, the collapsible breakdown sheet (expandable Credit Collections and Expenses detail rows, Supplier Payments shown only when `> 0`, `+/−` signs), the **owner/staff cash-sales split with per-staff expansion**, the **counted-cash + reconcile** control with match/surplus/shortage result, the **withdrawal** sheet, the opening-cash **quick chips**, and the saved toast. |
| Cash — withdrawals | **MISSING** | `payments.type = 'withdrawal'` exists in the schema, is summed by `getCashSummarySync`, and is a term of the fixed formula. | Build the write path: an owner-gated `recordWithdrawal` in `db/cash.ts` writing one `payments` row (`type='withdrawal'`, `method='cash'`, optional note), inside the closed-day guard, with drawer recompute and outbox — plus the Cash Summary sheet. Today the term is permanently zero. |
| Cash — day rollover / previous-day summary | **PARTIAL** | `getDaySummary` already returns yesterday's totals and top items; the dashboard renders a previous-day modal. | Add the `lastSeenCashDay` rollover detector so the summary is offered **once** on the first open after local midnight, and the opening-cash prompt that follows it. |
| Expenses (`/expenses`) | **PARTIAL** | Atomic `expenses` + `payments(type='expense', method='cash')` write in one transaction, `cash_management` gate, closed-day guard, drawer recompute, Zod-validated form, today's list with total, six categories. | Add the three tabs (Quick Log / Ledger / Analytics), the numeric keypad and category circles, the **duplicate-detection modal**, the inline saved banner, the month-navigated Ledger grouped by day with per-day sums and delete-with-confirm, and the Analytics tab (MoM trend, top-5 category bars, total/avg stats). Add the persistent This-Month / Today / Entries strip. |
| Expense — delete | **MISSING** | Soft-delete columns exist on `expenses` and `payments`. | Add an owner-gated soft-delete that voids **both** the expense and its paired payment in one transaction, refuses on a closed business date, recomputes the drawer, and writes outbox rows. Never delete one side. |
| End of Day (`/end-of-day`) | **PARTIAL** | `getEndOfDaySummary` (total/cash/credit sales, COGS, gross profit, expenses, new credit given, credit collected, expected vs counted, variance, opened_by/closed_by), `closeDay` recomputing `closing_expected` inside its own transaction, one drawer row per `(shop, business_date)`, irreversible lock, `assertBusinessDateOpen` enforced by every money/stock writer. | Keep the production close-out as the day-lock. Add the prototype's **Sales Report** reading: date-range selector with the "N Day Report" caption, previous-equal-period % change, Transactions / Average Sale, outstanding-credit card, estimated-net-profit card with a partial-COGS marker, the COGS card, and the "Today so far" chip driven by the configurable closing hour. |
| Report (`/reports/report`) | **MISSING** | `db/reports.ts` is signature-only stubs that throw; the route and `reports` permission exist; `computePnL`-equivalent aggregates already exist in `getEndOfDaySummary` and `getDaySummary`. | Build date-range totals over SQLite: presets Today/Yesterday/Week/Month + custom range, hero band (Total Sales, % vs previous equal window, Transactions/Avg Sale/Profit), sales-trend chart, cash-vs-credit breakdown, and Top-5 medicines by revenue. Profit must be **real COGS-based**, not a flat margin. |
| Monthly Report (`/reports/monthly-report`) | **MISSING** | Screen is a TODO stub; `getMonthlyReport` throws. | Build the month cursor, the P&L statement (Total Sales → − Discounts → = Net Sales → − COGS → = Gross Profit → − Operating Expenses with per-category lines → = Net Profit/Loss), the loss-state hero, the partial-COGS warning with missing-medicine names, the no-expenses info card linking to Expenses, the 6-month trend, the this-vs-last expense-by-category comparison, and the Print/CSV/Excel actions. |
| Data Export (`/reports/data-export`) | **MISSING** | Screen is a TODO stub; `exportShopData` throws; owner-only route rule is in place. | Build the date range, the four dataset toggles, the CSV/Excel format toggle, per-dataset row builders, progress, result banner, and share/save delivery through Expo file APIs. |
| Suppliers (`/suppliers/list`) | **PARTIAL** | Owner-gated list with SQL-derived payable (`SUM(total − paid_amount)`), create-supplier with Zod + outbox + session guard, navigation to detail and purchase-create. | Add search, per-supplier purchase count / total purchased / last-purchase date, the "due" emphasis, per-row **Invoice** and **Edit** actions, the empty state, and last-purchase-descending sort. Add supplier **edit** and **archive** (both absent today); archive is **refused while the supplier's outstanding payable is > 0** (founder decision D-9 — reverses the prototype's unconditional archive, see S-29). |
| Supplier Detail (`/suppliers/detail`) | **PARTIAL** | Owner-gated detail + payable, purchase history rows (invoice no, payment type, date, total, outstanding). | Add the four stat tiles (total purchase, outstanding, invoice count, this-month vs last-month delta), the last-purchase line, Archive (**blocked while outstanding payable > 0**, D-9), the expandable **payment history** per purchase, the status pill (Paid/Partial/Pending), and the **Record Payment** flow. |
| Supplier payments (pay down a payable) | **MISSING** | `purchases.paid_amount` exists; `payments.type='supplier_payment'` exists and is a cash-formula term; COD purchases already write one. | Build `recordSupplierPayment`: one transaction writing a `payments` row, incrementing `purchases.paid_amount`, capped at `total − paid_amount`, refusing on a closed day and on COD-settled invoices, recomputing the drawer, with outbox rows. Without this the payable can only ever grow. |
| Supplier Invoices list (`/app/invoices`) | **MISSING** | No route exists; `purchases`/`purchase_items` hold the data; `MORE_ROUTES` and `OWNER_QUICK_LINKS` currently point "Supplier Invoices" at `/suppliers/purchase-create`. | Add a shop-wide purchase list route with search (supplier / date / medicine), row summary (supplier, date, item count, pending count, total), empty state, and a New-Invoice action. Repoint both navigation registries at it. |
| Supplier Invoice Detail | **MISSING** | No route exists; purchase header and items are stored. | Add a purchase-detail route: header card (supplier, date, total, items, source), per-line cards (qty, price, expiry, batch), and the pending/void actions below. |
| Purchase / Supplier Invoice Create (`/suppliers/purchase-create`) | **PARTIAL** | Owner-gated atomic purchase: header, items, batch create/reuse with expiry-mismatch and duplicate-batch errors, `addStock` ledger movements, COD payment + drawer recompute, closed-day guard, deterministic `PUR-{year}-{seq}-{uuid12}` invoice number, in-transaction owner recheck, failed-line restoration into the form. | Add the 3-step Scan/Manual stepper, OCR capture and fuzzy inventory matching with a match picker, **Add as new medicine**, per-line **Pending** marking (received later, excluded from total and stock), an editable invoice date, duplicate-invoice detection with an explicit override, the sticky summary bar, and the confirm summary. Keep every existing invariant. |
| Purchase — pending lines | **MISSING** | No `status` concept on `purchase_items`. | Add a line status so a line can be recorded but not yet stocked, plus a Mark-Received action that applies exactly that line's stock movement in one transaction and recomputes the header total and pending count. |
| Purchase — void | **MISSING** | Soft-delete columns exist; no void path. | Add void with the prototype's rule preserved and hardened: a purchase may only be voided when **no** line has produced a stock movement and no payment has been recorded; otherwise it must be reversed through a purchase return, not voided. Write an audit row. |
| Purchase returns | **MISSING** | `purchase_returns` table exists (qty, reason, `credit_amount`, `created_by`) and is in both sync allowlists; nothing reads or writes it. B2 deferred supplier return here unconditionally. | Build supplier return: negative stock movements against the original batch, a supplier credit reducing the payable, required reason, closed-day guard, audit + outbox. |
| Printer Settings (`/settings/printer-settings`) | **MISSING** | Screen is a TODO stub; the route and owner rule exist. | Build native BLE pairing/unpairing, persisted device info, test print, per-error localized states with retry, and the supported-models card. Requires a native BLE module and a fresh dev/EAS build. |
| Receipt printing | **MISSING** | No ESC/POS builder, no transport, no print call sites. | Port an ESC/POS builder (init/align/bold/size/rule/feed/cut, label-value rows at 32 columns) and add the two prototype print call sites: **Monthly P&L** and **Test Print**. |
| Tax / VAT | **MISSING** | No tax column on `sales`; no tax setting; Settings shows a disabled row labelled "B3"; B2 explicitly excluded tax from checkout. | Add a shop-level tax rate + label. **MRP-inclusive** (founder decision D-1, 2026-08-22): tax is extracted from the post-discount total the customer already pays, never added on top — see contract §5.16. Persist the resolved paisa amount and the rate/label snapshot on the sale, and report/print/export "Tax collected" when non-zero. No per-medicine override or exemption. |
| Credit Period / overdue | **PARTIAL** | `shop_b2_settings.credit_max_days` (default 7) exists locally (`0013`) and in an unpushed PostgreSQL migration; `domain/dashboard.overdueBeforeDate` and `getCreditSummary` already count overdue customers from `credits.created_at + credit_max_days`. | Expose `creditMaxDays` in the Settings modal (it is in the DB and the read model but **not** in `B2SettingsModal`), apply the same rule per customer and per credit in Credit Sales and Customer Detail, and add the `overdue_credit` notification generator (the type, route, icon, and permission mapping already exist; nothing creates the row). |
| Closing-time prompt | **PARTIAL** | `runDailySummaryCheck` writes an owner-only `daily_summary` notification once per business date, gated by the `dailyCash` preference, and presents a local notification. | The trigger hour is **hardcoded `now.getHours() < 20`**. Add the configurable closing hour to shop settings and read it here and in End of Day's "Today so far" chip. |
| Related B3 Settings | **PARTIAL** | `shop_b2_settings` persists and syncs low-stock, near/far expiry, refund window, and credit-max-days; `B2SettingsModal` edits the first four; notification preferences modal exists; "Closing / Tax" is a disabled row marked "B3". | Add Credit Period, Closing-Time hour, and Tax rate/label to the settings model and UI. Costing-method selection stays superseded (§4). |
| Owner Dashboard cross-links | **PARTIAL** | Expected-in-drawer → `/cash-summary` (with inline set-opening-cash), Outstanding credit → `/credit/credit-sales`, Supplier payable → `/suppliers/list`, dues alert → `/credit/credit-sales`, Complete Day → `/end-of-day`, yesterday card → previous-day modal, quick links to expense/report/export/printer/suppliers. | Repoint the "Supplier Invoices" quick link and More tile from `/suppliers/purchase-create` to the new invoices list. Everything else already lands on a B3 destination that must now be real rather than a stub. |

---

## 3. MISSING/WRONG FUNCTIONALITY

### 3.1 MISSING — no production implementation at all

1. **Cash withdrawals.** The formula subtracts them; nothing can create one. `payments.type='withdrawal'` is dead.
2. **Supplier payment against a payable.** Only COD purchases write a `supplier_payment`; a credit-terms purchase can never be paid down, so `Outstanding payable` is monotonically increasing.
3. **Purchase returns.** Table, sync allowlist, and B2's deferral all exist; no code path.
4. **Report screen** — stub that renders a TODO string; `getDateRangeTotals` throws.
5. **Monthly Report** — stub; `getMonthlyReport` throws.
6. **Data Export** — stub; `exportShopData` throws.
7. **Printer Settings + all receipt printing** — stub; no ESC/POS builder, no transport.
8. **Tax / VAT** — no setting, no column, no checkout math, no report line.
9. **Supplier Invoices list and Supplier Invoice Detail routes.**
10. **Supplier edit and archive.**
11. **Expense delete.**
12. **Purchase pending lines and Mark Received.**
13. **Purchase void.**
14. **`overdue_credit` notification generator.** The type, deep link, icon, and `credit_view` permission mapping all exist; no code ever creates the notification.
15. **Day-rollover previous-day summary prompt** (`lastSeenCashDay`).
16. **Settled-credit history view** and payment-allocation visibility.
17. **Credit collection reversal/void** outside the B2 refund graph.
18. **Search on Credit Sales, Suppliers, and Supplier Invoices.**
19. **Owner/staff cash-sales split** on the Cash Summary breakdown.
20. **Counted-cash reconcile on Cash Summary** (production only counts cash at day close).

### 3.2 WRONG — present but incorrect or inconsistent

| # | Issue | Evidence | Required correction |
|---|---|---|---|
| W-1 | **Two different business-date functions.** `db/cash.ts` and `db/purchases.ts` use a device-local `localBusinessDate`; `db/customers.ts` uses `dhakaBusinessDate` for credit collections. | `db/cash.ts:24`, `db/purchases.ts:74`, `db/customers.ts:262` | **Locked 2026-08-22: Asia/Dhaka, everywhere.** `dhakaBusinessDate` is the definition that wins; `localBusinessDate` in `db/cash.ts` and `db/purchases.ts` is replaced, not kept as an alternate path. A phone in a non-Dhaka timezone currently posts collections to a different day than expenses, which silently corrupts `closing_expected` and the EOD variance. Decision is locked; the code fix is still pending in Group 1. **Blocker B-1.** |
| W-2 | **Permission-key drift between routes and the data layer.** `navigation/routes.ts` guards `/cash-summary`, `/end-of-day` with `cash_drawer`; `db/cash.ts` requires `cash_management`. Suppliers route uses `inventory_write` while `db/suppliers.ts` calls `requireOwner`. | `navigation/routes.ts:19,23`, `db/cash.ts:175`, `db/suppliers.ts:52` | Reconcile to one key set. Route rules must not be able to admit a session the data layer then rejects (or vice versa). |
| W-3 | **`OWNER_QUICK_LINKS` / `MORE_ROUTES` "Supplier Invoices" points at `/suppliers/purchase-create`.** | `navigation/routes.ts:100,120` | **Moved to Group 6.** Keep the current owner-only create route until the invoices-list route exists; create the list and repoint both registries atomically so Group 1 never introduces a dead link. |
| W-4 | **Credit Sales caps at 50 customers** with no pagination or search, while the dashboard's dues card is uncapped. | `db/customers.ts:225` | The list and the KPI will disagree for any shop with >50 debtors. Add search + pagination or remove the cap. |
| W-5 | **Closing-time hour hardcoded to 20.** | `native/notifications.ts:179` | Make it a shop setting; the prototype exposes an hour spinner and End of Day's "Today so far" chip depends on the same value. |
| W-6 | **`creditMaxDays` is stored, synced, and used by the dashboard but unreachable in the UI.** `B2SettingsModal` edits four of the five fields. | `app/settings/settings.tsx:288-307` | Add the fifth control. An owner cannot currently change the credit period at all. |
| W-7 | **Supplier payable double-counts a partially-returned purchase** once returns exist, because payable is `SUM(total − paid_amount)` with no return term. | `db/suppliers.ts:57` | Fold purchase-return credit into the payable expression when returns ship. |
| W-8 | **Expense category sets differ.** Prototype: Rent / Salary / Utilities / Conveyance / Other. Production: rent / electricity / transport / staff_salary / supplies / other. | `packages/validation/src/expenses.ts:8`; `ExpenseTracking.tsx:33` | **Locked 2026-08-22 (D-4): adopt the prototype's 5-category set.** Requires migration `0021` — a **backfill**, not just an additive column — remapping existing rows (`electricity`→`utilities`, `transport`→`conveyance`, `staff_salary`→`salary`, `supplies`→`other`, `rent`→`rent`, `other`→`other`) and altering the CHECK constraint on both SQLite and its Postgres mirror. First non-additive migration in this plan. |
| W-9 | **`getCashSummarySync` is not permission-gated** by design (mid-transaction callers). Correct today, but every new B3 writer that calls it must already have authorized its actor. | `db/cash.ts:310` | Keep the invariant explicit in review; add a test asserting no screen imports it. |
| W-10 | **Expense receipt photo is accepted by the data layer but never captured.** | `db/cash.ts:160` | **Locked 2026-08-22 (D-5): drop it.** No receipt-photo capture ships in B3 Beta; remove the field from the B3 surface rather than leaving a half-wired money attachment. |

---

## 4. SUPERSEDED PROTOTYPE LOGIC

The **feature** survives in every case below; only the prototype's *implementation* is replaced. Nothing here may be read as "deferred".

| # | Prototype implementation | Superseded by | Why |
|---|---|---|---|
| S-1 | `localStorage`/`shopStorage` JSON blobs for `creditData`, `transactions`, `expenses`, `suppliers`, `supplierInvoices`, `cashOpening`, `cashWithdrawals`, `cashActualCounts`, `settledCreditHistory` | SQLite tables + the sync outbox | CLAUDE.md rule 1: SQLite is the only source of truth. |
| S-2 | Floating-point taka everywhere (`parseFloat`, `× 0.26`, `/ 2`) | Branded integer `Paisa` with `addPaisa`/`subtractPaisa`/`multiplyPaisa` | Money must never round through binary floats. |
| S-3 | **Denormalized `customer.amount`** as the credit balance of record | `remainingBalance(credits ∪ customer_payment payments)`, recomputed at read time | Two writers (checkout and collection) both mutate the cached figure; drift is unrecoverable. |
| S-4 | Credit FIFO allocation by *mutating transaction records in place* | `credit_payment_allocations` rows + `credits.balance` decrements in one transaction | Allocation must be an auditable ledger, not a rewrite of the sale. |
| S-5 | `customer.overdue` boolean written once as `false` and never recomputed (CP-3) | Derived: `credits.balance > 0 AND date(credits.created_at) < businessDate − credit_max_days` | The prototype badge can never turn on. The rule is already implemented in `domain/dashboard.overdueBeforeDate`. |
| S-6 | Dashboard/notification overdue rule `lastDate < today` (CP-4/CP-5) | Same derived rule as S-5 | Ignores the configured credit period entirely and flags every customer with a day-old balance. |
| S-7 | `settledCreditHistory` as a parallel array with `syncStatus:"local"` | `payments` + `credit_payment_allocations`, with the real sync queue | A second write target for money that can diverge from the ledger. |
| S-8 | Simulated sync (`setTimeout(1500)`) and the spinning header button | Production background sync + real status store | Fake success indication on a money screen. |
| S-9 | `notifyCashUpdated()` window events as the coupling between screens and the drawer | `closing_expected` recomputed **inside the same SQLite transaction** as the write that changed it | A missed listener silently desynchronizes the drawer; the production model cannot lag its own events. |
| S-10 | Prototype cash formula with **no refunds term** (CH-20) | Fixed formula in `domain/cashFormula.ts` including `refunds` | CLAUDE.md rule 4: the formula is fixed; B2 shipped cash refunds and they must reduce the drawer. |
| S-11 | Prototype `EndOfDay` as a read-only date-range report with no locking | `closeDay` + `assertBusinessDateOpen` on every money/stock writer | A day that reports must also be lockable, or its numbers can change after the fact. |
| S-12 | `Report.estimatedProfit = totalSales × 0.26` (RP-4) | Real per-batch COGS captured on `sale_items.cogs` | A hardcoded margin is a fabricated number on a financial screen. |
| S-13 | Costing-method selector (FIFO vs Weighted Average) in Settings **and** Monthly Report (ST-2, MR-3), stored in two different keys | Removed as a user setting | B2 fixed physical issue as FEFO and COGS as actual batch cost. Neither switch has any effect in production; keeping a dead money control is worse than removing it. |
| S-14 | `mockOCR` returning the shop's own first four medicines with fake batches and a fake supplier | Real on-device OCR (already shipped for Add Medicine/Sale in B2) feeding the same match-and-confirm review step | Demo data must never enter a stock/money flow. |
| S-15 | `applyInvoiceToStock` pushing a batch and doing `med.stock += qty` | `addStock` signed ledger movements; `batches.stock` is derived and never assigned | CLAUDE.md: stock changes only through the append-only ledger. |
| S-16 | New medicine auto-created with `salePrice = round(purchasePrice × 1.26)` | Explicit operator-entered sale price (already required by `purchaseLineItemFieldsSchema`) | A guessed sale price silently sets the shop's margin. |
| S-17 | `alert()` / `confirm()` for validation, capping, duplicates, void, and save confirmation | In-screen error state, typed errors from `db/errors.ts`, and RN modals | Blocking browser dialogs are not an RN pattern and swallow the failure reason. |
| S-18 | Two competing printer models: BLE `printerInfo {id,name,pairedAt}` (PR-10) and the Settings modal's `{name,model,connectionType,ipAddress}` (PR-12) writing the same key | One native BLE ESC/POS device record | The two shapes overwrite each other; only the BLE one can actually print. |
| S-19 | Web Bluetooth transport and the browser "demo mode" that logs bytes and resolves successfully | Native RN BLE module; **no demo fallback** — an unpaired or unreachable printer must report failure | A print path that silently succeeds without printing is a false receipt. |
| S-20 | Web Share / anchor-download blobs and `navigator.onLine` gating for exports (DE-9) | Expo file-system write + native share sheet; exports are **local-first and work offline** | Exporting from a local SQLite database has no network dependency; the prototype's offline block is an artifact of the web target. |
| S-21 | Export "Excel" as an HTML `<table>` with an `.xls` extension | **Locked (D-6): CSV (UTF-8 BOM) + a genuine XLSX writer**, both shipped | Mislabelled file type. The prototype's "Excel" was never a real spreadsheet; B3 ships two honest formats instead of one fake one. |
| S-22 | `Date.now()` numeric ids for customers, expenses, transactions, and payments | `generateId()` UUIDs + deterministic invoice numbers (`domain/invoice.ts`) | Two devices in one shop mint identical `Date.now()` ids. |
| S-23 | Prototype Data Export credit `DueDate` column reading a never-written field (CP-6) | Derived due date = `credit.created_at + credit_max_days` | Exports a permanently empty column. |
| S-24 | `EndOfDay` Print/Export/Share buttons with no handlers (EOD-11) | Real handlers, or the buttons are not rendered | Dead controls on a money screen read as broken, not as "coming soon". |
| S-25 | Expense staff limit of `৳500` enforced only in the screen | **Locked (D-3): dropped entirely.** Expenses stay owner-only, matching current production; the prototype's staff access and its ৳500 cap are not ported. | Production already makes expenses owner-only, so the staff limit has no subject. Confirmed, not defaulted. |
| S-26 | Prototype's per-invoice `payments[]` array embedded in the invoice document | `payments` rows with `type='supplier_payment'`, `party_id=supplier`, `ref_id=purchase` + `purchases.paid_amount` | Payments must live in the same ledger the cash formula reads. |
| S-27 | Multi-Shop Comparison block inside Report (RP-13) | **Excluded** — B4 | Out of B3 scope by instruction. |
| S-28 | Checkout tax computed **exclusive** — added on top of the subtotal after discount (TX-4) | **MRP-inclusive** extraction: tax is carved out of the total the customer already pays; the total itself does not change when tax is turned on (contract §5.16) | Founder decision D-1, 2026-08-22. Bangladeshi pharmacy retail commonly treats the shelf/MRP price as tax-inclusive; an exclusive add-on would silently inflate every printed total beyond the sticker price. |
| S-29 | Supplier archive allowed unconditionally, even with an open payable (SD-5) | Archive **refused** while `SUM(purchases.total − paid_amount − returned_credit) > 0` for that supplier, with a typed error naming the amount | Founder decision D-9, 2026-08-22. Archiving a supplier the shop still owes would hide a real debt from the payable list and the dashboard KPI. |

---

## 5. CHANGED CONTRACTS (B3)

These are the rules B3 introduces or tightens. They bind every consumer.

1. **Credit balance is derived, never stored.** A customer's outstanding is `SUM(credits.balance)` for that customer. No cached total exists anywhere — list, detail, dashboard KPI, export, and EOD all read the same expression.
2. **Collection allocation is FIFO by `(credits.created_at, credits.id)`,** already implemented, and every allocation is persisted as a `credit_payment_allocations` row. A collection that cannot be fully allocated fails the whole transaction. A collection may never exceed the customer's balance.
3. **Overdue is derived, never stored.** A credit is overdue when `balance > 0 AND date(created_at,'localtime') < businessDate − credit_max_days`. A **customer** is overdue when they hold at least one overdue credit. `credit_max_days` is the synced shop setting, default 7. The same expression serves the badge, the dues card, the notification, and the export's due-date column.
4. **The cash formula is fixed** (CLAUDE.md rule 4): `expected = opening + cashSales + creditCollections − expenses − refunds − supplierPayments − withdrawals`. B3 adds **no term**. Withdrawals and supplier payments become writable; they were always summands.
5. **Every cash-affecting write recomputes `closing_expected` inside its own transaction** and calls `assertBusinessDateOpen` first. This now covers withdrawals, supplier payments, expense deletion, and purchase returns.
6. **Opening cash defaults to 0, is set by the user, and is written only against the passed business date** (CLAUDE.md rule 5). The day-rollover prompt may *offer* the opening-cash modal; it must never carry a value forward.
7. **One business-date definition: Asia/Dhaka**, for every money read and write, applied consistently across `cash`, `customers`, `purchases`, `sales`, and notifications — locked by founder decision, 2026-08-22 (resolves W-1).
8. **A closed day is immutable.** No collection, expense, withdrawal, supplier payment, purchase, purchase return, or expense deletion may post to it. There is no reopen.
9. **Mid-day reconcile and day-close counts are separate fields on `cash_drawer`, not one shared write** (founder decision D-2, 2026-08-22). Cash Summary's reconcile control writes `reconciled_counted_amount` / `reconciled_at` / `reconciled_by` and may be overwritten any number of times before close; it shows match/surplus/shortage against the live `expected_cash` and never locks the day. End of Day's close is the sole writer of `closing_counted` / `closed_by` / `closed_at` and is the only one that locks the row. `variance = closing_counted − expected`, recomputed from the ledger at close, never from a reconciled or rendered figure.
10. **Supplier payable is `SUM(purchases.total − purchases.paid_amount − returned_credit)`** over non-deleted, non-voided purchases, counting **credit-terms** purchases only. COD purchases settle at creation and never owe.
11. **A supplier payment is capped at the invoice's remaining balance,** writes one `payments` row and one `purchases.paid_amount` increment in the same transaction, and is refused against a COD or fully-paid purchase.
12. **A purchase line has a status.** `pending` lines produce **no** stock movement and are excluded from the header total. Marking one received applies exactly that line's `addStock` movement, then recomputes the header total and pending count — in one transaction.
13. **A purchase may be voided only when it has produced no stock movement and carries no payment.** Otherwise the reversal path is a purchase return. Both write audit rows.
14. **Purchase-invoice duplicate detection is advisory,** not blocking: same supplier + same invoice date + total within `max(৳1, 0.5%)` warns and requires an explicit acknowledgement before saving.
15. **Stock still changes only through signed ledger movements**; `batches.stock` is never assigned. Receiving into an existing batch requires an exact expiry match; a mismatch or a soft-deleted batch is a typed error surfaced on the failing line.
16. **Tax is MRP-inclusive — extracted from the post-discount total, never added on top** (founder decision D-1, 2026-08-22): `grossTotal = promoted_subtotal − sale_discount` (this is what the customer pays; it does not change when tax is turned on); `tax = round_half_up(grossTotal × rate_bp / (10000 + rate_bp))` in integer paisa; `netSales = grossTotal − tax`; `total = grossTotal`. The sale persists the resolved `tax` amount plus a `tax_rate_bp` and `tax_label` **snapshot**, so changing the shop's rate never rewrites a historical sale. Rate `0` means no tax line is rendered, stored as `0`, or reported. A single shop-level rate/label — no per-medicine override or exemption exists in B3.
17. **Reported profit is COGS-based.** Gross profit is `net sales − SUM(sale_items.cogs)`; net profit is `gross profit − expenses`. Any sale line without a captured cost marks the period **partial** and the UI must say so. No margin constant exists anywhere.
18. **Reports are read-only aggregations over local SQLite** with no network dependency, and are permission-gated at the data layer (`reports`), not merely by route.
19. **Exports are local-first.** They read SQLite, write a file through Expo's file system, and hand it to the native share sheet. They work fully offline. Exported money columns are decimal taka rendered from integer paisa at the boundary.
20. **Printing is best-effort and never silent.** A print attempt either reaches the device or reports a typed, localized error with a retry. There is no demo/no-op success path. Nothing in the money model depends on a print succeeding.
21. **The closing hour is a shop setting** (default 20, `0..23`) read by both the daily-summary notification and End of Day's "Today so far" chip.
22. **Every B3 write is permission-gated in `db/`**, re-checks the actor inside the transaction where the existing files already do, honours `assertSessionLive`, and enqueues outbox rows for every mutated table.
23. **No seed or demo data** in any B3 surface (CLAUDE.md rule 9): no sample suppliers, no mock OCR results, no example expenses.
24. **A supplier archive is refused while its outstanding payable is `> 0`** (founder decision D-9): `SUM(purchases.total − paid_amount − returned_credit)` over that supplier's non-deleted, non-voided purchases must be exactly `0`. The action returns a typed error naming the amount; it does not silently no-op.
25. **Thermal print output is English-only** (founder decision D-7); the app UI itself stays fully bilingual (bn/en) — only the ESC/POS byte stream drops Bangla.

---

## 6. IMPLEMENTATION ORDER

Ten bounded groups. Each is independently shippable and each ends green. Groups 1–2 are prerequisites for almost everything downstream.

| # | Group | Contents | Depends on |
|---|---|---|---|
| **1** | **Foundations & corrections** | One business-date helper, **locked to Asia/Dhaka** (W-1); permission-key reconciliation between `navigation/routes.ts` and `db/` (W-2); expose `creditMaxDays` in Settings (W-6); make the closing hour a setting and wire it to a true **OS-scheduled** `expo-notifications` trigger so it still fires with the app closed (W-5, D-11). Migration `0015` for closing hour + tax fields. W-3 stays on its safe owner-only create route until Group 6. | — |
| **2** | **Cash completeness** | `recordWithdrawal`; **mid-day reconcile as a field distinct from the day-close count** (D-2) with match/surplus/shortage on Cash Summary; the breakdown sheet with expandable Credit-Collections and Expenses details; owner/staff cash-sales split; opening-cash quick chips; saved toast; day-rollover previous-day prompt. Migration `0020` for the reconcile columns. | 1 |
| **3** | **Expenses completeness** | Three tabs; keypad + category circles; duplicate detection; saved banner; month-navigated Ledger with per-day grouping and totals; expense soft-delete voiding both rows; Analytics tab; summary strip. **Owner-only, no staff cap** (D-3, confirms current production, drops S-25). **Category taxonomy migrates to Rent/Salary/Utilities/Conveyance/Other** (D-4) via backfill migration `0021`. No receipt-photo capture (D-5). | 1, 2 |
| **4** | **Credit completeness** | Credit Sales search / outstanding header / settled pill / derived overdue badge / Make-Payment sheet; Customer Detail tabs, filter, purchase and settled cards, tiles, empty states; allocation visibility; collection method selector; `overdue_credit` notification generator. | 1 |
| **5** | **Supplier & payable completeness** | Supplier search, stats, edit, archive, row actions; Supplier Detail tiles, archive, expandable payment history, status pills; `recordSupplierPayment` with capping and drawer recompute. **Archive refused while outstanding payable > 0** (D-9, contract §5.24). | 1, 2 |
| **6** | **Purchase / invoice completeness** | Supplier Invoices list route; Supplier Invoice Detail route; **W-3 atomic navigation repoint from `/suppliers/purchase-create` to the new list**; purchase-line `status` + Mark Received; purchase void; duplicate detection; 3-step create flow with OCR scan, fuzzy match picker, Add-as-new, editable invoice date, sticky summary bar, confirm summary. | 1, 5 |
| **7** | **Purchase returns** | Negative movements to the original batch, supplier credit against the payable, required reason, closed-day guard, audit + outbox; payable expression updated (W-7). **Founder-approved for B3 Beta** (D-10) — no longer founder-gated. | 6 |
| **8** | **Reports** | `db/reports.ts` real implementation: date-range totals, daily trend, top medicines, payment split, monthly P&L with per-category expenses and partial-COGS detection, 6-month trend, this-vs-last expense comparison. Report and Monthly Report screens. | 1, 2, 3 |
| **9** | **Tax / VAT** | Setting + migration; **MRP-inclusive** extraction applied to the post-discount total (contract §5.16); `tax`/`tax_rate_bp`/`tax_label` on `sales`; report/export/print lines. **Founder-approved** (D-1: inclusive, shop-level rate/label only, 2026-08-22) — no longer founder-gated. | 1, 8 |
| **10** | **Export & printing** | Data Export screen with the four datasets, **CSV + genuine XLSX** writers (D-6), Expo file write + share sheet; ESC/POS builder producing **English-only** output while the app UI stays bilingual (D-7); native BLE printer module supporting **generic BLE ESC/POS plus the prototype's tested Epson TM-m30/T20/T82 and Star SM-L200/L300/T300i** (D-8); Printer Settings screen, test print, Monthly P&L print. **Requires a new dev/EAS build.** | 8 (9 for the tax line) |

Rationale for the order: cash and expenses feed every report and the EOD variance, so they precede reports. Suppliers precede purchases because a purchase needs a payable to move. Returns follow purchases and are no longer founder-gated (D-10). Tax touches checkout — B2 territory — so it stays deliberately late even though D-1 is resolved. Printing is last because it is the only group that cannot be verified without new native binaries — the only remaining hard sequencing constraint from founder decisions, since D-6/D-7/D-8 fix *what* ships, not *when*.

---

## 7. DB / SYNC IMPACT

### 7.1 Migrations (local Drizzle + mirrored PostgreSQL; **none executed**)

| Migration | Change | Notes |
|---|---|---|
| `0015_b3_shop_settings` | `shop_b2_settings` += `closing_hour INTEGER NOT NULL DEFAULT 20 CHECK (closing_hour BETWEEN 0 AND 23)`, `tax_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000)`, `tax_label TEXT NOT NULL DEFAULT 'VAT'` | Additive, defaulted, no backfill. Table is already synced and allowlisted, so **no allowlist or RLS change**. Mirrors the `0013`/`0014` credit-period pattern exactly. |
| `0016_sales_tax` | `sales` += `tax INTEGER NOT NULL DEFAULT 0`, `tax_rate_bp INTEGER NOT NULL DEFAULT 0`, `tax_label TEXT` | Snapshot columns so a later rate change never rewrites history. Existing rows read as untaxed, which is correct. **Gated on D-1.** |
| `0017_purchase_item_status` | `purchase_items` += `status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','pending'))`, `received_at TEXT` | Existing rows default to `received`, preserving current behavior. |
| `0018_purchase_void` | `purchases` += `voided_at TEXT`, `voided_by TEXT REFERENCES users(id) ON DELETE RESTRICT` | Every FK declares `onDelete` (CLAUDE.md rule 2). |
| `0019_payment_note` | `payments` += `note TEXT` | Carries the withdrawal reason and the supplier-payment note. Avoids a new table for a single nullable field. |
| `0020_cash_reconcile` | `cash_drawer` += `reconciled_counted_amount INTEGER`, `reconciled_at TEXT`, `reconciled_by TEXT REFERENCES users(id) ON DELETE RESTRICT` | Additive, nullable, defaulted to unset. Separates the mid-day reconcile from `closing_counted` (D-2, contract §5.9). Same synced/allowlisted table as `closing_counted`; no allowlist change. |
| `0021_expense_category_taxonomy` | `expenses.category` CHECK constraint changes from the 6-value production set (`rent, electricity, transport, staff_salary, supplies, other`) to the 5-value set (`rent, salary, utilities, conveyance, other`); **existing rows are backfilled**: `electricity`→`utilities`, `transport`→`conveyance`, `staff_salary`→`salary`, `supplies`→`other` | **Not additive — the only migration in this plan that rewrites existing data.** Must run the `UPDATE` before the new `CHECK` is applied, inside one transaction, on both SQLite and the Postgres mirror. Requires its own verification pass against real shop data before remote execution (D-4, 2026-08-22). |

**No new tables are required.** `purchase_returns` already exists and is already synced; group 7 is pure code.

### 7.2 Sync

- `HYDRATION_TABLE_ORDER` (`apps/mobile/db/sync-helpers.ts`) and `SYNCED_TABLES` (`backend/supabase/functions/sync/_shared/tables.ts`) already contain every table B3 touches: `suppliers`, `purchases`, `purchase_items`, `purchase_returns`, `credits`, `payments`, `credit_payment_allocations`, `expenses`, `cash_drawer`, `shop_b2_settings`, `audit_logs`. **No allowlist change is needed.**
- Every new write path must call `recordChange` for each mutated row. Multi-row money operations (withdrawal + drawer; supplier payment + purchase + drawer; expense delete + payment delete + drawer; purchase return + movements + payable + drawer) must use a `SyncOperationGroup` with an asserted `expectedCount`, exactly as `collectPayment` does — otherwise a partially-pushed operation can land in the cloud.
- Purchase-return movements land after `purchases`/`batches` in the existing FK-safe order; no reordering is required.
- Deterministic ids: purchase-return and payment child rows must derive from the operation id so a retry from two devices converges (the `domain/invoice.ts` rationale applies unchanged).
- `0020`'s new `cash_drawer` columns and `0021`'s `expenses.category` value-domain change touch tables already in both lists — **no allowlist change** for either. `0021` is the one case where a device syncing on an **old build** could push a category value the new CHECK constraint rejects; the client-side category enum and the server CHECK must roll out together, not staggered across app versions.

### 7.3 RLS / grants

- Additive columns on already-policied tables inherit their table's RLS and grants. `0015`–`0019` need **no policy change**, matching the reasoning already recorded in `20260822000000_owner_dashboard_credit_period.sql`.
- No new RPC is required for B3. (B2's refund claim is the only server-authority exception and it stays as-is.)
- Confirm before shipping that the `authenticated` role's column-level grants on `sales`, `purchases`, `purchase_items`, and `payments` are table-wide rather than column-enumerated; if any are enumerated, the new columns need an explicit grant.
- `0020` is additive and needs no policy change either. `0021` is different: it alters a CHECK constraint and rewrites existing values, not a policy or a grant — but the CHECK must exist identically on the Postgres mirror, and the backfill `UPDATE` must run there too, in the same remote migration. This is data-shape work, not RLS work, but it is the first migration in this plan where "run it remotely" means more than adding a column.

### 7.4 Money / stock invariants (B3 additions to the standing set)

1. Every money value is integer paisa; taka appears only at the UI boundary through `formatMoney`/`fromTaka`.
2. `expected_cash` is computed **only** by `domain/cashFormula.expectedCash`. No screen, query, or report re-derives it.
3. `closing_expected` is recomputed from the ledger inside the transaction that changed any of its terms — never assigned from a rendered value.
4. `assertBusinessDateOpen` runs first in every money/stock transaction, before any row is touched.
5. Customer credit balance and supplier payable are always derived; no denormalized total is stored.
6. A collection never exceeds the customer's outstanding balance; a supplier payment never exceeds the invoice's remaining balance.
7. `batches.stock` is never assigned; stock moves only through signed `inventory_movements`.
8. A pending purchase line contributes neither stock nor total until it is received.
9. A purchase return's quantity never exceeds `purchase_items.qty − already_returned`, and its credit never exceeds that line's value.
10. Tax is **extracted, not added** — resolved once at sale time from the post-discount total the customer pays, in integer paisa, and snapshotted with its rate and label (MRP-inclusive, D-1).
11. Reported COGS comes from `sale_items.cogs` only; a missing cost marks the period partial and is never imputed.
12. Every completed record is immutable; corrections are new rows (return, reversal, adjustment), never edits.
13. Every FK declares an explicit `onDelete` (CLAUDE.md rule 2).
14. Every query and write validates same-shop identity and the current permission.
15. A mid-day cash reconcile never locks the business date or writes `closing_counted`; only End of Day's close does (D-2).
16. A supplier archive is refused while its computed payable is `> 0` (D-9).
17. Printed ESC/POS output is English-only; this never gates or alters the underlying money/stock write (D-7).

### 7.5 Printer / export / storage behavior

**Printer**
- A native BLE ESC/POS module (RN BLE) replaces Web Bluetooth. Requires a new dev client and a fresh EAS build — this is the only B3 group that cannot ship over-the-air.
- One persisted device record (`{deviceId, name, pairedAt}`) in MMKV, **not** in SQLite: it is device-local, never synced, and must not follow a shop to another phone.
- Chunked writes with a bounded retry; every failure maps to a typed code (`out-of-paper`, `out-of-range`, `disconnected`, `send-failed`, `no-device`, `unsupported`, `unknown`) rendered in both languages with a retry action.
- **No demo/no-op success path.** Unpaired or unreachable is an error.
- Print call sites in B3: Monthly P&L and Test Print. Sale-receipt printing is not a prototype behavior (RC-4) and is therefore out of B3.
- Bangla on 32-column thermal paper is a real constraint: **locked (D-7) — English-only print output.** The app UI stays fully bilingual; only `buildReceipt`'s byte stream is English.
- Supported models: **generic BLE ESC/POS plus the prototype's tested Epson TM-m30/T20/T82 and Star SM-L200/L300/T300i** (D-8) — the prototype's Supported-Models card (PR-9) ports unchanged.

**Export**
- Written with `expo-file-system` into the app's cache directory, then handed to `expo-sharing`. Works offline; the prototype's `navigator.onLine` gate is dropped (S-20).
- **Genuine XLSX ships alongside CSV** (D-6, resolves S-21): a real OOXML spreadsheet writer, not an HTML table with a `.xls` extension. The same row builders and date-range/dataset rules feed both formats; the format toggle picks the writer, not the data.
- CSV is UTF-8 **with BOM** so Bangla and `৳` survive Excel. Values containing `,`, `"`, or a newline are quoted with doubled quotes.
- Money columns are decimal taka rendered from paisa at the boundary; dates are ISO `YYYY-MM-DD`.
- Export files are transient cache artifacts, deleted on the next export of the same dataset. Nothing exported is written back into SQLite or the sync queue.
- An export reads only rows the actor may read; the same permission gate as the corresponding screen applies at the data layer.

**Storage**
- No new persistent local storage beyond the migrations above. Printer pairing → MMKV. Export files → cache. Expense receipt images, if D-5 approves them, follow B2's prescription-attachment pattern: copy from the temporary URI into durable app-owned storage before commit, then upload resumably.

---

## 8. OWNER DASHBOARD CROSS-LINKS INTO B3

Every dashboard affordance and where it must land once B3 is real.

| Dashboard element | Current target | B3 requirement |
|---|---|---|
| KPI "Expected in drawer" | `/cash-summary` | Lands on the completed Cash Summary; the inline **Set now** affordance opens the opening-cash modal with quick chips. |
| KPI "Outstanding credit" (+ customer count) | `/credit/credit-sales` | Figure and the list must agree — resolves W-4 (the 50-row cap). |
| KPI "Supplier payable" (+ supplier count) | `/suppliers/list` | Payable expression must match the one on Supplier Detail, including return credit after group 7. |
| KPI "Yesterday's sale" | Previous-day modal | Shares its data source with the day-rollover prompt added in group 2. |
| Alert card "N people have credit" + overdue row | `/credit/credit-sales` | The overdue count must use the same derived rule as the badge and the notification (contract 3). |
| Alert card "Sales history" | `/reports/sales-history` | B2 surface; unchanged. |
| "Ready to close / Complete Day" | `/end-of-day` | Lands on the completed End of Day. |
| Quick link **Expense** | `/expenses` | Completed Expenses. |
| Quick link **Report** | `/reports/report` | Currently a TODO stub — group 8. |
| Quick link **Data Export** | `/reports/data-export` | Currently a TODO stub — group 10. |
| Quick link **Printer** | `/settings/printer-settings` | Currently a TODO stub — group 10. |
| Quick link **Suppliers** | `/suppliers/list` | Completed Suppliers. |
| Quick link **Supplier Invoices** | `/suppliers/purchase-create` | **Safe temporary owner-only target. Repoint only when Group 6 adds the invoices list** (W-3). |
| More tile **Cash Drawer / End of Day** | `/cash-summary`, `/end-of-day` | Permission key must match the data layer (W-2). |
| More tile **Report** | `/reports/report` | Group 8. |
| Notification `daily_summary` | `/cash-summary` | Trigger hour becomes configurable (W-5). |
| Notification `overdue_credit` | `/credit/credit-sales` | Route and permission mapping exist; **the generator does not** — group 4. |

---

## 9. FOUNDER DECISIONS — LOCKED 2026-08-22

All eleven decisions are locked. Each row states the resolution, not the open question it replaced.

| # | Decision (locked) | Rationale | Unblocks |
|---|---|---|---|
| **D-1** | Tax/VAT ships in B3 Beta. **MRP-inclusive** — tax is extracted from the shelf/sale price the customer already pays, never added on top. **Shop-level rate + label only** — no per-medicine override or exemption. | Matches how Bangladeshi pharmacy retail reads a shelf price; an exclusive add-on would silently inflate every printed total beyond the sticker price. | Group 9, migration `0016`. Checkout math: contract §5.16. |
| **D-2** | Cash Summary's reconcile is a **separate mid-day count**, distinct from End of Day's close. It never locks the business date. | The prototype's ad-hoc count (CH-11) and production's day-lock count are different acts; collapsing them onto one field would let a mid-day count masquerade as a close. | Group 2, contract §5.9, migration `0020`. |
| **D-3** | Expenses stay **owner-only**, matching current production. The prototype's staff access and its ৳500 cap are **not ported**. | Confirms the existing production permission model over the prototype's; no staff-facing cap has a subject to apply to. | Group 3 (removes S-25 as a live question). |
| **D-4** | Expense categories become **Rent, Salary, Utilities, Conveyance, Other** — the prototype's 5-category set replaces production's existing 6-category set. | Reports group by category; locking the taxonomy now, before more shops accumulate history under the old set, is cheaper than migrating later. | Group 3, group 8. Requires backfill migration `0021` (W-8). |
| **D-5** | **No expense receipt photos in Beta.** The unused column is dropped from the B3 surface, not wired up. | Avoids an image picker, a native-build dependency, and a new attachment path on the sync surface for a feature not needed at launch. | Group 3, group 10 (removes a native-build dependency from both). |
| **D-6** | Export ships **both CSV and a genuine XLSX** — a real OOXML spreadsheet writer, not the prototype's HTML-as-`.xls`. | Two honest formats cost one dependency; shipping the prototype's mislabeled file would carry a known defect (S-21) forward on purpose. | Group 10. |
| **D-7** | Thermal print output is **English-only** in Beta. The app UI itself stays fully bilingual (bn/en) — only the ESC/POS byte stream is English. | Bangla on 32-column ESC/POS needs a code-page/bitmap path across every supported model; English-only ships now without that investment. | Group 10, contract §5.25. |
| **D-8** | Supported printers: **generic BLE ESC/POS**, plus the prototype's tested **Epson TM-m30/T20/T82** and **Star SM-L200/L300/T300i**. | Matches the prototype's own Supported-Models card (PR-9) exactly — no scope expansion or reduction. | Group 10 (native module scope). |
| **D-9** | A supplier **cannot be archived** while its outstanding payable is `> 0` — reverses the prototype's unconditional archive (SD-5). | Archiving a supplier the shop still owes would hide a real debt from the payable list and the dashboard KPI. | Group 5, contract §5.24 (new SUPERSEDED entry S-29). |
| **D-10** | **Purchase returns ship in B3 Beta**, not deferred to P1. | B2 already deferred them "unconditionally to B3"; the schema, sync allowlist, and B2's own deferral all already assume this. | Group 7 — fully unblocked, no remaining founder gate. |
| **D-11** | The closing-time notification **must fire even when the app is fully closed** — true OS-scheduled delivery, not only a foreground check. | A drawer-count reminder that only fires while the app happens to be open misses most shops at closing time. | Group 1. Uses `expo-notifications` scheduled triggers on the module already linked for today's foreground local notification — **assumed not to require a new native build**; verify during Group 1 before treating that as free. |

**Also locked, 2026-08-22:**
- **Business date = Asia/Dhaka, everywhere**, for every money read and write (resolves W-1 / Blocker B-1). `dhakaBusinessDate` wins; `localBusinessDate` is replaced, not kept as an alternate path. The decision is locked — the Group 1 code change is still pending.
- **Route/data permission-key drift is fixed in Group 1**, not deferred (resolves W-2 / Blocker B-5): `navigation/routes.ts` and every `db/` guard must agree on one key set, verified by a table-driven parity test.
- **Every prototype-visible B3 feature ships unless this plan explicitly marks it SUPERSEDED (§4) or a founder decision names a visible-behavior change** (D-1's inclusive tax, D-9's archive guard). This is now a founder-confirmed constraint on the whole plan, not a drafting assumption.

With D-1 through D-11 locked, **Blocker B-2 (open founder decisions) is resolved** — see §12.

---

## 10. MISSING TESTS

Grouped by the implementation group that introduces them. Production repo standard is 80 % (`.claude/rules/ecc/common/testing.md`), and CLAUDE.md's human-review workflow requires a demonstrated passing test for anything touching money or stock.

**Group 1 — foundations**
- One business-date helper: same instant, non-Dhaka device timezone, asserts cash/credit/purchase writes all resolve to the same date.
- Route rule ↔ data-layer permission parity: a table-driven test asserting every `RULES` entry's key is the key the destination's `db/` module requires.
- `credit_max_days` round-trip: save → sync payload → dashboard overdue count.
- Closing hour: `0`, `20`, `23` boundaries drive both the notification and the "Today so far" chip.

**Group 2 — cash**
- `recordWithdrawal`: happy path; zero/negative rejected; closed day rejected; drawer recompute; outbox rows; operation-count assertion.
- Reconcile: match / surplus / shortage; `|diff| < ৳0.005` treated as match; counted persisted once per date.
- Cash-sales owner/staff split sums exactly to `cashSales`.
- Day rollover: first-ever run yields no prompt; same-day yields none; crossing local midnight yields exactly one.
- Regression: `expectedCash` still returns the fixed formula with every new writer in play.

**Group 3 — expenses**
- Duplicate detection: same category+amount same day flags; different day does not; "Log Anyway" writes.
- Soft-delete voids **both** the expense and its payment; drawer recomputes; closed day rejected; a half-deleted state is impossible.
- Ledger grouping: month boundaries, Today/Yesterday labels, per-day sums, next-month disabled on the current month.
- Analytics: MoM with a zero previous month; top-5 selection; percentages sum sanely.

**Group 4 — credit**
- Overdue derivation at `credit_max_days − 1`, exactly `credit_max_days`, and `+1` days.
- Purchase-history filter: settled excluded from purchases, partial excluded from settled, both newest-first.
- Make-Payment sheet: Half/Full/Clear; over-balance rejected at both the UI and the data layer.
- Zero-balance customer remains listed with a Settled pill.
- `overdue_credit` notification: created once per day, deduped, permission-filtered, deep-links correctly.
- Search returns the same rows the outstanding total is computed from (no 50-row divergence).

**Group 5 — suppliers**
- `recordSupplierPayment`: capping at remaining; refuses on COD and on fully paid; increments `paid_amount` and writes the payment atomically; drawer recompute; closed day rejected.
- Payable equals `total − paid` across mixed COD/credit purchases.
- This-month vs last-month delta at month boundaries.
- Archive with an outstanding payable behaves per D-9.

**Group 6 — purchases**
- Pending line: no movement, excluded from total; Mark Received applies exactly one movement and recomputes total + pending count; double-receive rejected.
- Void: allowed with zero movements and zero payments; rejected otherwise, with the reason.
- Duplicate detection within and outside the 0.5 % tolerance; acknowledgement gate.
- OCR match: score ≥ 0.7 auto-matches, below does not; Add-as-new requires an explicit sale price.
- Existing invariants hold: expiry mismatch, duplicate batch, deleted batch, non-shop medicine, in-transaction owner recheck.

**Group 7 — returns**
- Return restores exactly the returned quantity to the original batch; over-return rejected; expired-stock rules preserved.
- Supplier credit reduces the payable by exactly the credited amount.
- Closed day rejected; audit + outbox written; two-device retry converges (deterministic ids).

**Group 8 — reports**
- Date-range totals match `getEndOfDaySummary` for a single-day range (cross-check between two independent aggregations).
- Partial-COGS detection: a sale line without a captured cost flags the period and names the medicine.
- Monthly P&L arithmetic: `net = gross − expenses`; loss state; per-category expense lines sum to the operating total.
- Previous-period comparison with a zero previous period.
- 6-month trend across a year boundary.
- Reports are permission-gated at the data layer, not only by route.

**Group 9 — tax**
- Rate `0` writes `0` and renders no line.
- Rounding at half-paisa boundaries; header total equals the sum of its parts exactly.
- Snapshot: changing the shop rate does not alter a historical sale's stored tax.
- Tax appears in the monthly export and print only when `> 0`.

**Group 10 — export / print**
- CSV escaping for `,`, `"`, newline, `৳`, and Bangla text; BOM present.
- Paisa → taka rendering at the export boundary.
- Export works with the device offline.
- Row builders honour the date range for Sales and Expenses.
- ESC/POS builder: byte-exact snapshot for `buildReceipt`; column padding at 32 chars; label+value longer than the width degrades safely.
- Printer error mapping for each of the seven codes; retry re-attempts; **no silent success when unpaired**.

**Cross-cutting**
- No screen imports `getCashSummarySync` (W-9).
- Every new `db/` write enqueues outbox rows for every table it mutates, with a correct `expectedCount`.
- Session-handover: every new write path refuses to commit under a stale actor (extend `tests/switch-user-writes.test.tsx`).
- Fresh-shop emptiness: no B3 surface renders seed data (CLAUDE.md rule 9).

---

## 11. EXPLICIT EXCLUSIONS

Named so nothing is silently omitted:

- **B4** — Plans, trial state, premium gating, PlanPayment, PlanSuccess, multi-shop management, shop switching, and the **Multi-Shop Comparison block inside Report** (RP-13).
- **Admin Panel and any location surface.**
- **Phase-C visual polish** — spacing, typography, colour, motion, and pixel-level prototype matching. This plan grades function only; a visual mismatch is not a functional failure.
- **Sale-receipt printing** — not a prototype behavior (RC-4). Only the Monthly P&L and Test Print call sites are in scope.
- **Backup key restore, remote wipe** — security phase, already marked as such in production Settings.
- **Costing-method selection** — superseded (S-13), not deferred.

---

## 12. BLOCKERS

| # | Blocker | Impact | Resolution |
|---|---|---|---|
| **B-1** | **Two business-date definitions in the money layer** (`localBusinessDate` vs `dhakaBusinessDate`). | On a device outside Asia/Dhaka, a credit collection and an expense recorded minutes apart can post to different business dates, corrupting `closing_expected`, the EOD variance, and every report that groups by day. This is a live correctness defect, not just a B3 obstacle. | **Decision locked 2026-08-22: Asia/Dhaka wins.** Still blocking until Group 1 writes the fix and its regression test. |
| ~~**B-2**~~ | ~~Founder decisions D-1 … D-11 are open.~~ | — | **RESOLVED 2026-08-22.** All eleven decisions are locked — see §9. No group is waiting on a founder answer any longer. |
| **B-3** | **Native BLE printer module requires a new dev client + EAS build.** | Group 10's printing half cannot be verified on-device until a new binary exists. Export does not have this dependency. | Schedule the build alongside group 8 so group 10 is not the thing waiting. Unaffected by today's decisions. |
| **B-4** | **The PostgreSQL mirror of `0013` (`credit_max_days`) has not been executed remotely.** | Group 1 exposes the credit-period setting in the UI; syncing it to a cloud column that does not yet exist will fail the push. | The remote migration must be executed before the setting ships. Out of this plan's authority — needs the separate migration-execution approval. **Pre-existing; unrelated to today's decisions.** |
| **B-5** | **Permission-key drift between route rules and the data layer** (W-2). | Adding B3 routes on top of an inconsistent map risks a route that admits a session the data layer then rejects, which reads as a broken screen rather than a denial. | **Locked to Group 1, not deferred.** Reconcile with a table-driven parity test; still blocking until that code lands. |

**Note on `0021` (expense-category backfill, D-4):** not yet written — no code exists for it, so it is not a blocker today — but flagged in advance because it is the first migration in this plan that rewrites existing rows rather than only adding columns (§7.1). Its eventual remote execution deserves the same verified, non-routine handling as B-4, plus a check against real shop data before it runs.

---

## READY FOR IMPLEMENTATION: **NO**

Still blocked by **B-1** (business date — decision locked to Asia/Dhaka, Group 1 code not yet written), **B-4** (the credit-period cloud column has not been migrated remotely — pre-existing, unrelated to today's update), and **B-5** (permission-key drift — locked to Group 1, code not yet written). **B-2 is resolved:** D-1 through D-11 are locked (§9); no group waits on a founder decision anymore.

**Unblocked now:** Group 1 may begin immediately — it *is* the fix for B-1 and B-5, carries no founder dependency, and now also carries the D-11 notification-scheduling work and migration `0015`. Groups 2, 3, 4, 5, 6, 8, and 9 become ready as soon as Group 1 lands — none of them wait on a founder answer any longer. **Group 7 (returns) is fully unblocked** by D-10 and depends only on Group 6. **Group 10** is founder-resolved (D-6/D-7/D-8) but still needs **B-3**, the new BLE dev client/EAS build, before its printing half can be verified on-device.

Two items still need attention outside this plan's authority: **B-4**'s remote migration for `credit_max_days`, and the eventual remote execution of `0021` — the expense-category backfill — which is the first non-additive migration in this plan and the one that most deserves a careful, verified rollout rather than a routine push.

Per CLAUDE.md rule 10, no code touching the database, sync, or money is written until this plan is explicitly approved.
