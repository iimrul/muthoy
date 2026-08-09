# Portable POS - Routing Documentation

## Overview

This application uses React Router v7 (Data Mode) for client-side routing. The routing structure separates authentication flows from the main application with role-based access control.

## Route Structure

### Authentication Routes (No Layout)
These routes are accessible without authentication and do not include the bottom navigation.

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | Registration | New pharmacy owner registration |
| `/otp` | OTPVerification | OTP verification for new registrations |
| `/pin-setup` | PINSetup | Set up 4-digit PIN after registration |
| `/login` | PINLogin | Owner login with phone + PIN |
| `/staff-login` | StaffLogin | Staff member selection |
| `/staff-pin-login` | StaffPINLogin | Staff PIN entry |

### Application Routes (With MainLayout)
All routes under `/app` include:
- Bottom navigation bar with Home, Sale, Inventory, Report tabs
- Prominent center OCR scan button
- Role-based access control
- Persistent cart state via CartContext

#### Main Dashboard
| Route | Component | Permission Required | Description |
|-------|-----------|-------------------|-------------|
| `/app` | MorningDashboard | `dashboard` | Daily overview, alerts, quick actions |

#### Sale Management
| Route | Component | Permission Required | Description |
|-------|-----------|-------------------|-------------|
| `/app/sale` | SaleEntry | `sale` | Medicine search and cart building |
| `/app/cart` | Cart | `sale` | Review cart, apply discounts |
| `/app/checkout` | Checkout | `sale` | Payment processing (cash/credit/split) |
| `/app/scan` | OCRScan | Always visible | OCR medicine scanning (auto-adds to cart) |

#### Inventory Management
| Route | Component | Permission Required | Description |
|-------|-----------|-------------------|-------------|
| `/app/inventory` | Inventory | `inventory` | Browse medicines, stock levels, edit/delete |
| `/app/add-medicine` | AddMedicine | `inventory` | Add new medicine manually |
| `/app/expiry` | ExpiryManagement | `inventory` | View expiring medicines with color-coded alerts |

#### Financial Management
| Route | Component | Permission Required | Description |
|-------|-----------|-------------------|-------------|
| `/app/credit` | CreditSales | `credit` | Customer credit management, payment tracking |

#### Reports
| Route | Component | Permission Required | Description |
|-------|-----------|-------------------|-------------|
| `/app/report` | Report | `report` | Customizable date range sales analytics |
| `/app/end-of-day` | EndOfDay | `report` | Daily sales summary with cash reconciliation |
| `/app/monthly-report` | MonthlyReport | `report` | Monthly P&L statement |

#### Settings & Administration
| Route | Component | Permission Required | Description |
|-------|-----------|-------------------|-------------|
| `/app/staff` | StaffManagement | Owner only | Add/edit staff, manage permissions |
| `/app/settings` | Settings | Always accessible | App preferences, language, account |

### Error Handling
| Route | Component | Description |
|-------|-----------|-------------|
| `*` (404) | NotFound | Catch-all for undefined routes with back/home buttons |

## Navigation Patterns

### Bottom Navigation Tabs
The MainLayout component displays up to 4 navigation tabs based on user permissions:
- **Home** (Dashboard) - Always visible if user has `dashboard` permission
- **Sale** - Visible with `sale` permission
- **Inventory** - Visible with `inventory` permission
- **Report** - Visible with `report` permission

The **SCAN** button is always visible in the center, elevated above other tabs.

### Permission-Based Access
Each route checks user permissions on mount:
```typescript
useEffect(() => {
  const userStr = localStorage.getItem("currentUser");
  if (userStr) {
    const user = JSON.parse(userStr);
    if (user.permissions && !user.permissions.requiredPermission) {
      navigate("/app/sale", { replace: true });
    }
  }
}, [navigate]);
```

### Navigation Between Routes

#### Programmatic Navigation
Use the `useNavigate` hook from `react-router`:
```typescript
import { useNavigate } from "react-router";
import { ROUTES } from "./routes";

const navigate = useNavigate();
navigate(ROUTES.APP.CHECKOUT);
```

#### Link Components
Use the `Link` component for declarative navigation:
```typescript
import { Link } from "react-router";
import { ROUTES } from "./routes";

<Link to={ROUTES.APP.INVENTORY}>View Inventory</Link>
```

