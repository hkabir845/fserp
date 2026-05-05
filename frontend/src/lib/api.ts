/**
 * API client for making HTTP requests to the backend
 * SSR-safe: All browser API access is guarded
 */
import axios from 'axios'

/** Production API host (no env / dev switching). */
export const FALLBACK_BACKEND_ORIGIN = 'https://api.mahasoftcorporation.com'

/** Production app origin (password-reset links, help text). */
export const FALLBACK_FRONTEND_ORIGIN = 'https://mahasoftcorporation.com'

const PRODUCTION_BACKEND_ORIGIN = FALLBACK_BACKEND_ORIGIN.replace(/\/+$/, '')

function backendOriginFromPublicEnv(): string {
  if (typeof process === 'undefined') return ''
  const raw =
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    ''
  if (!raw) return ''
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
    return new URL(withScheme).origin.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function resolvedBackendOrigin(): string {
  return backendOriginFromPublicEnv() || PRODUCTION_BACKEND_ORIGIN
}

export function getApiBaseUrl(): string {
  return `${resolvedBackendOrigin()}/api`
}

/** Backend origin without `/api` (Django serves `/health` at root, not under `/api/`). */
export function getBackendOrigin(): string {
  return resolvedBackendOrigin()
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

/**
 * Same logical API host for auth stamping: `http://127.0.0.1:8000` ≡ `http://localhost:8000`.
 * Without this, switching between loopback hostnames clears the session and causes 401 on every request.
 */
export function canonicalApiOriginForAuth(origin: string): string {
  const raw = origin.trim()
  if (!raw) return ''
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
    const u = new URL(withScheme)
    const h = u.hostname
    if (h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1') {
      u.hostname = 'localhost'
    }
    return u.origin.toLowerCase()
  } catch {
    return normalizeBackendOrigin(raw)
  }
}

export function setAuthApiOriginStamp(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(FSERP_AUTH_API_ORIGIN_KEY, canonicalApiOriginForAuth(getBackendOrigin()))
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
    localStorage.removeItem('fserp_report_station_id')
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
    const cur = canonicalApiOriginForAuth(getBackendOrigin())

    if (stored) {
      if (canonicalApiOriginForAuth(stored) === cur) return false
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

/** Apex / marketing hosts — not tenant subdomains (no `X-Tenant-Subdomain`). */
const APP_SHELL_HOSTNAMES = new Set<string>(['mahasoftcorporation.com', 'www.mahasoftcorporation.com'])

function getTenantSubdomain(): string | null {
  if (typeof window === 'undefined' || !window.location) {
    return null
  }
  try {
    const hostname = window.location.hostname.toLowerCase()
    if (APP_SHELL_HOSTNAMES.has(hostname)) {
      return null
    }
    const parts = hostname.split('.')
    const base = 'mahasoftcorporation.com'
    if (parts.length >= 3 && hostname.endsWith(`.${base}`)) {
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
      // Resolve API host on each request so it always matches current window + env (important after deploy).
      config.baseURL = getApiBaseUrl()

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
      // Optional: multi-site report filter (backend ignores if user has home_station in DB)
      try {
        const sid = localStorage.getItem('fserp_report_station_id')?.trim()
        let hasHome = false
        const ustr = localStorage.getItem('user')
        if (ustr) {
          try {
            const u = JSON.parse(ustr) as { home_station_id?: unknown }
            if (u?.home_station_id != null && u.home_station_id !== '') hasHome = true
          } catch {
            /* ignore */
          }
        }
        if (sid && /^\d+$/.test(sid) && !hasHome) {
          config.headers['X-Selected-Station-Id'] = sid
        }
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
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

    return Promise.reject(error)
  }
)

export default api
