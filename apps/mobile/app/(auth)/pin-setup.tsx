import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { pinSetupSchema } from '@muthoy/validation';
import { AuthButton } from '../../components/auth/AuthButton';
import { AuthFooterNote } from '../../components/auth/AuthFooterNote';
import { AuthIconTile } from '../../components/auth/AuthIconTile';
import { AuthNotice } from '../../components/auth/AuthNotice';
import { AuthShell } from '../../components/auth/AuthShell';
import { AuthTitleBlock } from '../../components/auth/AuthTitleBlock';
import { AUTH_CHIP_LABELS, SecureChip } from '../../components/auth/SecureChip';
import { StepIndicator } from '../../components/auth/StepIndicator';
import {
  PinPad,
  useConfirmedPinEntry,
  type PinCompletionMeta,
} from '../../components/ui/PinPad';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { setOwnerPin, verifyPinForUser } from '../../db/auth';
import { handoffAuthTiming, startAuthTiming } from '../../dev/authTiming';
import { localizeValidationMessage } from '../../i18n/display';
import { useI18n } from '../../state/localeStore';
import { useSessionStore } from '../../state/sessionStore';
import { refreshBillingStatus } from '../../sync/billing';

// PIN Setup — Volume 4 AUTHENTICATION, Volume 0 Day 4. Runs immediately
// after Registration. Asks for the PIN twice (not specced in Volume 4 —
// approved addition, see the Days 4-5/11 auth plan) so a bcrypt-hashed typo
// can't lock the owner out of a fresh registration.
//
// Prototype-web's "Muthoy Secure" PIN Setup (Gen B): step bar, chip, tile,
// eyebrow + title, the secure pad with the ~400 ms digit reveal (creating a
// PIN only — never on a sign-in pad), and a mismatch that keeps the first PIN
// and offers Try Again / Change PIN. No fingerprint toggle, and none of the
// prototype's "your PIN stays on this device" copy: the hash syncs.
type SetupProblem = { kind: 'mismatch' } | { kind: 'failed' } | { kind: 'invalid'; message: string };

export default function PinSetupScreen() {
  const { shopId, userId } = useLocalSearchParams<{ shopId: string; userId: string }>();
  const { t } = useI18n();
  const [problem, setProblem] = useState<SetupProblem | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const login = useSessionStore((s) => s.login);

  const handleConfirmed = useCallback(
    async (pin: string, { completedAt }: PinCompletionMeta) => {
      const timing = startAuthTiming('owner_pin_setup', completedAt);
      timing?.mark('submit_start');
      setProblem(null);
      const result = pinSetupSchema.safeParse({ pin, confirmPin: pin });
      if (!result.success) {
        setProblem({ kind: 'invalid', message: result.error.issues[0]?.message ?? '' });
        timing?.mark('local_input_validation', 'error');
        return;
      }
      timing?.mark('local_input_validation');

      try {
        // CLAUDE.md rule 8: the raw PIN is handed to setOwnerPin exactly
        // once, here, and never logged — setOwnerPin bcrypt-hashes it before
        // it touches SQLite.
        if (timing) {
          await timing.measure('local_bcrypt_hash', () => setOwnerPin(userId, result.data.pin));
        } else {
          await setOwnerPin(userId, result.data.pin);
        }
        // Link completion creates the authoritative principal/membership on the
        // server. Hydrate it before constructing the persisted session: the
        // root authority gate must never guess principal or billing identity
        // from an Owner actor id.
        const setupEpoch = useSessionStore.getState().epoch;
        const ownsSetup = () => {
          const state = useSessionStore.getState();
          return state.epoch === setupEpoch && state.session === null;
        };
        await refreshBillingStatus(shopId, undefined, { isCurrent: ownsSetup });
        const local = await verifyPinForUser(result.data.pin, shopId, userId, timing);
        if (!local || !local.principalUserId || !local.billingAccountId) {
          throw new Error('Owner authority did not hydrate completely.');
        }
        if (!ownsSetup()) throw new Error('The active user changed.');
        login(local);
        handoffAuthTiming(timing);
        router.replace('/dashboard');
      } catch {
        timing?.mark('pin_setup_failed', 'error');
        setProblem({ kind: 'failed' });
      }
    },
    [userId, shopId, login],
  );

  const handleMismatch = useCallback(() => {
    setProblem({ kind: 'mismatch' });
    setShakeKey((value) => value + 1);
  }, []);
  const { pin, step, isSubmitting, handleDigitPress, handleBackspace, reset } = useConfirmedPinEntry(
    handleConfirmed,
    handleMismatch,
    { onMismatchStep: 'stay-on-confirm' },
  );

  const handleChangePin = useCallback(() => {
    setProblem(null);
    reset();
  }, [reset]);

  // Typing again answers the message, as in the prototype.
  const handleDigit = useCallback(
    (digit: string) => {
      setProblem(null);
      handleDigitPress(digit);
    },
    [handleDigitPress],
  );

  const isConfirm = step === 'confirm';
  const isSaving = isConfirm && isSubmitting;
  const problemMessage =
    problem?.kind === 'mismatch'
      ? t('pinMismatch')
      : problem?.kind === 'failed'
        ? t('pinSetupFailed')
        : problem?.kind === 'invalid'
          ? localizeValidationMessage(problem.message, t) ?? t('pinSetupFailed')
          : null;

  return (
    <AuthShell
      variant="secure"
      header={
        <StandardHeader
          tone="auth"
          safeAreaTop
          title={t('setPin')}
          // Back from the confirmation is "choose again"; from the first step
          // there is nothing behind this screen — the phone is verified and
          // the shop is linked.
          onBackPress={isConfirm && !isSaving ? handleChangePin : undefined}
        />
      }
      footer={
        <View className="w-full">
          <PinPad
            variant="secure"
            value={pin}
            onDigitPress={handleDigit}
            onBackspace={handleBackspace}
            error={problem !== null}
            disabled={isSubmitting}
            shakeKey={shakeKey}
            revealLastDigit
          />
          {isConfirm && !isSaving ? (
            <View className="mt-2.5 flex-row items-center justify-center gap-4">
              {problem?.kind === 'mismatch' ? (
                <>
                  <AuthButton variant="link" label={t('pinTryAgain')} onPress={() => setProblem(null)} />
                  <View className="h-3.5 w-px bg-secure-pinEmpty" />
                </>
              ) : null}
              <AuthButton variant="link" label={t('pinChange')} onPress={handleChangePin} />
            </View>
          ) : null}
          <AuthFooterNote text={t('pinSetupFootnote')} />
        </View>
      }
    >
      <StepIndicator current={isConfirm ? 2 : 1} total={3} />
      <View className="items-center">
        <SecureChip label={AUTH_CHIP_LABELS.secure} />
        <AuthIconTile icon={isConfirm ? 'shield-check' : 'lock-outline'} />
        <AuthTitleBlock
          eyebrow={t(isConfirm ? 'pinSetupEyebrowConfirm' : 'pinSetupEyebrowCreate')}
          title={t(isConfirm ? 'pinSetupTitleConfirm' : 'pinSetupTitleCreate')}
          body={t(isConfirm ? 'pinSetupBodyConfirm' : 'pinSetupBodyCreate')}
        />
        <View className="min-h-[26px] w-full">
          {isSaving ? (
            <AuthNotice tone="progress" message={t('pinSetupCreating')} detail={t('authPleaseWait')} />
          ) : problemMessage ? (
            <AuthNotice tone="error" message={problemMessage} />
          ) : null}
        </View>
      </View>
    </AuthShell>
  );
}
