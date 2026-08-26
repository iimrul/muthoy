export interface CheckoutSnapshot {
  paymentType: "cash" | "credit" | "split";
  cashText: string;
  discountType: "none" | "amount" | "percentage";
  discountText: string;
  customerId: string | null;
  newCustomer: boolean;
  customerName: string;
  customerPhone: string;
  prescriptionNo: string;
  patientName: string;
  prescriberName: string;
  imageUri: string | null;
}

export function parseCheckoutSnapshot(value: string | null): CheckoutSnapshot | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    if (
      !["cash", "credit", "split"].includes(String(row.paymentType)) ||
      !["none", "amount", "percentage"].includes(String(row.discountType))
    ) return null;
    const text = (key: string): string =>
      typeof row[key] === "string" ? row[key] : "";
    return {
      paymentType: row.paymentType as CheckoutSnapshot["paymentType"],
      cashText: text("cashText"),
      discountType: row.discountType as CheckoutSnapshot["discountType"],
      discountText: text("discountText"),
      customerId: typeof row.customerId === "string" ? row.customerId : null,
      newCustomer: row.newCustomer === true,
      customerName: text("customerName"),
      customerPhone: text("customerPhone"),
      prescriptionNo: text("prescriptionNo"),
      patientName: text("patientName"),
      prescriberName: text("prescriberName"),
      imageUri: typeof row.imageUri === "string" ? row.imageUri : null,
    };
  } catch {
    return null;
  }
}
