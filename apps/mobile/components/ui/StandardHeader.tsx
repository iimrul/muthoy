import { Text, View } from 'react-native';

// StandardHeader — Volume 4 NAVIGATION: "standardized header component
// (translucent soft-green, back chevron, centered title, language toggle)
// applied to every screen except MorningDashboard and Registration."
// Presentation only (DEVELOPMENT_RULES.md).

export interface StandardHeaderProps {
  title: string;
  /** Omit on a screen with no back target (e.g. a tab root). */
  onBackPress?: () => void;
}

// TODO(Day 5): translucent soft-green background (brand.softGreen from
//   @muthoy/constants — never hardcode the color), back chevron when
//   onBackPress is given, centered title, language toggle control
//   (components/LanguageToggle equivalent — see apps/prototype-web's
//   LanguageToggle.tsx for layout reference only, per the Prototype Rule).
export function StandardHeader(_props: StandardHeaderProps) {
  return (
    <View>
      <Text>TODO: StandardHeader (Volume 4 NAVIGATION)</Text>
    </View>
  );
}
