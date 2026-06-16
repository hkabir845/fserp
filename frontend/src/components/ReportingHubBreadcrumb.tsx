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
      className={`text-sm text-gray-600 print:hidden dark:text-slate-400 ${className}`.trim()}
      aria-label="Breadcrumb"
    >
      <Link
        href="/reports"
        className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline dark:text-indigo-400 dark:hover:text-indigo-300"
      >
        Reporting hub
      </Link>
      <span className="mx-2 text-gray-400 dark:text-slate-500" aria-hidden>
        /
      </span>
      <span className="text-gray-800 dark:text-slate-200">{current}</span>
    </nav>
  )
}
