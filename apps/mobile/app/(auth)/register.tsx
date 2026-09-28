import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import type { RegisterInput } from '@muthoy/validation';
import { AuthBrandBlock, CloudReadyChip } from '../../components/auth/AuthBrandBlock';
import { AuthButton } from '../../components/auth/AuthButton';
import { AuthNotice } from '../../components/auth/AuthNotice';
import { AuthShell } from '../../components/auth/AuthShell';
import { AuthTitleBlock } from '../../components/auth/AuthTitleBlock';
import { RegistrationForm } from '../../components/forms/RegistrationForm';
import { LanguageToggle } from '../../components/ui/LanguageToggle';
// Resolves to an inert stub in every non-dev bundle (metro.config.js), so this
// screen needs no __DEV__ conditional of its own and a release build contains
// no harness code at all. Removed with the harness by H-5.
import { DevRegistrationHarness } from '../../dev/devRegistrationHarness';
import { useI18n } from '../../state/localeStore';
import { sendOtp } from '../../sync/otp';

// Registration — Volume 4 AUTHENTICATION, Volume 0 Day 4. No StandardHeader
// on this screen (Volume 4 NAVIGATION: header applies to every screen except
// MorningDashboard and Registration); the language toggle and the prototype's
// cloud-ready pill (translated copy, authCloudReady) sit in the corners instead.
//
// Deliberately NOT ported from the prototype: its "an account already exists
// for this number" check before any OTP. That is an account-existence oracle
// for anyone who can type a phone number. Production proves the number first
// and restores the existing shop on the far side of the OTP (otp-verify.tsx).
export default function RegisterScreen() {
  const { t } = useI18n();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);

  const handleSubmit = useCallback(async (input: RegisterInput) => {
    setIsSubmitting(true);
    setSendFailed(false);
    try {
      await sendOtp(input.phone);
      router.push({
        pathname: '/otp-verify',
        params: { phone: input.phone, shopName: input.shopName },
      });
    } catch {
      setSendFailed(true);
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return (
    <AuthShell
      variant="brand"
      cornerStart={<LanguageToggle tone="auth" />}
      cornerEnd={<CloudReadyChip />}
      // The DEV-only harness keeps its own slot at the foot of the page, so the
      // production layout never depends on it being there.
      footer={<DevRegistrationHarness />}
    >
      <AuthBrandBlock variant="full" />
      <View className="mt-12 gap-6">
        <AuthTitleBlock tone="brand" title={t('registerTitle')} body={t('registerSubtitle')} />
        <RegistrationForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
        {sendFailed ? <AuthNotice tone="brandError" message={t('otpSendFailed')} /> : null}
        <View className="pt-4">
          <AuthButton
            variant="link"
            label={t('registerLoginLink')}
            onPress={() => router.push({ pathname: '/device-login', params: { role: 'owner' } })}
          />
        </View>
      </View>
    </AuthShell>
  );
}
