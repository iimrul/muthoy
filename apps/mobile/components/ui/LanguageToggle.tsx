import { Pressable, Text, View } from 'react-native';
import { useLocaleStore } from '../../state/localeStore';

export function LanguageToggle() {
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);
  return (
    <View className="flex-row rounded-full bg-white/20 p-0.5">
      <Pressable onPress={() => setLocale('bn')} className={`rounded-full px-2 py-1 ${locale === 'bn' ? 'bg-white' : ''}`}>
        <Text className={`font-sans-semibold text-xs ${locale === 'bn' ? 'text-brand-green' : 'text-richBlack'}`}>বাং</Text>
      </Pressable>
      <Pressable onPress={() => setLocale('en')} className={`rounded-full px-2 py-1 ${locale === 'en' ? 'bg-white' : ''}`}>
        <Text className={`font-sans-semibold text-xs ${locale === 'en' ? 'text-brand-green' : 'text-richBlack'}`}>ENG</Text>
      </Pressable>
    </View>
  );
}
