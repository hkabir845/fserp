'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import { getApiBaseUrl, getBackendOrigin, getApiDocsUrl, setAuthApiOriginStamp } from '@/lib/api'
import { formatApiErrorJson } from '@/utils/errorHandler'
import { loginRedirectAfterAuth } from '@/utils/loginRedirect'
import { AndroidAppDownload } from '@/components/AndroidAppDownload'
import { BrainAppInstallPrompt } from '@/components/brain/BrainAppInstallPrompt'
import { isCapacitorNativeApp } from '@/lib/androidApp'

export function LoginPageInner({ variant = 'default' }: { variant?: 'default' | 'brain' }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isBrain = variant === 'brain'
  const nextPath = isBrain ? '/brain-app' : searchParams.get('next')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [checkingConnection, setCheckingConnection] = useState(false)
  const [showConnectionError, setShowConnectionError] = useState(false)

  const backendOrigin = getBackendOrigin()
  const apiDocsUrl = getApiDocsUrl()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted || isBrain) return
    if (nextPath === '/brain-app') {
      router.replace('/brain-app/login')
    }
  }, [mounted, isBrain, nextPath, router])

  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return
    try {
      const token = localStorage.getItem('access_token')?.trim()
      if (token && token !== 'undefined' && token !== 'null') {
        try {
          const userStr = localStorage.getItem('user')
          const u = userStr ? JSON.parse(userStr) : null
          router.replace(
            loginRedirectAfterAuth(
              u?.role,
              Array.isArray(u?.permissions) ? u.permissions : null,
              nextPath
            )
          )
        } catch {
          router.replace('/dashboard')
        }
      }
    } catch {
      /* ignore */
    }
  }, [mounted, router, nextPath])

  const testConnection = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setCheckingConnection(true)
      setBackendConnected(null)
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)

    try {
      const serverBase = getBackendOrigin()
      const response = await fetch(`${serverBase}/health`, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-cache',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        setBackendConnected(true)
        setShowConnectionError(false)
        setError('')
        return true
      }
      setBackendConnected(false)
      setShowConnectionError(true)
      if (showLoading) {
        setError(`Cannot connect to backend server. Please ensure the backend is running on ${backendOrigin}`)
      }
      return false
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      setBackendConnected(false)
      setShowConnectionError(true)
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(`Cannot connect to backend server. Please ensure the backend is running on ${backendOrigin}`)
      }
      return false
    } finally {
      if (showLoading) setCheckingConnection(false)
    }
  }, [backendOrigin])

  const hasCheckedConnection = useRef(false)

  useEffect(() => {
    if (hasCheckedConnection.current) return
    hasCheckedConnection.current = true
    testConnection(false).catch(() => {})
  }, [testConnection])

  const fetchWithTimeout = async (
    url: string,
    options: RequestInit,
    timeoutMs: number = 3000
  ): Promise<Response> => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timeoutId)
      return response
    } catch (err) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Request timeout - server is taking too long to respond')
      }
      throw err
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const baseUrl = getApiBaseUrl()
      if (!username?.trim()) throw new Error('Username is required')
      if (!password) throw new Error('Password is required')

      const cachedEndpoint =
        typeof window !== 'undefined' ? localStorage.getItem('login_endpoint_cache') : null
      const nativeApp = isCapacitorNativeApp()

      let response: Response | null = null
      let lastError: Error | null = null

      // JSON first — CapacitorHttp on Android breaks multipart FormData login.
      const endpoints: Array<{
        name: string
        url: string
        method: string
        body: FormData | string
        headers: Record<string, string>
      }> = [
        {
          name: 'json',
          url: `${baseUrl}/auth/login/json/`,
          method: 'POST',
          body: JSON.stringify({ username: username.trim(), password }),
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        },
        ...(nativeApp
          ? []
          : [
              {
                name: 'form',
                url: `${baseUrl}/auth/login/form/`,
                method: 'POST',
                body: (() => {
                  const formData = new FormData()
                  formData.append('username', username.trim())
                  formData.append('password', password)
                  return formData
                })(),
                headers: { Accept: 'application/json' },
              },
              {
                name: 'oauth2',
                url: `${baseUrl}/auth/login/`,
                method: 'POST',
                body: (() => {
                  const params = new URLSearchParams()
                  params.append('username', username.trim())
                  params.append('password', password)
                  params.append('grant_type', 'password')
                  return params.toString()
                })(),
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  Accept: 'application/json',
                },
              },
            ]),
      ]

      if (cachedEndpoint && !nativeApp) {
        const cachedIndex = endpoints.findIndex((e) => e.name === cachedEndpoint)
        if (cachedIndex > 0) {
          const cached = endpoints.splice(cachedIndex, 1)[0]
          endpoints.unshift(cached)
        }
      } else if (nativeApp && typeof window !== 'undefined') {
        localStorage.setItem('login_endpoint_cache', 'json')
      }

      endpointLoop: for (const endpoint of endpoints) {
        try {
          const endpointResponse = await fetchWithTimeout(
            endpoint.url,
            {
              method: endpoint.method,
              mode: 'cors',
              cache: 'no-cache',
              credentials: 'omit',
              headers: endpoint.headers,
              body: endpoint.body as BodyInit,
            },
            3000
          )

          response = endpointResponse

          if (response.ok) {
            if (typeof window !== 'undefined') {
              localStorage.setItem('login_endpoint_cache', endpoint.name)
            }
            break endpointLoop
          }
          if (response.status === 404) {
            response = null
            continue endpointLoop
          }
          // Wrong password / forbidden — stop. Other errors may be transport (e.g. FormData via CapacitorHttp).
          if (response.status === 401 || response.status === 403) {
            break endpointLoop
          }
          response = null
          continue endpointLoop
        } catch (err) {
          response = null
          lastError = err as Error
        }
      }

      if (!response) {
        const isNetworkError =
          lastError &&
          (lastError.message.includes('fetch') ||
            lastError.message.includes('Failed to fetch') ||
            lastError.message.includes('ERR_CONNECTION_REFUSED') ||
            lastError.message.includes('NetworkError') ||
            lastError.message.includes('network') ||
            (lastError instanceof TypeError && lastError.message.includes('fetch')))

        if (isNetworkError) {
          throw new Error(
            `Cannot connect to server. Please ensure the backend is running on ${backendOrigin}`
          )
        }
        throw (
          lastError ||
          new Error(
            'All login endpoints failed. Please check your credentials and ensure the backend is running.'
          )
        )
      }

      if (!response.ok) {
        let errorMessage = 'Login failed'
        if (response.status === 404) {
          errorMessage = `Login endpoint not found. Please ensure the backend is running on ${backendOrigin}`
        } else {
          try {
            const contentType = response.headers.get('content-type')
            if (contentType?.includes('application/json')) {
              errorMessage = formatApiErrorJson(await response.json(), 'Login failed')
            } else {
              errorMessage = (await response.text()) || response.statusText || `Server error (${response.status})`
            }
          } catch {
            errorMessage = response.statusText || `Server error (${response.status})`
          }
        }
        throw new Error(errorMessage)
      }

      const data = await response.json()
      const { access_token, refresh_token, user } = data
      if (!access_token) throw new Error('No access token received from server')

      localStorage.setItem('access_token', String(access_token).trim())
      localStorage.setItem('refresh_token', String(refresh_token || '').trim())
      localStorage.setItem('user', JSON.stringify(user))
      setAuthApiOriginStamp()

      router.push(
        loginRedirectAfterAuth(
          user?.role,
          Array.isArray(user?.permissions) ? user.permissions : null,
          nextPath
        )
      )
    } catch (err: unknown) {
      let errorMessage = 'Login failed. Please check your credentials.'
      const isNetworkError =
        (err instanceof TypeError &&
          err.message &&
          (err.message.includes('fetch') || err.message.includes('Failed to fetch'))) ||
        (err instanceof Error &&
          (err.message.includes('Cannot connect to server') ||
            err.message.includes('ERR_CONNECTION_REFUSED') ||
            err.message.includes('NetworkError') ||
            err.message.includes('network')))

      if (isNetworkError) {
        errorMessage = `Cannot connect to server. Please ensure the backend is running on ${backendOrigin}`
        setBackendConnected(false)
        setShowConnectionError(true)
      } else if (err instanceof Error && err.message) {
        errorMessage = err.message
      }
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className={
        isBrain
          ? 'auth-page-scroll fixed inset-0 z-0 overflow-y-auto overscroll-y-contain bg-gradient-to-br from-indigo-600 to-violet-700 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:py-8'
          : 'auth-page-scroll fixed inset-0 z-0 overflow-y-auto overscroll-y-contain bg-gradient-to-br from-accent to-accent px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:py-8'
      }
    >
      <div className="mx-auto flex min-h-full w-full max-w-md items-center justify-center py-2">
        <div className="w-full rounded-lg bg-white p-5 shadow-xl sm:p-8">
          <div className="mb-8 text-center">
            {isBrain ? (
              <>
                <img
                  src="/brain-app/icon-192.png"
                  alt=""
                  className="mx-auto mb-3 h-16 w-16 rounded-2xl shadow-md"
                  width={64}
                  height={64}
                />
                <h1 className="text-2xl font-bold text-indigo-950 sm:text-3xl">Company Brain</h1>
                <p className="mt-2 text-muted-foreground">Owner login — ask anything about your business</p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Filling Station ERP</h1>
                <p className="mt-2 text-muted-foreground">QuickBooks Style Business Management</p>
              </>
            )}
          </div>

          {isBrain ? <BrainAppInstallPrompt language="bn" defaultExpanded /> : null}

          <form onSubmit={handleLogin} className="space-y-6">
            {backendConnected === false && showConnectionError && (
              <div className="rounded border border-destructive/25 bg-destructive/5 px-4 py-3 text-destructive">
                <p className="font-semibold">Cannot connect to backend server</p>
                <p className="mt-1 text-sm">{error || `Ensure the backend is running on ${backendOrigin}`}</p>
                <button
                  type="button"
                  onClick={() => void testConnection(true)}
                  disabled={checkingConnection}
                  className="mt-3 rounded bg-destructive px-3 py-1.5 text-sm text-white hover:bg-destructive/90 disabled:opacity-50"
                >
                  {checkingConnection ? 'Checking...' : 'Retry Connection'}
                </button>
              </div>
            )}
            {backendConnected === true && error && (
              <div className="rounded border border-destructive/25 bg-destructive/5 px-4 py-3 text-destructive">
                <p className="font-semibold">Login Failed</p>
                <p className="mt-1 text-sm">{error}</p>
              </div>
            )}
            {(backendConnected === null || checkingConnection) && (
              <div className="flex items-center rounded border border-primary/25 bg-blue-50 px-4 py-3 text-primary">
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-primary" />
                <span>Checking backend connection...</span>
              </div>
            )}

            <div>
              <label htmlFor="username" className="mb-2 block text-sm font-medium text-foreground">
                Username or email
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-md border border-border px-4 py-3 text-base focus:border-ring focus:ring-2 focus:ring-ring sm:py-2"
                placeholder="Your login name or email"
                autoComplete="username"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium text-foreground">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-border px-4 py-3 pr-11 text-base focus:border-ring focus:ring-2 focus:ring-ring sm:py-2"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground/85"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              <div className="mt-2 text-right">
                <Link href="/forgot-password" className="text-sm text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-11 rounded-md bg-primary px-4 py-3 text-base text-white hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50 sm:py-2 sm:text-sm"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>

          {!isBrain ? <AndroidAppDownload /> : null}

          {!isBrain ? (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              <Link href="/brain-app/login" className="font-medium text-indigo-600 hover:underline">
                Owner? Open Company Brain only →
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
