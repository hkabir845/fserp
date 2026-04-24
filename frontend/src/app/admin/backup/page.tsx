'use client'

/**
 * Platform Backup & Restore — SaaS area only (super admin).
 * Per-tenant company-owner backup lives at /backup (ERP Management).
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { useRequireSaasDashboardMode } from '@/hooks/useRequireSaasDashboardMode'
import { Database, Download, Upload, AlertTriangle, RefreshCw, Info } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { isSuperAdminRole } from '@/lib/api'
import {
  RESTORE_CONFIRM_PHRASE,
  downloadTenantBackupForAdminCompany,
  restoreTenantBackupForAdminCompany,
  fetchBackupPreviewForAdminCompany,
  type BackupPreviewPayload,
} from '@/utils/tenantBackup'
import { safeLogError } from '@/utils/connectionError'

interface CompanyRow {
  id: number
  name: string
  is_active?: boolean
}

function SaasBackupRestoreContent() {
  useRequireSaasDashboardMode()
  const router = useRouter()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [targetCompanyId, setTargetCompanyId] = useState<number | null>(null)
  const [preview, setPreview] = useState<BackupPreviewPayload | null>(null)

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
    if (!isSuperAdminRole(r)) {
      router.replace('/backup')
      return
    }

    const load = async () => {
      try {
        const res = await api.get('/admin/companies/', { params: { limit: 500 } })
        const rows: CompanyRow[] = Array.isArray(res.data)
          ? res.data.map((c: { id: number; name?: string; company_name?: string; is_active?: boolean }) => ({
              id: c.id,
              name: String(c.name || c.company_name || `Company #${c.id}`).trim(),
              is_active: c.is_active,
            }))
          : []
        setCompanies(rows)
        try {
          const saved = localStorage.getItem('superadmin_selected_company')
          if (saved) {
            const p = JSON.parse(saved)
            if (p?.id && rows.some((x) => x.id === p.id)) {
              setTargetCompanyId(p.id)
            } else if (rows.length > 0) {
              setTargetCompanyId(rows[0].id)
            }
          } else if (rows.length > 0) {
            setTargetCompanyId(rows[0].id)
          }
        } catch {
          if (rows.length > 0) setTargetCompanyId(rows[0].id)
        }
      } catch (e) {
        safeLogError('admin backup companies', e)
        toast.error('Could not load companies')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [router])

  const loadPreview = async () => {
    if (!targetCompanyId) return
    setPreviewLoading(true)
    setPreview(null)
    try {
      const p = await fetchBackupPreviewForAdminCompany(api, targetCompanyId)
      setPreview(p)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Could not load backup preview'
      toast.error(typeof msg === 'string' ? msg : 'Preview failed')
      safeLogError('backup preview', e)
    } finally {
      setPreviewLoading(false)
    }
  }

  const onDownload = async () => {
    if (targetCompanyId == null) return
    setDownloading(true)
    try {
      await downloadTenantBackupForAdminCompany(api, targetCompanyId)
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
    if (!file || targetCompanyId == null) return
    if (confirmText.trim() !== RESTORE_CONFIRM_PHRASE) {
      toast.error(`Type the confirmation phrase exactly: ${RESTORE_CONFIRM_PHRASE}`)
      return
    }
    if (
      !window.confirm(
        `This permanently deletes all ERP data for company ID ${targetCompanyId} and replaces it from the backup file. Continue?`
      )
    ) {
      return
    }
    setRestoring(true)
    try {
      const res = await restoreTenantBackupForAdminCompany(api, targetCompanyId, file, RESTORE_CONFIRM_PHRASE)
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

  return (
    <div className="page-with-sidebar flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl app-scroll-pad">
          <div className="mb-8 flex items-start gap-3">
            <div className="rounded-lg bg-indigo-100 p-3">
              <Database className="h-8 w-8 text-indigo-800" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">SaaS platform</p>
              <h1 className="text-3xl font-bold text-gray-900">Backup and restore (tenants)</h1>
              <p className="mt-1 text-gray-600">
                Export or replace tenant data by company. JSON format, schema version 1. Use for disaster recovery and
                migration — protect files like production credentials.
              </p>
            </div>
          </div>

          {companies.length > 0 && (
            <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/80 p-5 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-indigo-900">Target tenant</h2>
              <p className="mt-1 text-sm text-indigo-900/90">
                Select which company to back up or restore. Operations use admin API endpoints for that company ID.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="min-w-[220px] flex-1">
                  <label className="block text-xs font-medium text-indigo-900">Company</label>
                  <select
                    value={targetCompanyId ?? ''}
                    onChange={(e) => {
                      const v = e.target.value ? parseInt(e.target.value, 10) : null
                      setTargetCompanyId(Number.isFinite(v as number) ? (v as number) : null)
                      setPreview(null)
                    }}
                    className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900"
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.is_active === false ? ' (inactive)' : ''} — ID {c.id}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={loadPreview}
                  disabled={previewLoading || targetCompanyId == null}
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-100 disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${previewLoading ? 'animate-spin' : ''}`} />
                  {previewLoading ? 'Loading…' : 'Load metadata'}
                </button>
              </div>
              {preview && (
                <div className="mt-4 rounded-lg border border-indigo-100 bg-white p-4 text-sm text-gray-800">
                  <p className="font-medium">{preview.company_name}</p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-gray-600">
                    <li>Company ID: {preview.company_id}</li>
                    <li>Schema version: {preview.schema_version}</li>
                    <li>Records in bundle (approx.): {preview.record_count}</li>
                    <li>Export timestamp (UTC): {preview.exported_at}</li>
                  </ul>
                </div>
              )}
            </div>
          )}

          {companies.length === 0 && (
            <p className="mb-6 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
              No companies found. Create a tenant first, then use backup and restore here.
            </p>
          )}

          <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
            <div className="flex gap-2">
              <Info className="h-5 w-5 shrink-0 text-slate-500" />
              <div>
                <p className="font-medium text-slate-900">Scope</p>
                <p className="mt-1">
                  {targetCompanyId != null
                    ? `Operations apply to the selected company (ID ${targetCompanyId}).`
                    : 'Select a company above.'}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Download backup</h2>
              <p className="mt-2 text-sm text-gray-600">
                JSON snapshot of the tenant. Large exports may take several minutes.
              </p>
              <button
                type="button"
                onClick={onDownload}
                disabled={downloading || targetCompanyId == null}
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
                    Restoring deletes all current data for the selected company and reloads the file. The backup must
                    match the same company ID. Ensure reverse-proxy upload size and timeouts are sufficient.
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
                disabled={restoring || confirmText.trim() !== RESTORE_CONFIRM_PHRASE || targetCompanyId == null}
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

export default function AdminBackupPage() {
  return (
    <CompanyProvider>
      <SaasBackupRestoreContent />
    </CompanyProvider>
  )
}
