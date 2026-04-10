'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Database, Download, Upload, AlertTriangle } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import {
  RESTORE_CONFIRM_PHRASE,
  downloadTenantBackupForCurrentCompany,
  restoreTenantBackupForCurrentCompany,
} from '@/utils/tenantBackup'

export default function BackupRestorePage() {
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
    if (r !== 'admin' && r !== 'super_admin') {
      setLoading(false)
      return
    }
    api
      .get('/companies/current/')
      .then((res) => {
        const d = res.data
        const name = (d?.name || d?.company_name || '').trim() || `Company #${d?.id}`
        setCompanyLabel(name)
      })
      .catch(() => setCompanyLabel(''))
      .finally(() => setLoading(false))
  }, [router])

  const canUse = userRole === 'admin' || userRole === 'super_admin'

  const onDownload = async () => {
    setDownloading(true)
    try {
      await downloadTenantBackupForCurrentCompany(api)
      toast.success('Backup downloaded')
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to download backup'
      toast.error(msg)
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
        'This permanently deletes all ERP data for the current company and replaces it from the backup file. Continue?'
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
        'Restore failed'
      toast.error(msg)
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
          <p className="text-gray-600">Only company administrators can access backup and restore.</p>
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
              <h1 className="text-3xl font-bold text-gray-900">Backup &amp; Restore</h1>
              <p className="mt-1 text-gray-600">
                Export or replace all data for the company you are working in now
                {companyLabel ? (
                  <>
                    : <span className="font-semibold text-gray-800">{companyLabel}</span>
                  </>
                ) : null}
                . Super admins: select the tenant in the sidebar before downloading or restoring.
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Download backup</h2>
              <p className="mt-2 text-sm text-gray-600">
                JSON snapshot of this tenant (stations, accounting, customers, loans, etc.). Store it securely;
                it contains business data.
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
                    Restoring <strong>deletes all current data</strong> for this company and reloads the file.
                    The backup must have been created for the <strong>same company ID</strong>.
                  </p>
                </div>
              </div>
              <label className="mt-4 block text-sm font-medium text-gray-800">
                Type <code className="rounded bg-gray-200 px-1">{RESTORE_CONFIRM_PHRASE}</code> to enable restore
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
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
                {restoring ? 'Restoring…' : 'Choose backup file & restore'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
