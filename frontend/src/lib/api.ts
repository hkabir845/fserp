/**
 * API client for making HTTP requests to the backend
 * SSR-safe: All browser API access is guarded
 */
import axios from 'axios'

/**
 * Canonical API base (.../api). Set `NEXT_PUBLIC_API_BASE_URL` in `frontend/.env` (production) or
 * `frontend/.env.development` (local Django). Path may include `/api` — never duplicate `/api/api`.
 */
/** Default when env is missing at build time — production API (local dev uses `.env.development`). */
export const FALLBACK_BACKEND_ORIGIN = 'https://api.mahasoftcorporation.com'

const DEFAULT_BACKEND_ORIGIN = FALLBACK_BACKEND_ORIGIN

/** Default UI origin for help text; `next dev` sets `NEXT_PUBLIC_APP_ORIGIN` via `.env.development`. */
export const FALLBACK_FRONTEND_ORIGIN =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_APP_ORIGIN?.trim()) ||
  'https://mahasoftcorporation.com'

/**
 * `runserver` is HTTP-only. If env still has `https://localhost` / loopback, the browser throws
 * net::ERR_SSL_PROTOCOL_ERROR — force http. Set `NEXT_PUBLIC_API_FORCE_HTTPS_LOCAL=true` if you terminate TLS locally.
 */
function forceHttpForLoopbackApiBase(origin: string): string {
  if (process.env.NEXT_PUBLIC_API_FORCE_HTTPS_LOCAL === 'true') return origin.trim().replace(/\/+$/, '')
  const t = origin.trim().replace(/\/+$/, '')
  try {
    const withScheme = /^https?:\/\//i.test(t) ? t : `http://${t}`
    const u = new URL(withScheme)
    const h = u.hostname.toLowerCase()
    const loopback = h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
    if (u.protocol === 'https:' && loopback) {
      u.protocol = 'http:'
      return u.href.replace(/\/+$/, '')
    }
  } catch {
    /* keep raw */
  }
  return t
}

function rawBackendBaseFromEnv(): string {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_BACKEND_ORIGIN).trim().replace(/\/+$/, '')
  return forceHttpForLoopbackApiBase(base)
}

/** API hostname is loopback (Django on same machine). */
function isLoopbackApiHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
}

/**
 * Browser UI is clearly local dev: plain loopback or tenant subdomains like `adib.localhost`
 * (resolved to 127.0.0.1). Used to prefer local Django when env still points at production.
 */
function isLocalhostStyleDevHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true
  if (h.endsWith('.localhost')) return true
  return false
}

/** True for typical LAN / machine-local UI hosts — do not rewrite API to production here. */
function isPrivateOrLocalPageHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true
  if (h.endsWith('.localhost')) return true
  if (/^192\.168\./.test(h)) return true
  if (/^10\./.test(h)) return true
  const m = /^172\.(\d+)\./.exec(h)
  if (m) {
    const oct = Number(m[1])
    if (oct >= 16 && oct <= 31) return true
  }
  return false
}

/**
 * If the JS bundle mistakenly inlined a loopback API but the page is served from a public host
 * (e.g. VPS), use the production API so deployment never talks to localhost.
 */
function effectiveBackendBaseFromEnv(): string {
  let base = rawBackendBaseFromEnv()
  if (typeof window === 'undefined') return base.replace(/\/api\/?$/, '')

  try {
    const withScheme = /^https?:\/\//i.test(base) ? base : `https://${base}`
    const apiHost = new URL(withScheme).hostname.toLowerCase()
    const pageHost = window.location.hostname
    const useProdApi = process.env.NEXT_PUBLIC_USE_PRODUCTION_API === 'true'
    const devBackend =
      (process.env.NEXT_PUBLIC_DEV_BACKEND_ORIGIN || 'http://localhost:8000').trim().replace(/\/+$/, '')

    // Tenant UI on *.localhost but NEXT_PUBLIC_* still targets prod (e.g. .env.local) → local Django.
    if (!useProdApi && isLocalhostStyleDevHost(pageHost) && !isLoopbackApiHost(apiHost)) {
      base = devBackend
    } else if (isLoopbackApiHost(apiHost) && !isPrivateOrLocalPageHost(pageHost)) {
      base = FALLBACK_BACKEND_ORIGIN.trim().replace(/\/+$/, '')
    }
  } catch {
    /* keep base */
  }
  return forceHttpForLoopbackApiBase(base.replace(/\/api\/?$/, ''))
}

export function getApiBaseUrl(): string {
  const withoutApi = effectiveBackendBaseFromEnv().replace(/\/api\/?$/, '')
  return `${withoutApi}/api`
}

/** Backend origin without `/api` (Django serves `/health` at root, not under `/api/`). */
export function getBackendOrigin(): string {
  return effectiveBackendBaseFromEnv()
}

