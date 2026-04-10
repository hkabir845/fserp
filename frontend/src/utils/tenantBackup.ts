import type { AxiosInstance } from 'axios'

/** Must match backend `api.services.tenant_backup.RESTORE_CONFIRM_PHRASE`. */
export const RESTORE_CONFIRM_PHRASE = 'DELETE_ALL_TENANT_DATA' as const

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadTenantBackupForCurrentCompany(api: AxiosInstance) {
  const res = await api.get('/company/backup/', { responseType: 'blob' })
  const cd = res.headers['content-disposition'] as string | undefined
  let name = 'fserp_company_backup.json'
  if (cd) {
    const m = /filename="?([^";]+)"?/i.exec(cd)
    if (m?.[1]) name = m[1]
  }
  triggerDownload(res.data as Blob, name)
}

export async function downloadTenantBackupForAdminCompany(api: AxiosInstance, companyId: number) {
  const res = await api.get(`/admin/companies/${companyId}/backup/`, { responseType: 'blob' })
  const cd = res.headers['content-disposition'] as string | undefined
  let name = `fserp_company_${companyId}_backup.json`
  if (cd) {
    const m = /filename="?([^";]+)"?/i.exec(cd)
    if (m?.[1]) name = m[1]
  }
  triggerDownload(res.data as Blob, name)
}

export async function restoreTenantBackupForCurrentCompany(
  api: AxiosInstance,
  file: File,
  confirmPhrase: string
) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('confirm_replace', confirmPhrase)
  return api.post('/company/restore/', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
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
  return api.post(`/admin/companies/${companyId}/restore/`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
