import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { asPaisa, subtractPaisa, type Paisa } from "@muthoy/types";
import { formatMoney, parseTakaTextToPaisa } from "@muthoy/utils";
import { checkoutCustomerSchema } from "@muthoy/validation";
import { MedicineTextScanner } from "../../components/scanner/MedicineTextScanner";
import { StandardHeader } from "../../components/ui/StandardHeader";
import { listCustomers, type CustomerListItem } from "../../db/customers";
import { createSaleTransaction, SaleQuoteChangedError } from "../../db/sales";
import {
  checkoutDiscountAmount,
  type CheckoutDiscount,
} from "../../domain/pricing";
import type { SalePaymentRequest } from "../../domain/salePayment";
import { runNotificationChecks } from "../../native/notifications";
import { useCartStore } from "../../state/cartStore";
import { captureSessionFor } from "../../state/sessionGuard";
import { useSessionStore } from "../../state/sessionStore";
import { usePermission } from "../../state/usePermission";
import { triggerSyncNow } from "../../sync";

type PaymentType = "cash" | "credit" | "split";
type DiscountType = "none" | "amount" | "percentage";

function percentBasisPoints(text: string): number {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) throw new Error("Enter a percentage from 0 to 100.");
  const value =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (value > 10_000) throw new Error("Discount cannot exceed 100%.");
  return value;
}