/** API docs index (`/api/docs/`); host follows `NEXT_PUBLIC_API_BASE_URL`. */
export function getApiDocsUrl(): string {
  return `${getBackendOrigin().replace(/\/+$/, '')}/api/docs/`
}

/** localStorage: API origin that issued the current tokens (avoids 401 spam after switching prod ↔ local). */
export const FSERP_AUTH_API_ORIGIN_KEY = 'fserp_auth_api_origin'

export function normalizeBackendOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase()
}

export function setAuthApiOriginStamp(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(FSERP_AUTH_API_ORIGIN_KEY, normalizeBackendOrigin(getBackendOrigin()))
  } catch {
    /* ignore */
  }
}

export function clearAuthStorage(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('user')
    localStorage.removeItem('superadmin_selected_company')
    localStorage.removeItem(FSERP_AUTH_API_ORIGIN_KEY)
  } catch {
    /* ignore */
  }
}

/** If tokens were stamped for another API host, clear session. Call before authenticated requests (see AuthApiOriginGuard). */
export function clearAuthIfApiOriginMismatch(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const token = localStorage.getItem('access_token')?.trim()
    if (!token) return false
    const stored = localStorage.getItem(FSERP_AUTH_API_ORIGIN_KEY)
    const cur = normalizeBackendOrigin(getBackendOrigin())

    if (stored) {
      if (normalizeBackendOrigin(stored) === cur) return false
      clearAuthStorage()
      return true
    }

    // No origin stamp (sessions from before FSERP_AUTH_API_ORIGIN_KEY, or first load after deploy):
    // adopt the current backend URL without wiping tokens. Wrong-host JWTs will still 401; user can sign in again.
    // (Previously we cleared all auth on every localhost load without a stamp, which broke valid tenant sessions.)
    setAuthApiOriginStamp()
    return false
  } catch {
    return false
  }
}

const api = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
})

/**
 * Django routes use trailing slashes. Requests without them 301 redirect; clients often
 * omit Authorization on redirect → bogus 401s. Normalize path (before ?) for all methods.
 */
function appendDjangoTrailingSlash(url: string | undefined): string | undefined {
  if (!url || url.includes('://')) return url
  const q = url.indexOf('?')
  const pathOnly = q === -1 ? url : url.slice(0, q)
  const query = q === -1 ? '' : url.slice(q)
  if (!pathOnly || pathOnly.endsWith('/')) return url
  const segments = pathOnly.split('/').filter(Boolean)
  const last = segments[segments.length - 1] || ''
  if (last.includes('.')) return url
  return pathOnly + '/' + query
}

/** One shared refresh so parallel 401s (dashboard + broadcasts) do not race each other. */
let refreshInFlight: Promise<string | null> | null = null

function fetchNewAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  const rt = localStorage.getItem('refresh_token')?.trim()
  if (!rt) return Promise.resolve(null)
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const response = await axios.post(
        `${getApiBaseUrl().replace(/\/+$/, '')}/auth/refresh/`,
        { refresh_token: rt },
        { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
      )
      const access = response.data?.access_token
      if (!access) return null
      const trimmed = String(access).trim()
      localStorage.setItem('access_token', trimmed)
      return trimmed
    } catch {
      try {
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
        localStorage.removeItem('user')
      } catch {
        /* ignore */
      }
      return null
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

/**
 * Hostnames where the UI is served (e.g. fs.example.com) — not tenant vanity hosts.
 * Without this, a 3-part host like app.example.com is misread as tenant "app"
 * and every request sends X-Tenant-Subdomain, which breaks CORS if the API omits that header.
 * Set in .env: NEXT_PUBLIC_APP_SHELL_HOSTNAMES=app.example.com,www.app.example.com
 */
function _appShellHostnames(): Set<string> {
  const raw = process.env.NEXT_PUBLIC_APP_SHELL_HOSTNAMES || ''
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )
}

// Helper function to safely get tenant subdomain (only on client)
function getTenantSubdomain(): string | null {
  if (typeof window === 'undefined' || !window.location) {
    return null
  }
  try {
    const hostname = window.location.hostname.toLowerCase()
    if (_appShellHostnames().has(hostname)) {
      return null
    }
    const parts = hostname.split('.')

    if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
      if (parts.length > 1 && !['localhost', '127', '0', '1'].includes(parts[0])) {
        return parts[0]
      }
      return null
    }

    if (parts.length >= 3) {
      return parts[0]
    }

    return null
  } catch {
    return null
  }
}

/** Align with backend user_is_super_admin — send X-Selected-Company-Id when a tenant is picked. */
export function isSuperAdminRole(role: unknown): boolean {
  if (role == null || typeof role !== 'string') return false
  const n = role.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return n === 'super_admin' || n === 'superadmin'
}