## User Flow Examples

### New Owner Registration Flow
1. `/` (Registration) → Enter phone, pharmacy name
2. `/otp` (OTPVerification) → Verify SMS code
3. `/pin-setup` (PINSetup) → Create 4-digit PIN
4. `/app` (MorningDashboard) → Redirected to main app

### Returning Owner Login Flow
1. `/login` (PINLogin) → Enter phone + PIN
2. `/app` (MorningDashboard) → Redirected to main app

### Staff Login Flow
1. `/staff-login` (StaffLogin) → Select staff member
2. `/staff-pin-login` (StaffPINLogin) → Enter staff PIN
3. `/app/sale` or `/app` → Redirected based on permissions

### Sale Flow
1. `/app/sale` (SaleEntry) → Search and add medicines
2. `/app/scan` (OCRScan) → Optional: Scan medicine label
3. `/app/cart` (Cart) → Review cart, apply discount
4. `/app/checkout` (Checkout) → Process payment
5. `/app/sale` → Return to sale entry

### Report Flow
1. `/app/report` (Report) → View sales analytics
2. Click "Daily Report" → Navigate to `/app/end-of-day`
3. Click "Monthly Report" → Navigate to `/app/monthly-report`

## Route Constants

Use the `ROUTES` object from `/src/app/routes.ts` to reference routes:

```typescript
import { ROUTES } from "./routes";

// Authentication routes
ROUTES.HOME
ROUTES.LOGIN
ROUTES.OTP

// App routes
ROUTES.APP.HOME
ROUTES.APP.SALE
ROUTES.APP.INVENTORY
ROUTES.APP.REPORT
```

## Permission Management

### User Roles
- **Owner**: Full access to all features
- **Staff**: Granular permission-based access

### Permission Types
- `dashboard`: View morning dashboard
- `sale`: Process sales, manage cart
- `inventory`: Add/edit medicines, view expiry alerts
- `credit`: Manage customer credit
- `report`: View sales reports, analytics
- `staff`: Manage staff members (owner only)

### Checking Permissions
```typescript
const hasPermission = (feature: keyof UserPermissions) => {
  if (!currentUser || currentUser.isOwner || !currentUser.permissions) {
    return true; // Owner has all permissions
  }
  return currentUser.permissions[feature] === true;
};
```

## State Management Across Routes

### Persistent State (localStorage)
- User authentication: `currentUser`
- Medicines: `medicines`
- Transactions: `transactions`
- Credit data: `creditData`
- Deleted medicines: `deletedMedicines`

### Global Context State
- **LanguageContext**: Language preference (bn/en)
- **UserContext**: Current user information
- **CartContext**: Shopping cart items (persists across sale routes)

### Route-Specific State
Most screens manage their own local state for filters, search, forms, etc.

## Navigation Guards

Currently, permission checking is done at the component level. Each protected route checks permissions on mount and redirects if unauthorized.

Future enhancement: Consider implementing route-level guards in the router configuration.

## Deep Linking Support

All routes support direct URL access. Users can bookmark or share specific routes:
- `/app/inventory` - Direct to inventory
- `/app/expiry` - Direct to expiry management
- `/app/report` - Direct to reports

## Mobile Considerations

- All routes are optimized for mobile viewport (360dp base width)
- Bottom navigation always accessible (except in auth flows)
- Maximum 5-tap workflow for core operations
- Swipe gestures not currently implemented

## Future Enhancements

Potential routing improvements:
1. Add route parameters for medicine details: `/app/inventory/:medicineId`
2. Add query parameters for filters: `/app/inventory?category=tablet&stock=low`
3. Add customer detail routes: `/app/credit/:customerId`
4. Implement route-level authentication guards
5. Add transition animations between routes
6. Implement route preloading for better performance

## Debugging Routes

To see the current route in development:
```typescript
import { useLocation } from "react-router";

const location = useLocation();
console.log("Current route:", location.pathname);
```

## Build & Deployment

The router uses `createBrowserRouter` which requires server-side configuration:
- Ensure your server redirects all routes to `index.html`
- For Netlify: Use `_redirects` file with `/* /index.html 200`
- For Vercel: Configure in `vercel.json`

---

Last Updated: April 5, 2026
