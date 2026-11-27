import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { colors } from "@muthoy/constants";
import { AppTextInput as TextInput } from "../ui/AppTextInput";
import { ManufacturerPicker } from "../inventory/ManufacturerPicker";
import { DuplicateSupplierError } from "../../db/suppliers";
import { useI18n } from "../../state/localeStore";

// The prototype's AddSupplierModal (screens/Suppliers.tsx), as ONE sheet used
// by both places a supplier is created: the Suppliers page's "+" button and
// the supplier picker inside Add Medicine (founder, 2026-11-27: "prototype
// web follow করো … একদম ঐভাবে করো"). Name, +880 phone, company and an
// optional note; name and phone are required, and the same name+phone twice
// is refused with the prototype's own wording.

export interface NewSupplierInput {
  name: string;
  /** Canonical "+8801XXXXXXXXX". */
  phone: string;
  manufacturer?: string;
  notes?: string;
}

interface NewSupplierSheetProps {
  visible: boolean;
  onClose: () => void;
  onSave: (input: NewSupplierInput) => Promise<void>;
  /** Company suggestions as the owner types (the shop's own manufacturers). */
  loadManufacturerSuggestions?: (query?: string) => Promise<string[]>;
}

export function NewSupplierSheet({ visible, onClose, onSave, loadManufacturerSuggestions }: NewSupplierSheetProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [notes, setNotes] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const reset = () => {
    setName("");
    setPhone("");
    setManufacturer("");
    setNotes("");
    setSuggestions([]);
    setError(null);
  };
  const close = () => {
    if (isSaving) return;
    reset();
    onClose();
  };

  const save = async () => {
    if (name.trim().length < 2) {
      setError(t("supplierNameTooShortLabel"));
      return;
    }
    if (!/^1\d{9}$/.test(phone)) {
      setError(t("supplierPhoneRequiredLabel"));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        phone: `+880${phone}`,
        manufacturer: manufacturer.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      reset();
    } catch (caught) {
      setError(t(caught instanceof DuplicateSupplierError ? "supplierDuplicateLabel" : "supplierSaveFailedLabel"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t("closeLabel")} className="absolute inset-0" />
        <View className="gap-3 rounded-t-3xl bg-white p-5 shadow-2xl">
          <View className="mb-1 flex-row items-center justify-between">
            <Text className="font-sans-bold text-lg text-richBlack">{t("newSupplierLabel")}</Text>
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t("closeLabel")} className="h-10 w-10 items-center justify-center">
              <Feather name="x" size={20} color={colors.midGray} />
            </Pressable>
          </View>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t("supplierNameLabel")}
            accessibilityLabel={t("supplierNameLabel")}
            autoFocus
            className="h-11 rounded-xl border border-auth-fieldBorder bg-white px-4 font-sans text-base"
          />
          <View className="relative">
            <View className="absolute inset-y-0 left-4 z-10 justify-center">
              <Text className="font-sans-semibold text-[15px] text-richBlack">+880</Text>
            </View>
            <TextInput
              value={phone}
              onChangeText={(value) => setPhone(value.replace(/\D/g, "").replace(/^0/, "").slice(0, 10))}
              placeholder="1XXX XXX XXX"
              accessibilityLabel={t("phone")}
              keyboardType="phone-pad"
              maxLength={11}
              className="h-11 rounded-xl border border-auth-fieldBorder bg-white pl-16 pr-4 font-sans text-[15px]"
            />
          </View>
          <ManufacturerPicker
            value={manufacturer}
            onChange={setManufacturer}
            label={t("manufacturerCompanyLabel")}
            suggestions={suggestions}
            onRequestSuggestions={(query) => {
              if (loadManufacturerSuggestions) void loadManufacturerSuggestions(query).then(setSuggestions).catch(() => setSuggestions([]));
            }}
            onDismissSuggestions={() => setSuggestions([])}
          />
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder={t("notesOptionalLabel")}
            accessibilityLabel={t("notesOptionalLabel")}
            className="h-11 rounded-xl border border-auth-fieldBorder bg-white px-4 font-sans text-base"
          />
          {error ? <Text accessibilityRole="alert" className="font-sans text-xs text-error">{error}</Text> : null}
          <Pressable
            onPress={() => void save()}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel={t("saveSupplierLabel")}
            className="h-12 items-center justify-center rounded-xl bg-brand-green active:opacity-80 disabled:opacity-50"
          >
            <Text className="font-sans-bold text-white">{isSaving ? t("savingChangesLabel") : t("saveSupplierLabel")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
