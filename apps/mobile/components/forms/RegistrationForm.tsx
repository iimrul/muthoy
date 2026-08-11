import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pressable, Text, TextInput, View } from 'react-native';
import { registerSchema, type RegisterInput } from '@muthoy/validation';

// RegistrationForm — Volume 0 Day 4: "shop name + phone only." RHF + Zod
// (DEVELOPMENT_RULES.md: "Every input boundary... validated with Zod before
// it reaches domain logic"). Presentation + validation only — the actual
// db/auth.ts write happens in the parent screen, on submit.

export interface RegistrationFormProps {
  onSubmit: (input: RegisterInput) => void;
  isSubmitting?: boolean;
}

export function RegistrationForm({ onSubmit, isSubmitting = false }: RegistrationFormProps) {
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { shopName: '', phone: '' },
  });

  return (
    <View className="gap-5">
      <View className="gap-2">
        <Text className="font-sans-medium text-sm text-richBlack">Shop name</Text>
        <Controller
          control={control}
          name="shopName"
          render={({ field: { value, onChange, onBlur } }) => (
            <TextInput
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="e.g. Ruhin Pharmacy"
              className="rounded-lg border border-midGray bg-white px-4 py-3 font-sans text-base text-richBlack"
            />
          )}
        />
        {errors.shopName ? <Text className="font-sans text-sm text-error">{errors.shopName.message}</Text> : null}
      </View>

      <View className="gap-2">
        <Text className="font-sans-medium text-sm text-richBlack">Phone number</Text>
        <Controller
          control={control}
          name="phone"
          render={({ field: { value, onChange, onBlur } }) => (
            <TextInput
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="01712345678"
              keyboardType="phone-pad"
              className="rounded-lg border border-midGray bg-white px-4 py-3 font-sans text-base text-richBlack"
            />
          )}
        />
        {errors.phone ? <Text className="font-sans text-sm text-error">{errors.phone.message}</Text> : null}
      </View>

      <Pressable
        onPress={handleSubmit(onSubmit)}
        disabled={isSubmitting}
        className="items-center rounded-lg bg-brand-green py-3.5 active:opacity-80"
      >
        <Text className="font-sans-semibold text-base text-white">{isSubmitting ? 'Please wait…' : 'Continue'}</Text>
      </Pressable>
    </View>
  );
}
