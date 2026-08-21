import type { Href } from 'expo-router';
import { resolvePermission, type Permission } from '../domain/permissions';
import type { Session } from '../state/sessionStore';

export type AuthenticatedHomePath = '/dashboard' | '/staff-home';

export type RouteRule = { kind: 'authenticated' } | { kind: 'owner' } | { kind: 'staffHome' } | { kind: 'permission'; permission: Permission };

const RULES: readonly { prefixes: readonly string[]; rule: RouteRule }[] = [
  { prefixes: ['/dashboard'], rule: { kind: 'owner' } },
  { prefixes: ['/staff-home'], rule: { kind: 'staffHome' } },
  { prefixes: ['/sale', '/scan'], rule: { kind: 'permission', permission: 'sale_entry' } },
  { prefixes: ['/inventory/add-medicine'], rule: { kind: 'permission', permission: 'inventory_edit' } },
  { prefixes: ['/inventory/expiry'], rule: { kind: 'permission', permission: 'expiry_manage' } },
  { prefixes: ['/inventory'], rule: { kind: 'permission', permission: 'inventory_view' } },
  { prefixes: ['/credit'], rule: { kind: 'permission', permission: 'credit_view' } },
  { prefixes: ['/cash-summary', '/end-of-day'], rule: { kind: 'permission', permission: 'cash_drawer' } },
  { prefixes: ['/reports/sales-history'], rule: { kind: 'permission', permission: 'sale_history' } },
  { prefixes: ['/reports/report', '/reports/monthly-report'], rule: { kind: 'permission', permission: 'reports' } },
  { prefixes: ['/staff/management'], rule: { kind: 'permission', permission: 'staff_manage' } },
  { prefixes: ['/expenses', '/suppliers', '/staff/sales-view', '/reports/data-export'], rule: { kind: 'owner' } },
  { prefixes: ['/settings'], rule: { kind: 'owner' } },
  { prefixes: ['/notifications'], rule: { kind: 'authenticated' } },
];

const AUTH_PREFIXES = ['/role-select', '/register', '/otp-verify', '/pin-setup', '/pin-login', '/forgot-pin', '/device-login'];

/** The only role-to-authenticated-home mapping used by startup, login, and guards. */
export function authenticatedHome(
  actor: Pick<Session, 'role'>,
): AuthenticatedHomePath {
  return actor.role === 'owner' ? '/dashboard' : '/staff-home';
}

/**
 * Corrects only authenticated home-route mismatches. The root startup gate owns
 * `/`, so a live session is never bounced through `/` to fix the wrong home.
 */
export function authenticatedHomeCorrection(
  actor: Pick<Session, 'role'>,
  pathname: string,
): AuthenticatedHomePath | null {
  if (pathname !== '/dashboard' && pathname !== '/staff-home') return null;
  const home = authenticatedHome(actor);
  return pathname === home ? null : home;
}

export function isAuthPath(pathname: string): boolean {
  return pathname === '/' || AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function ruleForPath(pathname: string): RouteRule | null {
  for (const entry of RULES) {
    if (entry.prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return entry.rule;
  }
  return isAuthPath(pathname) ? null : { kind: 'authenticated' };
}

export function canAccessRule(session: Session | null, rule: RouteRule | null): boolean {
  if (!rule) return true;
  if (!session) return false;
  if (rule.kind === 'authenticated') return true;
  if (rule.kind === 'owner') return session.role === 'owner';
  if (rule.kind === 'staffHome') return session.role === 'staff' || session.role === 'manager';
  return resolvePermission(session.role, rule.permission, session.permissions);
}

export function canAccessPath(session: Session | null, pathname: string): boolean {
  return canAccessRule(session, ruleForPath(pathname));
}

export interface MoreRoute {
  key: string;
  labelKey: 'salesHistory' | 'expiry' | 'cashDrawer' | 'endOfDay' | 'report' | 'expense' | 'supplierInvoices' | 'suppliers' | 'staff' | 'staffSales' | 'multiShop';
  href: Href;
  permission?: Permission;
  ownerOnly?: boolean;
  multiShopOnly?: boolean;
}

export const MORE_ROUTES: readonly MoreRoute[] = [
  { key: 'history', labelKey: 'salesHistory', href: '/reports/sales-history', permission: 'sale_history' },
  { key: 'expiry', labelKey: 'expiry', href: '/inventory/expiry', permission: 'expiry_manage' },
  { key: 'cash', labelKey: 'cashDrawer', href: '/cash-summary', permission: 'cash_drawer' },
  { key: 'eod', labelKey: 'endOfDay', href: '/end-of-day', permission: 'cash_drawer' },
  { key: 'report', labelKey: 'report', href: '/reports/report', permission: 'reports' },
  { key: 'expense', labelKey: 'expense', href: '/expenses', ownerOnly: true },
  { key: 'invoices', labelKey: 'supplierInvoices', href: '/suppliers/purchase-create', ownerOnly: true },
  { key: 'suppliers', labelKey: 'suppliers', href: '/suppliers/list', ownerOnly: true },
  { key: 'staff', labelKey: 'staff', href: '/staff/management', permission: 'staff_manage' },
  { key: 'staff-sales', labelKey: 'staffSales', href: '/staff/sales-view', ownerOnly: true },
  { key: 'multi-shop', labelKey: 'multiShop', href: '/settings/plans', ownerOnly: true, multiShopOnly: true },
];

export function visibleMoreRoutes(session: Session, hasMultipleShops = false): readonly MoreRoute[] {
  return MORE_ROUTES.filter((route) => {
    if (route.multiShopOnly && !hasMultipleShops) return false;
    if (session.role === 'owner') return true;
    if (route.ownerOnly) return false;
    return route.permission ? resolvePermission(session.role, route.permission, session.permissions) : false;
  });
}
