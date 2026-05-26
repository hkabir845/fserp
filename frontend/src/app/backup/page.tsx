'use client'

/**
 * Tenant Backup & Restore — company owner in ERP / Management.
 * Super admin platform backup is under SaaS: /admin/backup
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import BackupRestorePanel from '@/components/backup/BackupRestorePanel'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { Database } from 'lucide-react'
import api, { isSuperAdminRole } from '@/lib/api'
import { canAccessBackup } from '@/utils/rbac'
import { safeLogError } from '@/utils/connectionError'

function TenantBackupRestoreContent() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [companyLabel, setCompanyLabel] = useState('')
  const [userRole, setUserRole] = useState<string | null>(null)

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
      if (!canAccessBackup(r)) {
        setLoading(false)
        return
      }
      try {
        const cur = await api.get('/companies/current/')
        const d = cur.data
        const name = (d?.name || d?.company_name || '').trim() || `Company #${d?.id}`
        setCompanyLabel(name)
      } catch (e) {
        safeLogError('backup company context', e)
        setCompanyLabel('')
      }
      setLoading(false)
    }
    void load()
  }, [router])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    )
  }

  if (!canAccessBackup(userRole)) {
    return (
      <PageLayout>
        <div className="flex min-h-[50vh] items-center justify-center px-4 py-8 sm:p-8">
          <div className="max-w-lg rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <p className="text-gray-700">
              You do not have permission to back up or restore tenant data. Ask a company administrator to grant{' '}
              <strong>Backup &amp; restore</strong> in Roles &amp; access, or use{' '}
              <Link href="/roles" className="font-medium text-blue-700 hover:underline">
                Roles &amp; access
              </Link>{' '}
              if you manage permissions.
            </p>
          </div>
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout>
      <div className="mx-auto max-w-3xl app-scroll-pad">
        <div className="mb-8 flex items-start gap-3">
          <div className="rounded-lg bg-blue-100 p-3">
            <Database className="h-8 w-8 text-blue-700" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">Management</p>
            <h1 className="text-3xl font-bold text-gray-900">Backup &amp; Restore</h1>
            <p className="mt-1 text-gray-600">
              Export or replace the full application data for{' '}
              <span className="font-semibold text-gray-800">{companyLabel || 'your company'}</span> (schema v2): ERP,
              forecourt, aquaculture, inventory, payroll, loans, and related records.
            </p>
          </div>
        </div>

        <BackupRestorePanel scope="tenant" api={api} companyLabel={companyLabel} />
      </div>
    </PageLayout>
  )
}

export default function BackupRestorePage() {
  return (
    <CompanyProvider>
      <TenantBackupRestoreContent />
    </CompanyProvider>
  )
}
