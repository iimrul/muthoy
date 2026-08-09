# Portable POS — Fix Slow Navigation / Routing
## Prompt for Antigravity Agent

Navigation feels slow because every screen's code is fetched on-demand at the
moment of tapping. All 38 routes use `lazy: async () => import(...)`, and React
Router loads each chunk BEFORE rendering. There is no preloading anywhere. Fix it
with the three changes below. Do not change any screen's content or design.

---

## FIX 1 — Preload critical routes right after the app mounts

The screens a user reaches constantly — dashboard, sale entry, inventory, credit,
checkout, staff home — should already be in memory before the user taps. Preload
them in the background as soon as the app is idle, so the first tap is instant.

Add a preload module `src/app/utils/preloadRoutes.ts`:

```ts
// Warm the chunks for the most-used screens in the background.
// Called once after the app mounts. Uses requestIdleCallback so it never
// competes with the initial render.

const CRITICAL_ROUTES = [
  () => import("../screens/MorningDashboard"),
  () => import("../screens/SaleEntry"),
  () => import("../screens/Checkout"),
  () => import("../screens/Inventory"),
  () => import("../screens/CreditSales"),
  () => import("../screens/StaffHome"),
  () => import("../screens/EndOfDay"),
];

export function preloadCriticalRoutes() {
  const run = () => CRITICAL_ROUTES.forEach((load) => { load().catch(() => {}); });
  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 1200);
  }
}
```

In `App.tsx`, call it once after mount:

```tsx
import { preloadCriticalRoutes } from "./utils/preloadRoutes";

useEffect(() => {
  preloadCriticalRoutes();
}, []);
```

Result: by the time the user finishes registration/login and starts tapping,
the core screens are already loaded. Taps render instantly.

---

## FIX 2 — Prefetch a screen on touch-down, before the tap completes

When a user presses a nav button, there's a ~100–300ms gap between finger-down
and finger-up (the actual click). Use that gap to start loading the target screen.
By the time the click fires, the chunk is ready.

In `router.tsx`, export the lazy importers so they can be triggered early. Convert
each route's inline `lazy` into a named loader you can also call on hover/touch:

```ts
// Define loaders once, reuse for both routing AND prefetch.
export const routeLoaders: Record<string, () => Promise<any>> = {
  "/app": () => import("./screens/MorningDashboard"),
  "/app/sale": () => import("./screens/SaleEntry"),
  "/app/inventory": () => import("./screens/Inventory"),
  "/app/credit": () => import("./screens/CreditSales"),
  "/app/staff-home": () => import("./screens/StaffHome"),
  // ... map every route path to its importer
};

export function prefetchRoute(path: string) {
  routeLoaders[path]?.().catch(() => {});
}
```

In `MainLayout.tsx` bottom nav and any major nav button, add prefetch on press-start:

```tsx
<button
  onPointerDown={() => prefetchRoute(tab.route)}   // starts loading on touch-down
  onClick={() => navigate(tab.route)}              // navigates on tap release
>
```

`onPointerDown` fires the instant the finger touches — well before `onClick`.
The chunk loads during the natural press duration, so navigation feels instant.

---

## FIX 3 — Add manual chunk grouping in Vite so screens share fewer, larger chunks

38 separate dynamic imports = 38 tiny chunks = 38 separate fetches. Group related
screens into a handful of bundles so one fetch covers several screens.

In `vite.config.ts`, add a `build.rollupOptions.output.manualChunks`:

```ts
export default defineConfig({
  // ... existing config ...
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core daily-use screens travel together — one fetch covers all.
          "core-pos": [
            "./src/app/screens/MorningDashboard.tsx",
            "./src/app/screens/SaleEntry.tsx",
            "./src/app/screens/Checkout.tsx",
            "./src/app/screens/Inventory.tsx",
          ],
          // Credit + customers group.
          "credit": [
            "./src/app/screens/CreditSales.tsx",
            "./src/app/screens/CustomerCreditDetail.tsx",
          ],
          // Premium/secondary screens — loaded only when needed.
          "secondary": [
            "./src/app/screens/Suppliers.tsx",
            "./src/app/screens/SupplierInvoices.tsx",
            "./src/app/screens/ExpenseTracking.tsx",
            "./src/app/screens/MonthlyReport.tsx",
          ],
          // Vendor libraries cached separately so they never re-download.
          "vendor": ["react", "react-dom", "react-router"],
        },
      },
    },
  },
});
```

This means the four core screens download as ONE chunk on first load (during the
Fix 1 idle preload), so switching between dashboard, sale, checkout, and inventory
never triggers a new fetch.

---

## FIX 4 — Make the page loader less jarring during the rare cold load

When a chunk genuinely isn't ready yet (first visit to a secondary screen), the
full-screen spinner flashes and feels slow. Replace the full-screen `PageLoader`
swap with a subtle top progress bar so the previous screen stays visible until the
new one is ready — this removes the perceived "blank flash" lag.

Keep `PageLoader` only for the very first app boot (HydrateFallback). For
in-app navigation, the prefetch in Fixes 1–2 means the loader rarely shows at all.

---

## WHAT NOT TO CHANGE

- Any screen's content, layout, or design
- The route paths themselves
- Auth/permission redirect logic in MainLayout
- The HashRouter setup (keep `createHashRouter`)
- The brand colors in PageLoader

---

## EXPECTED RESULT

- Core screens (dashboard, sale, inventory, credit, checkout): instant — already in memory
- Secondary screens: load starts on finger-down, ready by tap release — feels instant
- First app boot: unchanged (one initial load)
- No more full-screen spinner flash on every navigation
