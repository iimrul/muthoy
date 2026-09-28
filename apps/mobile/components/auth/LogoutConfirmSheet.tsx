import { Pressable, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '@muthoy/constants';
import { useI18n } from '../../state/localeStore';
import { BaseModal } from '../ui/BaseModal';
import { AuthButton } from './AuthButton';
import { useCopyFont } from './typography';

// components/auth/LogoutConfirmSheet.tsx — the one "log out / switch user"
// confirmation, replacing four native Alerts whose copy disagreed (one of them
// asked "Shift Summary" as its question).
//
// Presentation only: it reports the decision and the caller runs
// state/switchUser.ts. The note says what actually happens in production — the
// phone returns to the PIN pad and the next person types their own PIN — not
// the prototype's per-role login pages, which do not exist here.
//
// Mounted only while open, so a screen that holds it pays nothing for it.

export interface LogoutConfirmSheetProps {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function LogoutConfirmSheet({ visible, onCancel, onConfirm }: LogoutConfirmSheetProps) {
  const { t } = useI18n();
  const font = useCopyFont();
  if (!visible) return null;

  return (
    <BaseModal visible onClose={onCancel} hasEquivalentDismissControl>
      <View className="gap-6">
        <View className="flex-row items-start justify-between gap-3">
          <Text accessibilityRole="header" className={`${font('bold')} flex-1 text-xl text-richBlack`}>
            {t('logoutConfirmTitle')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('closeLabel')}
            onPress={onCancel}
            hitSlop={8}
            className="h-8 w-8 items-center justify-center"
          >
            <MaterialCommunityIcons name="close" size={24} color={colors.midGray} />
          </Pressable>
        </View>
        <View className="gap-4">
          <Text className={`${font()} text-[15px] leading-6 text-midGray`}>{t('logoutConfirmQuestion')}</Text>
          <View className="rounded-lg border border-auth-warningBorder bg-warningBg p-3">
            <Text className={`${font()} text-sm text-auth-warningInk`}>{t('logoutConfirmNote')}</Text>
          </View>
        </View>
        <View className="flex-row gap-3">
          <AuthButton variant="neutral" label={t('cancel')} onPress={onCancel} className="flex-1" />
          <AuthButton variant="danger" label={t('logoutConfirmAction')} onPress={onConfirm} className="flex-1" />
        </View>
      </View>
    </BaseModal>
  );
}
