'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getApiBaseUrl } from '@/lib/api'
import { ArrowLeft, Loader2, Eye, EyeOff, KeyRound } from 'lucide-react'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const otpRef = useRef<HTMLInputElement>(null)
  const [identifier, setIdentifier] = useState('')
  const [step, setStep] = useState<1 | 2>(1)
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (step === 2) {
      otpRef.current?.focus()
    }
  }, [step])

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    const trimmed = identifier.trim()
    if (!trimmed) {
      setError('Enter the email or username you use to sign in.')
      return
    }
    setLoading(true)
    try {
      const base = getApiBaseUrl()
      const res = await fetch(`${base}/auth/forgot-password/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: trimmed, method: 'otp' }),
      })
      const data = await res.json().catch(() => ({}))
      const detail = typeof data?.detail === 'string' ? data.detail : null
      if (!res.ok) {
        setError(detail || 'Something went wrong. Try again later.')
        return
      }
      setMessage('Check your inbox (and spam) for a 6-digit code. It expires in 5 minutes.')
      setStep(2)
      setOtp('')
    } catch {
      setError('Cannot reach the server. Check that the backend is running.')
    } finally {
      setLoading(false)
    }
  }

  const handleOtpResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmed = identifier.trim()
    if (!trimmed) {
      setError('Sign-in email or username is missing. Go back to step 1.')
      return
    }
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the 6-digit code from your email.')
      return
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const base = getApiBaseUrl()
      const res = await fetch(`${base}/auth/reset-password/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          email: trimmed,
          otp: otp.trim(),
          new_password: newPassword,
        }),
      })
      const data = await res.json().catch(() => ({}))
      const detail = typeof data?.detail === 'string' ? data.detail : null
      if (!res.ok) {
        setError(detail || 'Could not reset password.')
        return
      }
      setMessage(detail || 'Password updated. You can sign in now.')
      setTimeout(() => router.push('/login'), 2000)
    } catch {
      setError('Cannot reach the server. Check that the backend is running.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-start sm:items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 px-3 py-4 sm:px-4 sm:py-8 overflow-y-auto">
      <div className="w-full max-w-md my-auto rounded-2xl bg-white p-5 sm:p-7 shadow-xl border border-border/80">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-white">
            <KeyRound className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              Reset your password
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {step === 1
                ? 'We email a 6-digit code (no reset link).'
                : 'Enter the code, then choose a new password.'}
            </p>
          </div>
        </div>

        {step === 1 ? (
          <form onSubmit={handleRequestSubmit} className="mt-5 space-y-3.5">
            {error && (
              <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground/85 mb-1.5">
                Email or username
              </label>
              <input
                id="email"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2.5 text-foreground shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="you@company.com or your username"
                disabled={loading}
                autoFocus
              />
            </div>

            <details className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground select-none">
                Tips (optional)
              </summary>
              <ul className="mt-2 list-disc space-y-1.5 pl-4">
                <li>Use the same email or username you use on the sign-in page.</li>
                <li>If you use a short username, the code goes to your profile email.</li>
                <li>We never confirm whether an account exists (same message either way).</li>
              </ul>
            </details>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full min-h-11 items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                'Send code'
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtpResetSubmit} className="mt-5 space-y-3.5">
            {message && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
                {message}
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                {error}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Account:{' '}
              <span className="font-mono text-foreground break-all">{identifier.trim() || '—'}</span>
            </p>

            <div>
              <label htmlFor="otp" className="block text-sm font-medium text-foreground/85 mb-1.5">
                6-digit code
              </label>
              <input
                ref={otpRef}
                id="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full rounded-lg border border-border px-3 py-3 font-mono text-xl tracking-[0.35em] text-center text-foreground"
                placeholder="000000"
                maxLength={6}
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="npw" className="block text-sm font-medium text-foreground/85 mb-1.5">
                New password
              </label>
              <div className="relative">
                <input
                  id="npw"
                  type={showPw ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2.5 pr-10 text-foreground"
                  autoComplete="new-password"
                  minLength={8}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"
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
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2.5 text-foreground"
                autoComplete="new-password"
                disabled={loading}
              />
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row pt-1">
              <button
                type="button"
                onClick={() => {
                  setStep(1)
                  setError(null)
                  setMessage(null)
                  setOtp('')
                  setNewPassword('')
                  setConfirmPassword('')
                }}
                className="min-h-11 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/40 sm:w-auto"
                disabled={loading}
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
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
            </div>
          </form>
        )}

        <Link
          href="/login"
          className="mt-5 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary hover:text-primary/80"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
