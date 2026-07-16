/** Shared username/password login against FSERP auth endpoints. */

import { isCapacitorNativeApp } from '@/lib/androidApp'
import { getApiBaseUrl, setAuthApiOriginStamp } from '@/lib/api'
import { formatApiErrorJson } from '@/utils/errorHandler'

export type LoginResult = {
  access_token: string
  refresh_token: string
  user: Record<string, unknown>
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function performLogin(username: string, password: string): Promise<LoginResult> {
  const baseUrl = getApiBaseUrl()
  const trimmedUser = username.trim()
  if (!trimmedUser) throw new Error('Username is required')
  if (!password) throw new Error('Password is required')

  /**
   * JSON first: CapacitorHttp (Android shell) often breaks multipart FormData, which used to
   * make login fail before the JSON fallback ran.
   */
  const endpoints: Array<{
    url: string
    body: BodyInit
    headers: Record<string, string>
  }> = [
    {
      url: `${baseUrl}/auth/login/json/`,
      body: JSON.stringify({ username: trimmedUser, password }),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    },
  ]

  if (!isCapacitorNativeApp()) {
    endpoints.push({
      url: `${baseUrl}/auth/login/form/`,
      body: (() => {
        const fd = new FormData()
        fd.append('username', trimmedUser)
        fd.append('password', password)
        return fd
      })(),
      headers: { Accept: 'application/json' },
    })
  }

  let lastError: Error | null = null
  for (const ep of endpoints) {
    try {
      const response = await fetchWithTimeout(ep.url, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-cache',
        credentials: 'omit',
        headers: ep.headers,
        body: ep.body,
      })
      if (!response.ok) {
        if (response.status === 404) continue
        let msg = 'Login failed'
        try {
          const ct = response.headers.get('content-type')
          if (ct?.includes('application/json')) {
            msg = formatApiErrorJson(await response.json(), 'Login failed')
          } else {
            msg = (await response.text()) || response.statusText
          }
        } catch {
          msg = response.statusText || 'Login failed'
        }
        if (response.status === 401 || response.status === 403) {
          throw new Error(msg)
        }
        lastError = new Error(msg)
        continue
      }
      const data = await response.json()
      if (!data?.access_token) throw new Error('No access token received')
      localStorage.setItem('access_token', String(data.access_token).trim())
      localStorage.setItem('refresh_token', String(data.refresh_token || '').trim())
      localStorage.setItem('user', JSON.stringify(data.user))
      setAuthApiOriginStamp()
      return data as LoginResult
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Login failed')
      const m = lastError.message.toLowerCase()
      if (
        m.includes('credential') ||
        m.includes('password') ||
        m.includes('unauthorized') ||
        m.includes('invalid')
      ) {
        throw lastError
      }
    }
  }
  throw lastError || new Error('Cannot connect to server. Try again.')
}
