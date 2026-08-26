import { useMemo, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import type { SupplierPickerOption } from "../../db/suppliers";
import { useI18n } from "../../state/localeStore";

interface SupplierPickerFieldProps {
  suppliers: SupplierPickerOption[];
  selectedId: string;
  onSelect: (supplierId: string) => void;
}

export function SupplierPickerField({
  suppliers,
  selectedId,
  onSelect,
}: SupplierPickerFieldProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  return (
    <View className="gap-2">
      <Text className="font-sans-medium text-sm text-richBlack">
        {t("supplierLabel")} *
      </Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t("selectSupplierLabel")}
        className="h-12 flex-row items-center justify-between rounded-xl border border-midGray bg-white px-4"
      >
        <Text
          className={`flex-1 font-sans text-sm ${selected ? "text-richBlack" : "text-midGray"}`}
          numberOfLines={1}
        >
          {selected?.name ?? t("selectSupplierLabel")}
        </Text>
        <Feather name="chevron-down" size={18} color="#6B7280" />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <View className="max-h-[80%] gap-3 rounded-t-3xl bg-white p-5">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans-bold text-lg text-richBlack">
                {t("supplierLabel")}
              </Text>
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={t("closeLabel")}
                className="h-9 w-9 items-center justify-center rounded-full bg-brand-softGreen"
              >
                <Feather name="x" size={18} color="#6B7280" />
              </Pressable>
            </View>
            <View className="relative">
              <View className="absolute inset-y-0 left-3 z-10 justify-center">
                <Feather name="search" size={16} color="#6B7280" />
              </View>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("searchSupplierNameHint")}
                accessibilityLabel={t("searchSupplierNameHint")}
                autoFocus
                className="h-11 rounded-xl border border-midGray bg-white pl-9 pr-3 font-sans text-sm text-richBlack"
              />
            </View>
            <View className="gap-1">
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
                  className={`flex-row items-center justify-between rounded-xl px-3 py-3 ${
                    supplier.id === selectedId
                      ? "bg-brand-softGreen"
                      : "bg-white"
                  }`}
                >
                  <Text className="flex-1 font-sans-medium text-sm text-richBlack">
                    {supplier.name}
                  </Text>
                </Pressable>
              ))}
              {candidates.length === 0 ? (
                <Text className="py-4 text-center font-sans text-sm text-midGray">
                  {t("noSuppliersYet")}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
