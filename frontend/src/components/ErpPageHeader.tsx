'use client'

import type { ReactNode } from 'react'
import { usePageMeta } from '@/hooks/usePageMeta'

type ErpPageHeaderProps = {
  /** Override route for meta lookup (defaults to current pathname). */
  route?: string
  title?: string
  description?: string
  eyebrow?: string
  actions?: ReactNode
  className?: string
}

/**
 * Localized page header from company language + route metadata.
 * Pass title/description to override meta for edge cases.
 */
export function ErpPageHeader({
  route,
  title,
  description,
  eyebrow,
  actions,
  className = '',
}: ErpPageHeaderProps) {
  const meta = usePageMeta(route)
  const displayTitle = title ?? meta.title
  const displayDescription = description ?? meta.description
  const displayEyebrow = eyebrow ?? meta.eyebrow

  return (
    <header className={`space-y-4 ${className}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          {displayEyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{displayEyebrow}</p>
          ) : null}
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{displayTitle}</h1>
          {displayDescription ? (
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{displayDescription}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 lg:shrink-0">{actions}</div> : null}
      </div>
    </header>
  )
}
