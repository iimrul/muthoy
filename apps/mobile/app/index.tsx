import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { AuthStatusScreen } from '../components/auth/AuthStatusScreen';
import { BrandLoader } from '../components/auth/BrandLoader';
import { getActiveSessionContext, getRegistrationStatus } from '../db/auth';
import { runtimeDiagnosticError } from '../dev/runtimeDiagnostics';
import type { Permission, PermissionOverrides } from '../domain/permissions';
import { authenticatedHome, type AuthenticatedHomePath } from '../navigation/routes';
import { useI18n } from '../state/localeStore';
import { useSessionStore } from '../state/sessionStore';

type RootDestination =
  | '/register'
  | '/role-select'
  | '/pin-login'
  | AuthenticatedHomePath
  | {
      pathname: '/otp-verify';
      params: { phone: string; resumeShopId: string; resumeOwnerUserId: string };
    }
  | { pathname: '/pin-setup'; params: { shopId: string; userId: string } };

/**
 * Order-independent comparison of two override maps.
 *
 * Key order out of SQLite is not guaranteed, so a plain JSON.stringify compare
 * would report spurious differences — and each one would trigger a login(),
 * which re-runs the effect that produced it.
 */
function isSamePermissions(
  left: PermissionOverrides | undefined,
  right: PermissionOverrides,
): boolean {
  const leftKeys = Object.keys(left ?? {}).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index]) &&
    leftKeys.every((key) => (left ?? {})[key as Permission] === right[key as Permission])
  );
}

export default function RootSessionGate() {
  const session = useSessionStore((state) => state.session);
  const login = useSessionStore((state) => state.login);
  const clearActiveUser = useSessionStore((state) => state.clearActiveUser);
  const [destination, setDestination] = useState<RootDestination | null>(null);
  // Whether the startup read failed. The raw message is not shown: it is a
  // SQLite/driver string that tells a pharmacist nothing and a stranger more
  // than it should. DEV builds still log it (runtimeDiagnosticError).
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { t } = useI18n();

  useEffect(() => {
    let isCurrent = true;

    async function resolveDestination() {
      setDestination(null);
      setError(false);

      try {
        const registration = await getRegistrationStatus();

        if (registration.status === 'none') {
          clearActiveUser();
          if (isCurrent) {
            // NOT straight to Registration any more. An empty database used to
            // mean "brand-new shop", which quietly assumed one device per shop
            // forever. It now means one of three things — new shop, owner's
            // second device, or a staff member's first — and only the person
            // holding the phone knows which.
            setDestination('/role-select');
          }
          return;
        }

        if (registration.status === 'link_pending') {
          clearActiveUser();
          // Every registration that reaches this state proved a real phone at
          // Registration, so resuming it re-enters the same OTP verification —
          // there is no build in which a placeholder number arrives here.
          if (isCurrent) {
            setDestination({
              pathname: '/otp-verify',
              params: {
                phone: registration.phone,
                resumeShopId: registration.shopId,
                // Lets linkDeviceToShop bind this auth account to the owner's
                // app user. The users row exists locally but has not synced up
                // yet, so the id has to travel with the request.
                resumeOwnerUserId: registration.userId,
              },
            });
          }
          return;
        }

        if (registration.status === 'incomplete') {
          clearActiveUser();
          if (isCurrent) {
            setDestination({
              pathname: '/pin-setup',
              params: { shopId: registration.shopId, userId: registration.userId },
            });
          }
          return;
        }

        if (!session) {
          if (isCurrent) {
            setDestination('/pin-login');
          }
          return;
        }

        // Narrowed inside getActiveSessionContext: a persisted session naming a
        // role Beta does not assign (or a tampered MMKV value) resolves to null
        // and goes back to PIN login, rather than being
        // compared as-is and let through.
        const active = await getActiveSessionContext(session.userId, session.shopId);
        if (active === null || active.role !== session.role) {
          clearActiveUser();
          if (isCurrent) {
            setDestination('/pin-login');
          }
          return;
        }

        if (isCurrent) {
          // Refresh the session's permission snapshot from SQLite before any
          // screen renders. The owner's grants and revocations arrive by sync,
          // so a device that was offline when one landed would otherwise keep
          // showing tiles whose writes the DB then refuses, until the next
          // login.
          //
          // Guarded on an actual difference, and that guard is load-bearing:
          // login() replaces `session`, which this effect depends on, so an
          // unconditional call would re-run the effect forever. Same login() as
          // every other entry point, so a REAL change bumps the epoch and
          // invalidates work started under the previous snapshot.
          if (!isSamePermissions(session.permissions, active.permissions)) {
            login({ ...session, permissions: active.permissions });
          }
          setDestination(authenticatedHome(active));
        }
      } catch (cause) {
        if (isCurrent) {
          runtimeDiagnosticError(cause);
          setError(true);
        }
      }
    }

    void resolveDestination();

    return () => {
      isCurrent = false;
    };
  }, [attempt, clearActiveUser, login, session]);

  const handleRetry = () => {
    setAttempt((currentAttempt) => currentAttempt + 1);
  };

  if (error) {
    return (
      <AuthStatusScreen
        icon="database-alert-outline"
        title={t('startupFailedTitle')}
        body={t('startupFailedBody')}
        actions={[{ label: t('retry'), onPress: handleRetry }]}
      />
    );
  }

  if (!destination) {
    return <BrandLoader />;
  }

  return <Redirect href={destination} />;
}
