'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft } from 'lucide-react'
import { aquacultureT } from '@/lib/aquacultureI18n'
import { useT } from '@/lib/i18n'

export type AquaculturePageShellProps = {
  titleId?: string
  eyebrow?: string
  eyebrowIcon?: LucideIcon
  title: string
  titleIcon?: LucideIcon
  description?: string
  backHref?: string
  backLabel?: string
  actions?: ReactNode
  stats?: ReactNode
  children: ReactNode
  maxWidthClass?: string
  contentClassName?: string
  showBackLink?: boolean
  /** Use when parent already applies padding (e.g. app-scroll-pad). */
  flush?: boolean
}

export function AquaculturePageShell({
  titleId,
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  title,
  titleIcon: TitleIcon,
  description,
  backHref = '/aquaculture',
  backLabel,
  actions,
  stats,
  children,
  maxWidthClass = 'max-w-[1440px]',
  contentClassName = 'mt-6',
  showBackLink = true,
  flush = false,
}: AquaculturePageShellProps) {
  const { lang } = useT()
  const back = backLabel ?? aquacultureT('aquaculture', lang)

  const outerClass = flush
    ? `w-full min-w-0 ${maxWidthClass}`
    : `mx-auto ${maxWidthClass} px-4 py-5 pb-24 sm:px-6 lg:px-8 lg:pb-8`

  return (
    <div className={outerClass}>
      {showBackLink ? (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:text-teal-950"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {back}
        </Link>
      ) : null}

      <header className={`${showBackLink ? 'mt-4' : ''} overflow-hidden rounded-2xl border border-teal-200/60 bg-gradient-to-br from-slate-900 via-teal-950 to-emerald-950 p-5 text-white shadow-xl sm:p-6`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-teal-200">
                {EyebrowIcon ? <EyebrowIcon className="h-3.5 w-3.5" aria-hidden /> : null}
                {eyebrow}
              </p>
            ) : null}
            <h1
              id={titleId}
              className={`${eyebrow ? 'mt-1' : ''} flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl`}
            >
              {TitleIcon ? <TitleIcon className="h-7 w-7 text-teal-300" strokeWidth={1.75} aria-hidden /> : null}
              {title}
            </h1>
            {description ? (
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-teal-100/90">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-end gap-2">{actions}</div> : null}
        </div>
        {stats ? <div className="mt-5">{stats}</div> : null}
      </header>

      <div className={contentClassName}>{children}</div>
    </div>
  )
}
