import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { PinPad, usePinEntry, type PinCompletionMeta } from '../../components/ui/PinPad';
import { recordSuccessfulLogin, verifyPin } from '../../db/auth';
import { DeviceAccessRevokedError, PinLockedOutError } from '../../db/errors';
import { pinAttemptScope, pinAttemptStatus } from '../../db/pinAttemptLock';
import { handoffAuthTiming, startAuthTiming } from '../../dev/authTiming';
import {
  markRuntimeDiagnosticStep,
  sessionDiagnosticContext,
} from '../../dev/runtimeDiagnostics';
import { toRole } from '../../domain/permissions';
import { authenticatedHome } from '../../navigation/routes';
import { useI18n } from '../../state/localeStore';
import { readLastShopIdSync, useSessionStore } from '../../state/sessionStore';
import { inspectCloudActorBinding } from '../../sync/authActorBinding';
import { networkReachability } from '../../sync/connectivity';
import {
  DeviceRegistryError,
  switchActorOnDevice,
} from '../../sync/deviceRegistry';

// PIN Login — Volume 4 AUTHENTICATION, Volume 0 Day 5. Checks the bcrypt hash
// OFFLINE — no network call required to succeed.
//
// H-4: the offline attempt budget lives in db/pinAttemptLock.ts and is enforced
// by db/auth.ts's verifyPin, not here. This screen only renders the refusal —
// the lock has to hold whether or not anyone is looking at this component, so
// it is read from the store on mount rather than kept in React state alone.
//
// A successful login no longer refills that budget, which makes the recovery
// link below load-bearing rather than decorative: an owner who has genuinely
// forgotten their PIN can now reach a locked pad, and waiting out the cooldown
// must not be their only way back.

