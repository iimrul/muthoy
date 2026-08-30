import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { localizeValidationMessage } from '../../i18n/display';
import { useI18n } from '../../state/localeStore';

// FormField — label + Controller-wired TextInput + inline error, extracted
// from RegistrationForm.tsx's repeated block. Add Medicine has 11+ fields;
// repeating that block per field would violate DRY (coding-style.md).

export interface FormFieldProps<TFieldValues extends FieldValues> {
  control: Control<TFieldValues>;
  name: FieldPath<TFieldValues>;
  label: string;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  /** TextInput always produces a string; numeric fields convert to/from Number for RHF/Zod. */
  numeric?: boolean;
  /** Money inputs use the required DM Mono token. */
  money?: boolean;
  /** Add Medicine's prototype uses a taller, lighter-bordered input shell. */
  prototypeStyle?: boolean;
}

export function FormField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  keyboardType,
  autoCapitalize,
  numeric = false,
  money = false,
  prototypeStyle = false,
}: FormFieldProps<TFieldValues>) {
  const { t } = useI18n();
  return (
    <View className="gap-2">
      <Text className={`${prototypeStyle ? 'font-sans-semibold' : 'font-sans-medium'} text-sm text-richBlack`}>{label}</Text>
      <Controller
        control={control}
        name={name}
        render={({ field: { value, onChange, onBlur }, fieldState: { error } }) => (
          <>
            <TextInput
              value={value === undefined || value === null ? '' : String(value)}
              onChangeText={(text) => onChange(numeric ? (text === '' ? undefined : Number(text)) : text)}
              onBlur={onBlur}
              placeholder={placeholder}
              placeholderTextColor={prototypeStyle ? '#6B7280' : undefined}
              keyboardType={keyboardType ?? (numeric ? 'decimal-pad' : undefined)}
              autoCapitalize={autoCapitalize}
              accessibilityLabel={label}
              className={`${prototypeStyle ? 'h-12 rounded-xl border-[#D1D5DB]' : 'rounded-lg border-midGray py-3'} border bg-white px-4 text-base text-richBlack ${money ? 'font-mono' : 'font-sans'}`}
            />
            {error ? <Text className="font-sans text-sm text-error">{localizeValidationMessage(error.message, t)}</Text> : null}
          </>
        )}
      />
    </View>
  );
}
