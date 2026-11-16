import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { DM_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import Link from 'next/link';
import './globals.css';
import { currentAdminSession } from '../lib/adminAuthz';
import AdminNavigation from '../components/AdminNavigation';
import AppearanceControls from '../components/AppearanceControls';
import { APPEARANCE_COOKIE, appearanceAttributes, parseAppearance } from '../theme/appearance';

// W4-06. The shell shows WHO is signed in and offers the sign-out the shared
// Basic Auth credential never had (a browser cannot be told to forget one).
// The session read is OPTIONAL here: /login renders this layout too, and it
// must render for a visitor who has no session at all.

// CLAUDE.md rule 6: money renders in DM Mono, every other number in Plus
// Jakarta Sans. next/font gives each family a CSS VARIABLE that
// tailwind.config.js binds to font-mono / font-sans, so no component ever
// hardcodes a font name.
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plus-jakarta-sans',
  display: 'swap',
});

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-dm-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Muthoy Admin',
  description: 'Platform admin panel for Muthoy POS.',
  // Internal tool behind an auth gate — never worth indexing.
  robots: { index: false, follow: false },
};

// W4-07. Each link declares the permission its page REQUIRES, and the shell
// hides the ones this session cannot use. That is presentation, NOT the gate:
// the page itself calls requireAdminPermission as its first statement, so
// typing the URL directly is refused server-side regardless of what the nav
// shows.
//
// Batch 3 §4.3: the filter reads the session's EFFECTIVE permission set, not
// hasPermission(role). Asking the role would show a narrowed account links its
// assignment row has already taken away — every one of which the page would
// then refuse, which is a worse experience than not offering them.
// Batch 3 §8: EXACTLY ELEVEN entries, one per page the brief names.
//
// `/accounts` and `/payments` are deliberately NOT here. Both remain real,
// reachable routes and neither lost any functionality — `/payments` is the
// order-level view linked from Revenue & Billing (§8.4) and `/accounts/[id]`
// is linked from the pharmacy drill-down. They leave the top-level nav because
// the brief asks for eleven pages, and a nav of thirteen would make two of them
// look like pages the acceptance matrix had forgotten.
const NAV_LINKS = [
  { href: '/', label: 'Dashboard', permission: 'shops.read' },
  { href: '/pharmacies', label: 'Pharmacies', permission: 'shops.read' },
  { href: '/subscriptions', label: 'Subscriptions', permission: 'subscriptions.read' },
  { href: '/revenue', label: 'Revenue', permission: 'revenue.read' },
  { href: '/analytics', label: 'Analytics', permission: 'analytics.read' },
  { href: '/maps', label: 'Maps', permission: 'maps.read' },
  { href: '/support', label: 'Support', permission: 'support.read' },
  { href: '/admins', label: 'Admins', permission: 'admins.read' },
  { href: '/audit', label: 'Audit', permission: 'audit.read' },
  { href: '/reports', label: 'Reports', permission: 'reports.read' },
  { href: '/settings', label: 'Settings', permission: 'settings.read' },
] as const;

interface SignedIn {
  username: string;
  role: string;
  /** Batch 3 §4.3: the EFFECTIVE set, so a narrowed account's nav narrows too. */
  permissions: readonly string[];
}

async function signedInAs(): Promise<SignedIn | null> {
  try {
    const session = await currentAdminSession();
    return {
      username: session.username,
      role: session.role,
      permissions: session.permissions,
    };
  } catch {
    // No session, an ended one, or an unconfigured panel. The middleware
    // decides what happens to the request; the shell just shows less.
    return null;
  }
}

interface RootLayoutProps {
  children: ReactNode;
}

export default async function RootLayout({ children }: RootLayoutProps) {
  const signedIn = await signedInAs();
  // The saved appearance is applied HERE, on the server: see theme/appearance.ts
  // for why there is no inline script any more.
  const appearance = parseAppearance((await cookies()).get(APPEARANCE_COOKIE)?.value);

  return (
    <html lang="en" {...appearanceAttributes(appearance)} className={`${plusJakartaSans.variable} ${dmMono.variable}`}>
      <body className="min-h-screen bg-canvas font-sans text-richBlack antialiased">
        <a href="#main-content" className="admin-skip-link">Skip to content</a>
        <div className={signedIn ? 'admin-shell' : 'admin-public-shell'}>
          <aside className="admin-sidebar" aria-label="Platform console">
            <Link href="/" prefetch={false} className="admin-brand">
              <span aria-hidden="true" className="admin-brand-symbol">m</span>
              <span>Muthoy Admin<span className="admin-brand-caption">Platform console</span></span>
            </Link>
            {signedIn ? (
              <>
                <p className="admin-nav-caption">Workspace</p>
                <AdminNavigation links={NAV_LINKS.filter((link) => signedIn.permissions.includes(link.permission))} />
                <p className="admin-sidebar-footer">Muthoy POS · Bangladesh</p>
              </>
            ) : null}
          </aside>
          <div className="min-w-0">
            {signedIn ? (
              <header className="admin-topbar">
                <p className="text-sm font-medium text-brand-deepGreen">Administration</p>
                <AppearanceControls initial={appearance} />
                <div className="admin-account">
                  <div className="min-w-0 text-right">
                    <p className="break-words text-sm font-semibold">{signedIn.username}</p>
                    <p className="text-xs text-midGray">{signedIn.role.replaceAll('_', ' ')}</p>
                  </div>
                  <form method="post" action="/api/admin/session">
                    <input type="hidden" name="intent" value="logout" />
                    <input type="hidden" name="username" value={signedIn.username} />
                    <button type="submit" title="Ends this and your older sessions. Newer sign-ins remain active." className="admin-sign-out">
                      Sign out
                    </button>
                  </form>
                </div>
              </header>
            ) : null}
            {!signedIn ? <div className="admin-public-appearance"><AppearanceControls initial={appearance} /></div> : null}
            <main id="main-content" tabIndex={-1} className="admin-content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
