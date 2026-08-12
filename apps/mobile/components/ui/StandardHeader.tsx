import { Pressable, Text, View } from 'react-native';

// StandardHeader — Volume 4 NAVIGATION: "standardized header component
// (translucent soft-green, back chevron, centered title, language toggle)
// applied to every screen except MorningDashboard and Registration."
// Presentation only (DEVELOPMENT_RULES.md).
//
// Language toggle intentionally NOT built here yet — there is no i18n layer
// anywhere in the app to toggle between (flagged, not guessed).

export interface StandardHeaderProps {
  title: string;
  /** Omit on a screen with no back target (e.g. a tab root). */
  onBackPress?: () => void;
}

export function StandardHeader({ title, onBackPress }: StandardHeaderProps) {
  return (
    <View className="flex-row items-center justify-center bg-brand-softGreen px-4 py-4">
      {onBackPress ? (
        <Pressable
          onPress={onBackPress}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          className="absolute left-4 h-10 w-10 items-center justify-center active:opacity-70"
        >
          <Text className="font-sans-semibold text-xl text-richBlack">‹</Text>
        </Pressable>
      ) : null}
      <Text className="font-sans-semibold text-base text-richBlack">{title}</Text>
    </View>
  );
}
