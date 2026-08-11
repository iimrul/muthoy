import { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { RegisterInput } from '@muthoy/validation';
import { RegistrationForm } from '../../components/forms/RegistrationForm';
import { createShopAndOwner } from '../../db/auth';

// Registration — Volume 4 AUTHENTICATION, Volume 0 Day 4. No StandardHeader
// on this screen (Volume 4 NAVIGATION: header applies to every screen except
// MorningDashboard and Registration).
export default function RegisterScreen() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async (input: RegisterInput) => {
    setIsSubmitting(true);
    try {
      // CLAUDE.md rule 7: createShopAndOwner generates a fresh, unique,
      // non-hardcoded shop id every call — a new owner on this device never
      // inherits a previous owner's shop.
      const { shopId, userId } = await createShopAndOwner(input);
      router.push({ pathname: '/(auth)/pin-setup', params: { shopId, userId } });
    } catch {
      Alert.alert('Registration failed', 'Please check your details and try again.');
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
    </View>
  );
}
