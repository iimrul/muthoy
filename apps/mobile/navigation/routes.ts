import type { Href } from 'expo-router';
import { resolvePermission, type Permission } from '../domain/permissions';
import type { CatalogKey } from '../i18n/catalog';
import type { Session } from '../state/sessionStore';
import {
  DATA_ACCESS_GATES,
  type DataAccessGate,
  type DataAccessGateKey,
} from '../db/dataAccessGates';

export type AuthenticatedHomePath = '/dashboard' | '/staff-home';

export type RouteRule = DataAccessGate;

export const RULES: readonly {
  prefixes: readonly string[];
  dataGate: DataAccessGateKey;
  rule: RouteRule;
}[] = [
  { prefixes: ['/dashboard'], dataGate: 'owner', rule: DATA_ACCESS_GATES.owner },
  { prefixes: ['/staff-home'], dataGate: 'staffHome', rule: DATA_ACCESS_GATES.staffHome },
  { prefixes: ['/sale', '/scan'], dataGate: 'saleEntry', rule: DATA_ACCESS_GATES.saleEntry },
  { prefixes: ['/inventory/add-medicine'], dataGate: 'inventoryEdit', rule: DATA_ACCESS_GATES.inventoryEdit },
  { prefixes: ['/inventory/expiry'], dataGate: 'expiryManage', rule: DATA_ACCESS_GATES.expiryManage },
  { prefixes: ['/inventory'], dataGate: 'inventoryView', rule: DATA_ACCESS_GATES.inventoryView },
  { prefixes: ['/credit'], dataGate: 'creditView', rule: DATA_ACCESS_GATES.creditView },
  { prefixes: ['/cash-summary', '/end-of-day'], dataGate: 'cashDrawer', rule: DATA_ACCESS_GATES.cashDrawer },
  { prefixes: ['/reports/sales-history'], dataGate: 'saleHistory', rule: DATA_ACCESS_GATES.saleHistory },
  { prefixes: ['/reports/report', '/reports/monthly-report'], dataGate: 'reports', rule: DATA_ACCESS_GATES.reports },
  { prefixes: ['/staff/management'], dataGate: 'staffManage', rule: DATA_ACCESS_GATES.staffManage },
  { prefixes: ['/expenses', '/suppliers', '/staff/sales-view', '/reports/data-export'], dataGate: 'owner', rule: DATA_ACCESS_GATES.owner },
  { prefixes: ['/settings'], dataGate: 'owner', rule: DATA_ACCESS_GATES.owner },
  { prefixes: ['/notifications'], dataGate: 'authenticated', rule: DATA_ACCESS_GATES.authenticated },
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

export interface OwnerQuickLink {
  key: string;
  labelKey: CatalogKey;
  href: Href;
}

/** Single registry for the Owner Dashboard's approved 15 Quick Links. */
export const OWNER_QUICK_LINKS: readonly OwnerQuickLink[] = [
  { key: 'sale', labelKey: 'sale', href: '/sale' },
  { key: 'inventory', labelKey: 'inventory', href: '/inventory' },
  { key: 'credit', labelKey: 'credit', href: '/credit/credit-sales' },
  { key: 'expense', labelKey: 'expense', href: '/expenses' },
  { key: 'history', labelKey: 'salesHistory', href: '/reports/sales-history' },
  { key: 'expiry', labelKey: 'expiry', href: '/inventory/expiry' },
  { key: 'invoices', labelKey: 'supplierInvoices', href: '/suppliers/purchase-create' },
  { key: 'suppliers', labelKey: 'suppliers', href: '/suppliers/list' },
  { key: 'report', labelKey: 'report', href: '/reports/report' },
  { key: 'staff', labelKey: 'staffManagement', href: '/staff/management' },
  { key: 'staff-sales', labelKey: 'staffSales', href: '/staff/sales-view' },
  { key: 'export', labelKey: 'dataExport', href: '/reports/data-export' },
  { key: 'printer', labelKey: 'printer', href: '/settings/printer-settings' },
  { key: 'settings', labelKey: 'settings', href: '/settings/settings' },
  { key: 'plans', labelKey: 'plans', href: '/settings/plans' },
];

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
