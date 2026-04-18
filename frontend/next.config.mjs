import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Fail `next build` if public URLs still point at loopback — avoids shipping a bundle that
 * calls the user's machine from a VPS deployment.
 */
function assertProductionBuildUsesNonLoopbackPublicUrls() {
  if (process.env.NODE_ENV !== 'production') return
  if (!process.argv.includes('build')) return
  const check = (key) => {
    const v = process.env[key]
    if (v == null || !String(v).trim()) return
    const s = String(v).toLowerCase()
    if (
      s.includes('localhost') ||
      s.includes('127.0.0.1') ||
      s.includes('[::1]') ||
      s.includes('://0.0.0.0')
    ) {
      throw new Error(
        `[next.config] ${key}=${v} must not use localhost/loopback in a production build. ` +
          'Use your public API host (see frontend/.env). For local Django, use `next dev` with frontend/.env.development only.',
      )
    }
  }
  check('NEXT_PUBLIC_API_BASE_URL')
  check('NEXT_PUBLIC_API_URL')
  check('NEXT_PUBLIC_WS_URL')
}
assertProductionBuildUsesNonLoopbackPublicUrls()

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Dev: keep more compiled pages in memory longer so switching routes recompiles less often
  // (helpful with many App Router pages; uses a bit more RAM).
  onDemandEntries: {
    maxInactiveAge: 60 * 1000,
    pagesBufferLength: 8,
  },
  // Security headers: use `src/proxy.ts` with a matcher that excludes `/_next/static/*`.
  // A `headers()` regex here has caused dev 404s for chunks/CSS in some Next versions.
  env: {
    API_URL:
      process.env.API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'https://localhost:3000 ',
    WS_URL: process.env.WS_URL || process.env.NEXT_PUBLIC_WS_URL || 'wss://api.mahasoftcorporation.com',
  },
  // Production static/CSS: ensure your server or reverse proxy forwards /_next/* to the Next server.
  // If the app is at a subpath (e.g. example.com/app), set basePath: '/app'.
  // Only set assetPrefix when using a CDN for static assets.
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  // Next.js 16+ defaults to Turbopack for `next build`; a custom `webpack` hook without a
  // Turbopack equivalent triggers a hard error. Dev fast-refresh is fine without disabling minimize.
  // Pin app root when a parent folder also has package-lock.json (monorepo-style clone).
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig
