import { useContext, type ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { colors } from '@muthoy/constants';
import { AuthGradient, SoftBlob } from './AuthGradient';

// components/auth/AuthShell.tsx — ONE page frame for every auth screen.
//
// The prototype copy-pastes a `Shell` into each PIN screen and hand-builds the
// others. This is that frame once, in the prototype's two visual generations
// plus Role Select's hero, and it owns the things a web page never had to:
//
//   - safe areas. Expo SDK 57 draws edge-to-edge, so content would otherwise
//     sit under the status bar and the gesture bar.
//   - the keyboard. Every auth form scrolls inside a KeyboardAvoidingView with
//     keyboardShouldPersistTaps, so a focused phone field never hides the
//     button that submits it on a 360dp phone. 'padding' is safe on both
//     platforms: it only pads by whatever the keyboard still overlaps, so a
//     window the OS already resized is not shrunk twice.
//   - the thumb zone. `footer` (the PIN pad) is pushed to the bottom of the
//     visible area on tall phones instead of floating mid-screen.
//
// Presentation only: it renders what it is given and decides nothing.

export type AuthShellVariant = 'brand' | 'secure' | 'hero';

export interface AuthShellProps {
  /** 'brand' = Gen A (Registration, OTP); 'secure' = Gen B (PIN screens); 'hero' = Role Select. */
  variant: AuthShellVariant;
  /** A StandardHeader (tone="auth", safeAreaTop). Owns the status-bar inset when present. */
  header?: ReactNode;
  /** Overlays pinned to the top corners, e.g. the language toggle. */
  cornerStart?: ReactNode;
  cornerEnd?: ReactNode;
  /** Hero variant: the brand block above the white sheet. */
  hero?: ReactNode;
  children: ReactNode;
  /** Anchored to the bottom of the content: the PIN pad and its links. */
  footer?: ReactNode;
}

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

// Content widths, straight from the prototype: max-w-md pages, and the Gen B
// PIN column capped at 340.
const CONTENT_CLASS: Record<AuthShellVariant, string> = {
  brand: 'w-full max-w-md flex-1 self-center px-6 py-8',
  secure: 'w-full max-w-[340px] flex-1 self-center px-5 pb-4 pt-3',
  hero: 'w-full max-w-md self-center px-6 pb-6 pt-8',
};

function useInsets() {
  // Read through the context rather than useSafeAreaInsets(): expo-router's
  // root always provides it on device, and a screen rendered outside that
  // provider (the H-10 gate before the navigator exists) degrades to zero
  // insets instead of throwing.
  return useContext(SafeAreaInsetsContext) ?? ZERO_INSETS;
}

function Corners({ start, end, top }: { start?: ReactNode; end?: ReactNode; top: number }) {
  if (!start && !end) return null;
  return (
    <>
      {start ? <View className="absolute left-6 z-10" style={{ top: top + 16 }}>{start}</View> : null}
      {end ? <View className="absolute right-6 z-10" style={{ top: top + 16 }}>{end}</View> : null}
    </>
  );
}

function ScrollBody({
  variant,
  children,
  footer,
  bottomInset,
}: {
  variant: AuthShellVariant;
  children: ReactNode;
  footer?: ReactNode;
  bottomInset: number;
}) {
  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: bottomInset }}
      >
        <View className={CONTENT_CLASS[variant]}>
          {children}
          {footer ? (
            <>
              <View className="min-h-4 flex-1" />
              {footer}
            </>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function AuthShell({ variant, header, cornerStart, cornerEnd, hero, children, footer }: AuthShellProps) {
  const insets = useInsets();
  const statusBarSpacer = header ? null : <View style={{ height: insets.top }} />;

  if (variant === 'hero') {
    return (
      <View className="flex-1 bg-brand-green">
        <AuthGradient from={colors.brandGreen} to={colors.authHeroEnd} direction="vertical" />
        {statusBarSpacer}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <View className="w-full max-w-md flex-1 items-center justify-center self-center px-6 pb-4 pt-12">
            {hero}
          </View>
          <View className="w-full max-w-md self-center rounded-t-sheet bg-white">
            <View className={CONTENT_CLASS.hero} style={{ paddingBottom: 24 + insets.bottom }}>
              {children}
            </View>
          </View>
        </ScrollView>
        <Corners start={cornerStart} end={cornerEnd} top={insets.top} />
      </View>
    );
  }

  if (variant === 'brand') {
    return (
      <View className="flex-1 bg-auth-canvasFrom">
        <AuthGradient from={colors.authCanvasFrom} to={colors.softGreen} />
        {statusBarSpacer}
        {header}
        <ScrollBody variant="brand" footer={footer} bottomInset={insets.bottom}>
          {children}
        </ScrollBody>
        <Corners start={cornerStart} end={cornerEnd} top={insets.top} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-secure-canvas">
      <View className="w-full max-w-md flex-1 self-center overflow-hidden bg-secure-surface">
        <SoftBlob color={colors.secureBlobA} opacity={0.45} size={288} position={{ top: -96, right: -96 }} />
        <SoftBlob color={colors.secureBlobB} opacity={0.7} size={288} position={{ bottom: -112, left: -96 }} />
        {statusBarSpacer}
        {header}
        <ScrollBody variant="secure" footer={footer} bottomInset={insets.bottom}>
          {children}
        </ScrollBody>
        <Corners start={cornerStart} end={cornerEnd} top={insets.top} />
      </View>
    </View>
  );
}
