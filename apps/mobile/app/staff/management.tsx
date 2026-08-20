import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { createStaffSchema } from '@muthoy/validation';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { PinPad, useConfirmedPinEntry } from '../../components/ui/PinPad';
import { DuplicatePhoneError } from '../../db/errors';
import {
  createStaff,
  deactivateStaff,
  listStaff,
  resetStaffPin,
  setStaffPermissions,
  type StaffMember,
} from '../../db/staff';
import {
  PERMISSION_KEYS,
  STAFF_DEFAULT_PERMISSIONS,
  resolvePermission,
  type Permission,
  type PermissionOverrides,
} from '../../domain/permissions';
import { captureSessionFor } from '../../state/sessionGuard';
import type { Session } from '../../state/sessionStore';
import { usePermission } from '../../state/usePermission';
import { triggerSyncNow } from '../../sync';

type Mode = 'list' | 'add' | 'reset' | 'permissions';

// Owner-facing labels. Kept beside the screen rather than in
// domain/permissions.ts, which stays framework- and copy-free.
const PERMISSION_LABELS: Record<Permission, string> = {
  sales: 'Make sales',
  inventory_view: 'View stock',
  inventory_write: 'Add and edit stock',
  credit_management: 'Manage customer credit',
  cash_management: 'Cash, expenses and end of day',
  staff_management: 'Manage staff',
  settings_manage: 'Shop settings',
};

/**
 * Keeps only the keys that DIFFER from the staff role default.
 *
 * Absence is what "use the role default" looks like everywhere else in the
 * system, so storing an override that merely agrees with the default would
 * record a decision the owner never made — and freeze it against any future
 * change to what staff get by default.
 */
function toOverrides(checked: Record<Permission, boolean>): PermissionOverrides {
  const overrides: PermissionOverrides = {};
  for (const key of PERMISSION_KEYS) {
    if (checked[key] !== STAFF_DEFAULT_PERMISSIONS.includes(key)) {
      overrides[key] = checked[key];
    }
  }
  return overrides;
}

function fromOverrides(overrides: PermissionOverrides): Record<Permission, boolean> {
  return Object.fromEntries(
    PERMISSION_KEYS.map((key) => [key, resolvePermission('staff', key, overrides)]),
  ) as Record<Permission, boolean>;
}

interface PermissionCheckboxesProps {
  checked: Record<Permission, boolean>;
  onToggle: (key: Permission) => void;
}

