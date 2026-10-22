import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DM_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import Link from 'next/link';
import './globals.css';
import { currentAdminSession } from '../lib/adminAuthz';

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

const NAV_LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/pharmacies', label: 'Pharmacies' },
] as const;

async function signedInAs(): Promise<{ username: string; role: string } | null> {
  try {
    const session = await currentAdminSession();
    return { username: session.username, role: session.role };
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

  return (
    <html lang="en" className={`${plusJakartaSans.variable} ${dmMono.variable}`}>
      <body className="min-h-screen bg-white font-sans text-richBlack antialiased">
        <header className="border-b border-black/10">
          <nav className="mx-auto flex w-full max-w-5xl items-center gap-6 px-6 py-4">
            <span className="font-semibold text-brand-deepGreen">Muthoy Admin</span>
            {signedIn
              ? NAV_LINKS.map((link) => (
                  <Link key={link.href} href={link.href} className="text-sm text-midGray hover:text-richBlack">
                    {link.label}
                  </Link>
                ))
              : null}
            {signedIn ? (
              <div className="ml-auto flex items-center gap-3">
                <span className="text-xs text-midGray">
                  {signedIn.username} · {signedIn.role}
                </span>
                <form method="post" action="/api/admin/session">
                  <input type="hidden" name="intent" value="logout" />
                  <input type="hidden" name="username" value={signedIn.username} />
                  <button type="submit" className="text-sm text-midGray underline hover:text-richBlack">
                    Sign out
                  </button>
                </form>
              </div>
            ) : null}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
