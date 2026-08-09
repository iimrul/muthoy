# Portable POS — Fast Sale Entry & Checkout
## Prompt for Antigravity Agent

The sale screen and checkout feel slow. After review, the causes are: rendering the
entire medicine list with no cap or virtualization, a too-short cache TTL that
re-parses storage on every screen switch, and re-grouping the whole inventory on
every mount. Fix all four. Do not change any sale/checkout business logic.

---

## FIX 1 — Cap and virtualize the medicine list (biggest win)

In `SaleEntry.tsx`, `displayMedicines` returns the full matching list and
`displayMedicines.map(...)` renders every row as a DOM node. With a large inventory
this mounts hundreds of nodes and is the main lag.

### 1a. Cap the rendered results
When searching or showing "all", render at most the first 50 results. Pharmacy
owners pick from the top of a search, not scroll through 500 rows.

```ts
const VISIBLE_LIMIT = 50;
const displayMedicines = useMemo(() => {
  let list;
  if (debouncedSearch) {
    const q = debouncedSearch.toLowerCase();
    list = medicines.filter(
      (m) => m.name.toLowerCase().includes(q) || m.generic.toLowerCase().includes(q)
    );
  } else if (activeFilter === "all") {
    list = medicines;
  } else {
    // ... existing recent/frequent/favorite logic ...
  }
  return list.slice(0, VISIBLE_LIMIT);   // cap rendered rows
}, [medicines, debouncedSearch, activeFilter]);
```

If you want the count visible, show "৫০টির বেশি ফলাফল — আরও খুঁজুন" / "50+ results,
refine your search" below the list when the cap is hit.

### 1b. (If a long list is still needed) virtualize
If the product wants the full list scrollable, use a virtualized list so only
visible rows mount. Otherwise the 50-cap above is enough and simpler — prefer the cap.

---

## FIX 2 — Raise the cache TTL so screen switches are instant

In `performance.ts`, `storageCache.TTL = 5000` (5 seconds). Switching from
dashboard → sale → checkout within a few seconds is common, and once 5s passes the
cache expires and the full medicines JSON is re-parsed on the next read.

Change the TTL to 5 minutes and rely on explicit invalidation on writes (which the
app already does after a sale/stock change):

```ts
private readonly TTL = 5 * 60 * 1000; // 5 minutes
```

Because every write path already calls `storageCache.set(...)` or invalidates, a
longer TTL is safe — reads stay fresh after writes, and screen switches no longer
re-parse. This alone makes window switching feel instant.

---

## FIX 3 — Don't re-group the whole inventory on every mount

In `SaleEntry.tsx`, `rawMedicines` is re-fetched with `getMedicines()` on mount and
the grouping `useMemo` re-runs fully each time. Since `getMedicines()` is now cached
(Fix 2), the fetch is cheap, but the grouping still recomputes.

Memoize the grouped result across mounts by caching it alongside the medicines cache:

```ts
// In medicineData.ts, add a getGroupedMedicines() that caches the grouped+sorted
// result and invalidates whenever medicines are written. SaleEntry then calls
// getGroupedMedicines() instead of re-grouping in a useMemo on every mount.
```

Store the grouped array in `storageCache` under key `medicines_grouped`, invalidated
in the same place `medicines` is invalidated. The grouping cost is paid once per
inventory change, not once per screen open.

---

## FIX 4 — Make checkout open instantly

In `Checkout.tsx`, ensure it does NOT re-fetch or re-group the full medicine list on
mount. Checkout only needs the cart (already in context) and, at confirm time, the
batches for the specific medicines being sold.

- On mount: render immediately from `CartContext` — no `getMedicines()` call.
- At confirm only: resolve batches for the cart's medicines (a handful of items),
  not the whole inventory.

If Checkout currently calls `getMedicines()` on mount, remove it — pull only the
cart items' batch data lazily when the confirm button is pressed.

---

## FIX 5 — Trim the route loader flash

The page loader shows on every navigation. Combined with the preloading already in
place, keep core screens (SaleEntry, Checkout, Inventory, dashboards) preloaded so
their chunks are warm. Verify `preloadCriticalRoutes()` includes SaleEntry and
Checkout — if not, add them so the first tap into the sale flow is instant.

---

## EXPECTED RESULT

- Opening Sale Entry: instant — cached grouped medicines, capped render, warm chunk
- Typing in search: smooth — 200ms debounce already there, now only 50 rows render
- Opening Checkout: instant — no full inventory load on mount
- Switching between dashboard / sale / checkout: instant — 5-min cache, no re-parse

## WHAT NOT TO CHANGE

- The cart, FEFO batch resolution, COGS, or any sale/checkout calculation
- The search matching logic (just cap its output)
- The shop-aware caching keys (keep the per-shop namespacing)
- The grouping logic itself (just cache its result instead of recomputing)
