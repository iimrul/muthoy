import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { otpCodeSchema, recoverPinSchema } from '@muthoy/validation';
import { AuthButton } from '../../components/auth/AuthButton';
import { AuthFooterNote } from '../../components/auth/AuthFooterNote';
import { AuthIconTile } from '../../components/auth/AuthIconTile';
import { AuthNotice } from '../../components/auth/AuthNotice';
import { AuthShell } from '../../components/auth/AuthShell';
import { AuthTitleBlock } from '../../components/auth/AuthTitleBlock';
import { deviceLoginErrorKey } from '../../components/auth/authMessages';
import { PhoneField } from '../../components/auth/PhoneField';
import { authPhoneForSubmit, formatPhoneForDisplay, phoneFieldValueFrom } from '../../components/auth/phoneInput';
import { AUTH_CHIP_LABELS, SecureChip } from '../../components/auth/SecureChip';
import { latinFont, useCopyFont } from '../../components/auth/typography';
import { OtpInput } from '../../components/ui/OtpInput';
import { PinPad, useConfirmedPinEntry } from '../../components/ui/PinPad';
import { StandardHeader } from '../../components/ui/StandardHeader';
import type { CatalogKey } from '../../i18n/catalog';
import { localizeValidationMessage } from '../../i18n/display';
import { useI18n } from '../../state/localeStore';
import { DeviceLoginError, recoverOwnerPin } from '../../sync/deviceAuth';
import { resendOtp, sendOtp, verifyOtp } from '../../sync/otp';

// Forgot PIN — OWNER ONLY, and the one place OTP survives after first-time
// registration.
//
// Normal login is phone + PIN with no SMS. This flow is for the case that
// cannot be: the PIN itself is gone, so the phone number has to be re-proved
// some other way before a new one can be set.
//
// Staff never reach this screen. Volume 4 gives them no phone number of their
// own to receive a code at, and self-service reset would make anyone able to
// intercept one SMS able to take over a till — their PIN is reset by the owner
// (db/staff.ts's resetStaffPin).
//
// Restyled to the auth system (Gen B): progress is shown inline instead of
// replacing the whole screen, the code step can resend or change the number,
// and a PIN mismatch keeps the first PIN. The server rules are untouched —
// recover-pin still refuses a stale OTP proof, and that refusal now sends the
// owner back for a new code instead of reading as "could not reach the server".
type Step = 'phone' | 'code' | 'pin';

const RESEND_COOLDOWN_SECONDS = 30;

type Problem = { kind: 'catalog'; key: CatalogKey } | { kind: 'validation'; message: string };

