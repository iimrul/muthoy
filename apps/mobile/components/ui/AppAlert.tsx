// components/ui/AppAlert.tsx — the app's own confirm / notice dialog.
//
// Founder, 2026-11-27: the system Alert ("remove staff?") did not look like
// Muthoy; every warning must be simple but professional. `appAlert` keeps
// Alert.alert's exact call shape — (title, message?, buttons?) with
// `style: 'cancel' | 'destructive'` — so every call site moved over without
// changing what it does, and renders one branded dialog instead:
//   - a destructive action gets a red icon and a red action button;
//   - a single-button notice (something failed) gets an amber icon;
//   - anything else is green, the brand colour.
// Back and the backdrop act as the cancel button (or close a notice).
// Requests queue, so two alerts raised together are shown one after another.

import { useEffect } from "react";
import { BackHandler, Modal, Pressable, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { create } from "zustand";
import { colors } from "@muthoy/constants";
import { useI18n } from "../../state/localeStore";

export interface AppAlertButton {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void | Promise<void>;
}

interface AppAlertRequest {
  id: number;
  title: string;
  message?: string;
  buttons: AppAlertButton[];
}

export type AppAlertTone = "danger" | "warning" | "default";

const useAppAlertStore = create<{ queue: AppAlertRequest[] }>(() => ({ queue: [] }));
let nextId = 1;

/** Alert.alert's shape, the app's look. No buttons = one "OK". */
export function appAlert(title: string, message?: string, buttons?: AppAlertButton[]): void {
  const request: AppAlertRequest = { id: nextId++, title, message, buttons: buttons ?? [] };
  useAppAlertStore.setState((state) => ({ queue: [...state.queue, request] }));
}

/** Test seam: clears anything still queued. */
export function resetAppAlertsForTests(): void {
  useAppAlertStore.setState({ queue: [] });
}

export function toneOf(buttons: readonly AppAlertButton[]): AppAlertTone {
  if (buttons.some((button) => button.style === "destructive")) return "danger";
  const hasCancel = buttons.some((button) => button.style === "cancel");
  const actions = buttons.filter((button) => button.style !== "cancel");
  // No choice to make: a notice (usually "this did not work").
  if (!hasCancel && actions.length <= 1) return "warning";
  return "default";
}

const TONE = {
  danger: { icon: "alert-triangle", ink: colors.error, tint: colors.errorBg, action: "bg-error" },
  warning: { icon: "alert-circle", ink: colors.warning, tint: colors.warningBg, action: "bg-brand-green" },
  default: { icon: "help-circle", ink: colors.brandGreen, tint: colors.softGreen, action: "bg-brand-green" },
} as const;

function close(id: number): void {
  useAppAlertStore.setState((state) => ({ queue: state.queue.filter((item) => item.id !== id) }));
}

/** Mounted once, inside the authenticated navigation shell. */
export function AppAlertHost() {
  const { t } = useI18n();
  const current = useAppAlertStore((state) => state.queue[0] ?? null);
  const buttons: AppAlertButton[] = current
    ? current.buttons.length > 0
      ? current.buttons
      : [{ text: t("okLabel") }]
    : [];
  const cancel = buttons.find((button) => button.style === "cancel");
  // What Back and a tap outside the card mean: cancel, or close a notice.
  const dismissal = cancel ?? (buttons.length === 1 ? buttons[0] : undefined);

  const press = (button: AppAlertButton | undefined) => {
    if (!current) return;
    // Close FIRST: an action that navigates or raises another alert must not
    // find this one still on screen.
    close(current.id);
    if (button?.onPress) void Promise.resolve(button.onPress()).catch(() => undefined);
  };

  useEffect(() => {
    if (!current) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      press(dismissal);
      return true;
    });
    return () => subscription.remove();
  });

  if (!current) return null;
  const tone = TONE[toneOf(buttons)];
  // Cancel always sits first (left), the action last (right).
  const ordered = [
    ...buttons.filter((button) => button.style === "cancel"),
    ...buttons.filter((button) => button.style !== "cancel"),
  ];
  const isRow = ordered.length === 2;

  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={() => press(dismissal)}>
      <Pressable
        onPress={() => press(dismissal)}
        accessibilityLabel={t("closeLabel")}
        className="flex-1 items-center justify-center bg-black/40 px-6"
      >
        <Pressable
          accessibilityViewIsModal
          accessibilityRole="alert"
          onPress={() => undefined}
          className="w-full max-w-sm items-center gap-3 rounded-3xl bg-white p-6"
        >
          <View
            testID={`app-alert-tone-${toneOf(buttons)}`}
            className="h-14 w-14 items-center justify-center rounded-full"
            style={{ backgroundColor: tone.tint }}
          >
            <Feather name={tone.icon} size={26} color={tone.ink} />
          </View>
          <Text className="text-center font-sans-bold text-lg text-richBlack">{current.title}</Text>
          {current.message ? (
            <Text className="text-center font-sans text-sm leading-5 text-midGray">{current.message}</Text>
          ) : null}
          <View className={`mt-2 w-full gap-3 ${isRow ? "flex-row" : ""}`}>
            {ordered.map((button) => {
              const isCancel = button.style === "cancel";
              const fill = isCancel
                ? "border border-auth-fieldBorder bg-white"
                : button.style === "destructive"
                  ? "bg-error"
                  : tone.action;
              return (
                <Pressable
                  key={`${button.style ?? "default"}:${button.text}`}
                  onPress={() => press(button)}
                  accessibilityRole="button"
                  accessibilityLabel={button.text}
                  className={`${isRow ? "flex-1" : "w-full"} h-12 items-center justify-center rounded-xl active:opacity-80 ${fill}`}
                >
                  <Text className={`font-sans-semibold text-base ${isCancel ? "text-richBlack" : "text-white"}`}>
                    {button.text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
