// state/cartStore.ts — cart state shape, per Volume 2's Cart/CartLine class
// diagram. Zustand isn't installed yet (Volume 0 Day 3: "set up a Zustand
// store for cart/session/active-shop state" — not built until Day 3), so
// this file defines the shape only, without reaching into Day 3's setup
// scope. Once Day 3 lands, replace the throwing stub below with
// `export const useCartStore = create<CartState>(...)`.
//
// In-memory UI state only, never the source of truth (SQLite is) — cleared
// after a successful checkout write.

export interface CartLine {
  medicineId: string;
  batchId: string;
  quantity: number;
  unitPrice: number;
  discount?: { type: 'percentage' | 'flat'; value: number };
}

export interface CartState {
  items: CartLine[];
  // TODO(Day 6): add a line (or increment quantity if the same batch is
  // already in the cart).
  addItem: (line: CartLine) => void;
  // TODO(Day 6): cart screen's qty steppers call this; remove the line
  // entirely when quantity reaches 0.
  updateQuantity: (batchId: string, quantity: number) => void;
  // TODO(Day 7): called after Checkout's sale transaction succeeds.
  clear: () => void;
  // TODO(Day 6): running total shown on the Cart screen — sum of each
  // line's (unitPrice * quantity), passed through domain/discounts.ts's
  // applyDiscount when a line has a discount set.
  total: () => number;
}

// TODO(Day 3): replace with a real Zustand store once zustand is installed.
// TODO(Day 6): implement addItem/updateQuantity/total's actual logic.
export function useCartStore(): CartState {
  throw new Error('TODO: wire the Zustand cart store (Volume 0 Day 3 + Day 6)');
}
