import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { deviceLoginSchema } from '@muthoy/validation';

import { AuthButton } from '../auth/AuthButton';
import { AuthIconTile } from '../auth/AuthIconTile';
import { AuthNotice } from '../auth/AuthNotice';
import { AuthShell } from '../auth/AuthShell';
import { AuthTitleBlock } from '../auth/AuthTitleBlock';
import { deviceLoginErrorKey } from '../auth/authMessages';
import { PhoneField } from '../auth/PhoneField';
import { authPhoneForSubmit } from '../auth/phoneInput';
import { AUTH_CHIP_LABELS, SecureChip } from '../auth/SecureChip';
import { PinPad, usePinEntry } from '../ui/PinPad';
import { LanguageToggle } from '../ui/LanguageToggle';
import type { CatalogKey } from '../../i18n/catalog';
import { localizeValidationMessage } from '../../i18n/display';
import { useI18n } from '../../state/localeStore';
import { recoverDatabaseFromServer } from '../../sync/databaseRecovery';
import { DeviceLoginError } from '../../sync/deviceAuth';

// components/database/DatabaseRecoveryScreen.tsx — H-3's locked-database
// screen, shown by app/_layout.tsx BEFORE any router or SQLite exists.
//
// Restyled to the auth system, and one real fix: the PIN is entered on the
// secure PIN pad, never typed into a text field (where a keyboard's suggestion
// strip or a screen reader could echo it). The restore itself is unchanged —
// recoverDatabaseFromServer proves phone + PIN with the server before any key
// is rotated, and the locked database is preserved if anything fails.
//
// Deliberately free of router and SQLite dependencies: neither is available
// when this renders.

interface Props {
  canRestore: boolean;
  onRetry(): void;
  onRestored(): void;
}

type Problem = { kind: 'catalog'; key: CatalogKey } | { kind: 'validation'; message: string };

export function DatabaseRecoveryScreen({ canRestore, onRetry, onRestored }: Props) {
  const { t } = useI18n();
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'phone' | 'pin'>('phone');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const problemMessage =
    problem?.kind === 'validation'
      ? localizeValidationMessage(problem.message, t) ?? t('dbRestoreFailed')
      : problem
        ? t(problem.key)
        : null;

  const handlePhoneNext = () => {
    const parsed = deviceLoginSchema.shape.phone.safeParse(authPhoneForSubmit(phone));
    if (!parsed.success) {
      setProblem({ kind: 'validation', message: parsed.error.issues[0]?.message ?? '' });
      return;
    }
    setProblem(null);
    setStep('pin');
  };

  const handlePin = useCallback(
    async (pin: string) => {
      const parsed = deviceLoginSchema.safeParse({ phone: authPhoneForSubmit(phone), pin });
      if (!parsed.success) {
        setProblem({ kind: 'validation', message: parsed.error.issues[0]?.message ?? '' });
        return;
      }
      setProblem(null);
      setIsRestoring(true);
      try {
        await recoverDatabaseFromServer(parsed.data.phone, parsed.data.pin);
        onRestored();
      } catch (cause) {
        setProblem({
          kind: 'catalog',
          key: cause instanceof DeviceLoginError ? deviceLoginErrorKey(cause.code) : 'dbRestoreFailed',
        });
      } finally {
        setIsRestoring(false);
      }
    },
    [onRestored, phone],
  );

  // The same buffered entry every PIN screen uses; it clears its own digits
  // once the attempt settles, so no PIN outlives the submission in state.
  const entry = usePinEntry(handlePin);

  const notice = isRestoring ? (
    <AuthNotice tone="progress" message={t('dbRestoring')} />
  ) : problemMessage ? (
    <AuthNotice tone="error" message={problemMessage} />
  ) : null;

  const retryStorage = (
    <AuthButton variant="secureLink" label={t('dbRetryStorage')} disabled={isRestoring} onPress={onRetry} />
  );

  return (
    <AuthShell
      variant="secure"
      cornerEnd={<LanguageToggle tone="auth" />}
      footer={
        canRestore && step === 'pin' ? (
          <View className="w-full">
            <PinPad
              variant="secure"
              value={entry.pin}
              onDigitPress={entry.handleDigitPress}
              onBackspace={entry.handleBackspace}
              error={problem !== null}
              disabled={entry.isSubmitting || isRestoring}
            />
            <View className="mt-2.5 items-center">
              <AuthButton
                variant="link"
                label={t('authChangeNumber')}
                disabled={isRestoring}
                onPress={() => {
                  setProblem(null);
                  setStep('phone');
                }}
              />
              {retryStorage}
            </View>
          </View>
        ) : (
          <View className="w-full items-center">{retryStorage}</View>
        )
      }
    >
      <View className="mt-10 items-center">
        <SecureChip label={AUTH_CHIP_LABELS.secure} />
        <AuthIconTile icon="database-lock-outline" />
        <AuthTitleBlock
          title={t(canRestore ? 'dbLockedTitle' : 'dbUnavailableTitle')}
          body={t(canRestore ? (step === 'pin' ? 'dbRecoveryPinBody' : 'dbLockedBody') : 'dbUnavailableBody')}
        />
      </View>

      {canRestore && step === 'phone' ? (
        <View className="mt-4 gap-3">
          <PhoneField variant="secure" value={phone} onChangeText={setPhone} onSubmitEditing={handlePhoneNext} />
          {notice}
          <AuthButton variant="secure" label={t('dbRestoreAction')} onPress={handlePhoneNext} />
        </View>
      ) : (
        <View className="mt-3 min-h-[26px] w-full">{notice}</View>
      )}
    </AuthShell>
  );
}
