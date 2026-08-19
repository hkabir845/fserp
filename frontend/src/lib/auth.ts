/**
 * Session helpers for the signed-in user.
 *
 * Login itself lives in lib/authLogin.ts (Django /auth/login/json/). The old login() here
 * posted to /api/v1/auth/login on the retired FastAPI backend and was already unreferenced.
 */
export interface User {
  id: number
  email: string
  full_name: string
  is_superadmin?: boolean
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

