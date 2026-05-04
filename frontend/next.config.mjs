import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const _PROD_PUBLIC_API_KEYS = ['NEXT_PUBLIC_API_BASE_URL', 'NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_WS_URL']

/** Minimal KEY=VALUE parser for committed env files (no multiline values). */
function parseDotEnvFile(filePath) {
  let text = ''
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch {
    return {}
  }
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    out[k] = v
  }
  return out
}

function _isLoopbackUrlString(v) {
  const s = String(v).toLowerCase()
  return (
    s.includes('localhost') ||
    s.includes('127.0.0.1') ||
    s.includes('[::1]') ||
    s.includes('://0.0.0.0')
  )
}

/**
 * Next merges `.env.local` over `.env.production` for `next build`, so a dev-only localhost
 * API URL in `.env.local` can incorrectly ship in production. For `next build` only, re-apply
 * non-loopback values from `.env.production` / `.env.production.local` so committed prod URLs win.
 */
function reapplyProductionPublicApiUrlsFromCommittedEnvFiles() {
  if (process.env.NODE_ENV !== 'production') return
  if (!process.argv.includes('build')) return
  const merged = {
    ...parseDotEnvFile(path.join(__dirname, '.env.production')),
    ...parseDotEnvFile(path.join(__dirname, '.env.production.local')),
  }
  for (const key of _PROD_PUBLIC_API_KEYS) {
    const v = merged[key]
    if (v == null || !String(v).trim()) continue
    if (!_isLoopbackUrlString(v)) {
      process.env[key] = String(v).trim()
    }
  }
}
reapplyProductionPublicApiUrlsFromCommittedEnvFiles()

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
    if (_isLoopbackUrlString(v)) {
      throw new Error(
        `[next.config] ${key}=${v} must not use localhost/loopback in a production build. ` +
          'Use your public API host in `.env.production` (or `.env.production.local`). ' +
          'For local Django, use `next dev` with `frontend/.env.development` only — not loopback in `.env.local` for production builds.',
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
      'https://api.mahasoftcorporation.com',
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
