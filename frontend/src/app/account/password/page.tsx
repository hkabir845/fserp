'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Sidebar from '@/components/Sidebar'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

export default function ChangePasswordPage() {
  const router = useRouter()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [nextPw, setNextPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const t = localStorage.getItem('access_token')
    if (!t) router.replace('/login')
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (nextPw.length < 8) {
      toast.error('New password must be at least 8 characters.')
      return
    }
    if (nextPw !== confirm) {
      toast.error('New passwords do not match.')
      return
    }
    if (nextPw === current) {
      toast.error('New password must be different from the current password.')
      return
    }
    setLoading(true)
    try {
      await api.post('/auth/change-password/', {
        current_password: current,
        new_password: nextPw,
      })
      toast.success('Password updated successfully.')
      setCurrent('')
      setNextPw('')
      setConfirm('')
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } }
      const msg = ax.response?.data?.detail || 'Could not update password.'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-6 md:p-10">
        <div className="mx-auto max-w-lg">
          <h1 className="text-2xl font-bold text-gray-900">Change password</h1>
          <p className="mt-1 text-sm text-gray-600">
            For your security, enter your current password, then choose a new one.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-8 space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <div>
              <label htmlFor="cur" className="block text-sm font-medium text-gray-700 mb-1">
                Current password
              </label>
              <input
                id="cur"
                type={show ? 'text' : 'password'}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                autoComplete="current-password"
                required
              />
            </div>
            <div>
              <label htmlFor="newp" className="block text-sm font-medium text-gray-700 mb-1">
                New password
              </label>
              <div className="relative">
                <input
                  id="newp"
                  type={show ? 'text' : 'password'}
                  value={nextPw}
                  onChange={(e) => setNextPw(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-gray-900"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? 'Hide passwords' : 'Show passwords'}
                >
                  {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">Minimum 8 characters.</p>
            </div>
            <div>
              <label htmlFor="cfm" className="block text-sm font-medium text-gray-700 mb-1">
                Confirm new password
              </label>
              <input
                id="cfm"
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Update password
              </button>
              <Link href="/dashboard" className="text-sm text-gray-600 hover:text-gray-900">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
