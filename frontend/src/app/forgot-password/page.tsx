'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getApiBaseUrl } from '@/lib/api'
import { ArrowLeft, Loader2, Eye, EyeOff, Building2, KeyRound, Mail, Shield } from 'lucide-react'

type ResetMethod = 'link' | 'otp'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [method, setMethod] = useState<ResetMethod>('link')
  const [step, setStep] = useState<1 | 2>(1)
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        body: JSON.stringify({ email: trimmed, method }),
      })
      const data = await res.json().catch(() => ({}))
      const detail = typeof data?.detail === 'string' ? data.detail : null
      if (!res.ok) {
        setError(detail || 'Something went wrong. Try again later.')
        return
      }
      if (method === 'otp') {
        setMessage(
          detail ||
            'If an account exists, we sent a 6-digit code. Enter it below with your new password.'
        )
        setStep(2)
        setOtp('')
        return
      }
      setMessage(
        detail ||
          'If an account exists for that address, we sent a confirmation link. Open it in your email to set a new password.'
      )
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white app-modal-pad shadow-xl border border-slate-200/80">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
          <KeyRound className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900">Reset your password</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {step === 1
            ? 'Enter the email or username for your account. We will send a secure link or a one-time code to the mailbox on file for that user.'
            : 'Enter the 6-digit code from your email, then choose a new password.'}
        </p>

        <div className="mt-4 flex gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-xs text-slate-600">
          <Mail className="h-4 w-4 shrink-0 text-slate-500 mt-0.5" aria-hidden />
          <p>
            <span className="font-medium text-slate-800">Where we send the message: </span>
            If you sign in with an email, we use that inbox. If you use a short username, we use the
            <strong> profile email </strong>
            on your user (ask your company administrator if it is missing).
          </p>
        </div>
        <div className="mt-2 flex gap-2 rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2.5 text-xs text-amber-950/90">
          <Building2 className="h-4 w-4 shrink-0 text-amber-700/80 mt-0.5" aria-hidden />
          <p>
            <span className="font-medium text-amber-950">Company owners &amp; staff: </span>
            use the <strong>same</strong> email or username you enter on the sign-in page. Your organization should keep
            your profile email up to date if you do not use an email as your username. After a successful reset, if
            sign-in still fails, your             <strong>organization account</strong> may be suspended—contact an administrator.
          </p>
        </div>
        <div className="mt-2 flex gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5 text-xs text-slate-700">
          <Shield className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" aria-hidden />
          <p>
            We never tell you whether an account exists, so the same message appears in every case. If the same
            <strong> email is shared by several user accounts</strong> (rare and discouraged), use your
            <strong> username</strong> here instead; password reset only matches a shared email unambiguously when it
            is unique in the system.
          </p>
        </div>

        {step === 1 ? (
          <form onSubmit={handleRequestSubmit} className="mt-8 space-y-4">
            {message && method === 'link' && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {message}
                <p className="mt-2 text-xs text-emerald-800">
                  The email contains a link to confirm the reset, then you choose a new password. Check spam.
                </p>
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Email or username
              </label>
              <input
                id="email"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="you@company.com or your username"
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium text-slate-700">How to reset</span>
              <div className="space-y-2 text-sm text-slate-800">
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50/50">
                  <input
                    type="radio"
                    name="method"
                    className="mt-1"
                    checked={method === 'link'}
                    onChange={() => setMethod('link')}
                    disabled={loading}
                  />
                  <span>
                    <strong>Confirmation link (recommended)</strong>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      You open the link from email to confirm you want to reset, then set a new password on the site.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50/50">
                  <input
                    type="radio"
                    name="method"
                    className="mt-1"
                    checked={method === 'otp'}
                    onChange={() => setMethod('otp')}
                    disabled={loading}
                  />
                  <span>
                    <strong>One-time code</strong>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      We email a 6-digit code; you enter it here with your new password. Code expires in 5 minutes.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : method === 'link' ? (
                'Send confirmation link'
              ) : (
                'Send code'
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtpResetSubmit} className="mt-8 space-y-4">
            {message && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {message}
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
            )}

            <p className="text-xs text-slate-500">
              Account: <span className="font-mono text-slate-800">{identifier.trim() || '—'}</span>
            </p>

            <div>
              <label htmlFor="otp" className="block text-sm font-medium text-slate-700 mb-1.5">
                6-digit code
              </label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-lg tracking-widest text-slate-900"
                placeholder="000000"
                maxLength={6}
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="npw" className="block text-sm font-medium text-slate-700 mb-1.5">
                New password
              </label>
              <div className="relative">
                <input
                  id="npw"
                  type={showPw ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-slate-900"
                  autoComplete="new-password"
                  minLength={8}
                  disabled={loading}
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
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                autoComplete="new-password"
                disabled={loading}
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
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
                className="rounded-lg border border-slate-300 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
                disabled={loading}
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
          className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>

        <p className="mt-8 text-xs leading-relaxed text-slate-500">
          <strong className="font-medium text-slate-600">Operators:</strong> configure SMTP (
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">EMAIL_HOST</code>,{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">DEFAULT_FROM_EMAIL</code>) and{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">FRONTEND_BASE_URL</code> on the
          server so messages deliver and links open in this app.
        </p>
      </div>
    </div>
  )
}
