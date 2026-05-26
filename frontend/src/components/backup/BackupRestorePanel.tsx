'use client'

import { useRef, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { AlertTriangle, Download, Info, RefreshCw, Upload } from 'lucide-react'
import { useToast } from '@/components/Toast'
import {
  RESTORE_CONFIRM_PHRASE,
  downloadTenantBackupForAdminCompany,
  downloadTenantBackupForCurrentCompany,
  fetchBackupPreviewForAdminCompany,
  restoreTenantBackupForAdminCompany,
  restoreTenantBackupForCurrentCompany,
  type BackupPreviewPayload,
} from '@/utils/tenantBackup'
import { safeLogError } from '@/utils/connectionError'

export interface BackupCompanyOption {
  id: number
  name: string
  is_active?: boolean
}

type BackupRestorePanelProps =
  | {
      scope: 'tenant'
      api: AxiosInstance
      companyLabel: string
    }
  | {
      scope: 'saas'
      api: AxiosInstance
      companies: BackupCompanyOption[]
      targetCompanyId: number | null
      onTargetCompanyChange: (id: number | null) => void
    }

function extractErrorMessage(err: unknown, fallback: string): string {
  const msg =
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (err as Error)?.message ||
    fallback
  return typeof msg === 'string' ? msg : fallback
}

export default function BackupRestorePanel(props: BackupRestorePanelProps) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [downloading, setDownloading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [preview, setPreview] = useState<BackupPreviewPayload | null>(null)

  const isSaas = props.scope === 'saas'
  const companyLabel = isSaas
    ? props.companies.find((c) => c.id === props.targetCompanyId)?.name || `Company #${props.targetCompanyId ?? '?'}`
    : props.companyLabel
  const targetCompanyId = isSaas ? props.targetCompanyId : null
  const canOperate = isSaas ? targetCompanyId != null : true

  const loadPreview = async () => {
    if (!isSaas || targetCompanyId == null) return
    setPreviewLoading(true)
    setPreview(null)
    try {
      const p = await fetchBackupPreviewForAdminCompany(props.api, targetCompanyId)
      setPreview(p)
    } catch (e: unknown) {
      toast.error(extractErrorMessage(e, 'Could not load backup preview'))
      safeLogError('backup preview', e)
    } finally {
      setPreviewLoading(false)
    }
  }

  const onDownload = async () => {
    setDownloading(true)
    try {
      if (isSaas) {
        if (targetCompanyId == null) return
        await downloadTenantBackupForAdminCompany(props.api, targetCompanyId)
      } else {
        await downloadTenantBackupForCurrentCompany(props.api)
      }
      toast.success('Backup downloaded')
    } catch (e: unknown) {
      toast.error(extractErrorMessage(e, 'Failed to download backup'))
      safeLogError('backup download', e)
    } finally {
      setDownloading(false)
    }
  }

  const onPickFile = () => fileRef.current?.click()

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !canOperate) return
    if (confirmText.trim() !== RESTORE_CONFIRM_PHRASE) {
      toast.error(`Type the confirmation phrase exactly: ${RESTORE_CONFIRM_PHRASE}`)
      return
    }
    const confirmTarget = isSaas ? `company ID ${targetCompanyId}` : companyLabel || 'this company'
    if (
      !window.confirm(
        `This permanently deletes all ERP data for ${confirmTarget} and replaces it from the backup file. Continue?`
      )
    ) {
      return
    }
    setRestoring(true)
    try {
      const res = isSaas
        ? await restoreTenantBackupForAdminCompany(props.api, targetCompanyId!, file, RESTORE_CONFIRM_PHRASE)
        : await restoreTenantBackupForCurrentCompany(props.api, file, RESTORE_CONFIRM_PHRASE)
      toast.success(
        `Restored ${res.data?.restored_objects ?? ''} records. You may need to refresh or log in again.`
      )
      setConfirmText('')
      window.location.reload()
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Restore failed'))
      safeLogError('backup restore', err)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <>
      {isSaas && props.companies.length > 0 && (
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
                  props.onTargetCompanyChange(Number.isFinite(v as number) ? (v as number) : null)
                  setPreview(null)
                }}
                className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900"
              >
                {props.companies.map((c) => (
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

      {isSaas && props.companies.length === 0 && (
        <p className="mb-6 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
          No companies found. Create a tenant first, then use backup and restore here.
        </p>
      )}

      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
        <div className="flex gap-2">
          <Info className="h-5 w-5 shrink-0 text-slate-500" />
          <div>
            <p className="font-medium text-slate-900">Scope</p>
            {isSaas ? (
              <>
                <p className="mt-1">
                  {targetCompanyId != null
                    ? `Per-tenant full application backup for company ID ${targetCompanyId} (one legal entity). Platform-wide database dumps are separate (PostgreSQL / host backups).`
                    : 'Select a company above.'}
                </p>
                <p className="mt-2 text-slate-600">
                  Company owners use Management → Backup &amp; Restore for their own tenant. Super admins can run the
                  same export/restore here for any tenant.
                </p>
              </>
            ) : (
              <p className="mt-1">
                Applies to your signed-in tenant (the company selected in the header switcher when you use multiple
                contexts). The backup file is tied to your company ID and includes portal organization settings used for
                login routing.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Download backup</h2>
          <p className="mt-2 text-sm text-gray-600">
            {isSaas
              ? 'JSON snapshot of the tenant. Large exports may take several minutes.'
              : 'JSON snapshot of this tenant: chart of accounts, stations, customers, journals, loans, aquaculture, Data Bank closes, inventory, and more. Large tenants may take several minutes.'}
          </p>
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading || !canOperate}
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
                Restoring deletes all current data for {isSaas ? 'the selected company' : 'this company'} and reloads
                the file. The backup must have been created for the same company ID.
                {isSaas ? ' Ensure reverse-proxy upload size and timeouts are sufficient.' : ''}
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
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFileChange} />
          <button
            type="button"
            onClick={onPickFile}
            disabled={restoring || confirmText.trim() !== RESTORE_CONFIRM_PHRASE || !canOperate}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-700 bg-white px-4 py-2.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {restoring ? 'Restoring…' : 'Choose backup file and restore'}
          </button>
        </div>
      </div>
    </>
  )
}
