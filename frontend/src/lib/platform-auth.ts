/**
 * Platform-level authentication (SaaS Management)
 */
import { api } from './api'

export interface PlatformUser {
  id: number
  email: string
  full_name: string
  is_super_admin: boolean
}

export interface PlatformLoginResponse {
  access_token: string
  token_type: string
  user: PlatformUser
}

export async function platformLogin(email: string, password: string): Promise<PlatformLoginResponse> {
  const response = await api.post('/platform/login', {
    email,
    password,
  })
  
  const data = response.data as PlatformLoginResponse
  
  // Store platform token separately
  if (typeof window !== 'undefined') {
    localStorage.setItem('platform_token', data.access_token)
    localStorage.setItem('platform_user', JSON.stringify(data.user))
    localStorage.setItem('is_platform_mode', 'true')
  }
  
  return data
}

export function platformLogout() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('platform_token')
    localStorage.removeItem('platform_user')
    localStorage.removeItem('is_platform_mode')
    localStorage.removeItem('access_token') // Also clear regular token
    // Redirect handled by calling function
  }
}

export function getPlatformUser(): PlatformUser | null {
  if (typeof window === 'undefined') return null
  const userStr = localStorage.getItem('platform_user')
  return userStr ? JSON.parse(userStr) : null
}

export function isPlatformMode(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem('is_platform_mode') === 'true'
}

export function getPlatformToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('platform_token')
}

