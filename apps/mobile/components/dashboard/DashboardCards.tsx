import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

// Presentational Owner Dashboard primitives. No DB, no session, no
// navigation decisions — dashboard.tsx owns all three and passes results in.
//
// CLAUDE.md rule 6: money is rendered by the caller through formatMoney into
// `font-mono` (DM Mono); every other number uses `font-sans`. Nothing here
// hardcodes a font string.
//
// Layout is functional, not final: Phase C owns typography and spacing.

interface KpiCardProps {
  label: string;
  /** Already formatted by the caller — money through formatMoney. */
  value: string;
  footer?: string;
  /** Small right-aligned control, e.g. the Expected Cash "Details" link. */
  accessory?: ReactNode;
  /** Live marker on Today's Sales. */
  isLive?: boolean;
  liveLabel?: string;
  onPress?: () => void;
  accessibilityLabel: string;
}

export function KpiCard({
  label,
  value,
  footer,
  accessory,
  isLive,
  liveLabel,
  onPress,
  accessibilityLabel,
}: KpiCardProps) {
  const body = (
    <View className="min-w-44 justify-between gap-1 rounded-xl border border-white/20 bg-brand-deepGreen px-4 py-3">
      <View className="flex-row items-center justify-between gap-2">
        <Text
          numberOfLines={1}
          className="flex-1 font-sans text-[10px] uppercase tracking-wide text-white/80"
        >
          {label}
        </Text>
        {isLive ? (
          <View className="flex-row items-center gap-1">
            <View className="h-1.5 w-1.5 rounded-full bg-success" />
            <Text className="font-sans text-[9px] uppercase text-white/80">
              {liveLabel}
            </Text>
          </View>
        ) : null}
        {accessory}
      </View>
      <Text numberOfLines={1} className="font-mono text-xl text-white">
        {value}
      </Text>
      {footer ? (
        <Text numberOfLines={1} className="font-sans text-[10px] text-white/70">
          {footer}
        </Text>
      ) : null}
    </View>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {body}
    </Pressable>
  );
}

export type AlertTone = "danger" | "warning" | "neutral" | "positive";

const TONE: Record<
  AlertTone,
  { container: string; title: string; value: string; action: string }
> = {
  danger: {
    container: "border-error/40 bg-errorBg",
    title: "text-error",
    value: "text-error",
    action: "text-error",
  },
  warning: {
    container: "border-warning/40 bg-warningBg",
    title: "text-warning",
    value: "text-warning",
    action: "text-warning",
  },
  neutral: {
    container: "border-midGray/30 bg-white",
    title: "text-richBlack",
    value: "text-richBlack",
    action: "text-brand-green",
  },
  positive: {
    container: "border-brand-green bg-brand-softGreen",
    title: "text-brand-green",
    value: "text-brand-green",
    action: "text-brand-green",
  },
};

export interface AlertRow {
  key: string;
  label: string;
  /** Right-hand figure. Money must already be formatMoney'd by the caller. */
  value: string;
  /** Render the value in DM Mono. Money only (CLAUDE.md rule 6). */
  isMoney?: boolean;
}

interface AlertCardProps {
  tone: AlertTone;
  title: string;
  rows: AlertRow[];
  /** Remaining rows beyond the preview — the TRUE total, not a capped page. */
  moreCount: number;
  formatCount: (value: number) => string;
  moreLabel: string;
  emptyLabel: string;
  actionLabel: string;
  subtitle?: string;
  onPress: () => void;
}

export function AlertCard({
  tone,
  title,
  rows,
  moreCount,
  formatCount,
  moreLabel,
  emptyLabel,
  actionLabel,
  subtitle,
  onPress,
}: AlertCardProps) {
  const palette = TONE[tone];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${rows.length ? actionLabel : emptyLabel}`}
      className={`gap-2 rounded-2xl border p-4 ${palette.container}`}
    >
      <Text className={`font-sans-bold text-sm ${palette.title}`}>{title}</Text>
      {subtitle ? (
        <Text className="font-sans text-xs text-midGray">{subtitle}</Text>
      ) : null}
      {rows.length ? (
        <View className="gap-1">
          {rows.map((row) => (
            <View key={row.key} className="flex-row justify-between gap-3">
              <Text
                numberOfLines={1}
                className="flex-1 font-sans text-xs text-midGray"
              >
                {row.label}
              </Text>
              <Text
                className={`text-xs ${row.isMoney ? "font-mono" : "font-sans-semibold"} ${palette.value}`}
              >
                {row.value}
              </Text>
            </View>
          ))}
          {moreCount > 0 ? (
            <Text className={`font-sans-semibold text-xs ${palette.value}`}>
              + {formatCount(moreCount)} {moreLabel}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text className="font-sans text-xs text-midGray">{emptyLabel}</Text>
      )}
      <Text className={`font-sans-bold text-xs underline ${palette.action}`}>
        {actionLabel}
      </Text>
    </Pressable>
  );
}

interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onPressAction?: () => void;
}

export function SectionHeader({
  title,
  actionLabel,
  onPressAction,
}: SectionHeaderProps) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="font-sans-bold text-sm text-brand-green">{title}</Text>
      {actionLabel && onPressAction ? (
        <Pressable
          onPress={onPressAction}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel} — ${title}`}
        >
          <Text className="font-sans-bold text-xs uppercase tracking-wide text-brand-green">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
