import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { createStaffSchema } from '@muthoy/validation';
import { PinPad, useConfirmedPinEntry } from '../../components/ui/PinPad';
import { createStaff, deactivateStaff, listStaff, resetStaffPin, type StaffMember } from '../../db/staff';
import { useSessionStore } from '../../state/sessionStore';

type Mode = 'list' | 'add' | 'reset';

// Staff Management — Volume 0 Day 11. Owner-only.
export default function StaffManagementScreen() {
  const session = useSessionStore((s) => s.session);
  const [mode, setMode] = useState<Mode>('list');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);

  const reloadStaff = useCallback(async () => {
    if (!session) {
      return;
    }
    setStaff(await listStaff(session.shopId));
  }, [session]);

  useEffect(() => {
    // Load-once-on-mount from SQLite. Volume 4 STATE MANAGEMENT: TanStack
    // Query is for the sync layer's mutations only, never used to fetch
    // what a screen displays — so there's no fetching-library hook to
    // delegate this to; a plain effect is the correct tool here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadStaff();
  }, [reloadStaff]);

  // Volume 0 Day 11 checklist: "A Staff-role login cannot access owner-only
  // screens." This screen is exactly that.
  if (!session || session.role !== 'owner') {
    return (
      <View className="flex-1 items-center justify-center bg-brand-softGreen p-6">
        <Text className="font-sans text-base text-richBlack">Owner access only.</Text>
      </View>
    );
  }

  const handleDeactivate = (staffId: string) => {
    Alert.alert('Deactivate staff', 'This staff member will no longer be able to log in.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Deactivate',
        style: 'destructive',
        onPress: async () => {
          await deactivateStaff(staffId, session.userId);
          await reloadStaff();
        },
      },
    ]);
  };

  return (
    <View className="flex-1 gap-4 bg-brand-softGreen p-6">
      <Text className="font-sans-bold text-xl text-richBlack">Staff</Text>

      {mode === 'list' ? (
        <>
          {staff.map((member) => (
            <View key={member.id} className="flex-row items-center justify-between rounded-lg bg-white p-4">
              <View>
                <Text className="font-sans-medium text-base text-richBlack">{member.name}</Text>
                <Text className="font-sans text-xs text-midGray">{member.isActive ? 'Active' : 'Deactivated'}</Text>
              </View>
              {member.isActive ? (
                <View className="flex-row gap-4">
                  <Pressable
                    onPress={() => {
                      setResetTargetId(member.id);
                      setMode('reset');
                    }}
                  >
                    <Text className="font-sans-medium text-sm text-brand-green">Reset PIN</Text>
                  </Pressable>
                  <Pressable onPress={() => handleDeactivate(member.id)}>
                    <Text className="font-sans-medium text-sm text-error">Deactivate</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}
          <Pressable
            onPress={() => setMode('add')}
            className="items-center rounded-lg bg-brand-green py-3.5 active:opacity-80"
          >
            <Text className="font-sans-semibold text-base text-white">Add staff</Text>
          </Pressable>
        </>
      ) : null}

      {mode === 'add' ? (
        <AddStaffFlow
          shopId={session.shopId}
          onDone={async () => {
            setMode('list');
            await reloadStaff();
          }}
          onCancel={() => setMode('list')}
        />
      ) : null}

      {mode === 'reset' && resetTargetId ? (
        <ResetStaffPinFlow
          staffId={resetTargetId}
          performedByUserId={session.userId}
          onDone={async () => {
            setMode('list');
            setResetTargetId(null);
            await reloadStaff();
          }}
          onCancel={() => {
            setMode('list');
            setResetTargetId(null);
          }}
        />
      ) : null}
    </View>
  );
}

// Local sub-flows, not exported — screen-specific, not reused elsewhere, so
// kept in this file rather than a new components/forms/ file.

interface AddStaffFlowProps {
  shopId: string;
  onDone: () => void;
  onCancel: () => void;
}

function AddStaffFlow({ shopId, onDone, onCancel }: AddStaffFlowProps) {
  const [step, setStep] = useState<'name' | 'pin'>('name');
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  const handleNameNext = () => {
    const result = createStaffSchema.shape.name.safeParse(name);
    if (!result.success) {
      setNameError(result.error.issues[0]?.message ?? 'Invalid name');
      return;
    }
    setNameError(null);
    setStep('pin');
  };

  const handleConfirmed = useCallback(
    async (pin: string) => {
      const result = createStaffSchema.safeParse({ name, pin, confirmPin: pin });
      if (!result.success) {
        setPinError(result.error.issues[0]?.message ?? 'Invalid PIN');
        return;
      }
      try {
        // CLAUDE.md rule 8: the raw PIN is only ever passed to createStaff,
        // which bcrypt-hashes it before it reaches SQLite.
        await createStaff(shopId, result.data.name, result.data.pin);
        onDone();
      } catch {
        Alert.alert('Something went wrong', 'Please try again.');
      }
    },
    [shopId, name, onDone],
  );

  const { pin, step: pinStep, handleDigitPress, handleBackspace } = useConfirmedPinEntry(handleConfirmed, () =>
    setPinError('PINs did not match — start over'),
  );

  if (step === 'name') {
    return (
      <View className="gap-4 rounded-lg bg-white p-4">
        <Text className="font-sans-medium text-sm text-richBlack">Staff name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Arif"
          className="rounded-lg border border-midGray px-4 py-3 font-sans text-base text-richBlack"
        />
        {nameError ? <Text className="font-sans text-sm text-error">{nameError}</Text> : null}
        <View className="flex-row gap-4">
          <Pressable onPress={onCancel} className="flex-1 items-center rounded-lg border border-midGray py-3">
            <Text className="font-sans-medium text-base text-richBlack">Cancel</Text>
          </Pressable>
          <Pressable onPress={handleNameNext} className="flex-1 items-center rounded-lg bg-brand-green py-3">
            <Text className="font-sans-semibold text-base text-white">Next</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="items-center gap-6 rounded-lg bg-white p-4">
      <Text className="font-sans-medium text-base text-richBlack">
        {pinStep === 'enter' ? `Set a PIN for ${name}` : 'Confirm PIN'}
      </Text>
      {pinError ? <Text className="font-sans text-sm text-error">{pinError}</Text> : null}
      <PinPad value={pin} onDigitPress={handleDigitPress} onBackspace={handleBackspace} error={Boolean(pinError)} />
    </View>
  );
}

interface ResetStaffPinFlowProps {
  staffId: string;
  performedByUserId: string;
  onDone: () => void;
  onCancel: () => void;
}

function ResetStaffPinFlow({ staffId, performedByUserId, onDone, onCancel }: ResetStaffPinFlowProps) {
  const [error, setError] = useState<string | null>(null);

  const handleConfirmed = useCallback(
    async (pin: string) => {
      try {
        // CLAUDE.md rule 8: the raw PIN is only ever passed to
        // resetStaffPin, which bcrypt-hashes it before it reaches SQLite,
        // and writes an audit_logs entry containing no PIN value.
        await resetStaffPin(staffId, pin, performedByUserId);
        onDone();
      } catch {
        Alert.alert('Something went wrong', 'Please try again.');
      }
    },
    [staffId, performedByUserId, onDone],
  );

  const { pin, step, handleDigitPress, handleBackspace } = useConfirmedPinEntry(handleConfirmed, () =>
    setError('PINs did not match — start over'),
  );

  return (
    <View className="items-center gap-6 rounded-lg bg-white p-4">
      <Text className="font-sans-medium text-base text-richBlack">{step === 'enter' ? 'New PIN' : 'Confirm new PIN'}</Text>
      {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
      <PinPad value={pin} onDigitPress={handleDigitPress} onBackspace={handleBackspace} error={Boolean(error)} />
      <Pressable onPress={onCancel}>
        <Text className="font-sans-medium text-sm text-midGray">Cancel</Text>
      </Pressable>
    </View>
  );
}
