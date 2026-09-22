import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors } from '@muthoy/constants';
import { create } from 'zustand';

// components/ui/Toast.tsx — Phase C Pass 1, the shared transient confirmation.
//
// Before this, three screens each kept their own `isToastVisible` boolean, their
// own setTimeout, their own markup and their own timing (app/cash-summary.tsx,
// app/suppliers/invoice-detail.tsx, app/(tabs)/sale.tsx). Two of them rendered a
// dark pill at the bottom; the third rendered a green card at the top. Both
// looks are reproduced here EXACTLY, as two variants, because Pass 1 extracts
// the primitive — it does not re-decide what any screen looks like. Choosing
// between them is Pass 2 and 3's job, screen by screen, against the prototype.
//
// Presentation only. It never touches SQLite, sync, or a session (see
// components/README.md), and a toast is never how a failure is reported: the
// screens keep their inline error text, which does not disappear after two
// seconds.

export type ToastVariant = 'pill' | 'card';

export interface ToastOptions {
  /** The line that carries the meaning. Always shown. */
  message: string;
  /** Small supporting line above `message`. Card variant only. */
  label?: string;
  variant?: ToastVariant;
  durationMs?: number;
}

interface ActiveToast extends Required<Omit<ToastOptions, 'label'>> {
  label?: string;
  /** Distinguishes one toast from its replacement, so a stale timer cannot
   *  dismiss the toast that replaced it. */
  id: number;
}

const DEFAULT_DURATION_MS = 1_800;

interface ToastState {
  current: ActiveToast | null;
  show: (options: ToastOptions) => void;
  dismiss: (id: number) => void;
}

let nextToastId = 0;

const useToastStore = create<ToastState>((set) => ({
  current: null,
  // Replace rather than queue. A pharmacist scanning items in quick succession
  // wants the LATEST confirmation, not a backlog of four of them playing out
  // after they have moved on — which is exactly what the ad-hoc timers did.
  show: (options) => {
    nextToastId += 1;
    set({
      current: {
        id: nextToastId,
        message: options.message,
        label: options.label,
        variant: options.variant ?? 'pill',
        durationMs: options.durationMs ?? DEFAULT_DURATION_MS,
      },
    });
  },
  dismiss: (id) => set((state) => (state.current?.id === id ? { current: null } : state)),
}));

/**
 * Shows a toast from anywhere, including a non-React callback.
 *
 * Module-level rather than context-based on purpose: the callers are async
 * handlers that have already survived an await, and threading a provider
 * through every one of them buys nothing a store does not already give.
 */
export function showToast(options: ToastOptions): void {
  useToastStore.getState().show(options);
}

/** Hook form, for screens that prefer it. Same store, same behaviour. */
export function useToast(): { show: (options: ToastOptions) => void } {
  return { show: useToastStore((state) => state.show) };
}

/** Test/reset seam: drops any toast without waiting for its timer. */
export function clearToasts(): void {
  useToastStore.setState({ current: null });
}

/**
 * Mounted ONCE, in app/_layout.tsx, above the navigator.
 *
 * One host rather than one per screen so a toast raised just before a
 * navigation is not unmounted mid-flight by the screen that raised it.
 */
export function ToastHost() {
  const current = useToastStore((state) => state.current);
  const dismiss = useToastStore((state) => state.dismiss);

  useEffect(() => {
    if (!current) {
      return;
    }
    const { id } = current;
    const timer = setTimeout(() => dismiss(id), current.durationMs);
    return () => clearTimeout(timer);
  }, [current, dismiss]);

  if (!current) {
    return null;
  }

  // pointerEvents="none" on both: a confirmation must never eat the tap meant
  // for the button underneath it. The bottom pill previously could.
  if (current.variant === 'card') {
    return (
      <View
        pointerEvents="none"
        accessibilityLiveRegion="polite"
        className="absolute left-0 right-0 top-20 items-center px-4"
      >
        <View className="w-full max-w-md flex-row items-center gap-3 rounded-2xl bg-brand-green px-5 py-4">
          <View className="h-9 w-9 items-center justify-center rounded-full bg-white/20">
            <Feather name="check-circle" size={20} color={colors.white} />
          </View>
          <View>
            {current.label ? (
              <Text className="font-sans text-xs text-white/90">{current.label}</Text>
            ) : null}
            <Text className="font-sans-bold text-sm text-white">{current.message}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      className="absolute bottom-8 left-0 right-0 items-center"
    >
      <View className="flex-row items-center gap-2 rounded-full bg-richBlack px-4 py-2">
        <Text className="font-sans-semibold text-sm text-white">{`✓ ${current.message}`}</Text>
      </View>
    </View>
  );
}
