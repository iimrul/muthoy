import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { getDeviceId } from '../../native/deviceId';
import { useI18n } from '../../state/localeStore';
import { useDeviceAdminAccess } from '../../state/usePermission';
import {
  approveDeviceEnrollment,
  listRegisteredDevices,
  mutateDeviceAccess,
  setDeviceEnforcement,
  type DeviceAccessOperation,
  type DeviceEnrollmentHold,
  type RegisteredDevice,
} from '../../sync/deviceRegistry';

// app/settings/devices.tsx — A2.3's administration surface.
//
// Owner AND Manager, gated on the ROLE rather than owner-only: a Manager is
// usually the person standing in the shop when a handset goes missing, and
// making them wait for the Owner would leave a lost till live in the meantime.
//
// The gate is deliberately NOT the `staff_manage` permission it started as.
// An Owner can grant that to one Staff member, which let somebody past the
// route check only to be refused by this screen and by every server call
// behind it — and made "can edit the rota" imply "can un-revoke a stolen
// phone". useDeviceAdminAccess, DATA_ACCESS_GATES.deviceAdmin and
// a23_assert_device_admin now state one rule in three places.
//
// THE COPY IS LOAD-BEARING. Every row is an app INSTALLATION, not a physical
// phone. Reinstalling or clearing app data produces a new registration, and
// the subtitle says so plainly — because the only thing worse than that
// limitation is a shopkeeper who believes the opposite. Removing an
// installation is real and immediate. The same actor cannot self-register the
// hardware again under a fresh id; another active Owner/Manager installation
// must approve that exact replacement first.

function statusTone(status: string): { bg: string; fg: string } {
  return status === 'revoked'
    ? { bg: 'bg-[#FEE2E2]', fg: 'text-error' }
    : { bg: 'bg-brand-softGreen', fg: 'text-brand-deepGreen' };
}

