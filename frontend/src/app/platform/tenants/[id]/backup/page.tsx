'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { PlatformLayout } from '@/components/PlatformLayout'
import { getPlatformUser } from '@/lib/platform-auth'

type Tenant = {
  id: number
  name: string
  domain: string
  is_active: boolean
  created_at: string
}

type BackupFile = { filename: string; size_bytes: number; modified_at: string }

type BackupCreateResponse = {
  filename: string
  path: string
  size_bytes: number
  table_row_counts?: Record<string, number>
  exported_at?: string
}

export default function TenantBackupPage() {
  const params = useParams()
  const router = useRouter()
  const qc = useQueryClient()
  const tenantId = Number(params.id)
  const [mounted, setMounted] = useState(false)
  const [confirmDomain, setConfirmDomain] = useState('')
  const [restoreFile, setRestoreFile] = useState<File | null>(null)

  useEffect(() => {
    setMounted(true)
    const token = localStorage.getItem('platform_token') || localStorage.getItem('access_token')
    if (!token) router.push('/login')
  }, [router])

  const tenantQ = useQuery({
    queryKey: ['platform-tenant', tenantId],
    queryFn: async () => (await api.get<Tenant>(`/platform/tenants/${tenantId}`)).data,
    enabled: mounted && Number.isFinite(tenantId),
  })

  const backupsQ = useQuery({
    queryKey: ['platform-tenant-backups', tenantId],
    queryFn: async () => (await api.get<BackupFile[]>(`/platform/tenants/${tenantId}/backups`)).data,
    enabled: mounted && Number.isFinite(tenantId),
  })

  useEffect(() => {
    if (tenantQ.data?.domain) setConfirmDomain((d) => d || tenantQ.data!.domain)
  }, [tenantQ.data?.domain])

  const exportMut = useMutation({
    mutationFn: async () => {
      const res = await api.get(`/platform/tenants/${tenantId}/backup/export`, {
        responseType: 'blob',
        timeout: 120_000,
      })
      const blob = res.data as Blob
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tenant_${tenantId}_${tenantQ.data?.domain || 'export'}.json`.replace(/[^\w.-]+/g, '_')
      a.click()
      URL.revokeObjectURL(url)
    },
  })

  const serverBackupMut = useMutation({
    mutationFn: async () => (await api.post<BackupCreateResponse>(`/platform/tenants/${tenantId}/backup`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-tenant-backups', tenantId] })
    },
  })

  const restoreMut = useMutation({
    mutationFn: async () => {
      if (!restoreFile) throw new Error('Choose a JSON backup file')
      const fd = new FormData()
      fd.append('confirm_domain', confirmDomain.trim())
      fd.append('file', restoreFile)
      return (
        await api.post<{ message: string; tables_touched: number; row_counts: Record<string, number> }>(
          `/platform/tenants/${tenantId}/restore`,
          fd,
          { timeout: 300_000 }
        )
      ).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-tenant', tenantId] })
      qc.invalidateQueries({ queryKey: ['platform-tenants'] })
    },
  })

  const errExport = (exportMut.error as { message?: string })?.message
  const errServer = (serverBackupMut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
  const errRestore = (restoreMut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail

  const sortedCounts = useMemo(() => {
    const c = serverBackupMut.data?.table_row_counts
    if (!c) return []
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [serverBackupMut.data])

  async function downloadNamed(filename: string) {
    const res = await api.get(`/platform/tenants/${tenantId}/backups/${encodeURIComponent(filename)}`, {
      responseType: 'blob',
      timeout: 120_000,
    })
    const blob = res.data as Blob
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!mounted || !Number.isFinite(tenantId)) return null

  return (
    <PlatformLayout>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <Link href="/platform/tenants/browse" className="text-sm font-medium text-purple-600 hover:text-purple-800">
            ← All tenants
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Tenant backup & restore</h1>
          {tenantQ.data && (
            <p className="mt-1 text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{tenantQ.data.name}</span>
              <span className="mx-2 text-gray-400">·</span>
              <span className="font-mono">{tenantQ.data.domain}</span>
              <span className="mx-2 text-gray-400">·</span>ID {tenantId}
            </p>
          )}
        </div>

        {getPlatformUser() && (
          <p className="mb-6 text-xs text-gray-500">
            Platform operator: <span className="font-mono text-gray-700">{getPlatformUser()?.email}</span>
          </p>
        )}

        <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Export</h2>
          <p className="mt-1 text-sm text-gray-600">
            Download a complete logical JSON snapshot (all tables scoped by <code className="rounded bg-gray-100 px-1">tenant_id</code>, users,
            roles, user_roles, subscriptions, operational data). Use for archives or migration analysis.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={exportMut.isPending || tenantQ.isLoading}
              onClick={() => exportMut.mutate()}
              className="rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {exportMut.isPending ? 'Preparing download…' : 'Download JSON backup'}
            </button>
            <button
              type="button"
              disabled={serverBackupMut.isPending || tenantQ.isLoading}
              onClick={() => serverBackupMut.mutate()}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {serverBackupMut.isPending ? 'Saving…' : 'Save backup on server'}
            </button>
          </div>
          {(errExport || errServer) && <p className="mt-2 text-sm text-red-600">{errExport || errServer}</p>}
          {serverBackupMut.data && (
            <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-900">
              <p className="font-medium">Saved {serverBackupMut.data.filename}</p>
              <p className="text-xs text-green-800">{serverBackupMut.data.size_bytes} bytes</p>
              {sortedCounts.length > 0 && (
                <ul className="mt-2 max-h-40 overflow-auto text-xs">
                  {sortedCounts.slice(0, 30).map(([k, v]) => (
                    <li key={k}>
                      {k}: {v}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Server backup files</h2>
          <p className="mt-1 text-sm text-gray-600">Stored under configured <code className="rounded bg-gray-100 px-1">TENANT_BACKUP_DIR</code> on the API host.</p>
          <button
            type="button"
            onClick={() => backupsQ.refetch()}
            className="mt-3 text-sm font-medium text-purple-600 hover:text-purple-800"
          >
            {backupsQ.isFetching ? 'Refreshing…' : 'Refresh list'}
          </button>
          {backupsQ.isError && <p className="mt-2 text-sm text-red-600">Could not list backups.</p>}
          <ul className="mt-3 divide-y divide-gray-100 text-sm">
            {(backupsQ.data || []).length === 0 && !backupsQ.isLoading && (
              <li className="py-2 text-gray-500">No files yet. Use “Save backup on server”.</li>
            )}
            {(backupsQ.data || []).map((f) => (
              <li key={f.filename} className="flex items-center justify-between py-2">
                <span className="font-mono text-xs text-gray-800">{f.filename}</span>
                <span className="text-xs text-gray-500">
                  {(f.size_bytes / 1024).toFixed(1)} KB · {f.modified_at}
                </span>
                <button
                  type="button"
                  onClick={() => downloadNamed(f.filename)}
                  className="text-sm font-medium text-purple-600 hover:text-purple-800"
                >
                  Download
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-red-200 bg-red-50/40 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-red-900">Restore (destructive)</h2>
          <p className="mt-1 text-sm text-red-800/90">
            This <strong>deletes all data</strong> for this tenant id and replaces it from the backup file. The backup must be for the{' '}
            <strong>same tenant id</strong>. You must type the tenant <strong>domain</strong> exactly as stored in the backup to confirm.
            Subscription <strong>plans</strong> are global and are not overwritten.
          </p>
          <div className="mt-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-800">Confirm tenant domain</label>
              <input
                value={confirmDomain}
                onChange={(e) => setConfirmDomain(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
                placeholder="e.g. knbgroup.com.bd"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800">Backup JSON file</label>
              <input
                type="file"
                accept="application/json,.json"
                className="mt-1 block w-full text-sm text-gray-700"
                onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
              />
            </div>
            <button
              type="button"
              disabled={restoreMut.isPending || !restoreFile || !confirmDomain.trim()}
              onClick={() => restoreMut.mutate()}
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {restoreMut.isPending ? 'Restoring…' : 'Run restore'}
            </button>
          </div>
          {errRestore && <p className="mt-2 text-sm text-red-700">{errRestore}</p>}
          {restoreMut.data && (
            <div className="mt-4 rounded-md bg-white p-3 text-sm text-gray-800 ring-1 ring-red-200">
              <p className="font-medium">{restoreMut.data.message}</p>
              <p className="mt-1 text-xs text-gray-600">Tables written: {restoreMut.data.tables_touched}</p>
            </div>
          )}
        </section>
      </div>
    </PlatformLayout>
  )
}
