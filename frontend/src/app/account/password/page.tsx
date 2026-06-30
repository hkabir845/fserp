'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { AQ_HERO_BTN_PRIMARY } from '@/components/aquaculture/AquacultureUi'
import api from '@/lib/api'
import { useToast } from '@/components/Toast'
import { usePageMeta } from '@/hooks/usePageMeta'
import { useErpCommonT } from '@/lib/moduleI18n/erpCommon'
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'

export default function ChangePasswordPage() {
  const router = useRouter()
  const toast = useToast()
  const pageMeta = usePageMeta()
  const tr = useErpCommonT()
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
    <PageLayout>
      <ErpPageShell
        flush
        showBackLink={false}
        titleId="change-password-title"
        eyebrow={pageMeta.eyebrow}
        eyebrowIcon={KeyRound}
        title={pageMeta.title}
        titleIcon={KeyRound}
        description={pageMeta.description}
        maxWidthClass="max-w-[640px]"
        contentClassName="mt-4"
      >
        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-2xl border border-border/80 bg-white p-6 shadow-sm"
        >
          <div>
            <label htmlFor="cur" className="mb-1 block text-sm font-medium text-foreground/85">
              {tr('currentPassword')}
            </label>
            <input
              id="cur"
              type={show ? 'text' : 'password'}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-foreground"
              autoComplete="current-password"
              required
            />
          </div>
          <div>
            <label htmlFor="newp" className="mb-1 block text-sm font-medium text-foreground/85">
              {tr('newPassword')}
            </label>
            <div className="relative">
              <input
                id="newp"
                type={show ? 'text' : 'password'}
                value={nextPw}
                onChange={(e) => setNextPw(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 pr-10 text-foreground"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide passwords' : 'Show passwords'}
              >
                {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Minimum 8 characters.</p>
          </div>
          <div>
            <label htmlFor="cfm" className="mb-1 block text-sm font-medium text-foreground/85">
              {tr('confirmPassword')}
            </label>
            <input
              id="cfm"
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-foreground"
              autoComplete="new-password"
              required
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50 ${AQ_HERO_BTN_PRIMARY}`}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {tr('updatePassword')}
            </button>
            <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
              Cancel
            </Link>
          </div>
        </form>
      </ErpPageShell>
    </PageLayout>
  )
}
