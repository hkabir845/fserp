/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Dev: keep more compiled pages in memory longer so switching routes recompiles less often
  // (helpful with many App Router pages; uses a bit more RAM).
  onDemandEntries: {
    maxInactiveAge: 60 * 1000,
    pagesBufferLength: 8,
  },
  // Security headers: use `src/middleware.ts` with a matcher that excludes `/_next/static/*`.
  // A `headers()` regex here has caused dev 404s for chunks/CSS in some Next versions.
  env: {
    API_URL: process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'https://api.mahasoftcorporation.com',
    WS_URL: process.env.WS_URL || process.env.NEXT_PUBLIC_WS_URL || 'wss://api.mahasoftcorporation.com',
  },
  // Production static/CSS: ensure your server or reverse proxy forwards /_next/* to the Next server.
  // If the app is at a subpath (e.g. example.com/app), set basePath: '/app'.
  // Only set assetPrefix when using a CDN for static assets.
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      config.optimization = { ...config.optimization, minimize: false }
    }
    return config
  },
}

export default nextConfig
