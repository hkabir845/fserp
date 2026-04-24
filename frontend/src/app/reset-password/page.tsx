'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { getApiBaseUrl } from '@/lib/api'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

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
        <Link href="/login" className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline">
          Go to sign in now
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {!tokenFromUrl ? (
        <div>
          <label htmlFor="token" className="block text-sm font-medium text-slate-700 mb-1.5">
            Reset token
          </label>
          <input
            id="token"
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900"
            placeholder="Paste token from email link"
            autoComplete="off"
          />
        </div>
      ) : null}

      <div>
        <label htmlFor="npw" className="block text-sm font-medium text-slate-700 mb-1.5">
          New password
        </label>
        <div className="relative">
          <input
            id="npw"
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-slate-900"
            autoComplete="new-password"
            minLength={8}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500"
            onClick={() => setShowPw((s) => !s)}
            aria-label={showPw ? 'Hide password' : 'Show password'}
          >
            {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
      </div>

      <div>
        <label htmlFor="cpw" className="block text-sm font-medium text-slate-700 mb-1.5">
          Confirm new password
        </label>
        <input
          id="cpw"
          type={showPw ? 'text' : 'password'}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
          autoComplete="new-password"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 px-4">
      <div className="w-full max-w-md rounded-xl bg-white app-modal-pad shadow-xl border border-slate-100">
        <h1 className="text-2xl font-semibold text-slate-900">Set a new password</h1>
        <p className="mt-2 text-sm text-slate-600">
          Choose a strong password you have not used here before. This link expires after a short time.
        </p>
        <div className="mt-8">
          <Suspense
            fallback={
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            }
          >
            <ResetPasswordForm />
          </Suspense>
        </div>
        <Link href="/login" className="mt-8 inline-block text-sm font-medium text-blue-600 hover:text-blue-800">
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
