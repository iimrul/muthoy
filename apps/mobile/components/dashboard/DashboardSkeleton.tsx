import { Text, View } from "react-native";

// components/dashboard/DashboardSkeleton.tsx — the Owner dashboard's own shape,
// drawn before its first local read lands (founder 2026-11-21: one tap goes
// straight to the dashboard, never to a "Loading dashboard…" screen). Same
// header, green hero and card geometry as app/(tabs)/dashboard.tsx, so the real
// figures fill in without anything jumping. No number is shown — a placeholder
// figure must never be mistaken for real takings.

const KPI_WIDTHS = ["min-w-[170px]", "min-w-[230px]", "min-w-[150px]"] as const;

interface DashboardSkeletonProps {
  topInset: number;
  /** Read by screen readers instead of the placeholder shapes. */
  label: string;
}

export function DashboardSkeleton({ topInset, label }: DashboardSkeletonProps) {
  return (
    <View
      className="flex-1 bg-[#F5F5F5]"
      accessible
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      <View
        className="flex-row items-center gap-3 bg-auth-heroEnd px-4"
        style={{ elevation: 4, paddingTop: topInset, height: 56 + topInset }}
      >
        <View className="h-9 w-9" />
        <Text className="font-sans-extrabold text-base uppercase tracking-wide text-white">MUTHOY</Text>
      </View>
      <View className="rounded-b-[18px] bg-auth-heroEnd pb-20 pt-6">
        <View className="mb-6 gap-2 px-4">
          <View className="h-5 w-48 rounded-md bg-white/20" />
          <View className="h-3 w-28 rounded-md bg-white/15" />
        </View>
        <View className="flex-row gap-3 overflow-hidden px-4 pb-2">
          {KPI_WIDTHS.map((width) => (
            <View key={width} className={`h-[88px] rounded-xl border border-white/20 bg-brand-deepGreen ${width}`} />
          ))}
        </View>
      </View>
      <View className="-mt-16 gap-3 px-4 pb-6">
        <View className="h-32 rounded-xl bg-white" />
        <View className="h-32 rounded-xl bg-white" />
      </View>
    </View>
  );
}
