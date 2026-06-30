'use client'

import Link from 'next/link'

type Props = {
  /** Short label for the current screen (e.g. "Trial balance"). */
  current: string
  className?: string
}

/**
 * Link back to `/reports` from any screen listed in the Reporting hub catalog.
 */
export function ReportingHubBreadcrumb({ current, className = '' }: Props) {
  return (
    <nav
      className={`text-sm text-muted-foreground print:hidden dark:text-muted-foreground/70 ${className}`.trim()}
      aria-label="Breadcrumb"
    >
      <Link
        href="/reports"
        className="font-medium text-primary hover:text-primary hover:underline dark:text-indigo-400 dark:hover:text-indigo-300"
      >
        Reporting hub
      </Link>
      <span className="mx-2 text-muted-foreground/70 dark:text-muted-foreground" aria-hidden>
        /
      </span>
      <span className="text-foreground dark:text-white/85">{current}</span>
    </nav>
  )
}
