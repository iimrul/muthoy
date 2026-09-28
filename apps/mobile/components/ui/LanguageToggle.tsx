import { Pressable, Text, View } from 'react-native';
import { useI18n, useLocaleStore } from '../../state/localeStore';

// `tone="auth"` is the prototype's auth-screen toggle (grey pill, green active
// segment). The default look is unchanged for the app headers that already
// use it. Both tones announce themselves as buttons with a selected state and
// get a hit area a finger can land on, which the 18dp-tall pill alone is not.
export function LanguageToggle({ onDark = false, tone = 'default' }: { onDark?: boolean; tone?: 'default' | 'auth' }) {
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);
  const { t } = useI18n();
  const hitSlop = { top: 12, bottom: 12, left: 4, right: 4 };

  if (tone === 'auth') {
    return (
      <View className="flex-row items-center gap-0.5 rounded-full bg-auth-neutralFill p-0.5">
        <Pressable
          onPress={() => setLocale('bn')}
          accessibilityRole="button"
          accessibilityLabel={t('authLanguageBangla')}
          accessibilityState={{ selected: locale === 'bn' }}
          hitSlop={hitSlop}
          className={`rounded-full px-2 py-0.5 ${locale === 'bn' ? 'bg-brand-green' : ''}`}
        >
          <Text className={`font-bangla-semibold text-[10px] ${locale === 'bn' ? 'text-white' : 'text-midGray'}`}>বাং</Text>
        </Pressable>
        <Pressable
          onPress={() => setLocale('en')}
          accessibilityRole="button"
          accessibilityLabel={t('authLanguageEnglish')}
          accessibilityState={{ selected: locale === 'en' }}
          hitSlop={hitSlop}
          className={`rounded-full px-2 py-0.5 ${locale === 'en' ? 'bg-brand-green' : ''}`}
        >
          <Text className={`font-sans-medium text-[10px] ${locale === 'en' ? 'text-white' : 'text-midGray'}`}>ENG</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-row rounded-full bg-white/20 p-0.5">
      <Pressable
        onPress={() => setLocale('bn')}
        accessibilityRole="button"
        accessibilityLabel={t('authLanguageBangla')}
        accessibilityState={{ selected: locale === 'bn' }}
        hitSlop={hitSlop}
        className={`rounded-full px-2 py-1 ${locale === 'bn' ? 'bg-white' : ''}`}
      >
        <Text className={`font-sans-semibold text-xs ${locale === 'bn' ? 'text-brand-green' : onDark ? 'text-white' : 'text-richBlack'}`}>বাং</Text>
      </Pressable>
      <Pressable
        onPress={() => setLocale('en')}
        accessibilityRole="button"
        accessibilityLabel={t('authLanguageEnglish')}
        accessibilityState={{ selected: locale === 'en' }}
        hitSlop={hitSlop}
        className={`rounded-full px-2 py-1 ${locale === 'en' ? 'bg-white' : ''}`}
      >
        <Text className={`font-sans-semibold text-xs ${locale === 'en' ? 'text-brand-green' : onDark ? 'text-white' : 'text-richBlack'}`}>ENG</Text>
      </Pressable>
    </View>
  );
}
