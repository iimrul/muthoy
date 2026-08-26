import { create } from "zustand";
import { addPaisa, ZERO_PAISA, type Paisa } from "@muthoy/types";
import { applyDiscount, type Discount } from "../domain/discounts";
import type { CheckoutSnapshot } from "../domain/checkoutSnapshot";

// In-memory checkout state only. SQLite remains the source of truth and the
// cart clears only after createSaleTransaction succeeds.
export interface CartLine {
  medicineId: string;
  medicineName: string;
  generic?: string | null;
  manufacturer?: string | null;
  batchId: string;
  batchNo?: string;
  expiryDate?: string | null;
  availableQuantity?: number;
  requiresPrescription?: boolean;
  quantity: number;
  unitPrice: Paisa;
  discount?: Discount;
}

export interface CartState {
  items: CartLine[];
  revision: number;
  checkoutSnapshot: CheckoutSnapshot | null;
  resumedDraftId: string | null;
  resumedDraftDeviceId: string | null;
  setResumedDraft: (draftId: string | null, deviceId: string | null) => void;
  setCheckoutSnapshot: (snapshot: CheckoutSnapshot | null) => void;
  addItem: (line: CartLine) => boolean;
  updateQuantity: (medicineId: string, quantity: number) => void;
  removeItem: (medicineId: string) => void;
  updateQuote: (
    medicineId: string,
    quote: Pick<
      CartLine,
      "batchId" | "unitPrice" | "availableQuantity" | "expiryDate"
    >,
  ) => void;
  clear: () => void;
  total: () => Paisa;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  revision: 0,
  checkoutSnapshot: null,
  resumedDraftId: null,
  resumedDraftDeviceId: null,
  setResumedDraft: (resumedDraftId, resumedDraftDeviceId) =>
    set({ resumedDraftId, resumedDraftDeviceId }),
  setCheckoutSnapshot: (checkoutSnapshot) => set({ checkoutSnapshot }),
  addItem: (line) => {
    let changed = false;
    set((state) => {
      const existing = state.items.find(
        (item) => item.medicineId === line.medicineId,
      );
      if (existing) {
        const quantity = Math.min(
          existing.quantity + line.quantity,
          line.availableQuantity ??
            existing.availableQuantity ??
            Number.MAX_SAFE_INTEGER,
        );
        if (quantity === existing.quantity) return state;
        changed = true;
        return {
            revision: state.revision + 1,
            items: state.items.map((item) =>
              item.medicineId === line.medicineId
                ? {
                    ...item,
                    ...line,
                    quantity,
                  }
                : item,
            ),
          };
      }
      const quantity = Math.min(
        line.quantity,
        line.availableQuantity ?? Number.MAX_SAFE_INTEGER,
      );
      if (quantity <= 0) return state;
      changed = true;
      return {
            revision: state.revision + 1,
            items: [
              ...state.items,
              {
                ...line,
                quantity,
              },
            ],
          };
    });
    return changed;
  },
  updateQuantity: (medicineId, quantity) =>
    set((state) => {
      const existing = state.items.find((item) => item.medicineId === medicineId);
      if (!existing || existing.quantity === quantity) return state;
      return {
        revision: state.revision + 1,
        items:
          quantity <= 0
            ? state.items.filter((item) => item.medicineId !== medicineId)
            : state.items.map((item) =>
                item.medicineId === medicineId ? { ...item, quantity } : item,
              ),
      };
    }),
  removeItem: (medicineId) =>
    set((state) => {
      if (!state.items.some((item) => item.medicineId === medicineId)) return state;
      return {
        revision: state.revision + 1,
        items: state.items.filter((item) => item.medicineId !== medicineId),
      };
    }),
  updateQuote: (medicineId, quote) =>
    set((state) => {
      const existing = state.items.find((item) => item.medicineId === medicineId);
      if (
        !existing ||
        (existing.batchId === quote.batchId &&
          existing.unitPrice === quote.unitPrice &&
          existing.availableQuantity === quote.availableQuantity &&
          existing.expiryDate === quote.expiryDate)
      ) return state;
      return {
        revision: state.revision + 1,
        items: state.items.map((item) =>
          item.medicineId === medicineId ? { ...item, ...quote } : item,
        ),
      };
    }),
  clear: () =>
    set((state) => ({
      items: [],
      revision: state.revision + 1,
      checkoutSnapshot: null,
      resumedDraftId: null,
      resumedDraftDeviceId: null,
    })),
  total: () =>
    get().items.reduce(
      (sum, line) =>
        addPaisa(
          sum,
          applyDiscount(line.unitPrice, line.quantity, line.discount).lineTotal,
        ),
      ZERO_PAISA,
    ),
}));
