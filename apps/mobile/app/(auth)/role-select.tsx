import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { AuthBrandBlock } from '../../components/auth/AuthBrandBlock';
import { AuthIconTile } from '../../components/auth/AuthIconTile';
import { AuthShell } from '../../components/auth/AuthShell';
import { RoleCard } from '../../components/auth/RoleCard';
import { latinFont, useCopyFont } from '../../components/auth/typography';
import { LanguageToggle } from '../../components/ui/LanguageToggle';
import { useI18n } from '../../state/localeStore';

// Role Select — the entry point for a device that holds no shop yet.
//
// Three doors, and the distinction that matters is the FIRST one: registering
// creates a new pharmacy, the other two join one that already exists. Before
// this screen, "no local data" could only mean "register", which silently
// assumed one device per shop forever.
//
// Owner and Staff both lead to the same phone + PIN screen and the same
// endpoint — the role is resolved from the account, never from what was tapped
// here. The split exists because the two arrive with different expectations (an
// owner has a shop phone and a recovery path; a staff member has a number their
// owner issued them and does not), and because a wrong tap should read as a
// wrong door rather than as a broken login.
//
// Visuals: prototype-web's RoleSelect (green hero, frosted tile, slide-up white
// sheet, accent-bar cards), with Muthoy branding instead of its "Portable POS"
// and a third card for registration, which the prototype handled by redirect.
export default function RoleSelectScreen() {
  const { t } = useI18n();
  const font = useCopyFont();

  return (
    <AuthShell
      variant="hero"
      cornerEnd={<LanguageToggle tone="auth" />}
      hero={
        <>
          <AuthIconTile icon="shopping-outline" variant="glass" />
          <AuthBrandBlock variant="hero" />
        </>
      }
    >
      <Text className={`${font('semibold')} mb-4 text-center text-[11px] uppercase tracking-[1px] text-midGray`}>
        {t('roleSelectPrompt')}
      </Text>

      <View className="mb-5 gap-3">
        <RoleCard
          accent="register"
          icon="store-plus-outline"
          title={t('roleRegisterTitle')}
          subtitle={t('roleRegisterSubtitle')}
          accessibilityLabel={t('roleRegisterTitle')}
          onPress={() => router.push('/register')}
        />
        <RoleCard
          accent="owner"
          icon="crown"
          title={t('roleOwnerTitle')}
          subtitle={t('roleOwnerSubtitle')}
          accessibilityLabel={t('roleOwnerA11y')}
          onPress={() => router.push({ pathname: '/device-login', params: { role: 'owner' } })}
        />
        <RoleCard
          accent="staff"
          icon="account-circle-outline"
          title={t('roleStaffTitle')}
          subtitle={t('roleStaffSubtitle')}
          accessibilityLabel={t('roleStaffA11y')}
          onPress={() => router.push({ pathname: '/device-login', params: { role: 'staff' } })}
        />
      </View>

      <Text className={`${latinFont()} mt-4 text-center text-[11px] text-auth-placeholder`}>Muthoy</Text>
    </AuthShell>
  );
}