function PermissionCheckboxes({ checked, onToggle }: PermissionCheckboxesProps) {
  return (
    <View className="gap-2">
      {PERMISSION_KEYS.map((key) => (
        <Pressable
          key={key}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: checked[key] }}
          accessibilityLabel={PERMISSION_LABELS[key]}
          onPress={() => onToggle(key)}
          className="flex-row items-center gap-3 rounded-lg border border-midGray px-3 py-2.5 active:opacity-80"
        >
          <View
            className={`h-5 w-5 items-center justify-center rounded border ${
              checked[key] ? 'border-brand-green bg-brand-green' : 'border-midGray'
            }`}
          >
            {checked[key] ? <Text className="font-sans-bold text-xs text-white">✓</Text> : null}
          </View>
          <Text className="font-sans text-sm text-richBlack">{PERMISSION_LABELS[key]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// Staff Management — Volume 0 Day 11. Owner-only.
export default function StaffManagementScreen() {
  const { session, isAllowed } = usePermission('staff_management');
  const [mode, setMode] = useState<Mode>('list');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [permissionsTargetId, setPermissionsTargetId] = useState<string | null>(null);

  const reloadStaff = useCallback(async () => {
    // Gated here too, not only at the render below: a denied role must issue
    // no roster read at all, and db/staff.ts's listStaff would reject it
    // anyway.
    if (!session || !isAllowed) {
      return;
    }
    setStaff(await listStaff(session.shopId, session.userId));
  }, [isAllowed, session]);

  useEffect(() => {
    // Load-once-on-mount from SQLite. Volume 4 STATE MANAGEMENT: TanStack
    // Query is for the sync layer's mutations only, never used to fetch
    // what a screen displays — so there's no fetching-library hook to
    // delegate this to; a plain effect is the correct tool here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadStaff();
  }, [reloadStaff]);

  // Volume 0 Day 11 checklist: "A Staff-role login cannot access owner-only
  // screens." This screen is exactly that. The role comparison itself lives in
  // domain/permissions.ts — reaching this route directly renders the denial,
  // and every action below is independently gated in db/staff.ts.
  if (!session || !isAllowed) {
    return <AccessDenied />;
  }

  const handleDeactivate = (staffId: string) => {
    Alert.alert('Deactivate staff', 'This staff member will no longer be able to log in.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Deactivate',
        style: 'destructive',
        onPress: async () => {
          // The widest window in the app: this Alert can sit on screen
          // indefinitely, and the phone can change hands while it does.
          // Captured when Deactivate is actually pressed, not when the Alert
          // was raised, so a confirmation is always attributed to whoever is
          // logged in at that moment.
          const guard = captureSessionFor(session);
          if (!guard) {
            return;
          }
          await deactivateStaff(staffId, session.userId, guard.isStillActive);
          void triggerSyncNow(session.shopId);
          await guard.ifLiveAsync(reloadStaff);
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
            <View key={member.id} className="gap-3 rounded-lg bg-white p-4">
              <View>
                <Text className="font-sans-medium text-base text-richBlack">{member.name}</Text>
                <Text className="font-mono text-xs text-midGray">
                  {/* Staff created before migration 0007 have no number, so
                      they can still work on THIS device but cannot set up one
                      of their own until the owner adds one. */}
                  {member.phone ?? 'No phone — cannot use their own device'}
                </Text>
                <Text className="font-sans text-xs text-midGray">
                  {member.isActive ? 'Active' : 'Deactivated'}
                </Text>
              </View>
              {member.isActive ? (
                <View className="flex-row flex-wrap gap-4">
                  <Pressable
                    onPress={() => {
                      setPermissionsTargetId(member.id);
                      setMode('permissions');
                    }}
                  >
                    <Text className="font-sans-medium text-sm text-brand-green">Permissions</Text>
                  </Pressable>
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
          actorUserId={session.userId}
          session={session}
          onDone={async () => {
            setMode('list');
            await reloadStaff();
          }}
          onCancel={() => setMode('list')}
        />
      ) : null}

      {mode === 'permissions' && permissionsTargetId ? (
        <EditPermissionsFlow
          shopId={session.shopId}
          actorUserId={session.userId}
          staff={staff.find((member) => member.id === permissionsTargetId)!}
          session={session}
          onDone={async () => {
            setMode('list');
            setPermissionsTargetId(null);
            await reloadStaff();
          }}
          onCancel={() => {
            setMode('list');
            setPermissionsTargetId(null);
          }}
        />
      ) : null}

      {mode === 'reset' && resetTargetId ? (
        <ResetStaffPinFlow
          shopId={session.shopId}
          staffId={resetTargetId}
          performedByUserId={session.userId}
          session={session}
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
  actorUserId: string;
  /** Pinned per action, so a PIN typed across a handover cannot commit. */
  session: Session;
  onDone: () => void;
  onCancel: () => void;
}

function AddStaffFlow({ shopId, actorUserId, session, onDone, onCancel }: AddStaffFlowProps) {
  const [step, setStep] = useState<'details' | 'permissions' | 'pin'>('details');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<Permission, boolean>>(() => fromOverrides({}));

  const handleDetailsNext = () => {
    const nameResult = createStaffSchema.shape.name.safeParse(name);
    if (!nameResult.success) {
      setDetailsError(nameResult.error.issues[0]?.message ?? 'Invalid name');
      return;
    }
    const phoneResult = createStaffSchema.shape.phone.safeParse(phone);
    if (!phoneResult.success) {
      setDetailsError(phoneResult.error.issues[0]?.message ?? 'Invalid phone number');
      return;
    }
    setDetailsError(null);
    setStep('permissions');
  };

  const handleConfirmed = useCallback(
    async (pin: string) => {
      const result = createStaffSchema.safeParse({ name, phone, pin, confirmPin: pin });
      if (!result.success) {
        setPinError(result.error.issues[0]?.message ?? 'Invalid PIN');
        return;
      }
      // A name, a phone number, a permission list and two PINs is a long time
      // on screen, and bcrypt adds more — one of the widest handover windows in
      // the app.
      const guard = captureSessionFor(session);
      if (!guard) {
        return;
      }
      try {
        // CLAUDE.md rule 8: the raw PIN is only ever passed to createStaff,
        // which bcrypt-hashes it before it reaches SQLite.
        await createStaff(
          shopId,
          actorUserId,
          {
            name: result.data.name,
            phone: result.data.phone,
            rawPin: result.data.pin,
            permissions: toOverrides(checked),
          },
          guard.isStillActive,
        );
        void triggerSyncNow(shopId);
        guard.ifLive(onDone);
      } catch (cause) {
        guard.ifLive(() => {
          if (cause instanceof DuplicatePhoneError) {
            // Inline on the field that caused it, not an Alert: the owner has
            // to change one value, and the flow should not be torn down for it.
            setDetailsError(cause.message);
            setStep('details');
            setPinError(null);
            return;
          }
          Alert.alert('Something went wrong', 'Please try again.');
        });
      }
    },
    [shopId, actorUserId, session, name, phone, checked, onDone],
  );

  const { pin, step: pinStep, handleDigitPress, handleBackspace } = useConfirmedPinEntry(handleConfirmed, () =>
    setPinError('PINs did not match — start over'),
  );

  if (step === 'details') {
    return (
      <View className="gap-4 rounded-lg bg-white p-4">
        <Text className="font-sans-medium text-sm text-richBlack">Staff name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Arif"
          accessibilityLabel="Staff name"
          className="rounded-lg border border-midGray px-4 py-3 font-sans text-base text-richBlack"
        />
        <Text className="font-sans-medium text-sm text-richBlack">Phone number</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="01712345678"
          keyboardType="phone-pad"
          accessibilityLabel="Staff phone number"
          className="rounded-lg border border-midGray px-4 py-3 font-sans text-base text-richBlack"
        />
        <Text className="font-sans text-xs text-midGray">
          They will use this number and their PIN to sign in on their own phone.
        </Text>
        {detailsError ? <Text className="font-sans text-sm text-error">{detailsError}</Text> : null}
        <View className="flex-row gap-4">
          <Pressable onPress={onCancel} className="flex-1 items-center rounded-lg border border-midGray py-3">
            <Text className="font-sans-medium text-base text-richBlack">Cancel</Text>
          </Pressable>
          <Pressable onPress={handleDetailsNext} className="flex-1 items-center rounded-lg bg-brand-green py-3">
            <Text className="font-sans-semibold text-base text-white">Next</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (step === 'permissions') {
    return (
      <View className="gap-4 rounded-lg bg-white p-4">
        <Text className="font-sans-medium text-base text-richBlack">What can {name} do?</Text>
        <PermissionCheckboxes
          checked={checked}
          onToggle={(key) => setChecked((current) => ({ ...current, [key]: !current[key] }))}
        />
        <View className="flex-row gap-4">
          <Pressable
            onPress={() => setStep('details')}
            className="flex-1 items-center rounded-lg border border-midGray py-3"
          >
            <Text className="font-sans-medium text-base text-richBlack">Back</Text>
          </Pressable>
          <Pressable onPress={() => setStep('pin')} className="flex-1 items-center rounded-lg bg-brand-green py-3">
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

interface EditPermissionsFlowProps {
  shopId: string;
  actorUserId: string;
  staff: StaffMember;
  /** Pinned per action, so a change made across a handover cannot commit. */
  session: Session;
  onDone: () => void;
  onCancel: () => void;
}

function EditPermissionsFlow({
  shopId,
  actorUserId,
  staff,
  session,
  onDone,
  onCancel,
}: EditPermissionsFlowProps) {
  const [checked, setChecked] = useState<Record<Permission, boolean>>(() =>
    fromOverrides(staff.permissions),
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    const guard = captureSessionFor(session);
    if (!guard) {
      return;
    }
    setIsSaving(true);
    try {
      await setStaffPermissions(shopId, actorUserId, staff.id, toOverrides(checked), guard.isStillActive);
      void triggerSyncNow(shopId);
      guard.ifLive(onDone);
    } catch {
      guard.ifLive(() => Alert.alert('Something went wrong', 'Please try again.'));
    } finally {
      guard.ifLive(() => setIsSaving(false));
    }
  }, [shopId, actorUserId, staff.id, session, checked, onDone]);

  return (
    <View className="gap-4 rounded-lg bg-white p-4">
      <Text className="font-sans-medium text-base text-richBlack">What can {staff.name} do?</Text>
      <PermissionCheckboxes
        checked={checked}
        onToggle={(key) => setChecked((current) => ({ ...current, [key]: !current[key] }))}
      />
      <Text className="font-sans text-xs text-midGray">
        Changes apply on their device the next time it connects.
      </Text>
      <View className="flex-row gap-4">
        <Pressable onPress={onCancel} className="flex-1 items-center rounded-lg border border-midGray py-3">
          <Text className="font-sans-medium text-base text-richBlack">Cancel</Text>
        </Pressable>
        <Pressable
          disabled={isSaving}
          onPress={() => void handleSave()}
          className="flex-1 items-center rounded-lg bg-brand-green py-3 active:opacity-80"
        >
          <Text className="font-sans-semibold text-base text-white">{isSaving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface ResetStaffPinFlowProps {
  shopId: string;
  staffId: string;
  performedByUserId: string;
  /** Pinned per action, so a PIN typed across a handover cannot commit. */
  session: Session;
  onDone: () => void;
  onCancel: () => void;
}

function ResetStaffPinFlow({ shopId, staffId, performedByUserId, session, onDone, onCancel }: ResetStaffPinFlowProps) {
  const [error, setError] = useState<string | null>(null);

  const handleConfirmed = useCallback(
    async (pin: string) => {
      // Resetting someone else's PIN across a handover would lock them out on
      // the say-so of a user who is no longer logged in.
      const guard = captureSessionFor(session);
      if (!guard) {
        return;
      }
      try {
        // CLAUDE.md rule 8: the raw PIN is only ever passed to
        // resetStaffPin, which bcrypt-hashes it before it reaches SQLite,
        // and writes an audit_logs entry containing no PIN value.
        await resetStaffPin(staffId, pin, performedByUserId, guard.isStillActive);
        void triggerSyncNow(shopId);
        guard.ifLive(onDone);
      } catch {
        guard.ifLive(() => Alert.alert('Something went wrong', 'Please try again.'));
      }
    },
    [shopId, staffId, performedByUserId, session, onDone],
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
