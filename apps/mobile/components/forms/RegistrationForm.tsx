import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Text, TextInput, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '@muthoy/constants';
import { registerSchema, type RegisterInput } from '@muthoy/validation';
import { AuthButton } from '../auth/AuthButton';
import { AuthNotice } from '../auth/AuthNotice';
import { PhoneField } from '../auth/PhoneField';
import { authPhoneForSubmit } from '../auth/phoneInput';
import { useCopyFont } from '../auth/typography';
import { localizeValidationMessage } from '../../i18n/display';
import { useI18n } from '../../state/localeStore';

// RegistrationForm — Volume 0 Day 4: "shop name + phone only." RHF + Zod
// (DEVELOPMENT_RULES.md: "Every input boundary... validated with Zod before
// it reaches domain logic"). Presentation + validation only — the actual
// db/auth.ts write happens in the parent screen, on submit.
//
// Prototype-web's Registration look (Gen A): icon labels with a red required
// star, 56dp bordered fields, one error card, the gradient Continue button.
// The prototype's Owner-name field is deliberately NOT here: the spec is shop
// name + phone, and adding a person's name is a schema change of its own.
//
// The phone arrives canonical (+880…) from PhoneField, and is canonicalized
// once more on submit (authPhoneForSubmit), so the number that is validated,
// sent to the OTP provider and stored is one string whatever produced it.

export interface RegistrationFormProps {
  onSubmit: (input: RegisterInput) => void;
  isSubmitting?: boolean;
}

export function RegistrationForm({ onSubmit, isSubmitting = false }: RegistrationFormProps) {
  const { t } = useI18n();
  const font = useCopyFont();
  const [isShopFocused, setIsShopFocused] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { shopName: '', phone: '' },
  });

  // The prototype shows ONE message at a time, in a card above the button.
  const firstError = localizeValidationMessage(errors.shopName?.message ?? errors.phone?.message, t);

  return (
    <View className="gap-5">
      <View className="gap-2">
        <View className="flex-row items-center gap-2">
          <MaterialCommunityIcons name="store-outline" size={16} color={colors.brandGreen} />
          <Text className={`${font('medium')} text-sm text-auth-label`}>{t('registerShopNameLabel')}</Text>
          <Text className="font-sans text-sm text-error">*</Text>
        </View>
        <Controller
          control={control}
          name="shopName"
          render={({ field: { value, onChange, onBlur } }) => (
            <TextInput
              value={value}
              onChangeText={onChange}
              onFocus={() => setIsShopFocused(true)}
              onBlur={() => {
                setIsShopFocused(false);
                onBlur();
              }}
              placeholder={t('registerShopNamePlaceholder')}
              placeholderTextColor={colors.authPlaceholder}
              accessibilityLabel={t('registerShopNameLabel')}
              autoCapitalize="words"
              returnKeyType="next"
              className={`${font()} h-14 rounded-xl border-2 px-4 text-base text-richBlack ${
                errors.shopName
                  ? 'border-error bg-white'
                  : isShopFocused
                    ? 'border-brand-green bg-white'
                    : 'border-auth-fieldBorder bg-white/80'
              }`}
            />
          )}
        />
      </View>

      <Controller
        control={control}
        name="phone"
        render={({ field: { value, onChange } }) => (
          <PhoneField variant="brand" required value={value} onChangeText={onChange} />
        )}
      />

      {firstError ? <AuthNotice tone="brandError" message={firstError} /> : null}

      <AuthButton
        variant="gradient"
        label={t('registerContinue')}
        trailingIcon="arrow-right"
        loading={isSubmitting}
        onPress={handleSubmit((values) => onSubmit({ ...values, phone: authPhoneForSubmit(values.phone) }))}
      />
    </View>
  );
}
