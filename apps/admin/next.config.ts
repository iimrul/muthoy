import type { NextConfig } from 'next';

// @muthoy/* workspace packages ship raw TypeScript (their `main` is src/index.ts),
// so Next must compile them rather than treat them as pre-built node_modules.
const nextConfig: NextConfig = {
  transpilePackages: ['@muthoy/constants', '@muthoy/types', '@muthoy/utils'],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
