import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { fromTaka, type Paisa } from "@muthoy/types";
import { openingCashFormSchema } from "@muthoy/validation";
import { useI18n } from "../../state/localeStore";

// Opening-cash bottom sheet — the prototype's OpeningCashModal.
//
// Presentational: it collects an amount and hands paisa to `onSubmit`. The
// screen owns the session guard and calls db/cash.setOpeningCash, which is
// where CLAUDE.md rule 5 is actually enforced (written against TODAY's
// business date only, so yesterday's value can never be inherited).

/** Quick-pick amounts in TAKA, converted to paisa before they leave here. */
const OPENING_CHIPS = [500, 1000, 2000, 5000] as const;

interface OpeningCashModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (openingCash: Paisa) => Promise<void>;
  /**
   * False on the first open of a business date: the owner is being asked, so
   * the backdrop does not dismiss. Cancel always does.
   */
  isDismissable: boolean;
}

export function OpeningCashModal({
  visible,
  onClose,
  onSubmit,
  isDismissable,
}: OpeningCashModalProps) {
  const { t, formatNumber } = useI18n();
  const [amount, setAmount] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cleared on the way OUT, in the event handler, rather than in an effect
  // watching `visible` — a sheet that reopens is always blank either way, and
  // an effect here would cascade a render on every open.
  const handleClose = () => {
    setAmount("");
    setError(null);
    onClose();
  };

  const parsed = openingCashFormSchema.safeParse({
    openingCashTaka: Number(amount.trim()),
  });
  const canSave = amount.trim().length > 0 && parsed.success && !isSaving;

  const handleSave = async () => {
    if (!parsed.success || !amount.trim()) {
      setError(t("openingCashInvalid"));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSubmit(fromTaka(parsed.data.openingCashTaka));
      handleClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("openingCashInvalid"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable
        onPress={isDismissable ? handleClose : undefined}
        className="flex-1 justify-end bg-black/50"
      >
        <Pressable className="gap-4 rounded-t-3xl bg-white p-5">
          <View className="gap-1">
            <Text className="font-sans-semibold text-[10px] uppercase tracking-widest text-brand-green">
              {t("openingCash")}
            </Text>
            <Text className="font-sans-bold text-lg text-richBlack">
              {t("openingCashQuestion")}
            </Text>
            <Text className="font-sans text-xs text-midGray">
              {t("openingCashHint")}
            </Text>
          </View>

          <View className="flex-row gap-2">
            {OPENING_CHIPS.map((taka) => {
              const isActive = Number(amount) === taka;
              return (
                <Pressable
                  key={taka}
                  onPress={() => setAmount(String(taka))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={`${t("openingCash")} ${taka}`}
                  className={`flex-1 items-center rounded-2xl border py-3 ${
                    isActive
                      ? "border-brand-green bg-brand-softGreen"
                      : "border-midGray/40 bg-white"
                  }`}
                >
                  <Text className="font-mono text-sm text-richBlack">
                    ৳{formatNumber(taka)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View className="gap-1.5">
            <Text className="font-sans-semibold text-[11px] uppercase tracking-wide text-midGray">
              {t("orEnterAmount")}
            </Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              accessibilityLabel={t("orEnterAmount")}
              className="rounded-2xl border border-midGray/40 px-4 py-3 font-mono text-base text-richBlack"
            />
          </View>

          {error ? (
            <Text
              accessibilityRole="alert"
              className="font-sans text-sm text-error"
            >
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
            <Text className="font-sans-bold text-white">
              {t("saveOpeningCash")}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleClose}
            accessibilityRole="button"
            className="items-center rounded-2xl border border-midGray/40 py-3"
          >
            <Text className="font-sans-semibold text-midGray">
              {t("cancel")}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
