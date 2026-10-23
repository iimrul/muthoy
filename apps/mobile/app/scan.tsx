import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { MedicineTextScanner } from "../components/scanner/MedicineTextScanner";
import {
  ScanConfirmSheet,
  type ScanConfirmCandidate,
} from "../components/scanner/ScanConfirmSheet";
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

// app/scan.tsx — the dedicated scan-to-sell screen.
//
// W2-01 section 6.2.3: an exact OCR match used to go straight into the cart.
// A cart line is the first step of a money path, and the founder's own recovery
// note for this feature is "a misread got saved without confirmation — add the
// confirmation step back, it must never be skippable". So a match now waits in
// ScanConfirmSheet, and addItem is reachable from Confirm and nowhere else.
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
  const [pendingScan, setPendingScan] = useState<ScanConfirmCandidate | null>(
    null,
  );
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
      // Proposed, not recorded. Nothing reaches the cart until Confirm.
      setError(null);
      setFeedback(null);
      setPendingScan({
        recognizedText: candidate,
        medicineId: exact.medicineId,
        name: exact.name,
        generic: exact.generic,
        manufacturer: exact.manufacturer,
        requiresPrescription: exact.requiresPrescription,
        batchId: exact.activeBatch.id,
        batchNo: exact.activeBatchNo,
        expiryDate: exact.activeBatch.expiryDate,
        unitPrice: exact.activeBatch.salePrice,
        availableQuantity: exact.activeBatch.quantityAvailable,
      });
    } catch {
      setError(t("scanSearchFailed"));
    }
  };

  const confirmPendingScan = (confirmed: ScanConfirmCandidate) => {
    // Every field the cart uses for SAFETY travels with the line:
    // requiresPrescription drives the prescription warning, and
    // availableQuantity is the stock ceiling addItem enforces. This screen used
    // to pass five fields, so a line added here had neither — the in-screen
    // scanner in app/(tabs)/sale.tsx always passed all of them, and the two
    // paths must not disagree about what a confirmed scan means.
    const added = addItem({
      medicineId: confirmed.medicineId,
      medicineName: confirmed.name,
      generic: confirmed.generic,
      manufacturer: confirmed.manufacturer,
      requiresPrescription: confirmed.requiresPrescription,
      batchId: confirmed.batchId,
      batchNo: confirmed.batchNo ?? undefined,
      expiryDate: confirmed.expiryDate,
      availableQuantity: confirmed.availableQuantity,
      quantity: 1,
      unitPrice: confirmed.unitPrice,
    });
    setPendingScan(null);
    if (!added) {
      // addItem refuses at the stock ceiling. Reporting success here would tell
      // the seller a line exists that does not.
      setFeedback(null);
      setError(t("cartQuantityAtStockLimitLabel"));
      return;
    }
    setError(null);
    setFeedback(`${confirmed.name} · ${formatNumber(cartCount + 1)}`);
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
      <ScanConfirmSheet
        candidate={pendingScan}
        onConfirm={confirmPendingScan}
        // Correction happens in the Sale screen's own search, carrying the
        // recognised text across rather than rebuilding a second search UI here.
        onEdit={(candidate) => {
          setPendingScan(null);
          router.replace({
            pathname: "/sale",
            params: { q: candidate.recognizedText },
          });
        }}
        onDiscard={() => setPendingScan(null)}
      />
    </View>
  );
}
