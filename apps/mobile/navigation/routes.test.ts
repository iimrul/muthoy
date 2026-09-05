import { describe, expect, it } from 'vitest';
import {
  authenticatedHome,
  authenticatedHomeCorrection,
  canAccessPath,
  MORE_ROUTES,
  MULTI_SHOP_HREF,
  OWNER_QUICK_LINKS,
  visibleMoreRoutes,
} from './routes';
import { PERMISSION_PRESETS } from '../domain/permissions';
import type { Session } from '../state/sessionStore';

const owner: Session = { shopId: 's', userId: 'o', role: 'owner' };
const cashier: Session = { shopId: 's', userId: 'c', role: 'staff', permissions: PERMISSION_PRESETS.cashier };
const manager: Session = { shopId: 's', userId: 'm', role: 'manager', permissions: PERMISSION_PRESETS.manager };

describe('B1 routes', () => {
  it('maps exact role homes', () => { expect(authenticatedHome(owner)).toBe('/dashboard'); expect(authenticatedHome(cashier)).toBe('/staff-home'); expect(authenticatedHome(manager)).toBe('/staff-home'); });
  it.each([
    ['Staff', cashier, '/', '/staff-home'],
    ['Manager', manager, '/', '/staff-home'],
    ['Owner', owner, '/', '/dashboard'],
  ] as const)('%s settles from / on its canonical home in one redirect', (_label, session, start, expected) => {
    const first = start === '/' ? authenticatedHome(session) : authenticatedHomeCorrection(session, start);
    expect(first).toBe(expected);
    if (!first) throw new Error('Expected an authenticated home');
    expect(authenticatedHomeCorrection(session, first)).toBeNull();
  });
  it('corrects a wrong home directly without a cycle through /', () => {
    expect(authenticatedHomeCorrection(cashier, '/dashboard')).toBe('/staff-home');
    expect(authenticatedHomeCorrection(manager, '/dashboard')).toBe('/staff-home');
    expect(authenticatedHomeCorrection(owner, '/staff-home')).toBe('/dashboard');
    expect(authenticatedHomeCorrection(cashier, '/staff-home')).toBeNull();
    expect(authenticatedHomeCorrection(manager, '/staff-home')).toBeNull();
    expect(authenticatedHomeCorrection(owner, '/dashboard')).toBeNull();
  });
  it('guards owner and staff homes', () => { expect(canAccessPath(owner, '/dashboard')).toBe(true); expect(canAccessPath(manager, '/dashboard')).toBe(false); expect(canAccessPath(manager, '/staff-home')).toBe(true); expect(canAccessPath(owner, '/staff-home')).toBe(false); });
  it('guards the canonical Multi-Shop route without a home redirect loop', () => {
    expect(MULTI_SHOP_HREF).toBe('/multi-shop');
    expect(canAccessPath(owner, MULTI_SHOP_HREF)).toBe(true);
    expect(canAccessPath(cashier, MULTI_SHOP_HREF)).toBe(false);
    expect(canAccessPath(manager, MULTI_SHOP_HREF)).toBe(false);
    expect(authenticatedHomeCorrection(owner, MULTI_SHOP_HREF)).toBeNull();
    expect(MORE_ROUTES.find((route) => route.key === 'multi-shop')?.href).toBe(MULTI_SHOP_HREF);
  });
  it('guards scan and deep links by exact permission', () => { expect(canAccessPath(cashier, '/scan')).toBe(true); expect(canAccessPath({ ...cashier, permissions: { sale_entry: false } }, '/scan')).toBe(false); expect(canAccessPath(cashier, '/reports/report')).toBe(false); expect(canAccessPath(manager, '/reports/report')).toBe(true); });
  it('uses exact More visibility/order', () => { expect(visibleMoreRoutes(cashier).map((item) => item.key)).toEqual([]); expect(visibleMoreRoutes(manager).map((item) => item.key)).toEqual(['history','expiry','cash','eod','report']); expect(visibleMoreRoutes(owner).map((item) => item.key)).toEqual(['history','expiry','cash','eod','report','expense','invoices','suppliers','staff','staff-sales']); expect(visibleMoreRoutes(owner, true).map((item) => item.key)).toEqual(['history','expiry','cash','eod','report','expense','invoices','suppliers','staff','staff-sales','multi-shop']); });
  it('keeps the approved Owner Quick Links in one exact registry', () => {
    expect(OWNER_QUICK_LINKS.map((item) => [item.labelKey, item.href])).toEqual([
      ['sale', '/sale'],
      ['inventory', '/inventory'],
      ['credit', '/credit/credit-sales'],
      ['expense', '/expenses'],
      ['salesHistory', '/reports/sales-history'],
      ['expiry', '/inventory/expiry'],
      ['supplierInvoices', '/suppliers/invoices'],
      ['suppliers', '/suppliers/list'],
      ['report', '/reports/report'],
      ['staffManagement', '/staff/management'],
      ['staffSales', '/staff/sales-view'],
      ['dataExport', '/reports/data-export'],
      ['printer', '/settings/printer-settings'],
      ['settings', '/settings/settings'],
      ['plans', '/settings/plans'],
    ]);
  });
});
