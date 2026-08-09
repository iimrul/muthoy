# ExpenseTracking.tsx — Complete Fix Prompt

Fix every issue in `src/app/screens/ExpenseTracking.tsx`. Do not touch any other file.
All 7 fixes are independent. Apply all of them.

---

## FIX 1 — Delete the dead cashDrawer mutation

In `saveExpense()`, remove these lines entirely:

```
const drawerStr = localStorage.getItem("cashDrawer");
if (drawerStr) {
  const drawer = JSON.parse(drawerStr);
  drawer.currentAmount = (drawer.currentAmount || 0) - expenseAmount;
  localStorage.setItem("cashDrawer", JSON.stringify(drawer));
}
```

Why: `getCashBreakdown()` in `cashCalculation.ts` calculates the drawer by calling
`getTodayExpenses()` which reads directly from the `"expenses"` array. It never reads
`cashDrawer.currentAmount`. This mutation writes to a key nobody reads, creating a
permanently drifted value in localStorage. `notifyCashUpdated()` (already called one
line above) is all that is needed — it triggers every subscriber to re-read from
`getCashBreakdown()` which already has the correct number.

---

## FIX 2 — Add a persistent summary strip above the tabs

Add state at the top of the component:

```typescript
const todayExpenses = useMemo(() => {
  const today = new Date().toDateString();
  return expenses.filter(e => new Date(e.timestamp).toDateString() === today);
}, [expenses]);

const todayTotal = todayExpenses.reduce((sum, e) => sum + e.amount, 0);
```

Insert this strip between the header and the tabs — sticky, always visible regardless
of which tab is active:

```
Background: white
Border-bottom: 1px solid #E5E7EB
Padding: 10px 16px
Layout: 3 columns side by side

Left column:
  Label: "এই মাস" / "This Month" — 10px uppercase #6B7280
  Value: ৳ {thisMonthTotal} — DM Mono 18px bold #DC2626

Center column:
  Label: "আজ" / "Today" — 10px uppercase #6B7280
  Value: ৳ {todayTotal} — DM Mono 16px bold #DC2626

Right column:
  Label: "এন্ট্রি" / "Entries" — 10px uppercase #6B7280
  Value: {thisMonthExpenses.length} টি — DM Mono 16px bold #111827
```

Show this strip only when `canViewTotals` is true.

---

## FIX 3 — Add month navigator and date grouping to Ledger tab

Add state:

```typescript
const [ledgerMonth, setLedgerMonth] = useState(() => {
  const now = new Date();
  return { month: now.getMonth(), year: now.getFullYear() };
});
```

At the top of the Ledger tab content, add a month navigator row:

```
Layout: flex row, space-between, items-center
Padding: 0 0 12px 0

Left button:  ← ChevronLeft icon, 40×40px tap target
Center text:  Month name + year — "মে ২০২৬" / "May 2026" — Inter 600, 14px, #111827
Right button: → ChevronRight icon, 40×40px tap target
              Disabled and gray when ledgerMonth is the current month

Below navigator: total for selected month
  "মোট: ৳ {selectedMonthTotal}" — right aligned, DM Mono 13px #DC2626
```

Filter the ledger list:

```typescript
const ledgerExpenses = useMemo(() => {
  return expenses.filter(e => {
    const d = new Date(e.timestamp);
    return d.getMonth() === ledgerMonth.month && d.getFullYear() === ledgerMonth.year;
  });
}, [expenses, ledgerMonth]);

const selectedMonthTotal = ledgerExpenses.reduce((sum, e) => sum + e.amount, 0);
```

Group by date for display:

```typescript
const groupedByDate = useMemo(() => {
  const groups: Record<string, Expense[]> = {};
  ledgerExpenses.forEach(e => {
    const key = new Date(e.timestamp).toDateString();
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  });
  // Return sorted newest first
  return Object.entries(groups).sort((a, b) =>
    new Date(b[0]).getTime() - new Date(a[0]).getTime()
  );
}, [ledgerExpenses]);
```

Render the ledger as grouped sections. Each date group has:

