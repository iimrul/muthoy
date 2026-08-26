import { Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

// EmptyState — the app's first (CLAUDE.md rule 9: "no seed/demo data ships —
// every fresh shop starts empty", so an empty list IS the default first-run
// view, not an edge case). Presentation only (DEVELOPMENT_RULES.md).

export interface EmptyStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Optional Feather icon name, shown in a soft-green circle above the title (prototype parity). */
  icon?: keyof typeof Feather.glyphMap;
}

export function EmptyState({ title, message, actionLabel, onAction, icon }: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-6">
      {icon ? (
        <View className="mb-1 h-16 w-16 items-center justify-center rounded-full bg-brand-softGreen">
          <Feather name={icon} size={28} color="#059669" />
        </View>
      ) : null}
      <Text className="font-sans-bold text-lg text-richBlack">{title}</Text>
      <Text className="text-center font-sans text-sm text-midGray">{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          className="mt-2 items-center rounded-lg bg-brand-green px-5 py-3 active:opacity-80"
        >
          <Text className="font-sans-semibold text-base text-white">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
