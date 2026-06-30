'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import { getApiBaseUrl, getBackendOrigin, getApiDocsUrl, setAuthApiOriginStamp } from '@/lib/api'
import { formatApiErrorJson } from '@/utils/errorHandler'
import { getDefaultLandingHref } from '@/utils/dashboardLanding'
import { AndroidAppDownload } from '@/components/AndroidAppDownload'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [checkingConnection, setCheckingConnection] = useState(false)
  const [showConnectionError, setShowConnectionError] = useState(false) // Only show error when user explicitly checks

  const backendOrigin = getBackendOrigin()
  const apiDocsUrl = getApiDocsUrl()

  // Mark as mounted to prevent hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  // Already signed in — skip login UI (replaces old client-only home redirect)
  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return
    try {
      const token = localStorage.getItem('access_token')?.trim()
      if (token && token !== 'undefined' && token !== 'null') {
        try {
          const userStr = localStorage.getItem('user')
          const u = userStr ? JSON.parse(userStr) : null
          router.replace(
            getDefaultLandingHref(u?.role, Array.isArray(u?.permissions) ? u.permissions : null)
          )
        } catch {
          router.replace('/dashboard')
        }
      }
    } catch {
      /* ignore */
    }
  }, [mounted, router])

  // Test backend connection function (can be called manually)
  const testConnection = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setCheckingConnection(true)
      setBackendConnected(null)
    }
    
    // Use AbortController with short timeout to fail fast and avoid console spam
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000) // 2 second timeout
    
    try {
      const serverBase = getBackendOrigin()

      // Try health endpoint (most reliable)
      const response = await fetch(`${serverBase}/health`, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-cache',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      })
      
      clearTimeout(timeoutId)
      
      if (response.ok) {
        setBackendConnected(true)
        setShowConnectionError(false)
        setError('') // Clear any previous errors
        return true
      } else {
        setBackendConnected(false)
        // Always show error message when connection fails (both automatic and manual checks)
        setShowConnectionError(true)
        if (showLoading) {
          setError(`Cannot connect to backend server. Please ensure the backend is running on ${backendOrigin}`)
        }
        return false
      }
    } catch (err: any) {
      clearTimeout(timeoutId)
      
      // Suppress console errors but still show UI feedback
      setBackendConnected(false)
      setShowConnectionError(true)
      if (err.name !== 'AbortError') {
        // Show error message for both automatic and manual checks
        setError(`Cannot connect to backend server. Please ensure the backend is running on ${backendOrigin}`)
      }
      return false
    } finally {
      if (showLoading) {
        setCheckingConnection(false)
      }
    }
  }, [])

  // Use ref to ensure connection check only happens once, even with hot reload
  const hasCheckedConnection = useRef(false)
  
  // Test backend connection on component mount (ONLY ONCE, shows UI feedback)
  useEffect(() => {
    // Only check if we haven't checked before (prevents hot reload spam)
    if (hasCheckedConnection.current) {
      return
    }
    
    hasCheckedConnection.current = true
    
    // Check connection on mount and show UI feedback
    // This runs once to avoid console spam, but still shows the error message to user
    testConnection(false).catch(() => {
      // Error already handled in testConnection
    })
  }, []) // Empty deps - only run once on mount

  // Helper function to make fetch with timeout
  const fetchWithTimeout = async (
    url: string,
    options: RequestInit,
    timeoutMs: number = 3000
  ): Promise<Response> => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
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

      // Validate inputs
      if (!username || !username.trim()) {
        throw new Error('Username is required')
      }
      if (!password) {
        throw new Error('Password is required')
      }

      // OPTIMIZED: Try endpoints with timeouts and caching
      // 1. Check cached working endpoint first (fastest)
      // 2. Form endpoint with Form() (most reliable, try first)
      // 3. JSON endpoint (fallback)
      // 4. OAuth2 form endpoint (last resort)
      
      const cachedEndpoint = typeof window !== 'undefined' 
        ? localStorage.getItem('login_endpoint_cache')
        : null
      
      let response: Response | null = null
      let lastError: Error | null = null
      let successfulEndpoint: string | null = null
      
      const endpoints: Array<{
        name: string
        url: string
        method: string
        body: FormData | string
        headers: Record<string, string>
      }> = [
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
          headers: { 'Accept': 'application/json' }
        },
        { 
          name: 'json', 
          url: `${baseUrl}/auth/login/json/`,
          method: 'POST',
          body: JSON.stringify({ username: username.trim(), password }),
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
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
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }
        }
      ]

      // Reorder endpoints if we have a cached working one
      if (cachedEndpoint) {
        const cachedIndex = endpoints.findIndex(e => e.name === cachedEndpoint)
        if (cachedIndex > 0) {
          const cached = endpoints.splice(cachedIndex, 1)[0]
          endpoints.unshift(cached)
        }
      }

      // Try each endpoint with 3 second timeout
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
              body: endpoint.body as any
            },
            3000 // 3 second timeout per endpoint
          )
          
          response = endpointResponse
          
          if (response.ok) {
            successfulEndpoint = endpoint.name
            // Cache the working endpoint for next time
            if (typeof window !== 'undefined') {
              localStorage.setItem('login_endpoint_cache', endpoint.name)
            }
            break endpointLoop // Success, stop trying
          } else if (response.status === 404) {
            // Endpoint doesn't exist, try next
            response = null
            continue endpointLoop
          } else {
            // Got a response (even if error) - endpoint exists, stop trying others
            break endpointLoop
          }
        } catch (err) {
          // Timeout or network error - try next endpoint
          response = null
          lastError = err as Error
          continue endpointLoop
        }
      }
      
      if (!response) {
        // If all endpoints failed due to network errors, provide helpful message
        const isNetworkError = lastError && (
          lastError.message.includes('fetch') || 
          lastError.message.includes('Failed to fetch') ||
          lastError.message.includes('ERR_CONNECTION_REFUSED') ||
          lastError.message.includes('NetworkError') ||
          lastError.message.includes('network') ||
          (lastError instanceof TypeError && lastError.message.includes('fetch'))
        )
        
        if (isNetworkError) {
          throw new Error(`Cannot connect to server. Please ensure the backend is running on ${backendOrigin}`)
        }
        throw lastError || new Error('All login endpoints failed. Please check your credentials and ensure the backend is running.')
      }

      if (!response.ok) {
        let errorMessage = 'Login failed'
        
        // Handle 404 specifically - endpoint might not be available
        if (response.status === 404) {
          errorMessage = `Login endpoint not found. Please ensure the backend is running on ${backendOrigin}`
        } else {
          try {
            const contentType = response.headers.get('content-type')
            if (contentType && contentType.includes('application/json')) {
              const errorData = await response.json()
              errorMessage = formatApiErrorJson(errorData, 'Login failed')
            } else {
              const text = await response.text()
              errorMessage = text || response.statusText || `Server error (${response.status})`
            }
          } catch (parseError) {
            console.warn('Failed to parse error response:', parseError)
            errorMessage = response.statusText || `Server error (${response.status})`
          }
        }
        throw new Error(errorMessage)
      }

      let data
      try {
        data = await response.json()
      } catch (parseError) {
        console.error('Failed to parse login response:', parseError)
        throw new Error('Invalid response from server. Please try again.')
      }

      const { access_token, refresh_token, user } = data

      if (!access_token) {
        throw new Error('No access token received from server')
      }

      // Store tokens and user info
      localStorage.setItem('access_token', String(access_token).trim())
      localStorage.setItem('refresh_token', String(refresh_token || '').trim())
      localStorage.setItem('user', JSON.stringify(user))
      setAuthApiOriginStamp()

      const landing = getDefaultLandingHref(
        user?.role,
        Array.isArray(user?.permissions) ? user.permissions : null
      )
      router.push(landing)
    } catch (err: any) {
      // One-line dev log (avoid console.error: it chains through SuppressWarnings + errorHandler and prints noisy stacks)
      if (process.env.NODE_ENV === 'development') {
        const logMsg =
          err instanceof Error ? err.message : typeof err === 'string' ? err : 'Login request failed'
        console.info('[login]', logMsg)
      }
      let errorMessage = 'Login failed. Please check your credentials.'
      
      // Check if it's a network/connection error
      const isNetworkError = 
        (err instanceof TypeError && (err.message && (err.message.includes('fetch') || err.message.includes('Failed to fetch')))) ||
        (err instanceof Error && err.message && (
          err.message.includes('Cannot connect to server') ||
          err.message.includes('ERR_CONNECTION_REFUSED') ||
          err.message.includes('NetworkError') ||
          err.message.includes('network')
        ))
      
      if (isNetworkError) {
        errorMessage = `Cannot connect to server. Please ensure the backend is running on ${backendOrigin}`
        setBackendConnected(false)
        setShowConnectionError(true)
      } else if (err instanceof Error && err.message) {
        // Standard Error object
        errorMessage = err.message
      } else if (typeof err === 'string') {
        // Error is already a string
        errorMessage = err
      } else if (err?.message) {
        // Error object with message property
        errorMessage = err.message
      } else if (err?.detail) {
        // API error format (Django returns detail in same shape)
        errorMessage = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
      } else if (err?.error) {
        // Error object with error property
        errorMessage = typeof err.error === 'string' ? err.error : JSON.stringify(err.error)
      } else if (err) {
        // Last resort: try to stringify the error
        try {
          errorMessage = JSON.stringify(err)
        } catch {
          errorMessage = 'An unexpected error occurred. Please try again.'
        }
      }
      
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page-scroll fixed inset-0 z-0 overflow-y-auto overscroll-y-contain bg-gradient-to-br from-accent to-accent px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:py-8">
      <div className="mx-auto flex min-h-full w-full max-w-md items-center justify-center py-2">
        <div className="w-full rounded-lg bg-white p-5 shadow-xl sm:p-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Filling Station ERP</h1>
          <p className="text-muted-foreground mt-2">QuickBooks Style Business Management</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          {backendConnected === false && (
            <div className="bg-destructive/5 border border-destructive/25 text-destructive px-4 py-3 rounded">
              <p className="font-semibold">⚠️ Cannot connect to backend server</p>
              <p className="text-sm mt-1">Start the backend first, then try again:</p>
              <p className="text-xs mt-2 text-destructive font-mono bg-destructive/10 p-2 rounded break-all">
                cd backend → venv\Scripts\activate → python manage.py runserver
              </p>
              <p className="text-xs mt-1 text-muted-foreground">Then open <a href={apiDocsUrl} target="_blank" rel="noopener noreferrer" className="underline">{apiDocsUrl}</a> to confirm (when <code className="text-xs">DJANGO_DEBUG=true</code>).</p>
              <button
                type="button"
                onClick={() => testConnection(true)}
                disabled={checkingConnection}
                className="mt-3 text-sm bg-destructive text-white px-3 py-1.5 rounded hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {checkingConnection ? 'Checking...' : 'Retry Connection'}
              </button>
            </div>
          )}
          {backendConnected === true && error && (
            <div className="bg-destructive/5 border border-destructive/25 text-destructive px-4 py-3 rounded">
              <p className="font-semibold">Login Failed</p>
              <p className="text-sm mt-1">{error}</p>
              {(error.toLowerCase().includes('invalid credentials') || error.toLowerCase().includes('incorrect username or password')) && (
                <p className="text-xs mt-2 text-destructive">
                  No user or wrong password. Create a user: in the <strong>backend</strong> folder run <code className="bg-destructive/10 px-1 rounded">python manage.py create_superuser</code> (default username: <strong>admin</strong>; set a password when prompted), then log in with that username and password.
                </p>
              )}
            </div>
          )}
          {backendConnected !== false && error && error.includes('Cannot connect to server') && (
            <div className="bg-destructive/5 border border-destructive/25 text-destructive px-4 py-3 rounded">
              <p className="font-semibold">⚠️ Cannot connect to backend server</p>
              <p className="text-sm mt-1">{error}</p>
              <p className="text-xs mt-2 text-destructive">
                💡 Tip: Run <code className="bg-destructive/10 px-1 rounded">python manage.py runserver 8000</code> in the backend directory
              </p>
            </div>
          )}
          {(backendConnected === null || checkingConnection) && (
            <div className="bg-blue-50 border border-primary/25 text-primary px-4 py-3 rounded flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
              <span>Checking backend connection...</span>
            </div>
          )}
          {backendConnected === true && !error && (
            <div className="bg-green-50 border border-success/25 text-success px-4 py-3 rounded text-sm">
              ✅ Backend connected successfully
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
              className="w-full px-4 py-3 text-base border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring sm:py-2"
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
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 pr-11 text-base border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring sm:py-2"
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground/85 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            <div className="mt-2 text-right">
              <Link
                href="/forgot-password"
                className="text-sm text-primary hover:text-primary/80 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-11 bg-primary text-white py-3 px-4 text-base rounded-md hover:bg-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors sm:py-2 sm:text-sm"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <AndroidAppDownload />
        </div>
      </div>
    </div>
  )
}