export default function CheckoutScreen() {
  const session = useSessionStore((state) => state.session);
  const { isAllowed: canDiscount } = usePermission("sale_discount");
  const items = useCartStore((state) => state.items);
  const subtotal = useCartStore((state) => state.total());
  const clearCart = useCartStore((state) => state.clear);
  const resumedDraftId = useCartStore((state) => state.resumedDraftId);
  const resumedDraftDeviceId = useCartStore(
    (state) => state.resumedDraftDeviceId,
  );
  const [paymentType, setPaymentType] = useState<PaymentType>("cash");
  const [cashText, setCashText] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("none");
  const [discountText, setDiscountText] = useState("");
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [newCustomer, setNewCustomer] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [prescriptionNo, setPrescriptionNo] = useState("");
  const [patientName, setPatientName] = useState("");
  const [prescriberName, setPrescriberName] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [refreshedTotal, setRefreshedTotal] = useState<Paisa | null>(null);
  const [quoteConfirmed, setQuoteConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const customerRequest = useRef(0);
  if (!session) return null;

  let discount: CheckoutDiscount | undefined;
  let discountError: string | null = null;
  try {
    if (canDiscount && discountType === "amount" && discountText.trim())
      discount = { type: "amount", amount: parseTakaTextToPaisa(discountText) };
    if (canDiscount && discountType === "percentage" && discountText.trim())
      discount = {
        type: "percentage",
        basisPoints: percentBasisPoints(discountText),
      };
  } catch (caught) {
    discountError =
      caught instanceof Error ? caught.message : "Invalid discount.";
  }
  const discountAmount = discount
    ? checkoutDiscountAmount(subtotal, discount)
    : asPaisa(0);
  const total = refreshedTotal ?? asPaisa(subtotal - discountAmount);

  const loadCustomers = async (query?: string) => {
    const request = ++customerRequest.current;
    try {
      const rows = await listCustomers(session.shopId, query);
      if (request === customerRequest.current) setCustomers(rows);
    } catch {
      if (request === customerRequest.current)
        setError("Customer search failed.");
    }
  };
  const choosePayment = (type: PaymentType) => {
    setPaymentType(type);
    setError(null);
    if (type !== "cash") void loadCustomers();
  };
  const customerFields = () => {
    if (paymentType === "cash") return {};
    if (!newCustomer) {
      if (!customerId)
        throw new Error("Select a customer or create a new customer.");
      return { customerId };
    }
    const parsed = checkoutCustomerSchema.safeParse({
      name: customerName,
      phone: customerPhone,
    });
    if (!parsed.success)
      throw new Error(
        parsed.error.issues[0]?.message ?? "Enter valid customer details.",
      );
    return { newCustomer: parsed.data };
  };
  const payment = (): SalePaymentRequest => {
    if (total === 0) return { type: "free" };
    if (paymentType === "credit") return { type: "credit" };
    const amount = parseTakaTextToPaisa(cashText);
    return paymentType === "split"
      ? { type: "split", cashApplied: amount }
      : { type: "cash", tendered: amount };
  };

  const confirm = async () => {
    const guard = captureSessionFor(session);
    if (!guard) return;
    setError(null);
    if (!items.length) return setError("Cart is empty.");
    if (discountError) return setError(discountError);
    try {
      const selectedPayment = payment();
      const customer = customerFields();
      setSubmitting(true);
      const result = await createSaleTransaction({
        shopId: session.shopId,
        staffId: session.userId,
        isStillActive: guard.isStillActive,
        payment: selectedPayment,
        ...customer,
        discount,
        quotedTotal: total,
        confirmQuoteChange: quoteConfirmed,
        quotedAllocation: items.map((item) => ({
          batchId: item.batchId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
        prescription: {
          prescriptionNo: prescriptionNo.trim() || undefined,
          patientName: patientName.trim() || undefined,
          prescriberName: prescriberName.trim() || undefined,
        },
        prescriptionImageUri: imageUri ?? undefined,
        draftId: resumedDraftId ?? undefined,
        currentDeviceId: resumedDraftId
          ? (resumedDraftDeviceId ?? undefined)
          : undefined,
        lines: items.map((item) => ({
          medicineId: item.medicineId,
          quantity: item.quantity,
        })),
      });
      clearCart();
      void triggerSyncNow(session.shopId);
      void runNotificationChecks(session.shopId).catch(() => undefined);
      if (!guard.isStale())
        router.replace({
          pathname: "./confirmation",
          params: {
            invoiceNo: result.invoiceNo,
            total: String(result.total),
            paymentType: selectedPayment.type,
            change: String(result.change),
          },
        });
    } catch (caught) {
      if (caught instanceof SaleQuoteChangedError) {
        setRefreshedTotal(caught.refreshedTotal);
        setQuoteConfirmed(true);
        setError("Price or stock changed. Review total and confirm again.");
      } else
        setError(
          caught instanceof Error
            ? caught.message
            : "Checkout failed. Cart was not changed.",
        );
    } finally {
      setSubmitting(false);
    }
  };

  let change: Paisa | null = null;
  let remainingCredit: Paisa | null = null;
  try {
    const cash = parseTakaTextToPaisa(cashText);
    if (paymentType === "cash" && cash >= total)
      change = subtractPaisa(cash, total);
    if (paymentType === "split" && cash < total)
      remainingCredit = asPaisa(total - cash);
  } catch {
    /* validate on submit */
  }
  const resetQuote = () => {
    setRefreshedTotal(null);
    setQuoteConfirmed(false);
  };

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Checkout" onBackPress={() => router.back()} />
      <ScrollView
        contentContainerClassName="gap-4 p-4"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-2 rounded-lg bg-white p-4">
          <View className="flex-row justify-between">
            <Text>Subtotal</Text>
            <Text className="font-mono">{formatMoney(subtotal)}</Text>
          </View>
          {discountAmount > 0 ? (
            <View className="flex-row justify-between">
              <Text>Discount</Text>
              <Text>-{formatMoney(discountAmount)}</Text>
            </View>
          ) : null}
          <View className="flex-row justify-between">
            <Text className="font-sans-bold text-lg">Total</Text>
            <Text className="font-mono text-xl text-brand-green">
              {formatMoney(total)}
            </Text>
          </View>
        </View>
        {canDiscount ? (
          <View className="gap-3 rounded-lg bg-white p-4">
            <Text className="font-sans-semibold">Checkout discount</Text>
            <View className="flex-row gap-2">
              {(["none", "amount", "percentage"] as const).map((type) => (
                <Pressable
                  key={type}
                  onPress={() => {
                    setDiscountType(type);
                    resetQuote();
                  }}
                  className={`flex-1 items-center rounded border py-2 ${discountType === type ? "border-brand-green" : "border-midGray"}`}
                >
                  <Text>{type === "percentage" ? "%" : type}</Text>
                </Pressable>
              ))}
            </View>
            {discountType !== "none" ? (
              <TextInput
                value={discountText}
                onChangeText={(value) => {
                  setDiscountText(value);
                  resetQuote();
                }}
                keyboardType="decimal-pad"
                placeholder={
                  discountType === "amount" ? "Amount (৳)" : "Percent"
                }
                className="rounded border border-midGray p-3"
              />
            ) : null}
            {discountError ? (
              <Text className="text-error">{discountError}</Text>
            ) : null}
          </View>
        ) : null}
        <View className="flex-row gap-2">
          {(["cash", "credit", "split"] as const).map((type) => (
            <Pressable
              key={type}
              onPress={() => choosePayment(type)}
              className={`flex-1 items-center rounded-lg py-3 ${paymentType === type ? "bg-brand-green" : "bg-white"}`}
            >
              <Text className={paymentType === type ? "text-white" : ""}>
                {type}
              </Text>
            </Pressable>
          ))}
        </View>
        {paymentType !== "credit" ? (
          <View className="gap-2 rounded-lg bg-white p-4">
            <Text>
              {paymentType === "split"
                ? "Cash amount (৳)"
                : "Amount tendered (৳)"}
            </Text>
            <TextInput
              value={cashText}
              onChangeText={setCashText}
              keyboardType="decimal-pad"
              accessibilityLabel={
                paymentType === "split" ? "Cash amount" : "Amount tendered"
              }
              className="rounded border border-midGray p-3"
            />
            <Text>
              {paymentType === "split"
                ? `Remaining credit: ${remainingCredit === null ? "—" : formatMoney(remainingCredit)}`
                : `Change: ${change === null ? "—" : formatMoney(change)}`}
            </Text>
          </View>
        ) : null}
        {paymentType !== "cash" ? (
          <View className="gap-3 rounded-lg bg-white p-4">
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setNewCustomer(false)}
                className="flex-1 rounded border p-2"
              >
                <Text>Existing</Text>
              </Pressable>
              <Pressable
                onPress={() => setNewCustomer(true)}
                className="flex-1 rounded border p-2"
              >
                <Text>New customer</Text>
              </Pressable>
            </View>
            {newCustomer ? (
              <>
                <TextInput
                  value={customerName}
                  onChangeText={setCustomerName}
                  placeholder="Customer name"
                  className="rounded border border-midGray p-3"
                />
                <TextInput
                  value={customerPhone}
                  onChangeText={setCustomerPhone}
                  placeholder="Phone (optional)"
                  className="rounded border border-midGray p-3"
                />
              </>
            ) : (
              <>
                <TextInput
                  value={customerQuery}
                  onChangeText={(value) => {
                    setCustomerQuery(value);
                    setCustomerId(null);
                    void loadCustomers(value);
                  }}
                  placeholder="Search customers"
                  className="rounded border border-midGray p-3"
                />
                {customers.map((row) => (
                  <Pressable
                    key={row.id}
                    onPress={() => setCustomerId(row.id)}
                    className={`rounded border p-3 ${customerId === row.id ? "border-brand-green" : "border-midGray"}`}
                  >
                    <Text>{row.name}</Text>
                    <Text className="text-xs text-midGray">{row.phone}</Text>
                  </Pressable>
                ))}
              </>
            )}
          </View>
        ) : null}
        <View className="gap-3 rounded-lg bg-white p-4">
          <Text className="font-sans-semibold">Prescription (optional)</Text>
          <TextInput
            value={prescriptionNo}
            onChangeText={setPrescriptionNo}
            placeholder="Prescription number"
            className="rounded border border-midGray p-3"
          />
          <TextInput
            value={patientName}
            onChangeText={setPatientName}
            placeholder="Patient name"
            className="rounded border border-midGray p-3"
          />
          <TextInput
            value={prescriberName}
            onChangeText={setPrescriberName}
            placeholder="Prescriber name"
            className="rounded border border-midGray p-3"
          />
          <Pressable
            onPress={() => setScannerVisible(true)}
            className="items-center rounded border border-brand-green p-3"
          >
            <Text className="text-brand-green">
              {imageUri
                ? "Retake prescription image"
                : "Attach prescription image"}
            </Text>
          </Pressable>
          {imageUri ? (
            <Text className="text-xs text-midGray">
              Image captured. Sale is not blocked by image upload.
            </Text>
          ) : null}
        </View>
        {error ? <Text className="text-error">{error}</Text> : null}
        <Pressable
          onPress={confirm}
          disabled={submitting}
          accessibilityLabel={
            quoteConfirmed ? "Confirm refreshed total" : "Confirm sale"
          }
          className="items-center rounded-lg bg-brand-green py-4 disabled:opacity-50"
        >
          <Text className="font-sans-semibold text-white">
            {submitting
              ? "Saving…"
              : quoteConfirmed
                ? "Confirm refreshed total"
                : "Confirm sale"}
          </Text>
        </Pressable>
      </ScrollView>
      <MedicineTextScanner
        visible={scannerVisible}
        mode="prefill"
        captureOnly
        onClose={() => setScannerVisible(false)}
        onTextRecognized={() => undefined}
        onImageCaptured={setImageUri}
      />
    </View>
  );
}
