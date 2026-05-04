import axios, { type AxiosInstance } from 'axios'

import { getApiBaseUrl } from '@/lib/api'

/** Must match backend `api.services.tenant_backup.RESTORE_CONFIRM_PHRASE`. */
export const RESTORE_CONFIRM_PHRASE = 'DELETE_ALL_TENANT_DATA' as const

/** Large tenants need far more than default 30s (export/import, serialization). */
export const BACKUP_RESTORE_TIMEOUT_MS = 900000

const backupAxiosConfig = {
  timeout: BACKUP_RESTORE_TIMEOUT_MS,
  maxContentLength: Infinity as number,
  maxBodyLength: Infinity as number,
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Explains stale-API case when backend still errors on JSON encoding backup payloads. */
function appendBackupStaleApiHint(message: string): string {
  if (!/not JSON serializable/i.test(message)) return message
  return `${message} Current API: ${getApiBaseUrl()}. For local Django set API URL in frontend/.env.development; otherwise deploy the latest backend to production.`
}

/** When `responseType: 'blob'`, 4xx/5xx JSON bodies arrive as Blob — surface `detail` / `error` in the UI. */
async function tryParseBackupDownloadAxiosError(err: unknown): Promise<string | null> {
  if (!axios.isAxiosError(err) || !err.response?.data) return null
  const data = err.response.data as unknown
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    const text = await data.text()
    if (!text.trim()) return null
    try {
      const j = JSON.parse(text) as { detail?: string; error?: string }
      const parts = [j.detail, j.error].filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      return parts.length ? parts.join(' — ') : null
    } catch {
      return text.slice(0, 800)
    }
  }
  return null
}

/** Reject small JSON error bodies that some stacks return with 200 (proxy misconfig). Real bundles are larger. */
async function assertBlobLooksLikeBackupFile(blob: Blob, fallbackMessage: string): Promise<void> {
  if (blob.size >= 65536) return
  const text = await blob.text()
  try {
    const j = JSON.parse(text) as { detail?: string; schema_version?: unknown; records?: unknown }
    if (typeof j?.detail === 'string' && j.schema_version === undefined && j.records === undefined) {
      throw new Error(j.detail)
    }
  } catch (e) {
    if (e instanceof SyntaxError) return
    throw e instanceof Error ? e : new Error(fallbackMessage)
  }
}

export async function downloadTenantBackupForCurrentCompany(api: AxiosInstance) {
  try {
    const res = await api.get('/company/backup/', {
      responseType: 'blob',
      ...backupAxiosConfig,
    })
    await assertBlobLooksLikeBackupFile(res.data as Blob, 'Backup download failed')
    const cd = res.headers['content-disposition'] as string | undefined
    let name = 'fserp_company_backup.json'
    if (cd) {
      const m = /filename="?([^";]+)"?/i.exec(cd)
      if (m?.[1]) name = m[1]
    }
    triggerDownload(res.data as Blob, name)
  } catch (e) {
    const msg = await tryParseBackupDownloadAxiosError(e)
    if (msg) throw new Error(appendBackupStaleApiHint(msg))
    throw e
  }
}

export async function downloadTenantBackupForAdminCompany(api: AxiosInstance, companyId: number) {
  try {
    const res = await api.get(`/admin/companies/${companyId}/backup/`, {
      responseType: 'blob',
      ...backupAxiosConfig,
    })
    await assertBlobLooksLikeBackupFile(res.data as Blob, 'Backup download failed')
    const cd = res.headers['content-disposition'] as string | undefined
    let name = `fserp_company_${companyId}_backup.json`
    if (cd) {
      const m = /filename="?([^";]+)"?/i.exec(cd)
      if (m?.[1]) name = m[1]
    }
    triggerDownload(res.data as Blob, name)
  } catch (e) {
    const msg = await tryParseBackupDownloadAxiosError(e)
    if (msg) throw new Error(appendBackupStaleApiHint(msg))
    throw e
  }
}

export async function restoreTenantBackupForCurrentCompany(
  api: AxiosInstance,
  file: File,
  confirmPhrase: string
) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('confirm_replace', confirmPhrase)
  return api.post('/company/restore/', fd, backupAxiosConfig)
}

export async function restoreTenantBackupForAdminCompany(
  api: AxiosInstance,
  companyId: number,
  file: File,
  confirmPhrase: string
) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('confirm_replace', confirmPhrase)
  return api.post(`/admin/companies/${companyId}/restore/`, fd, backupAxiosConfig)
}

export interface BackupPreviewPayload {
  company_id: number
  company_name: string
  exported_at: string
  record_count: number
  schema_version: number
}

export async function fetchBackupPreviewForAdminCompany(api: AxiosInstance, companyId: number) {
  const { data } = await api.get<BackupPreviewPayload>(
    `/admin/companies/${companyId}/backup/preview/`,
    backupAxiosConfig
  )
  return data
}
