'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { getApiBaseUrl } from '@/lib/api'
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tokenFromUrl = (searchParams.get('token') || '').trim()

  const [token, setToken] = useState(tokenFromUrl)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (tokenFromUrl && !token.trim()) {
      setToken(tokenFromUrl)
    }
  }, [tokenFromUrl, token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const t = token.trim()
    if (!t) {
      setError('Missing reset token. Open the link from your email, or request a new reset.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const base = getApiBaseUrl()
      const res = await fetch(`${base}/auth/reset-password/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token: t, new_password: password }),
      })
      const data = await res.json().catch(() => ({}))
      const detail = typeof data?.detail === 'string' ? data.detail : null
      if (!res.ok) {
        setError(detail || 'Could not reset password.')
        return
      }
      setDone(true)
      setPassword('')
      setConfirm('')
      setTimeout(() => router.push('/login'), 2500)
    } catch {
      setError('Cannot reach the server. Check that the backend is running.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        <p className="font-medium">Password updated</p>
        <p className="mt-1">Redirecting to sign in…</p>
        <Link href="/login" className="mt-3 inline-block text-sm erp-link hover:underline">
          Go to sign in now
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {!tokenFromUrl ? (
        <div>
          <label htmlFor="token" className="block text-sm font-medium text-foreground/85 mb-1.5">
            Reset token
          </label>
          <input
            id="token"
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 font-mono text-sm text-foreground"
            placeholder="Paste token from email link"
            autoComplete="off"
          />
        </div>
      ) : null}

      <div>
        <label htmlFor="npw" className="block text-sm font-medium text-foreground/85 mb-1.5">
          New password
        </label>
        <div className="relative">
          <input
            id="npw"
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 pr-10 text-foreground"
            autoComplete="new-password"
            minLength={8}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            onClick={() => setShowPw((s) => !s)}
            aria-label={showPw ? 'Hide password' : 'Show password'}
          >
            {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">At least 8 characters.</p>
      </div>

      <div>
        <label htmlFor="cpw" className="block text-sm font-medium text-foreground/85 mb-1.5">
          Confirm new password
        </label>
        <input
          id="cpw"
          type={showPw ? 'text' : 'password'}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-lg border border-border px-3 py-2 text-foreground"
          autoComplete="new-password"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-white hover:bg-primary disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving…
          </>
        ) : (
          'Set new password'
        )}
      </button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white app-modal-pad shadow-xl border border-border/80">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-foreground text-white">
          <KeyRound className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">Set a new password</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          You followed a link from your email. Choose a new password for <strong>your user in this app</strong> (company
          staff, company administrators, and platform users all use the same flow). Links expire in about 30 minutes.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Prefer a one-time code? Open{' '}
          <Link href="/forgot-password" className="erp-link hover:underline">
            Forgot password?
          </Link>{' '}
          and select the 6-digit code option.
        </p>
        <div className="mt-6">
          <Suspense
            fallback={
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            }
          >
            <ResetPasswordForm />
          </Suspense>
        </div>
        <Link href="/login" className="mt-8 inline-block text-sm font-medium text-primary hover:text-primary/80">
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
