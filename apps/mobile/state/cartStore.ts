import { create } from "zustand";
import { addPaisa, ZERO_PAISA, type Paisa } from "@muthoy/types";
import { applyDiscount, type Discount } from "../domain/discounts";

// In-memory checkout state only. SQLite remains the source of truth and the
// cart clears only after createSaleTransaction succeeds.
export interface CartLine {
  medicineId: string;
  medicineName: string;
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
  resumedDraftId: string | null;
  resumedDraftDeviceId: string | null;
  setResumedDraft: (draftId: string | null, deviceId: string | null) => void;
  addItem: (line: CartLine) => void;
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
  resumedDraftId: null,
  resumedDraftDeviceId: null,
  setResumedDraft: (resumedDraftId, resumedDraftDeviceId) =>
    set({ resumedDraftId, resumedDraftDeviceId }),
  addItem: (line) =>
    set((state) => {
      const existing = state.items.find(
        (item) => item.medicineId === line.medicineId,
      );
      return existing
        ? {
            items: state.items.map((item) =>
              item.medicineId === line.medicineId
                ? {
                    ...item,
                    ...line,
                    quantity: Math.min(
                      item.quantity + line.quantity,
                      line.availableQuantity ??
                        item.availableQuantity ??
                        Number.MAX_SAFE_INTEGER,
                    ),
                  }
                : item,
            ),
          }
        : {
            items: [
              ...state.items,
              {
                ...line,
                quantity: Math.min(
                  line.quantity,
                  line.availableQuantity ?? Number.MAX_SAFE_INTEGER,
                ),
              },
            ],
          };
    }),
  updateQuantity: (medicineId, quantity) =>
    set((state) => ({
      items:
        quantity <= 0
          ? state.items.filter((item) => item.medicineId !== medicineId)
          : state.items.map((item) =>
              item.medicineId === medicineId
                ? {
                    ...item,
                    quantity: Math.min(
                      quantity,
                      item.availableQuantity ?? Number.MAX_SAFE_INTEGER,
                    ),
                  }
                : item,
            ),
    })),
  removeItem: (medicineId) =>
    set((state) => ({
      items: state.items.filter((item) => item.medicineId !== medicineId),
    })),
  updateQuote: (medicineId, quote) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.medicineId === medicineId
          ? {
              ...item,
              ...quote,
              quantity: Math.min(
                item.quantity,
                quote.availableQuantity ?? Number.MAX_SAFE_INTEGER,
              ),
            }
          : item,
      ),
    })),
  clear: () =>
    set({ items: [], resumedDraftId: null, resumedDraftDeviceId: null }),
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
