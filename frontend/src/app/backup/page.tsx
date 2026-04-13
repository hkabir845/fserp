'use client'

/**
 * Tenant Backup & Restore — company owner (admin) in ERP / Management.
 * Super admin platform backup is under SaaS: /admin/backup
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { Database, Download, Upload, AlertTriangle, Info } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { isSuperAdminRole } from '@/lib/api'
import {
  RESTORE_CONFIRM_PHRASE,
  downloadTenantBackupForCurrentCompany,
  restoreTenantBackupForCurrentCompany,
} from '@/utils/tenantBackup'
import { safeLogError } from '@/utils/connectionError'

function TenantBackupRestoreContent() {
  const router = useRouter()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [companyLabel, setCompanyLabel] = useState('')
  const [userRole, setUserRole] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
    if (!token) {
      router.push('/login')
      return
    }
    let u: { role?: string } | null = null
    try {
      const raw = localStorage.getItem('user')
      if (raw && raw !== 'undefined') u = JSON.parse(raw)
    } catch {
      /* ignore */
    }
    const r = (u?.role || '').toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
    setUserRole(r)

    if (isSuperAdminRole(r)) {
      router.replace('/admin/backup')
      return
    }

    const load = async () => {
      if (r !== 'admin') {
        setLoading(false)
        return
      }
      try {
        const cur = await api.get('/companies/current/')
        const d = cur.data
        const name = (d?.name || d?.company_name || '').trim() || `Company #${d?.id}`
        setCompanyLabel(name)
      } catch {
        setCompanyLabel('')
      }
      setLoading(false)
    }
    load()
  }, [router])

  const canUse = userRole === 'admin'

  const onDownload = async () => {
    setDownloading(true)
    try {
      await downloadTenantBackupForCurrentCompany(api)
      toast.success('Backup downloaded')
    } catch (e: unknown) {
      const msg =
        (e as Error)?.message ||
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to download backup'
      toast.error(typeof msg === 'string' ? msg : 'Failed to download backup')
      safeLogError('backup download', e)
    } finally {
      setDownloading(false)
    }
  }

  const onPickFile = () => fileRef.current?.click()

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (confirmText.trim() !== RESTORE_CONFIRM_PHRASE) {
      toast.error(`Type the confirmation phrase exactly: ${RESTORE_CONFIRM_PHRASE}`)
      return
    }
    if (
      !window.confirm(
        `This permanently deletes all ERP data for ${companyLabel || 'this company'} and replaces it from the backup file. Continue?`
      )
    ) {
      return
    }
    setRestoring(true)
    try {
      const res = await restoreTenantBackupForCurrentCompany(api, file, RESTORE_CONFIRM_PHRASE)
      toast.success(
        `Restored ${res.data?.restored_objects ?? ''} records. You may need to refresh or log in again.`
      )
      setConfirmText('')
      window.location.reload()
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as Error)?.message ||
        'Restore failed'
      toast.error(typeof msg === 'string' ? msg : 'Restore failed')
      safeLogError('backup restore', err)
    } finally {
      setRestoring(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    )
  }

  if (!canUse) {
    return (
      <div className="page-with-sidebar flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="text-gray-600">
            Only the company administrator can access backup and restore here. Super admins: use{' '}
            <strong>SaaS → Backup &amp; Restore</strong> for any tenant.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-with-sidebar flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl p-8">
          <div className="mb-8 flex items-start gap-3">
            <div className="rounded-lg bg-blue-100 p-3">
              <Database className="h-8 w-8 text-blue-700" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">Your organization</p>
              <h1 className="text-3xl font-bold text-gray-900">Backup and restore</h1>
              <p className="mt-1 text-gray-600">
                Export or replace all data for <span className="font-semibold text-gray-800">{companyLabel || 'your company'}</span>
                . Super admins: pick the tenant in the company switcher, or use the SaaS menu for any company.
              </p>
            </div>
          </div>

          <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
            <div className="flex gap-2">
              <Info className="h-5 w-5 shrink-0 text-slate-500" />
              <div>
                <p className="font-medium text-slate-900">Scope</p>
                <p className="mt-1">
                  Applies to your signed-in tenant (the company selected in the header switcher when you use multiple
                  contexts). The backup file is tied to your company ID.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Download backup</h2>
              <p className="mt-2 text-sm text-gray-600">
                JSON snapshot of this tenant (chart of accounts, stations, customers, journals, loans, etc.). Large
                tenants may take several minutes.
              </p>
              <button
                type="button"
                onClick={onDownload}
                disabled={downloading}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-400"
              >
                <Download className="h-4 w-4" />
                {downloading ? 'Preparing…' : 'Download backup'}
              </button>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
              <div className="flex gap-2 text-amber-900">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <div>
                  <h2 className="text-lg font-semibold">Restore from backup</h2>
                  <p className="mt-2 text-sm text-amber-900/90">
                    Restoring deletes all current data for this company and reloads the file. The backup must have been
                    created for the same company ID.
                  </p>
                </div>
              </div>
              <label className="mt-4 block text-sm font-medium text-gray-800">
                Type <code className="rounded bg-amber-100 px-1">{RESTORE_CONFIRM_PHRASE}</code> to enable restore
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="mt-2 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-sm"
                placeholder={RESTORE_CONFIRM_PHRASE}
                autoComplete="off"
              />
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={onFileChange}
              />
              <button
                type="button"
                onClick={onPickFile}
                disabled={restoring || confirmText.trim() !== RESTORE_CONFIRM_PHRASE}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-700 bg-white px-4 py-2.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {restoring ? 'Restoring…' : 'Choose backup file and restore'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function BackupRestorePage() {
  return (
    <CompanyProvider>
      <TenantBackupRestoreContent />
    </CompanyProvider>
  )
}
