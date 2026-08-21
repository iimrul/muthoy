import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { colors } from "@muthoy/constants";

interface DashboardLoadStateProps {
  loading: boolean;
  message: string;
  retryLabel: string;
  onRetry: () => void;
}

export function DashboardLoadState({
  loading,
  message,
  retryLabel,
  onRetry,
}: DashboardLoadStateProps) {
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-brand-softGreen p-6">
      {loading ? <ActivityIndicator color={colors.brandGreen} /> : null}
      <Text
        accessibilityRole={loading ? undefined : "alert"}
        className={`text-center font-sans text-sm ${loading ? "text-midGray" : "text-error"}`}
      >
        {message}
      </Text>
      {!loading ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          className="rounded-xl bg-brand-green px-5 py-3"
        >
          <Text className="font-sans-semibold text-white">{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
