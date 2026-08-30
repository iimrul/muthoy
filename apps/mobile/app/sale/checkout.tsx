import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { asPaisa, subtractPaisa, type Paisa } from "@muthoy/types";
import { parseTakaTextToPaisa } from "@muthoy/utils";
import { checkoutCustomerSchema } from "@muthoy/validation";
import { MedicineTextScanner } from "../../components/scanner/MedicineTextScanner";
import { StandardHeader } from "../../components/ui/StandardHeader";
import { listCustomers, type CustomerListItem } from "../../db/customers";
import { StaleSessionError } from "../../db/errors";
import {
  createSaleTransaction,
  getActiveBatchForMedicine,
  SaleQuoteChangedError,
} from "../../db/sales";
import {
  cancelSaleDraft,
  createCancelledSaleDraft,
  holdSaleDraft,
} from "../../db/saleDrafts";
import { applyDiscount } from "../../domain/discounts";
import {
  checkoutDiscountAmount,
  type CheckoutDiscount,
} from "../../domain/pricing";
import type { SalePaymentRequest } from "../../domain/salePayment";
import { getDeviceId } from "../../native/deviceId";
import { runNotificationChecks } from "../../native/notifications";
import {
  useCartStore,
  type CartLine,
} from "../../state/cartStore";
import type { CheckoutSnapshot } from "../../domain/checkoutSnapshot";
import type { CatalogKey } from "../../i18n/catalog";
import { useI18n } from "../../state/localeStore";
import { captureSessionFor } from "../../state/sessionGuard";
import { useSessionStore } from "../../state/sessionStore";
import { usePermission } from "../../state/usePermission";
import { triggerSyncNow } from "../../sync";
import { getTaxSettings, type TaxSettings } from "../../db/settings";
import { extractInclusiveTax } from "../../domain/tax";

type PaymentType = "cash" | "credit" | "split";
type DiscountType = "none" | "amount" | "percentage";

const QUICK_CASH_AMOUNTS = [10, 20, 50, 100, 200, 500, 1000, 2000];

function percentBasisPoints(
  text: string,
  invalidMessage: string,
  maximumMessage: string,
): number {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) throw new Error(invalidMessage);
  const value =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (value > 10_000) throw new Error(maximumMessage);
  return value;
}

