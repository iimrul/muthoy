import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { router, usePathname } from "expo-router";
import { AccessDenied } from "../ui/AccessDenied";
import { DashboardLoadState } from "../staff/DashboardLoadState";
import {
  markRuntimeDiagnosticStep,
  sessionDiagnosticContext,
} from "../../dev/runtimeDiagnostics";
import {
  authenticatedHome,
  authenticatedHomeCorrection,
  canAccessPath,
  isAuthPath,
} from "../../navigation/routes";
import { useI18n } from "../../state/localeStore";
import { useSessionStore } from "../../state/sessionStore";
import { usePlan } from "../../state/usePlan";
import { PremiumLock } from "../ui/PremiumLock";
import { premiumAccessStatus, type PremiumFeature } from "../../domain/entitlements";

export function premiumFeatureForPath(pathname: string): PremiumFeature | null {
  if (pathname === '/expenses') return 'expenses';
  if (pathname.startsWith('/suppliers/invoices') || pathname.startsWith('/suppliers/invoice-detail') || pathname.startsWith('/suppliers/purchase-create')) return 'supplier_invoices';
  if (pathname.startsWith('/reports/data-export')) return 'export';
  if (pathname.startsWith('/reports/report') || pathname.startsWith('/reports/monthly-report')) return 'reports';
  if (pathname.startsWith('/settings/printer-settings')) return 'printer';
  if (pathname === '/multi-shop' || pathname.startsWith('/multi-shop/') || pathname.startsWith('/settings/multi-shop')) return 'multi_shop';
  return null;
}

function subscribeToSessionHydration(onStoreChange: () => void): () => void {
  const stopHydrating = useSessionStore.persist.onHydrate(onStoreChange);
  const stopHydrated = useSessionStore.persist.onFinishHydration(onStoreChange);
  return () => {
    stopHydrating();
    stopHydrated();
  };
}

function readSessionHydration(): boolean {
  return useSessionStore.persist.hasHydrated();
}

export function NavigationBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const session = useSessionStore((state) => state.session);
  const plan = usePlan();
  const { t } = useI18n();
  const isHydrated = useSyncExternalStore(
    subscribeToSessionHydration,
    readSessionHydration,
    readSessionHydration,
  );
  const needsLogin = isHydrated && !session && !isAuthPath(pathname);
  const homeCorrection =
    isHydrated && session
      ? authenticatedHomeCorrection(session, pathname)
      : null;

  useEffect(() => {
    if (needsLogin) {
      router.replace("/");
      return;
    }
    if (homeCorrection) router.replace(homeCorrection);
  }, [homeCorrection, needsLogin]);

  useEffect(() => {
    if (isHydrated) {
      markRuntimeDiagnosticStep(
        "navigation_session_hydrated",
        sessionDiagnosticContext(session, pathname),
      );
    }
  }, [isHydrated, pathname, session]);

  // Every branch below is an OVERLAY, never a replacement for `children`.
  //
  // `children` is the app's single <Stack /> navigator. Returning anything else
  // in its place unmounts that navigator, and React Navigation drops the route
  // state it owns — so the next render restarts the Stack at its initial route,
  // `/`, whose gate redirects to the authenticated home. On a real device that
  // reads exactly like a reload: tap Multi-Shop, the entitlement read resolves
  // one tick later, and you are back on the Dashboard. Keeping the navigator
  // mounted and covering it is what makes a guarded push actually land.
  const gate = !isHydrated || needsLogin || homeCorrection ? (
    <DashboardLoadState
      loading
      message={t("sessionLoading")}
      retryLabel={t("retry")}
      onRetry={() => router.replace("/")}
    />
  ) : session && !canAccessPath(session, pathname) ? (
    <AccessDenied homeHref={authenticatedHome(session)} />
  ) : null;

  const premiumFeature = gate ? null : premiumFeatureForPath(pathname);
  const premiumStatus = premiumAccessStatus(plan, premiumFeature);
  const blocked = Boolean(gate) || premiumStatus !== "open";

  return (
    <View className="flex-1">
      {/*
        Blocked does not mean unmounted — but it does mean unreachable. The
        cover alone would still leave the screen underneath touchable at its
        edges and, worse, fully reachable to TalkBack/VoiceOver, which walk the
        view tree rather than the pixels. pointerEvents kills touch;
        importantForAccessibility (Android) and accessibilityElementsHidden
        (iOS) take the subtree out of the accessibility tree entirely.
      */}
      <View
        className="flex-1"
        pointerEvents={blocked ? "none" : "auto"}
        importantForAccessibility={blocked ? "no-hide-descendants" : "auto"}
        accessibilityElementsHidden={blocked}
      >
        {children}
      </View>
      {gate ? (
        <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
          {gate}
        </View>
      ) : null}
      {premiumStatus === "loading" ? (
        <View
          style={StyleSheet.absoluteFill}
          accessibilityViewIsModal
          className="items-center justify-center bg-brand-softGreen"
        >
          <ActivityIndicator color="#059669" />
        </View>
      ) : null}
      {premiumStatus === "locked" && premiumFeature ? (
        <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
          <PremiumLock feature={premiumFeature} />
        </View>
      ) : null}
    </View>
  );
}
