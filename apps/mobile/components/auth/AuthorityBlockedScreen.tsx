import type { ReactNode } from 'react';
import { fillTemplate } from '../../i18n/display';
import { useI18n } from '../../state/localeStore';
import { AuthStatusScreen } from './AuthStatusScreen';
import { authorityBlockCopy, OFFLINE_WINDOW_DAYS, type AuthorityBlockReason } from './authorityGateCopy';

// components/auth/AuthorityBlockedScreen.tsx — the H-10 gate, closed, with a
// reason and two actions.
//
// Neither action opens the gate. "Try again" asks app/_layout.tsx to run the
// same authority check again; "Switch user" clears the active actor exactly as
// state/switchUser.ts always has, which leaves no session to admit. The lease,
// the quarantine, the device registry and the cloud credential are untouched
// by both.

export interface AuthorityBlockedScreenProps {
  reason: AuthorityBlockReason;
  onRetry: () => void;
  onSwitchUser: () => void;
  /** Rendered under the actions (the DEV-only authority recovery). */
  children?: ReactNode;
}

export function AuthorityBlockedScreen({ reason, onRetry, onSwitchUser, children }: AuthorityBlockedScreenProps) {
  const { t, formatNumber } = useI18n();
  const copy = authorityBlockCopy(reason);
  return (
    <AuthStatusScreen
      icon={copy.icon}
      title={t(copy.titleKey)}
      body={fillTemplate(t(copy.bodyKey), { days: formatNumber(OFFLINE_WINDOW_DAYS) })}
      hint={copy.autoRecheck ? t('gateAutoRecheck') : undefined}
      actions={[
        { label: t('retry'), onPress: onRetry },
        { label: t('switchUser'), onPress: onSwitchUser, variant: 'secondary' },
      ]}
    >
      {children}
    </AuthStatusScreen>
  );
}
