'use client'

/**
 * Tenant Backup & Restore — company owner in ERP / Management.
 * Super admin platform backup is under SaaS: /admin/backup
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { usePageMeta } from '@/hooks/usePageMeta'
import BackupRestorePanel from '@/components/backup/BackupRestorePanel'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { Database } from 'lucide-react'
import api, { isSuperAdminRole } from '@/lib/api'
import { canAccessBackup } from '@/utils/rbac'
import { safeLogError } from '@/utils/connectionError'

function TenantBackupRestoreContent() {
  const router = useRouter()
  const pageMeta = usePageMeta()
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
      <PageLayout>
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-border border-t-blue-600" />
        </div>
      </PageLayout>
    )
  }

  if (!canAccessBackup(userRole)) {
    return (
      <PageLayout>
        <div className="flex min-h-[50vh] items-center justify-center px-4 py-8 sm:p-8">
          <div className="max-w-lg rounded-xl border border-border bg-white p-6 text-center shadow-sm">
            <p className="text-foreground/85">
              You do not have permission to back up or restore tenant data. Ask a company administrator to grant{' '}
              <strong>Backup &amp; restore</strong> in Roles &amp; access, or use{' '}
              <Link href="/roles" className="font-medium text-primary hover:underline">
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
      <ErpPageShell
        showBackLink={false}
        eyebrow={pageMeta.eyebrow}
        title={pageMeta.title}
        titleIcon={Database}
        description={pageMeta.description}
        maxWidthClass="max-w-[1600px]"
        contentClassName="mt-4"
      >
        <BackupRestorePanel scope="tenant" api={api} companyLabel={companyLabel} />
      </ErpPageShell>
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
