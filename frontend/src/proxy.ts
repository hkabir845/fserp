import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Security headers for HTML/app routes only. Must not run for `/_next/static/*` or assets
 * break with 404 / wrong MIME (see next.config.mjs comment).
 */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const res = NextResponse.next()
  res.headers.set('X-Frame-Options', 'SAMEORIGIN')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  const path = request.nextUrl.pathname
  const isBrainApp = path === '/brain-app' || path.startsWith('/brain-app/')
  res.headers.set(
    'Permissions-Policy',
    isBrainApp ? 'camera=(), microphone=(self), geolocation=()' : 'camera=(), microphone=(), geolocation=()',
  )
  return res
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|_next/webpack-hmr|favicon.ico|manifest.json|.*\\..*).*)',
  ],
}
