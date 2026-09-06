import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { colors } from '@muthoy/constants';
import { authenticatedHome } from '../navigation/routes';
import { useI18n } from '../state/localeStore';
import { useSessionStore } from '../state/sessionStore';

// +not-found — Expo Router's catch-all for a path no route file matches: a
// stale deep link, an old push notification, or a route an update removed.
// Screen #39 in Volume 12 V3 §4; the prototype's `src/app/screens/NotFound.tsx`
// is the visual reference (404 numeral at 10% brand green over soft green, the
// same two CTAs). Presentation only (DEVELOPMENT_RULES.md).
//
// Recovery is role-aware and is a REPLACE, both deliberately. One hardcoded
// home would aim Staff at the Owner Dashboard, where NavigationBoundary would
// immediately bounce them somewhere else; a push would leave the dead route on
// the stack, so the system Back button would land straight back here.
// `authenticatedHome` is the same role-to-home mapping startup and the guards
// already use — never a second copy of it.
//
// With no session the target is `/`, the root startup gate, and never an
// authenticated route: someone signed out who follows a bad link has to reach
// role-select / PIN login, not a screen their session cannot open. The boundary
// agrees — an unmatched path outside the auth prefixes already redirects a
// sessionless device to `/` on its own; this is what the screen shows for the
// bad paths that do sit under one (`/register-typo` and friends).
export default function NotFoundScreen() {
  const session = useSessionStore((state) => state.session);
  const { t, locale } = useI18n();
  const bangla = locale === 'bn';
  const homeHref = session ? authenticatedHome(session) : '/';
  // Same shape as AccessDenied: offer Back only when there is something to go
  // back to. A cold start straight into a bad deep link has an empty stack, and
  // a Back button that cannot move is worse than no Back button.
  const canGoBack = router.canGoBack();

  return (
    <View className="flex-1 items-center justify-center bg-brand-softGreen px-4 pt-6 pb-20">
      <View className="w-full max-w-md items-center">
        <Text className="mb-8 font-sans-bold text-[120px] leading-[120px] text-brand-green/10">404</Text>
        <Text className={`mb-3 text-center text-2xl text-richBlack ${bangla ? 'font-bangla-bold' : 'font-sans-bold'}`}>
          {t('pageNotFound')}
        </Text>
        <Text className={`mb-8 text-center text-base text-midGray ${bangla ? 'font-bangla' : 'font-sans'}`}>
          {t('pageNotFoundMessage')}
        </Text>
        <View className="w-full gap-3">
          <Pressable
            onPress={() => router.replace(homeHref)}
            accessibilityRole="button"
            accessibilityLabel={t('goToHome')}
            className="h-12 flex-row items-center justify-center gap-2 rounded-xl bg-brand-green shadow-lg active:opacity-80"
          >
            <Feather name="home" size={20} color={colors.white} />
            <Text className={`text-base text-white ${bangla ? 'font-bangla-semibold' : 'font-sans-semibold'}`}>{t('goToHome')}</Text>
          </Pressable>
          {canGoBack ? (
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel={t('goBack')}
              className="h-12 flex-row items-center justify-center gap-2 rounded-xl border border-brand-green active:opacity-80"
            >
              <Feather name="arrow-left" size={20} color={colors.brandGreen} />
              <Text className={`text-base text-brand-green ${bangla ? 'font-bangla-semibold' : 'font-sans-semibold'}`}>{t('goBack')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}
