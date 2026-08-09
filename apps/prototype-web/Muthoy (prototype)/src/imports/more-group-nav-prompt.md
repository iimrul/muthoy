# Portable POS — "More" Group Button in Bottom Navigation
## Implementation Prompt

---

## WHAT TO BUILD

Replace the current "Report" tab in the bottom navigation bar with a **"More" group button**. When tapped, it expands upward from the nav bar showing icon tiles for all the screens that were previously hard to reach. The interaction is inspired by iOS app folder groups — but adapted for a bottom nav context with a right-to-left fan animation.

---

## SCREENS THAT GO INSIDE THE GROUP

These 7 screens move out of isolated routes and into the group:

| Screen | Bangla Label | Icon (lucide-react) | Route |
|---|---|---|---|
| Report / Summary | রিপোর্ট | `FileText` | `/app/report` |
| Expense Tracking | খরচ | `Receipt` | `/app/expense` |
| Supplier Invoices | সরবরাহকারী চালান | `FileStack` | `/app/supplier-invoices` |
| Suppliers | সরবরাহকারী | `Truck` | `/app/suppliers` |
| Staff Management | স্টাফ | `Users` | `/app/staff` |
| Staff Sales View | বিক্রয় রিপোর্ট | `BarChart2` | `/app/staff-sales` |
| Audit Log | অডিট লগ | `ClipboardList` | `/app/audit-log` |

---

## THE GROUP BUTTON (closed state)

Replaces the "Report" tab in the existing bottom nav. Sits in the same grid slot.

```
Appearance (closed):
  - 4 small icon thumbnails arranged in a 2×2 grid inside a rounded square
  - Size of the outer square: 40×40px, border-radius 10px
  - Background: white, border: 1.5px solid #E5E7EB
  - The 4 visible icons (first 4 from the list above):
      top-left:     FileText (রিপোর্ট) — #059669
      top-right:    Receipt (খরচ) — #B45309
      bottom-left:  Truck (সরবরাহকারী) — #6B7280  
      bottom-right: "•••" text — #9CA3AF (represents remaining items)
  - Each icon cell: 18×18px, centered in its quadrant
  - Label below the square: "আরও" / "More" — same style as other nav labels
  - Active state (when any group screen is current route):
      outer square border: 1.5px solid #059669
      top indicator bar: same green bar used on other active tabs
      label color: #059669 bold

Tap behaviour:
  - First tap → opens the group (expanded state)
  - If already on a group route and group is closed → opens the group
  - Tapping anywhere outside the group panel → closes it
```

---

## THE GROUP PANEL (expanded state)

Slides up from above the nav bar with a spring animation. Contains all 7 screen tiles.

### Panel Container

```
Position:     absolute, bottom: 80px (sits just above the nav bar)
              right: 0 (anchored to the right side where the More button sits)
Width:        280px
Background:   white
Border-radius: 16px (all corners)
Border:       1px solid rgba(0,0,0,0.06)
Shadow:       0 -8px 32px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.06)
Padding:      16px
z-index:      50

Animation (open):
  transform: translateY(100%) → translateY(0)
  opacity: 0 → 1
  Duration: 280ms
  Easing: cubic-bezier(0.34, 1.56, 0.64, 1)  ← spring overshoot feel
  Each tile staggers: tile 1 = 0ms delay, tile 2 = 30ms, tile 3 = 60ms ... tile 7 = 180ms

Animation (close):
  transform: translateY(0) → translateY(100%)
  opacity: 1 → 0
  Duration: 200ms
  Easing: ease-in
  No stagger on close (all tiles leave together)

Backdrop:
  Full screen overlay behind the panel: rgba(0,0,0,0.25)
  Tap backdrop → close panel
  No blur (keep it lightweight)
```

### Panel Header

```
"আরও বিকল্প" / "More Options"
Font: Hind Siliguri / Inter, 12px, uppercase, letter-spacing 1px, #9CA3AF
Margin-bottom: 12px
```

### Tile Grid

