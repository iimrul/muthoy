# SCREENS.md — Muthoy Prototype Screen Inventory
### 39 screens. Each maps to a spec section in docs/playbook/04-mobile-development.md
### or 05-admin.md. Use this as the index when a Cursor prompt needs to point at
### "the prototype's version of X."

## Auth & Onboarding
| Screen | Spec | Notes |
|---|---|---|
| Registration | Volume 4 — Authentication | Shop name + phone ONLY, no other fields |
| PINSetup | Volume 4 — Authentication | Dots + custom keypad (skip/backspace) pattern |
| PINLogin | Volume 4 — Authentication | Offline bcrypt-hash check |
| RoleSelect | Volume 4 — Authentication | Owner vs Staff entry point |
| StaffLogin | Volume 4 — Authentication | PIN-only, no phone needed |
| OTPVerification | Volume 4 — Authentication | Day 13 real Supabase phone OTP (P0/Beta) |

## Core POS
| Screen | Spec | Notes |
|---|---|---|
| MorningDashboard | Volume 4 — the one screen with its OWN header (not standardized) |
| SaleEntry | Volume 4 — Sales | FTS5 search, FEFO active-batch price display |
| Cart | Volume 4 — Sales | Zustand-backed, qty steppers |
| Checkout | Volume 4 — Sales | cash/credit, FEFO deduction, cash drawer update |
| OCRScan | Volume 4 — OCR/Barcode | ML Kit, read-only lookup on this screen |

## Inventory
| Screen | Spec | Notes |
|---|---|---|
| Inventory | Volume 4 — Inventory | List + active-batch display |
| AddMedicine | Volume 4 — Inventory | RHF+Zod, batch uniqueness enforced |
| ExpiryManagement | Volume 4 — Inventory | Sorted by real expiry date, never a day-count |

## Credit & Customers
| Screen | Spec | Notes |
|---|---|---|
| CreditSales | Volume 4 — Customer | বাকি tracking |
| CustomerCreditDetail | Volume 4 — Customer | Per-customer ledger |

## Suppliers & Purchases
| Screen | Spec | Notes |
|---|---|---|
| Suppliers | Volume 4 — Supplier | + address/email/contact_person |
| SupplierDetail | Volume 4 — Supplier | Purchase history + payable total |
| SupplierInvoices | Volume 4 — Purchase | |
| SupplierInvoiceCreate | Volume 4 — Purchase | invoice_no auto-generated |
| SupplierInvoiceDetail | Volume 4 — Purchase | |

## Cash & Financial Close
| Screen | Spec | Notes |
|---|---|---|
| CashSummary | Volume 3 — cash formula | Live expected-cash view |
| EndOfDay | Volume 3 — cash formula | Full daily close |
| ExpenseTracking | Volume 3 — expenses table | Creates payments + expenses rows |

## Reports
| Screen | Spec | Notes |
|---|---|---|
| Report | Volume 4 — Reports | Date-range totals |
| MonthlyReport | Volume 4 — Reports | |
| SalesHistory | Volume 4 — Reports | |
| DataExport | Volume 4 — Reports | |

## Staff
| Screen | Spec | Notes |
|---|---|---|
| StaffManagement | Volume 4 — Authentication + permissions matrix | |
| StaffHome | Volume 4 | Staff-role landing screen |
| StaffSalesView | Volume 4 | MUST be shop-scoped — see ANALYSIS.md |

## Multi-Shop & Plans
| Screen | Spec | Notes |
|---|---|---|
| MultiShopManagement | Volume 4 — Subscription | Pro=2 shops max, Ultra=unlimited |
| Plans | Volume 4 — Subscription | Free/Pro/Ultra pricing |
| PlanPayment | Volume 4 — Subscription | SSLCommerz/bKash |
| PlanSuccess | Volume 4 — Subscription | |

## Settings & System
| Screen | Spec | Notes |
|---|---|---|
| Settings | Volume 4 — Settings | Own-PIN change, backup key |
| PrinterSettings | Volume 4 — Settings | |
| NotificationCenter | Volume 4 — Notification | Unread count, severity styling |
| NotFound | — | 404/fallback route |
