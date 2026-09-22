import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useI18n } from '../../state/localeStore';

// components/ui/Skeleton.tsx — Phase C Pass 1.
//
// There was no loading primitive: every screen rendered an ActivityIndicator
// or a line of text while it waited, so a list arriving after a query jumped
// the layout by its full height. A skeleton reserves the space the content
// will occupy, which is the point — the spinner was never what was missing,
// the LAYOUT was.
//
// ACCESSIBILITY. The blocks are decorative and are hidden from the screen
// reader; exactly one element announces, and it announces a LOCALISED string.
// The first version gave every block accessibilityRole="progressbar" with a
// hardcoded English "Loading" label, so a four-row list skeleton read out as
// twelve English progress bars to a Bangla-speaking pharmacist waiting for one
// thing to finish. Twelve announcements is worse than none.
//
// Deliberately static, with no shimmer. A moving placeholder is motion nobody
// asked for on a screen someone is already waiting on (and would need a
// reduced-motion escape), and an Animated loop in a primitive this widely used
// puts a running timer into every screen test that renders one.

export interface SkeletonProps {
  /** Tailwind height class, e.g. "h-4". Defaults to a text line. */
  heightClassName?: string;
  /** Tailwind width class, e.g. "w-32" or "w-full". */
  widthClassName?: string;
  /** Tailwind radius class. */
  radiusClassName?: string;
  className?: string;
}

/**
 * One placeholder block. Everything below composes this.
 *
 * Never announced. It is a grey rectangle standing in for content that is not
 * there yet; there is nothing for a reader to say about it that
 * SkeletonRegion does not already say once.
 */
export function Skeleton({
  heightClassName = 'h-4',
  widthClassName = 'w-full',
  radiusClassName = 'rounded-md',
  className = '',
}: SkeletonProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`bg-black/10 ${heightClassName} ${widthClassName} ${radiusClassName} ${className}`.trim()}
    />
  );
}

export interface SkeletonRegionProps {
  children: ReactNode;
  /**
   * Overrides the generic "Loading…" for a screen that can say something more
   * useful ("Loading dashboard…"). Must already be localised by the caller.
   */
  label?: string;
  className?: string;
}

/**
 * The ONE announced element. Wrap a skeleton in this wherever a screen reader
 * should be told that something is loading — once, in the user's language.
 *
 * Nested regions are not expected and not supported: the composites below are
 * silent precisely so that putting several of them inside one region still
 * produces a single announcement.
 */
export function SkeletonRegion({ children, label, className = '' }: SkeletonRegionProps) {
  const { t } = useI18n();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t('loadingLabel')}
      accessibilityLiveRegion="polite"
      className={className}
    >
      {children}
    </View>
  );
}

export interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

/**
 * A run of text lines. The last is short, because real paragraphs are — a
 * block of identical full-width bars reads as a table, not as prose.
 *
 * Silent. Wrap it in SkeletonRegion when it is the only thing on screen.
 */
export function SkeletonText({ lines = 3, className = '' }: SkeletonTextProps) {
  const count = Math.max(1, lines);
  return (
    <View className={`gap-2 ${className}`.trim()}>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton
          key={index}
          widthClassName={index === count - 1 ? 'w-2/3' : 'w-full'}
        />
      ))}
    </View>
  );
}

export interface SkeletonListProps {
  rows?: number;
  className?: string;
}

/**
 * The shape every list screen waits on: a leading block, two stacked lines and
 * a trailing figure. Matches the card geometry the inventory, customer and
 * supplier lists already render. Silent, like SkeletonText.
 */
export function SkeletonList({ rows = 4, className = '' }: SkeletonListProps) {
  return (
    <View className={`gap-3 ${className}`.trim()}>
      {Array.from({ length: Math.max(1, rows) }).map((_, index) => (
        <View key={index} className="flex-row items-center gap-3 rounded-2xl bg-white p-4">
          <Skeleton heightClassName="h-10" widthClassName="w-10" radiusClassName="rounded-full" />
          <View className="flex-1 gap-2">
            <Skeleton widthClassName="w-1/2" />
            <Skeleton heightClassName="h-3" widthClassName="w-1/3" />
          </View>
          <Skeleton heightClassName="h-5" widthClassName="w-16" />
        </View>
      ))}
    </View>
  );
}

export interface SkeletonCardProps {
  lines?: number;
  className?: string;
}

/** A single summary card — the dashboard/report tile shape. Silent. */
export function SkeletonCard({ lines = 2, className = '' }: SkeletonCardProps) {
  return (
    <View className={`gap-3 rounded-2xl bg-white p-4 ${className}`.trim()}>
      <Skeleton heightClassName="h-3" widthClassName="w-1/3" />
      <SkeletonText lines={lines} />
    </View>
  );
}
