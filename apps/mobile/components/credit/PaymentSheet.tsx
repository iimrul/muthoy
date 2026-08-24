import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ZERO_PAISA, asPaisa, toTaka, type Paisa } from "@muthoy/types";
import { formatMoney, parseTakaTextToPaisa } from "@muthoy/utils";
import type { CustomerPaymentMethod } from "../../db/customers";
import { paymentMethodLabel, userFacingError } from "../../i18n/display";
import { useI18n } from "../../state/localeStore";

// The prototype's collection sheet (CS-12/CS-13/CS-14): customer identity +
// Total Outstanding, an amount field with Half/Full/Clear quick buttons, a
// non-cash method selector (CustomerPaymentMethod already supports this at
// the data layer — db/customers.ts's collectPayment — this sheet is what
// finally makes it reachable), and inline validation instead of alert().
//
const METHODS: CustomerPaymentMethod[] = ["cash", "bkash", "nagad", "rocket", "card", "bank", "other"];

interface PaymentSheetProps {
  visible: boolean;
  customerName: string;
  customerPhone: string | null;
  outstanding: Paisa;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (amount: Paisa, method: CustomerPaymentMethod) => Promise<void>;
}

function parseAmount(text: string): Paisa | null {
  if (!text.trim()) return null;
  try {
    const paisa = parseTakaTextToPaisa(text);
    return paisa > ZERO_PAISA ? paisa : null;
  } catch {
    return null;
  }
}

export function PaymentSheet({
  visible,
  customerName,
  customerPhone,
  outstanding,
  isSubmitting,
  onClose,
  onSubmit,
}: PaymentSheetProps) {
  const { t } = useI18n();
  const [amountText, setAmountText] = useState("");
  const [method, setMethod] = useState<CustomerPaymentMethod>("cash");
  const [error, setError] = useState<string | null>(null);

  const handleDismiss = () => {
    setAmountText("");
    setMethod("cash");
    setError(null);
    onClose();
  };

  const parsedAmount = useMemo(() => parseAmount(amountText), [amountText]);
  const canConfirm = parsedAmount !== null && parsedAmount <= outstanding && !isSubmitting;

  const handleHalf = () => {
    if (outstanding <= ZERO_PAISA) return;
    setAmountText(String(toTaka(asPaisa(Math.floor(outstanding / 2)))));
  };
  const handleFull = () => setAmountText(String(toTaka(outstanding)));
  const handleClear = () => setAmountText("");

  const handleConfirm = async () => {
    if (parsedAmount === null) {
      setError(t("enterValidAmountLabel"));
      return;
    }
    if (parsedAmount > outstanding) {
      setError(`${t("amountDueLabel")} ${formatMoney(outstanding)}`);
      return;
    }
    setError(null);
    try {
      await onSubmit(parsedAmount, method);
      handleDismiss();
    } catch (caught) {
      setError(userFacingError(caught, "paymentCollectFailedLabel", t));
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleDismiss}>
      <Pressable onPress={handleDismiss} className="flex-1 justify-end bg-black/50">
        <Pressable className="max-h-[85%] gap-4 rounded-t-3xl bg-white p-5">
          <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-4">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans-bold text-lg text-richBlack">{t("makePaymentLabel")}</Text>
              <Pressable onPress={handleDismiss} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
                <Text className="font-sans-semibold text-xl text-midGray">✕</Text>
              </Pressable>
            </View>

            <View className="gap-1 rounded-2xl bg-brand-softGreen p-4">
              <Text className="font-sans-semibold text-base text-richBlack">{customerName}</Text>
              {customerPhone ? <Text className="font-sans text-sm text-midGray">{customerPhone}</Text> : null}
              <View className="mt-2 flex-row items-center justify-between">
                <Text className="font-sans-medium text-sm text-richBlack">{t("totalOutstandingLabel")}</Text>
                <Text className="font-mono text-lg text-error">{formatMoney(outstanding)}</Text>
              </View>
            </View>

            <View className="gap-2">
              <Text className="font-sans-medium text-sm text-richBlack">{t("paymentAmountLabel")}</Text>
              <TextInput
                value={amountText}
                onChangeText={(value) => {
                  setAmountText(value);
                  setError(null);
                }}
                keyboardType="decimal-pad"
                placeholder="0.00"
                accessibilityLabel="Payment amount"
                className="rounded-2xl border border-midGray/40 px-4 py-3 font-mono text-base text-richBlack"
              />
              <View className="flex-row gap-2">
                <Pressable onPress={handleHalf} className="flex-1 items-center rounded-xl border border-brand-green py-2">
                  <Text className="font-sans-semibold text-brand-green">{t("halfLabel")}</Text>
                </Pressable>
                <Pressable onPress={handleFull} className="flex-1 items-center rounded-xl border border-brand-green py-2">
                  <Text className="font-sans-semibold text-brand-green">{t("fullLabel")}</Text>
                </Pressable>
                <Pressable onPress={handleClear} className="flex-1 items-center rounded-xl border border-midGray/40 py-2">
                  <Text className="font-sans-semibold text-midGray">{t("clearLabel")}</Text>
                </Pressable>
              </View>
            </View>

            <View className="gap-2">
              <Text className="font-sans-medium text-sm text-richBlack">{t("paymentMethodLabel")}</Text>
              <View className="flex-row flex-wrap gap-2">
                {METHODS.map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setMethod(option)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: method === option }}
                    className={`rounded-full border px-3 py-2 ${method === option ? "border-brand-green bg-brand-green" : "border-midGray/40"}`}
                  >
                    <Text className={`font-sans-medium text-xs ${method === option ? "text-white" : "text-richBlack"}`}>
                      {paymentMethodLabel(option, t)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {error ? (
              <Text accessibilityRole="alert" className="font-sans text-sm text-error">
                {error}
              </Text>
            ) : null}

            <View className="flex-row gap-3">
              <Pressable onPress={handleDismiss} className="flex-1 items-center rounded-2xl border border-midGray/40 py-4">
                <Text className="font-sans-semibold text-midGray">{t("cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleConfirm()}
                disabled={!canConfirm}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canConfirm }}
                className={`flex-1 items-center rounded-2xl bg-brand-green py-4 ${canConfirm ? "" : "opacity-40"}`}
              >
                <Text className="font-sans-bold text-white">{isSubmitting ? t("confirmingLabel") : t("confirmPaymentLabel")}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
