import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { PinPad, usePinEntry, useConfirmedPinEntry } from '../../components/ui/PinPad';
import { changeOwnPin } from '../../db/settings';
import { useSessionStore } from '../../state/sessionStore';
import { triggerSyncNow } from '../../sync';

// Settings — Volume 4 SETTINGS. Mixed scope: shop profile + security
// (change own PIN) are P0; backup-key restore-on-new-phone and the
// plan/billing entry point's DESTINATION screens are P1 (Volume 0's scope
// lock). Only the change-own-PIN section is built here — the rest are still
// TODOs, out of the Days 4-5/11 auth scope.
// TODO(P0 slice): shop profile view/edit (db/settings.ts's
//   getShopProfile/updateShopProfile).
// TODO(P0 slice): language toggle.
// TODO(P1 slice): backup key restore-on-new-phone.
// TODO(P1 slice): plan/billing entry point — components/ui/PlanBadge.tsx,
//   links to app/settings/plans.tsx.
export default function SettingsScreen() {
  const session = useSessionStore((s) => s.session);
  const [isChangingPin, setIsChangingPin] = useState(false);

  if (!session) {
    return null;
  }

  return (
    <View className="flex-1 gap-4 bg-brand-softGreen p-6">
      <Text className="font-sans-bold text-xl text-richBlack">Settings</Text>

      <View className="gap-3 rounded-lg bg-white p-4">
        <Text className="font-sans-medium text-base text-richBlack">Security</Text>
        {isChangingPin ? (
          <ChangeOwnPinFlow shopId={session.shopId} userId={session.userId} onDone={() => setIsChangingPin(false)} onCancel={() => setIsChangingPin(false)} />
        ) : (
          <Pressable onPress={() => setIsChangingPin(true)}>
            <Text className="font-sans-medium text-sm text-brand-green">Change my PIN</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

interface ChangeOwnPinFlowProps {
  shopId: string;
  userId: string;
  onDone: () => void;
  onCancel: () => void;
}

type ChangePinStep = 'current' | 'new';

function ChangeOwnPinFlow({ shopId, userId, onDone, onCancel }: ChangeOwnPinFlowProps) {
  const [step, setStep] = useState<ChangePinStep>('current');
  const [currentPin, setCurrentPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCurrentComplete = useCallback((pin: string) => {
    setCurrentPin(pin);
    setStep('new');
    setError(null);
  }, []);

  const currentEntry = usePinEntry(handleCurrentComplete);

  const handleNewConfirmed = useCallback(
    async (newPin: string) => {
      try {
        // CLAUDE.md rule 8: currentPin/newPin only ever passed to
        // changeOwnPin, which verifies the current hash and bcrypt-hashes
        // the new one — never logged.
        await changeOwnPin(userId, currentPin, newPin);
        void triggerSyncNow(shopId);
        onDone();
      } catch {
        setError('Current PIN is incorrect');
        setStep('current');
        setCurrentPin('');
      }
    },
    [shopId, userId, currentPin, onDone],
  );

  const newEntry = useConfirmedPinEntry(handleNewConfirmed, () => setError('New PINs did not match — start over'));

  const active = step === 'current' ? currentEntry : newEntry;
  const label =
    step === 'current' ? 'Enter your current PIN' : newEntry.step === 'enter' ? 'Enter your new PIN' : 'Confirm your new PIN';

  return (
    <View className="items-center gap-6">
      <Text className="font-sans-medium text-base text-richBlack">{label}</Text>
      {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
      <PinPad value={active.pin} onDigitPress={active.handleDigitPress} onBackspace={active.handleBackspace} error={Boolean(error)} />
      <Pressable onPress={onCancel}>
        <Text className="font-sans-medium text-sm text-midGray">Cancel</Text>
      </Pressable>
    </View>
  );
}
