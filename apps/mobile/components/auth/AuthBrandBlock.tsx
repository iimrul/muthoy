import { Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useI18n } from '../../state/localeStore';
import { MUTHOY_LOGO_XML } from './muthoyLogoXml';
import { latinFont, useCopyFont } from './typography';

// components/auth/AuthBrandBlock.tsx — the Muthoy wordmark.
//
// "Muthoy (মুঠোয়)" is a brand literal in both languages. Its Bengali half is
// set in Hind Siliguri, because Plus Jakarta Sans has no Bengali glyphs and a
// silent system-font fallback is exactly the drift rule 6 exists to stop.
//
//   full    — Registration: wordmark, tagline, 144dp logo
//   compact — the Gen B phone step: a 22dp wordmark under the icon tile
//   hero    — Role Select: white wordmark on the green hero

export interface AuthBrandBlockProps {
  variant?: 'full' | 'compact' | 'hero';
  tagline?: string;
}

function Wordmark({ size, latinClass, banglaClass }: { size: string; latinClass: string; banglaClass: string }) {
  return (
    <View className="flex-row items-center justify-center gap-1" accessible accessibilityLabel="Muthoy">
      <Text className={`${latinFont('extrabold')} ${size} ${latinClass}`}>Muthoy</Text>
      <Text className={`font-bangla-bold ${size} ${banglaClass}`}>(মুঠোয়)</Text>
    </View>
  );
}

export function AuthBrandBlock({ variant = 'full', tagline }: AuthBrandBlockProps) {
  const font = useCopyFont();
  const { t } = useI18n();

  if (variant === 'hero') {
    return (
      <View className="items-center">
        <Wordmark size="text-[28px]" latinClass="text-white" banglaClass="text-white" />
        <Text className={`${font()} mt-2 text-center text-sm text-white/85`}>
          {tagline ?? t('roleSelectTagline')}
        </Text>
      </View>
    );
  }

  if (variant === 'compact') {
    return (
      <View className="mb-1 items-center">
        <Wordmark size="text-[22px]" latinClass="text-secure-ink" banglaClass="text-secure-primary" />
      </View>
    );
  }

  return (
    <View className="mt-8 items-center">
      <Wordmark size="text-3xl" latinClass="text-richBlack" banglaClass="text-brand-green" />
      <Text className={`${font('medium')} mt-2 text-center text-[15px] text-midGray`}>
        {tagline ?? t('authBrandTagline')}
      </Text>
      <View className="mt-8 h-36 w-36" importantForAccessibility="no-hide-descendants">
        <SvgXml xml={MUTHOY_LOGO_XML} width="100%" height="100%" />
      </View>
    </View>
  );
}

/**
 * Registration's top-right status pill. Copy, not a brand literal: it states
 * something (the shop is backed up to the cloud), so it is translated like any
 * other sentence. The spaced capitals are an English-only treatment — letter
 * spacing breaks Bangla conjuncts, and Bangla has no case.
 */
export function CloudReadyChip() {
  const { t, locale } = useI18n();
  const font = useCopyFont();
  const label = t('authCloudReady');
  return (
    <View
      className="flex-row items-center gap-2 rounded-full border border-white/30 bg-white/60 px-3 py-1.5"
      accessible
      accessibilityLabel={label}
    >
      <View className="h-2 w-2 rounded-full bg-brand-green" />
      <Text
        className={`${font('bold')} text-[10px] text-brand-green ${locale === 'en' ? 'uppercase tracking-[1px]' : ''}`}
      >
        {label}
      </Text>
    </View>
  );
}
