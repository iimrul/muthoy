# Muthoy (মুঠোয়) — Fix: New Owner Sees Previous Owner's Staff/Data

## The bug (root cause found)
When a new owner registers on the same device, they see the previous owner's staff
(and would see their medicines, transactions, etc. too). Two compounding causes:

1. HARDCODED 'shop_1'. In shopManager.ts, getActiveShopId() falls back to "shop_1",
   and register() creates the first shop with the fixed id 'shop_1'. So EVERY owner's
   first shop uses the SAME namespace: `shop_1__staffMembers`, `shop_1__medicines`, etc.

2. register() only seeds a shop `if (!localStorage.getItem('shopRegistry'))`. When a
   second owner registers on the same device, owner A's shopRegistry still exists, so
   this block is SKIPPED. The new owner gets NO fresh shop, and activeShopId still
   points at 'shop_1' — which still holds owner A's data. Result: owner B sees owner
   A's staff.

The underlying problem: shop data is namespaced by shop id, but shop id is not tied to
the owner, and a new registration neither creates a fresh shop nor isolates from the
previous owner's shop-scoped data.

## FIX 1 — Give every shop a unique id (no hardcoded 'shop_1')
In AuthContext.register(), generate a unique shop id per registration and tie it to
the new owner:

  const newShopId = `shop_${newUser.id}`;   // newUser.id is Date.now() — unique per owner
  const firstShop = {
    id: newShopId,
    ownerId: newUser.id,            // <-- tie shop to owner
    name: data.shopName,
    nameEn: data.shopNameEn || data.shopName,
    createdAt: new Date().toISOString(),
    isActive: true,
  };

## FIX 2 — On registration, START THIS OWNER'S OWN shop registry + active shop
Do NOT gate shop creation on "shopRegistry missing". A new owner must get their own
fresh shop context regardless of what a previous owner left behind:

  // Replace the `if (!localStorage.getItem('shopRegistry'))` block with:
  localStorage.setItem('shopRegistry', JSON.stringify([firstShop]));
  localStorage.setItem('activeShopId', newShopId);

Because the new shop id (`shop_${newUser.id}`) is unique, its namespace
(`shop_<newid>__staffMembers`, etc.) is empty — so the new owner starts clean and
CANNOT see the previous owner's staff/medicines/transactions.

## FIX 3 — Remove the hardcoded fallback in shopManager
In shopManager.ts, getActiveShopId() must NOT silently default to 'shop_1':

  export function getActiveShopId(): string {
    return localStorage.getItem(ACTIVE_SHOP_KEY) || "";  // empty if none
  }

Any code that reads a scoped key before an active shop is set should be guarded
(no active shop -> no data). After login/registration, activeShopId is always set,
so this only affects the pre-auth state.

## FIX 4 — On LOGIN, switch to that owner's active shop
When an existing owner logs in (login()), set activeShopId to THEIR shop so two owners
on one device never read each other's namespace. Resolve the owner's shop from the
registry by ownerId:

  // after a successful owner login:
  const shops = JSON.parse(localStorage.getItem('shopRegistry') || '[]');
  const myShops = shops.filter((s:any) => s.ownerId === foundUser.id);
  if (myShops.length) {
    localStorage.setItem('activeShopId', (myShops.find((s:any)=>s.isActive) || myShops[0]).id);
  }

(Migration note: existing installs created before this fix have a shop with id
'shop_1' and no ownerId. On first run after the update, backfill ownerId onto any
shop missing it using the current logged-in/first owner, so their data stays linked.)

## IMPORTANT — multi-owner on one device vs multi-shop for one owner
- MULTIPLE OWNERS on one device: each owner has their OWN shop(s); they must never see
  each other's data. (This bug.)
- ONE owner with MULTIPLE shops (Pro/Ultra): that owner switches between THEIR shops via
  MultiShopManagement. Those shops all share ownerId = that owner. Keep that working.
The ownerId field separates the two concepts cleanly.

## VERIFY (the exact scenario)
1. Register owner A (01822240603), add staff "Arif". Arif appears for A.
2. Log out. Register owner B with a different number on the SAME device.
3. Owner B's Staff Management is EMPTY — Arif does NOT appear.
4. Owner B adds staff "Karim". Log out, log back in as owner A.
5. Owner A sees Arif (not Karim). Owner B sees Karim (not Arif).
6. Medicines, transactions, credit, cash — all isolated per owner the same way.
7. A single owner with Pro can still create and switch between multiple shops.

## What not to change
- shopStorage namespacing scheme + SCOPED_KEYS.
- MultiShopManagement for one owner's multiple shops.
- The audit-log shopStorage fix from before (keep it).