export default function DevicesScreen() {
  const { t, formatDateTime } = useI18n();
  const { session, isAllowed } = useDeviceAdminAccess();
  const [devices, setDevices] = useState<RegisteredDevice[] | null>(null);
  const [enrollmentHolds, setEnrollmentHolds] = useState<DeviceEnrollmentHold[]>([]);
  const [enforced, setEnforced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const thisInstallation = getDeviceId();
  const shopId = session?.shopId ?? null;

  // Every state write happens after the await: the fetch is what decides
  // whether there is an error, so it is also what should say so. Clearing it
  // up front would flash an empty error state on every refresh.
  const load = useCallback(async () => {
    if (!shopId) return;
    try {
      const registered = await listRegisteredDevices(shopId);
      setDevices(registered.devices);
      setEnrollmentHolds(registered.enrollmentHolds);
      setEnforced(registered.enforced);
      setError(null);
    } catch {
      // The message is deliberately generic and the list is left as it was. A
      // failed read says nothing about who is registered, and replacing the
      // list with an empty one would invite somebody to conclude it is empty.
      setError(t('devicesLoadFailed'));
    }
  }, [shopId, t]);

  useEffect(() => {
    // Same exemption, and the same reason, as app/cash-summary.tsx's reload:
    // this is a read that must happen on mount, and the rule cannot see that
    // every setState inside it is already behind an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const apply = useCallback(
    async (operation: DeviceAccessOperation, deviceId: string, actorUserId?: string) => {
      if (!shopId || busy) return;
      setBusy(true);
      setError(null);
      try {
        await mutateDeviceAccess(shopId, operation, deviceId, { actorUserId });
        await load();
      } catch {
        setError(t('devicesActionFailed'));
      } finally {
        setBusy(false);
      }
    },
    [busy, load, shopId, t],
  );

  // The switch that makes every revocation on this screen actually bite.
  //
  // Off by default and never thrown automatically: enabling it is the moment
  // installations that send no proof stop working, and a shop mid-rollout has
  // exactly those. The server refuses to enable it unless THIS handset is
  // registered and bound, so the tap cannot be what locks the Owner out of the
  // screen holding the switch.
  const toggleEnforcement = useCallback(
    async (next: boolean) => {
      if (!shopId || busy) return;
      setBusy(true);
      setError(null);
      try {
        const applied = await setDeviceEnforcement(shopId, next);
        setEnforced(applied);
        await load();
      } catch {
        setError(t('devicesEnforcementFailed'));
      } finally {
        setBusy(false);
      }
    },
    [busy, load, shopId, t],
  );

  const approveEnrollment = useCallback(
    async (hold: DeviceEnrollmentHold) => {
      if (!shopId || !hold.requestedDevicePublicId || busy) return;
      setBusy(true);
      setError(null);
      try {
        await approveDeviceEnrollment(shopId, hold.actorUserId, hold.requestedDevicePublicId);
        await load();
      } catch {
        setError(t('devicesApprovalFailed'));
      } finally {
        setBusy(false);
      }
    },
    [busy, load, shopId, t],
  );

  const confirm = useCallback(
    (title: string, body: string, run: () => void, confirmLabel?: string) => {
      Alert.alert(title, body, [
        { text: t('cancel'), style: 'cancel' },
        {
          text: confirmLabel ?? t('devicesRevokeBinding'),
          style: 'destructive',
          onPress: run,
        },
      ]);
    },
    [t],
  );

  // One rule, checked here as well as on the route, because the session store
  // is remembered state rather than the source of truth. The server remains
  // the thing that actually enforces it.
  if (!session || !isAllowed) return <AccessDenied />;

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={t('devicesTitle')} onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-3 p-4 pb-28">
        <View className="rounded-2xl border border-[#FCD34D] bg-[#FEF3C7] p-3">
          <Text className="font-sans text-xs text-[#92400E]">{t('devicesSubtitle')}</Text>
        </View>

        <View className="gap-2 rounded-2xl bg-white p-4">
          <Text className="font-sans-bold text-sm">{t('devicesEnforcementTitle')}</Text>
          <Text className="font-sans text-xs text-midGray">
            {enforced ? t('devicesEnforcementOnBody') : t('devicesEnforcementOffBody')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ checked: enforced, disabled: busy }}
            accessibilityLabel={enforced
              ? t('devicesEnforcementDisable')
              : t('devicesEnforcementEnable')}
            disabled={busy}
            onPress={() => {
              if (enforced) {
                void toggleEnforcement(false);
                return;
              }
              confirm(
                t('devicesEnforcementConfirmTitle'),
                t('devicesEnforcementConfirmBody'),
                () => void toggleEnforcement(true),
                t('devicesEnforcementEnable'),
              );
            }}
            className={`flex-row items-center justify-center gap-2 rounded-xl py-3 disabled:opacity-40 ${
              enforced ? 'border-2 border-error' : 'bg-brand-green'
            }`}
          >
            <Feather
              name={enforced ? 'unlock' : 'lock'}
              size={16}
              color={enforced ? '#B91C1C' : '#FFFFFF'}
            />
            <Text
              className={`font-sans-bold text-sm ${enforced ? 'text-error' : 'text-white'}`}
            >
              {enforced ? t('devicesEnforcementDisable') : t('devicesEnforcementEnable')}
            </Text>
          </Pressable>
        </View>

        {error ? (
          <View className="flex-row items-center gap-2 rounded-2xl border border-[#FCA5A5] bg-[#FEE2E2] p-3">
            <Feather name="alert-triangle" size={16} color="#B91C1C" />
            <Text className="flex-1 font-sans text-xs text-error">{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()}>
              <Text className="font-sans-bold text-xs text-error underline">{t('retry')}</Text>
            </Pressable>
          </View>
        ) : null}

        {enrollmentHolds.some((hold) => hold.requestedDevicePublicId) ? (
          <View className="gap-2 rounded-2xl bg-white p-4">
            <Text className="font-sans-bold text-sm">{t('devicesPendingTitle')}</Text>
            <Text className="font-sans text-xs text-midGray">{t('devicesPendingBody')}</Text>
            {enrollmentHolds
              .filter((hold) => hold.requestedDevicePublicId)
              .map((hold) => (
                <View
                  key={hold.actorUserId}
                  className="flex-row items-center gap-3 border-t border-brand-softGreen pt-3"
                >
                  <View className="flex-1">
                    <Text className="font-sans-semibold text-xs">
                      {hold.actorName ?? hold.actorUserId}
                    </Text>
                    <Text className="font-sans text-[10px] text-midGray">
                      {hold.approved ? t('devicesApprovalWaiting') : t('devicesApprovalRequested')}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy || hold.approved}
                    onPress={() => void approveEnrollment(hold)}
                    className="rounded-lg bg-brand-green px-3 py-2 disabled:opacity-40"
                  >
                    <Text className="font-sans-semibold text-xs text-white">
                      {hold.approved ? t('devicesApproved') : t('devicesApprove')}
                    </Text>
                  </Pressable>
                </View>
              ))}
          </View>
        ) : null}

        {devices === null ? (
          <View className="flex-row items-center gap-2 p-4">
            <ActivityIndicator />
            <Text className="font-sans text-sm text-midGray">{t('loadingLabel')}</Text>
          </View>
        ) : devices.length === 0 ? (
          <Text className="p-4 text-center font-sans text-sm text-midGray">
            {t('devicesEmpty')}
          </Text>
        ) : (
          devices.map((device) => {
            const tone = statusTone(device.status);
            const isThisOne = device.devicePublicId === thisInstallation;
            return (
              <View key={device.deviceId} className="gap-3 rounded-2xl bg-white p-4">
                <View className="flex-row items-start gap-3">
                  <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#DBEAFE]">
                    <Feather name="smartphone" size={18} color="#1D4ED8" />
                  </View>
                  <View className="flex-1">
                    <Text className="font-sans-bold text-sm">
                      {device.model || device.label || t('devicesUnnamedInstallation')}
                      {isThisOne ? ` · ${t('devicesThisDevice')}` : ''}
                    </Text>
                    <Text className="font-sans text-xs text-midGray">
                      {`${device.platform ?? ''} ${device.osVersion ?? ''}`.trim()}
                    </Text>
                    <Text className="font-sans text-xs text-midGray">
                      {`${t('devicesEnrolledPrefix')}${formatDateTime(device.enrolledAt)}`}
                    </Text>
                    <Text className="font-sans text-xs text-midGray">
                      {device.lastSeenAt
                        ? `${t('devicesLastSeenPrefix')}${formatDateTime(device.lastSeenAt)}`
                        : t('devicesNeverSeen')}
                    </Text>
                  </View>
                  <View className={`rounded-full px-2 py-1 ${tone.bg}`}>
                    <Text className={`font-sans-semibold text-[10px] ${tone.fg}`}>
                      {t(device.status === 'revoked'
                        ? 'devicesStatusRevoked'
                        : 'devicesStatusActive')}
                    </Text>
                  </View>
                </View>

                {device.bindings.map((binding) => (
                  <View
                    key={binding.actorUserId}
                    className="flex-row items-center gap-2 border-t border-brand-softGreen pt-2"
                  >
                    <View className="flex-1">
                      <Text className="font-sans-semibold text-xs">
                        {binding.actorName ?? binding.actorUserId}
                      </Text>
                      <Text className="font-sans text-[10px] text-midGray">
                        {binding.role ?? ''}
                        {binding.status === 'revoked' ? ` · ${t('devicesStatusRevoked')}` : ''}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={binding.status === 'revoked'
                        ? t('devicesRestoreBinding')
                        : t('devicesRevokeBinding')}
                      disabled={busy
                        || (device.status === 'revoked' && binding.status === 'revoked')}
                      onPress={() => {
                        if (binding.status === 'revoked') {
                          void apply('restore-binding', device.deviceId, binding.actorUserId);
                          return;
                        }
                        confirm(
                          t('devicesRevokeBindingConfirmTitle'),
                          t('devicesRevokeBindingConfirmBody'),
                          () => void apply('revoke-binding', device.deviceId, binding.actorUserId),
                        );
                      }}
                      className="rounded-lg border border-brand-green px-3 py-2 disabled:opacity-40"
                    >
                      <Text className="font-sans-semibold text-xs text-brand-deepGreen">
                        {binding.status === 'revoked'
                          ? t('devicesRestoreBinding')
                          : t('devicesRevokeBinding')}
                      </Text>
                    </Pressable>
                  </View>
                ))}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={device.status === 'revoked'
                    ? t('devicesRestoreDevice')
                    : t('devicesRevokeDevice')}
                  disabled={busy}
                  onPress={() => {
                    if (device.status === 'revoked') {
                      void apply('restore-device', device.deviceId);
                      return;
                    }
                    confirm(
                      t('devicesRevokeConfirmTitle'),
                      t('devicesRevokeConfirmBody'),
                      () => void apply('revoke-device', device.deviceId),
                    );
                  }}
                  className="flex-row items-center justify-center gap-2 rounded-xl border-2 border-error py-3 disabled:opacity-40"
                >
                  <Feather
                    name={device.status === 'revoked' ? 'rotate-ccw' : 'slash'}
                    size={16}
                    color="#B91C1C"
                  />
                  <Text className="font-sans-bold text-sm text-error">
                    {device.status === 'revoked'
                      ? t('devicesRestoreDevice')
                      : t('devicesRevokeDevice')}
                  </Text>
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
