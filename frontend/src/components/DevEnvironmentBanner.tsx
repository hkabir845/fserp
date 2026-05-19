'use client'

/** Explains dev-only slowness (Next compile, single Django on :8000). */
export function DevEnvironmentBanner() {
  if (process.env.NODE_ENV !== 'development') return null

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-center text-xs text-amber-900">
      <strong>Dev mode.</strong> First load per route compiles in Next (often 10–60s). Run one Django via{' '}
      <code className="rounded bg-amber-100 px-1">backend\run-dev.bat</code> and use{' '}
      <code className="rounded bg-amber-100 px-1">npm run dev</code> (Turbopack).
    </div>
  )
}
