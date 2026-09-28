import { createElement, forwardRef, type ReactNode } from 'react';

// tests/support/reactNativeMock.ts — the React Native primitives the auth
// screens render, as plain DOM for jsdom suites.
//
// Used as `vi.mock('react-native', async () =>
//   (await import('../tests/support/reactNativeMock')).createReactNativeMock())`.
// Accessibility props become the DOM attributes Testing Library queries, so a
// suite finds a button by the SAME label TalkBack reads out, and an alert or a
// header by its role. A subtree hidden from TalkBack (importantForAccessibility
// "no-hide-descendants" / accessibilityElementsHidden) is aria-hidden, and a
// Pressable with accessible={false} is no button at all — so "exactly one
// accessible control" is assertable the way a screen reader would count it.

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessible?: boolean;
  importantForAccessibility?: string;
  accessibilityElementsHidden?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: string;
  accessibilityHint?: string;
  accessibilityState?: { disabled?: boolean; busy?: boolean; selected?: boolean };
  disabled?: boolean;
  testID?: string;
  value?: string;
  onChangeText?: (value: string) => void;
  onSubmitEditing?: () => void;
  placeholder?: string;
  editable?: boolean;
  visible?: boolean;
  autoComplete?: string;
  textContentType?: string;
  keyboardType?: string;
}

const ROLES: Record<string, string> = {
  alert: 'alert',
  header: 'heading',
  progressbar: 'progressbar',
};

function hiddenFromScreenReader({ importantForAccessibility, accessibilityElementsHidden }: StubProps): true | undefined {
  return importantForAccessibility === 'no-hide-descendants' || accessibilityElementsHidden ? true : undefined;
}

function box(tag: string) {
  return function Box(props: StubProps) {
    const { children, accessibilityLabel, accessibilityRole, testID } = props;
    return createElement(
      tag,
      {
        'aria-label': accessibilityLabel,
        'aria-hidden': hiddenFromScreenReader(props),
        role: accessibilityRole ? ROLES[accessibilityRole] : undefined,
        'data-testid': testID,
      },
      children,
    );
  };
}

class AnimatedValue {
  constructor(public value: number) {}
}

function finishedAnimation() {
  return { start: (callback?: (result: { finished: boolean }) => void) => callback?.({ finished: true }) };
}

export function createReactNativeMock() {
  const TextInput = forwardRef<HTMLInputElement, StubProps>(function TextInput(
    {
      value,
      onChangeText,
      onSubmitEditing,
      accessibilityLabel,
      accessibilityState,
      placeholder,
      editable,
      autoComplete,
      textContentType,
      keyboardType,
    },
    ref,
  ) {
    return createElement('input', {
      ref,
      value: value ?? '',
      'aria-label': accessibilityLabel,
      'aria-busy': accessibilityState?.busy,
      placeholder,
      readOnly: editable === false,
      'data-autocomplete': autoComplete,
      'data-content-type': textContentType,
      'data-keyboard': keyboardType,
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
      onKeyDown: (event: { key: string }) => {
        if (event.key === 'Enter') onSubmitEditing?.();
      },
    });
  });

  return {
    View: box('div'),
    Text: box('span'),
    ScrollView: box('div'),
    KeyboardAvoidingView: box('div'),
    Pressable: ({ children, onPress, accessible, accessibilityLabel, disabled, testID, accessibilityState }: StubProps) =>
      accessible === false
        ? createElement('div', { onClick: onPress, 'data-testid': testID }, children)
        : createElement(
            'button',
            {
              onClick: onPress,
              'aria-label': accessibilityLabel,
              'aria-pressed': accessibilityState?.selected,
              disabled,
              'data-testid': testID,
            },
            children,
          ),
    TextInput,
    ActivityIndicator: () => createElement('span', { role: 'progressbar' }),
    Modal: ({ children, visible }: StubProps) => (visible ? createElement('div', { role: 'dialog' }, children) : null),
    Animated: {
      View: box('div'),
      Value: AnimatedValue,
      timing: finishedAnimation,
      sequence: finishedAnimation,
    },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(false),
      announceForAccessibility: () => undefined,
    },
    Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default },
    StyleSheet: { absoluteFill: {}, create: <T,>(styles: T) => styles, flatten: <T,>(style: T) => style },
    Alert: { alert: () => undefined },
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
  };
}
