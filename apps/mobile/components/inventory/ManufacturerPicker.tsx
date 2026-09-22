import { Pressable, Text, TextInput, View } from 'react-native';
import { colors } from '@muthoy/constants';
import { useI18n } from '../../state/localeStore';

// components/inventory/ManufacturerPicker.tsx — Phase C Pass 1.
//
// The manufacturer field was inline suggestions inside ManualEntryForm, while
// the supplier field next to it was a reusable SupplierPickerField. Two fields
// doing the same job in the same form, built two different ways, is precisely
// the drift Pass 1 exists to remove.
//
// Presentation only, and deliberately so: the caller passes suggestions in and
// handles the lookup. This component never imports db/ — keeping the shop id
// and the query on the screen side is what stops a picker from quietly becoming
// a data-access path (DEVELOPMENT_RULES.md, CLAUDE.md rule 1).

export interface ManufacturerPickerProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Asked for on focus (no argument) and on each keystroke (the typed text). */
  onRequestSuggestions: (query?: string) => void;
  suggestions: readonly string[];
  /** Cleared by the caller once a suggestion is taken. */
  onDismissSuggestions: () => void;
  errorMessage?: string | null;
  label?: string;
}

export function ManufacturerPicker({
  value,
  onChange,
  onBlur,
  onRequestSuggestions,
  suggestions,
  onDismissSuggestions,
  errorMessage,
  label,
}: ManufacturerPickerProps) {
  const { t } = useI18n();
  const fieldLabel = label ?? t('manufacturerLabel');

  return (
    <>
      <TextInput
        value={value}
        onBlur={onBlur}
        onFocus={() => onRequestSuggestions()}
        onChangeText={(text) => {
          onChange(text);
          onRequestSuggestions(text);
        }}
        placeholder={t('manufacturerPlaceholder')}
        placeholderTextColor={colors.midGray}
        accessibilityLabel={fieldLabel}
        className="h-12 rounded-xl border border-fieldBorder bg-white px-4 font-sans text-base text-richBlack"
      />
      {suggestions.length ? (
        <View className="flex-row flex-wrap gap-2">
          {suggestions.map((name) => (
            <Pressable
              key={name}
              onPress={() => {
                onChange(name);
                onDismissSuggestions();
              }}
              accessibilityRole="button"
              accessibilityLabel={name}
              className="rounded-full bg-white px-3 py-2"
            >
              <Text className="font-sans text-xs text-brand-green">{name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {errorMessage ? (
        <Text className="font-sans text-sm text-error">{errorMessage}</Text>
      ) : null}
    </>
  );
}
