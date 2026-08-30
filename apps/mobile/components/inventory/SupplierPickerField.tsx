import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import type { SupplierPickerOption } from "../../db/suppliers";
import { useI18n } from "../../state/localeStore";

interface SupplierPickerFieldProps {
  suppliers: SupplierPickerOption[];
  selectedId: string;
  onSelect: (supplierId: string) => void;
  onCreateSupplier?: (input: {
    name: string;
    phone: string;
    manufacturer?: string;
    notes?: string;
  }) => Promise<void>;
}

export function SupplierPickerField({
  suppliers,
  selectedId,
  onSelect,
  onCreateSupplier,
}: SupplierPickerFieldProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newManufacturer, setNewManufacturer] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = suppliers.find((supplier) => supplier.id === selectedId);
  const candidates = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return suppliers.slice(0, 10);
    return suppliers
      .filter((supplier) =>
        supplier.name.toLocaleLowerCase().includes(normalized),
      )
      .slice(0, 10);
  }, [query, suppliers]);
  const close = () => {
    setQuery("");
    setOpen(false);
  };
  const closeCreate = () => {
    setCreateOpen(false);
    setCreateError(null);
  };
  const handleCreate = async () => {
    if (!onCreateSupplier) return;
    if (newName.trim().length < 2) {
      setCreateError(t("supplierNameTooShortLabel"));
      return;
    }
    if (newPhone.length !== 10) {
      setCreateError(t("supplierPhoneRequiredLabel"));
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await onCreateSupplier({
        name: newName.trim(),
        phone: `+880${newPhone}`,
        manufacturer: newManufacturer.trim() || undefined,
        notes: newNotes.trim() || undefined,
      });
      setNewName("");
      setNewPhone("");
      setNewManufacturer("");
      setNewNotes("");
      setCreateOpen(false);
    } catch {
      setCreateError(t("supplierSaveFailedLabel"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <View className="gap-2">
      <Text className="font-sans-semibold text-sm text-[#374151]">
        {t("supplierLabel")} *
      </Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t("selectSupplierLabel")}
        className="h-12 flex-row items-center justify-between rounded-xl border border-[#D1D5DB] bg-white px-4"
      >
        <Text
          className={`flex-1 font-sans text-base ${selected ? "text-richBlack" : "text-midGray"}`}
          numberOfLines={1}
        >
          {selected?.name ?? t("selectSupplierLabel")}
        </Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        <View className="flex-1 justify-end bg-black/40">
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel={t("closeLabel")}
            className="absolute inset-0"
          />
          <View className="max-h-[80%] rounded-t-3xl bg-white p-4 shadow-2xl">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans-bold text-lg text-richBlack">
                {t("supplierLabel")}
              </Text>
              <Pressable
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel={t("closeLabel")}
                className="h-8 w-8 items-center justify-center"
              >
                <Feather name="x" size={18} color="#6B7280" />
              </Pressable>
            </View>
            <View className="relative mb-3 mt-3">
              <View className="absolute inset-y-0 left-3 z-10 justify-center">
                <Feather name="search" size={16} color="#6B7280" />
              </View>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("searchSupplierNameHint")}
                placeholderTextColor="#6B7280"
                accessibilityLabel={t("searchSupplierNameHint")}
                autoFocus
                className="h-11 rounded-xl border border-[#D1D5DB] bg-white pl-9 pr-3 font-sans text-sm text-richBlack"
              />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerClassName="gap-1"
            >
              {candidates.map((supplier) => (
                <Pressable
                  key={supplier.id}
                  onPress={() => {
                    onSelect(supplier.id);
                    setQuery("");
                    setOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={supplier.name}
                  className={`flex-row items-center justify-between rounded-lg px-3 py-2.5 ${
                    supplier.id === selectedId
                      ? "bg-brand-softGreen"
                      : "bg-white"
                  }`}
                >
                  <Text className="flex-1 font-sans-medium text-sm text-richBlack">
                    {supplier.name}
                  </Text>
                  {supplier.id === selectedId ? (
                    <Feather name="check" size={16} color="#059669" />
                  ) : null}
                </Pressable>
              ))}
              {candidates.length === 0 ? (
                <Text className="py-4 text-center font-sans text-sm text-midGray">
                  {t("noSuppliersYet")}
                </Text>
              ) : null}
            </ScrollView>
            {onCreateSupplier ? (
              <Pressable
                onPress={() => {
                  close();
                  setCreateOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={t("newSupplierLabel")}
                className="mt-3 h-11 flex-row items-center justify-center gap-2 rounded-xl bg-brand-green"
              >
                <Feather name="plus" size={16} color="#FFFFFF" />
                <Text className="font-sans-bold text-sm text-white">
                  {t("newSupplierLabel")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        visible={createOpen}
        transparent
        animationType="slide"
        onRequestClose={closeCreate}
      >
        <View className="flex-1 justify-end bg-black/40">
          <Pressable
            onPress={closeCreate}
            accessibilityRole="button"
            accessibilityLabel={t("closeLabel")}
            className="absolute inset-0"
          />
          <View className="gap-3 rounded-t-3xl bg-white p-5 shadow-2xl">
            <View className="mb-1 flex-row items-center justify-between">
              <Text className="font-sans-bold text-lg text-richBlack">
                {t("newSupplierLabel")}
              </Text>
              <Pressable
                onPress={closeCreate}
                accessibilityRole="button"
                accessibilityLabel={t("closeLabel")}
                className="h-8 w-8 items-center justify-center"
              >
                <Feather name="x" size={20} color="#6B7280" />
              </Pressable>
            </View>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder={t("supplierNameLabel")}
              placeholderTextColor="#6B7280"
              accessibilityLabel={t("supplierNameLabel")}
              autoFocus
              className="h-11 rounded-xl border border-[#E5E7EB] bg-white px-4 font-sans text-base text-richBlack"
            />
            <View className="relative">
              <View className="absolute inset-y-0 left-4 z-10 justify-center">
                <Text className="font-sans-semibold text-[15px] text-richBlack">
                  +880
                </Text>
              </View>
              <TextInput
                value={newPhone}
                onChangeText={(value) =>
                  setNewPhone(value.replace(/\D/g, "").slice(0, 10))
                }
                placeholder="1XXX XXX XXX"
                placeholderTextColor="#6B7280"
                accessibilityLabel={t("phone")}
                keyboardType="phone-pad"
                maxLength={10}
                className="h-11 rounded-xl border border-[#E5E7EB] bg-white pl-16 pr-4 font-sans text-[15px] text-richBlack"
              />
            </View>
            <TextInput
              value={newManufacturer}
              onChangeText={setNewManufacturer}
              placeholder={t("manufacturerCompanyLabel")}
              placeholderTextColor="#6B7280"
              accessibilityLabel={t("manufacturerCompanyLabel")}
              className="h-11 rounded-xl border border-[#E5E7EB] bg-white px-4 font-sans text-base text-richBlack"
            />
            <TextInput
              value={newNotes}
              onChangeText={setNewNotes}
              placeholder={t("notesOptionalLabel")}
              placeholderTextColor="#6B7280"
              accessibilityLabel={t("notesOptionalLabel")}
              className="h-11 rounded-xl border border-[#E5E7EB] bg-white px-4 font-sans text-base text-richBlack"
            />
            {createError ? (
              <Text className="font-sans text-xs text-error">{createError}</Text>
            ) : null}
            <Pressable
              onPress={() => void handleCreate()}
              disabled={creating}
              accessibilityRole="button"
              accessibilityLabel={t("saveMedicineLabel")}
              className="h-12 items-center justify-center rounded-xl bg-brand-green disabled:opacity-50"
            >
              <Text className="font-sans-bold text-white">
                {creating ? t("savingMedicineLabel") : t("saveMedicineLabel")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
