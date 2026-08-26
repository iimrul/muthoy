import { describe, expect, it } from "vitest";
import { parseCheckoutSnapshot, type CheckoutSnapshot } from "./checkoutSnapshot";

describe("held checkout snapshot", () => {
  it("restores every checkout field including the durable image reference", () => {
    const snapshot: CheckoutSnapshot = {
      paymentType: "split",
      cashText: "100",
      discountType: "percentage",
      discountText: "5",
      customerId: "customer",
      newCustomer: false,
      customerName: "Rahim",
      customerPhone: "01700000000",
      prescriptionNo: "RX-1",
      patientName: "Karim",
      prescriberName: "Dr A",
      imageUri: "file:///documents/prescription-drafts/draft/image.jpg",
    };
    expect(parseCheckoutSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("rejects malformed persisted JSON", () => {
    expect(parseCheckoutSnapshot("not-json")).toBeNull();
    expect(parseCheckoutSnapshot('{"paymentType":"wire"}')).toBeNull();
  });
});
