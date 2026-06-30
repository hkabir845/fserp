'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Route error:', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40">
      <div className="px-4 py-8 text-center sm:p-8">
        <h1 className="text-2xl font-bold text-destructive mb-4">Something went wrong</h1>
        <p className="text-muted-foreground mb-4">
          This page could not be loaded. Try again or return to the dashboard.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="px-4 py-2 bg-primary text-white rounded hover:bg-primary"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="px-4 py-2 border border-border rounded text-foreground/85 hover:bg-muted"
          >
            Dashboard
          </a>
        </div>
        {process.env.NODE_ENV === 'development' && error?.message && (
          <details className="mt-6 text-left max-w-lg mx-auto">
            <summary className="cursor-pointer text-sm text-muted-foreground">Error details (dev only)</summary>
            <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto whitespace-pre-wrap">
              {error.message}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}
