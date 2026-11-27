import { Pressable, Text, View } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
  DOSAGE_FORMS,
  DOSAGE_FORM_ICON,
  DOSAGE_FORM_LABEL,
  DOSAGE_FORM_TINT,
  normalizeDosageForm,
} from "../../domain/dosageForm";
import { useI18n } from "../../state/localeStore";

// The dosage form is picked, never typed (founder, 2026-11-27): a fixed list
// is what lets the Sale list, Inventory and the scanner tell a tablet from a
// capsule of the same name. The value written is the canonical key
// ("tablet", "capsule", …). Tapping the chosen form again clears it — the
// field stays optional.

interface DosageFormPickerProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
}

export function DosageFormPicker({ value, onChange }: DosageFormPickerProps) {
  const { t } = useI18n();
  const selected = normalizeDosageForm(value);
  return (
    <View className="gap-2">
      <Text className="font-sans-semibold text-sm text-richBlack">{t("dosageFormLabel")}</Text>
      <View className="flex-row flex-wrap gap-2">
        {DOSAGE_FORMS.map((form) => {
          const isSelected = form === selected;
          const tint = DOSAGE_FORM_TINT[form];
          return (
            <Pressable
              key={form}
              onPress={() => onChange(isSelected ? "" : form)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={t(DOSAGE_FORM_LABEL[form])}
              className="h-10 flex-row items-center gap-1.5 rounded-full border px-3 active:opacity-80"
              style={{
                borderColor: isSelected ? tint.ink : "#E5E7EB",
                backgroundColor: isSelected ? tint.bg : "#FFFFFF",
              }}
            >
              <MaterialCommunityIcons name={DOSAGE_FORM_ICON[form]} size={16} color={tint.ink} />
              <Text
                className={isSelected ? "font-sans-semibold text-sm" : "font-sans text-sm text-richBlack"}
                style={isSelected ? { color: tint.ink } : undefined}
              >
                {t(DOSAGE_FORM_LABEL[form])}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
