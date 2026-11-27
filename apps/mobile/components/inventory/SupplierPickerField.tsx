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
import { colors } from "@muthoy/constants";
import type { SupplierPickerOption } from "../../db/suppliers";
import { useI18n } from "../../state/localeStore";
import { NewSupplierSheet, type NewSupplierInput } from "../suppliers/NewSupplierSheet";

interface SupplierPickerFieldProps {
  suppliers: SupplierPickerOption[];
  selectedId: string;
  onSelect: (supplierId: string) => void;
  onCreateSupplier?: (input: NewSupplierInput) => Promise<void>;
  loadManufacturerSuggestions?: (query?: string) => Promise<string[]>;
  /**
   * Item 12 (founder, 2026-11-27): the supplier may be left out, and the
   * stock is then opening stock. The list leads with that choice, and
   * selecting it reports "" (no supplier).
   */
  isOptional?: boolean;
}

export function SupplierPickerField({
  suppliers,
  selectedId,
  onSelect,
  onCreateSupplier,
  loadManufacturerSuggestions,
  isOptional = false,
}: SupplierPickerFieldProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
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
  const choose = (supplierId: string) => {
    onSelect(supplierId);
    setQuery("");
    setOpen(false);
  };

  return (
    <View className="gap-2">
      <Text className="font-sans-semibold text-sm text-richBlack">
        {isOptional ? t("supplierOptionalLabel") : `${t("supplierLabel")} *`}
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
          {selected?.name ?? (isOptional ? t("noSupplierOpeningStockLabel") : t("selectSupplierLabel"))}
        </Text>
        <Feather name="chevron-down" size={18} color={colors.midGray} />
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
                className="h-10 w-10 items-center justify-center"
              >
                <Feather name="x" size={18} color={colors.midGray} />
              </Pressable>
            </View>
            <View className="relative mb-3 mt-3">
              <View className="absolute inset-y-0 left-3 z-10 justify-center">
                <Feather name="search" size={16} color={colors.midGray} />
              </View>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("searchSupplierNameHint")}
                placeholderTextColor={colors.midGray}
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
              {isOptional && !query.trim() ? (
                <Pressable
                  onPress={() => choose("")}
                  accessibilityRole="button"
                  accessibilityLabel={t("noSupplierOpeningStockLabel")}
                  className={`flex-row items-center justify-between rounded-lg px-3 py-2.5 ${
                    selectedId === "" ? "bg-brand-softGreen" : "bg-white"
                  }`}
                >
                  <Text className="flex-1 font-sans-medium text-sm text-richBlack">
                    {t("noSupplierOpeningStockLabel")}
                  </Text>
                  {selectedId === "" ? <Feather name="check" size={16} color={colors.brandGreen} /> : null}
                </Pressable>
              ) : null}
              {candidates.map((supplier) => (
                <Pressable
                  key={supplier.id}
                  onPress={() => choose(supplier.id)}
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
                    <Feather name="check" size={16} color={colors.brandGreen} />
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
                <Feather name="plus" size={16} color={colors.white} />
                <Text className="font-sans-bold text-sm text-white">
                  {t("newSupplierLabel")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>

      {onCreateSupplier ? (
        <NewSupplierSheet
          visible={createOpen}
          onClose={() => setCreateOpen(false)}
          loadManufacturerSuggestions={loadManufacturerSuggestions}
          onSave={async (input) => {
            await onCreateSupplier(input);
            setCreateOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}