export default function ForgotPinScreen() {
  // Prefilled from Device Login when the owner already typed it there. A route
  // param is outside input, so it is canonicalized on the way in.
  const params = useLocalSearchParams<{ phone?: string }>();
  const { t, formatNumber } = useI18n();
  const font = useCopyFont();
  const [phone, setPhone] = useState(() => phoneFieldValueFrom(params.phone));
  const [step, setStep] = useState<Step>('phone');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState<'sending' | 'verifying' | 'saving' | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [shakeKey, setShakeKey] = useState(0);
  const codeInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const problemMessage =
    problem?.kind === 'validation'
      ? localizeValidationMessage(problem.message, t) ?? t('deviceLoginGenericFailure')
      : problem
        ? t(problem.key)
        : null;

  const handleSendCode = async () => {
    const parsed = recoverPinSchema.shape.phone.safeParse(authPhoneForSubmit(phone));
    if (!parsed.success) {
      setProblem({ kind: 'validation', message: parsed.error.issues[0]?.message ?? '' });
      return;
    }
    setBusy('sending');
    setProblem(null);
    try {
      await sendOtp(parsed.data);
      // From here on the code step resends to, verifies against and recovers
      // with exactly the canonical number the code went to.
      setPhone(parsed.data);
      setCode('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setStep('code');
    } catch {
      setProblem({ kind: 'catalog', key: 'otpSendFailed' });
    } finally {
      setBusy(null);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || busy) return;
    setBusy('sending');
    setProblem(null);
    try {
      await resendOtp(authPhoneForSubmit(phone));
      setCode('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      codeInputRef.current?.focus();
    } catch {
      setProblem({ kind: 'catalog', key: 'otpResendFailed' });
    } finally {
      setBusy(null);
    }
  };

  const handleCodeChange = async (next: string) => {
    setCode(next);
    setProblem(null);
    if (next.length !== 6) {
      return;
    }
    const parsed = otpCodeSchema.safeParse(next);
    if (!parsed.success) {
      return;
    }
    setBusy('verifying');
    try {
      // This only proves the phone. The new PIN is set in the next step against
      // the session it produces — recoverPin on the server refuses any token
      // that does not carry a verified phone.
      await verifyOtp(authPhoneForSubmit(phone), parsed.data);
      setStep('pin');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.toLowerCase() : '';
      setProblem({ kind: 'catalog', key: message.includes('expired') ? 'otpExpired' : 'otpIncorrect' });
      setCode('');
      codeInputRef.current?.focus();
    } finally {
      setBusy(null);
    }
  };

  const handleNewPinConfirmed = useCallback(
    async (newPin: string) => {
      const parsed = recoverPinSchema.safeParse({ phone: authPhoneForSubmit(phone), newPin, confirmNewPin: newPin });
      if (!parsed.success) {
        setProblem({ kind: 'validation', message: parsed.error.issues[0]?.message ?? '' });
        return;
      }
      setBusy('saving');
      setProblem(null);
      try {
        // CLAUDE.md rule 8: the raw PIN is handed to recoverOwnerPin and to
        // nothing else. The server bcrypt-hashes it; it is never logged.
        await recoverOwnerPin(parsed.data.phone, parsed.data.newPin);
        router.replace('/');
      } catch (cause) {
        if (cause instanceof DeviceLoginError && cause.code === 'otp_required') {
          // The verified code is too old for the server to accept. A fresh
          // code is the only thing that can pass, so go back and get one.
          setStep('code');
          setCode('');
          setCooldown(0);
          setProblem({ kind: 'catalog', key: 'authErrorOtpRequired' });
          return;
        }
        setProblem({
          kind: 'catalog',
          key: cause instanceof DeviceLoginError ? deviceLoginErrorKey(cause.code) : 'deviceLoginGenericFailure',
        });
      } finally {
        setBusy(null);
      }
    },
    [phone],
  );

  const pinEntry = useConfirmedPinEntry(
    handleNewPinConfirmed,
    () => {
      setProblem({ kind: 'catalog', key: 'pinMismatch' });
      setShakeKey((value) => value + 1);
    },
    { onMismatchStep: 'stay-on-confirm' },
  );
  const resetPinEntry = pinEntry.reset;

  const handleBack = () => {
    setProblem(null);
    if (step === 'code') {
      setStep('phone');
      return;
    }
    if (step === 'pin') {
      resetPinEntry();
      return;
    }
    router.back();
  };

  const busyNotice =
    busy === 'sending' ? t('forgotPinSending') : busy === 'verifying' ? t('otpVerifying') : busy === 'saving' ? t('forgotPinSaving') : null;
  const notice = busyNotice ? (
    <AuthNotice tone="progress" message={busyNotice} />
  ) : problemMessage ? (
    <AuthNotice tone="error" message={problemMessage} />
  ) : null;

  const title =
    step === 'pin'
      ? t(pinEntry.step === 'enter' ? 'forgotPinNewTitle' : 'forgotPinConfirmTitle')
      : t('forgotPinTitle');

  return (
    <AuthShell
      variant="secure"
      header={
        <StandardHeader
          tone="auth"
          safeAreaTop
          title={t('forgotPinHeaderTitle')}
          // From the new-PIN step, Back means "choose again", never "unverify".
          onBackPress={busy || (step === 'pin' && pinEntry.step === 'enter') ? undefined : handleBack}
        />
      }
      footer={
        step === 'pin' ? (
          <View className="w-full">
            <PinPad
              variant="secure"
              value={pinEntry.pin}
              onDigitPress={(digit) => {
                setProblem(null);
                pinEntry.handleDigitPress(digit);
              }}
              onBackspace={pinEntry.handleBackspace}
              error={problem !== null}
              disabled={pinEntry.isSubmitting || busy !== null}
              shakeKey={shakeKey}
              revealLastDigit
            />
            {/* Resetting signs out every other device for this owner — the
                usual reason for a reset is that one of them is lost. */}
            <AuthFooterNote text={t('forgotPinOtherDevices')} />
          </View>
        ) : step === 'code' ? (
          <View className="w-full items-center">
            {cooldown > 0 ? (
              <Text className={`${font()} text-center text-sm text-secure-body`}>
                {t('otpResendIn')}{' '}
                <Text className={`${latinFont('bold')} text-secure-primary`}>
                  {formatNumber(cooldown)}
                  {t('otpSecondsSuffix')}
                </Text>
              </Text>
            ) : (
              <AuthButton
                variant="link"
                leadingIcon="refresh"
                label={t('otpResend')}
                disabled={busy !== null}
                onPress={() => void handleResend()}
              />
            )}
            <AuthButton variant="secureLink" label={t('authChangeNumber')} disabled={busy !== null} onPress={handleBack} />
          </View>
        ) : undefined
      }
    >
      <View className="items-center">
        <SecureChip label={AUTH_CHIP_LABELS.owner} />
        <AuthIconTile icon={step === 'pin' ? 'lock-outline' : 'key-outline'} />
        <AuthTitleBlock
          eyebrow={t('forgotPinEyebrow')}
          title={title}
          body={step === 'phone' ? t('forgotPinPhoneBody') : step === 'code' ? t('otpSentTo') : undefined}
        />
        {step === 'code' ? (
          <Text className={`${latinFont('bold')} mb-4 text-center text-base text-secure-ink`}>
            {formatPhoneForDisplay(phone)}
          </Text>
        ) : null}
      </View>

      {step === 'phone' ? (
        <View className="mt-4 gap-3">
          <PhoneField
            variant="secure"
            value={phone}
            onChangeText={setPhone}
            editable={busy === null}
            onSubmitEditing={() => void handleSendCode()}
          />
          {notice}
          <AuthButton
            variant="secure"
            label={t('forgotPinSendCode')}
            loading={busy === 'sending'}
            onPress={() => void handleSendCode()}
          />
        </View>
      ) : step === 'code' ? (
        <View className="gap-4">
          <OtpInput
            ref={codeInputRef}
            value={code}
            onChangeText={(next) => void handleCodeChange(next)}
            error={problem !== null}
            verifying={busy === 'verifying'}
          />
          {notice}
        </View>
      ) : (
        <View className="min-h-[26px] w-full">{notice}</View>
      )}
    </AuthShell>
  );
}
