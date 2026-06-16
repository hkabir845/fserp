import { backendUrl } from './api'

export interface LoginCredentials {
  username: string
  password: string
  platformAccess?: boolean  // For superadmin to access platform
}

export interface User {
  id: number
  email: string
  full_name: string
  is_superadmin?: boolean
}

export async function login(credentials: LoginCredentials, platformAccess: boolean = false) {
  const formData = new FormData()
  formData.append('username', credentials.username)
  formData.append('password', credentials.password)
  
  const response = await fetch(backendUrl('/api/v1/auth/login'), {
    method: 'POST',
    body: formData,
  })
  
  if (!response.ok) {
    throw new Error('Login failed')
  }
  
  const data = await response.json()
  if (typeof window !== 'undefined') {
    // Store ERP token - for superadmin, this same token works for both ERP and Platform
    localStorage.setItem('access_token', data.access_token)
    
    // For superadmin, store same token as platform token for seamless switching
    // Backend will handle authentication based on route and token payload
    if (credentials.username === 'superadmin@fmerp.com') {
      localStorage.setItem('platform_token', data.access_token)
    }
    
    // Default to ERP mode
    localStorage.setItem('is_platform_mode', 'false')
    
    // Set default tenant domain if not set (for initial login)
    // This ensures API calls work immediately after login
    if (!localStorage.getItem('tenant_domain') && !localStorage.getItem('company_mode')) {
      // Default to localhost tenant or first available tenant
      localStorage.setItem('tenant_domain', 'localhost')
      localStorage.setItem('company_mode', 'tenant')
    }
  }
  return data
}

export async function getCurrentUser(): Promise<User> {
  const { api } = await import('./api')
  const response = await api.get('/auth/me')
  return response.data
}

export function logout() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('access_token')
    localStorage.removeItem('platform_token')
    localStorage.removeItem('is_platform_mode')
    window.location.href = '/login'
  }
}

