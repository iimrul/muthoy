import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

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
}: FormFieldProps<TFieldValues>) {
  return (
    <View className="gap-2">
      <Text className="font-sans-medium text-sm text-richBlack">{label}</Text>
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
              keyboardType={keyboardType ?? (numeric ? 'decimal-pad' : undefined)}
              autoCapitalize={autoCapitalize}
              accessibilityLabel={label}
              className={`rounded-lg border border-midGray bg-white px-4 py-3 text-base text-richBlack ${money ? 'font-mono' : 'font-sans'}`}
            />
            {error ? <Text className="font-sans text-sm text-error">{error.message}</Text> : null}
          </>
        )}
      />
    </View>
  );
}
