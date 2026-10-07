import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { deviceLoginSchema } from '@muthoy/validation';
import { AuthBrandBlock } from '../../components/auth/AuthBrandBlock';
import { AuthButton } from '../../components/auth/AuthButton';
import { AuthIconTile } from '../../components/auth/AuthIconTile';
import { AuthNotice } from '../../components/auth/AuthNotice';
import { AuthShell } from '../../components/auth/AuthShell';
import { AuthTitleBlock } from '../../components/auth/AuthTitleBlock';
import { deviceLoginErrorKey } from '../../components/auth/authMessages';
import { PhoneField } from '../../components/auth/PhoneField';
import { authPhoneForSubmit, formatPhoneForDisplay } from '../../components/auth/phoneInput';
import { AUTH_CHIP_LABELS, SecureChip } from '../../components/auth/SecureChip';
import { latinFont, useCopyFont } from '../../components/auth/typography';
import { PinPad, usePinEntry, type PinCompletionMeta } from '../../components/ui/PinPad';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { startAuthTiming } from '../../dev/authTiming';
import type { CatalogKey } from '../../i18n/catalog';
import { localizeValidationMessage } from '../../i18n/display';
import { useI18n } from '../../state/localeStore';
import { DeviceLoginError, loginOnNewDevice } from '../../sync/deviceAuth';

// Device Login — phone + PIN on a device that holds no shop data yet.
//
// The ONLY screen where a phone number is typed to log in. An already-enrolled
// device shows PIN Login instead (app/(auth)/pin-login.tsx), which matches
// against local bcrypt hashes with no network at all; this screen exists purely
// because a fresh device has nothing to match against.
//
// No OTP on this path, for either role — Volume 4 gives staff no phone number
// to receive a code at, and an owner's routine login must not wait on an SMS.
// OTP survives only behind "Forgot PIN" at the bottom.
//
// Visuals: prototype-web's Owner Login (Gen B phone step, then the secure PIN
// pad). NOT taken from it: its "no account for this number" answer before the
// PIN — the server answers every credential problem with one message, and the
// screen keeps it that way (anti-enumeration).
type Failure = { kind: 'catalog'; key: CatalogKey; held: boolean } | { kind: 'validation'; message: string };

