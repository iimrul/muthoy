# Muthoy (মুঠোয়) — Standardize All Screen Headers

## The problem
Headers are inconsistent across the app — at least six different styles:
- Light gray `bg-[#F4F4F7]` (Checkout, Cart, CreditSales, StaffManagement, CashSummary)
- Green gradient `from-[#059669]` (ExpenseTracking, ExpiryManagement)
- Plain white (Suppliers, SupplierInvoices, SupplierInvoiceCreate, Report,
  SalesHistory, CustomerCreditDetail)
- Solid green `bg-[#059669]` (NotificationCenter)
- Solid `bg-[#047857]` (MultiShopManagement)
- The clean soft-green style (Plans, PlanPayment) ← THIS IS THE TARGET

Make every screen header match the Plans / PlanPayment style, EXCEPT two screens
that must stay exactly as they are: MorningDashboard and Registration.

---

## THE TARGET HEADER (copy this exactly — from Plans.tsx / PlanPayment.tsx)

```tsx
{/* Standard Header */}
<div className="sticky top-0 z-10 bg-[#ECFDF5]/90 backdrop-blur-sm px-4 pt-safe-top pt-4 pb-3 flex items-center gap-3">
  <button
    onClick={() => navigate(-1)}
    className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/70 transition-colors"
  >
    <ChevronLeft className="w-5 h-5 text-[#065F46]" />
  </button>
  <div className="flex-1 text-center">
    <p className="text-[15px] text-[#065F46]" style={{ fontFamily: "'Hind Siliguri', sans-serif" }}>
      {t("পেজের শিরোনাম", "Page Title")}
    </p>
  </div>
  <LanguageToggle />
</div>
```

Key traits of this header:
- Translucent Soft Green background `bg-[#ECFDF5]/90` with `backdrop-blur-sm`
- `sticky top-0` so it stays on scroll
- Circular back button on the LEFT with `ChevronLeft` in Deep Green `#065F46`
- Centered title in `#065F46`, 15px, Hind Siliguri
- `LanguageToggle` on the RIGHT
- The page body background should also be `bg-[#ECFDF5]` so the header blends in

---

## APPLY TO THESE SCREENS (replace their current header with the target)

For each, keep the screen's existing title text (translated), keep any extra header
actions (like a filter or add button) but restyle them to fit — and where a screen's
header has a second row (tabs, search, date filter), keep that row BELOW the
standard header, not merged into it.

1. **Checkout** — title "চেকআউট / Checkout". Remove the `bg-[#F4F4F7]` bar.
2. **Cart** — title "কার্ট / Cart".
3. **CreditSales** — title "বাকি বিক্রয় / Credit Sales". Keep its tab/search row below.
4. **StaffManagement** — title "স্টাফ ব্যবস্থাপনা / Staff Management".
5. **CashSummary** — title "নগদ সারসংক্ষেপ / Cash Summary".
6. **ExpenseTracking** — title "খরচ / Expenses". Replace the green gradient header.
7. **ExpiryManagement** — title "মেয়াদ ব্যবস্থাপনা / Expiry". Replace the gradient.
8. **Suppliers** — title "সরবরাহকারী / Suppliers". Replace the white header.
9. **SupplierInvoices** — title "সরবরাহ ইনভয়েস / Supplier Invoices".
10. **SupplierInvoiceCreate** — title "নতুন ইনভয়েস / New Invoice".
11. **SupplierDetail** — title = supplier name (dynamic).
12. **Report** — title "রিপোর্ট / Report". Keep its date/tab row below.
13. **MonthlyReport** — title "মাসিক রিপোর্ট / Monthly Report".
14. **SalesHistory** — title "বিক্রয় ইতিহাস / Sales History".
15. **CustomerCreditDetail** — title = customer name (dynamic).
16. **NotificationCenter** — title "নোটিফিকেশন / Notifications". Replace solid green.
17. **MultiShopManagement** — title "একাধিক দোকান / Multi-Shop". Replace `bg-[#047857]`.
18. **Settings** — title "সেটিংস / Settings".
19. **AddMedicine** — title "ওষুধ যোগ করুন / Add Medicine".
20. **OCRScan** — title "স্ক্যান / Scan" (note: if the scan screen is full-bleed
    camera, keep the camera area but put this header as an overlay at top).
21. **DataExport** — title "ডেটা এক্সপোর্ট / Data Export".
22. **PrinterSettings** — title "প্রিন্টার / Printer".
23. **StaffSalesView** — title "স্টাফ বিক্রয় / Staff Sales".
24. **SaleEntry** — title "বিক্রয় / Sale" (keep its search bar + filter chips row
    BELOW the standard header).

For dynamic-title screens (SupplierDetail, CustomerCreditDetail), pass the entity
name as the title instead of a static string.

---

## DO NOT TOUCH (leave headers exactly as they are)

- **MorningDashboard** — its `bg-[#047857]` top bar with greeting, shop switcher, and
  notification bell is the intended home-screen header. Keep it.
- **Registration** — its logo splash / branded intro header is intentional. Keep it.
- **OTPVerification, PINLogin, PINSetup, RoleSelect, StaffLogin** — these are
  pre-login full-screen flows; leave their layouts as-is unless they already use a
  back button, in which case only match the back-button style.
- **PlanSuccess** — it's a celebratory full-screen state, not a standard page; leave it.

---

## CONSISTENCY RULES

- Import `ChevronLeft` from lucide-react and `LanguageToggle` in each updated screen.
- Use `navigate(-1)` for back, EXCEPT where a screen should return to a specific
  parent (e.g. SupplierDetail → /app/suppliers); keep those explicit targets.
- Body background `bg-[#ECFDF5]` on every standardized screen so the translucent
  header blends.
- Title always Deep Green `#065F46`, 15px, Hind Siliguri, centered.
- If a screen has a right-side action (add, filter), place it where LanguageToggle is,
  OR keep LanguageToggle and move the action into the body — do not crowd the header
  with more than two right-side items.
- Keep secondary rows (tabs, search, filters) as a separate block below the header.

## VERIFICATION
Navigate through every screen: the header should look identical in structure on all
of them (soft-green translucent, left back chevron, centered title, right toggle) —
except MorningDashboard and Registration, which keep their distinct headers.
