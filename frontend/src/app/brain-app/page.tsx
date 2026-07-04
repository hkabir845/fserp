'use client'

import { Suspense, useEffect } from 'react'
import Link from 'next/link'
import { useCompany } from '@/contexts/CompanyContext'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import { BrainChatPanel, brainUiLabels } from '@/components/brain/BrainChatPanel'
import { fetchCurrentCompany, persistSelectedCompanyForApi } from '@/lib/api'
import {
  clearBrainSession,
  hasValidBrainSession,
  logoutBrainApp,
  redirectBrainLoginIfNeeded,
} from '@/lib/brainAppSession'
import { registerBrainPwaServiceWorker } from '@/lib/pwaServiceWorker'
import { BrainAppShell } from '@/components/brain/BrainAppShell'
import { LayoutGrid, LogOut } from 'lucide-react'

function BrainAppHeader() {
  const { selectedCompany } = useCompany()
  const companyName = selectedCompany?.name || 'Company Brain'

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-indigo-200/60 bg-gradient-to-r from-indigo-600 to-violet-600 px-4 text-white shadow-sm">
      <div className="flex min-w-0 items-center gap-2">
        <img src="/brain-app/icon-192.png" alt="" className="h-8 w-8 rounded-lg shadow" width={32} height={32} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{companyName}</p>
          <p className="text-[10px] opacity-80">Company Brain</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Link
          href="/dashboard"
          className="rounded-lg p-2 text-white/90 hover:bg-white/10"
          title="Full ERP"
          aria-label="Open full ERP"
        >
          <LayoutGrid className="h-5 w-5" />
        </Link>
        <button
          type="button"
          onClick={() => logoutBrainApp()}
          className="rounded-lg px-2 py-2 text-sm font-medium text-white/95 hover:bg-white/10"
          title="Logout"
          aria-label="Logout"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  )
}

function BrainAppContent() {
  const { language } = useCompanyLocale()
  const { setSelectedCompany } = useCompany()
  const labels = brainUiLabels(language === 'bn' ? 'bn' : 'en')

  useEffect(() => {
    registerBrainPwaServiceWorker()
    if (!hasValidBrainSession()) {
      redirectBrainLoginIfNeeded()
      return
    }

    void (async () => {
      try {
        const data = await fetchCurrentCompany()
        const id = data?.id
        const name = String(data?.name || '').trim()
        if (typeof id === 'number' && name) {
          const company = {
            id,
            name,
            is_master:
              data.is_master === true || String(data.is_master || '').toLowerCase() === 'true'
                ? 'true'
                : 'false',
          }
          persistSelectedCompanyForApi(company)
          setSelectedCompany(company)
        }
      } catch {
        clearBrainSession()
        redirectBrainLoginIfNeeded()
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount after login redirect
  }, [])

  return (
    <BrainAppShell>
      <BrainAppHeader />
      <main className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col px-3 py-2 sm:px-4 sm:py-3">
        <p className="mb-2 shrink-0 text-center text-xs text-muted-foreground">{labels.subtitle}</p>
        <BrainChatPanel standalone className="min-h-0 flex-1 border-indigo-100 shadow-md" />
      </main>
    </BrainAppShell>
  )
}

export default function BrainAppPage() {
  return (
    <Suspense fallback={null}>
      <BrainAppContent />
    </Suspense>
  )
}
