import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Security headers for HTML/app routes only. Must not run for `/_next/static/*` or assets
 * break with 404 / wrong MIME (see next.config.mjs comment).
 * Next.js 16+: use `proxy` (replaces `middleware`).
 */
export function proxy(_request: NextRequest) {
  const res = NextResponse.next()
  res.headers.set('X-Frame-Options', 'SAMEORIGIN')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  return res
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|_next/webpack-hmr|favicon.ico|manifest.json|.*\\..*).*)',
  ],
}
