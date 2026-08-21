import { describe, expect, it } from 'vitest';
import {
  authenticatedHome,
  authenticatedHomeCorrection,
  canAccessPath,
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
  it('guards scan and deep links by exact permission', () => { expect(canAccessPath(cashier, '/scan')).toBe(true); expect(canAccessPath({ ...cashier, permissions: { sale_entry: false } }, '/scan')).toBe(false); expect(canAccessPath(cashier, '/reports/report')).toBe(false); expect(canAccessPath(manager, '/reports/report')).toBe(true); });
  it('uses exact More visibility/order', () => { expect(visibleMoreRoutes(cashier).map((item) => item.key)).toEqual([]); expect(visibleMoreRoutes(manager).map((item) => item.key)).toEqual(['history','expiry','cash','eod','report']); expect(visibleMoreRoutes(owner).map((item) => item.key)).toEqual(['history','expiry','cash','eod','report','expense','invoices','suppliers','staff','staff-sales']); });
});
