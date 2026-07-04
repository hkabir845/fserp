'use client'

import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { performLogin } from '@/lib/authLogin'
import { fetchCurrentCompany, persistSelectedCompanyForApi } from '@/lib/api'
import {
  enterBrainAppAfterLogin,
  hasValidBrainSession,
  redirectBrainLoginIfNeeded,
} from '@/lib/brainAppSession'
import { BrainSimpleInstall } from '@/components/brain/BrainSimpleInstall'

export function BrainAppLoginScreen() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (hasValidBrainSession()) {
      enterBrainAppAfterLogin()
      return
    }
    setChecking(false)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await performLogin(username, password)
      try {
        const data = await fetchCurrentCompany({ force: true })
        const id = data?.id
        const name = String(data?.name || '').trim()
        if (typeof id === 'number' && name) {
          persistSelectedCompanyForApi({
            id,
            name,
            is_master: data.is_master,
          })
        }
      } catch {
        /* brain home page will retry */
      }
      enterBrainAppAfterLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      if (String(err).includes('401') || String(err).toLowerCase().includes('invalid')) {
        redirectBrainLoginIfNeeded()
      }
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-indigo-600 to-violet-700">
        <div className="h-10 w-10 animate-pulse rounded-full bg-white/30" />
      </div>
    )
  }

  return (
    <div className="min-h-dvh overflow-y-auto bg-gradient-to-br from-indigo-600 to-violet-700 px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-sm">
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <div className="mb-6 text-center">
            <img
              src="/brain-app/icon-192.png"
              alt=""
              className="mx-auto mb-3 h-20 w-20 rounded-2xl shadow-md"
              width={80}
              height={80}
            />
            <h1 className="text-2xl font-bold text-indigo-950">Company Brain</h1>
            <p className="mt-1 text-sm text-muted-foreground">Install once, then log in</p>
          </div>

          <BrainSimpleInstall language="bn" />

          <p className="mb-3 text-center text-sm font-semibold text-indigo-950">ধাপ ২: লগইন</p>

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </div>
            ) : null}

            <div>
              <label htmlFor="brain-user" className="mb-1 block text-sm font-medium">
                Username or email
              </label>
              <input
                id="brain-user"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-3 text-base"
                placeholder="Your login"
              />
            </div>

            <div>
              <label htmlFor="brain-pass" className="mb-1 block text-sm font-medium">
                Password
              </label>
              <div className="relative">
                <input
                  id="brain-pass"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-3 pr-11 text-base"
                  placeholder="Password"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-2 text-muted-foreground"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-indigo-600 py-3 text-base font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {loading ? 'Logging in…' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
