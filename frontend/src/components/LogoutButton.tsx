'use client'

import { LogOut } from 'lucide-react'

export function performLogout() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('user')
  window.location.href = '/login'
}

type LogoutButtonProps = {
  className?: string
  showLabel?: boolean
}

/** Sign out — pass `className` for placement (sidebar footer, POS header, etc.). */
export default function LogoutButton({ className = '', showLabel = true }: LogoutButtonProps) {
  return (
    <button
      type="button"
      onClick={performLogout}
      className={
        className ||
        'inline-flex items-center gap-2 rounded-lg border-2 border-red-500 bg-white px-3 py-2 text-sm font-medium text-destructive shadow-sm transition-colors hover:border-red-600 hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2'
      }
      aria-label="Log out"
    >
      <LogOut className="h-4 w-4 shrink-0" aria-hidden />
      {showLabel ? <span>Logout</span> : null}
    </button>
  )
}
