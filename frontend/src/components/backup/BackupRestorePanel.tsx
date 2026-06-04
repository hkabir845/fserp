'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { AlertTriangle, CheckCircle2, Download, History, Info, RefreshCw, Upload, XCircle } from 'lucide-react'
import { useToast } from '@/components/Toast'
import {
  RESTORE_CONFIRM_PHRASE,
  downloadTenantBackupForAdminCompany,
  downloadTenantBackupForCurrentCompany,
  fetchBackupHistoryForAdminCompany,
  fetchBackupHistoryForCurrentCompany,
  fetchBackupPreviewForAdminCompany,
  restoreTenantBackupForAdminCompany,
  restoreTenantBackupForCurrentCompany,
  type BackupAuditEntry,
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

function formatAuditTimestamp(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function actionLabel(action: string): string {
  if (action === 'backup_download') return 'Backup'
  if (action === 'restore') return 'Restore'
  return action || '—'
}

export default function BackupRestorePanel(props: BackupRestorePanelProps) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [downloading, setDownloading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [preview, setPreview] = useState<BackupPreviewPayload | null>(null)
  const [history, setHistory] = useState<BackupAuditEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const isSaas = props.scope === 'saas'
  const companyLabel = isSaas
    ? props.companies.find((c) => c.id === props.targetCompanyId)?.name || `Company #${props.targetCompanyId ?? '?'}`
    : props.companyLabel
  const targetCompanyId = isSaas ? props.targetCompanyId : null
  const canOperate = isSaas ? targetCompanyId != null : true

  const api = props.api
  const loadHistory = useCallback(async () => {
    if (isSaas && targetCompanyId == null) {
      setHistory([])
      return
    }
    setHistoryLoading(true)
    try {
      const data =
        isSaas && targetCompanyId != null
          ? await fetchBackupHistoryForAdminCompany(api, targetCompanyId)
          : await fetchBackupHistoryForCurrentCompany(api)
      setHistory(data.results || [])
    } catch (e: unknown) {
      safeLogError('backup history', e)
    } finally {
      setHistoryLoading(false)
    }
  }, [api, isSaas, targetCompanyId])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

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
      void loadHistory()
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
              <>
                <p className="mt-1">
                  Applies to your signed-in tenant (the company selected in the header switcher when you use multiple
                  contexts). The backup file is tied to your company ID and includes portal organization settings used for
                  login routing.
                </p>
                <p className="mt-2 text-slate-600">
                  Schema v2 exports every company table (over 70 model types): GL, stations, inventory, aquaculture, Data
                  Bank, loans, payroll, and more. Export fails if any table with data is missing from the file. Only
                  password-reset tokens and this page&apos;s audit log are intentionally omitted (security).
                </p>
              </>
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
              : 'Full schema v2 JSON snapshot: every company table with data (chart of accounts, stations, journals, loans, aquaculture, Data Bank, inventory, users, roles, etc.). Export is blocked if anything would be skipped. Large tenants may take several minutes.'}
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

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <History className="h-5 w-5 text-gray-500" />
              Activity history
            </h2>
            <button
              type="button"
              onClick={() => void loadHistory()}
              disabled={historyLoading || !canOperate}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${historyLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Audit trail of backup and restore operations (who, when, outcome). Most recent first.
          </p>

          {!canOperate ? (
            <p className="mt-4 text-sm text-gray-500">Select a company above to view its history.</p>
          ) : history.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">
              {historyLoading ? 'Loading…' : 'No backup or restore activity recorded yet.'}
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Result</th>
                    <th className="px-3 py-2">By</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2 text-right">Records</th>
                    <th className="px-3 py-2">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.map((row) => (
                    <tr key={row.id} className="text-gray-800">
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                        {formatAuditTimestamp(row.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{actionLabel(row.action)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {row.success ? (
                          <span className="inline-flex items-center gap-1 text-green-700">
                            <CheckCircle2 className="h-4 w-4" /> Success
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-700">
                            <XCircle className="h-4 w-4" /> Failed
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">{row.actor_label || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">{row.source || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-gray-600">
                        {row.record_count ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {row.error_message ? (
                          <span className="text-red-700" title={row.error_message}>
                            {row.error_message.length > 80
                              ? `${row.error_message.slice(0, 80)}…`
                              : row.error_message}
                          </span>
                        ) : row.safety_snapshot_path ? (
                          <span title={row.safety_snapshot_path}>Safety snapshot saved</span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
