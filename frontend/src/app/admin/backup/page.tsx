'use client'

/**
 * Platform Backup & Restore — SaaS area only (super admin).
 * Per-tenant company-owner backup lives at /backup (ERP Management).
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import BackupRestorePanel, { type BackupCompanyOption } from '@/components/backup/BackupRestorePanel'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { useRequireSaasDashboardMode } from '@/hooks/useRequireSaasDashboardMode'
import { Database } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { isSuperAdminRole } from '@/lib/api'
import { safeLogError } from '@/utils/connectionError'

function SaasBackupRestoreContent() {
  useRequireSaasDashboardMode()
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [companies, setCompanies] = useState<BackupCompanyOption[]>([])
  const [targetCompanyId, setTargetCompanyId] = useState<number | null>(null)

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
        const rows: BackupCompanyOption[] = Array.isArray(res.data)
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
    void load()
  }, [router, toast])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <PageLayout>
      <div className="mx-auto max-w-3xl app-scroll-pad">
        <div className="mb-8 flex items-start gap-3">
          <div className="rounded-lg bg-accent p-3">
            <Database className="h-8 w-8 text-primary" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">SaaS platform</p>
            <h1 className="text-3xl font-bold text-foreground">Backup &amp; Restore</h1>
            <p className="mt-1 text-muted-foreground">
              Export or replace a tenant&apos;s full ERP data by company (schema v2): core books, forecourt, aquaculture
              (ponds, landlords, Data Bank closes, stock), inventory, payroll, loans, and portal organization settings.
              Use for disaster recovery and migration — protect files like production credentials.
            </p>
          </div>
        </div>

        <BackupRestorePanel
          scope="saas"
          api={api}
          companies={companies}
          targetCompanyId={targetCompanyId}
          onTargetCompanyChange={setTargetCompanyId}
        />
      </div>
    </PageLayout>
  )
}

export default function AdminBackupPage() {
  return (
    <CompanyProvider>
      <SaasBackupRestoreContent />
    </CompanyProvider>
  )
}