// Request interceptor to add auth token, tenant subdomain, and ensure trailing slashes for list endpoints
api.interceptors.request.use(
  (config) => {
    // CRITICAL: Return immediately if on server-side
    if (typeof window === 'undefined') {
      return config
    }
    
    // All browser API access must be inside try-catch and window checks
    try {
      // Add auth token
      try {
        const token = localStorage.getItem('access_token')?.trim()
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
      } catch (e) {
        // localStorage not available
      }
      
      // Add tenant subdomain header if available
      try {
        const subdomain = getTenantSubdomain()
        if (subdomain) {
          config.headers['X-Tenant-Subdomain'] = subdomain
        }
      } catch (e) {
        // Ignore tenant errors
      }
      
      // Add selected company ID for superadmin context switching
      try {
        const selectedCompanyStr = localStorage.getItem('superadmin_selected_company')
        if (selectedCompanyStr && selectedCompanyStr !== 'undefined' && selectedCompanyStr !== 'null') {
          try {
            const selectedCompany = JSON.parse(selectedCompanyStr)
            if (selectedCompany && selectedCompany.id) {
              // Check if user is superadmin
              const userStr = localStorage.getItem('user')
              if (userStr && userStr !== 'undefined' && userStr !== 'null') {
                try {
                  const user = JSON.parse(userStr)
                  if (user && isSuperAdminRole(user.role)) {
                    config.headers['X-Selected-Company-Id'] = String(selectedCompany.id)
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      } catch (e) {
        // Ignore localStorage errors
      }
    } catch (e) {
      // Silently handle any errors during interceptor execution
      // Don't log in production to avoid noise
      if (process.env.NODE_ENV === 'development') {
        console.warn('Error in API request interceptor:', e)
      }
    }

    // FormData: must not send application/json — browser/axios must set multipart boundary.
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      const h = config.headers
      if (h && typeof (h as { delete?: (k: string) => void }).delete === 'function') {
        ;(h as { delete: (k: string) => void }).delete('Content-Type')
      } else if (h && typeof h === 'object') {
        delete (h as Record<string, unknown>)['Content-Type']
      }
    }

    if (config.url) {
      config.url = appendDjangoTrailingSlash(config.url)
    }

    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor to handle token refresh and connection errors
api.interceptors.response.use(
  (response) => {
    if (typeof window !== 'undefined' && response.status >= 200 && response.status < 300) {
      try {
        if (localStorage.getItem('access_token')?.trim()) {
          setAuthApiOriginStamp()
        }
      } catch {
        /* ignore */
      }
    }
    return response
  },
  async (error) => {
    const originalRequest = error.config

    // Handle connection errors (server not running, connection reset, etc.)
    if (!error.response && (
      error.code === 'ECONNREFUSED' || 
      error.code === 'ERR_CONNECTION_RESET' ||
      error.code === 'ERR_NETWORK' ||
      error.message?.includes('Network Error') || 
      error.message?.includes('ERR_CONNECTION_REFUSED') ||
      error.message?.includes('ERR_CONNECTION_RESET') ||
      error.message?.includes('Failed to fetch')
    )) {
      // Silently handle connection errors - don't log to console
      // Components will handle the error gracefully
      // Only log in development if explicitly debugging
      if (process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DEBUG_CONNECTION === 'true') {
        console.warn('Backend server connection error:', error.code || error.message)
        console.warn('Please ensure the server is running on', getApiBaseUrl())
      }
      return Promise.reject(error)
    }

    const reqUrl = originalRequest?.url || ''
    if (reqUrl.includes('auth/refresh')) {
      return Promise.reject(error)
    }

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true

      if (typeof window !== 'undefined') {
        const newAccess = await fetchNewAccessToken()
        if (newAccess) {
          // Axios v1 uses AxiosHeaders; assign both ways so the retried request always sends Bearer.
          const h = originalRequest.headers
          if (h && typeof (h as { set?: (k: string, v: string) => void }).set === 'function') {
            ;(h as { set: (k: string, v: string) => void }).set('Authorization', `Bearer ${newAccess}`)
          } else {
            originalRequest.headers = originalRequest.headers || {}
            ;(originalRequest.headers as Record<string, string>).Authorization = `Bearer ${newAccess}`
          }
          return api(originalRequest)
        }
        try {
          clearAuthStorage()
        } catch {
          /* ignore */
        }
        const path = window.location?.pathname || ''
        if (!path.startsWith('/login')) {
          window.location.assign('/login')
        }
      }
    }

    // Log 403 errors for debugging
    if (error.response?.status === 403 && process.env.NODE_ENV === 'development') {
      console.error('403 Forbidden - Permission denied')
      console.error('Required roles may not match user role')
      console.error('Error detail:', error.response?.data?.detail)
    }

    return Promise.reject(error)
  }
)

export default api
