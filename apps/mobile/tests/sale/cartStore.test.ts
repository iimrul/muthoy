import { beforeEach, describe, expect, it } from "vitest";
import { asPaisa } from "@muthoy/types";
import { useCartStore } from "../../state/cartStore";

const line = {
  medicineId: "medicine",
  medicineName: "Napa",
  batchId: "batch",
  quantity: 1,
  unitPrice: asPaisa(1_000),
  availableQuantity: 2,
};

beforeEach(() => {
  useCartStore.setState({
    items: [],
    revision: 0,
    checkoutSnapshot: null,
    resumedDraftId: null,
    resumedDraftDeviceId: null,
  });
});

describe("cart edit safety", () => {
  it("reports whether add actually increased quantity", () => {
    expect(useCartStore.getState().addItem({ ...line, quantity: 2 })).toBe(true);
    expect(useCartStore.getState().addItem(line)).toBe(false);
    expect(useCartStore.getState().items[0]?.quantity).toBe(2);
  });

  it("revisions quantity, removal, and changed live quotes without hiding stock loss", () => {
    useCartStore.getState().addItem(line);
    const afterAdd = useCartStore.getState().revision;
    useCartStore.getState().updateQuantity(line.medicineId, 2);
    useCartStore.getState().updateQuote(line.medicineId, {
      batchId: line.batchId,
      unitPrice: line.unitPrice,
      expiryDate: null,
      availableQuantity: 1,
    });
    expect(useCartStore.getState().revision).toBe(afterAdd + 2);
    expect(useCartStore.getState().items[0]).toMatchObject({
      quantity: 2,
      availableQuantity: 1,
    });
    useCartStore.getState().removeItem(line.medicineId);
    expect(useCartStore.getState().revision).toBe(afterAdd + 3);
  });

  it("does not revise an unchanged quote", () => {
    useCartStore.getState().addItem(line);
    const revision = useCartStore.getState().revision;
    useCartStore.getState().updateQuote(line.medicineId, {
      batchId: line.batchId,
      unitPrice: line.unitPrice,
      expiryDate: undefined,
      availableQuantity: 2,
    });
    expect(useCartStore.getState().revision).toBe(revision);
  });
});