export default function DeviceLoginScreen() {
  // Owner and Staff reach the same endpoint with the same credentials; the real
  // role is resolved from the account, never from what was tapped. This is
  // display only, so whoever chose "Staff" sees a screen that agrees with them.
  // `reason=relink` (from PIN Login) likewise only changes what is SAID.
  const { role, reason } = useLocalSearchParams<{ role?: string; reason?: string }>();
  const isOwner = role === 'owner';
  const isRelink = reason === 'relink';
  // H-5. From Forgot PIN, when the server confirmed the PIN changed but could
  // not finish signing the device in automatically — see deviceAuth.ts's
  // `pin_changed_login_required`. The new PIN already works here.
  const isPinRecovered = reason === 'pin-recovered';
  const { t } = useI18n();
  const font = useCopyFont();

  const [phone, setPhone] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [step, setStep] = useState<'phone' | 'pin'>('phone');

  const failureMessage =
    failure?.kind === 'validation'
      ? localizeValidationMessage(failure.message, t) ?? t('deviceLoginGenericFailure')
      : failure
        ? t(failure.key)
        : null;

  const handlePhoneNext = () => {
    const result = deviceLoginSchema.shape.phone.safeParse(authPhoneForSubmit(phone));
    if (!result.success) {
      setFailure({ kind: 'validation', message: result.error.issues[0]?.message ?? '' });
      return;
    }
    setFailure(null);
    setStep('pin');
  };

  const handlePinComplete = useCallback(
    async (pin: string, { completedAt }: PinCompletionMeta) => {
      const timing = startAuthTiming('device_login', completedAt);
      timing?.mark('submit_start');
      const parsed = deviceLoginSchema.safeParse({ phone: authPhoneForSubmit(phone), pin });
      if (!parsed.success) {
        setFailure({ kind: 'validation', message: parsed.error.issues[0]?.message ?? '' });
        timing?.mark('local_input_validation', 'error');
        return;
      }

      setFailure(null);
      try {
        // CLAUDE.md rule 8: the raw PIN goes to loginOnNewDevice and nowhere
        // else — never logged, never written anywhere in plain text.
        timing?.mark('local_input_validation');
        await loginOnNewDevice(parsed.data.phone, parsed.data.pin, timing);
        // Back to the root gate rather than straight to a tab: app/index.tsx
        // re-derives the destination from SQLite, so a freshly hydrated shop
        // routes exactly as it would on any other launch.
        router.replace('/');
      } catch (cause) {
        timing?.mark('device_login_failed', 'error');
        // Translated by code; the one `credentials` message still covers every
        // credential problem, exactly as the server intends.
        if (cause instanceof DeviceLoginError) {
          setFailure({ kind: 'catalog', key: deviceLoginErrorKey(cause.code), held: cause.code === 'enrollment_held' });
        } else {
          setFailure({ kind: 'catalog', key: 'deviceLoginGenericFailure', held: false });
        }
      }
    },
    [phone],
  );

  const { pin, isSubmitting, handleDigitPress, handleBackspace } = usePinEntry(handlePinComplete);

  const handleBack = () => {
    if (step === 'pin') {
      setFailure(null);
      setStep('phone');
      return;
    }
    // The root gate knows where a device with no session belongs: Role Select
    // on an empty one, the PIN pad on an enrolled one.
    router.replace('/');
  };

  const forgotPin = isOwner ? (
    <AuthButton
      variant="link"
      label={t('deviceLoginForgotOwner')}
      disabled={isSubmitting}
      onPress={() => router.push({ pathname: '/forgot-pin', params: { phone } })}
    />
  ) : (
    // Owner only: a staff member who forgets their PIN is reset by their
    // owner, and has no phone number of their own to prove.
    <Text className={`${font()} px-4 text-center text-xs text-secure-body`}>{t('deviceLoginForgotStaff')}</Text>
  );

  const notice = isSubmitting ? (
    <AuthNotice tone="progress" message={t('pinSetupCreating')} detail={t('deviceLoginProgressBody')} />
  ) : failureMessage ? (
    <AuthNotice
      tone={failure?.kind === 'catalog' && failure.held ? 'warning' : 'error'}
      title={failure?.kind === 'catalog' && failure.held ? t('deviceHeldTitle') : undefined}
      message={failureMessage}
    />
  ) : isRelink ? (
    <AuthNotice tone="info" message={t('deviceLoginRelinkNotice')} />
  ) : isPinRecovered ? (
    <AuthNotice tone="info" message={t('authErrorPinChangedLoginRequired')} />
  ) : null;

  return (
    <AuthShell
      variant="secure"
      header={
        <StandardHeader
          tone="auth"
          safeAreaTop
          title={t(isOwner ? 'deviceLoginOwnerTitle' : 'deviceLoginStaffTitle')}
          onBackPress={isSubmitting ? undefined : handleBack}
        />
      }
      footer={
        step === 'pin' ? (
          <View className="w-full">
            <PinPad
              variant="secure"
              value={pin}
              onDigitPress={handleDigitPress}
              onBackspace={handleBackspace}
              error={failure !== null}
              disabled={isSubmitting}
            />
            <View className="mt-2.5 items-center">{forgotPin}</View>
          </View>
        ) : (
          <View className="w-full gap-3 pt-8">
            <AuthButton
              variant="secondary"
              label={t(isOwner ? 'deviceLoginStaffTitle' : 'deviceLoginOwnerTitle')}
              onPress={() =>
                router.replace({ pathname: '/device-login', params: { role: isOwner ? 'staff' : 'owner' } })
              }
            />
            <AuthButton variant="secureLink" label={t('deviceLoginRegisterLink')} onPress={() => router.push('/register')} />
            <View className="items-center">{forgotPin}</View>
          </View>
        )
      }
    >
      <View className="items-center">
        <SecureChip label={isOwner ? AUTH_CHIP_LABELS.owner : AUTH_CHIP_LABELS.staff} />
        <AuthIconTile icon="shield-check" />
        {step === 'phone' ? (
          <>
            <AuthBrandBlock variant="compact" />
            <Text className={`${font()} max-w-[280px] text-center text-[13px] leading-[19px] text-secure-body`}>
              {t(isOwner ? 'deviceLoginOwnerBody' : 'deviceLoginStaffBody')}
            </Text>
          </>
        ) : (
          <>
            <AuthTitleBlock title={t('pinLoginTitle')} body={t('deviceLoginPinBody')} />
            <Text className={`${latinFont('medium')} text-[13px] text-secure-chipText`}>{formatPhoneForDisplay(phone)}</Text>
            <AuthButton
              variant="link"
              label={t('authChangeNumber')}
              disabled={isSubmitting}
              onPress={handleBack}
            />
          </>
        )}
      </View>

      {step === 'phone' ? (
        <View className="mt-6 gap-3">
          <PhoneField variant="secure" value={phone} onChangeText={setPhone} autoFocus onSubmitEditing={handlePhoneNext} />
          {notice}
          <AuthButton variant="secure" label={t('deviceLoginContinue')} onPress={handlePhoneNext} />
        </View>
      ) : (
        <View className="mt-3 min-h-[26px] w-full">{notice}</View>
      )}
    </AuthShell>
  );
}
