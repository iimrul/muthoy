import type { NextConfig } from 'next';

// @muthoy/* workspace packages ship raw TypeScript (their `main` is src/index.ts),
// so Next must compile them rather than treat them as pre-built node_modules.
const nextConfig: NextConfig = {
  transpilePackages: ['@muthoy/constants', '@muthoy/types', '@muthoy/utils'],
  reactStrictMode: true,
  poweredByHeader: false,
  // The panel has write buttons behind a session, so no other page may frame
  // it (clickjacking). SameSite=Strict already stops other SITES; this also
  // stops a sibling origin on the same site. frame-ancestors is the only CSP
  // directive set, deliberately: it restricts no script or style.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
