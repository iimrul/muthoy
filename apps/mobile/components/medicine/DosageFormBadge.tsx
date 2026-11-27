import { Text, View } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
  DOSAGE_FORM_ICON,
  DOSAGE_FORM_LABEL,
  DOSAGE_FORM_TINT,
  normalizeDosageForm,
  type DosageForm,
} from "../../domain/dosageForm";
import { useI18n } from "../../state/localeStore";

// Founder, 2026-11-27: "কোনটা ট্যাবলেট, ক্যাপসুল, সিরাপ … বুঝার কোন উপায় নাই".
// One colour and icon per dosage form, shown wherever a medicine is picked
// (Sale list, cart, Inventory, Expiry, the scan choice), so Telmepress 20
// tablet and Telmepress 20 capsule are told apart before a word is read.

/** The round, colour-coded icon. Unknown forms draw the neutral "other". */
export function DosageFormIcon({ type, size = 40 }: { type: string | null | undefined; size?: number }) {
  const form: DosageForm = normalizeDosageForm(type) ?? "other";
  const tint = DOSAGE_FORM_TINT[form];
  return (
    <View
      testID={`dosage-form-icon-${form}`}
      className="items-center justify-center rounded-xl"
      style={{ width: size, height: size, backgroundColor: tint.bg }}
    >
      <MaterialCommunityIcons name={DOSAGE_FORM_ICON[form]} size={Math.round(size * 0.55)} color={tint.ink} />
    </View>
  );
}

/**
 * "[icon] ট্যাবলেট · 20mg" — the form label in its own colour, then the
 * strength. Renders nothing when neither was recorded.
 */
export function DosageFormTag({ type, strength }: { type: string | null | undefined; strength?: string | null }) {
  const { t } = useI18n();
  const form = normalizeDosageForm(type);
  const cleanStrength = strength?.trim() || null;
  if (!form && !cleanStrength) return null;
  const tint = DOSAGE_FORM_TINT[form ?? "other"];
  return (
    <View testID="dosage-form-tag" className="flex-row items-center gap-1">
      {form ? (
        <View className="flex-row items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: tint.bg }}>
          <MaterialCommunityIcons name={DOSAGE_FORM_ICON[form]} size={12} color={tint.ink} />
          <Text className="font-sans-semibold text-xs" style={{ color: tint.ink }}>
            {t(DOSAGE_FORM_LABEL[form])}
          </Text>
        </View>
      ) : null}
      {cleanStrength ? <Text className="font-sans-medium text-xs text-richBlack">{cleanStrength}</Text> : null}
    </View>
  );
}
