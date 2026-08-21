import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { MedicineTextScanner } from "../components/scanner/MedicineTextScanner";
import { StandardHeader } from "../components/ui/StandardHeader";
import { searchMedicinesForSale } from "../db/sales";
import { requirePermission } from "../db/auth";
import {
  extractMedicineNameCandidate,
  findExactNameMatch,
} from "../domain/ocrText";
import { useI18n } from "../state/localeStore";
import { useCartStore } from "../state/cartStore";
import { useSessionStore } from "../state/sessionStore";

export default function ScanSaleScreen() {
  const session = useSessionStore((state) => state.session);
  const addItem = useCartStore((state) => state.addItem);
  const cartCount = useCartStore((state) =>
    state.items.reduce((sum, item) => sum + item.quantity, 0),
  );
  const { t, formatNumber } = useI18n();
  const [scannerVisible, setScannerVisible] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!session) return null;

  const handleRecognized = async (recognizedText: string) => {
    const candidate =
      extractMedicineNameCandidate(recognizedText) ?? recognizedText.trim();
    try {
      await requirePermission(session.shopId, session.userId, "sale_entry");
      const matches = await searchMedicinesForSale(session.shopId, candidate);
      const exact = findExactNameMatch(candidate, matches);
      if (!exact) {
        setFeedback(null);
        setError(t("noExactMedicine"));
        return;
      }
      addItem({
        medicineId: exact.medicineId,
        medicineName: exact.name,
        batchId: exact.activeBatch.id,
        quantity: 1,
        unitPrice: exact.activeBatch.salePrice,
      });
      setError(null);
      setFeedback(`${exact.name} · ${formatNumber(cartCount + 1)}`);
    } catch {
      setError(t("scanSearchFailed"));
    }
  };

  return (
    <View className="flex-1 bg-brand-softGreen pb-20">
      <StandardHeader title={t("scan")} onBackPress={() => router.back()} />
      <View className="flex-1 items-center justify-center gap-4 p-6">
        {feedback ? (
          <Text className="text-center font-sans-semibold text-brand-green">
            {feedback}
          </Text>
        ) : null}
        {error ? (
          <Text className="text-center font-sans text-error">{error}</Text>
        ) : null}
        <Text className="font-sans text-midGray">
          {formatNumber(cartCount)} {t("cartItems")}
        </Text>
        <Pressable
          onPress={() => setScannerVisible(true)}
          className="w-full items-center rounded-xl bg-brand-green py-4"
        >
          <Text className="font-sans-bold text-white">{t("scan")}</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push("/sale/cart")}
          className="w-full items-center rounded-xl bg-richBlack py-4"
        >
          <Text className="font-sans-bold text-white">
            {t("done")} · {formatNumber(cartCount)}
          </Text>
        </Pressable>
        <Pressable onPress={() => router.replace("/sale")}>
          <Text className="font-sans-semibold text-brand-green">
            {t("searchManually")}
          </Text>
        </Pressable>
      </View>
      <MedicineTextScanner
        visible={scannerVisible}
        mode="lookup"
        onClose={() => setScannerVisible(false)}
        onTextRecognized={(text) => void handleRecognized(text)}
      />
    </View>
  );
}