```
Layout: 4 columns, gap 8px
Each tile: flex column, items-center, gap 4px

TILE (normal state):
  Icon container: 48×48px, border-radius 12px
  Icon: 22px lucide icon, centered
  Label: 10px, Inter/Hind 600, #374151, centered, max 2 lines, text-center

TILE (active — current route):
  Icon container background: #ECFDF5
  Icon container border: 1.5px solid #059669
  Icon color: #059669
  Label color: #059669, font-weight 700

TILE (inactive):
  Icon container background: #F9FAFB
  Icon container border: 1px solid #F3F4F6
  Icon color: matches each screen's tint color (see below)
  Label color: #6B7280

TILE PRESS:
  scale: 0.92, duration 100ms
  After press: navigate to route, close panel with 150ms delay

TILE COLORS (icon container bg tint on hover/active):
  Report:            #ECFDF5  icon #059669
  Expense:           #FEF3C7  icon #B45309
  Supplier Invoices: #EFF6FF  icon #2563EB
  Suppliers:         #F5F3FF  icon #7C3AED
  Staff Management:  #FFF1F2  icon #BE123C
  Staff Sales View:  #F0FDF4  icon #15803D
  Audit Log:         #FFF7ED  icon #C2410C
```

### Permission Filtering

```
- Tiles only render for screens the current user has permission to access
- Same permission rules as the existing allTabs filter in MainLayout.tsx
- If user is Staff (Cashier role): show only Report and Staff Sales View tiles
  (if they have reports permission)
- If user is Owner: show all 7 tiles
- If only 1-2 tiles are visible for a user: render them larger (spanning 2 columns each)
  instead of leaving an awkward half-empty grid
```

---

## STATE MANAGEMENT

Add to `MainLayout.tsx`:

```typescript
const [moreOpen, setMoreOpen] = useState(false);

// Close group when route changes (user navigated via tile tap)
useEffect(() => {
  setMoreOpen(false);
}, [location.pathname]);

// Close on outside tap (handled by backdrop overlay)

// Determine if current route is inside the group
const groupRoutes = [
  "/app/report", "/app/expense", "/app/supplier-invoices",
  "/app/suppliers", "/app/staff", "/app/staff-sales", "/app/audit-log"
];
const isGroupActive = groupRoutes.some(r => location.pathname.startsWith(r));
```

---

## UPDATED NAV BAR STRUCTURE

The existing nav renders tabs symmetrically around the center Scan FAB using `gridColumnStart`. The current 5 tabs fill columns 1,2,4,5 with Scan in column 3.

After this change:
- Remove "Report" from `allTabs`
- Add the "More" group button as a custom element in the right side of the grid (column 5)
- All other tabs (Home, Sale, Inventory, Credit) remain exactly where they are
- The More button uses the same height/flex layout as other tabs, just renders the 2×2 grid icon instead of a single lucide icon

```
Col 1: Home        (হোম)
Col 2: Sale        (বিক্রয়)
Col 3: SCAN FAB    (elevated, always center)
Col 4: Inventory   (ইনভেন্টরি)
Col 5: More Group  (আরও)
```

For Staff (Cashier): only Sale (col 2) and Inventory (col 4) shown, Scan stays center. More button hidden entirely for Cashier role since they have minimal permissions.

---

## IMPORTANT: KEEP ALL EXISTING ROUTES

Do not remove any routes from `router.tsx`. All 7 screens remain navigable via direct URL (deep links from dashboard cards still work). The group button is purely a navigation surface — it doesn't change routing.

The morning dashboard quick-action links to `/app/expense`, `/app/suppliers`, etc. continue to work exactly as before. The group panel is an additional discovery layer, not a replacement for direct navigation.

---

## DO NOT CHANGE

- The Scan FAB button — position, size, animation, behavior all stay identical
- The Home, Sale, Inventory tabs — no changes
- The Credit Sales tab logic for staff
- Any screen content — this is nav bar only
- Route permissions — same rules, just surfaced in the group panel
```