export default function CheckoutScreen() {
  const { t, formatNumber, formatMoney } = useI18n();
  const session = useSessionStore((state) => state.session);
  const { isAllowed: canDiscount } = usePermission("sale_discount");
  const items = useCartStore((state) => state.items);
  const subtotal = useCartStore((state) => state.total());
  const clearCart = useCartStore((state) => state.clear);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const updateQuote = useCartStore((state) => state.updateQuote);
  const cartRevision = useCartStore((state) => state.revision);
  const heldSnapshot = useCartStore((state) => state.checkoutSnapshot);
  const resumedDraftId = useCartStore((state) => state.resumedDraftId);
  const resumedDraftDeviceId = useCartStore(
    (state) => state.resumedDraftDeviceId,
  );
  const [paymentType, setPaymentType] = useState<PaymentType>(
    heldSnapshot?.paymentType ?? "cash",
  );
  const [cashText, setCashText] = useState(heldSnapshot?.cashText ?? "");
  const [discountType, setDiscountType] = useState<DiscountType>(
    heldSnapshot?.discountType ?? "none",
  );
  const [discountText, setDiscountText] = useState(
    heldSnapshot?.discountText ?? "",
  );
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(
    heldSnapshot?.customerId ?? null,
  );
  const [newCustomer, setNewCustomer] = useState(
    heldSnapshot?.newCustomer ?? false,
  );
  const [customerName, setCustomerName] = useState(
    heldSnapshot?.customerName ?? "",
  );
  const [customerPhone, setCustomerPhone] = useState(
    heldSnapshot?.customerPhone ?? "",
  );
  const [prescriptionNo, setPrescriptionNo] = useState(
    heldSnapshot?.prescriptionNo ?? "",
  );
  const [patientName, setPatientName] = useState(
    heldSnapshot?.patientName ?? "",
  );
  const [prescriberName, setPrescriberName] = useState(
    heldSnapshot?.prescriberName ?? "",
  );
  const [imageUri, setImageUri] = useState<string | null>(
    heldSnapshot?.imageUri ?? null,
  );
  const [scannerVisible, setScannerVisible] = useState(false);
  const [refreshedTotal, setRefreshedTotal] = useState<Paisa | null>(null);
  const [refreshedAllocation, setRefreshedAllocation] = useState<
    { batchId: string; quantity: number; unitPrice: Paisa }[] | null
  >(null);
  const [confirmedQuoteRevision, setConfirmedQuoteRevision] = useState<
    number | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [holding, setHolding] = useState(false);
  const [taxSettings, setTaxSettings] = useState<TaxSettings>({ rateBp: 0, label: "VAT" });
  const customerRequest = useRef(0);
  const medicineIds = items.map((item) => item.medicineId).sort().join("|");
  const quoteConfirmed =
    refreshedTotal !== null && confirmedQuoteRevision === cartRevision;

  const loadCustomers = useCallback(
    async (query?: string) => {
      if (!session) return;
      const request = ++customerRequest.current;
      try {
        const rows = await listCustomers(session.shopId, query);
        if (request === customerRequest.current) setCustomers(rows);
      } catch {
        if (request === customerRequest.current)
          setError(t("customerSearchFailedLabel"));
      }
    },
    [session, t],
  );

  useEffect(() => {
    if (!session || !medicineIds) return;
    let current = true;
    const refresh = async () => {
      await Promise.all(
        useCartStore.getState().items.map(async (item) => {
          const batch = await getActiveBatchForMedicine(
            session.shopId,
            item.medicineId,
          );
          if (!current) return;
          updateQuote(item.medicineId, batch
            ? {
                batchId: batch.id,
                unitPrice: batch.salePrice,
                availableQuantity: batch.quantityAvailable,
                expiryDate: batch.expiryDate,
              }
            : {
                batchId: item.batchId,
                unitPrice: item.unitPrice,
                availableQuantity: 0,
                expiryDate: item.expiryDate ?? null,
              });
        }),
      );
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5_000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [medicineIds, session, updateQuote]);

  useEffect(() => {
    if (!session || !heldSnapshot || heldSnapshot.paymentType === "cash")
      return;
    const timer = setTimeout(() => void loadCustomers(), 0);
    return () => clearTimeout(timer);
  }, [heldSnapshot, loadCustomers, session]);
  useEffect(() => {
    if (!session) return;
    let current = true;
    void getTaxSettings(session.shopId).then((settings) => {
      if (current) setTaxSettings(settings);
    }).catch(() => undefined);
    return () => { current = false; };
  }, [session]);
  if (!session) return null;

  let discount: CheckoutDiscount | undefined;
  let discountError: string | null = null;
  try {
    if (canDiscount && discountType === "amount" && discountText.trim())
      discount = { type: "amount", amount: parseTakaTextToPaisa(discountText) };
    if (canDiscount && discountType === "percentage" && discountText.trim())
      discount = {
        type: "percentage",
        basisPoints: percentBasisPoints(
          discountText,
          t("invalidDiscountPercentLabel"),
          t("discountMaximumLabel"),
        ),
      };
  } catch (caught) {
    discountError =
      discountType === "percentage" && caught instanceof Error
        ? caught.message
        : t("invalidDiscountLabel");
  }
  const discountAmount = discount
    ? checkoutDiscountAmount(subtotal, discount)
    : asPaisa(0);
  const total = quoteConfirmed && refreshedTotal !== null
    ? refreshedTotal
    : asPaisa(subtotal - discountAmount);
  const displayedTax = extractInclusiveTax(total, taxSettings.rateBp);
  // UI-level pre-check only, using the same availableQuantity Cart's own
  // live quote-refresh effect already keeps current — createSaleTransaction
  // (db/sales.ts) remains the sole authoritative stock/FEFO validation at
  // submit time; this only stops an obviously-doomed submit early and
  // matches the prototype's own Confirm-button disable behavior.
  const hasStockIssue = items.some(
    (item) => item.quantity > (item.availableQuantity ?? Number.MAX_SAFE_INTEGER),
  );

  const choosePayment = (type: PaymentType) => {
    setPaymentType(type);
    setError(null);
    if (type !== "cash") void loadCustomers();
  };
  const customerFields = () => {
    if (paymentType === "cash") return {};
    if (!newCustomer) {
      if (!customerId)
        throw new Error(t("selectOrCreateCustomerLabel"));
      return { customerId };
    }
    const parsed = checkoutCustomerSchema.safeParse({
      name: customerName,
      phone: customerPhone,
    });
    if (!parsed.success)
      throw new Error(
        t("invalidCustomerDetailsLabel"),
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
    if (!items.length) return setError(t("cartEmptyErrorLabel"));
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
        confirmedQuote:
          quoteConfirmed && refreshedTotal !== null && refreshedAllocation
            ? { total: refreshedTotal, allocation: refreshedAllocation }
            : undefined,
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
        setRefreshedAllocation(caught.refreshedAllocation);
        setConfirmedQuoteRevision(cartRevision);
        setError(t("quoteChangedReviewLabel"));
      } else if (caught instanceof StaleSessionError) {
        setError(t("activeUserChangedNotSavedLabel"));
      } else
        setError(t("checkoutFailedUnchangedLabel"));
    } finally {
      setSubmitting(false);
    }
  };

  // Hold + Cancel moved here from Cart to match the prototype's Checkout
  // flow (Confirm Sale, then Hold/Cancel below it) — same
  // db/saleDrafts.ts calls, unchanged behavior, just relocated.
  const hold = async () => {
    if (!session || !items.length) return;
    const guard = captureSessionFor(session);
    if (!guard) return;
    setHolding(true);
    try {
      const checkoutSnapshot: CheckoutSnapshot = {
        paymentType,
        cashText,
        discountType,
        discountText,
        customerId,
        newCustomer,
        customerName,
        customerPhone,
        prescriptionNo,
        patientName,
        prescriberName,
        imageUri,
      };
      await holdSaleDraft({
        shopId: session.shopId,
        actorUserId: session.userId,
        originDeviceId: getDeviceId(),
        isStillActive: guard.isStillActive,
        items: items.map((item) => ({
          medicineId: item.medicineId,
          quantity: item.quantity,
        })),
        checkoutSnapshot,
        prescriptionImageUri: imageUri ?? undefined,
        prescription: {
          prescriptionNo,
          patientName,
          prescriberName,
        },
      });
      if (guard.isStale()) return;
      clearCart();
      void triggerSyncNow(session.shopId);
      router.replace("/sale");
    } catch {
      if (!guard.isStale())
        Alert.alert(
          t("couldNotHoldSaleLabel"),
          t("tryAgainLabel"),
        );
    } finally {
      setHolding(false);
    }
  };
  const cancelCurrent = async () => {
    if (!session) return;
    const guard = captureSessionFor(session);
    if (!guard) return;
    try {
      if (resumedDraftId && resumedDraftDeviceId) {
        await cancelSaleDraft(
          session.shopId,
          session.userId,
          resumedDraftId,
          resumedDraftDeviceId,
          guard.isStillActive,
        );
        triggerSyncNow(session.shopId);
      } else if (items.length) {
        await createCancelledSaleDraft({
          shopId: session.shopId,
          actorUserId: session.userId,
          originDeviceId: getDeviceId(),
          isStillActive: guard.isStillActive,
          items: items.map((item) => ({
            medicineId: item.medicineId,
            quantity: item.quantity,
          })),
          checkoutSnapshot: {
            paymentType,
            cashText,
            discountType,
            discountText,
            customerId,
            newCustomer,
            customerName,
            customerPhone,
            prescriptionNo,
            patientName,
            prescriberName,
            imageUri,
          },
          prescriptionImageUri: imageUri ?? undefined,
          prescription: { prescriptionNo, patientName, prescriberName },
        });
        triggerSyncNow(session.shopId);
      }
      if (guard.isStale()) return;
      clearCart();
      router.replace("/sale");
    } catch {
      if (!guard.isStale())
        Alert.alert(
          t("couldNotCancelSaleLabel"),
          t("tryAgainLabel"),
        );
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
    setRefreshedAllocation(null);
    setConfirmedQuoteRevision(null);
  };

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={t("checkoutTitle")} onBackPress={() => router.back()} />
      <ScrollView
        contentContainerClassName="gap-4 p-4"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-3 rounded-lg bg-white p-4">
          <Text className="font-sans-semibold text-sm text-richBlack">
            {t("saleSummaryLabel")}
          </Text>
          <View className="gap-3">
            {items.map((item) => (
              <CheckoutLineRow
                key={item.medicineId}
                item={item}
                t={t}
                formatNumber={formatNumber}
                formatMoney={formatMoney}
                onQuantityChange={(quantity) => {
                  resetQuote();
                  updateQuantity(item.medicineId, quantity);
                }}
                onRemove={() => {
                  resetQuote();
                  removeItem(item.medicineId);
                }}
              />
            ))}
          </View>
          <View className="gap-2 border-t border-midGray/20 pt-2">
            <View className="flex-row justify-between">
              <Text className="font-sans text-sm text-richBlack">{t("subtotalLabel")}</Text>
              <Text className="font-mono text-sm text-richBlack">{formatMoney(subtotal)}</Text>
            </View>
            {discountAmount > 0 ? (
              <View className="flex-row justify-between">
                <Text className="font-sans text-sm text-error">{t("discountLabel")}</Text>
                <Text className="font-mono text-sm text-error">-{formatMoney(discountAmount)}</Text>
              </View>
            ) : null}
            {displayedTax > 0 ? (
              <View className="flex-row justify-between">
                <Text className="font-sans text-sm text-midGray">
                  {taxSettings.label} ({taxSettings.rateBp / 100}% {t("taxVat")})
                </Text>
                <Text className="font-mono text-sm text-midGray">{formatMoney(displayedTax)}</Text>
              </View>
            ) : null}
            <View className="flex-row justify-between border-t border-midGray/20 pt-2">
              <Text className="font-sans-bold text-lg text-richBlack">{t("totalLabel")}</Text>
              <Text className="font-mono text-xl text-brand-green">
                {formatMoney(total)}
              </Text>
            </View>
          </View>
        </View>
        {canDiscount ? (
          <View className="gap-3 rounded-lg bg-white p-4">
            <Text className="font-sans-semibold text-richBlack">{t("checkoutDiscountLabel")}</Text>
            <View className="flex-row gap-2">
              {(["none", "amount", "percentage"] as const).map((type) => (
                <Pressable
                  key={type}
                  onPress={() => {
                    setDiscountType(type);
                    resetQuote();
                  }}
                  className={`flex-1 items-center rounded-lg border py-2 ${discountType === type ? "border-brand-green bg-brand-softGreen" : "border-midGray bg-white"}`}
                >
                  <Text className={`font-sans-medium text-sm ${discountType === type ? "text-brand-green" : "text-richBlack"}`}>
                    {type === "amount"
                      ? t("amountTypeLabel")
                      : type === "percentage"
                        ? t("percentageTypeLabel")
                        : t("noneLabel")}
                  </Text>
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
                  discountType === "amount"
                    ? t("discountAmountPlaceholder")
                    : t("discountPercentPlaceholder")
                }
                className={`rounded-lg border border-midGray p-3 ${discountType === "amount" ? "font-mono" : "font-sans"}`}
              />
            ) : null}
            {discountError ? (
              <Text className="font-sans text-sm text-error">{discountError}</Text>
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
              <Text className={`font-sans-semibold ${paymentType === type ? "text-white" : "text-richBlack"}`}>
                {type === "cash"
                  ? t("cashLabel")
                  : type === "credit"
                    ? t("creditLabel")
                    : t("splitLabel")}
              </Text>
            </Pressable>
          ))}
        </View>
        {paymentType !== "credit" ? (
          <View className="gap-3 rounded-lg bg-white p-4">
            <Text className="font-sans-medium text-sm text-richBlack">
              {paymentType === "split"
                ? t("cashAmountLabel")
                : t("amountTenderedLabel")}
            </Text>
            <TextInput
              value={cashText}
              onChangeText={setCashText}
              keyboardType="decimal-pad"
              accessibilityLabel={
                paymentType === "split" ? t("cashAmountLabel") : t("amountTenderedLabel")
              }
              className="rounded-lg border border-midGray p-3 font-mono text-base text-richBlack"
            />
            <View className="flex-row flex-wrap gap-2">
              {QUICK_CASH_AMOUNTS.map((amount) => (
                <Pressable
                  key={amount}
                  onPress={() => setCashText(String(amount))}
                  className="rounded-lg bg-brand-softGreen px-3 py-2 active:opacity-70"
                >
                  <Text className="font-mono text-xs text-brand-green">
                    ৳{formatNumber(amount)}
                  </Text>
                </Pressable>
              ))}
            </View>
            {paymentType === "split" ? (
              <Text className="font-sans text-sm text-richBlack">
                {t("remainingCreditLabel")}: {remainingCredit === null ? "—" : formatMoney(remainingCredit)}
              </Text>
            ) : change !== null ? (
              <View className="rounded-xl border-2 border-brand-green bg-brand-softGreen p-3">
                <Text className="font-sans-medium text-xs text-brand-deepGreen">{t("changeLabel")}</Text>
                <Text className="font-mono text-2xl text-brand-green">{formatMoney(change)}</Text>
              </View>
            ) : (
              <Text className="font-sans text-sm text-richBlack">{t("changeLabel")}: —</Text>
            )}
          </View>
        ) : null}
        {paymentType !== "cash" ? (
          <View className="gap-3 rounded-lg bg-white p-4">
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setNewCustomer(false)}
                className={`flex-1 items-center rounded-lg border py-2 ${!newCustomer ? "border-brand-green bg-brand-softGreen" : "border-midGray bg-white"}`}
              >
                <Text className={`font-sans-medium text-sm ${!newCustomer ? "text-brand-green" : "text-richBlack"}`}>
                  {t("existingLabel")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setNewCustomer(true)}
                className={`flex-1 items-center rounded-lg border py-2 ${newCustomer ? "border-brand-green bg-brand-softGreen" : "border-midGray bg-white"}`}
              >
                <Text className={`font-sans-medium text-sm ${newCustomer ? "text-brand-green" : "text-richBlack"}`}>
                  {t("newCustomerLabel")}
                </Text>
              </Pressable>
            </View>
            {newCustomer ? (
              <>
                <TextInput
                  value={customerName}
                  onChangeText={setCustomerName}
                  placeholder={t("customerNamePlaceholder")}
                  className="rounded-lg border border-midGray p-3"
                />
                <TextInput
                  value={customerPhone}
                  onChangeText={setCustomerPhone}
                  placeholder={t("customerPhonePlaceholder")}
                  className="rounded-lg border border-midGray p-3"
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
                  placeholder={t("searchCustomersPlaceholder")}
                  className="rounded-lg border border-midGray p-3"
                />
                {customers.map((row) => (
                  <Pressable
                    key={row.id}
                    onPress={() => setCustomerId(row.id)}
                    className={`rounded-lg border p-3 ${customerId === row.id ? "border-brand-green bg-brand-softGreen" : "border-midGray"}`}
                  >
                    <Text className="font-sans-medium text-richBlack">{row.name}</Text>
                    <Text className="text-xs text-midGray">{row.phone}</Text>
                  </Pressable>
                ))}
              </>
            )}
          </View>
        ) : null}
        <View className="gap-3 rounded-lg bg-white p-4">
          <Text className="font-sans-semibold text-richBlack">{t("prescriptionOptionalLabel")}</Text>
          {items.some((item) => item.requiresPrescription) ? (
            <View className="flex-row items-start gap-2 rounded-xl bg-[#FEF3C7] p-3">
              <Feather name="alert-triangle" size={16} color="#92400E" />
              <Text className="flex-1 font-sans text-xs text-[#92400E]">
                {t("prescriptionMedicineWarningLabel")}
              </Text>
            </View>
          ) : null}
          <TextInput
            value={prescriptionNo}
            onChangeText={setPrescriptionNo}
            placeholder={t("prescriptionNumberPlaceholder")}
            className="rounded-lg border border-midGray p-3"
          />
          <TextInput
            value={patientName}
            onChangeText={setPatientName}
            placeholder={t("patientNamePlaceholder")}
            className="rounded-lg border border-midGray p-3"
          />
          <TextInput
            value={prescriberName}
            onChangeText={setPrescriberName}
            placeholder={t("prescriberNamePlaceholder")}
            className="rounded-lg border border-midGray p-3"
          />
          <Pressable
            onPress={() => setScannerVisible(true)}
            className="flex-row items-center justify-center gap-2 rounded-lg border border-brand-green p-3"
          >
            <Feather name="camera" size={16} color="#059669" />
            <Text className="font-sans-medium text-brand-green">
              {imageUri
                ? t("retakePrescriptionImageLabel")
                : t("attachPrescriptionImageLabel")}
            </Text>
          </Pressable>
          {imageUri ? (
            <Text className="text-xs text-midGray">
              {t("imageCapturedHint")}
            </Text>
          ) : null}
        </View>
        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
        <Pressable
          onPress={confirm}
          disabled={submitting || hasStockIssue}
          accessibilityLabel={
            hasStockIssue
              ? t("insufficientStockLabel")
              : quoteConfirmed
                ? t("confirmRefreshedTotalLabel")
                : t("confirmSaleLabel")
          }
          className="items-center rounded-lg bg-brand-green py-4 disabled:opacity-50"
        >
          <Text className="font-sans-semibold text-white">
            {hasStockIssue
              ? t("insufficientStockLabel")
              : submitting
                ? t("savingSaleLabel")
                : quoteConfirmed
                  ? t("confirmRefreshedTotalLabel")
                  : t("confirmSaleLabel")}
          </Text>
        </Pressable>
        <View className="flex-row gap-3">
          {!resumedDraftId ? (
            <Pressable
              onPress={() => void hold()}
              disabled={holding}
              accessibilityRole="button"
              accessibilityLabel={t("holdSaleLabel")}
              className="flex-1 items-center rounded-lg border border-brand-green py-3 disabled:opacity-50"
            >
              <Text className="font-sans-semibold text-brand-green">
                {holding ? t("holdingSaleLabel") : t("holdSaleLabel")}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => void cancelCurrent()}
            accessibilityRole="button"
            accessibilityLabel={t("cancelSaleLabel")}
            className="flex-1 items-center rounded-lg border border-error py-3"
          >
            <Text className="font-sans-semibold text-error">{t("cancelSaleLabel")}</Text>
          </Pressable>
        </View>
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

// The prototype's per-line editable Checkout row — reuses Cart's own
// updateQuantity/removeItem actions and applyDiscount, never a second
// quantity/pricing implementation. Live subtotal/discount/total
// recalculation above falls out of this for free: updateQuantity/removeItem
// mutate the shared cart store, and subtotal is a reactive Zustand selector
// (state.total()), so every keystroke here re-renders the totals block.
function CheckoutLineRow({
  item,
  t,
  formatNumber,
  formatMoney,
  onQuantityChange,
  onRemove,
}: {
  item: CartLine;
  t: (key: CatalogKey) => string;
  formatNumber: (value: number) => string;
  formatMoney: (value: Paisa) => string;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  const lineTotal = applyDiscount(
    item.unitPrice,
    item.quantity,
    item.discount,
  ).lineTotal;
  const maximum = item.availableQuantity ?? Number.MAX_SAFE_INTEGER;
  const overStock = item.quantity > maximum;

  return (
    <View className="gap-1.5">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Text className="font-sans text-sm text-richBlack">
            {item.medicineName}
          </Text>
          <Text className="font-mono text-xs text-midGray">
            {formatMoney(item.unitPrice)} × {formatNumber(item.quantity)} ={" "}
            {formatMoney(lineTotal)}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <Pressable
            onPress={() => onQuantityChange(Math.max(1, item.quantity - 1))}
            accessibilityRole="button"
            accessibilityLabel={`Decrease ${item.medicineName} quantity`}
            className="h-7 w-7 items-center justify-center rounded-full bg-[#F3F4F6] active:opacity-70"
          >
            <Feather name="minus" size={13} color="#6B7280" />
          </Pressable>
          <TextInput
            value={String(item.quantity)}
            onChangeText={(value) => {
              const parsed = Number.parseInt(value, 10);
              if (Number.isInteger(parsed) && parsed > 0)
                onQuantityChange(parsed);
            }}
            onBlur={() => {
              if (item.quantity < 1) onQuantityChange(1);
            }}
            selectTextOnFocus
            keyboardType="number-pad"
            accessibilityLabel={`${item.medicineName} quantity`}
            className={`h-7 w-12 rounded-lg border text-center font-sans-semibold text-sm text-richBlack ${overStock ? "border-error bg-errorBg" : "border-midGray bg-white"}`}
          />
          <Pressable
            onPress={() => onQuantityChange(item.quantity + 1)}
            accessibilityRole="button"
            accessibilityLabel={`Increase ${item.medicineName} quantity`}
            className="h-7 w-7 items-center justify-center rounded-full bg-brand-softGreen active:opacity-70"
          >
            <Feather name="plus" size={13} color="#059669" />
          </Pressable>
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.medicineName}`}
            className="h-7 w-7 items-center justify-center rounded-full bg-errorBg active:opacity-70"
          >
            <Feather name="trash-2" size={13} color="#DC2626" />
          </Pressable>
        </View>
      </View>
      {overStock ? (
        <View className="flex-row items-start gap-2 rounded-lg bg-errorBg p-2">
          <Feather name="alert-triangle" size={12} color="#DC2626" />
          <Text className="flex-1 font-sans text-xs text-error">
            {t("insufficientStockAvailableLabel")} {formatNumber(maximum)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
