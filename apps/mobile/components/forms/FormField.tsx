import { hasExcessMoneyDecimals, moneyDraftValue } from '@muthoy/validation';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Controller, useFormState, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Text, View, type KeyboardTypeOptions } from 'react-native';
import { AppTextInput as TextInput } from "../ui/AppTextInput";
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

// Keep editing text separate from RHF's numeric value: Number('1.') would
// otherwise erase the decimal before Android can enter the fractional digits.
export function NumericTextInput({
  value, resetValues, onChangeText, money = false, errorMessage, ...props
}: Omit<ComponentProps<typeof TextInput>, 'value'> & {
  value: unknown; resetValues?: unknown; money?: boolean; errorMessage?: string;
}) {
  const { t } = useI18n();
  const display = (input: unknown) => input === undefined || input === null ? '' : String(input);
  const [draft, setDraft] = useState(() => display(value));
  const emittedValue = useRef(value);
  const previousReset = useRef(resetValues);
  const pendingEchoes = useRef<unknown[]>([]);
  useEffect(() => {
    if (previousReset.current !== resetValues) {
      pendingEchoes.current = [];
      setDraft(display(value));
      emittedValue.current = value;
    } else {
      // Native text events can outrun RHF renders. An older echo must not
      // replace the current editable string, including invalid precision.
      const echo = pendingEchoes.current.findIndex(item => Object.is(item, value));
      if (echo >= 0) pendingEchoes.current.splice(0, echo + 1);
      else if (!Object.is(value, emittedValue.current)) {
        pendingEchoes.current = [];
        setDraft(display(value));
        emittedValue.current = value;
      }
    }
    previousReset.current = resetValues;
  }, [value, resetValues]);
  const message = money && hasExcessMoneyDecimals(draft) ? t("moneyPrecisionLabel") : localizeValidationMessage(errorMessage, t);
  return <><TextInput {...props} value={draft} onChangeText={(text) => {
    setDraft(text);
    const next = money ? moneyDraftValue(text) : text === '' ? undefined : Number(text);
    if (!Object.is(next, emittedValue.current)) pendingEchoes.current.push(next);
    emittedValue.current = next;
    onChangeText?.(text);
  }} />{message ? <Text className="font-sans text-sm text-error">{message}</Text> : null}</>;
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
  const { defaultValues } = useFormState({ control });
  const isNumeric = numeric || money;
  const Input = isNumeric ? NumericTextInput : TextInput;
  return (
    <View className="gap-2">
      <Text className={`${prototypeStyle ? 'font-sans-semibold' : 'font-sans-medium'} text-sm text-richBlack`}>{label}</Text>
      <Controller
        control={control}
        name={name}
        rules={money ? { validate: (value) => !Number.isNaN(value) || "Use no more than two decimal places" } : undefined}
        render={({ field: { value, onChange, onBlur }, fieldState: { error } }) => (
          <>
            <Input
              {...(isNumeric ? { resetValues: defaultValues, money, errorMessage: error?.message } : {})}
              value={isNumeric ? value : value === undefined || value === null ? '' : String(value)}
              onChangeText={(text) => onChange(money ? moneyDraftValue(text) : isNumeric ? (text === '' ? undefined : Number(text)) : text)}
              onBlur={onBlur}
              placeholder={placeholder}
              placeholderTextColor={prototypeStyle ? '#6B7280' : undefined}
              keyboardType={keyboardType ?? (isNumeric ? 'decimal-pad' : undefined)}
              autoCapitalize={autoCapitalize}
              accessibilityLabel={label}
              className={`${prototypeStyle ? 'h-12 rounded-xl border-[#D1D5DB]' : 'rounded-lg border-midGray py-3'} border bg-white px-4 text-base text-richBlack ${money ? 'font-mono' : 'font-sans'}`}
            />
            {!isNumeric && error ? <Text className="font-sans text-sm text-error">{localizeValidationMessage(error.message, t)}</Text> : null}
          </>
        )}
      />
    </View>
  );
}
