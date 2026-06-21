'use client'

import Link from 'next/link'
import { useEffect, useMemo } from 'react'
import { FileBarChart, Loader2 } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AquaculturePageShell } from '@/components/aquaculture/AquaculturePageShell'
import { AQ_HERO_BTN_PRIMARY } from '@/components/aquaculture/AquacultureUi'
import { usePageMeta } from '@/hooks/usePageMeta'
import { aquacultureT } from '@/lib/aquacultureI18n'
import { useT } from '@/lib/i18n'

/** Legacy URL — redirects to aquaculture P&L in Reports while showing aquaculture chrome. */
export default function AquacultureReportRedirectPage() {
  const pageMeta = usePageMeta()
  const { lang } = useT()
  const router = useRouter()
  const searchParams = useSearchParams()

  const reportsHref = useMemo(() => {
    const q = new URLSearchParams({
      report: 'aquaculture-pl-management',
      category: 'aquaculture',
    })
    for (const key of ['start_date', 'end_date', 'pond_id', 'archive_label', 'archive_close_id'] as const) {
      const v = searchParams.get(key)
      if (v) q.set(key, v)
    }
    return `/reports?${q.toString()}`
  }, [searchParams])

  useEffect(() => {
    router.replace(reportsHref)
  }, [router, reportsHref])

  return (
    <AquaculturePageShell
      titleId="aq-report-title"
      eyebrow={pageMeta.eyebrow}
      title={pageMeta.title}
      titleIcon={FileBarChart}
      description={pageMeta.description ?? undefined}
      maxWidthClass="max-w-[1440px]"
      actions={
        <Link href={reportsHref} className={AQ_HERO_BTN_PRIMARY}>
          <FileBarChart className="h-3.5 w-3.5" aria-hidden />
          {aquacultureT('openPlReport', lang)}
        </Link>
      }
    >
      <div className="flex min-h-[32vh] flex-col items-center justify-center rounded-2xl border border-slate-200/90 bg-white px-6 py-12 text-center shadow-sm">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" aria-hidden />
        <p className="mt-4 text-sm text-slate-600">{aquacultureT('aquacultureReportOpening', lang)}</p>
        <Link href={reportsHref} className="mt-4 text-sm font-medium text-teal-800 underline hover:text-teal-950">
          {aquacultureT('openPlReport', lang)}
        </Link>
      </div>
    </AquaculturePageShell>
  )
}
