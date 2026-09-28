// react-native-safe-area-context reaches native view managers at import time,
// which the Vitest/Node environment cannot load — same reasoning as this
// directory's other RN-native-package stubs. Tests have no status bar or
// gesture area, so every inset is zero. Screens read insets through
// SafeAreaInsetsContext, exactly as they do on device (expo-router's ExpoRoot
// provides the real one there).
import { createContext, createElement, type ReactNode } from 'react';

export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const ZERO: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export const SafeAreaInsetsContext = createContext<EdgeInsets | null>(null);

export function SafeAreaProvider({ children }: { children?: ReactNode }) {
  return createElement(SafeAreaInsetsContext.Provider, { value: ZERO }, children);
}

export function useSafeAreaInsets(): EdgeInsets {
  return ZERO;
}
