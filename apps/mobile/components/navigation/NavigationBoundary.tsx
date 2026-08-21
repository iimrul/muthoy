import { useEffect, useSyncExternalStore, type ReactNode } from "react";
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

  if (!isHydrated || needsLogin || homeCorrection)
    return (
      <DashboardLoadState
        loading
        message={t("sessionLoading")}
        retryLabel={t("retry")}
        onRetry={() => router.replace("/")}
      />
    );
  if (session && !canAccessPath(session, pathname))
    return <AccessDenied homeHref={authenticatedHome(session)} />;
  return <>{children}</>;
}