```
Date header row (sticky within scroll):
  Background: #F9FAFB
  Padding: 6px 12px
  Left: date string — "আজ" if today, "গতকাল" if yesterday, else "১৫ মে" format
         Inter 600, 12px, #6B7280
  Right: daily total — "৳ {dailySum}" — DM Mono 12px #DC2626

Entry rows (same as current design, but add delete button):
  Right side of each row: Trash2 icon button, 36×36px tap target, #EF4444 color
  On tap: show inline confirm ("মুছবেন?") with ✓ and ✗ buttons replacing the trash icon
  On confirm:
    const updated = expenses.filter(e => e.id !== expense.id);
    setExpenses(updated);
    localStorage.setItem("expenses", JSON.stringify(updated));
    notifyCashUpdated();
```

---

## FIX 4 — Fix category bar percentages in Analytics tab

Change this line:

```typescript
// BEFORE
const maxCategoryAmount = Math.max(...categoryTotals.map((c) => c[1]), 1);

// AFTER — remove maxCategoryAmount entirely, use thisMonthTotal
```

In the bar chart rendering, change:

```typescript
// BEFORE
const percentage = (total / maxCategoryAmount) * 100;

// AFTER
const percentage = thisMonthTotal > 0 ? (total / thisMonthTotal) * 100 : 0;
const percentageLabel = percentage.toFixed(1) + "%";
```

In the row layout, add the percentage label between the category name and the amount:

```
Left: icon + category name
Center: percentage label — DM Mono 11px #6B7280
Right: ৳ amount
```

---

## FIX 5 — Fix the "Total Expenses" summary tile label

In the Analytics tab summary grid, the left tile currently shows
`formatNumber(thisMonthExpenses.length)` but labels it "মোট খরচ" / "Total Expenses"
which implies a monetary amount.

Change it to show the actual monetary total:

```typescript
// BEFORE
{formatNumber(thisMonthExpenses.length)}

// AFTER
৳ {formatCurrency(thisMonthTotal)}
```

Add a separate entry count below the amount in smaller text:
```
"{thisMonthExpenses.length} টি এন্ট্রি" — 11px #6B7280
```

---

## FIX 6 — After logging, show confirmation in Quick Log tab instead of switching to Ledger

Currently `saveExpense()` calls `setView("ledger")` at the end, which silently
switches tabs. Replace this with an inline success state in the Quick Log tab itself.

Add state: `const [justLogged, setJustLogged] = useState<string | null>(null);`

After saving, set `setJustLogged(category)` and clear it after 2 seconds:
```typescript
setJustLogged(category);
setTimeout(() => setJustLogged(null), 2000);
// Remove setView("ledger") — do not switch tabs
```

Show a success banner at the top of the Quick Log view when `justLogged` is set:

```
Background: #ECFDF5
Border: 1px solid #059669
Border-radius: 8px
Padding: 10px 14px
Layout: flex row, gap 8px, items-center
Icon: CheckCircle, 18px, #059669
Text: "খরচ সংরক্ষিত হয়েছে" / "Expense saved" — Inter 600, 13px, #047857
      Disappears after 2 seconds with fade-out transition
```

---

## FIX 7 — Add Trash2 to imports

The delete button in Fix 3 requires `Trash2` and `CheckCircle` from lucide-react.
Add them to the existing import line:

```typescript
import { ArrowLeft, Banknote, Home, Briefcase, Zap, Car, MoreHorizontal,
  TrendingUp, AlertTriangle, Save, X, Trash2, CheckCircle, ChevronLeft, ChevronRight
} from "lucide-react";
```

---

## SUMMARY OF ALL STATE ADDED

```typescript
const [ledgerMonth, setLedgerMonth] = useState({ month: new Date().getMonth(), year: new Date().getFullYear() });
const [justLogged, setJustLogged] = useState<string | null>(null);
const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
```

## DO NOT CHANGE

- The header design
- The category selector buttons
- The numeric keypad
- The duplicate warning modal
- The `checkDuplicate` logic
- The `handleLogExpense` function
- The `canViewTotals` and `expenseLimit` permission logic
- The Analytics month-over-month trend card (except the bar fix in Fix 4)
