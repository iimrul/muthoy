import { Pressable, Text, View } from 'react-native';

// EmptyState — the app's first (CLAUDE.md rule 9: "no seed/demo data ships —
// every fresh shop starts empty", so an empty list IS the default first-run
// view, not an edge case). Presentation only (DEVELOPMENT_RULES.md).

export interface EmptyStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-6">
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
