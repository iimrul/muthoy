import { Pressable, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '@muthoy/constants';
import { runtimeDiagnosticError } from '../../dev/runtimeDiagnostics';
import { endShiftForDeviceRelink } from '../../navigation/endShift';
import { useI18n } from '../../state/localeStore';
import { useSessionStore } from '../../state/sessionStore';
import { useDeviceRelinkStore } from '../../state/deviceRelinkStore';
import { useCopyFont } from './typography';

// components/auth/DeviceRelinkBanner.tsx — "sign in again on this phone".
//
// Shown inside the authenticated shell when sync has refused this
// installation's session as unbound (state/deviceRelinkStore.ts). The till
// keeps working offline underneath; the banner only explains why nothing is
// syncing and offers the one fix: an authoritative phone + PIN sign-in on
// Device Login, which binds the installation. A PIN-pad handover cannot, since
// the cloud session would still be the unbound one.
//
// The old actor is torn down FIRST and synchronously (navigation/endShift.ts):
// the signed-out session is written to disk before memory changes, then the
// session and cart are cleared and sync stopped, and only then is the
// requirement dropped, the authenticated stack dismissed and Device Login put
// in its place. All of it happens inside one press, so React commits it as one
// render: the session guard sees a signed-out user already on an auth route,
// and Android Back finds nothing authenticated underneath. A teardown that
// throws has changed nothing — memory and disk still agree on the signed-in
// session — so it navigates nowhere and keeps the banner up to try again.

export function DeviceRelinkBanner() {
  const { t } = useI18n();
  const font = useCopyFont();
  const session = useSessionStore((state) => state.session);
  const required = useDeviceRelinkStore((state) => state.required);

  if (!session || !required || required.shopId !== session.shopId || required.userId !== session.userId) {
    return null;
  }

  const handleRelink = () => {
    try {
      endShiftForDeviceRelink(session.role);
    } catch (cause) {
      runtimeDiagnosticError(cause, { currentRoute: 'device_relink_teardown' });
    }
  };

  return (
    <View
      accessible
      accessibilityRole="alert"
      className="absolute bottom-24 left-3 right-3 flex-row items-center gap-3 rounded-2xl border border-notice-warningBorder bg-notice-warningBg px-3.5 py-2.5"
    >
      <MaterialCommunityIcons name="cellphone-key" size={20} color={colors.noticeWarningInk} />
      <Text className={`${font('medium')} flex-1 text-sm text-notice-warningInk`}>{t('authErrorRelink')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('deviceLoginContinue')}
        onPress={handleRelink}
        hitSlop={8}
        className="rounded-xl bg-secure-primary px-3 py-2 active:opacity-90"
      >
        <Text className={`${font('bold')} text-xs text-white`}>{t('deviceLoginContinue')}</Text>
      </Pressable>
    </View>
  );
}
