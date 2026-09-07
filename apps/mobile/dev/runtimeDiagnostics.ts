import {
  PERMISSION_KEYS,
  resolvePermission,
  toRole,
  type Role,
} from "../domain/permissions";
import type { Session } from "../state/sessionStore";

export interface RuntimeDiagnosticContext {
  currentRoute?: string;
  userId?: string;
  shopId?: string;
  resolvedRole?: Role | "unknown";
  permissionCount?: number;
}

export interface RuntimeDiagnosticSnapshot {
  errorMessage?: string;
  stack?: string;
  currentRoute: string;
  userId: string;
  shopId: string;
  resolvedRole: Role | "unknown";
  permissionCount: number;
  lastCompletedStep: string;
}

const EMPTY_SNAPSHOT: RuntimeDiagnosticSnapshot = {
  currentRoute: "unknown",
  userId: "none",
  shopId: "none",
  resolvedRole: "unknown",
  permissionCount: 0,
  lastCompletedStep: "none",
};

let latestSnapshot = EMPTY_SNAPSHOT;

export function isRuntimeDiagnosticsEnabled(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

/**
 * Session breadcrumbs for the physical login path — DEV builds only.
 *
 * Production returns an EMPTY context rather than a populated one that merely
 * goes unlogged. Every entry point below funnels through this, so a release
 * build never assembles a user id, shop id, role, or permission count into a
 * diagnostic object at all: there is nothing for a future caller to print,
 * render, or hand to a crash reporter by accident. H-8 will add deliberate
 * observability; until then production emits nothing from this module.
 */
export function sessionDiagnosticContext(
  session: Session | null,
  currentRoute?: string,
): RuntimeDiagnosticContext {
  if (!isRuntimeDiagnosticsEnabled()) return {};
  const role = session ? toRole(session.role) : null;
  return {
    currentRoute,
    userId: session?.userId ?? "none",
    shopId: session?.shopId ?? "none",
    resolvedRole: role ?? "unknown",
    permissionCount: role
      ? PERMISSION_KEYS.filter((permission) =>
          resolvePermission(role, permission, session?.permissions),
        ).length
      : 0,
  };
}

function mergeContext(
  context: RuntimeDiagnosticContext,
): RuntimeDiagnosticSnapshot {
  return {
    ...latestSnapshot,
    ...(context.currentRoute ? { currentRoute: context.currentRoute } : {}),
    ...(context.userId ? { userId: context.userId } : {}),
    ...(context.shopId ? { shopId: context.shopId } : {}),
    ...(context.resolvedRole
      ? { resolvedRole: context.resolvedRole }
      : {}),
    ...(context.permissionCount !== undefined
      ? { permissionCount: context.permissionCount }
      : {}),
  };
}

/** DEV-only, credential-free breadcrumbs for the physical login path. */
export function markRuntimeDiagnosticStep(
  step: string,
  context: RuntimeDiagnosticContext = {},
): void {
  if (!isRuntimeDiagnosticsEnabled()) return;
  latestSnapshot = {
    ...mergeContext(context),
    errorMessage: undefined,
    stack: undefined,
    lastCompletedStep: step,
  };
  console.log("[staff-home:diagnostic-step]", latestSnapshot);
}

export function runtimeDiagnosticError(
  error: unknown,
  context: RuntimeDiagnosticContext = {},
  fallbackStack?: string,
): RuntimeDiagnosticSnapshot {
  if (!isRuntimeDiagnosticsEnabled()) return EMPTY_SNAPSHOT;
  const normalized =
    error instanceof Error ? error : new Error(String(error));
  const snapshot: RuntimeDiagnosticSnapshot = {
    ...mergeContext(context),
    errorMessage: normalized.message,
    stack: normalized.stack ?? fallbackStack,
  };
  console.log("[staff-home:runtime-error]", snapshot);
  return snapshot;
}

export function getRuntimeDiagnosticSnapshot(
  context: RuntimeDiagnosticContext = {},
): RuntimeDiagnosticSnapshot {
  if (!isRuntimeDiagnosticsEnabled()) return EMPTY_SNAPSHOT;
  return mergeContext(context);
}
