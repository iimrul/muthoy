import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { LanguageToggle } from '../ui/LanguageToggle';
import { AuthButton } from './AuthButton';
import { AuthIconTile, type AuthIconName } from './AuthIconTile';
import { AuthNotice, type AuthNoticeTone } from './AuthNotice';
import { AuthShell } from './AuthShell';
import { AuthTitleBlock } from './AuthTitleBlock';
import { AUTH_CHIP_LABELS, SecureChip } from './SecureChip';
import { useCopyFont } from './typography';

// components/auth/AuthStatusScreen.tsx — a full-screen state with a reason and
// a way forward: the H-10 blocked states, credential cleanup, startup faults.
//
// It renders actions; it never grants anything. Whatever a button does is the
// caller's decision, and the callers in app/_layout.tsx are restricted to
// re-running the authority check or clearing the active actor — neither of
// which can mount the navigator for a session that has not been confirmed.

export interface AuthStatusAction {
  label: string;
  onPress: () => void;
  variant?: 'secure' | 'secondary' | 'secureLink';
  disabled?: boolean;
  loading?: boolean;
}

export interface AuthStatusScreenProps {
  icon: AuthIconName;
  title: string;
  body: string;
  eyebrow?: string;
  /** A quieter line under the body, e.g. "we re-check when you are back online". */
  hint?: string;
  notice?: { tone: AuthNoticeTone; message: string } | null;
  actions?: AuthStatusAction[];
  children?: ReactNode;
}

export function AuthStatusScreen({ icon, title, body, eyebrow, hint, notice, actions = [], children }: AuthStatusScreenProps) {
  const font = useCopyFont();
  return (
    <AuthShell
      variant="secure"
      cornerEnd={<LanguageToggle tone="auth" />}
      footer={
        actions.length > 0 || children ? (
          <View className="w-full gap-3">
            {actions.map((action) => (
              <AuthButton
                key={action.label}
                label={action.label}
                onPress={action.onPress}
                variant={action.variant ?? 'secure'}
                disabled={action.disabled}
                loading={action.loading}
              />
            ))}
            {children}
          </View>
        ) : undefined
      }
    >
      <View className="mt-10 items-center">
        <SecureChip label={AUTH_CHIP_LABELS.secure} />
        <AuthIconTile icon={icon} />
        <AuthTitleBlock eyebrow={eyebrow} title={title} body={body} />
        {hint ? <Text className={`${font()} mt-1 text-center text-xs text-secure-footnote`}>{hint}</Text> : null}
        {notice ? (
          <View className="mt-4 w-full">
            <AuthNotice tone={notice.tone} message={notice.message} />
          </View>
        ) : null}
      </View>
    </AuthShell>
  );
}
