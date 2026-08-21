import { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { RegisterInput } from '@muthoy/validation';
import { RegistrationForm } from '../../components/forms/RegistrationForm';
// ⚠️ TEMPORARY import — remove with the dev auth bypass (see dev/README.md).
import { DevSkipOtpButton } from '../../dev/DevSkipOtpButton';
import { sendOtp } from '../../sync/otp';

// Registration — Volume 4 AUTHENTICATION, Volume 0 Day 4. No StandardHeader
// on this screen (Volume 4 NAVIGATION: header applies to every screen except
// MorningDashboard and Registration).
export default function RegisterScreen() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async (input: RegisterInput) => {
    setIsSubmitting(true);
    try {
      await sendOtp(input.phone);
      router.push({
        pathname: '/otp-verify',
        params: { phone: input.phone, shopName: input.shopName },
      });
    } catch {
      Alert.alert('OTP could not be sent', 'Check your connection and phone number, then try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return (
    <View className="flex-1 justify-center gap-8 bg-brand-softGreen p-6">
      <View className="gap-1">
        <Text className="font-sans-bold text-2xl text-richBlack">Register your shop</Text>
        <Text className="font-sans text-sm text-midGray">Takes less than a minute.</Text>
      </View>
      <RegistrationForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
      {/* ⚠️ TEMPORARY — dev-only auth entry. Delete this line to remove. */}
      {__DEV__ ? <DevSkipOtpButton /> : null}
    </View>
  );
}
