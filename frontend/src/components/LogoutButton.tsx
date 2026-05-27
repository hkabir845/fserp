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

/** Sign out — fixed top-right placement is handled by the parent when `variant` is omitted. */
export default function LogoutButton({ className = '', showLabel = true }: LogoutButtonProps) {
  return (
    <button
      type="button"
      onClick={performLogout}
      className={
        className ||
        'inline-flex items-center gap-2 rounded-lg border-2 border-red-500 bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm transition-colors hover:border-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2'
      }
      aria-label="Log out"
    >
      <LogOut className="h-4 w-4 shrink-0" aria-hidden />
      {showLabel ? <span>Logout</span> : null}
    </button>
  )
}

/** Viewport top-right logout (all ERP pages with Sidebar). */
export function AppHeaderLogout() {
  return (
    <div
      className="pointer-events-none fixed z-[60] flex justify-end"
      style={{
        top: 'max(0.75rem, env(safe-area-inset-top, 0px))',
        right: 'max(0.75rem, env(safe-area-inset-right, 0px))',
        left: 'max(3.5rem, env(safe-area-inset-left, 0px))',
      }}
    >
      <div className="pointer-events-auto ml-auto">
        <LogoutButton />
      </div>
    </div>
  )
}