/** "4m 05s" / "45s" — enough to wait on, with no digits from the PIN itself. */
function formatRetryAfter(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

export default function PinLoginScreen() {
  const [error, setError] = useState(false);
  // A2.3. A revoked device or binding is NOT a wrong PIN and must not read as
  // one. Kept separate so the pad's own error state is untouched.
  // A2.3. `read_failed` is here because the mirror failing to answer now
  // refuses the login too (db/deviceRegistry.ts). It is a fault, not a
  // revocation, and gets its own message: telling a shopkeeper their device
  // was removed when it was not would send them hunting for something that
  // never happened.
  const [revoked, setRevoked] = useState<
    'device_revoked' | 'binding_revoked' | 'read_failed' | null
  >(null);
  const [lockedUntilMs, setLockedUntilMs] = useState<number | null>(() => {
    const status = pinAttemptStatus(pinAttemptScope(readLastShopIdSync()));
    return status.isLocked ? Date.now() + status.retryAfterMs : null;
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const login = useSessionStore((s) => s.login);
  const { t } = useI18n();

  // Ticks only while a cooldown is running, and stops itself the moment it
  // ends — no timer on the ordinary login path.
  useEffect(() => {
    if (lockedUntilMs === null) {
      return;
    }
    const id = setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      if (current >= lockedUntilMs) {
        setLockedUntilMs(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [lockedUntilMs]);

  const remainingMs = lockedUntilMs === null ? 0 : Math.max(0, lockedUntilMs - nowMs);
  const isLocked = remainingMs > 0;
  const handleComplete = useCallback(
    async (pin: string, { completedAt }: PinCompletionMeta) => {
      markRuntimeDiagnosticStep('pin_submit', {
        currentRoute: '/pin-login',
        userId: 'none',
        shopId: 'none',
        resolvedRole: 'unknown',
        permissionCount: 0,
      });
      const timing = startAuthTiming('offline_pin_login', completedAt);
      timing?.mark('submit_start');
      let result: Awaited<ReturnType<typeof verifyPin>>;
      try {
        result = timing
          ? await timing.measure('local_pin_verification', () => verifyPin(pin, timing))
          : await verifyPin(pin);
      } catch (caught) {
        // A2.3. The PIN matched a real account whose access on THIS
        // installation has been revoked. No attempt budget was spent reaching
        // here — db/auth.ts charges only unmatched credentials — so the pad
        // stays unlocked and the message says what actually happened.
        if (caught instanceof DeviceAccessRevokedError) {
          setError(false);
          setRevoked(caught.objection);
          timing?.mark('device_access_revoked', 'error');
          return;
        }
        // Beyond that, only the budget refusal is handled here. Anything else
        // is a real fault and must keep surfacing as one rather than reading
        // to the user as a wrong PIN.
        if (!(caught instanceof PinLockedOutError)) {
          throw caught;
        }
        setError(false);
        setRevoked(null);
        setNowMs(Date.now());
        setLockedUntilMs(Date.now() + caught.retryAfterMs);
        return;
      }
      if (!result) {
        setError(true);
        setRevoked(null);
        timing?.mark('login_rejected', 'error');
        // A rejection may have been the one that spent the budget. Re-read it
        // rather than re-deriving the rule on this side of the boundary.
        const status = pinAttemptStatus(pinAttemptScope(readLastShopIdSync()));
        if (status.isLocked) {
          setNowMs(Date.now());
          setLockedUntilMs(Date.now() + status.retryAfterMs);
        }
        return;
      }

      setError(false);
      setRevoked(null);
      // PIN login remains offline-capable. Online, however, a missing or
      // different cloud actor must be re-linked BEFORE a local session exists.
      // Letting the authenticated navigator mount first makes the authority
      // gate compare the incoming Staff against the outgoing Owner token and
      // persist a false quarantine for an ordinary shared-device handoff.
      const binding = await inspectCloudActorBinding(result);
      let bindingMatches = binding.status === 'matched'
        && binding.actorUserId === result.userId
        && binding.shopId === result.shopId;

      // Asked ONCE and reused by both branches below. Two separate calls can
      // disagree — the radio genuinely drops between them — and a handover
      // that decided it was offline for the switch and online for the relink
      // would bounce a staff member to a phone-number screen for no reason.
      const isOnline = await networkReachability() !== 'offline';

      if (!bindingMatches && isOnline) {
        // A2.3, and the reason this batch exists.
        //
        // A shared pharmacy till hands over between Owner, Manager and Staff
        // all day. Before this, every handover fell through to the relink
        // below and sent the incoming person to /device-login to retype a
        // phone number — which Staff, per Volume 4, are never given. On an
        // installation already registered to this shop, the device secret plus
        // the PIN just verified is enough to mint that person's session, so a
        // handover costs exactly what it looks like it should: four digits.
        //
        // Every failure here falls through to the original relink, so the
        // worst case is precisely the behaviour that shipped before A2.3.
        try {
          const switched = await switchActorOnDevice(result.shopId, result.userId, pin);
          if (switched) {
            const rebound = await inspectCloudActorBinding(result);
            bindingMatches = rebound.status === 'matched'
              && rebound.actorUserId === result.userId
              && rebound.shopId === result.shopId;
            timing?.mark('device_actor_switch');
          }
        } catch (caught) {
          const code = caught instanceof DeviceRegistryError ? caught.code : null;
          if (code === 'device_revoked' || code === 'binding_revoked') {
            // switchActorOnDevice already persisted the attached snapshot and
            // wrote H-10 quarantine before it let this error escape.
            setRevoked(code);
            timing?.mark('device_access_revoked', 'error');
            return;
          }
          // Anything else — an unregistered installation, a rotated secret, a
          // dead network — is not an answer about access. Fall through.
        }
      }

      if (!bindingMatches && isOnline) {
        timing?.mark('cloud_relink_required');
        router.replace({ pathname: '/device-login', params: { role: result.role } });
        return;
      }
      const boundResult = {
        ...result,
        cloudActorConfirmed: bindingMatches,
      };
      markRuntimeDiagnosticStep(
        'authentication_completed',
        sessionDiagnosticContext(boundResult, '/pin-login'),
      );
      await recordSuccessfulLogin(boundResult);
      login(boundResult);
      timing?.mark('session_store_login');
      markRuntimeDiagnosticStep(
        'auth_session_hydrated',
        sessionDiagnosticContext(boundResult, '/pin-login'),
      );
      markRuntimeDiagnosticStep('role_resolved', {
        ...sessionDiagnosticContext(boundResult, '/pin-login'),
        resolvedRole: toRole(boundResult.role) ?? 'unknown',
      });
      handoffAuthTiming(timing);
      router.replace(authenticatedHome(boundResult));
      timing?.mark('navigation_requested');
      markRuntimeDiagnosticStep(
        'router_replace_requested',
        sessionDiagnosticContext(boundResult, '/pin-login'),
      );
    },
    [login],
  );

  const { pin, isSubmitting, handleDigitPress, handleBackspace } = usePinEntry(handleComplete);
  return (
    <View className="flex-1 items-center justify-center gap-8 bg-brand-softGreen p-6">
      <View className="items-center gap-1">
        <Text className="font-sans-bold text-xl text-richBlack">{t('pinEnterTitle')}</Text>
        {isLocked ? (
          <Text className="text-center font-sans text-sm text-error">
            {`${t('pinLockedRetryPrefix')}${formatRetryAfter(remainingMs)}`}
          </Text>
        ) : revoked ? (
          <Text className="text-center font-sans text-sm text-error">
            {t(revoked === 'device_revoked'
              ? 'pinDeviceRevoked'
              : revoked === 'binding_revoked'
                ? 'pinBindingRevoked'
                : 'pinDeviceAuthorityUnreadable')}
          </Text>
        ) : error ? (
          <Text className="font-sans text-sm text-error">{t('pinIncorrect')}</Text>
        ) : null}
        {isSubmitting ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator />
            <Text className="font-sans text-sm text-midGray">{t('pinSigningIn')}</Text>
          </View>
        ) : null}
      </View>
      <PinPad
        value={pin}
        onDigitPress={handleDigitPress}
        onBackspace={handleBackspace}
        error={error || isLocked || revoked !== null}
        disabled={isSubmitting || isLocked}
      />
      {/* H-4. Owner recovery has to be reachable FROM HERE, not only from
          Device Login: a successful PIN no longer refills the attempt budget,
          so an owner who has forgotten theirs can lock the pad and, without
          this, would have no way forward but waiting. The route is the
          existing OTP recovery flow (app/(auth)/forgot-pin.tsx) — no phone
          param, because this pad never asked for one.

          Shown whether or not the pad is locked, and deliberately not
          disabled while it is: the lock is on guessing, not on recovering. */}
      <View className="items-center gap-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('pinRecoveryAction')}
          onPress={() => router.push('/forgot-pin')}
          className="items-center px-4 py-2"
        >
          <Text className="font-sans-semibold text-sm text-brand-green">
            {t('pinRecoveryAction')}
          </Text>
        </Pressable>
        {/* The pad cannot know who is holding the phone, so both audiences are
            addressed: recovery proves an OWNER's phone number, and Volume 4
            gives staff none of their own. */}
        <Text className="text-center font-sans text-xs text-midGray">
          {t('pinRecoveryGuidance')}
        </Text>
      </View>
    </View>
  );
}
