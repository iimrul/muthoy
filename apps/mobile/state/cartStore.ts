import { create } from 'zustand';
import { addPaisa, ZERO_PAISA, type Paisa } from '@muthoy/types';
import { applyDiscount, type Discount } from '../domain/discounts';

// In-memory checkout state only. SQLite remains the source of truth and the
// cart clears only after createSaleTransaction succeeds.
export interface CartLine {
  medicineId: string;
  medicineName: string;
  batchId: string;
  quantity: number;
  unitPrice: Paisa;
  discount?: Discount;
}

export interface CartState {
  items: CartLine[];
  addItem: (line: CartLine) => void;
  updateQuantity: (batchId: string, quantity: number) => void;
  clear: () => void;
  total: () => Paisa;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  addItem: (line) =>
    set((state) => {
      const existing = state.items.find((item) => item.batchId === line.batchId);
      return existing
        ? {
            items: state.items.map((item) =>
              item.batchId === line.batchId ? { ...item, quantity: item.quantity + line.quantity } : item,
            ),
          }
        : { items: [...state.items, line] };
    }),
  updateQuantity: (batchId, quantity) =>
    set((state) => ({
      items:
        quantity <= 0
          ? state.items.filter((item) => item.batchId !== batchId)
          : state.items.map((item) => (item.batchId === batchId ? { ...item, quantity } : item)),
    })),
  clear: () => set({ items: [] }),
  total: () =>
    get().items.reduce(
      (sum, line) => addPaisa(sum, applyDiscount(line.unitPrice, line.quantity, line.discount).lineTotal),
      ZERO_PAISA,
    ),
}));
