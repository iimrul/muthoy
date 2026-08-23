import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { fromTaka, type Paisa } from "@muthoy/types";
import { withdrawalFormSchema } from "@muthoy/validation";
import { useI18n } from "../../state/localeStore";

// The prototype's withdrawal sheet (CH-14) — amount + optional note.
// Owner-gated at the data layer (db/cash.recordWithdrawal); this component
// is presentational only and does not itself check the role.

interface WithdrawSheetProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (amount: Paisa, note?: string) => Promise<void>;
}

export function WithdrawSheet({ visible, onClose, onSubmit }: WithdrawSheetProps) {
  const { t } = useI18n();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // CH-14: Cancel/backdrop-dismiss does NOT clear the fields — only a
  // successful Save does. A shopkeeper interrupted mid-entry should find
  // their draft amount still there on reopen.
  const handleDismiss = () => {
    setError(null);
    onClose();
  };

  const parsed = withdrawalFormSchema.safeParse({
    amountTaka: Number(amount.trim()),
    note,
  });
  const canSave = amount.trim().length > 0 && parsed.success && !isSaving;

  const handleSave = async () => {
    if (!parsed.success || !amount.trim()) {
      setError(t("withdrawInvalid"));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSubmit(fromTaka(parsed.data.amountTaka), parsed.data.note);
      setAmount("");
      setNote("");
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("withdrawInvalid"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleDismiss}>
      <Pressable onPress={handleDismiss} className="flex-1 justify-end bg-black/50">
        <Pressable className="gap-4 rounded-t-3xl bg-white p-5">
          <View className="gap-1">
            <Text className="font-sans-bold text-lg text-richBlack">{t("withdrawQuestion")}</Text>
            <Text className="font-sans text-xs text-midGray">{t("withdrawHint")}</Text>
          </View>

          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            accessibilityLabel={t("withdraw")}
            className="rounded-2xl border border-midGray/40 px-4 py-3 font-mono text-base text-richBlack"
          />

          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={t("notePlaceholder")}
            accessibilityLabel={t("notePlaceholder")}
            className="rounded-2xl border border-midGray/40 px-4 py-3 font-sans text-sm text-richBlack"
          />

          {error ? (
            <Text accessibilityRole="alert" className="font-sans text-sm text-error">
              {error}
            </Text>
          ) : null}

          <Pressable
            onPress={() => void handleSave()}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
            className={`items-center rounded-2xl bg-brand-green py-4 ${canSave ? "" : "opacity-40"}`}
          >
            <Text className="font-sans-bold text-white">{t("save")}</Text>
          </Pressable>

          <Pressable
            onPress={handleDismiss}
            accessibilityRole="button"
            className="items-center rounded-2xl border border-midGray/40 py-3"
          >
            <Text className="font-sans-semibold text-midGray">{t("cancel")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
