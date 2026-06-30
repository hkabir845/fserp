'use client'

/** Explains dev-only slowness (Next compile, single Django on :8000). */
export function DevEnvironmentBanner() {
  if (process.env.NODE_ENV !== 'development') return null

  return (
    <div className="border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-center text-xs text-warning-foreground">
      <strong>Dev mode.</strong> First load per route compiles in Next (often 10–60s). Run one Django via{' '}
      <code className="rounded bg-amber-100 px-1">backend\run-dev.bat</code> and use{' '}
      <code className="rounded bg-amber-100 px-1">npm run dev</code> (Webpack; use{' '}
      <code className="rounded bg-amber-100 px-1">npm run dev:turbo</code> if you prefer Turbopack).
    </div>
  )
}
