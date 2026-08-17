import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DM_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

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

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className={`${plusJakartaSans.variable} ${dmMono.variable}`}>
      <body className="min-h-screen bg-white font-sans text-richBlack antialiased">
        <header className="border-b border-black/10">
          <nav className="mx-auto flex w-full max-w-5xl items-center gap-6 px-6 py-4">
            <span className="font-semibold text-brand-deepGreen">Muthoy Admin</span>
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="text-sm text-midGray hover:text-richBlack">
                {link.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
